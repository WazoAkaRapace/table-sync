/**
 * Helpers du carnet du MD — constantes partagées, mappers, gardes member/GM,
 * horloge paresseuse et tri des cartes. Découpage 2026-11 (phase 4) :
 * déplacement pur depuis routes/campaign.ts, exportés depuis leur
 * propriétaire pour les sous-modules de routes/campaign/.
 */

import type {
  CampaignCountdown,
  CampaignDay,
  CampaignState,
  DmNote,
  DmQuest,
} from '@table-sync/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { campaignState, dmNotes, dmQuests } from '../../db/schema.ts';
import { isPartyGM, isPartyMember } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';

export const MAX_DAY = 100000; // ~274 ans de campagne — au-delà, c'est une erreur de saisie
export const MAX_WEATHER_LEN = 200;
export const MAX_NOTE_LEN = 500; // le journal d'un jour tient en quelques lignes
export const MAX_TABLE_NOTE_LEN = 2000; // journal de table partagé : plus généreux
export const MAX_TITLE_LEN = 200;
export const MAX_LABEL_LEN = 120;
export const DAYS_LEDGER_LIMIT = 30; // jours passés servis (les plus récents d'abord)
export const CALENDAR_RANGE_LIMIT = 60; // jours max par requête du calendrier partagé

export type Drizzle = ReturnType<typeof getDrizzle>;

// ---------- Mappers ----------

export function mapState(row: any): CampaignState {
  return {
    partyId: row.party_id,
    day: row.day,
    season: row.season,
    weather: row.weather ?? null,
    note: row.note ?? null,
  };
}

export function mapDay(row: any): CampaignDay {
  return {
    id: row.id,
    partyId: row.party_id,
    day: row.day,
    weather: row.weather ?? null,
    note: row.note ?? null,
    tableNote: row.table_note ?? null,
  };
}

export function mapCountdown(row: any): CampaignCountdown {
  return {
    id: row.id,
    partyId: row.party_id,
    label: row.label,
    targetDay: row.target_day,
    createdAt: row.created_at,
  };
}

export function mapNote(row: any): DmNote {
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

export function mapQuest(row: any): DmQuest {
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
export function gmGuard(
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

/** Membership gate alone — the shared calendar (#159) trusts every member
 *  (read the calendar, write the table journal, advance the day). */
export function memberGuard(
  req: FastifyRequest,
  reply: FastifyReply,
  partyId: number,
  userId: number,
): boolean {
  if (!isPartyMember(partyId, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'not a member') });
    return false;
  }
  return true;
}

/** Lazy init: the clock row appears at the MD's first carnet access. */
export function ensureCampaignState(drizzle: Drizzle, partyId: number): any {
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

export function nextSort(
  drizzle: Drizzle,
  table: typeof dmNotes | typeof dmQuests,
  partyId: number,
) {
  return (
    drizzle
      .select({ next: sql<number>`coalesce(max(${table.sortOrder}), -1) + 1` })
      .from(table)
      .where(eq(table.partyId, partyId))
      .get() as any
  ).next;
}
