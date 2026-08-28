/**
 * Divine domain spells (Clerc, SRD): always prepared, don't count against
 * the prepared-spells limit. Derived from domain + level — no stored rows.
 */

import type { Spell } from '@table-sync/shared';
import { bonusPreparedSpells, domainSpellsFor, findClass } from '@table-sync/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { characterClasses, characters, spells } from '../db/schema.ts';
import { isPartyGM, mapSpell, requireUser } from './helpers.ts';
import { langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';

export async function domainSpellRoutes(app: FastifyInstance) {
  app.get(
    '/characters/:id/domain-spells',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'Personnage introuvable') });
      const gm = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !gm) {
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au propriétaire ou au MD') });
      }

      // Cleric domains, druid Circle of the Land terrains, paladin oaths —
      // all the same SRD mechanic: always prepared, excluded from the limit.
      // Multiclassage : chaque source divine est évaluée au NIVEAU DE SA
      // CLASSE (les lignes character_classes font foi).
      const classRows = drizzle
        .select(cols(characterClasses))
        .from(characterClasses)
        .where(eq(characterClasses.characterId, char.id))
        .orderBy(characterClasses.position, characterClasses.id)
        .all() as any[];
      const lines: Array<{ classKey: string; level: number; subclassKey: string | null }> =
        classRows.length > 0
          ? classRows.map((r) => ({
              classKey: r.class_key,
              level: r.level ?? 1,
              subclassKey: r.subclass_key ?? null,
            }))
          : char.character_class
            ? [
                {
                  classKey: findClass(char.character_class)?.name ?? char.character_class,
                  level: char.level ?? 1,
                  subclassKey:
                    findClass(char.character_class)?.name === 'Clerc'
                      ? (char.divine_domain ?? null)
                      : findClass(char.character_class)?.name === 'Druide'
                        ? (char.druid_circle ?? null)
                        : findClass(char.character_class)?.name === 'Paladin'
                          ? (char.sacred_oath ?? null)
                          : null,
                },
              ]
            : [];
      const groups: Array<{ level: number; names: string[] }> = [];
      for (const line of lines) {
        const name = findClass(line.classKey)?.name ?? null;
        if (!name) continue;
        if (name === 'Clerc' && line.subclassKey) {
          groups.push(...domainSpellsFor(line.subclassKey, line.level));
        } else if (name === 'Druide' && line.subclassKey === 'terre' && char.land_circle) {
          groups.push(...bonusPreparedSpells('Druide', char.land_circle, line.level));
        } else if (name === 'Paladin' && line.subclassKey) {
          groups.push(...bonusPreparedSpells('Paladin', line.subclassKey, line.level));
        }
      }
      const domainSpells: Array<Spell & { domainLevel: number }> = [];
      for (const g of groups) {
        for (const name of g.names) {
          const row = drizzle
            .select(cols(spells))
            .from(spells)
            .where(sql`${spells.name} = ${name} COLLATE NOCASE`)
            .get() as any;
          if (row) domainSpells.push({ ...mapSpell(row, langFromReq(req)), domainLevel: g.level });
        }
      }
      return reply.send({ domain: char.divine_domain ?? null, spells: domainSpells }); // 'domain' kept for client compat
    },
  );
}
