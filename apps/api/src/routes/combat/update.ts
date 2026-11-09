/**
 * Mise à jour d'un combattant (PATCH /combatants/:cid) — déplacée à
 * l'identique depuis routes/combat.ts (phase 4d, déplacement pur). Le plus
 * gros handler du domaine : miroirs PV/PV max sheet<-tracker avec absorption
 * PV temporaires et revert forme sauvage à 0 (skip wild_shape), mourant vs
 * vaincu #148, revival #144, concentration (jet DD 10/½ dégâts, rupture sur
 * KO avec effets tombant dans la MÊME transaction), rage #189 (KO ou
 * condition incapacitante), miroir des conditions vers la fiche.
 *
 * R4 hérité documenté : import de '../character-spell-effects.ts'
 * (breakConcentrationEffectsOnTracker), couplage préexistant au découpage,
 * extraction routes/lib prévue en phase 4b.
 */

import type { ConcentrationCheck, PatchCombatantPayload } from '@table-sync/shared';
import { CONCENTRATION_BREAKING_CONDITIONS_FR } from '@table-sync/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import {
  characters as charactersTable,
  combatants as combatantsTable,
} from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { breakConcentrationEffectsOnTracker } from '../character-spell-effects.ts';
import { mirrorConditionsToCharacter } from '../lib/conditions.ts';
import { apiMsg } from '../messages.ts';
import { getCombatant, getCombatantForGM, mapCombatant, parseConditions } from './shared.ts';

/**
 * Rupture concentration + rage (Issue #189) DANS LA MÊME écriture — un effet
 * fantôme ne doit pas survivre à la rupture — puis character:change 'stats' :
 * la route appelante a déjà sa propre émission, chaque AUTRE porteur d'effet
 * rafraîchit sa CA. Les gardes internes rendent les deux sites jumeaux
 * (0 PV réel / condition incapacitante) strictement équivalents ; l'émission
 * reste HORS transaction, comme aux sites d'origine.
 */
function breakConcentrationAndRage(
  ch: { id: number; concentrating: unknown; raging: unknown },
  drizzle: ReturnType<typeof getDrizzle>,
  userId: number,
  partyId: number,
): void {
  let droppedBearers: number[] = [];
  getDb().transaction(() => {
    if (ch.concentrating) {
      drizzle
        .update(charactersTable)
        .set({ concentrating: 0 })
        .where(eq(charactersTable.id, ch.id))
        .run();
    }
    if (ch.raging) {
      drizzle
        .update(charactersTable)
        .set({ raging: 0 })
        .where(eq(charactersTable.id, ch.id))
        .run();
    }
    // v2 : la rupture se juge sur le LANCEUR — les lignes CASTÉES par ce
    // perso tombent (sur lui, sur autrui ou « Autre »), et la CA de CHAQUE
    // porteur fiche touché resynchronise (emit: false — la route émet déjà
    // son combat:change chirurgical).
    droppedBearers = breakConcentrationEffectsOnTracker(ch.id, userId);
  })();
  bus.emitChange({
    type: 'character:change',
    partyId,
    characterId: ch.id,
    action: 'stats',
    actorUserId: userId,
  });
  // v2 : les porteurs AUTRES que le lanceur rafraîchissent aussi (leur CA
  // vient de retomber).
  for (const bearerId of droppedBearers) {
    if (bearerId === ch.id) continue;
    bus.emitChange({
      type: 'character:change',
      partyId,
      characterId: bearerId,
      action: 'stats',
      actorUserId: userId,
    });
  }
}

