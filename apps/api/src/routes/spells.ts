/**
 * Spell catalog routes: list SRD spells with filters, get a single spell.
 * Spells are global SRD reference data (no party scoping), but still
 * require authentication (enforced by the global guard in server.ts).
 */

import { and, eq, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { spells } from '../db/schema.ts';
import { mapSpell, requireUser } from './helpers.ts';
import { langFromReq, pickLocalized } from './lang.ts';

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

      return reply.send({
        spells: rows.map((r: any) => mapSpell(r, langFromReq(req))),
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
      if (!row) return reply.code(404).send({ error: 'spell not found' });
      return reply.send({ spell: mapSpell(row, langFromReq(req)) });
    },
  );
}
