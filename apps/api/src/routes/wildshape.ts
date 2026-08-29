/**
 * Wild Shape routes (Druide, SRD): eligible beast list, shape, revert.
 *
 * While shaped, the character's HP bar IS the beast's HP (wild_shape_hp);
 * damage from the sheet or the combat tracker routes there, and hitting 0
 * reverts with excess damage carried over to the normal form (SRD).
 */

import {
  abilityModifier,
  computeAC,
  findClass,
  MOON_ELEMENTAL_SLUGS,
  rollHitPoints,
  wildShapeCanFly,
  wildShapeCanSwim,
  wildShapeMaxCR,
} from '@table-sync/shared';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import {
  characterClasses,
  characters,
  combatants,
  encounters,
  inventory,
  items,
  monsters,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { isPartyGM, requireUser } from './helpers.ts';
import { langFromReq, pickLocalized } from './lang.ts';
import { apiMsg } from './messages.ts';

/** Ligne Druide du personnage : niveau de CLASSE + cercle (multiclassage SRD). */
function druidLine(char: any): { level: number; circle: string | null } {
  const rows = getDrizzle()
    .select({
      class_key: characterClasses.classKey,
      level: characterClasses.level,
      subclass_key: characterClasses.subclassKey,
    })
    .from(characterClasses)
    .where(eq(characterClasses.characterId, char.id))
    .orderBy(characterClasses.position, characterClasses.id)
    .all() as any[];
  const line = rows.find((r) => r.class_key === 'Druide');
  if (line) return { level: line.level ?? 1, circle: line.subclass_key ?? null };
  // Défensif (les lignes existent toujours après migration)
  if (findClass(char.character_class)?.name === 'Druide') {
    return { level: char.level ?? 1, circle: char.druid_circle ?? null };
  }
  return { level: 0, circle: null };
}

interface BeastRow {
  slug: string;
  name_fr: string | null;
  overlay_en: string | null;
  challenge_rating: number;
  size: string | null;
  armor_class: number | null;
  hit_points: number | null;
  hit_dice: string | null;
  speed_json: string | null;
}

function parseSpeed(raw: string | null): { fly: boolean; swim: boolean } {
  if (!raw) return { fly: false, swim: false };
  try {
    const speed = JSON.parse(raw);
    return { fly: speed.fly != null, swim: speed.swim != null };
  } catch {
    return { fly: false, swim: false };
  }
}

/** Beast-list projection (summary fields only). */
const BEAST_COLS = {
  slug: monsters.slug,
  name_fr: monsters.nameFr,
  overlay_en: monsters.overlayEn,
  challenge_rating: monsters.challengeRating,
  size: monsters.size,
  armor_class: monsters.armorClass,
  hit_points: monsters.hitPoints,
  hit_dice: monsters.hitDice,
  speed_json: monsters.speedJson,
};

/** Nom EN de l'overlay d'une bête (repli null → nom FR servi tel quel). */
function beastNameEn(row: BeastRow): string | null {
  if (!row.overlay_en) return null;
  try {
    const parsed = typeof row.overlay_en === 'string' ? JSON.parse(row.overlay_en) : row.overlay_en;
    return parsed && typeof parsed === 'object' && typeof parsed.name === 'string'
      ? parsed.name
      : null;
  } catch {
    return null;
  }
}

/** All of the character's combatants in non-ended encounters (newest first). */
function findActiveCombatants(characterId: number): any[] {
  return (
    getDrizzle()
      .select(cols(combatants))
      .from(combatants)
      .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
      .where(
        and(
          eq(combatants.characterId, characterId),
          eq(combatants.type, 'player'),
          ne(encounters.status, 'ended'),
        ),
      )
      // newest encounter first, latest-added combatant first
      .orderBy(desc(encounters.createdAt), desc(combatants.id))
      .all() as any[]
  );
}

/** Recompute the character's normal AC from equipped armor. */
function normalAC(char: any): number | null {
  const rows = getDrizzle()
    .select({
      category: items.category,
      ac_base: items.acBase,
      str_min: items.strMin,
      name_fr: items.nameFr,
      name: items.name,
      equipped: inventory.equipped,
    })
    .from(inventory)
    .innerJoin(items, eq(items.id, inventory.itemId))
    .where(and(eq(inventory.characterId, char.id), eq(inventory.equipped, 1)))
    .all() as any[];
  const dexMod = abilityModifier(char.dexterity ?? 10);
  const acResult = computeAC(
    rows.map((r) => ({
      item: {
        category: r.category,
        acBase: r.ac_base,
        strMin: r.str_min,
        nameFr: r.name_fr,
        name: r.name,
      },
      equipped: !!r.equipped,
    })),
    dexMod,
    char.fighting_style === 'defense',
    char,
  );
  return char.armor_class_override ?? acResult.ac;
}

function getCharacter(id: number): any {
  return getDrizzle()
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

export async function wildShapeRoutes(app: FastifyInstance) {
  // ===== Eligible beast list for this druid =====
  app.get(
    '/characters/:id/wild-shape/forms',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const char = getCharacter(Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'Personnage introuvable') });
      const gm = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !gm) {
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au propriétaire ou au MD') });
      }

      const { level, circle } = druidLine(char);
      const isMoon = circle === 'lune';
      const maxCR = wildShapeMaxCR(level, circle);
      const canSwim = wildShapeCanSwim(level);
      const canFly = wildShapeCanFly(level);
      // Circle of the Moon, level 10: Elemental Wild Shape
      const includeElementals = isMoon && level >= 10;

      const rows = getDrizzle()
        .select(BEAST_COLS)
        .from(monsters)
        .where(
          includeElementals
            ? or(
                eq(monsters.type, 'Bête'),
                inArray(monsters.slug, [
                  'elementaire-de-l-air',
                  'elementaire-de-l-eau',
                  'elementaire-de-la-terre',
                  'elementaire-du-feu',
                ]),
              )
            : eq(monsters.type, 'Bête'),
        )
        .orderBy(monsters.challengeRating, sql`${monsters.nameFr} COLLATE NOCASE`)
        .all() as BeastRow[];

      // SRD: only beasts the druid has seen before
      let seen: string[] = [];
      try {
        const parsed = JSON.parse(char.wild_shape_seen_json ?? '[]');
        if (Array.isArray(parsed)) seen = parsed;
      } catch {
        /* default empty */
      }

      const lang = langFromReq(req);
      const forms = rows
        .map((r) => ({ row: r, speed: parseSpeed(r.speed_json) }))
        // Moon elementals are their own rule (CR 5), not gated by maxCR
        .filter(
          ({ row, speed }) =>
            (includeElementals && (MOON_ELEMENTAL_SLUGS as readonly string[]).includes(row.slug)) ||
            (row.challenge_rating <= maxCR && (!speed.fly || canFly) && (!speed.swim || canSwim)),
        )
        .map(({ row, speed }) => ({
          slug: row.slug,
          nameFr: row.name_fr,
          // Mono-locale comme le reste de l'API (overlay EN, repli FR) —
          // le sélecteur de forme n'est plus FR-only.
          name: pickLocalized(lang, beastNameEn(row), row.name_fr) ?? row.slug,
          challengeRating: row.challenge_rating,
          size: row.size,
          armorClass: row.armor_class,
          hitPoints: row.hit_points,
          hitDice: row.hit_dice,
          fly: speed.fly,
          swim: speed.swim,
          seen: seen.includes(row.slug),
        }));

      return reply.send({
        forms,
        uses: char.wild_shape_uses ?? 2,
        unlimited: level >= 20, // Archidruide (niveau de CLASSE Druide 20)
        shaped: char.wild_shape_slug ?? null,
        maxCR,
        canSwim,
        canFly,
        circle: isMoon ? 'lune' : null,
        bonusActionShape: isMoon,
        elementals: includeElementals,
      });
    },
  );

  // ===== Enter Wild Shape =====
  app.post(
    '/characters/:id/wild-shape',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { slug?: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const char = getCharacter(Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'Personnage introuvable') });
      const gm = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !gm) {
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au propriétaire ou au MD') });
      }
      if (char.wild_shape_slug) {
        return reply.code(400).send({ error: apiMsg(req, 'Déjà sous forme animale') });
      }
      // Archidruide (niveau 20) : forme sauvage illimitée
      if ((char.wild_shape_uses ?? 2) <= 0 && druidLine(char).level < 20) {
        return reply.code(400).send({ error: "Plus d'utilisations — repos court requis" });
      }

      const drizzle = getDrizzle();
      const beast = drizzle
        .select(cols(monsters))
        .from(monsters)
        .where(eq(monsters.slug, req.body?.slug ?? ''))
        .get() as any;
      // monsters are French-only in the catalog
      if (!beast)
        return reply.code(404).send({ error: apiMsg(req, 'Forme introuvable dans le bestiaire') });

      // SRD: the druid must have seen the beast before
      let seenList: string[] = [];
      try {
        const parsed = JSON.parse(char.wild_shape_seen_json ?? '[]');
        if (Array.isArray(parsed)) seenList = parsed;
      } catch {
        /* default empty */
      }
      if (!seenList.includes(beast.slug)) {
        return reply.code(400).send({ error: "Vous n'avez jamais vu cette bête" });
      }

      const { level, circle } = druidLine(char);
      const maxCR = wildShapeMaxCR(level, circle);
      const speed = parseSpeed(beast.speed_json);
      const isMoonElemental =
        (MOON_ELEMENTAL_SLUGS as readonly string[]).includes(beast.slug) &&
        circle === 'lune' &&
        level >= 10;
      const eligible =
        isMoonElemental ||
        (beast.type === 'Bête' &&
          beast.challenge_rating <= maxCR &&
          (!speed.fly || wildShapeCanFly(level)) &&
          (!speed.swim || wildShapeCanSwim(level)));
      if (!eligible) {
        return reply.code(400).send({ error: apiMsg(req, 'Forme non autorisée à ce niveau') });
      }

      // Roll the beast's HP from its hit dice
      const hp = rollHitPoints(beast.hit_dice, beast.hit_points ?? 1, 0);

      const db = getDb();
      db.transaction(() => {
        // Niveau 20 (Archidruide) : pas de décrément
        const uses = druidLine(char).level >= 20;
        drizzle
          .update(characters)
          .set({
            wildShapeSlug: beast.slug,
            wildShapeHp: hp,
            wildShapeMaxHp: hp,
            wildShapeUses: uses
              ? sql`${characters.wildShapeUses}`
              : sql`${characters.wildShapeUses} - 1`,
          })
          .where(eq(characters.id, char.id))
          .run();

        // The combat tracker combatants become the beast
        for (const combatant of findActiveCombatants(char.id)) {
          drizzle
            .update(combatants)
            .set({
              name: `${char.name} (${beast.name_fr ?? beast.slug})`,
              hitPoints: hp,
              maxHitPoints: hp,
              armorClass: beast.armor_class ?? 10,
              defeated: 0,
            })
            .where(eq(combatants.id, combatant.id))
            .run();
        }
      })();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      bus.emitChange({
        type: 'combat:change',
        partyId: char.party_id,
        action: 'hp',
        actorUserId: userId,
      });
      return reply.code(201).send({
        shape: {
          slug: beast.slug,
          nameFr: beast.name_fr ?? beast.slug,
          hp,
          maxHp: hp,
          armorClass: beast.armor_class ?? 10,
        },
      });
    },
  );

  // ===== Revert to normal form =====
  app.post(
    '/characters/:id/wild-shape/revert',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const char = getCharacter(Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'Personnage introuvable') });
      const gm = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !gm) {
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au propriétaire ou au MD') });
      }
      if (!char.wild_shape_slug) {
        return reply.code(400).send({ error: apiMsg(req, 'Pas sous forme animale') });
      }

      // SRD: return to the pre-shape HP; excess damage when dropped to 0 carries over
      const shapeHp = char.wild_shape_hp ?? 0;
      let newHp = char.current_hp ?? 1;
      let carried = 0;
      if (shapeHp < 0) {
        carried = -shapeHp;
        newHp = Math.max(0, newHp - carried);
      }

      const db = getDb();
      const drizzle = getDrizzle();
      db.transaction(() => {
        drizzle
          .update(characters)
          .set({
            wildShapeSlug: null,
            wildShapeHp: null,
            wildShapeMaxHp: null,
            currentHp: newHp,
          })
          .where(eq(characters.id, char.id))
          .run();

        // Combatants go back to the normal form
        for (const combatant of findActiveCombatants(char.id)) {
          const ac = normalAC(char);
          drizzle
            .update(combatants)
            .set({
              name: char.name,
              hitPoints: newHp,
              maxHitPoints: char.max_hp ?? 1,
              armorClass: ac ?? 10,
              defeated: newHp <= 0 ? 1 : 0,
            })
            .where(eq(combatants.id, combatant.id))
            .run();
        }
      })();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      bus.emitChange({
        type: 'combat:change',
        partyId: char.party_id,
        action: 'hp',
        actorUserId: userId,
      });
      return reply.send({ hp: newHp, excessDamage: carried });
    },
  );
}
