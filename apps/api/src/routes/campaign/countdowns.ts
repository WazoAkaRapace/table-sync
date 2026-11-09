/**
 * Rebours de campagne — cible = jour ABSOLU (l'affichage « J−N » est dérivé),
 * GM-only. Découpage 2026-11 (phase 4) : déplacement pur depuis
 * routes/campaign.ts.
 */

import type {
  CreateCampaignCountdownPayload,
  PatchCampaignCountdownPayload,
} from '@table-sync/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { campaignCountdowns } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
import { MAX_DAY, MAX_LABEL_LEN, getCampaignRowForGM, gmGuard, mapCountdown } from './shared.ts';

export async function countdownsRoutes(app: FastifyInstance) {
  // ---------- Countdowns ----------

  app.post(
    '/parties/:partyId/campaign/countdowns',
    async (
      req: FastifyRequest<{
        Params: { partyId: string };
        Body: CreateCampaignCountdownPayload;
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body || ({} as CreateCampaignCountdownPayload);
      const label = body.label?.trim();
      if (!label || label.length > MAX_LABEL_LEN) {
        return reply.code(400).send({ error: apiMsg(req, 'label is required') });
      }
      const targetDay = Number(body.targetDay);
      if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > MAX_DAY) {
        return reply.code(400).send({ error: apiMsg(req, 'target day out of range') });
      }

      const row = getDrizzle()
        .insert(campaignCountdowns)
        .values({ partyId, label, targetDay })
        .returning(cols(campaignCountdowns))
        .get();
      bus.emitChange({
        type: 'campaign:change',
        partyId,
        action: 'countdown',
        actorUserId: userId,
      });
      return reply.code(201).send({ countdown: mapCountdown(row) });
    },
  );

  app.patch(
    '/campaign-countdowns/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchCampaignCountdownPayload }>,
      reply: FastifyReply,
    ) => {
      const ctx = getCampaignRowForGM(
        req,
        reply,
        campaignCountdowns,
        Number(req.params.id),
        'countdown not found',
      );
      if (ctx === null) return;
      const { userId, row, drizzle } = ctx;

      const body = req.body || ({} as PatchCampaignCountdownPayload);
      const values: Record<string, unknown> = {};
      if (body.label !== undefined) {
        const label = body.label?.trim();
        if (!label || label.length > MAX_LABEL_LEN) {
          return reply.code(400).send({ error: apiMsg(req, 'label is required') });
        }
        values.label = label;
      }
      if (body.targetDay !== undefined) {
        const targetDay = Number(body.targetDay);
        if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > MAX_DAY) {
          return reply.code(400).send({ error: apiMsg(req, 'target day out of range') });
        }
        values.targetDay = targetDay;
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      drizzle.update(campaignCountdowns).set(values).where(eq(campaignCountdowns.id, row.id)).run();
      const updated = drizzle
        .select(cols(campaignCountdowns))
        .from(campaignCountdowns)
        .where(eq(campaignCountdowns.id, row.id))
        .get();
      bus.emitChange({
        type: 'campaign:change',
        partyId: row.party_id,
        action: 'countdown',
        actorUserId: userId,
      });
      return reply.send({ countdown: mapCountdown(updated) });
    },
  );

  app.delete(
    '/campaign-countdowns/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const ctx = getCampaignRowForGM(
        req,
        reply,
        campaignCountdowns,
        Number(req.params.id),
        'countdown not found',
      );
      if (ctx === null) return;
      const { userId, row, drizzle } = ctx;

      drizzle.delete(campaignCountdowns).where(eq(campaignCountdowns.id, row.id)).run();
      bus.emitChange({
        type: 'campaign:change',
        partyId: row.party_id,
        action: 'countdown',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
