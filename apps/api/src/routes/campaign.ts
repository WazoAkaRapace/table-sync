/**
 * Carnet du MD routes: campaign clock (day/season/weather + named countdowns),
 * free-form notes and quests — ALL strictly GM-only, party-scoped.
 *
 * The clock never touches character sheets: food/water/rests stay on the
 * feuilles, advancing the day is a pure carnet concern. Everything broadcasts
 * 'campaign:change' (signal only — the payload stays behind these GM-gated
 * routes; player clients receive the event and ignore it).
 */

import type {
  AdvanceCampaignPayload,
  CampaignCountdown,
  CampaignDay,
  CampaignState,
  CreateCampaignCountdownPayload,
  CreateDmNotePayload,
  CreateDmQuestPayload,
  DmNote,
  DmQuest,
  DmQuestStatus,
  PatchCampaignCountdownPayload,
  PatchCampaignDayPayload,
  PatchCampaignStatePayload,
  PatchDmNotePayload,
  PatchDmQuestPayload,
  ReorderPayload,
} from '@table-sync/shared';
import { CAMPAIGN_SEASONS, DM_QUEST_STATUSES } from '@table-sync/shared';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import {
  campaignCountdowns,
  campaignDays,
  campaignState,
  dmNotes,
  dmQuests,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { isPartyGM, isPartyMember, requireUser } from './helpers.ts';
import { apiMsg } from './messages.ts';

const MAX_DAY = 100000; // ~274 ans de campagne — au-delà, c'est une erreur de saisie
const MAX_WEATHER_LEN = 200;
const MAX_NOTE_LEN = 500; // le journal d'un jour tient en quelques lignes
const MAX_TITLE_LEN = 200;
const MAX_LABEL_LEN = 120;
const DAYS_LEDGER_LIMIT = 30; // jours passés servis (les plus récents d'abord)

// ---------- Mappers ----------

function mapState(row: any): CampaignState {
  return {
    partyId: row.party_id,
    day: row.day,
    season: row.season,
    weather: row.weather ?? null,
    note: row.note ?? null,
  };
}

function mapDay(row: any): CampaignDay {
  return {
    id: row.id,
    partyId: row.party_id,
    day: row.day,
    weather: row.weather ?? null,
    note: row.note ?? null,
  };
}

function mapCountdown(row: any): CampaignCountdown {
  return {
    id: row.id,
    partyId: row.party_id,
    label: row.label,
    targetDay: row.target_day,
    createdAt: row.created_at,
  };
}

function mapNote(row: any): DmNote {
  return {
    id: row.id,
    partyId: row.party_id,
    title: row.title,
    content: row.content,
    sortOrder: row.sort_order ?? 0,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function mapQuest(row: any): DmQuest {
  return {
    id: row.id,
    partyId: row.party_id,
    title: row.title,
    body: row.body,
    status: row.status,
    sortOrder: row.sort_order ?? 0,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

// ---------- Helpers ----------

/** member + GM gate — every carnet route answers 403 otherwise. */
function gmGuard(
  req: FastifyRequest,
  reply: FastifyReply,
  partyId: number,
  userId: number,
): boolean {
  if (!isPartyMember(partyId, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'not a member') });
    return false;
  }
  if (!isPartyGM(partyId, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'GM only') });
    return false;
  }
  return true;
}

type Drizzle = ReturnType<typeof getDrizzle>;

/** Lazy init: the clock row appears at the MD's first carnet access. */
function ensureCampaignState(drizzle: Drizzle, partyId: number): any {
  const existing = drizzle
    .select(cols(campaignState))
    .from(campaignState)
    .where(eq(campaignState.partyId, partyId))
    .get();
  if (existing) return existing;
  return drizzle.insert(campaignState).values({ partyId }).onConflictDoNothing().run()
    ? drizzle
        .select(cols(campaignState))
        .from(campaignState)
        .where(eq(campaignState.partyId, partyId))
        .get()
    : existing;
}

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

function nextSort(drizzle: Drizzle, table: typeof dmNotes | typeof dmQuests, partyId: number) {
  return (
    drizzle
      .select({ next: sql<number>`coalesce(max(${table.sortOrder}), -1) + 1` })
      .from(table)
      .where(eq(table.partyId, partyId))
      .get() as any
  ).next;
}

function cleanOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.slice(0, maxLength);
}

// ---------- Routes ----------

