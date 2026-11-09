/**
 * Quêtes du MD — registre à cycle de vie (préparation/active/terminée/échouée),
 * GM-only. Découpage 2026-11 (phase 4) : déplacement pur depuis
 * routes/campaign.ts.
 */

import type { CreateDmQuestPayload, DmQuestStatus, PatchDmQuestPayload } from '@table-sync/shared';
import { DM_QUEST_STATUSES } from '@table-sync/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { dmQuests } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
import { MAX_TITLE_LEN, getCampaignRowForGM, gmGuard, mapQuest, nextSort } from './shared.ts';

export async function questsRoutes(app: FastifyInstance) {
  // ---------- Quests (lifecycle register) ----------

  app.post(
    '/parties/:partyId/dm-quests',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateDmQuestPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body || ({} as CreateDmQuestPayload);
      const title = body.title?.trim();
      if (!title || title.length > MAX_TITLE_LEN) {
        return reply.code(400).send({ error: apiMsg(req, 'title is required') });
      }
      const status: DmQuestStatus = body.status ?? 'preparation';
      if (!DM_QUEST_STATUSES.includes(status)) {
        return reply.code(400).send({ error: apiMsg(req, 'invalid status') });
      }

      const drizzle = getDrizzle();
      const row = drizzle
        .insert(dmQuests)
        .values({
          partyId,
          title,
          body: body.body?.trim() || null,
          status,
          sortOrder: nextSort(drizzle, dmQuests, partyId),
        })
        .returning(cols(dmQuests))
        .get();
      bus.emitChange({ type: 'campaign:change', partyId, action: 'quest', actorUserId: userId });
      return reply.code(201).send({ quest: mapQuest(row) });
    },
  );

  app.patch(
    '/dm-quests/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchDmQuestPayload }>,
      reply: FastifyReply,
    ) => {
      const ctx = getCampaignRowForGM(
        req,
        reply,
        dmQuests,
        Number(req.params.id),
        'quest not found',
      );
      if (ctx === null) return;
      const { userId, row: quest, drizzle } = ctx;

      const body = req.body || ({} as PatchDmQuestPayload);
      const values: Record<string, unknown> = {};
      if (body.title !== undefined) {
        const title = body.title?.trim();
        if (!title || title.length > MAX_TITLE_LEN) {
          return reply.code(400).send({ error: apiMsg(req, 'title is required') });
        }
        values.title = title;
      }
      if (body.body !== undefined) {
        values.body = body.body === null ? null : String(body.body);
      }
      if (body.status !== undefined) {
        if (!DM_QUEST_STATUSES.includes(body.status)) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid status') });
        }
        values.status = body.status;
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      values.updatedAt = sql`datetime('now')`;
      drizzle.update(dmQuests).set(values).where(eq(dmQuests.id, quest.id)).run();
      const updated = drizzle
        .select(cols(dmQuests))
        .from(dmQuests)
        .where(eq(dmQuests.id, quest.id))
        .get();
      bus.emitChange({
        type: 'campaign:change',
        partyId: quest.party_id,
        action: 'quest',
        actorUserId: userId,
      });
      return reply.send({ quest: mapQuest(updated) });
    },
  );

  app.delete(
    '/dm-quests/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const ctx = getCampaignRowForGM(
        req,
        reply,
        dmQuests,
        Number(req.params.id),
        'quest not found',
      );
      if (ctx === null) return;
      const { userId, row: quest, drizzle } = ctx;

      drizzle.delete(dmQuests).where(eq(dmQuests.id, quest.id)).run();
      bus.emitChange({
        type: 'campaign:change',
        partyId: quest.party_id,
        action: 'quest',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
