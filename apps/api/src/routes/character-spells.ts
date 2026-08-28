/**
 * Character ↔ Spell routes: list a character's known/prepared spells,
 * add a spell, toggle prepared / reorder, remove a spell.
 *
 * Ownership rules:
 *  - GET  /characters/:id/spells     → any party member
 *  - POST /characters/:id/spells     → owner or GM (any party member may read;
 *                                       only the owner or GM may modify)
 *  - PATCH /character-spells/:linkId → owner or GM (resolved via JOIN)
 *  - DELETE /character-spells/:linkId→ owner or GM
 *
 * All mutations emit a `character:change` sync event.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { characterClasses, characterSpells, characters, spells } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  characterVisibleTo,
  isPartyGM,
  isPartyMember,
  mapCharacterSpell,
  requireUser,
} from './helpers.ts';
import { langFromReq } from './lang.ts';

interface AddCharacterSpellPayload {
  spellId: number;
  prepared?: boolean;
  /** Classe d'origine du sort (multiclassage SRD) — défaut : 1ère classe. */
  classSource?: string | null;
}

interface PatchCharacterSpellPayload {
  prepared?: boolean;
  sortOrder?: number;
  classSource?: string | null;
}

/**
 * character_spells JOIN spells with the spell columns prefixed `s_` — the
 * shape mapCharacterSpell expects (avoids collisions with the link table's
 * own id/prepared/sort_order).
 */
const LINK_WITH_SPELL = {
  id: characterSpells.id,
  character_id: characterSpells.characterId,
  prepared: characterSpells.prepared,
  class_source: characterSpells.classSource,
  sort_order: characterSpells.sortOrder,
  added_at: characterSpells.addedAt,
  s_id: spells.id,
  s_srd_index: spells.srdIndex,
  s_name: spells.name,
  s_name_fr: spells.nameFr,
  s_level: spells.level,
  s_school: spells.school,
  s_casting_time: spells.castingTime,
  s_range_text: spells.rangeText,
  s_components: spells.components,
  s_material: spells.material,
  s_duration: spells.duration,
  s_concentration: spells.concentration,
  s_ritual: spells.ritual,
  s_description: spells.description,
  s_description_fr: spells.descriptionFr,
  s_higher_level: spells.higherLevel,
  s_higher_level_fr: spells.higherLevelFr,
  s_attack_type: spells.attackType,
  s_damage_json: spells.damageJson,
  s_dc_json: spells.dcJson,
  s_classes_json: spells.classesJson,
};

/**
 * Fetch the (character, link) pair for a character_spells row.
 * Used by PATCH/DELETE to resolve ownership before mutating.
 * Returns null if the link row doesn't exist.
 */
function getLinkWithCharacter(linkId: number): { link: any; char: any } | null {
  const drizzle = getDrizzle();
  const link = drizzle
    .select(cols(characterSpells))
    .from(characterSpells)
    .where(eq(characterSpells.id, linkId))
    .get() as any;
  if (!link) return null;
  const char = drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, link.character_id))
    .get() as any;
  if (!char) return null;
  return { link, char };
}

/** Returns true if the user is the owner or the GM of the character's party. */
function isOwnerOrGM(char: any, userId: number): boolean {
  return char.owner_id === userId || isPartyGM(char.party_id, userId);
}