export async function campaignRoutes(app: FastifyInstance) {
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
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body || ({} as AdvanceCampaignPayload);
      const steps = body.steps === undefined ? 1 : Number(body.steps);
      if (!Number.isInteger(steps) || steps < 1 || steps > 30) {
        return reply.code(400).send({ error: apiMsg(req, 'steps must be 1-30') });
      }

      const drizzle = getDrizzle();
      const state = ensureCampaignState(drizzle, partyId);
      const newDay = Math.min(state.day + steps, MAX_DAY);
      // Le jour qui s'achève est figé avec sa météo et son journal ; le
      // nouveau jour démarre clair.
      getDb().transaction(() => {
        archiveCurrentDay(drizzle, partyId, state);
        drizzle
          .update(campaignState)
          .set({ day: newDay, weather: null, note: null, updatedAt: sql`datetime('now')` })
          .where(eq(campaignState.partyId, partyId))
          .run();
      })();

      const updated = drizzle
        .select(cols(campaignState))
        .from(campaignState)
        .where(eq(campaignState.partyId, partyId))
        .get();
      bus.emitChange({ type: 'campaign:change', partyId, action: 'clock', actorUserId: userId });
      return reply.send({ state: mapState(updated) });
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
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const row = drizzle
        .select(cols(campaignCountdowns))
        .from(campaignCountdowns)
        .where(eq(campaignCountdowns.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'countdown not found') });
      if (!gmGuard(req, reply, row.party_id, userId)) return;

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
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const row = drizzle
        .select(cols(campaignCountdowns))
        .from(campaignCountdowns)
        .where(eq(campaignCountdowns.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'countdown not found') });
      if (!gmGuard(req, reply, row.party_id, userId)) return;

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

  // ---------- Notes (grammar of character notes, party-scoped) ----------

  app.post(
    '/parties/:partyId/dm-notes',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateDmNotePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body || ({} as CreateDmNotePayload);
      const title = body.title?.trim();
      if (!title || title.length > MAX_TITLE_LEN) {
        return reply.code(400).send({ error: apiMsg(req, 'title is required') });
      }

      const drizzle = getDrizzle();
      const row = drizzle
        .insert(dmNotes)
        .values({
          partyId,
          title,
          content: body.content?.trim() || null,
          sortOrder: nextSort(drizzle, dmNotes, partyId),
        })
        .returning(cols(dmNotes))
        .get();
      bus.emitChange({ type: 'campaign:change', partyId, action: 'note', actorUserId: userId });
      return reply.code(201).send({ note: mapNote(row) });
    },
  );

  app.patch(
    '/dm-notes/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchDmNotePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const note = drizzle
        .select(cols(dmNotes))
        .from(dmNotes)
        .where(eq(dmNotes.id, Number(req.params.id)))
        .get() as any;
      if (!note) return reply.code(404).send({ error: apiMsg(req, 'note not found') });
      if (!gmGuard(req, reply, note.party_id, userId)) return;

      const body = req.body || ({} as PatchDmNotePayload);
      const values: Record<string, unknown> = {};
      if (body.title !== undefined) {
        const title = body.title?.trim();
        if (!title || title.length > MAX_TITLE_LEN) {
          return reply.code(400).send({ error: apiMsg(req, 'title is required') });
        }
        values.title = title;
      }
      if (body.content !== undefined) {
        values.content = body.content === null ? null : String(body.content);
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      values.updatedAt = sql`datetime('now')`;
      drizzle.update(dmNotes).set(values).where(eq(dmNotes.id, note.id)).run();
      const updated = drizzle
        .select(cols(dmNotes))
        .from(dmNotes)
        .where(eq(dmNotes.id, note.id))
        .get();
      bus.emitChange({
        type: 'campaign:change',
        partyId: note.party_id,
        action: 'note',
        actorUserId: userId,
      });
      return reply.send({ note: mapNote(updated) });
    },
  );

  // Full-list reorder after a card drop — same contract as character notes.
  app.patch(
    '/parties/:partyId/dm-notes/order',
    async (req: FastifyRequest<{ Params: { partyId: string }; Body: ReorderPayload }>, reply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body as ReorderPayload;
      const order = [
        ...new Set(
          (Array.isArray(body?.order) ? body.order : []).map(Number).filter(Number.isInteger),
        ),
      ];
      if (order.length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'order is required') });
      }
      // Every id must belong to this party — a foreign id would silently
      // rewrite another group's ordering.
      const owned = new Set(
        (
          getDrizzle()
            .select({ id: dmNotes.id })
            .from(dmNotes)
            .where(inArray(dmNotes.id, order))
            .all() as any[]
        ).map((r) => r.id),
      );
      if (order.some((id) => !owned.has(id))) {
        return reply.code(400).send({ error: apiMsg(req, 'note does not belong to this party') });
      }

      const drizzle = getDrizzle();
      getDb().transaction(() => {
        order.forEach((id, index) => {
          drizzle.update(dmNotes).set({ sortOrder: index }).where(eq(dmNotes.id, id)).run();
        });
      })();

      bus.emitChange({ type: 'campaign:change', partyId, action: 'note', actorUserId: userId });
      return reply.send({ ok: true });
    },
  );

  app.delete(
    '/dm-notes/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const note = drizzle
        .select(cols(dmNotes))
        .from(dmNotes)
        .where(eq(dmNotes.id, Number(req.params.id)))
        .get() as any;
      if (!note) return reply.code(404).send({ error: apiMsg(req, 'note not found') });
      if (!gmGuard(req, reply, note.party_id, userId)) return;

      drizzle.delete(dmNotes).where(eq(dmNotes.id, note.id)).run();
      bus.emitChange({
        type: 'campaign:change',
        partyId: note.party_id,
        action: 'note',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );

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
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const quest = drizzle
        .select(cols(dmQuests))
        .from(dmQuests)
        .where(eq(dmQuests.id, Number(req.params.id)))
        .get() as any;
      if (!quest) return reply.code(404).send({ error: apiMsg(req, 'quest not found') });
      if (!gmGuard(req, reply, quest.party_id, userId)) return;

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
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const quest = drizzle
        .select(cols(dmQuests))
        .from(dmQuests)
        .where(eq(dmQuests.id, Number(req.params.id)))
        .get() as any;
      if (!quest) return reply.code(404).send({ error: apiMsg(req, 'quest not found') });
      if (!gmGuard(req, reply, quest.party_id, userId)) return;

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
