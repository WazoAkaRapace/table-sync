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
 * rolled BY THE PLAYER at the table — we only count them (a plain
 * `hitDiceSpent` count is allocated FIFO across class lines, the legacy
 * contract; `hitDiceSpentByClass` spends the named lines exactly — the
 * multiclass sheet picks its die types) and apply the healing they announce
 * (healedHp), capped at max HP; any HP regained clears death saves.
 *
 * Long rest: HP to max, temp HP to 0, all slots restored, half the level (min 1)
 * hit dice regained — BIGGEST dice first, then class-line order (the app's
 * documented default; the SRD leaves the choice to the player) —, exhaustion
 * −1, death saves cleared, concentration dropped, wild shape uses reset,
 * every catalog counter reset (max recomputed from the formula at the current
 * level). Conditions and food/water are untouched (conditions persist through
 * rests per SRD; survival flow is separate).
 */
export function applyRest(
  character: Character,
  features: Array<
    Pick<CharacterFeature, 'id' | 'catalogId' | 'resetType' | 'counterMax' | 'counterCurrent'>
  >,
  options: {
    type: 'short' | 'long';
    hitDiceSpent?: number;
    hitDiceSpentByClass?: Array<{ classKey: string; count: number }>;
    healedHp?: number;
  },
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
  // table — we only COUNT them and apply the healing they announce (capped).
  // Allocation: `hitDiceSpentByClass` (the multiclass sheet names its die
  // types, each clamped to the line's remaining dice) wins over the plain
  // `hitDiceSpent` count, allocated FIFO across class lines (legacy contract).
  let diceSpent = 0;
  let healed = 0;
  if (options.type === 'short') {
    const available = dice.reduce((sum, d) => sum + Math.max(0, d.max - d.used), 0);
    const askedByClass = options.hitDiceSpentByClass;
    const spend: number[] = dice.map((d) => {
      if (askedByClass) {
        const asked = askedByClass.find((c) => c.classKey === d.classKey)?.count ?? 0;
        return Math.max(0, Math.min(Math.floor(asked), Math.max(0, d.max - d.used)));
      }
      return -1; // FIFO fill below
    });
    if (!askedByClass) {
      let left = Math.max(0, Math.min(options.hitDiceSpent ?? 0, available));
      for (const [i, d] of dice.entries()) {
        const take = Math.min(Math.max(0, d.max - d.used), left);
        spend[i] = take;
        left -= take;
      }
    }
    diceSpent = spend.reduce((sum, n) => sum + n, 0);
    const announced = Math.max(0, Math.floor(options.healedHp ?? 0));
    if (diceSpent > 0) {
      classHitDice = dice.map((d, i) => ({ classKey: d.classKey, hitDiceUsed: d.used + spend[i] }));
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
    // the app's documented default restores the BIGGEST dice first, then
    // class-line order on a tie (the SRD leaves the choice to the player).
    const totalDice = dice.reduce((sum, d) => sum + d.max, 0);
    const budget = Math.max(1, Math.floor(totalDice / 2));
    let left = budget;
    const regains = dice.map(() => 0);
    const byBiggestDie = dice.map((_, i) => i).sort((a, b) => dice[b].die - dice[a].die);
    for (const i of byBiggestDie) {
      const regain = Math.min(dice[i].used, left);
      regains[i] = regain;
      left -= regain;
    }
    classHitDice = dice.map((d, i) => ({ classKey: d.classKey, hitDiceUsed: d.used - regains[i] }));
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
