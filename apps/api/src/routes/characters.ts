/**
 * Character routes: create, list, get, update, delete.
 */

import type {
  ConcentrationCheck,
  CreateCharacterPayload,
  PatchCharacterPayload,
} from '@table-sync/shared';
import {
  abilityModifier,
  CLASS_SUBCLASSES,
  CONCENTRATION_BREAKING_CONDITIONS_FR,
  computeAC,
  raceSpeedMeters,
} from '@table-sync/shared';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
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
  users,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  attachCharacterClasses,
  characterVisibleTo,
  isPartyGM,
  isPartyMember,
  mapCharacter,
  mapCharacterSummary,
  mirrorConditionsToCombatants,
  replaceCharacterClasses,
  requireUser,
  validateClassEntries,
} from './helpers.ts';
import { apiMsg } from './messages.ts';

/** characters.* + the owner's display_name (JOIN users) — the mappers' shape. */
const CHARACTER_WITH_OWNER = { ...cols(characters), owner_name: users.displayName };

function getCharacterWithOwner(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(CHARACTER_WITH_OWNER)
    .from(characters)
    .innerJoin(users, eq(users.id, characters.ownerId))
    .where(eq(characters.id, id))
    .get() as any;
}

/** The character's player combatants in non-ended encounters (newest first). */
function activePlayerCombatants(characterId: number): any[] {
  return getDrizzle()
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
    .orderBy(desc(encounters.createdAt), desc(combatants.id))
    .all() as any[];
}

/** AC input rows from the character's equipped items (sheet-side recompute). */
function equippedAcRows(characterId: number): any[] {
  return getDrizzle()
    .select({
      category: items.category,
      ac_base: items.acBase,
      str_min: items.strMin,
      name_fr: items.nameFr,
      name: items.name,
    })
    .from(inventory)
    .innerJoin(items, eq(items.id, inventory.itemId))
    .where(and(eq(inventory.characterId, characterId), eq(inventory.equipped, 1)))
    .all() as any[];
}