export async function combatantUpdateRoutes(app: FastifyInstance) {
  // ===== Update combatant (GM only): HP, conditions, count, etc. =====
  app.patch(
    '/combatants/:cid',
    async (
      req: FastifyRequest<{ Params: { cid: string }; Body: PatchCombatantPayload }>,
      reply: FastifyReply,
    ) => {
      const ctx = getCombatantForGM(req, reply, Number(req.params.cid));
      if (ctx === null) return;
      const { userId, combatant, enc } = ctx;
      const drizzle = getDrizzle();

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.name !== undefined) values.name = body.name;
      if (body.count !== undefined) values.count = Math.max(1, body.count);
      if (body.initiative !== undefined) values.initiative = body.initiative;
      if (body.armorClass !== undefined) values.armorClass = body.armorClass;
      if (body.hitPoints !== undefined) values.hitPoints = Math.max(0, body.hitPoints);
      if (body.maxHitPoints !== undefined) values.maxHitPoints = Math.max(1, body.maxHitPoints);
      if (body.conditions !== undefined) values.conditions = JSON.stringify(body.conditions);
      if (body.defeated !== undefined) values.defeated = body.defeated ? 1 : 0;
      if (body.cardColor !== undefined) values.cardColor = body.cardColor;
      if (body.nameHidden !== undefined) values.nameHidden = body.nameHidden ? 1 : 0;

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }

      // Grouped monsters share one name — the mask fans out to the whole
      // group (the own row is covered twice, idempotently).
      if (body.nameHidden !== undefined && combatant.group_id) {
        drizzle
          .update(combatantsTable)
          .set({ nameHidden: body.nameHidden ? 1 : 0 })
          .where(
            and(
              eq(combatantsTable.encounterId, combatant.encounter_id),
              eq(combatantsTable.groupId, combatant.group_id),
            ),
          )
          .run();
      }

      // --- Dying players (#148): a PLAYER combatant at 0 HP is DYING, not
      // defeated — they stay in the initiative rotation so the table knows
      // when to roll death saves. Only 3 death-save failures (or the manual
      // toggle) defeat them. Monsters/NPCs keep the instant defeat.
      // Manual defeated=false on a dying player keeps them dying (HP decides).
      const isPlayerRow = combatant.type === 'player';
      if (body.hitPoints !== undefined && body.defeated === undefined) {
        if (isPlayerRow && body.hitPoints <= 0) {
          values.defeated = 0;
        } else {
          values.defeated = body.hitPoints <= 0 ? 1 : 0;
        }
      } else if (body.defeated !== undefined && body.hitPoints === undefined) {
        if (isPlayerRow && !body.defeated && (combatant.hit_points ?? 0) <= 0) {
          // Réanimer un mourant : il reste dans la rotation tant que PV = 0
          values.defeated = 0;
        }
      }
      // --- Revival (#144): rising above 0 HP resets the death-save tally
      // (both sides — the tracker's heal is the sheet's heal).
      let revivedPlayer = false;
      if (
        isPlayerRow &&
        combatant.character_id &&
        body.hitPoints !== undefined &&
        body.hitPoints > 0 &&
        (combatant.hit_points ?? 0) <= 0
      ) {
        drizzle
          .update(charactersTable)
          .set({ deathSaveSuccesses: 0, deathSaveFailures: 0 })
          .where(eq(charactersTable.id, combatant.character_id))
          .run();
        revivedPlayer = true;
      }

      drizzle.update(combatantsTable).set(values).where(eq(combatantsTable.id, combatant.id)).run();

      // --- Concentration: if the GM damaged a player who is concentrating on
      // a spell, that player must roll a CON save (DC 10 or half damage).
      // SRD: temp HP absorbs damage first — only the real loss threatens the spell.
      let concentration: ConcentrationCheck | undefined;
      if (body.hitPoints !== undefined && combatant.type === 'player' && combatant.character_id) {
        const ch = drizzle
          .select({
            id: charactersTable.id,
            name: charactersTable.name,
            owner_id: charactersTable.ownerId,
            concentrating: charactersTable.concentrating,
            raging: charactersTable.raging,
            temp_hp: charactersTable.tempHp,
            wild_shape_slug: charactersTable.wildShapeSlug,
          })
          .from(charactersTable)
          .where(eq(charactersTable.id, combatant.character_id))
          .get() as any;
        if (ch?.concentrating) {
          const damage = (combatant.hit_points ?? 0) - Math.max(0, body.hitPoints);
          // While shaped, damage routes to the shape's bar — temp HP stays out of it.
          const tempHp = ch.wild_shape_slug ? 0 : (ch.temp_hp ?? 0);
          const absorbed = damage > 0 ? Math.min(tempHp, damage) : 0;
          const realHp = Math.max(0, body.hitPoints) + absorbed;
          // PHB p.203: the damage TAKEN threatens concentration — absorbed by
          // temp HP or not, the save rolls against the full hit (DD 10 or ½ dégâts).
          if (damage > 0 && realHp > 0) {
            concentration = {
              characterId: ch.id,
              characterName: ch.name,
              damage,
              dc: Math.max(10, Math.floor(damage / 2)),
              ownerId: ch.owner_id,
            };
          } else if (realHp <= 0) {
            // Unconscious → concentration ends automatically on the sheet too.
            // Les lignes d'effet liées tombent DANS la même écriture — un
            // effet fantôme ne doit pas survivre à la rupture.
            breakConcentrationAndRage(ch, drizzle, userId, enc.party_id);
          }
        }
        // Issue #189 — Rage : KO au traqueur → inconscient → la rage tombe,
        // MÊME si le barbare ne concentre aucun sort (le bloc concentration
        // ci-dessus ne couvre que les lanceurs). Juge identique : 0 PV réel
        // (les PV temporaires restants amortissent la chute).
        if (ch && !ch.concentrating && ch.raging) {
          const damage = (combatant.hit_points ?? 0) - Math.max(0, body.hitPoints);
          const tempHp = ch.wild_shape_slug ? 0 : (ch.temp_hp ?? 0);
          const absorbed = damage > 0 ? Math.min(tempHp, damage) : 0;
          const realHp = Math.max(0, body.hitPoints) + absorbed;
          if (realHp <= 0) {
            drizzle
              .update(charactersTable)
              .set({ raging: 0 })
              .where(eq(charactersTable.id, ch.id))
              .run();
          }
        }
      }

      // --- HP sync: the tracker is the player's sheet HP — mirror PV/PV max
      // changes back to the character so both views stay identical.
      // While the character is in Wild Shape, damage routes to the shape's
      // bar; dropping it to 0 reverts with excess carried over (SRD).
      if (
        combatant.type === 'player' &&
        combatant.character_id &&
        (body.hitPoints !== undefined || body.maxHitPoints !== undefined)
      ) {
        const ch = drizzle
          .select({
            id: charactersTable.id,
            name: charactersTable.name,
            current_hp: charactersTable.currentHp,
            max_hp: charactersTable.maxHp,
            temp_hp: charactersTable.tempHp,
            wild_shape_slug: charactersTable.wildShapeSlug,
            wild_shape_max_hp: charactersTable.wildShapeMaxHp,
          })
          .from(charactersTable)
          .where(eq(charactersTable.id, combatant.character_id))
          .get() as any;

        if (ch?.wild_shape_slug && body.hitPoints !== undefined) {
          if (body.hitPoints > 0) {
            drizzle
              .update(charactersTable)
              .set({ wildShapeHp: Math.max(0, body.hitPoints) })
              .where(eq(charactersTable.id, ch.id))
              .run();
          } else {
            // Shape dropped to 0 → auto-revert with carry-over
            const excess = Math.max(0, -(body.hitPoints ?? 0));
            const newHp = Math.max(0, (ch.current_hp ?? 1) - excess);
            const revertName = combatant.name.replace(/ \([^)]*\)$/, '');
            drizzle
              .update(charactersTable)
              .set({
                wildShapeSlug: null,
                wildShapeHp: null,
                wildShapeMaxHp: null,
                currentHp: newHp,
              })
              .where(eq(charactersTable.id, ch.id))
              .run();
            drizzle
              .update(combatantsTable)
              // #148 : PJ à 0 PV = mourant, pas vaincu
              .set({
                name: revertName,
                hitPoints: newHp,
                maxHitPoints: ch.max_hp ?? 1,
                defeated: 0,
              })
              .where(eq(combatantsTable.id, combatant.id))
              .run();
          }
          bus.emitChange({
            type: 'character:change',
            partyId: enc.party_id,
            characterId: ch.id,
            action: 'stats',
            actorUserId: userId,
          });
        } else {
          const valuesC: Record<string, unknown> = {};
          if (body.hitPoints !== undefined) {
            let newHp = Math.max(0, body.hitPoints);
            // SRD: damage eats temp HP first. The tracker doesn't display temp,
            // so the server absorbs it here and settles the tracker's row on
            // the real HP (a fully absorbed hit leaves the row unchanged).
            const damage = (combatant.hit_points ?? 0) - newHp;
            const tempHp = ch?.temp_hp ?? 0;
            if (damage > 0 && tempHp > 0) {
              const absorbed = Math.min(tempHp, damage);
              newHp += absorbed;
              valuesC.tempHp = tempHp - absorbed;
              drizzle
                .update(combatantsTable)
                // branche player-only : un PJ à 0 PV réel reste mourant (#148)
                .set({ hitPoints: newHp, defeated: 0 })
                .where(eq(combatantsTable.id, combatant.id))
                .run();
            }
            valuesC.currentHp = newHp;
          }
          if (body.maxHitPoints !== undefined) {
            valuesC.maxHp = Math.max(1, body.maxHitPoints);
          }
          if (Object.keys(valuesC).length > 0) {
            drizzle
              .update(charactersTable)
              .set(valuesC)
              .where(eq(charactersTable.id, combatant.character_id))
              .run();
            bus.emitChange({
              type: 'character:change',
              partyId: enc.party_id,
              characterId: combatant.character_id,
              action: 'hp',
              actorUserId: userId,
            });
          }
        }
      }

      // Re-read AFTER the HP mirror — temp absorption may have settled the
      // combatant's row on a different value than the GM sent.
      const row = getCombatant(drizzle, combatant.id);

      // --- Condition sync: tracker condition changes mirror to the sheet
      // (names only — durations stay a combat-tracker detail).
      if (body.conditions !== undefined && combatant.type === 'player' && combatant.character_id) {
        const prevNames = parseConditions(combatant.conditions).map((c) => c.name);
        const nextNames = body.conditions.map((c) => c.name);
        mirrorConditionsToCharacter(
          enc.party_id,
          combatant.character_id,
          nextNames.filter((n) => !prevNames.includes(n)),
          prevNames.filter((n) => !nextNames.includes(n)),
          userId,
        );
      }

      // --- Concentration: an incapacitating condition applied by the GM
      // (Inconscient, Paralysé, …) breaks the player's concentration.
      let concentrationBroken: string | undefined;
      // Issue #189 — la rage tombe aussi sur condition incapacitante.
      let rageEndedByCondition: string | undefined;
      if (body.conditions && combatant.type === 'player' && combatant.character_id) {
        const breaking = body.conditions.find((c) =>
          CONCENTRATION_BREAKING_CONDITIONS_FR.includes(c.name),
        );
        if (breaking) {
          const ch = drizzle
            .select({
              id: charactersTable.id,
              concentrating: charactersTable.concentrating,
              raging: charactersTable.raging,
            })
            .from(charactersTable)
            .where(eq(charactersTable.id, combatant.character_id))
            .get() as any;
          if (ch?.concentrating || ch?.raging) {
            // Condition brisante → concentration rompue : les lignes d'effet
            // liées tombent dans la même écriture (pas d'effet fantôme).
            // Issue #189 — la rage tombe aussi (incapacité).
            breakConcentrationAndRage(ch, drizzle, userId, enc.party_id);
            concentrationBroken = breaking.name;
            if (ch?.raging) rageEndedByCondition = breaking.name;
          }
        }
      }

      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'hp',
        actorUserId: userId,
        ...(concentration ? { concentration } : {}),
      });
      // Revival touched the sheet's death saves — the owner's DeathSaveTracker
      // must see the reset too (a stats-only wake would miss it).
      if (revivedPlayer && combatant.character_id) {
        bus.emitChange({
          type: 'character:change',
          partyId: enc.party_id,
          characterId: combatant.character_id,
          action: 'stats',
          actorUserId: userId,
        });
      }
      return reply.send({
        combatant: mapCombatant(row),
        ...(concentrationBroken ? { concentrationBroken } : {}),
        ...(rageEndedByCondition ? { rageEnded: rageEndedByCondition } : {}),
      });
    },
  );
}
