/**
 * Rest routes: POST /characters/:id/rest — repos court / repos long.
 *
 * Applies the SRD recovery rules via the shared applyRest() (pact slots,
 * wild shape uses, hit dice, HP, exhaustion, death saves, concentration,
 * catalog feature counters — max recomputed at the current level), then
 * mirrors HP changes to active combatants like a sheet PATCH would.
 *
 * Body: { type: 'short' | 'long', hitDiceSpent?: number }
 * Permission: character owner or party GM (same as PATCH /characters/:id).
 */

import { applyRest, type FeatureResetType } from '@table-sync/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import {
  characterClasses,
  characterFeatures,
  characters,
  combatants,
  encounters,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  attachCharacterClasses,
  isPartyGM,
  isPartyMember,
  mapCharacter,
  requireUser,
} from './helpers.ts';

export async function restRoutes(app: FastifyInstance) {
  app.post(
    '/characters/:id/rest',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { type?: string; hitDiceSpent?: number };
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
      if (!char) return reply.code(404).send({ error: 'character not found' });
      const isGM = isPartyGM(char.party_id, userId);
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      if (char.owner_id !== userId && !isGM) {
        return reply.code(403).send({ error: 'only the owner or GM can rest' });
      }

      const body = req.body || {};
      if (body.type !== 'short' && body.type !== 'long') {
        return reply.code(400).send({ error: "type doit valoir 'short' ou 'long'" });
      }
      if (body.hitDiceSpent !== undefined && !Number.isInteger(body.hitDiceSpent)) {
        return reply.code(400).send({ error: 'hitDiceSpent doit être un entier' });
      }
      if (
        body.healedHp !== undefined &&
        (typeof body.healedHp !== 'number' || !Number.isFinite(body.healedHp) || body.healedHp < 0)
      ) {
        return reply.code(400).send({ error: 'healedHp doit être un nombre positif' });
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
        ['wildShapeUses', 'wildShapeUses'],
      ];
      for (const [key, column] of patchable) {
        if (patch[key] === undefined) continue;
        if (key === 'spellSlotsUsed' || key === 'pactSlotsUsed')
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

      // --- HP sync: mirror PV changes to active combatants (like a sheet PATCH)
      if (patch.currentHp !== undefined) {
        const activeCombatants = drizzle
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
          .all();
        for (const cr of activeCombatants) {
          drizzle
            .update(combatants)
            .set({
              hitPoints: Math.max(0, patch.currentHp),
              defeated: patch.currentHp <= 0 ? 1 : 0,
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
