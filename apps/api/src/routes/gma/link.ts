/**
 * GM Assistant — lien groupe ↔ campagne GMA (phase 4e, déplacement pur
 * depuis routes/gma.ts, corps verbatim) : lecture du lien, picker des
 * campagnes du MD appelant, création (campagne existante) et déliaison
 * totale (purge de tout le cache GMA du groupe).
 */

import type { GmaLinkCampaignPayload } from '@table-sync/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import {
  gmaEntities,
  gmaEntityDiscards,
  gmaEntitySessions,
  gmaMoments,
  gmaNpcLinks,
  gmaPcLinks,
  gmaRecaps,
  gmaSessions,
  partyGmaLinks,
} from '../../db/schema.ts';
import { gmaErrorToResponse, gmaListAll, gmaRequest } from '../../gma/client.ts';
import { apiMsg } from '../messages.ts';
import { isPartyMember, requireUser } from '../helpers.ts';
import {
  UUID_RE,
  decryptUserKey,
  emitGma,
  getPartyLink,
  getUserKeyRow,
  requirePartyGM,
} from './shared.ts';

export async function linkRoutes(app: FastifyInstance) {
  // =================== Party link ===================

  app.get(
    '/parties/:partyId/gma/link',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
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
      if (!link) return reply.send({ linked: false, campaign: null, accountOk: false });
      return reply.send({
        linked: true,
        campaign: {
          id: link.gma_campaign_id,
          title: link.campaign_title,
          linkedAt: link.created_at,
        },
        accountOk: !!decryptUserKey(getUserKeyRow(link.linked_by_user_id)),
      });
    },
  );

  app.get(
    '/parties/:partyId/gma/campaigns',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      const key = decryptUserKey(getUserKeyRow(userId));
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Enregistre d’abord ta clé GM Assistant ci-dessus.'),
        });
      }
      try {
        const list = await gmaListAll<any>(key, '/campaigns', { limit: '500' });
        return reply.send({
          campaigns: list.map((c) => ({
            id: String(c.id),
            title: String(c.title ?? 'Sans titre'),
            createdAt: c.created_at ?? null,
            updatedAt: c.updated_at ?? null,
          })),
        });
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
    },
  );

  app.post(
    '/parties/:partyId/gma/link',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: GmaLinkCampaignPayload }>,
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
      const { campaignId } = req.body || { campaignId: '' };
      if (typeof campaignId !== 'string' || !UUID_RE.test(campaignId)) {
        return reply.code(400).send({
          error: apiMsg(req, 'invalid_campaign'),
          message: apiMsg(req, 'Identifiant de campagne invalide.'),
        });
      }
      let campaign: any;
      try {
        campaign = await gmaRequest<any>(key, 'GET', `/campaigns/${campaignId}`, {
          query: { fields: 'id,title' },
        });
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
      try {
        getDrizzle()
          .insert(partyGmaLinks)
          .values({
            partyId,
            gmaCampaignId: campaignId,
            campaignTitle: String(campaign?.title ?? campaignId),
            linkedByUserId: userId,
          })
          .run();
      } catch {
        // UNIQUE hit: the campaign belongs to another group (or a concurrent link).
        return reply.code(409).send({
          error: apiMsg(req, 'campaign_taken'),
          message: apiMsg(req, 'Cette campagne GM Assistant est déjà liée à un autre groupe.'),
        });
      }
      emitGma(partyId, userId, 'link');
      return reply.code(201).send({
        ok: true,
        campaign: { id: campaignId, title: String(campaign?.title ?? campaignId) },
      });
    },
  );

  app.delete(
    '/parties/:partyId/gma/link',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      if (!getPartyLink(partyId)) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
        });
      }
      getDb().transaction(() => {
        const drizzle = getDrizzle();
        drizzle.delete(partyGmaLinks).where(eq(partyGmaLinks.partyId, partyId)).run();
        drizzle.delete(gmaSessions).where(eq(gmaSessions.partyId, partyId)).run();
        drizzle.delete(gmaRecaps).where(eq(gmaRecaps.partyId, partyId)).run();
        drizzle.delete(gmaMoments).where(eq(gmaMoments.partyId, partyId)).run();
        drizzle.delete(gmaPcLinks).where(eq(gmaPcLinks.partyId, partyId)).run();
        drizzle.delete(gmaEntities).where(eq(gmaEntities.partyId, partyId)).run();
        drizzle.delete(gmaEntitySessions).where(eq(gmaEntitySessions.partyId, partyId)).run();
        drizzle.delete(gmaEntityDiscards).where(eq(gmaEntityDiscards.partyId, partyId)).run();
        // CASCADE would drop these with the party anyway — explicit keeps the
        // purge total even if a future schema change relaxes the FK.
        drizzle.delete(gmaNpcLinks).where(eq(gmaNpcLinks.partyId, partyId)).run();
      })();
      emitGma(partyId, userId, 'unlink');
      return reply.send({ ok: true });
    },
  );
}
