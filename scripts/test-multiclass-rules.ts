/**
 * Multiclass rules suite (SRD 5.1 § Multiclassing) — tsx, exit non-zero on failure.
 *
 * Covers: caster-level formula (full / half ⌊⌋ / artificer ⌈½⌉ / third ⌊⅓⌋),
 * the single-class vs multiclass table trap (a lone Paladin keeps its own
 * table), pact pool coexistence, Extra Attack non-stacking, unarmored
 * defense choice, speed stacking, prerequisites, expertise pools, hit dice
 * by die type, cantrips at character level, class-level keyed features
 * (Champion crit range, aura, wild shape CR, sneak attack, martial arts),
 * and applyRest (per-class hit dice + pact reset + class-level counters).
 */
import {
  auraOfProtectionBonus,
  averageMaxHpMulti,
  type CharacterClassEntry,
  classesOf,
  classLevelOf,
  computeSpellcastingPools,
  computeUnarmedStats,
  computeWeaponStats,
  criticalRangeOf,
  expertiseSlots,
  extraAttacksOf,
  hitDiceByClassOf,
  MULTICLASS_PREREQUISITES,
  multiclassCasterLevel,
  multiclassPrereqStatuses,
  preparedLimits,
  SPELL_SLOTS_FULL,
  sneakAttackDice,
  spellDamageAtLevel,
  totalLevel,
  unarmoredDefensesOf,
} from '@table-sync/shared';
import { applyRest } from '@table-sync/shared/rests';
import { classFeatureResourceMax, findClassFeature } from '../packages/shared/src/classFeatures.ts';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(
      `✗ ${label}: attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`,
    );
  }
}

/** Minimal character factory (legacy flat fields, like the DB rows). */
const char = (over: Record<string, unknown> = {}) => ({
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  level: 1,
  ...over,
});

const entry = (
  classKey: string,
  level: number,
  extra: Partial<CharacterClassEntry> = {},
): CharacterClassEntry => ({
  classKey,
  level,
  ...extra,
});

// ---------- SRD table oracle: the multiclass spellcaster table == SPELL_SLOTS_FULL ----------
const SRD_MULTICLASS_TABLE: number[][] = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
check(
  'table incantateur multiclassé (SRD) == SPELL_SLOTS_FULL',
  SPELL_SLOTS_FULL,
  SRD_MULTICLASS_TABLE,
);

// ---------- Caster level formula ----------
check(
  'incantateur : Ens 3 + Mag 2 = 5',
  multiclassCasterLevel([entry('Ensorceleur', 3), entry('Magicien', 2)]),
  5,
);
check(
  'incantateur : Pal 2 + Ens 3 = 1+3 = 4',
  multiclassCasterLevel([entry('Paladin', 2), entry('Ensorceleur', 3)]),
  4,
);
check(
  'incantateur : Occ 5 ignoré (pacte)',
  multiclassCasterLevel([entry('Occultiste', 5), entry('Barbare', 5)]),
  0,
);
check(
  'incantateur : Rôdeur 5 → ⌊5/2⌋ = 2',
  multiclassCasterLevel([entry('Rôdeur', 5), entry('Barbare', 1)]),
  2,
);
check(
  'incantateur : Artificier 3 → ⌈3/2⌉ = 2 (TCE)',
  multiclassCasterLevel([entry('Artificier', 3), entry('Guerrier', 1)]),
  2,
);
check(
  'incantateur : CO Guerrier 8 → ⌊8/3⌋ = 2 (PHB)',
  multiclassCasterLevel([
    entry('Guerrier', 8, { subclassKey: 'chevalier-occulte' }),
    entry('Barbare', 1),
  ]),
  2,
);
check(
  'incantateur : escroc arcanique 7 → ⌊7/3⌋ = 2',
  multiclassCasterLevel([
    entry('Roublard', 7, { subclassKey: 'escroc-arcanique' }),
    entry('Barbare', 2),
  ]),
  2,
);
check(
  'incantateur : Guerrier sans sous-classe occulte = 0',
  multiclassCasterLevel([entry('Guerrier', 8), entry('Barbare', 2)]),
  0,
);

