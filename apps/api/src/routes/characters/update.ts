/**
 * Fiche personnage — PATCH /characters/:id : mise à jour centrale (validation
 * des champs, forme sauvage, concentration/rage, miroirs HP/CA/conditions vers
 * le traqueur, visibilité).
 * Découpage 2026-11 (phase 4) : déplacement pur depuis routes/characters.ts.
 */

import type { ConcentrationCheck, PatchCharacterPayload } from '@table-sync/shared';
import {
  abilityModifier,
  CONCENTRATION_BREAKING_CONDITIONS_FR,
  computeAC,
  raceSpeedMeters,
} from '@table-sync/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { characters, characterSpellEffects, combatants, encounters } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import {
  attachCharacterClasses,
  replaceCharacterClasses,
  validateClassEntries,
} from '../lib/character-classes.ts';
import { equippedAcRows, mirrorConditionsToCombatants } from '../lib/conditions.ts';
import { mapCharacter } from '../lib/mappers.ts';
import { isPartyGM, requireUser } from '../lib/membership.ts';
// Import hérité du monolithe (R4_LEGACY, shrink-only) : miroir CA des effets de sort.
import { activeAcEffectsOf, mirrorAcToCombatants } from '../character-spell-effects.ts';
import { apiMsg } from '../messages.ts';
import { activePlayerCombatants, getCharacterWithOwner } from './sheet.ts';
import { applyLegacyClassFields } from './classes.ts';

