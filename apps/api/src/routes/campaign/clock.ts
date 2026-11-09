/**
 * Horloge de campagne — carnet entier en un appel, avance du jour
 * (calendrier partagé #159), lecture du calendrier, correction
 * jour/saison/météo et retouche a posteriori du registre des jours passés.
 * Découpage 2026-11 (phase 4) : déplacement pur depuis routes/campaign.ts.
 */

import type {
  AdvanceCampaignPayload,
  CampaignCalendarDay,
  PatchCampaignDayPayload,
  PatchCampaignStatePayload,
} from '@table-sync/shared';
import { CAMPAIGN_SEASONS } from '@table-sync/shared';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import {
  campaignCountdowns,
  campaignDays,
  campaignState,
  dmNotes,
  dmQuests,
} from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { isPartyGM, isPartyMember, requireUser } from '../helpers.ts';
import { apiMsg } from '../messages.ts';
import {
  type Drizzle,
  DAYS_LEDGER_LIMIT,
  CALENDAR_RANGE_LIMIT,
  MAX_DAY,
  MAX_NOTE_LEN,
  MAX_WEATHER_LEN,
  ensureCampaignState,
  gmGuard,
  mapCountdown,
  mapDay,
  mapNote,
  mapQuest,
  mapState,
  memberGuard,
} from './shared.ts';

/** Freeze the current day into the ledger — only when the MD noted something:
 *  un jour sans météo NI note n'a rien à dire au registre, et les sauts
 *  multi-jours ne le rempliraient que de lignes vides (upsert on conflict so
 *  a corrected day overwrites rather than duplicates). */
function archiveCurrentDay(drizzle: Drizzle, partyId: number, state: any): void {
  const weather = state.weather ?? null;
  const note = state.note ?? null;
  if (!weather && !note) return;
  drizzle
    .insert(campaignDays)
    .values({ partyId, day: state.day, weather, note })
    .onConflictDoUpdate({
      target: [campaignDays.partyId, campaignDays.day],
      set: { weather, note },
    })
    .run();
}

function cleanOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.slice(0, maxLength);
}

// ---------- Routes ----------