export async function characterRoutes(app: FastifyInstance) {
  // ---------- Create character in a party ----------
  app.post(
    '/parties/:partyId/characters',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateCharacterPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const body = req.body || ({} as CreateCharacterPayload);
      if (!body.name?.trim())
        return reply.code(400).send({ error: apiMsg(req, 'name is required') });
      const ability = (value: number | undefined, fallback: number): number => {
        const score = value ?? fallback;
        if (score < 1 || score > 30) return -1;
        return score;
      };
      const abilities = {
        strength: ability(body.strength, 10),
        dexterity: ability(body.dexterity, 10),
        constitution: ability(body.constitution, 10),
        intelligence: ability(body.intelligence, 10),
        wisdom: ability(body.wisdom, 10),
        charisma: ability(body.charisma, 10),
      };
      for (const [label, score] of Object.entries(abilities)) {
        if (score < 0) return reply.code(400).send({ error: `${label} must be between 1 and 30` });
      }
      const maxHp = body.maxHp ?? 1;
      if (maxHp < 1) return reply.code(400).send({ error: apiMsg(req, 'maxHp must be ≥ 1') });
      const currentHp = body.currentHp ?? maxHp;
      const capMult = body.capacityMultiplier ?? 1;
      // Vitesse de base : explicite (fiche libre) sinon dérivée de l'espèce
      // SRD (petites races 7,5 m, Elfe des bois 10,5 m…), repli 9 m.
      const speed =
        typeof body.speed === 'number' && Number.isFinite(body.speed) && body.speed >= 0
          ? body.speed
          : (raceSpeedMeters(body.race) ?? 9);
      const skillProficiencies = (body.skillProficiencies ?? []).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      );
      const languages = (body.languages ?? []).filter(
        (l): l is string => typeof l === 'string' && l.trim().length > 0,
      );

      const drizzle = getDrizzle();
      const { id: charId } = drizzle
        .insert(characters)
        .values({
          partyId,
          ownerId: userId,
          name: body.name.trim(),
          strength: abilities.strength,
          dexterity: abilities.dexterity,
          constitution: abilities.constitution,
          intelligence: abilities.intelligence,
          wisdom: abilities.wisdom,
          charisma: abilities.charisma,
          capacityMultiplier: capMult,
          characterClass: body.characterClass ?? null,
          level: body.level ?? 1,
          race: body.race ?? null,
          background: body.background ?? null,
          skillProficiencies: JSON.stringify(skillProficiencies),
          languages: JSON.stringify(languages),
          maxHp,
          currentHp,
          speed,
          hidden: body.hidden ? 1 : 0,
        })
        .returning({ id: characters.id })
        .get();
      // Multiclassage : lignes de classe (toujours présentes, même mono-classe)
      const classPayload =
        body.classes ??
        (body.characterClass ? [{ classKey: body.characterClass, level: body.level ?? 1 }] : []);
      if (classPayload.length > 0) {
        const validated = validateClassEntries(classPayload);
        if (!validated.ok) return reply.code(400).send({ error: validated.error });
        replaceCharacterClasses(charId, validated.entries);
      }
      const row = getCharacterWithOwner(drizzle, charId);
      attachCharacterClasses([row]);
      bus.emitChange({
        type: 'party:change',
        partyId,
        characterId: charId,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(201).send({ character: mapCharacterSummary(row) });
    },
  );

  // ---------- List characters in a party ----------
  app.get(
    '/parties/:partyId/characters',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const rows = getDrizzle()
        .select(CHARACTER_WITH_OWNER)
        .from(characters)
        .innerJoin(users, eq(users.id, characters.ownerId))
        .where(eq(characters.partyId, partyId))
        .orderBy(sql`${characters.name} COLLATE NOCASE ASC`)
        .all() as any[];
      // Hidden characters leave the party listing for everyone but their
      // owner and the GM.
      const callerIsGM = isPartyGM(partyId, userId);
      const visible = rows.filter((row) => !row.hidden || row.owner_id === userId || callerIsGM);
      attachCharacterClasses(visible);
      return reply.send({ characters: visible.map(mapCharacterSummary) });
    },
  );

  // ---------- Get single character ----------
  app.get(
    '/characters/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const row = getCharacterWithOwner(getDrizzle(), Number(req.params.id));
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(row.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      // 404 (not 403): a hidden character must not betray its existence
      if (!characterVisibleTo(row, userId))
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      attachCharacterClasses([row]);
      return reply.send({ character: mapCharacter(row) });
    },
  );

  // ---------- Update character ----------
  app.patch(
    '/characters/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchCharacterPayload }>,
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
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      // Owner or GM can edit
      const isGM = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !isGM) {
        return reply.code(403).send({ error: apiMsg(req, 'only the owner or GM can edit') });
      }
      // Visibility is the owner's call alone — not even the GM flips it
      const body = req.body || {};
      if (body.hidden !== undefined && char.owner_id !== userId) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'seul le propriétaire peut changer la visibilité') });
      }
      const hiding = body.hidden === true && !char.hidden;
      // Speed is metric meters — halves are valid (small races: 7.5 m)
      if (
        body.speed !== undefined &&
        (typeof body.speed !== 'number' || !Number.isFinite(body.speed) || body.speed < 0)
      ) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'vitesse invalide (nombre positif en mètres)') });
      }
      // Coins are whole, non-negative counts — anything else is a client bug
      for (const coinKey of ['copper', 'silver', 'electrum', 'gold', 'platinum'] as const) {
        const coinValue = body[coinKey];
        if (
          coinValue !== undefined &&
          (typeof coinValue !== 'number' || !Number.isFinite(coinValue))
        ) {
          return reply
            .code(400)
            .send({ error: apiMsg(req, 'montant de bourse invalide (nombre entier positif)') });
        }
      }
      const COIN_CLAMP_MAX = 999_999_999;
      const allowed: (keyof PatchCharacterPayload)[] = [
        'name',
        'strength',
        'capacityMultiplier',
        'exhaustion',
        'conditions',
        'foodDays',
        'waterDays',
        'maxHp',
        'currentHp',
        'tempHp',
        'notes',
        'copper',
        'silver',
        'electrum',
        'gold',
        'platinum',
        // Character sheet
        'level',
        'dexterity',
        'constitution',
        'intelligence',
        'wisdom',
        'charisma',
        'characterClass',
        'race',
        'background',
        'speed',
        'skillProficiencies',
        'skillExpertise',
        'toolProficiencies',
        'toolExpertise',
        'languages',
        'savingThrowProficiencies',
        'weaponProficiencies',
        'armorProficiencies',
        'fightingStyle',
        'spellSlotsUsed',
        'pactSlotsUsed',
        'unarmoredDefense',
        // Description / personality
        'alignment',
        'sex',
        'height',
        'weight',
        'age',
        'skin',
        'eyes',
        'hair',
        'portraitUrl',
        'personalityTraits',
        'ideals',
        'bonds',
        'flaws',
        'appearance',
        'backstory',
        'alliesOrganizations',
        'armorClassOverride',
        'deathSaveSuccesses',
        'deathSaveFailures',
        'inspiration',
        'concentrating',
        'hidden',
        'wildShapeHp',
        'wildShapeUses',
        'hitDiceUsed',
        'wildShapeSeen',
        'druidCircle',
        'divineDomain',
        'landCircle',
        'sacredOath',
        'subclass',
      ];
      // Payload key → characters column property. Every key maps to the
      // identically-named schema property except wildShapeSeen (stored in
      // wild_shape_seen_json).
      const propMap: Record<string, keyof typeof characters.$inferInsert> = {
        wildShapeSeen: 'wildShapeSeenJson',
      };
      // Fields stored as JSON arrays — serialize on write
      const jsonFields = new Set([
        'conditions',
        'skillProficiencies',
        'skillExpertise',
        'toolProficiencies',
        'toolExpertise',
        'languages',
        'savingThrowProficiencies',
        'weaponProficiencies',
        'armorProficiencies',
        'spellSlotsUsed',
        'pactSlotsUsed',
        'wildShapeSeen',
      ]);
      // Built in `allowed` order; later assignments overwrite earlier ones
      // (same last-write-wins semantics as the old SET list).
      const values: Record<string, unknown> = {};
      for (const key of allowed) {
        if (body[key] !== undefined) {
          const prop = propMap[key as string] ?? key;
          const nullResetsClassDefault =
            key === 'weaponProficiencies' || key === 'armorProficiencies';
          if (nullResetsClassDefault && body[key] === null) {
            values[prop] = null; // null = back to class default
            continue;
          }
          if (jsonFields.has(key as string)) {
            values[prop] = JSON.stringify(body[key]);
          } else if (typeof body[key] === 'boolean') {
            values[prop] = body[key] ? 1 : 0;
          } else if (['copper', 'silver', 'electrum', 'gold', 'platinum'].includes(key)) {
            values[prop] = Math.min(COIN_CLAMP_MAX, Math.max(0, Math.trunc(body[key] as number)));
          } else {
            values[prop] = body[key];
          }
        }
      }
      // Multiclassage : remplacement atomique des lignes de classe + re-sync
      // des colonnes dénormalisées (classe de départ, niveau total…).
      if (body.classes !== undefined) {
        const validated = validateClassEntries(body.classes);
        if (!validated.ok) return reply.code(400).send({ error: validated.error });
        replaceCharacterClasses(char.id, validated.entries);
      }
      // Espèce modifiée sans vitesse explicite : la vitesse de base SUIT
      // l'espèce tant que le joueur ne l'a pas personnalisée. « Pas touchée »
      // = encore la valeur par défaut de son espèce d'origine (9 m, ou celle
      // dérivée à la création depuis 2026-09).
      if (body.race !== undefined && body.speed === undefined) {
        const oldDefault = raceSpeedMeters(char.race) ?? 9;
        if (char.speed === oldDefault) {
          const next = raceSpeedMeters(body.race) ?? 9;
          if (next !== char.speed) values.speed = next;
        }
      }
      if (Object.keys(values).length === 0 && body.classes === undefined) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }

      // --- Wild Shape: while shaped, HP edits target the beast's bar.
      // Hitting 0 reverts with excess damage carried over (SRD), and the
      // tracker combatant follows the shape's bar (or the normal form back).
      if (body.currentHp !== undefined && char.wild_shape_slug) {
        const shapeHp = Math.max(0, body.currentHp);
        const combatantsOnShape = activePlayerCombatants(char.id);

        if (shapeHp <= 0) {
          // Auto-revert with carry-over — atomic: the sheet write and the
          // combatant HP mirrors must land together or the sheet/tracker
          // state splits.
          const excess = -body.currentHp;
          const newHp = Math.max(0, (char.current_hp ?? 1) - excess);
          getDb().transaction(() => {
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
            for (const combatant of combatantsOnShape) {
              const acRows = equippedAcRows(char.id);
              const acResult = computeAC(
                acRows.map((r) => ({
                  item: {
                    category: r.category,
                    acBase: r.ac_base,
                    strMin: r.str_min,
                    nameFr: r.name_fr,
                    name: r.name,
                  },
                  equipped: true,
                })),
                abilityModifier(char.dexterity ?? 10),
                char.fighting_style === 'defense',
                char,
              );
              drizzle
                .update(combatants)
                .set({
                  name: char.name,
                  hitPoints: newHp,
                  maxHitPoints: char.max_hp ?? 1,
                  armorClass: char.armor_class_override ?? acResult.ac,
                  defeated: newHp <= 0 ? 1 : 0,
                })
                .where(eq(combatants.id, combatant.id))
                .run();
            }
          })();
        } else {
          getDb().transaction(() => {
            drizzle
              .update(characters)
              .set({ wildShapeHp: shapeHp })
              .where(eq(characters.id, char.id))
              .run();
            for (const combatant of combatantsOnShape) {
              drizzle
                .update(combatants)
                .set({
                  hitPoints: shapeHp,
                  maxHitPoints: char.wild_shape_max_hp ?? shapeHp,
                  defeated: 0,
                })
                .where(eq(combatants.id, combatant.id))
                .run();
            }
          })();
        }
        if (combatantsOnShape.length > 0) {
          bus.emitChange({
            type: 'combat:change',
            partyId: char.party_id,
            action: 'hp',
            actorUserId: userId,
          });
        }
        // The shape bar was written — currentHp must not be applied again below
        (body as any).currentHp = undefined;
        const remaining = Object.entries(body).filter(([, v]) => v !== undefined);
        if (remaining.length === 0) {
          const rowAfter = getCharacterWithOwner(drizzle, char.id);
          attachCharacterClasses([rowAfter]);
          return reply.send({ character: mapCharacter(rowAfter) });
        }
      }

      // --- Concentration: a CON save (DC 10 or half damage, highest) is
      // required whenever the character TAKES damage while concentrating —
      // PHB p.203. Damage absorbed by temporary HP still counts: when the
      // Survie hero sends currentHp + tempHp in one payload, the damage taken
      // is the real loss PLUS the temp absorbed.
      let concentrationCheck: ConcentrationCheck | null = null;
      if (body.currentHp !== undefined) {
        const concentratingAfter =
          body.concentrating !== undefined ? !!body.concentrating : !!char.concentrating;
        const realDamage = Math.max(0, (char.current_hp ?? 0) - body.currentHp);
        const tempAbsorbed =
          body.tempHp !== undefined ? Math.max(0, (char.temp_hp ?? 0) - body.tempHp) : 0;
        const damage = realDamage + tempAbsorbed;
        if (concentratingAfter && damage > 0 && body.currentHp > 0) {
          concentrationCheck = {
            characterId: char.id,
            characterName: char.name,
            damage,
            dc: Math.max(10, Math.floor(damage / 2)),
            ownerId: char.owner_id,
          };
        }
        // At 0 HP the character is unconscious → concentration ends automatically.
        // Temp HP remaining means the hit hasn't put them down — concentration holds.
        if (
          concentratingAfter &&
          body.currentHp <= 0 &&
          (body.tempHp ?? char.temp_hp ?? 0) <= 0 &&
          body.concentrating === undefined
        ) {
          values.concentrating = 0;
        }
      }

      // --- Concentration: applying an incapacitating condition
      // (Inconscient, Paralysé, Pétrifié, Étourdi, Neutralisé) breaks it.
      let concentrationBroken: string | null = null;
      if (body.conditions && char.concentrating && body.concentrating !== false) {
        const breaking = body.conditions.find((c) =>
          CONCENTRATION_BREAKING_CONDITIONS_FR.includes(c),
        );
        if (breaking) {
          concentrationBroken = breaking;
          if (body.concentrating === undefined) {
            values.concentrating = 0;
          }
        }
      }

      // --- HP sync: mirror PV/PV max changes to this character's combatants
      // in non-ended encounters, so the combat tracker shows the same HP
      // (and defeated state) as the sheet. Targets read up-front; the writes
      // themselves join the atomic block below.
      const hpMirrorTargets =
        body.currentHp !== undefined || body.maxHp !== undefined
          ? getDrizzle()
              .select({ id: combatants.id })
              .from(combatants)
              .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
              .where(
                and(
                  eq(combatants.characterId, char.id),
                  eq(combatants.type, 'player'),
                  ne(encounters.status, 'ended'),
                ),
              )
              .all()
          : [];

      // --- One atomic write sequence: the sheet UPDATE, the HP/condition
      // mirrors onto tracker combatants and the hidden-character roster
      // cleanup are a single unit — a mid-failure must not split
      // sheet/tracker state. (The condition mirror may emit a sync event
      // from inside the tx; events are best-effort refresh nudges, so a
      // rollback just leaves clients on the pre-tx state.)
      const writeTx = getDb().transaction(() => {
        if (Object.keys(values).length > 0) {
          drizzle.update(characters).set(values).where(eq(characters.id, char.id)).run();
        }

        for (const cr of hpMirrorTargets) {
          const valuesC: Record<string, unknown> = {};
          if (body.currentHp !== undefined) {
            valuesC.hitPoints = Math.max(0, body.currentHp);
            // Mirror the defeated state the tracker derives from HP — temp HP
            // remaining keeps the character up (same rule as the death saves).
            valuesC.defeated =
              body.currentHp <= 0 && (body.tempHp ?? char.temp_hp ?? 0) <= 0 ? 1 : 0;
          }
          if (body.maxHp !== undefined) {
            valuesC.maxHitPoints = Math.max(1, body.maxHp);
          }
          drizzle.update(combatants).set(valuesC).where(eq(combatants.id, cr.id)).run();
        }

        // --- Condition sync: sheet condition changes mirror to the combat
        // tracker (diff vs the previous list, durations left untouched).
        if (body.conditions !== undefined) {
          try {
            const prev: string[] = char.conditions
              ? typeof char.conditions === 'string'
                ? JSON.parse(char.conditions)
                : char.conditions
              : [];
            const nextList: string[] = body.conditions;
            mirrorConditionsToCombatants(
              char.party_id,
              char.id,
              nextList.filter((c) => !prev.includes(c)),
              prev.filter((c) => !nextList.includes(c)),
              userId,
            );
          } catch {
            /* mirror is best-effort */
          }
        }

        // --- Visibility: a hidden character is inactive everywhere — pull its
        // player combatants out of non-ended encounters (ended fights keep
        // their history) so rosters never leak its presence.
        if (hiding) {
          return drizzle
            .delete(combatants)
            .where(
              and(
                eq(combatants.characterId, char.id),
                eq(combatants.type, 'player'),
                inArray(
                  combatants.encounterId,
                  getDrizzle()
                    .select({ id: encounters.id })
                    .from(encounters)
                    .where(
                      and(eq(encounters.partyId, char.party_id), ne(encounters.status, 'ended')),
                    ),
                ),
              ),
            )
            .run().changes;
        }
        return 0;
      });
      const removedCount = writeTx();

      // --- Champs de classe « plats » (rétrocompat mono-classe) : les reporter
      // sur les lignes de classe, qui font foi pour le moteur (multiclassage).
      // Une fiche multiclassée s'édite via classes[] — un `level` seul sur une
      // telle fiche est ambigu et ne touche pas les lignes.
      const legacyClassFields = [
        'characterClass',
        'level',
        'subclass',
        'divineDomain',
        'druidCircle',
        'sacredOath',
        'fightingStyle',
      ] as const;
      const changedLegacy = legacyClassFields.filter((f) => (body as any)[f] !== undefined);
      const classRows = getDrizzle()
        .select(cols(characterClasses))
        .from(characterClasses)
        .where(eq(characterClasses.characterId, char.id))
        .orderBy(characterClasses.position, characterClasses.id)
        .all() as any[];
      if (changedLegacy.length > 0) {
        const entries =
          classRows.length > 0
            ? classRows.map((r) => ({
                classKey: r.class_key as string,
                level: r.level as number,
                subclassKey: (r.subclass_key as string | null) ?? null,
                hitDiceUsed: (r.hit_dice_used as number) ?? 0,
                fightingStyle: (r.fighting_style as string | null) ?? null,
              }))
            : [
                {
                  classKey: (body.characterClass ?? char.character_class ?? '') as string,
                  level: (body.level ?? char.level ?? 1) as number,
                  subclassKey: (body.divineDomain ??
                    char.divine_domain ??
                    body.druidCircle ??
                    char.druid_circle ??
                    body.sacredOath ??
                    char.sacred_oath ??
                    body.subclass ??
                    char.subclass ??
                    null) as string | null,
                  hitDiceUsed: (char.hit_dice_used as number) ?? 0,
                  fightingStyle: (body.fightingStyle ?? char.fighting_style ?? null) as
                    | string
                    | null,
                },
              ];
        const first = entries[0];
        if (body.characterClass !== undefined) first.classKey = body.characterClass;
        if (body.level !== undefined) {
          // `level` plat = niveau TOTAL : le delta va sur la DERNIÈRE ligne
          // (la classe en cours d'avancement — convention du multiclassage ;
          // mono-classe, c'est simplement la ligne unique). Une sous-classe
          // qui passe sous son palier RAW est retirée de la ligne.
          const delta = body.level - entries.reduce((sum, e) => sum + e.level, 0);
          const last = entries[entries.length - 1];
          last.level = Math.max(1, last.level + delta);
          for (const e of entries) {
            if (!e.subclassKey) continue;
            const def = (CLASS_SUBCLASSES[e.classKey] ?? []).find((s) => s.key === e.subclassKey);
            if (def && def.level > e.level) e.subclassKey = null;
          }
        }
        if (entries.length === 1) {
          if (first.classKey === 'Clerc' && body.divineDomain !== undefined) {
            first.subclassKey = body.divineDomain;
          } else if (first.classKey === 'Druide' && body.druidCircle !== undefined) {
            first.subclassKey = body.druidCircle;
          } else if (first.classKey === 'Paladin' && body.sacredOath !== undefined) {
            first.subclassKey = body.sacredOath;
          } else if (body.subclass !== undefined) {
            first.subclassKey = body.subclass;
          }
        }
        if (body.fightingStyle !== undefined) first.fightingStyle = body.fightingStyle;
        const validated = validateClassEntries(entries);
        // Une fiche héritée peut dévier du catalogue (sous-classe hors palier) :
        // on synchronise seulement l'état valide, sans rejeter l'écriture.
        if (validated.ok) replaceCharacterClasses(char.id, validated.entries);
      }

      if (hpMirrorTargets.length > 0) {
        bus.emitChange({
          type: 'combat:change',
          partyId: char.party_id,
          action: 'hp',
          actorUserId: userId,
        });
      }
      if (removedCount > 0) {
        bus.emitChange({
          type: 'combat:change',
          partyId: char.party_id,
          action: 'remove',
          actorUserId: userId,
        });
      }

      const row = getCharacterWithOwner(drizzle, char.id);
      attachCharacterClasses([row]);
      // Detect if this was a coin change vs stat change for the event action
      const coinKeys = ['copper', 'silver', 'electrum', 'gold', 'platinum'];
      const isCoinChange = Object.keys(body).some((k) => coinKeys.includes(k));
      // Visibility changes alter every member's party list — broadcast a
      // party:change (character:change for a hidden char wouldn't fan out).
      const visibilityChanged = body.hidden !== undefined;
      bus.emitChange({
        type: visibilityChanged ? 'party:change' : 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: visibilityChanged ? 'stats' : isCoinChange ? 'coins' : 'stats',
        actorUserId: userId,
        ...(concentrationCheck ? { concentration: concentrationCheck } : {}),
      });
      return reply.send({
        character: mapCharacter(row),
        ...(concentrationCheck ? { concentrationCheck } : {}),
        ...(concentrationBroken ? { concentrationBroken } : {}),
      });
    },
  );

  // ---------- Delete character ----------
  app.delete(
    '/characters/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      const isGM = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !isGM) {
        return reply.code(403).send({ error: apiMsg(req, 'only the owner or GM can delete') });
      }
      drizzle.delete(characters).where(eq(characters.id, char.id)).run();
      bus.emitChange({
        type: 'party:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
