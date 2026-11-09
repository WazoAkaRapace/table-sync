/**
 * GM Assistant — rail « PNJ repérés » (phase 4e, déplacement pur depuis
 * routes/gma.ts, corps verbatim). Lecture membre (visibilité filtrée) ;
 * contenu uniquement par geste explicite : import (copie + lien), link
 * (ajout possible si droit d'édition), pull (re-prise), unlink, discard/
 * restore (local, survit aux refetch). HÉRITAGE R4 : importe '../npcs.ts'
 * (mapNpc) — le monolithe gma.ts le faisait déjà (R4_LEGACY documenté).
 */

import type { GmaLinkEntityPayload, GmaPullEntityPayload } from '@table-sync/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { gmaEntityDiscards, gmaEntitySessions, gmaNpcLinks, npcs, users } from '../../db/schema.ts';
import { gmaErrorToResponse } from '../../gma/client.ts';
import { bus } from '../../sync/bus.ts';
import { isPartyGM, isPartyMember, requireUser } from '../helpers.ts';
import { apiMsg } from '../messages.ts';
import { mapNpc } from '../npcs.ts';
import {
  NON_NPC_ENTITY_TYPES,
  cachedEntities,
  cachedSessions,
  resolveEntity,
  sha256Hex,
  syncEntities,
  syncSessions,
} from './cache.ts';
import {
  appendedDescription,
  emitGma,
  resolveLinkKey,
  getPartyLink,
  isFresh,
  mayEditNpcContent,
  npcVisibleToUser,
  nowIso,
} from './shared.ts';

