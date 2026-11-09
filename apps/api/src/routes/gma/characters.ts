/**
 * GM Assistant — resync des personnages (phase 4e, déplacement pur depuis
 * routes/gma.ts, corps verbatim) : diff upsert (dryRun/appliqué, recréation
 * des liens orphelins, PCs GMA non liés rapportés) et suppression EXPLICITE
 * d'un orphelin — le seul DELETE jamais émis côté GMA.
 */

import type { GmaSyncCharactersPayload } from '@table-sync/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { gmaPcLinks, partyGmaLinks, userGmaLinks } from '../../db/schema.ts';
import { GmaError, gmaErrorToResponse, gmaListAll, gmaRequest } from '../../gma/client.ts';
import { apiMsg } from '../messages.ts';
import { requireUser } from '../helpers.ts';
import {
  desiredPc,
  emitGma,
  getPartyLink,
  gmaDescription,
  loadPartyCharacters,
  noteScope,
  nowIso,
  requirePartyGM,
  resolveLinkKey,
} from './shared.ts';

export async function characterSyncRoutes(app: FastifyInstance) {
  // =================== Character resync (upsert batch) ===================

  app.post(
    '/parties/:partyId/gma/characters/sync',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: GmaSyncCharactersPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
        });
      }
      const key = resolveLinkKey(link);
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Clé GM Assistant expirée — le MD doit la ressaisir.'),
        });
      }
      const payload = req.body ?? {};
      const wanted = new Set(
        Array.isArray(payload.createCharacterIds)
          ? payload.createCharacterIds.filter((n: unknown) => Number.isInteger(n))
          : [],
      );
      const dryRun = payload.dryRun === true;
      const campaignId = link.gma_campaign_id;

      let gmaPcs: any[];
      try {
        gmaPcs = await gmaListAll<any>(key, `/campaigns/${campaignId}/player-characters`, {
          fields: 'id,name,played_by,description',
          limit: '500',
        });
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }

      const chars = loadPartyCharacters(partyId);
      const charById = new Map(chars.map((c) => [c.id as number, c]));
      const linkRows = getDrizzle()
        .select(cols(gmaPcLinks))
        .from(gmaPcLinks)
        .where(eq(gmaPcLinks.partyId, partyId))
        .all() as any[];
      const gmaById = new Map(gmaPcs.map((p) => [String(p.id), p]));
      const linkedCharIds = new Set(
        linkRows.filter((l) => l.character_id !== null).map((l) => l.character_id),
      );

      const toCreate: any[] = [];
      const toUpdate: any[] = [];
      const orphans: any[] = [];
      const gmaOnly: any[] = [];
      let upToDate = 0;
      // Link rows whose GMA PC vanished (deleted over there): their character
      // becomes a creation candidate again — apply deletes the stale row first.
      const recreateByCharId = new Map<number, any>();

      for (const c of chars) {
        if (c.hidden || linkedCharIds.has(c.id)) continue;
        toCreate.push({
          characterId: c.id,
          name: c.name,
          playedBy: c.owner_name,
          description: gmaDescription(c),
        });
      }
      for (const l of linkRows) {
        const char = l.character_id !== null ? charById.get(l.character_id) : undefined;
        if (!char) {
          if (l.character_id === null || !charById.has(l.character_id)) {
            orphans.push({ gmaPcId: l.gma_pc_id, nameAtSync: l.name_at_sync });
          }
          continue;
        }
        const gma = gmaById.get(l.gma_pc_id);
        if (!gma) {
          recreateByCharId.set(char.id, l);
          toCreate.push({
            characterId: char.id,
            name: char.name,
            playedBy: char.owner_name,
            description: gmaDescription(char),
          });
          continue;
        }
        const want = desiredPc(char);
        const changes: Array<{ field: string; from: string; to: string }> = [];
        for (const field of ['name', 'played_by', 'description'] as const) {
          const from = String(gma[field] ?? '');
          if (from !== want[field]) changes.push({ field, from, to: want[field] });
        }
        if (changes.length > 0) {
          toUpdate.push({
            characterId: char.id,
            name: char.name,
            gmaPcId: l.gma_pc_id,
            changes,
          });
        } else {
          upToDate++;
        }
      }
      for (const pc of gmaPcs) {
        const id = String(pc.id);
        if (!linkRows.some((l) => l.gma_pc_id === id)) {
          gmaOnly.push({ gmaPcId: id, name: pc.name ?? null });
        }
      }

      const diff = { toCreate, toUpdate, orphans, gmaOnly, upToDate };
      if (dryRun) {
        return reply.send({ ...diff, applied: false, created: [], updated: [], failed: [] });
      }

      const created: any[] = [];
      const updated: any[] = [];
      const failed: any[] = [];
      const isFatal = (err: unknown) =>
        err instanceof GmaError && [401, 403, 429].includes(err.status);

      for (const u of toUpdate) {
        const patch: Record<string, string> = {};
        for (const ch of u.changes) patch[ch.field] = ch.to;
        try {
          await gmaRequest(
            key,
            'PATCH',
            `/campaigns/${campaignId}/player-characters/${u.gmaPcId}`,
            {
              body: patch,
              contentType: 'application/merge-patch+json',
            },
          );
          updated.push({ characterId: u.characterId, name: u.name });
        } catch (err) {
          noteScope(userId, err);
          failed.push({
            name: u.name,
            action: 'update',
            reason: err instanceof GmaError ? err.message : 'GM Assistant est injoignable',
          });
          if (isFatal(err)) break;
        }
      }
      for (const c of toCreate) {
        if (!wanted.has(c.characterId)) continue;
        const staleLink = recreateByCharId.get(c.characterId);
        try {
          const pc = await gmaRequest<any>(
            key,
            'POST',
            `/campaigns/${campaignId}/player-characters`,
            {
              body: { name: c.name, played_by: c.playedBy, description: c.description },
            },
          );
          getDb().transaction(() => {
            const drizzle = getDrizzle();
            if (staleLink) {
              drizzle.delete(gmaPcLinks).where(eq(gmaPcLinks.id, staleLink.id)).run();
            }
            drizzle
              .insert(gmaPcLinks)
              .values({
                partyId,
                characterId: c.characterId,
                gmaPcId: String(pc.id),
                nameAtSync: c.name,
              })
              .run();
          })();
          created.push({ characterId: c.characterId, name: c.name, gmaPcId: String(pc.id) });
        } catch (err) {
          noteScope(userId, err);
          failed.push({
            name: c.name,
            action: 'create',
            reason: err instanceof GmaError ? err.message : 'GM Assistant est injoignable',
          });
          if (isFatal(err)) break;
        }
      }

      if (created.length + updated.length > 0) {
        getDrizzle()
          .update(userGmaLinks)
          .set({ scope: 'full_access' })
          .where(eq(userGmaLinks.userId, link.linked_by_user_id))
          .run();
        getDrizzle()
          .update(partyGmaLinks)
          .set({ updatedAt: nowIso() })
          .where(eq(partyGmaLinks.partyId, partyId))
          .run();
        emitGma(partyId, userId, 'sync');
      }
      return reply.send({ ...diff, applied: true, created, updated, failed });
    },
  );

  /** Explicit orphan delete — the ONLY delete we ever issue on GMA. */
  app.delete(
    '/parties/:partyId/gma/characters/:gmaPcId',
    async (
      req: FastifyRequest<{ Params: { partyId: string; gmaPcId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
        });
      }
      const row = getDrizzle()
        .select(cols(gmaPcLinks))
        .from(gmaPcLinks)
        .where(and(eq(gmaPcLinks.partyId, partyId), eq(gmaPcLinks.gmaPcId, req.params.gmaPcId)))
        .get() as any;
      if (!row) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_pc'),
          message: apiMsg(req, 'Ce personnage n’est pas géré par la synchronisation GM Assistant.'),
        });
      }
      const key = resolveLinkKey(link);
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Clé GM Assistant expirée — le MD doit la ressaisir.'),
        });
      }
      try {
        await gmaRequest(
          key,
          'DELETE',
          `/campaigns/${link.gma_campaign_id}/player-characters/${req.params.gmaPcId}`,
        );
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
      getDrizzle().delete(gmaPcLinks).where(eq(gmaPcLinks.id, row.id)).run();
      emitGma(partyId, userId, 'sync');
      return reply.send({ ok: true });
    },
  );
}
