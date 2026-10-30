/**
 * Rest routes: POST /characters/:id/rest — repos court / repos long.
 *
 * Applies the SRD recovery rules via the shared applyRest() (pact slots,
 * wild shape uses, hit dice, HP, exhaustion, death saves, concentration,
 * catalog feature counters — max recomputed at the current level), then
 * mirrors HP changes to active combatants like a sheet PATCH would.
 *
 * Body: { type: 'short' | 'long', hitDiceSpent?: number,
 *          hitDiceSpentByClass?: Array<{ classKey: string; count: number }>,
 *          healedHp?: number }
 * Permission: character owner or party GM (same as PATCH /characters/:id).
 */

import type { FeatureResetType } from '@table-sync/shared/classFeatures';
import { applyRest } from '@table-sync/shared/rests';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import {
  characterClasses,
  characterFeatures,
  characters,
  characterSpellEffects,
  combatants,
  encounters,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  attachCharacterClasses,
  isPartyGM,
  isPartyMember,
  mapCharacter,
  mirrorConditionsToCombatants,
  requireUser,
} from './helpers.ts';
import { mirrorAcToCombatants } from './character-spell-effects.ts';
import { apiMsg } from './messages.ts';

export async function restRoutes(app: FastifyInstance) {
  app.post(
    '/characters/:id/rest',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: {
          type?: string;
          hitDiceSpent?: number;
          hitDiceSpentByClass?: Array<{ classKey?: unknown; count?: unknown }>;
          healedHp?: number;
        };
      }>,
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
      const isGM = isPartyGM(char.party_id, userId);
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      if (char.owner_id !== userId && !isGM) {
        return reply.code(403).send({ error: apiMsg(req, 'only the owner or GM can rest') });
      }

      const body = req.body || {};
      if (body.type !== 'short' && body.type !== 'long') {
        return reply.code(400).send({ error: "type doit valoir 'short' ou 'long'" });
      }
      // v2 : porteurs des lignes d'effet tombées avec la concentration du
      // repos long (repos court : la concentration tient, rien ne tombe).
      let restDroppedBearers: number[] = [];
      if (body.hitDiceSpent !== undefined && !Number.isInteger(body.hitDiceSpent)) {
        return reply.code(400).send({ error: apiMsg(req, 'hitDiceSpent doit être un entier') });
      }
      // Dépense par ligne de classe (fiche multiclassée : le joueur choisit
      // ses types de dés). Validation tolérante : entrées inconnues ou hors
      // pool simplement ignorées côté applyRest (clamp par ligne).
      let hitDiceSpentByClass: Array<{ classKey: string; count: number }> | undefined;
      if (body.hitDiceSpentByClass !== undefined) {
        if (!Array.isArray(body.hitDiceSpentByClass)) {
          return reply
            .code(400)
            .send({ error: apiMsg(req, 'hitDiceSpentByClass doit être un tableau') });
        }
        const entries: Array<{ classKey: string; count: number }> = [];
        for (const item of body.hitDiceSpentByClass) {
          if (
            !item ||
            typeof item.classKey !== 'string' ||
            typeof item.count !== 'number' ||
            !Number.isFinite(item.count) ||
            item.count < 0
          ) {
            return reply.code(400).send({
              error: apiMsg(req, 'hitDiceSpentByClass doit être { classKey, count ≥ 0 }'),
            });
          }
          entries.push({ classKey: item.classKey, count: Math.floor(item.count) });
        }
        hitDiceSpentByClass = entries;
      }
      if (
        body.healedHp !== undefined &&
        (typeof body.healedHp !== 'number' || !Number.isFinite(body.healedHp) || body.healedHp < 0)
      ) {
        return reply.code(400).send({ error: apiMsg(req, 'healedHp doit être un nombre positif') });
      }

      const featureRows = drizzle
        .select({
          id: characterFeatures.id,
          catalog_id: characterFeatures.catalogId,
          reset_type: characterFeatures.resetType,
          counter_max: characterFeatures.counterMax,
          counter_current: characterFeatures.counterCurrent,
        })
        .from(characterFeatures)
        .where(eq(characterFeatures.characterId, char.id))
        .all();
      // snake_case rows → the camelCase shape applyRest expects
      const features = featureRows.map((r) => ({
        id: r.id as number,
        catalogId: (r.catalog_id as string | null) ?? null,
        resetType: (r.reset_type as FeatureResetType | null) ?? null,
        counterMax: (r.counter_max as number | null) ?? null,
        counterCurrent: (r.counter_current as number | null) ?? null,
      }));

      // Multiclassage : joindre les lignes de classe — applyRest évalue les
      // dés de vie par ligne et les compteurs au niveau de LEUR classe.
      attachCharacterClasses([char]);
      const result = applyRest(mapCharacter(char), features, {
        type: body.type,
        hitDiceSpent: body.hitDiceSpent,
        hitDiceSpentByClass,
        healedHp: body.healedHp,
      });

      // --- Persist the character patch (known subset of PatchCharacterPayload)
      const patch = result.characterPatch as Record<string, any>;
      const values: Record<string, unknown> = {};
      const patchable: Array<[string, keyof typeof characters.$inferInsert]> = [
        ['currentHp', 'currentHp'],
        ['tempHp', 'tempHp'],
        ['spellSlotsUsed', 'spellSlotsUsed'],
        ['pactSlotsUsed', 'pactSlotsUsed'],
        ['hitDiceUsed', 'hitDiceUsed'],
        ['exhaustion', 'exhaustion'],
        ['deathSaveSuccesses', 'deathSaveSuccesses'],
        ['deathSaveFailures', 'deathSaveFailures'],
        ['concentrating', 'concentrating'],
        ['raging', 'raging'],
        ['wildShapeUses', 'wildShapeUses'],
        ['conditions', 'conditions'],
      ];
      for (const [key, column] of patchable) {
        if (patch[key] === undefined) continue;
        if (key === 'spellSlotsUsed' || key === 'pactSlotsUsed' || key === 'conditions')
          values[column] = JSON.stringify(patch[key]);
        else if (typeof patch[key] === 'boolean') values[column] = patch[key] ? 1 : 0;
        else values[column] = patch[key];
      }
      // Long rest: the shape never outlasts 8 hours — revert to normal form.
      if (body.type === 'long' && char.wild_shape_slug) {
        values.wildShapeSlug = null;
        values.wildShapeHp = null;
        values.wildShapeMaxHp = null;
      }
      if (Object.keys(values).length > 0) {
        drizzle.update(characters).set(values).where(eq(characters.id, char.id)).run();
        // Repos long : la concentration tombe — les lignes d'effet liées
        // tombent avec (même écriture, pas d'effet fantôme au réveil).
        // v2 : la rupture se juge sur le LANCEUR (caster_character_id) —
        // les lignes qu'il a castées sur autrui / « Autre » tombent aussi.
        let droppedBearers: number[] = [];
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
          droppedBearers = [...new Set(dropped.map((r) => r.characterId))];
          // La CA des combatants suit la chute des effets concentrés — pour
          // CHAQUE porteur fiche touché (la cible peut être en initiative).
          for (const bearerId of droppedBearers) {
            mirrorAcToCombatants(bearerId, userId);
          }
          restDroppedBearers = droppedBearers;
        }
      }

      // --- Multiclassage : dés de vie par ligne de classe (pool par type de dé)
      for (const p of result.classHitDice) {
        drizzle
          .update(characterClasses)
          .set({ hitDiceUsed: Math.max(0, p.hitDiceUsed) })
          .where(
            and(
              eq(characterClasses.characterId, char.id),
              eq(characterClasses.classKey, p.classKey),
            ),
          )
          .run();
      }

      // --- Persist catalog counter resets (max recomputed by applyRest)
      for (const reset of result.featureResets) {
        drizzle
          .update(characterFeatures)
          .set({ counterMax: reset.counterMax, counterCurrent: reset.counterCurrent })
          .where(eq(characterFeatures.id, reset.featureId))
          .run();
      }

      // --- Conditions sync (#145): a long rest clearing the sheet's conditions
      // must also clear them on the character's combatants — same best-effort
      // mirror the sheet PATCH uses, keyed on the PREVIOUS list (durations
      // left untouched by design: a wiped sheet has nothing to diff).
      if (body.type === 'long' && patch.conditions !== undefined) {
        try {
          const prev: string[] = char.conditions
            ? typeof char.conditions === 'string'
              ? JSON.parse(char.conditions)
              : char.conditions
            : [];
          mirrorConditionsToCombatants(char.party_id, char.id, [], prev, userId);
        } catch {
          /* mirror is best-effort */
        }
      }

      // --- HP sync: mirror PV changes to active combatants (like a sheet PATCH)
      if (patch.currentHp !== undefined) {
        const activeCombatants = drizzle
          .select({ id: combatants.id, defeated: combatants.defeated })
          .from(combatants)
          .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
          .where(
            and(
              eq(combatants.characterId, char.id),
              eq(combatants.type, 'player'),
              ne(encounters.status, 'ended'),
            ),
          )
          .all();
        for (const cr of activeCombatants) {
          drizzle
            .update(combatants)
            // #148 : un PJ à 0 PV est mourant ; le repos ne pose jamais
            // defeated=1 sur un PJ (on ne fait que lever un vaincu manuel si PV > 0)
            .set({
              hitPoints: Math.max(0, patch.currentHp),
              defeated: patch.currentHp > 0 ? 0 : cr.defeated,
            })
            .where(eq(combatants.id, cr.id))
            .run();
        }
        if (activeCombatants.length > 0) {
          bus.emitChange({
            type: 'combat:change',
            partyId: char.party_id,
            action: 'hp',
            actorUserId: userId,
          });
        }
      }

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'rest',
        actorUserId: userId,
      });
      // v2 : les lignes tombées pouvaient vivre sur les fiches d'AUTRES
      // porteurs (effets castés par ce perso) — leur CA bouge, chacun
      // rafraîchit (actorUserId obligatoire sur tout emitChange).
      for (const bearerId of restDroppedBearers) {
        if (bearerId === char.id) continue;
        bus.emitChange({
          type: 'character:change',
          partyId: char.party_id,
          characterId: bearerId,
          action: 'stats',
          actorUserId: userId,
        });
      }

      const row = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, char.id))
        .get() as any;
      attachCharacterClasses([row]);
      return reply.send({
        character: mapCharacter(row),
        healed: result.healed,
        diceSpent: result.diceSpent,
        resetFeatures: result.featureResets.length,
      });
    },
  );
}
