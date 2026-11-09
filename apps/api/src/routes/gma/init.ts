/**
 * GM Assistant — init one-shot (phase 4e, déplacement pur depuis
 * routes/gma.ts, corps verbatim) : crée la campagne GMA DEPUIS le groupe
 * (campagne + personnages sélectionnés, cachés exclus), pose le lien et
 * journalise les échecs par personnage (clé fatale → arrêt du lot).
 */

import type { GmaInitPayload } from '@table-sync/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { gmaPcLinks, parties, partyGmaLinks, userGmaLinks } from '../../db/schema.ts';
import { GmaError, gmaErrorToResponse, gmaRequest } from '../../gma/client.ts';
import { apiMsg } from '../messages.ts';
import { requireUser } from '../lib/membership.ts';
import {
  decryptUserKey,
  desiredPc,
  emitGma,
  getPartyLink,
  getUserKeyRow,
  loadPartyCharacters,
  noteScope,
  requirePartyGM,
} from './shared.ts';

export async function initRoutes(app: FastifyInstance) {
  // =================== Init — create the campaign FROM the group ===================

  app.post(
    '/parties/:partyId/gma/init',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: GmaInitPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      if (getPartyLink(partyId)) {
        return reply.code(409).send({
          error: apiMsg(req, 'already_linked'),
          message: apiMsg(req, 'Ce groupe est déjà lié à une campagne GM Assistant.'),
        });
      }
      const key = decryptUserKey(getUserKeyRow(userId));
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Enregistre d’abord ta clé GM Assistant ci-dessus.'),
        });
      }
      const party = getDrizzle()
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.id, partyId))
        .get() as any;
      if (!party) {
        return reply
          .code(404)
          .send({ error: apiMsg(req, 'not_found'), message: apiMsg(req, 'Groupe introuvable.') });
      }
      const requested = Array.isArray(req.body?.characterIds)
        ? new Set(req.body.characterIds.filter((n: unknown) => Number.isInteger(n)))
        : new Set<number>();
      // Hidden (secret prep) characters stay off GM Assistant — syncing them
      // would defeat the secrecy. The GM unhides first if they want one in.
      const selected = loadPartyCharacters(partyId).filter((c) => requested.has(c.id) && !c.hidden);

      let campaign: any;
      try {
        campaign = await gmaRequest<any>(key, 'POST', '/campaigns', {
          body: {
            title: party.name,
            ttrpg_system: 'dungeons and dragons',
            ttrpg_system_edition: '5e',
          },
        });
      } catch (err) {
        noteScope(userId, err);
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
      getDrizzle()
        .update(userGmaLinks)
        .set({ scope: 'full_access' })
        .where(eq(userGmaLinks.userId, userId))
        .run();

      const created: any[] = [];
      const failed: any[] = [];
      for (const char of selected) {
        try {
          const pc = await gmaRequest<any>(
            key,
            'POST',
            `/campaigns/${campaign.id}/player-characters`,
            { body: desiredPc(char) },
          );
          getDrizzle()
            .insert(gmaPcLinks)
            .values({
              partyId,
              characterId: char.id,
              gmaPcId: String(pc.id),
              nameAtSync: char.name,
            })
            .run();
          created.push({
            characterId: char.id,
            name: char.name,
            playedBy: char.owner_name,
            gmaPcId: String(pc.id),
          });
        } catch (err) {
          failed.push({
            name: char.name,
            reason: err instanceof GmaError ? err.message : 'GM Assistant est injoignable',
          });
          // Key-level failures (auth/scope/rate) would fail every remaining
          // call identically — stop the batch and report.
          if (err instanceof GmaError && [401, 403, 429].includes(err.status)) break;
        }
      }

      getDrizzle()
        .insert(partyGmaLinks)
        .values({
          partyId,
          gmaCampaignId: String(campaign.id),
          campaignTitle: String(campaign.title ?? party.name),
          linkedByUserId: userId,
        })
        .run();
      emitGma(partyId, userId, 'init');
      return reply.code(201).send({
        campaign: { id: String(campaign.id), title: String(campaign.title ?? party.name) },
        created,
        failed,
      });
    },
  );
}
