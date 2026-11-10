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
import { mapCharacterSpell } from './lib/mappers.ts';
import { checkCharacterAccess, requireCharacterAccess } from './lib/access.ts';
import { requireUser } from './lib/membership.ts';
import { sendCachedJson } from './httpCache.ts';
import { type AppLang, langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';
import { withSpellEnMeta } from './spells.ts';
import { AddCharacterSpellBody } from '../validation.ts';

/** Applique la méta EN au sort embarqué d'un CharacterSpell mappé. */
function localizeCharacterSpell<T extends { spell: Parameters<typeof withSpellEnMeta>[0] }>(
  cs: T,
  lang: AppLang,
): T {
  return { ...cs, spell: withSpellEnMeta(cs.spell, lang) as T['spell'] };
}

interface AddCharacterSpellPayload {
  spellId: number;
  prepared?: boolean;
  /** Classe d'origine du sort (multiclassage SRD) — défaut : 1ère classe. */
  classSource?: string | null;
  /** Provenance ('invocation' = manifestation occulte) — défaut 'normal'. */
  source?: string | null;
}

interface PatchCharacterSpellPayload {
  prepared?: boolean;
  sortOrder?: number;
  classSource?: string | null;
  source?: string | null;
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
  source: characterSpells.source,
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
  // Pas de prose SERVIE (description/description_fr) : mapCharacterSpell
  // mappe en RÉSUMÉ (mapSpell summary=true) et le client charge la prose à
  // l'ouverture (SpellProse → fetchSpellDetail, cache de session) — lire les
  // colonnes TEXT longues par sort connu était du I/O jeté, et la liste
  // redescend à CHAQUE lancé de sort (l'incantation écrit spell_slots_used →
  // character:change → refetch).
  // EXCEPTION #171 : higher_level × 2 descendent (COLONNES courtes) pour
  // calculer le drapeau scalesAtHigherLevel — sans lui, les sorts à upcast
  // purement textuel (Aide, Héroïsme…) restaient bloqués au niveau natif.
  s_higher_level: spells.higherLevel,
  s_higher_level_fr: spells.higherLevelFr,
  s_attack_type: spells.attackType,
  s_damage_json: spells.damageJson,
  s_dc_json: spells.dcJson,
  s_classes_json: spells.classesJson,
  // Badge « sort de la table » (PR3 sorts custom) — la projection résumée.
  s_source: spells.source,
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

export async function characterSpellRoutes(app: FastifyInstance) {
  // ---------- List a character's spells ----------
  app.get(
    '/characters/:id/spells',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const access = requireCharacterAccess(req, reply, Number(req.params.id), {
        access: 'member-visible',
      });
      if (!access) return;
      const { char } = access;
      const drizzle = getDrizzle();

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

      const lang = langFromReq(req);
      // ETag : la liste redescend à chaque character:change du personnage —
      // y compris CHAQUE lancé de sort (spell_slots_used) ; inchangée → 304.
      return sendCachedJson(req, reply, {
        spells: rows.map((r: any) => localizeCharacterSpell(mapCharacterSpell(r, lang), lang)),
      });
    },
  );

  // ---------- Add a spell to a character ----------
  app.post(
    '/characters/:id/spells',
    { schema: { body: AddCharacterSpellBody } },
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: AddCharacterSpellPayload }>,
      reply: FastifyReply,
    ) => {
      const access = requireCharacterAccess(req, reply, Number(req.params.id), {
        access: 'owner-or-gm',
        requireMember: true,
        forbiddenMsg: 'only the owner or GM can modify spells',
      });
      if (!access) return;
      const { char, userId } = access;
      const drizzle = getDrizzle();

      const body = req.body || ({} as AddCharacterSpellPayload);
      if (!body.spellId) return reply.code(400).send({ error: apiMsg(req, 'spellId is required') });

      const spell = drizzle
        .select({ id: spells.id, source: spells.source, party_id: spells.partyId })
        .from(spells)
        .where(eq(spells.id, body.spellId))
        .get() as any;
      if (!spell) return reply.code(404).send({ error: apiMsg(req, 'spell not found') });
      // Garde de périmètre (position 8) : un sort personnalisé n'est
      // apprenable que par les personnages de SON groupe — sans elle, un
      // joueur pourrait apprendre le sort maison d'une autre table en
      // devinant l'id. L'apprentissage lui-même reste libre (Q2a).
      if (spell.source === 'custom' && spell.party_id !== char.party_id) {
        return reply.code(403).send({ error: apiMsg(req, 'sort hors de portée') });
      }

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
          return reply
            .code(400)
            .send({ error: apiMsg(req, 'classe d’origine inconnue pour ce personnage') });
        }
        classSource = wanted;
      }

      // UPSERT: if the character already knows this spell, just toggle prepared.
      drizzle
        .insert(characterSpells)
        .values({
          characterId: char.id,
          spellId: body.spellId,
          prepared,
          classSource,
          source: body.source === 'invocation' ? 'invocation' : null,
        })
        .onConflictDoUpdate({
          target: [characterSpells.characterId, characterSpells.spellId],
          set: {
            prepared: sql`excluded.prepared`,
            classSource: sql`COALESCE(excluded.class_source, character_spells.class_source)`,
            source: sql`COALESCE(excluded.source, character_spells.source)`,
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
        action: 'sheet',
        actorUserId: userId,
      });
      const lang = langFromReq(req);
      return reply
        .code(201)
        .send({ spell: localizeCharacterSpell(mapCharacterSpell(row, lang), lang) });
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
      if (!resolved)
        return reply.code(404).send({ error: apiMsg(req, 'character spell not found') });
      const { link, char } = resolved;
      if (
        !checkCharacterAccess(req, reply, char, userId, {
          access: 'owner-or-gm',
          requireMember: true,
          forbiddenMsg: 'only the owner or GM can modify spells',
        })
      )
        return;

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.prepared !== undefined) values.prepared = body.prepared ? 1 : 0;
      if (body.sortOrder !== undefined) values.sortOrder = Math.floor(body.sortOrder);
      if (body.classSource !== undefined) values.classSource = body.classSource || null;
      if (body.source !== undefined) values.source = body.source || null;
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
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
        action: 'sheet',
        actorUserId: userId,
      });
      const lang = langFromReq(req);
      return reply.send({ spell: localizeCharacterSpell(mapCharacterSpell(row, lang), lang) });
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
      if (!resolved)
        return reply.code(404).send({ error: apiMsg(req, 'character spell not found') });
      const { link, char } = resolved;
      if (
        !checkCharacterAccess(req, reply, char, userId, {
          access: 'owner-or-gm',
          requireMember: true,
          forbiddenMsg: 'only the owner or GM can modify spells',
        })
      )
        return;

      drizzle.delete(characterSpells).where(eq(characterSpells.id, link.id)).run();
      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'sheet',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
