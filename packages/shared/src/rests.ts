/**
 * Repos court / long (SRD 5.1) — module séparé de index.ts car applyRest
 * dépend du catalogue de capacités (classFeatures.ts) : une import statique
 * depuis index.ts trainerait les ~270 KB de catalogues FR+EN dans le chunk
 * commun du navigateur (index.ts est importé par chaque page). Consommateurs :
 * l'API (POST /characters/:id/rest) et les suites de règles — importer via
 * '@table-sync/shared/rests'.
 */

import {
  classFeatureResourceMax,
  effectiveFeatureReset,
  findClassFeature,
  findClassFeatureClass,
} from './classFeatures.ts';
import {
  type Character,
  classesOf,
  findClass,
  hitDiceByClassOf,
  type PatchCharacterPayload,
} from './index.ts';

/** What a rest changes: the character PATCH plus catalog-feature counter resets. */
export interface RestResult {
  characterPatch: PatchCharacterPayload;
  /** Per-class hit-dice totals to persist on the character_classes rows. */
  classHitDice: Array<{ classKey: string; hitDiceUsed: number }>;
  featureResets: Array<{
    featureId: number;
    counterMax: number;
    counterCurrent: number;
  }>;
  /** Hit dice spent on the rest (counted — the PLAYER rolls them at the table). */
  diceSpent: number;
  /** Total HP actually regained (the player-entered healing, capped at max HP). */
  healed: number;
}

/**
 * Apply a short or long rest (pure — returns the patch, the caller persists it).
 *
 * Short rest: pact-magic slots restored (Occultiste), wild shape uses reset,
 * short-rest catalog counters reset, optional hit-dice spending. The dice are
 * rolled BY THE PLAYER at the table — we only count them (hitDiceSpent) and
 * apply the healing they announce (healedHp), capped at max HP; any HP regained
 * clears death saves.
 *
 * Long rest: HP to max, temp HP to 0, all slots restored, half the level (min 1)
 * hit dice regained, exhaustion −1, death saves cleared, concentration dropped,
 * wild shape uses reset, every catalog counter reset (max recomputed from the
 * formula at the current level). Conditions and food/water are untouched
 * (conditions persist through rests per SRD; survival flow is separate).
 */
export function applyRest(
  character: Character,
  features: Array<
    Pick<CharacterFeature, 'id' | 'catalogId' | 'resetType' | 'counterMax' | 'counterCurrent'>
  >,
  options: { type: 'short' | 'long'; hitDiceSpent?: number; healedHp?: number },
): RestResult {
  const level = character.level ?? 1;
  const classes = classesOf(character);
  const dice = hitDiceByClassOf(character);
  const patch: PatchCharacterPayload = {};
  let classHitDice: RestResult['classHitDice'] = [];

  // Counters to reset on this rest type. The PLAYER'S reset choice
  // (resetType — the checkboxes) overrides the catalog's SRD rule: the catalog
  // pre-fills, it doesn't automate. With no player choice, a catalog trait
  // follows its SRD rule, evaluated at the level of the class that GRANTS it
  // (SRD multiclassing) — never the character's total level.
  const featureResets: RestResult['featureResets'] = [];
  for (const feature of features) {
    if ((feature.counterMax ?? 0) <= 0) continue;
    const owner = feature.catalogId ? findClassFeatureClass(feature.catalogId) : null;
    const ownerLevel = owner
      ? (classes.find((c) => findClass(c.classKey)?.name === owner)?.level ?? level)
      : level;
    const effective = effectiveFeatureReset(feature, ownerLevel);
    // 'short' recharges on short AND long rests; 'long' only on long; 'none' never
    if (effective !== 'short' && !(effective === 'long' && options.type === 'long')) continue;
    // Catalog formula when the trait is catalog-linked with a resource,
    // otherwise the stored max (manual trait, or counter added by hand)
    const def = feature.catalogId ? findClassFeature(feature.catalogId) : null;
    const max = def?.resource
      ? (classFeatureResourceMax(def, character) ?? feature.counterMax ?? 0)
      : (feature.counterMax ?? 0);
    if (max <= 0) continue; // unlimited (Rage @20) or invalid: nothing to track
    featureResets.push({ featureId: feature.id, counterMax: max, counterCurrent: max });
  }

  // Hit-dice spending on a short rest: the player rolls their own dice at the
  // table — we only COUNT them (FIFO across class lines when they spend a
  // plain count) and apply the healing they announce (capped).
  let diceSpent = 0;
  let healed = 0;
  if (options.type === 'short') {
    const available = dice.reduce((sum, d) => sum + Math.max(0, d.max - d.used), 0);
    diceSpent = Math.max(0, Math.min(options.hitDiceSpent ?? 0, available));
    const announced = Math.max(0, Math.floor(options.healedHp ?? 0));
    if (diceSpent > 0) {
      let left = diceSpent;
      classHitDice = dice.map((d) => {
        const take = Math.min(Math.max(0, d.max - d.used), left);
        left -= take;
        return { classKey: d.classKey, hitDiceUsed: d.used + take };
      });
      patch.hitDiceUsed = (character.hitDiceUsed ?? 0) + diceSpent;
    }
    if (announced > 0) {
      const currentHp = Math.min(
        character.maxHp ?? Number.POSITIVE_INFINITY,
        character.currentHp + announced,
      );
      healed = currentHp - character.currentHp; // what was actually applied
      patch.currentHp = currentHp;
      // Regaining any HP ends the death-save tally (SRD)
      patch.deathSaveSuccesses = 0;
      patch.deathSaveFailures = 0;
    }
  }

  if (options.type === 'short') {
    // Pact magic recharges on a short rest (Occultiste — its own pool)
    if (classes.some((c) => findClass(c.classKey)?.name === 'Occultiste')) {
      patch.pactSlotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
    if (classes.some((c) => findClass(c.classKey)?.name === 'Druide')) {
      patch.wildShapeUses = 2;
    }
  } else {
    patch.currentHp = character.maxHp;
    patch.tempHp = 0;
    patch.spellSlotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    patch.pactSlotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    // Long rest: regain up to half the TOTAL dice pool, minimum 1 (SRD);
    // restored front-loaded by class-line order (the SRD leaves the choice
    // of which dice to the player — FIFO is the documented default).
    const totalDice = dice.reduce((sum, d) => sum + d.max, 0);
    const budget = Math.max(1, Math.floor(totalDice / 2));
    let left = budget;
    classHitDice = dice.map((d) => {
      const regain = Math.min(d.used, left);
      left -= regain;
      return { classKey: d.classKey, hitDiceUsed: d.used - regain };
    });
    patch.hitDiceUsed = classHitDice.reduce((sum, p) => sum + p.hitDiceUsed, 0);
    patch.exhaustion = Math.max(0, character.exhaustion - 1);
    patch.deathSaveSuccesses = 0;
    patch.deathSaveFailures = 0;
    patch.concentrating = false;
    if (classes.some((c) => findClass(c.classKey)?.name === 'Druide')) {
      patch.wildShapeUses = 2;
    }
  }

  return { characterPatch: patch, classHitDice, featureResets, diceSpent, healed };
}