export async function entityRoutes(app: FastifyInstance) {
  // =================== Entities (« PNJ repérés » — member-facing rail) ===================
  //
  // Read-only upstream. Any member sees the assistant's catalogued NPCs,
  // imports the missing ones (shared NPC + link in one gesture) or links
  // them to NPCs already in the registry. Content flows ONLY through an
  // explicit gesture: import copies, link may append (if the actor may edit
  // the NPC), pull re-takes — local text is never silently overwritten.

  app.get(
    '/parties/:partyId/gma/entities',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Querystring: { refresh?: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      let rows = cachedEntities(partyId);
      const wantRefresh = req.query?.refresh === '1' && isPartyGM(partyId, userId);
      let stale = false;
      let fetchedAt: string | null = link.entities_fetched_at ?? null;
      if (!isFresh(fetchedAt) || wantRefresh) {
        const key = resolveLinkKey(link);
        if (!key) {
          stale = true; // expired/missing key — can't vouch for freshness
        } else {
          try {
            fetchedAt = await syncEntities(partyId, link, key);
            rows = cachedEntities(partyId);
          } catch (err) {
            if (rows.length === 0) {
              const { status, message } = gmaErrorToResponse(err);
              return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
            }
            stale = true; // stale-on-error: the rail keeps working
          }
        }
      }

      // « Vu en séance » leans on the sessions cache (ordinals) — make sure it
      // exists even when nobody ever opened the chronicle. Best-effort: an
      // outage here only degrades the session refs, not the rail itself.
      if (!isFresh(link.sessions_fetched_at)) {
        const sessKey = resolveLinkKey(link);
        if (sessKey) {
          try {
            await syncSessions(partyId, link, sessKey);
          } catch {
            /* ordinals degrade — the rail still serves */
          }
        }
      }

      // Session ordinals (chronicle order) for « Vu en séance ».
      const sessRows = cachedSessions(partyId);
      const ordinalById = new Map<string, number>(sessRows.map((r, i) => [r.session_id, i + 1]));
      const appearances = new Map<string, string[]>();
      for (const a of getDrizzle()
        .select(cols(gmaEntitySessions))
        .from(gmaEntitySessions)
        .where(eq(gmaEntitySessions.partyId, partyId))
        .all() as any[]) {
        const list = appearances.get(a.entity_id) ?? [];
        list.push(a.session_id);
        appearances.set(a.entity_id, list);
      }
      // Links, visibility-filtered: an entity linked to an NPC the requester
      // cannot see is simply absent from their list (it is claimed, privately).
      const gm = isPartyGM(partyId, userId);
      const visibleLinks = new Map<string, any>();
      const hiddenEntityIds = new Set<string>();
      for (const l of getDrizzle()
        .select({
          ...cols(gmaNpcLinks),
          npc_name: npcs.name,
          npc_shared: npcs.isShared,
          npc_created_by: npcs.createdBy,
          linker_name: users.displayName,
        })
        .from(gmaNpcLinks)
        .innerJoin(npcs, eq(gmaNpcLinks.npcId, npcs.id))
        .innerJoin(users, eq(gmaNpcLinks.linkedByUserId, users.id))
        .where(eq(gmaNpcLinks.partyId, partyId))
        .all() as any[]) {
        if (!gm && !l.npc_shared && l.npc_created_by !== userId) {
          hiddenEntityIds.add(l.gma_entity_id);
          continue;
        }
        visibleLinks.set(l.gma_entity_id, l);
      }

      const sessById = new Map(sessRows.map((r) => [r.session_id, r]));
      // Party-wide discards (« Écarter ») — survive every cache refresh.
      const discardedIds = new Set(
        (
          getDrizzle()
            .select({ entityId: gmaEntityDiscards.entityId })
            .from(gmaEntityDiscards)
            .where(eq(gmaEntityDiscards.partyId, partyId))
            .all() as any[]
        ).map((d) => d.entityId),
      );
      const entities = rows
        .filter((e) => !e.type || !NON_NPC_ENTITY_TYPES.has(e.type))
        .filter((e) => !hiddenEntityIds.has(e.entity_id))
        .map((e) => {
          const l = visibleLinks.get(e.entity_id) ?? null;
          const sessions = (appearances.get(e.entity_id) ?? [])
            .filter((sid) => ordinalById.has(sid))
            .sort((a, b) => ordinalById.get(a)! - ordinalById.get(b)!)
            .map((sid) => {
              const s = sessById.get(sid)!;
              return {
                id: sid,
                ordinal: ordinalById.get(sid)!,
                title: s.title,
                playedAt: s.played_at ?? null,
              };
            });
          return {
            id: e.entity_id,
            name: e.name,
            description: e.description ?? null,
            type: e.type ?? null,
            sessions,
            discarded: discardedIds.has(e.entity_id),
            linkedNpc: l
              ? {
                  id: l.npc_id,
                  name: l.npc_name,
                  linkedByUserId: l.linked_by_user_id,
                  linkedByName: l.linker_name ?? '',
                  linkedAt: l.created_at,
                  lastPullAt: l.last_pull_at ?? null,
                  textPulled: !!l.description_hash,
                  descriptionUpdated:
                    !!l.description_hash &&
                    l.description_hash !== sha256Hex(String(e.description ?? '')),
                }
              : null,
          };
        });
      return reply.send({
        entities,
        campaignTitle: link.campaign_title,
        fetchedAt,
        stale,
      });
    },
  );

  /** Import: create the shared NPC from the entity + link, in one gesture. */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/import',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      const entity = await resolveEntity(partyId, link, String(req.params.entityId));
      if (!entity) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_entity'),
          message: apiMsg(
            req,
            'Entrée GM Assistant inconnue — actualise la liste des PNJ repérés.',
          ),
        });
      }
      if (
        getDrizzle()
          .select({ id: gmaNpcLinks.id })
          .from(gmaNpcLinks)
          .where(eq(gmaNpcLinks.gmaEntityId, entity.entity_id))
          .get()
      ) {
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      const description = entity.description ?? null;
      const now = nowIso();
      const drizzle = getDrizzle();
      let npcId: number;
      try {
        npcId = getDb().transaction(() => {
          const maxOrder =
            (
              drizzle
                .select({ m: sql<number | null>`max(${npcs.sortOrder})` })
                .from(npcs)
                .where(eq(npcs.partyId, partyId))
                .get() as any
            )?.m ?? 0;
          const { id } = drizzle
            .insert(npcs)
            .values({
              partyId,
              createdBy: userId,
              name: entity.name,
              description,
              // The table's defaults would read 'neutral' — an assistant-
              // catalogued NPC is met, not judged
              disposition: 'unknown',
              isShared: 1,
              allowMemberEdit: 0,
              sortOrder: maxOrder + 1,
            })
            .returning({ id: npcs.id })
            .get();
          drizzle
            .insert(gmaNpcLinks)
            .values({
              partyId,
              npcId: id,
              gmaEntityId: entity.entity_id,
              linkedByUserId: userId,
              descriptionHash: description ? sha256Hex(description) : null,
              lastPullAt: now,
            })
            .run();
          return id;
        })();
      } catch {
        // UNIQUE backstop on a concurrent import of the same entity.
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      emitGma(partyId, userId, 'entity');
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'custom-item',
        actorUserId: userId,
      });
      const row = drizzle
        .select({ ...cols(npcs), creator_name: users.displayName })
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(eq(npcs.id, npcId))
        .get();
      return reply.code(201).send({ npc: mapNpc(row, false), entityId: entity.entity_id });
    },
  );

  /** Link an entity to an NPC already in the registry — content untouched
   *  unless appendDescription is asked for (and the actor may edit the NPC). */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/link',
    async (
      req: FastifyRequest<{
        Params: { partyId: string; entityId: string };
        Body: GmaLinkEntityPayload;
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      const entity = await resolveEntity(partyId, link, String(req.params.entityId));
      if (!entity) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_entity'),
          message: apiMsg(
            req,
            'Entrée GM Assistant inconnue — actualise la liste des PNJ repérés.',
          ),
        });
      }
      const npcId = Number(req.body?.npcId);
      const npc = Number.isInteger(npcId)
        ? (getDrizzle()
            .select(cols(npcs))
            .from(npcs)
            .where(and(eq(npcs.id, npcId), eq(npcs.partyId, partyId)))
            .get() as any)
        : null;
      const gm = isPartyGM(partyId, userId);
      // 404 (not 403) on an invisible NPC — never confirm someone's private row
      if (!npc || !npcVisibleToUser(npc, userId, gm)) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_npc'),
          message: apiMsg(req, 'PNJ introuvable dans le registre de ce groupe.'),
        });
      }
      const wantAppend = req.body?.appendDescription === true && !!entity.description;
      if (wantAppend && !mayEditNpcContent(npc, userId, gm)) {
        return reply.code(403).send({
          error: apiMsg(req, 'cannot_append'),
          message: apiMsg(
            req,
            'Seuls le créateur, le MD ou un éditeur autorisé peuvent modifier la description. Tu peux lier sans l’ajouter, ou leur demander.',
          ),
        });
      }
      const drizzle = getDrizzle();
      // Entity-side 1:1 only — several entities may reconcile onto the same
      // NPC (GMA re-catalogues the same person per session), so an existing
      // link on the TARGET npc is fine and adds a second row.
      if (
        drizzle
          .select({ id: gmaNpcLinks.id })
          .from(gmaNpcLinks)
          .where(eq(gmaNpcLinks.gmaEntityId, entity.entity_id))
          .get()
      ) {
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      const now = nowIso();
      try {
        getDb().transaction(() => {
          drizzle
            .insert(gmaNpcLinks)
            .values({
              partyId,
              npcId: npc.id,
              gmaEntityId: entity.entity_id,
              linkedByUserId: userId,
              descriptionHash: wantAppend ? sha256Hex(String(entity.description)) : null,
              lastPullAt: wantAppend ? now : null,
            })
            .run();
          if (wantAppend) {
            drizzle
              .update(npcs)
              .set({
                description: appendedDescription(npc.description, String(entity.description)),
              })
              .where(eq(npcs.id, npc.id))
              .run();
          }
        })();
      } catch {
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      emitGma(partyId, userId, 'entity');
      if (wantAppend) {
        bus.emitChange({
          type: 'party:change',
          partyId,
          action: 'custom-item',
          actorUserId: userId,
        });
      }
      const row = drizzle
        .select({ ...cols(npcs), creator_name: users.displayName })
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(eq(npcs.id, npc.id))
        .get();
      return reply
        .code(201)
        .send({ npc: mapNpc(row, gm), appended: wantAppend, entityId: entity.entity_id });
    },
  );

  /** Pull: re-take GMA's description into the NPC (replace, or append). */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/pull',
    async (
      req: FastifyRequest<{
        Params: { partyId: string; entityId: string };
        Body: GmaPullEntityPayload;
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const partyLink = getPartyLink(partyId);
      const linkRow = getDrizzle()
        .select(cols(gmaNpcLinks))
        .from(gmaNpcLinks)
        .where(eq(gmaNpcLinks.gmaEntityId, String(req.params.entityId)))
        .get() as any;
      if (!linkRow || linkRow.party_id !== partyId) {
        return reply.code(404).send({
          error: apiMsg(req, 'no_link'),
          message: apiMsg(req, 'Cette entrée GM Assistant n’est pas liée au registre.'),
        });
      }
      const entity = await resolveEntity(partyId, partyLink, linkRow.gma_entity_id);
      if (!entity) {
        return reply.code(404).send({
          error: apiMsg(req, 'entity_gone'),
          message: apiMsg(
            req,
            'Cette entrée n’existe plus chez GM Assistant — délie le PNJ pour retirer le badge.',
          ),
        });
      }
      const npc = getDrizzle()
        .select(cols(npcs))
        .from(npcs)
        .where(eq(npcs.id, linkRow.npc_id))
        .get() as any;
      if (!npc) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_npc'),
          message: apiMsg(req, 'PNJ introuvable dans le registre de ce groupe.'),
        });
      }
      const gm = isPartyGM(partyId, userId);
      if (!mayEditNpcContent(npc, userId, gm)) {
        return reply.code(403).send({
          error: apiMsg(req, 'cannot_edit'),
          message: apiMsg(
            req,
            'Seuls le créateur, le MD ou un éditeur autorisé peuvent modifier la description.',
          ),
        });
      }
      const gmaText = String(entity.description ?? '').trim();
      if (!gmaText) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_description'),
          message: apiMsg(req, 'GM Assistant n’a pas de description pour ce PNJ.'),
        });
      }
      const append = req.body?.append === true;
      const now = nowIso();
      const drizzle = getDrizzle();
      getDb().transaction(() => {
        drizzle
          .update(npcs)
          .set({
            description: append ? appendedDescription(npc.description, gmaText) : gmaText,
          })
          .where(eq(npcs.id, npc.id))
          .run();
        drizzle
          .update(gmaNpcLinks)
          .set({ descriptionHash: sha256Hex(gmaText), lastPullAt: now })
          .where(eq(gmaNpcLinks.id, linkRow.id))
          .run();
      })();
      emitGma(partyId, userId, 'entity');
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'custom-item',
        actorUserId: userId,
      });
      const row = drizzle
        .select({ ...cols(npcs), creator_name: users.displayName })
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(eq(npcs.id, npc.id))
        .get();
      return reply.send({ npc: mapNpc(row, gm), appended: append, entityId: entity.entity_id });
    },
  );

  /** Unlink: drop the badge, keep the NPC — GM, NPC creator, or the linker. */
  app.delete(
    '/parties/:partyId/gma/entities/:entityId/link',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const linkRow = getDrizzle()
        .select(cols(gmaNpcLinks))
        .from(gmaNpcLinks)
        .where(eq(gmaNpcLinks.gmaEntityId, String(req.params.entityId)))
        .get() as any;
      if (!linkRow || linkRow.party_id !== partyId) {
        return reply.code(404).send({
          error: apiMsg(req, 'no_link'),
          message: apiMsg(req, 'Cette entrée GM Assistant n’est pas liée au registre.'),
        });
      }
      const npc = getDrizzle()
        .select(cols(npcs))
        .from(npcs)
        .where(eq(npcs.id, linkRow.npc_id))
        .get() as any;
      const gm = isPartyGM(partyId, userId);
      const mayUnlink =
        gm || (npc && npc.created_by === userId) || linkRow.linked_by_user_id === userId;
      if (!mayUnlink) {
        return reply.code(403).send({
          error: apiMsg(req, 'cannot_unlink'),
          message: apiMsg(
            req,
            'Seuls le MD, le créateur du PNJ ou celui qui a lié peuvent délier.',
          ),
        });
      }
      getDrizzle().delete(gmaNpcLinks).where(eq(gmaNpcLinks.id, linkRow.id)).run();
      emitGma(partyId, userId, 'entity');
      return reply.send({ ok: true });
    },
  );

  /** Discard: hide a useless entity from the rail, party-wide. Local-only —
   *  GMA keeps its entity; the discard outlives every cache refresh, and any
   *  member may undo it below. */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/discard',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      if (!getPartyLink(partyId)) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      // No cache lookup on purpose: discards reference GMA ids that must keep
      // working across cache replaces — the id arrives from the GET we serve.
      getDrizzle()
        .insert(gmaEntityDiscards)
        .values({
          partyId,
          entityId: String(req.params.entityId),
          discardedByUserId: userId,
        })
        .onConflictDoNothing()
        .run();
      emitGma(partyId, userId, 'entity');
      return reply.code(201).send({ ok: true });
    },
  );

  /** Restore: bring a discarded entity back on the rail. */
  app.delete(
    '/parties/:partyId/gma/entities/:entityId/discard',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      if (!getPartyLink(partyId)) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      getDrizzle()
        .delete(gmaEntityDiscards)
        .where(
          and(
            eq(gmaEntityDiscards.partyId, partyId),
            eq(gmaEntityDiscards.entityId, String(req.params.entityId)),
          ),
        )
        .run();
      emitGma(partyId, userId, 'entity');
      return reply.send({ ok: true });
    },
  );
}
