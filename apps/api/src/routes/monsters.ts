/**
 * Monster catalog routes: search the French SRD bestiary, get a full stat block.
 * Monsters are global reference data (no party scoping), like spells.
 */

import type { Monster, MonsterSummary } from '@table-sync/shared';
import { eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { monsters } from '../db/schema.ts';
import { requireUser } from './helpers.ts';
import { type AppLang, langFromReq, pickLocalized } from './lang.ts';
import { apiMsg } from './messages.ts';

interface MonsterQuery {
  search?: string;
  limit?: string;
}

/** Map a raw DB row to a full Monster stat block (parses JSON columns). */
type MonsterOverlay = {
  name?: string;
  traits?: { name: string; desc: string }[];
  actions?: { name: string; desc: string }[];
  bonusActions?: { name: string; desc: string }[];
  reactions?: { name: string; desc: string }[];
  legendaryActions?: { name: string; desc: string }[];
  senses?: string;
  languages?: string;
  speed?: string;
};

function parseOverlay(row: any): MonsterOverlay | null {
  const raw = row.overlay_en;
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? (parsed as MonsterOverlay) : null;
  } catch {
    return null;
  }
}

function mapMonster(row: any, lang: AppLang = 'fr'): Monster {
  const base: Monster = {
    slug: row.slug,
    name: row.name_fr,
    type: row.type ?? '',
    subtype: row.subtype ?? null,
    size: row.size ?? 'M',
    alignment: row.alignment ?? null,
    armorClass: row.armor_class ?? 10,
    armorDesc: row.armor_desc ?? null,
    hitPoints: row.hit_points ?? 10,
    hitDice: row.hit_dice ?? null,
    speed: parseJson(row.speed_json, {}),
    abilities: parseJson(row.abilities_json, {
      for: 10,
      dex: 10,
      con: 10,
      int: 10,
      sag: 10,
      cha: 10,
    }),
    savingThrows: parseJson(row.saving_throws_json, []),
    skills: parseJson(row.skills_json, []),
    languages: parseJson(row.languages_json, []),
    challengeRating: row.challenge_rating ?? 0,
    xp: row.xp ?? 0,
    senses: row.senses ?? null,
    telepathy: row.telepathy ?? null,
    damageResistances: parseJsonOrNull(row.damage_resistances_json),
    damageImmunities: parseJsonOrNull(row.damage_immunities_json),
    conditionImmunities: parseJsonOrNull(row.condition_immunities_json),
    traits: parseJson(row.traits_json, []),
    actions: parseJson(row.actions_json, []),
    legendaryActions: parseJson(row.legendary_actions_json, []),
  };
  const overlay = lang === 'en' ? parseOverlay(row) : null;
  if (!overlay) return base;
  if (overlay.name) base.name = overlay.name;
  if (overlay.traits) base.traits = overlay.traits;
  if (overlay.actions) base.actions = overlay.actions;
  if (overlay.legendaryActions) base.legendaryActions = overlay.legendaryActions;
  if (overlay.senses) base.senses = overlay.senses;
  if (typeof overlay.languages === 'string') {
    base.languages = overlay.languages
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (overlay.speed) base.speedText = overlay.speed;
  return base;
}

/** Map a raw DB row to a light MonsterSummary (no prose). */
function mapMonsterSummary(row: any, lang: AppLang = 'fr'): MonsterSummary {
  return {
    slug: row.slug,
    name: pickLocalized(lang, parseOverlay(row)?.name, row.name_fr),
    type: row.type ?? '',
    size: row.size ?? 'M',
    challengeRating: row.challenge_rating ?? 0,
    armorClass: row.armor_class ?? 10,
    hitPoints: row.hit_points ?? 10,
  };
}

function parseJson<T>(raw: any, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return raw as T;
  try {
    const parsed = JSON.parse(raw);
    return (parsed === null ? fallback : parsed) as T;
  } catch {
    return fallback;
  }
}

function parseJsonOrNull(raw: any): any[] | null {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function monsterRoutes(app: FastifyInstance) {
  // ---------- Search monsters (DB-filtered, accent-insensitive) ----------
  app.get(
    '/monsters',
    async (req: FastifyRequest<{ Querystring: MonsterQuery }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const { search } = req.query || {};
      const lim = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

      // normalize() (registered on the shared better-sqlite3 handle) strips
      // diacritics and lowercases — accent-insensitive search.
      const conditions =
        search !== undefined && search !== ''
          ? or(
              sql`normalize(${monsters.nameFr}) LIKE normalize(${`%${search}%`})`,
              sql`normalize(${monsters.type}) LIKE normalize(${`%${search}%`})`,
              sql`normalize(${monsters.overlayEn}) LIKE normalize(${`%${search}%`})`,
            )
          : undefined;

      const rows = getDrizzle()
        .select({
          slug: monsters.slug,
          name_fr: monsters.nameFr,
          overlay_en: monsters.overlayEn,
          type: monsters.type,
          size: monsters.size,
          challenge_rating: monsters.challengeRating,
          armor_class: monsters.armorClass,
          hit_points: monsters.hitPoints,
        })
        .from(monsters)
        .where(conditions)
        .orderBy(monsters.challengeRating, sql`${monsters.nameFr} COLLATE NOCASE ASC`)
        .limit(lim)
        .all();

      const lang = langFromReq(req);
      return reply.send({ monsters: rows.map((r) => mapMonsterSummary(r, lang)) });
    },
  );

  // ---------- Get a full monster stat block ----------
  app.get(
    '/monsters/:slug',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const row = getDrizzle()
        .select(cols(monsters))
        .from(monsters)
        .where(eq(monsters.slug, req.params.slug))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'Monstre introuvable') });

      return reply.send({ monster: mapMonster(row, langFromReq(req)) });
    },
  );
}