export async function clockRoutes(app: FastifyInstance) {
  // ---------- The whole carnet in one call ----------
  app.get(
    '/parties/:partyId/campaign',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const drizzle = getDrizzle();
      const state = ensureCampaignState(drizzle, partyId);
      const [countdowns, days, notes, quests] = [
        drizzle
          .select(cols(campaignCountdowns))
          .from(campaignCountdowns)
          .where(eq(campaignCountdowns.partyId, partyId))
          .orderBy(asc(campaignCountdowns.targetDay), asc(campaignCountdowns.id))
          .all(),
        drizzle
          .select(cols(campaignDays))
          .from(campaignDays)
          .where(eq(campaignDays.partyId, partyId))
          .orderBy(desc(campaignDays.day))
          .limit(DAYS_LEDGER_LIMIT)
          .all(),
        drizzle
          .select(cols(dmNotes))
          .from(dmNotes)
          .where(eq(dmNotes.partyId, partyId))
          .orderBy(asc(dmNotes.sortOrder), asc(dmNotes.createdAt))
          .all(),
        drizzle
          .select(cols(dmQuests))
          .from(dmQuests)
          .where(eq(dmQuests.partyId, partyId))
          .orderBy(asc(dmQuests.sortOrder), asc(dmQuests.createdAt))
          .all(),
      ];

      return reply.send({
        campaign: {
          state: mapState(state),
          countdowns: countdowns.map(mapCountdown),
          days: days.map(mapDay),
          notes: notes.map(mapNote),
          quests: quests.map(mapQuest),
        },
      });
    },
  );

  // ---------- Advance the clock (+1 day, or a bounded jump) ----------
  app.post(
    '/parties/:partyId/campaign/advance',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: AdvanceCampaignPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      // #159 — calendrier partagé : TOUT membre avance le jour (le MD garde
      // la correction libre et les autres molettes via PATCH /campaign).
      if (!memberGuard(req, reply, partyId, userId)) return;
      const body = req.body || ({} as AdvanceCampaignPayload);
      const steps = body.steps === undefined ? 1 : Number(body.steps);
      if (!Number.isInteger(steps) || steps < 1 || steps > 30) {
        return reply.code(400).send({ error: apiMsg(req, 'steps must be 1-30') });
      }

      const drizzle = getDrizzle();
      const state = ensureCampaignState(drizzle, partyId);
      const newDay = Math.min(state.day + steps, MAX_DAY);
      // Le jour qui s'achève est figé avec sa météo et son journal ; le
      // nouveau jour démarre clair — SAUF s'il avait été pré-écrit en avance
      // (#191) : sa ligne au registre nourrit alors l'horloge (météo + note
      // MD), sinon l'avance la masquait à la zone MD du jour courant puis
      // l'upsert d'archivage l'écrasait avec une horloge vide.
      getDb().transaction(() => {
        archiveCurrentDay(drizzle, partyId, state);
        const prewritten = drizzle
          .select(cols(campaignDays))
          .from(campaignDays)
          .where(and(eq(campaignDays.partyId, partyId), eq(campaignDays.day, newDay)))
          .get() as any;
        drizzle
          .update(campaignState)
          .set({
            day: newDay,
            weather: prewritten?.weather ?? null,
            note: prewritten?.note ?? null,
            updatedAt: sql`datetime('now')`,
          })
          .where(eq(campaignState.partyId, partyId))
          .run();
      })();

      const updated = drizzle
        .select(cols(campaignState))
        .from(campaignState)
        .where(eq(campaignState.partyId, partyId))
        .get();
      bus.emitChange({ type: 'campaign:change', partyId, action: 'calendar', actorUserId: userId });
      return reply.send({ state: mapState(updated) });
    },
  );

  // ---------- Calendrier partagé (#159) : lecture pour tout membre ----------

  app.get(
    '/parties/:partyId/campaign/calendar',
    async (
      req: FastifyRequest<{
        Params: { partyId: string };
        Querystring: { from?: string; to?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      const isGM = isPartyMember(partyId, userId) && isPartyGM(partyId, userId);
      if (!memberGuard(req, reply, partyId, userId)) return;

      const query = (req.query ?? {}) as { from?: string; to?: string };
      const state = ensureCampaignState(getDrizzle(), partyId);
      const from = query.from === undefined ? state.day : Number(query.from);
      const to = query.to === undefined ? state.day : Number(query.to);
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        to < from ||
        to - from + 1 > CALENDAR_RANGE_LIMIT ||
        to > MAX_DAY
      ) {
        return reply.code(400).send({ error: apiMsg(req, 'day out of range') });
      }

      const days = getDrizzle()
        .select(cols(campaignDays))
        .from(campaignDays)
        .where(
          and(
            eq(campaignDays.partyId, partyId),
            gte(campaignDays.day, from),
            lte(campaignDays.day, to),
          ),
        )
        .orderBy(asc(campaignDays.day))
        .all();
      const calendarDays: CampaignCalendarDay[] = days.map((row: any) => ({
        day: row.day,
        weather: row.weather ?? null,
        tableNote: row.table_note ?? null,
        // La note MD (colonne `note`) n'existe que pour le MD — un joueur
        // ne voit jamais le journal privé du MD.
        dmNote: isGM ? (row.note ?? null) : null,
      }));
      return reply.send({
        state: { day: state.day, season: state.season, weather: state.weather ?? null },
        days: calendarDays,
        isGM,
      });
    },
  );

  // ---------- Correct the clock / season / weather ----------

  app.patch(
    '/parties/:partyId/campaign',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: PatchCampaignStatePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body || ({} as PatchCampaignStatePayload);
      const values: Record<string, unknown> = {};

      if (body.day !== undefined) {
        // Correction directe : on déplace le pointeur SANS archiver — la
        // météo saisie reste celle d'aujourd'hui, le registre des jours
        // passés ne reçoit une ligne que par l'avance (+1 jour).
        const day = Number(body.day);
        if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) {
          return reply.code(400).send({ error: apiMsg(req, 'day out of range') });
        }
        values.day = day;
      }
      if (body.season !== undefined) {
        if (!CAMPAIGN_SEASONS.includes(body.season)) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid season') });
        }
        values.season = body.season;
      }
      if (body.weather !== undefined) {
        const weather = cleanOptionalText(body.weather, MAX_WEATHER_LEN);
        if (weather === undefined) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid weather') });
        }
        values.weather = weather;
      }
      if (body.note !== undefined) {
        const note = cleanOptionalText(body.note, MAX_NOTE_LEN);
        if (note === undefined) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid note') });
        }
        values.note = note;
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      values.updatedAt = sql`datetime('now')`;

      const drizzle = getDrizzle();
      ensureCampaignState(drizzle, partyId);
      drizzle.update(campaignState).set(values).where(eq(campaignState.partyId, partyId)).run();
      const updated = drizzle
        .select(cols(campaignState))
        .from(campaignState)
        .where(eq(campaignState.partyId, partyId))
        .get();
      bus.emitChange({ type: 'campaign:change', partyId, action: 'clock', actorUserId: userId });
      return reply.send({ state: mapState(updated) });
    },
  );

  // ---------- Retouch a past day (the ledger stays honest) ----------

  app.patch(
    '/campaign-days/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchCampaignDayPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const row = drizzle
        .select(cols(campaignDays))
        .from(campaignDays)
        .where(eq(campaignDays.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'day not found') });
      if (!gmGuard(req, reply, row.party_id, userId)) return;

      const body = req.body || ({} as PatchCampaignDayPayload);
      const values: Record<string, unknown> = {};
      if (body.weather !== undefined) {
        const weather = cleanOptionalText(body.weather, MAX_WEATHER_LEN);
        if (weather === undefined) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid weather') });
        }
        values.weather = weather;
      }
      if (body.note !== undefined) {
        const note = cleanOptionalText(body.note, MAX_NOTE_LEN);
        if (note === undefined) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid note') });
        }
        values.note = note;
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      drizzle.update(campaignDays).set(values).where(eq(campaignDays.id, row.id)).run();
      // Un jour vidé de sa météo ET de son journal n'a plus rien à faire
      // au registre — la ligne part au lieu de traîner vide.
      const updated = drizzle
        .select(cols(campaignDays))
        .from(campaignDays)
        .where(eq(campaignDays.id, row.id))
        .get() as any;
      if (!updated.weather && !updated.note) {
        drizzle.delete(campaignDays).where(eq(campaignDays.id, row.id)).run();
        bus.emitChange({
          type: 'campaign:change',
          partyId: row.party_id,
          action: 'clock',
          actorUserId: userId,
        });
        return reply.send({ day: null });
      }
      bus.emitChange({
        type: 'campaign:change',
        partyId: row.party_id,
        action: 'clock',
        actorUserId: userId,
      });
      return reply.send({ day: mapDay(updated) });
    },
  );
}