// ---------- Pools: single-class tables vs multiclass table ----------
// Lone Paladin 5 keeps its OWN half table (RAW: the formula needs 2+ classes).
const pal5 = char({ characterClass: 'Paladin', level: 5 });
check(
  'Paladin 5 seul : table dédiée [4,2]',
  computeSpellcastingPools(pal5).spellcasting,
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
);
// Paladin 2 / Ensorceleur 3 → caster 4 → [4,3].
check(
  'Pal 2/Ens 3 : table multiclassée [4,3]',
  computeSpellcastingPools({ classes: [entry('Paladin', 2), entry('Ensorceleur', 3)] })
    .spellcasting,
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
);
// Lone Artificier matches its own table (⌈½⌉ identity).
check(
  'Artificier 5 seul : 4/2 (⌈5/2⌉=3 → rangée 3)',
  computeSpellcastingPools(char({ characterClass: 'Artificier', level: 5 })).spellcasting,
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
);
// Warlock 5 / Wizard 5: pact pool AND spellcasting pool coexist.
const lockWiz = computeSpellcastingPools({
  classes: [entry('Occultiste', 5), entry('Magicien', 5)],
});
check('Occ 5/Mag 5 : pool incantation 4/3/2', lockWiz.spellcasting, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
check('Occ 5/Mag 5 : pool pacte 2× niv.3', lockWiz.pact, [0, 0, 2, 0, 0, 0, 0, 0, 0]);
check('Occ 5/Mag 5 : hasPact', lockWiz.hasPact, true);
// Lone warlock: pact only.
const lock5 = computeSpellcastingPools(char({ characterClass: 'Occultiste', level: 5 }));
check('Occ 5 seul : pacte 2× niv.3', lock5.pact, [0, 0, 2, 0, 0, 0, 0, 0, 0]);
check('Occ 5 seul : incantation vide', lock5.spellcasting, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
// Third caster alone: EK 7 → ⌈7/3⌉=3 → [4,2] (PHB table identity).
check(
  'CO Guerrier 7 seul : ⌈7/3⌉=3 → [4,2]',
  computeSpellcastingPools({
    characterClass: 'Guerrier',
    level: 7,
    subclass: 'chevalier-occulte',
  }).spellcasting,
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
);
// No casters at all.
check(
  'Barb 5/Guer 5 : aucun pool',
  computeSpellcastingPools({ classes: [entry('Barbare', 5), entry('Guerrier', 5)] }).spellcasting,
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
);

// ---------- Prepared limits per class ----------
const clerc5Mag3 = {
  classes: [entry('Clerc', 5), entry('Magicien', 3)],
  wisdom: 16,
  intelligence: 14,
} as const;
const limits = preparedLimits(clerc5Mag3 as never);
check('Clerc 5 (SAG 16) : 3+5 = 8 préparés', limits.find((l) => l.classKey === 'Clerc')?.limit, 8);
check(
  'Magicien 3 (INT 14) : 2+3 = 5 préparés',
  limits.find((l) => l.classKey === 'Magicien')?.limit,
  5,
);

// ---------- Extra Attack: max, not sum ----------
check(
  'Guerrier 11/Barb 5 → 3 attaques',
  extraAttacksOf({ classes: [entry('Guerrier', 11), entry('Barbare', 5)] }),
  3,
);
check(
  'Guerrier 5/Moine 5 → 2 attaques',
  extraAttacksOf({ classes: [entry('Guerrier', 5), entry('Moine', 5)] }),
  2,
);
check(
  'Mag 10/Rou 10 → 1 attaque',
  extraAttacksOf({ classes: [entry('Magicien', 10), entry('Roublard', 10)] }),
  1,
);
check(
  'héritage : Guerrier 5 seul → 2',
  extraAttacksOf(char({ characterClass: 'Guerrier', level: 5 })),
  2,
);

// ---------- Unarmored Defense: candidates + choice, never combined ----------
const barb2moine2 = {
  classes: [entry('Barbare', 2), entry('Moine', 2)],
  dexterity: 16,
  constitution: 16,
  wisdom: 10,
};
const defs = unarmoredDefensesOf(barb2moine2);
check('Barb/Moine : 2 candidates', defs.length, 2);
check('Barb 16/16 : 10+3+3 = 16', defs.find((d) => d.key === 'barbare')?.ac, 16);
check('Moine (SAG 10) : 10+3+0 = 13', defs.find((d) => d.key === 'moine')?.ac, 13);
check(
  'Barb/Moine sans classes[] : héritage mono-classe',
  classesOf(char({ characterClass: 'Barbare', level: 2 })).length,
  1,
);

// ---------- Prerequisites ----------
check('prérequis Moine : DEX ET SAG', MULTICLASS_PREREQUISITES.Moine, [['dexterity', 'wisdom']]);
check('prérequis Guerrier : FOR OU DEX', MULTICLASS_PREREQUISITES.Guerrier, [
  ['strength'],
  ['dexterity'],
]);
check(
  'paladin FOR 12/CHA 14 : ⚠ non satisfait',
  multiclassPrereqStatuses(
    char({ classes: [entry('Magicien', 2), entry('Paladin', 2)], strength: 12, charisma: 14 }),
  )[0].satisfied,
  false,
);
check(
  'guerrier DEX 13 : satisfait (OU)',
  multiclassPrereqStatuses(
    char({ classes: [entry('Magicien', 2), entry('Guerrier', 2)], strength: 8, dexterity: 13 }),
  )[0].satisfied,
  true,
);

// ---------- Expertise pools sum ----------
check(
  'Roub 6 + Barde 10 → 4+4 = 8',
  expertiseSlots({ classes: [entry('Roublard', 6), entry('Barde', 10)] }),
  8,
);
check('Roublard 5 seul → 2', expertiseSlots(char({ characterClass: 'Roublard', level: 5 })), 2);
check(
  'Clerc Savoir 1 + Roublard 1 → 2+2',
  expertiseSlots({ classes: [entry('Clerc', 1, { subclassKey: 'savoir' }), entry('Roublard', 1)] }),
  4,
);

// ---------- Hit dice by die type ----------
const pal5clerc5 = hitDiceByClassOf({
  classes: [entry('Paladin', 5), entry('Clerc', 5, { hitDiceUsed: 1 })],
});
check(
  'Pal 5/Clerc 5 : dés 10 et 8',
  pal5clerc5.map((d) => [d.classKey, d.die, d.max]),
  [
    ['Paladin', 10, 5],
    ['Clerc', 8, 5],
  ],
);
check(
  'Pal 5/Clerc 5 : 1 d8 dépensé sur la ligne Clerc',
  pal5clerc5.map((d) => d.used),
  [0, 1],
);
check('total level = somme', totalLevel([entry('Paladin', 5), entry('Clerc', 5)]), 10);
check(
  'classLevelOf Clerc = 5',
  classLevelOf({ classes: [entry('Paladin', 5), entry('Clerc', 5)] }, 'Clerc'),
  5,
);

// ---------- Average HP multiclass ----------
check(
  'PV moyens Pal 5/Clerc 5 CON 14 : 12+2 + 4×(6+2) + 5×(5+2)',
  averageMaxHpMulti([entry('Paladin', 5), entry('Clerc', 5)], 14),
  79,
);

// ---------- Class-level keyed features ----------
check(
  'Champion Guerrier 3/Mag 17 : critique 19-20 (niveau de CLASSE)',
  criticalRangeOf({
    classes: [entry('Guerrier', 3, { subclassKey: 'champion' }), entry('Magicien', 17)],
  }),
  19,
);
check(
  'Champion Guerrier 15 : critique 18-20',
  criticalRangeOf({ classes: [entry('Guerrier', 15, { subclassKey: 'champion' })] }),
  18,
);
check(
  'Aura paladin 6/Mag 14 : +CHA min 1',
  auraOfProtectionBonus({ classes: [entry('Paladin', 6), entry('Magicien', 14)], charisma: 16 }),
  3,
);
check(
  'Aura paladin 5/Mag 15 : rien (niveau de classe < 6)',
  auraOfProtectionBonus({ classes: [entry('Paladin', 5), entry('Magicien', 15)], charisma: 16 }),
  0,
);
check(
  "dés d'arts martiaux : Moine 1/Mag 19 → d4 (niveau de CLASSE)",
  computeUnarmedStats({
    classes: [entry('Moine', 1), entry('Magicien', 19)],
    strength: 10,
    dexterity: 16,
    level: 20,
  }).damageStr,
  '1d4+3',
);
check('sneak attack Roublard 3/Barb 2 : 2d6 (niveau de classe)', sneakAttackDice(3), '2d6');

// ---------- Cantrips at CHARACTER level ----------
const scorchingRayChar = {
  level: 0,
  damageJson: '{"damage_at_character_level":{"1":"1d10","5":"2d10","11":"3d10","17":"4d10"}}',
};
// Magicien 1 / Ensorceleur 10 → niveau de personnage 11 → 3d10
check(
  'tour de magie au niveau TOTAL (Mag 1/Ens 10 → 11)',
  spellDamageAtLevel(scorchingRayChar as never, 0, 11).dice,
  '3d10',
);

// ---------- Weapon stats: martial arts die at monk CLASS level ----------
const monkWeaponChar = {
  classes: [entry('Moine', 5), entry('Guerrier', 1)],
  strength: 10,
  dexterity: 16,
  level: 6,
  weaponProficiencies: null,
};
const shortsword = computeWeaponStats(
  {
    category: 'weapon',
    name: 'Shortsword',
    nameFr: 'Épée courte',
    description: null,
    properties: ['finesse', 'monk'],
    damageDice: '1d6',
    damageType: 'piercing',
  } as never,
  monkWeaponChar,
);
check("arme de moine : dé d'arts martiaux d6 (Moine 5)", shortsword?.damageStr, '1d6+3');
const monkWeaponCharLow = {
  ...monkWeaponChar,
  classes: [entry('Moine', 1), entry('Guerrier', 10)],
};
const shortsword2 = computeWeaponStats(
  {
    category: 'weapon',
    name: 'Shortsword',
    nameFr: 'Épée courte',
    description: null,
    properties: ['finesse', 'monk'],
    damageDice: '1d6',
    damageType: 'piercing',
  } as never,
  monkWeaponCharLow,
);
check(
  "arme de moine : d6 conservé (dé de l'arme > d4 du Moine 1)",
  shortsword2?.damageStr,
  '1d6+3',
);

// ---------- applyRest: per-class hit dice, pact reset, class-level counters ----------
const restChar = {
  classes: [entry('Paladin', 5, { hitDiceUsed: 4 }), entry('Clerc', 5, { hitDiceUsed: 0 })],
  level: 10,
  hitDiceUsed: 4,
  maxHp: 80,
  currentHp: 40,
  spellSlotsUsed: [3, 1, 0, 0, 0, 0, 0, 0, 0],
  pactSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  characterClass: 'Paladin',
} as never;
const shortRest = applyRest(restChar, [], { type: 'short', hitDiceSpent: 2, healedHp: 15 });
check('repos court : 2 dés dépensés FIFO sur la ligne Paladin', shortRest.classHitDice, [
  { classKey: 'Paladin', hitDiceUsed: 5 },
  { classKey: 'Clerc', hitDiceUsed: 1 },
]);
check('repos court : soin appliqué 15', shortRest.healed, 15);
const longRest = applyRest(restChar, [], { type: 'long' });
check('repos long : budget ⌊10/2⌋ = 5 dés regagnés', longRest.classHitDice, [
  { classKey: 'Paladin', hitDiceUsed: 0 },
  { classKey: 'Clerc', hitDiceUsed: 0 },
]);
check(
  'repos long : total dés utilisés = 0',
  (longRest.characterPatch as { hitDiceUsed?: number }).hitDiceUsed,
  0,
);

const restLock = {
  classes: [entry('Occultiste', 3), entry('Barbare', 2)],
  level: 5,
  maxHp: 40,
  currentHp: 10,
  spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  pactSlotsUsed: [0, 2, 0, 0, 0, 0, 0, 0, 0],
  characterClass: 'Occultiste',
} as never;
const lockShort = applyRest(restLock, [], { type: 'short' });
check(
  'repos court Occultiste : pool PACTE réinitialisé',
  (lockShort.characterPatch as { pactSlotsUsed?: number[] }).pactSlotsUsed,
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
);
check(
  'repos court Occultiste : pool incantation intact',
  (lockShort.characterPatch as { spellSlotsUsed?: number[] }).spellSlotsUsed,
  undefined,
);

// Counter max at CLASS level: Rage of a Barbare 3 / Magicien 17 = 3, not 5.
const rageChar = { classes: [entry('Barbare', 3), entry('Magicien', 17)], level: 20 } as never;
const rageDef = findClassFeature('barbare-rage');
check(
  'Rage Barbare 3/Mag 17 : max 3 (niveau de classe)',
  rageDef ? classFeatureResourceMax(rageDef, rageChar) : null,
  3,
);
// Second Wind of a Guerrier 2 / Roublard 18 = 1 use.
const secondWindChar = {
  classes: [entry('Guerrier', 2), entry('Roublard', 18)],
  level: 20,
} as never;
const secondWindDef = findClassFeature('guerrier-second-souffle');
check(
  'Second souffle Guerrier 2 : 1 utilisation',
  secondWindDef ? classFeatureResourceMax(secondWindDef, secondWindChar) : null,
  1,
);

if (failures > 0) {
  console.error(`\n${failures} échec(s) — règles de multiclassage`);
  process.exit(1);
}
console.log('Règles de multiclassage : tous les contrôles passent ✓');