export async function characterUpdateRoutes(app: FastifyInstance) {
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
        'raging',
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
                'fr',
                // Effets de sort actifs : la CA du combatant suit le miroir
                // (v1 : au prochain miroir HP, pas en continu — documenté).
                activeAcEffectsOf(char.id),
              );
              drizzle
                .update(combatants)
                // #148 : PJ à 0 PV = mourant, pas vaincu
                .set({
                  name: char.name,
                  hitPoints: newHp,
                  maxHitPoints: char.max_hp ?? 1,
                  armorClass: char.armor_class_override ?? acResult.ac,
                  defeated: 0,
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
        // Issue #189 — Rage : « la rage prend fin si vous êtes inconscient ».
        // Même juge que la concentration : tombé à 0 PV sans PV temporaires
        // restants, l'état rage tombe. Un payload qui repose explicitement
        // `raging: true` dans la MÊME requête que la chute ne tombe PAS —
        // la main du joueur prime (helper pas automation).
        const ragingAfter = body.raging !== undefined ? !!body.raging : !!char.raging;
        if (
          ragingAfter &&
          body.currentHp <= 0 &&
          (body.tempHp ?? char.temp_hp ?? 0) <= 0 &&
          body.raging === undefined
        ) {
          values.raging = 0;
        }
      }

      // --- Revival (#144): rising above 0 HP on the SHEET resets the
      // death-save tally (SRD — regaining any HP ends the tally). Mirrors the
      // tracker-side rule; applies whenever the character was at/below 0.
      if (
        body.currentHp !== undefined &&
        body.currentHp > 0 &&
        (char.current_hp ?? 0) <= 0 &&
        body.deathSaveSuccesses === undefined &&
        body.deathSaveFailures === undefined
      ) {
        values.deathSaveSuccesses = 0;
        values.deathSaveFailures = 0;
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

      // Issue #189 — Rage : les conditions incapacitantes qui rompent la
      // concentration font aussi tomber la rage (un barbare Neutralisé ne
      // peut pas maintenir sa rage). Même garde : un payload qui repose
      // explicitement `raging` prime.
      let rageEndedByCondition: string | null = null;
      if (body.conditions && char.raging && body.raging !== false) {
        const breaking = body.conditions.find((c) =>
          CONCENTRATION_BREAKING_CONDITIONS_FR.includes(c),
        );
        if (breaking) {
          rageEndedByCondition = breaking;
          if (body.raging === undefined) {
            values.raging = 0;
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
      // v2 : porteurs des lignes d'effet tombées avec la concentration —
      // rempli par writeTx, relu après pour le fan-out CA + events.
      let concentrationDroppedBearers: number[] = [];
      const writeTx = getDb().transaction(() => {
        if (Object.keys(values).length > 0) {
          drizzle.update(characters).set(values).where(eq(characters.id, char.id)).run();
        }

        // --- Concentration tombée (0 PV, condition brisante, remplacement
        // par un nouveau sort concentré — `values.concentrating === 0` est
        // posé par ces trois voies ci-dessus) : les lignes d'effet de sort
        // liées à la concentration se désactivent dans la MÊME transaction —
        // sinon un effet fantôme survit à sa rupture (Bouclier de la foi
        // resterait à +2 CA après un Inconscient).
        // v2 : la rupture se juge sur le LANCEUR — ce perso peut porter des
        // effets castés par un autre (ils survivent), et les lignes qu'il a
        // castées sur autrui / « Autre » tombent aussi.
        if (values.concentrating === 0) {
          const dropped = drizzle
            .select({ characterId: characterSpellEffects.characterId })
            .from(characterSpellEffects)
            .where(
              and(
                eq(characterSpellEffects.casterCharacterId, char.id),
                eq(characterSpellEffects.tiedToConcentration, 1),
                eq(characterSpellEffects.active, 1),
              ),
            )
            .all() as any[];
          drizzle
            .update(characterSpellEffects)
            .set({ active: 0 })
            .where(
              and(
                eq(characterSpellEffects.casterCharacterId, char.id),
                eq(characterSpellEffects.tiedToConcentration, 1),
                eq(characterSpellEffects.active, 1),
              ),
            )
            .run();
          concentrationDroppedBearers = [...new Set(dropped.map((r) => r.characterId))];
        }

        // --- CA : toute écriture qui en change les entrées (rupture de
        // concentration qui désactive des effets, override manuel, DEX/CON/WIS
        // — défense sans armure —, style Défense) resynchronise la CA des
        // combatants en rencontre non terminée — le traqueur suit en continu.
        // v2 : la rupture peut avoir fait tomber des lignes vivant sur les
        // fiches D'AUTRES porteurs — CHACUN resynchronise sa ligne traqueur.
        // Relit la fiche ci-dessous : l'UPDATE ci-dessus est déjà passé.
        if (
          values.concentrating === 0 ||
          values.armorClassOverride !== undefined ||
          values.dexterity !== undefined ||
          values.constitution !== undefined ||
          values.wisdom !== undefined ||
          values.fightingStyle !== undefined
        ) {
          mirrorAcToCombatants(char.id, userId);
          for (const bearerId of concentrationDroppedBearers) {
            if (bearerId !== char.id) mirrorAcToCombatants(bearerId, userId);
          }
        }

        for (const cr of hpMirrorTargets) {
          const valuesC: Record<string, unknown> = {};
          if (body.currentHp !== undefined) {
            valuesC.hitPoints = Math.max(0, body.currentHp);
            // Mirror the defeated state the tracker derives from HP — temp HP
            // remaining keeps the character up (same rule as the death saves).
            // These targets are all PLAYER combatants: at 0 HP the player is
            // DYING, not defeated (#148) — they stay in the initiative
            // rotation for their death saves.
            valuesC.defeated = 0;
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

      // Champs de classe « plats » (rétrocompat mono-classe) : reportés sur les
      // lignes de classe par ./classes.ts (déplacement pur, phase 4).
      applyLegacyClassFields(char, body);

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
      // v2 : la rupture de concentration de ce perso peut avoir fait tomber
      // des lignes vivant sur les fiches d'AUTRES porteurs — leur CA bouge,
      // chacun rafraîchit (actorUserId obligatoire sur tout emitChange).
      for (const bearerId of concentrationDroppedBearers) {
        if (bearerId === char.id) continue;
        bus.emitChange({
          type: 'character:change',
          partyId: char.party_id,
          characterId: bearerId,
          action: 'stats',
          actorUserId: userId,
        });
      }
      return reply.send({
        character: mapCharacter(row),
        ...(concentrationCheck ? { concentrationCheck } : {}),
        ...(concentrationBroken ? { concentrationBroken } : {}),
        ...(rageEndedByCondition ? { rageEnded: rageEndedByCondition } : {}),
      });
    },
  );
}