export async function characterSpellRoutes(app: FastifyInstance) {
  // ---------- List a character's spells ----------
  app.get(
    '/characters/:id/spells',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      // Hidden character: 404 for everyone but its owner and the GM
      if (!characterVisibleTo(char, userId)) {
        return reply.code(404).send({ error: 'character not found' });
      }

      const rows = drizzle
        .select(LINK_WITH_SPELL)
        .from(characterSpells)
        .innerJoin(spells, eq(spells.id, characterSpells.spellId))
        .where(eq(characterSpells.characterId, char.id))
        .orderBy(
          desc(characterSpells.prepared),
          spells.level,
          sql`COALESCE(${spells.nameFr}, ${spells.name}) COLLATE NOCASE ASC`,
        )
        .all();

      return reply.send({ spells: rows.map(mapCharacterSpell) });
    },
  );

  // ---------- Add a spell to a character ----------
  app.post(
    '/characters/:id/spells',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: AddCharacterSpellPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: 'only the owner or GM can modify spells' });
      }

      const body = req.body || ({} as AddCharacterSpellPayload);
      if (!body.spellId) return reply.code(400).send({ error: 'spellId is required' });

      const spell = drizzle
        .select({ id: spells.id })
        .from(spells)
        .where(eq(spells.id, body.spellId))
        .get();
      if (!spell) return reply.code(404).send({ error: 'spell not found' });

      const prepared = body.prepared ? 1 : 0;

      // Classe d'origine (multiclassage SRD) : une classe de la fiche, sinon
      // la classe de départ. L'unicité reste (personnage, sort) — un sort
      // connu via deux listes ne compte qu'une fois sur la fiche, la classe
      // d'origine décide de son DD et de son compteur de préparation.
      const classRows = drizzle
        .select({ class_key: characterClasses.classKey })
        .from(characterClasses)
        .where(eq(characterClasses.characterId, char.id))
        .orderBy(characterClasses.position)
        .all() as any[];
      const knownClasses = classRows.map((r) => r.class_key as string);
      const firstClass = knownClasses[0] ?? char.character_class ?? null;
      let classSource: string | null = firstClass;
      if (body.classSource !== undefined && body.classSource !== null) {
        const wanted = knownClasses.includes(body.classSource)
          ? body.classSource
          : body.classSource === char.character_class
            ? body.classSource
            : null;
        if (wanted === null) {
          return reply.code(400).send({ error: 'classe d’origine inconnue pour ce personnage' });
        }
        classSource = wanted;
      }

      // UPSERT: if the character already knows this spell, just toggle prepared.
      drizzle
        .insert(characterSpells)
        .values({ characterId: char.id, spellId: body.spellId, prepared, classSource })
        .onConflictDoUpdate({
          target: [characterSpells.characterId, characterSpells.spellId],
          set: {
            prepared: sql`excluded.prepared`,
            classSource: sql`COALESCE(excluded.class_source, character_spells.class_source)`,
          },
        })
        .run();

      // Query by character_id + spell_id (not lastInsertRowid, which is
      // unreliable on UPSERT: on the conflict path it still holds the rowid
      // of the last INSERT on this connection — possibly another link row).
      const row = drizzle
        .select(LINK_WITH_SPELL)
        .from(characterSpells)
        .innerJoin(spells, eq(spells.id, characterSpells.spellId))
        .where(
          and(eq(characterSpells.characterId, char.id), eq(characterSpells.spellId, body.spellId)),
        )
        .get();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(201).send({ spell: mapCharacterSpell(row, langFromReq(req)) });
    },
  );

  // ---------- Update a character_spell link (toggle prepared / reorder) ----------
  app.patch(
    '/character-spells/:linkId',
    async (
      req: FastifyRequest<{ Params: { linkId: string }; Body: PatchCharacterSpellPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const resolved = getLinkWithCharacter(Number(req.params.linkId));
      if (!resolved) return reply.code(404).send({ error: 'character spell not found' });
      const { link, char } = resolved;
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: 'only the owner or GM can modify spells' });
      }

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.prepared !== undefined) values.prepared = body.prepared ? 1 : 0;
      if (body.sortOrder !== undefined) values.sortOrder = Math.floor(body.sortOrder);
      if (body.classSource !== undefined) values.classSource = body.classSource || null;
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: 'no fields to update' });
      }
      drizzle.update(characterSpells).set(values).where(eq(characterSpells.id, link.id)).run();

      const row = drizzle
        .select(LINK_WITH_SPELL)
        .from(characterSpells)
        .innerJoin(spells, eq(spells.id, characterSpells.spellId))
        .where(eq(characterSpells.id, link.id))
        .get();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.send({ spell: mapCharacterSpell(row, langFromReq(req)) });
    },
  );

  // ---------- Remove a spell from a character ----------
  app.delete(
    '/character-spells/:linkId',
    async (req: FastifyRequest<{ Params: { linkId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const resolved = getLinkWithCharacter(Number(req.params.linkId));
      if (!resolved) return reply.code(404).send({ error: 'character spell not found' });
      const { link, char } = resolved;
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: 'only the owner or GM can modify spells' });
      }

      drizzle.delete(characterSpells).where(eq(characterSpells.id, link.id)).run();
      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
