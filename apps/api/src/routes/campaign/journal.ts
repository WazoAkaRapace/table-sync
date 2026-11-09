/**
 * Journal de campagne — journal de table partagé (tout membre) et note
 * privée par personnage/jour (owner-or-GM, aucune diffusion). Découpage
 * 2026-11 (phase 4) : déplacement pur depuis routes/campaign.ts.
 */

import type { PutCampaignDayNotePayload, PutCampaignTableNotePayload } from '@table-sync/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { campaignDayNotes, campaignDays, characters } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { isOwnerOrGM, requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
import { MAX_DAY, MAX_TABLE_NOTE_LEN, mapDay, memberGuard } from './shared.ts';

export async function journalRoutes(app: FastifyInstance) {
  // ---------- Journal de table (partagé, tout membre) ----------

  app.put(
    '/parties/:partyId/campaign/table-note',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: PutCampaignTableNotePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!memberGuard(req, reply, partyId, userId)) return;

      const body = (req.body ?? {}) as PutCampaignTableNotePayload;
      const day = Number(body.day);
      if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) {
        return reply.code(400).send({ error: apiMsg(req, 'day out of range') });
      }
      if (typeof body.note !== 'string' || body.note.length > MAX_TABLE_NOTE_LEN) {
        return reply.code(400).send({ error: apiMsg(req, 'invalid note') });
      }
      const note = body.note.trim() || null;
      // Éditer un jour < state.day corrige l'historique, un jour > state.day
      // planifie — les deux sont légitimes (même grammaire que le registre MD).
      // La météo et la note MD de la ligne existante restent intactes.
      const drizzle = getDrizzle();
      drizzle
        .insert(campaignDays)
        .values({ partyId, day, tableNote: note })
        .onConflictDoUpdate({
          target: [campaignDays.partyId, campaignDays.day],
          set: { tableNote: note },
        })
        .run();
      const row = drizzle
        .select(cols(campaignDays))
        .from(campaignDays)
        .where(and(eq(campaignDays.partyId, partyId), eq(campaignDays.day, day)))
        .get() as any;
      bus.emitChange({
        type: 'campaign:change',
        partyId,
        action: 'calendar',
        actorUserId: userId,
      });
      return reply.send({ day: mapDay(row) });
    },
  );

  // ---------- Note privée par personnage/jour (owner-or-GM) ----------

  app.get(
    '/parties/:partyId/campaign/day-note',
    async (
      req: FastifyRequest<{
        Params: { partyId: string };
        Querystring: { characterId?: string; day?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!memberGuard(req, reply, partyId, userId)) return;

      const query = (req.query ?? {}) as { characterId?: string; day?: string };
      const characterId = Number(query.characterId);
      const day = Number(query.day);
      if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) {
        return reply.code(400).send({ error: apiMsg(req, 'day out of range') });
      }
      const char = getDrizzle()
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, characterId))
        .get() as any;
      if (!char || char.party_id !== partyId) {
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au propriétaire ou au MD') });
      }
      const row = getDrizzle()
        .select(cols(campaignDayNotes))
        .from(campaignDayNotes)
        .where(
          and(
            eq(campaignDayNotes.partyId, partyId),
            eq(campaignDayNotes.characterId, characterId),
            eq(campaignDayNotes.day, day),
          ),
        )
        .get() as any;
      return reply.send({ note: row?.note ?? null });
    },
  );

  app.put(
    '/parties/:partyId/campaign/day-note',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: PutCampaignDayNotePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!memberGuard(req, reply, partyId, userId)) return;

      const body = (req.body ?? {}) as PutCampaignDayNotePayload;
      const characterId = Number(body.characterId);
      const day = Number(body.day);
      if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) {
        return reply.code(400).send({ error: apiMsg(req, 'day out of range') });
      }
      const char = getDrizzle()
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, characterId))
        .get() as any;
      if (!char || char.party_id !== partyId) {
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au propriétaire ou au MD') });
      }
      if (typeof body.note !== 'string' || body.note.length > MAX_TABLE_NOTE_LEN) {
        return reply.code(400).send({ error: apiMsg(req, 'invalid note') });
      }
      const note = body.note.trim() || null;
      // Note privée : aucun broadcast party-wide — la réponse API suffit et
      // l'invalidation est locale au propriétaire.
      const drizzle = getDrizzle();
      if (note === null) {
        drizzle
          .delete(campaignDayNotes)
          .where(
            and(
              eq(campaignDayNotes.partyId, partyId),
              eq(campaignDayNotes.characterId, characterId),
              eq(campaignDayNotes.day, day),
            ),
          )
          .run();
        return reply.send({ note: null });
      }
      drizzle
        .insert(campaignDayNotes)
        .values({ partyId, characterId, day, note, updatedAt: sql`datetime('now')` })
        .onConflictDoUpdate({
          target: [campaignDayNotes.partyId, campaignDayNotes.characterId, campaignDayNotes.day],
          set: { note, updatedAt: sql`datetime('now')` },
        })
        .run();
      return reply.send({ note });
    },
  );
}
