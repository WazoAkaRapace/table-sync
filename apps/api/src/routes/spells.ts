/**
 * Spell catalog routes: list SRD spells with filters, get a single spell.
 * Spells are global SRD reference data (no party scoping), but still
 * require authentication (enforced by the global guard in server.ts).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { spells } from '../db/schema.ts';
import { mapSpell, requireUser } from './helpers.ts';
import { type AppLang, langFromReq, pickLocalized } from './lang.ts';
import { apiMsg } from './messages.ts';

// ---------- English spell meta (data/spells-en-meta.json) ----------
//
// Le stockage des sorts est FR ; nom et description ont leur colonne EN en
// base, mais les champs méta (incantation, portée, matériel, durée, niveaux
// supérieurs) vivent dans un annexe chargé UNE fois au démarrage — même
// résolution de chemin que db/seed.ts (cwd puis racine du monorepo).

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SpellEnMeta {
  castingTime: string | null;
  rangeText: string | null;
  material: string | null;
  duration: string | null;
  higherLevel: string | null;
}

function resolveSeedPath(filename: string): string {
  const candidates = [
    resolve(process.cwd(), 'data', filename),
    resolve(__dirname, '..', '..', '..', '..', 'data', filename),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch {
      // candidat suivant
    }
  }
  throw new Error(`${filename} not found in: ${candidates.join(', ')}`);
}

function loadSpellEnMeta(): Record<string, SpellEnMeta> {
  try {
    return JSON.parse(readFileSync(resolveSeedPath('spells-en-meta.json'), 'utf8'));
  } catch {
    // Annexe absent : repli champ par champ sur le FR stocké.
    return {};
  }
}

const SPELL_EN_META = loadSpellEnMeta();

/**
 * Recouvre les champs méta d'un sort déjà mappé par leur version anglaise
 * (clé : srdIndex). Repli CHAMP PAR CHAMP sur la valeur existante (FR)
 * lorsqu'une entrée ou un champ manque — jamais de payload mixte cassé.
 */
export function withSpellEnMeta<T extends { srdIndex: string | null }>(spell: T, lang: AppLang): T {
  if (lang !== 'en') return spell;
  const meta = spell.srdIndex ? SPELL_EN_META[spell.srdIndex] : undefined;
  if (!meta) return spell;
  return {
    ...spell,
    castingTime: meta.castingTime ?? spell.castingTime,
    rangeText: meta.rangeText ?? spell.rangeText,
    material: meta.material ?? spell.material,
    duration: meta.duration ?? spell.duration,
    higherLevel: meta.higherLevel ?? spell.higherLevel,
  } as T;
}

interface SpellQuery {
  class?: string;
  level?: string;
  school?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

export async function spellRoutes(app: FastifyInstance) {
  // ---------- List spells (paginated, filterable) ----------
  app.get(
    '/spells',
    async (req: FastifyRequest<{ Querystring: SpellQuery }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const { class: klass, level, school, search } = req.query || {};
      const lim = Math.min(parseInt(req.query.limit || '30', 10) || 30, 200);
      const off = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

      const where: Array<SQL | undefined> = [];

      // Class filter: classes_json LIKE (French class names, case-insensitive).
      // classes_json is stored as '["Magicien","Ensorceleur"]' so we match
      // against the quoted value. We wrap both sides in normalize() so accents
      // (é in "Magicien" is fine, but future-proof for accented names) match.
      if (klass) {
        // Multiclassage : le filtre accepte plusieurs classes (séparées par
        // des virgules) — UNION des listes de sorts.
        const classNames = String(klass)
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        if (classNames.length > 0) {
          where.push(
            or(
              ...classNames.map(
                (name) => sql`normalize(${spells.classesJson}) LIKE normalize(${`%"${name}"%`})`,
              ),
            ),
          );
        }
      }

      // Level filter: exact match (0-9). 0 = cantrip.
      if (level !== undefined && level !== '') {
        const lv = parseInt(level, 10);
        if (!Number.isNaN(lv) && lv >= 0 && lv <= 9) {
          where.push(eq(spells.level, lv));
        }
      }

      // School filter: exact match (lowercase school key).
      if (school) {
        where.push(eq(spells.school, school.toLowerCase()));
      }

      // Search: accent-insensitive match on name OR name_fr.
      if (search) {
        where.push(
          or(
            sql`normalize(${spells.name}) LIKE normalize(${`%${search}%`})`,
            sql`normalize(${spells.nameFr}) LIKE normalize(${`%${search}%`})`,
          ),
        );
      }

      const filter = where.length > 0 ? and(...where) : undefined;

      const drizzle = getDrizzle();
      const rows = drizzle
        .select(cols(spells))
        .from(spells)
        .where(filter)
        .orderBy(spells.level, sql`COALESCE(${spells.nameFr}, ${spells.name}) COLLATE NOCASE ASC`)
        .limit(lim)
        .offset(off)
        .all() as any[];

      const total = (
        drizzle.select({ n: sql<number>`count(*)` }).from(spells).where(filter).get() as any
      ).n;

      const lang = langFromReq(req);
      return reply.send({
        spells: rows.map((r: any) => withSpellEnMeta(mapSpell(r, lang), lang)),
        total,
        limit: lim,
        offset: off,
      });
    },
  );

  // ---------- Light catalog: id + French name + level for all spells ----------
  // Used for matching spell names in monster spellcasting entries. Small payload.
  app.get('/spells/light', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = requireUser(req, reply);
    if (userId === null) return;
    const lang = langFromReq(req);
    const rows = getDrizzle()
      .select({ id: spells.id, name_fr: spells.nameFr, name: spells.name, level: spells.level })
      .from(spells)
      .orderBy(spells.level, sql`${spells.nameFr} COLLATE NOCASE ASC`)
      .all();
    return reply.send({
      spells: rows.map((r: any) => ({
        id: r.id,
        name: pickLocalized(lang, r.name, r.name_fr),
        level: r.level,
      })),
    });
  });

  // ---------- Get single spell ----------
  app.get(
    '/spells/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const row = getDrizzle()
        .select(cols(spells))
        .from(spells)
        .where(eq(spells.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'spell not found') });
      return reply.send({
        spell: withSpellEnMeta(mapSpell(row, langFromReq(req)), langFromReq(req)),
      });
    },
  );
}
