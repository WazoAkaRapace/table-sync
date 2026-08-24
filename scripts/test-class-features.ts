/**
 * Sanity checks for the SRD class-feature catalog, subclass data, rest
 * application (applyRest), pact-magic table and class-resource math.
 * Run: npm run test-class-features
 */
import {
  applyRest,
  type Character,
  type CharacterFeature,
  CLASS_FEATURES,
  CLASS_SUBCLASSES,
  classFeatureResourceMax,
  criticalRange,
  DND_CLASSES,
  effectiveFeatureReset,
  eldritchInvocationsCount,
  featuresForCharacter,
  findClassFeature,
  maxSpellSlots,
  nextClassFeatureGain,
  renderFeatureTemplate,
  SPELL_SLOTS_PACT,
} from '@table-sync/shared';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(
      `✗ ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  } else {
    console.log(`✓ ${label}`);
  }
}

// --- Catalog structure ---

for (const cls of DND_CLASSES) {
  check(`catalogue non vide : ${cls.name}`, (CLASS_FEATURES[cls.name]?.length ?? 0) > 0, true);
}

// Unique ids across base + subclass features
const allIds: string[] = [];
for (const list of Object.values(CLASS_FEATURES)) allIds.push(...list.map((f) => f.id));
for (const subs of Object.values(CLASS_SUBCLASSES)) {
  for (const sub of subs) allIds.push(...sub.features.map((f) => f.id));
}
check('ids de catalogue uniques', new Set(allIds).size, allIds.length);

// --- Resource formulas (SRD) ---

const mkChar = (over: Partial<Character>): Character =>
  ({
    id: 1,
    partyId: 1,
    ownerId: 1,
    ownerName: 'test',
    name: 'Test',
    strength: 10,
    capacityMultiplier: 1,
    exhaustion: 0,
    conditions: [],
    foodDays: 0,
    waterDays: 0,
    maxHp: 30,
    currentHp: 30,
    tempHp: 0,
    level: 1,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    characterClass: 'Guerrier',
    race: null,
    background: null,
    speed: 9,
    skillProficiencies: [],
    skillExpertise: [],
    toolProficiencies: [],
    toolExpertise: [],
    languages: [],
    savingThrowProficiencies: [],
    weaponProficiencies: null,
    armorProficiencies: null,
    fightingStyle: null,
    spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    alignment: null,
    sex: null,
    height: null,
    weight: null,
    age: null,
    skin: null,
    eyes: null,
    hair: null,
    personalityTraits: null,
    ideals: null,
    bonds: null,
    flaws: null,
    appearance: null,
    armorClassOverride: null,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    inspiration: false,
    concentrating: false,
    wildShapeSlug: null,
    wildShapeHp: null,
    wildShapeMaxHp: null,
    wildShapeUses: 2,
    hitDiceUsed: 0,
    wildShapeSeen: [],
    druidCircle: null,
    divineDomain: null,
    landCircle: null,
    sacredOath: null,
    subclass: null,
    hidden: false,
    notes: null,
    copper: 0,
    silver: 0,
    electrum: 0,
    gold: 0,
    platinum: 0,
    createdAt: '2026-01-01',
    ...over,
  }) as Character;

const resourceMaxOf = (catalogId: string, char: Character) =>
  classFeatureResourceMax(findClassFeature(catalogId)!, char);

// Rage : 2/3@3/4@6/5@9/6@12/∞@20 (repos long)
const barb = (level: number) => mkChar({ characterClass: 'Barbare', level });
check('rage @1 = 2', resourceMaxOf('barbare-rage', barb(1)), 2);
check('rage @3 = 3', resourceMaxOf('barbare-rage', barb(3)), 3);
check('rage @6 = 4', resourceMaxOf('barbare-rage', barb(6)), 4);
check('rage @9 = 4 (palier suivant à 12, PHB 2014)', resourceMaxOf('barbare-rage', barb(9)), 4);
check('rage @12 = 5', resourceMaxOf('barbare-rage', barb(12)), 5);
check('rage @17 = 6', resourceMaxOf('barbare-rage', barb(17)), 6);
check('rage @20 = ∞ (null)', resourceMaxOf('barbare-rage', barb(20)), null);

// Ki = niveau (repos court) ; points de sorcellerie = niveau (repos long)
check('ki @7 = 7', resourceMaxOf('moine-ki', mkChar({ characterClass: 'Moine', level: 7 })), 7);
check(
  'sorcellerie @13 = 13',
  resourceMaxOf(
    'ensorceleur-source-de-magie',
    mkChar({ characterClass: 'Ensorceleur', level: 13 }),
  ),
  13,
);

// Imposition des mains = 5 × niveau (PV, repos long) — capacité de NIVEAU 1 (PHB 2014)
check(
  'imposition des mains @6 = 30 PV',
  resourceMaxOf('paladin-imposition-des-mains', mkChar({ characterClass: 'Paladin', level: 6 })),
  30,
);
check(
  'imposition des mains acquise au niveau 1',
  findClassFeature('paladin-imposition-des-mains')?.level,
  1,
);

// Sens divin = 1 + MOD CHA (min 1)
check(
  'sens divin CHA 16 = 4',
  resourceMaxOf(
    'paladin-sens-divins',
    mkChar({ characterClass: 'Paladin', level: 3, charisma: 16 }),
  ),
  4,
);
check(
  'sens divin CHA 6 = 1 (min)',
  resourceMaxOf(
    'paladin-sens-divins',
    mkChar({ characterClass: 'Paladin', level: 3, charisma: 6 }),
  ),
  1,
);

// Inspiration bardique = MOD CHA min 1 ; recharge court dès le niv 5
check(
  'inspiration bardique CHA 18 = 4',
  resourceMaxOf(
    'barde-inspiration-bardique',
    mkChar({ characterClass: 'Barde', level: 3, charisma: 18 }),
  ),
  4,
);
check(
  'inspiration bardique CHA 5 = 1 (min)',
  resourceMaxOf(
    'barde-inspiration-bardique',
    mkChar({ characterClass: 'Barde', level: 3, charisma: 5 }),
  ),
  1,
);
check(
  'inspiration bardique : repos court dès le niv 5',
  findClassFeature('barde-inspiration-bardique')?.resource?.shortFromLevel,
  5,
);

// Canalisation divine : 1/2@6/3@18 (Clerc & Paladin, repos court)
check(
  'canalisation clerc @2 = 1',
  resourceMaxOf('clerc-canalisation-divine', mkChar({ characterClass: 'Clerc', level: 2 })),
  1,
);
check(
  'canalisation clerc @6 = 2',
  resourceMaxOf('clerc-canalisation-divine', mkChar({ characterClass: 'Clerc', level: 6 })),
  2,
);
check(
  'canalisation paladin @18 = 3',
  resourceMaxOf('paladin-canalisation-divine', mkChar({ characterClass: 'Paladin', level: 18 })),
  3,
);

// Second souffle ×1 (court) ; Élan d'action 1→2@17 (court) ; Indomptable 1/2/3 (long)
check('second souffle = 1', resourceMaxOf('guerrier-second-souffle', mkChar({ level: 1 })), 1);
check(
  'sursaut d’activité @2 = 1',
  resourceMaxOf('guerrier-sursaut-activite', mkChar({ level: 2 })),
  1,
);
check(
  'sursaut d’activité @17 = 2',
  resourceMaxOf('guerrier-sursaut-activite', mkChar({ level: 17 })),
  2,
);
check('indomptable @9 = 1', resourceMaxOf('guerrier-indomptable', mkChar({ level: 9 })), 1);
check('indomptable @13 = 2', resourceMaxOf('guerrier-indomptable', mkChar({ level: 13 })), 2);
check('indomptable @17 = 3', resourceMaxOf('guerrier-indomptable', mkChar({ level: 17 })), 3);

// Génie éclair = MOD INT min 1 ; Toucher purificateur = MOD CHA min 1
check(
  'génie éclair INT 16 = 3',
  resourceMaxOf(
    'artificier-genie-eclair',
    mkChar({ characterClass: 'Artificier', level: 7, intelligence: 16 }),
  ),
  3,
);
check(
  'toucher purificateur CHA 12 = 1',
  resourceMaxOf(
    'paladin-toucher-purificateur',
    mkChar({ characterClass: 'Paladin', level: 14, charisma: 12 }),
  ),
  1,
);

// --- Pact magic (RAW) ---

check('pacte L1 = 1×niv1', maxSpellSlots(1, 'pact'), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
check('pacte L3 = 2×niv2', maxSpellSlots(3, 'pact'), [0, 2, 0, 0, 0, 0, 0, 0, 0]);
check('pacte L9 = 2×niv5', maxSpellSlots(9, 'pact'), [0, 0, 0, 0, 2, 0, 0, 0, 0]);
check('pacte L11 = 3×niv5', maxSpellSlots(11, 'pact'), [0, 0, 0, 0, 3, 0, 0, 0, 0]);
check('pacte L17 = 4×niv5', maxSpellSlots(17, 'pact'), [0, 0, 0, 0, 4, 0, 0, 0, 0]);
check('pacte L20 = 4×niv5', SPELL_SLOTS_PACT[19], [0, 0, 0, 0, 4, 0, 0, 0, 0]);

// --- Manifestations occultes (PHB 2014 : 2@2, 3@5, 4@7, 5@9, 6@12, 7@15, 8@18) ---

check('manifestations @2 = 2', [eldritchInvocationsCount(2), eldritchInvocationsCount(4)], [2, 2]);
check(
  'manifestations @5-6 = 3, @7-8 = 4, @9 = 5',
  [
    eldritchInvocationsCount(5),
    eldritchInvocationsCount(7),
    eldritchInvocationsCount(9),
    eldritchInvocationsCount(12),
    eldritchInvocationsCount(15),
    eldritchInvocationsCount(18),
  ],
  [3, 4, 5, 6, 7, 8],
);

// --- Champion crit range ---

check('champion @1 = 20', criticalRange('Guerrier', 'champion', 1), 20);
check('champion @3 = 19', criticalRange('Guerrier', 'champion', 3), 19);
check('champion @15 = 18', criticalRange('Guerrier', 'champion', 15), 18);
check('guerrier sans archétype = 20', criticalRange('Guerrier', null, 10), 20);

// --- Prochaine acquisition ---

check(
  'guerrier niv 1 → prochaine acquisition niv 1 (second souffle)',
  nextClassFeatureGain({ characterClass: 'Guerrier', level: 0 })?.level,
  1,
);
check(
  'guerrier niv 4 → prochaine acquisition niv 5',
  nextClassFeatureGain({ characterClass: 'Guerrier', level: 4 })?.features.map((f) => f.id),
  ['guerrier-attaque-supplementaire'],
);
check(
  'roublard niv 20 → rien',
  nextClassFeatureGain({ characterClass: 'Roublard', level: 20 }),
  null,
);

// --- applyRest ---

const restChar = (over: Partial<Character> = {}) =>
  mkChar({
    characterClass: 'Guerrier',
    level: 9,
    maxHp: 80,
    currentHp: 42,
    tempHp: 5,
    hitDiceUsed: 4,
    exhaustion: 1,
    deathSaveSuccesses: 2,
    deathSaveFailures: 1,
    spellSlotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
    ...over,
  });
const mkFeature = (
  id: number,
  catalogId: string | null,
  cur: number,
  max: number,
  resetType: 'short' | 'long' | 'none' | null = null,
): CharacterFeature => ({
  id,
  characterId: 1,
  title: catalogId ?? `manuel-${id}`,
  category: 'class',
  description: null,
  catalogId,
  resetType,
  counterMax: max,
  counterCurrent: cur,
  sortOrder: 0,
  createdAt: '',
});

const feats = [
  mkFeature(1, 'guerrier-second-souffle', 0, 1), // court
  mkFeature(2, 'guerrier-indomptable', 0, 1), // long
];

const longRest = applyRest(restChar(), feats, { type: 'long' });
check(
  'repos long : PV au max, temp 0, tous emplacements, ½ dés, épuisement −1, mort + concentration',
  {
    hp: longRest.characterPatch.currentHp,
    temp: longRest.characterPatch.tempHp,
    slots: longRest.characterPatch.spellSlotsUsed,
    dice: longRest.characterPatch.hitDiceUsed,
    exh: longRest.characterPatch.exhaustion,
    death: [longRest.characterPatch.deathSaveSuccesses, longRest.characterPatch.deathSaveFailures],
  },
  { hp: 80, temp: 0, slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], dice: 0, exh: 0, death: [0, 0] },
);
check(
  'repos long : les deux compteurs rechargés (max recalculé au niv 9)',
  longRest.featureResets.map((r) => r.featureId),
  [1, 2],
);

// Repos court : le joueur lance ses dés — l'app COMPTE les dés et applique le
// soin annoncé (aucun lancer côté serveur, fonction déterministe)
const shortRest = applyRest(restChar(), feats, {
  type: 'short',
  hitDiceSpent: 2,
  healedHp: 15,
});
check(
  'repos court : 2 dés comptés, +15 PV appliqués, second souffle rechargé mais pas Inflexible',
  {
    dice: shortRest.characterPatch.hitDiceUsed,
    hp: shortRest.characterPatch.currentHp,
    spent: shortRest.diceSpent,
    healed: shortRest.healed,
    resets: shortRest.featureResets.map((r) => r.featureId),
  },
  { dice: 6, hp: 57, spent: 2, healed: 15, resets: [1] },
);
check(
  'repos court : soin plafonné aux PV max',
  applyRest(restChar(), [], { type: 'short', hitDiceSpent: 1, healedHp: 999 }).characterPatch
    .currentHp,
  80,
);
check(
  'repos court : dés sans soin annoncé → compteur seul, PV intacts',
  (() => {
    const r = applyRest(restChar(), [], { type: 'short', hitDiceSpent: 1 });
    return { dice: r.characterPatch.hitDiceUsed, hp: r.characterPatch.currentHp, healed: r.healed };
  })(),
  { dice: 5, hp: undefined, healed: 0 },
);

const pactChar = mkChar({
  characterClass: 'Occultiste',
  level: 5,
  pactSlotsUsed: [0, 2, 0, 0, 0, 0, 0, 0, 0],
});
const pactRest = applyRest(pactChar, [], { type: 'short' });
check(
  'occultiste : repos court restaure le POOL DE PACTE (séparé)',
  pactRest.characterPatch.pactSlotsUsed,
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
);

// Non-pacte : un repos court ne restaure PAS les emplacements
const wizardChar = mkChar({
  characterClass: 'Magicien',
  level: 5,
  spellSlotsUsed: [2, 1, 0, 0, 0, 0, 0, 0, 0],
});
const wizardRest = applyRest(wizardChar, [], { type: 'short' });
check(
  'magicien : repos court ne touche pas aux emplacements',
  wizardRest.characterPatch.spellSlotsUsed,
  undefined,
);

// --- Traits manuels : cases « repos court / repos long » ---

const manual = [
  mkFeature(10, null, 0, 3, 'short'), // capacité maison, repos court
  mkFeature(11, null, 0, 2, 'long'), // capacité maison, repos long
  mkFeature(12, null, 0, 5, null), // rechargement manuel uniquement
];
const manualShort = applyRest(restChar(), manual, { type: 'short' });
check(
  'trait manuel « court » rechargé au repos court, « long » et « aucun » ignorés',
  manualShort.featureResets.map((r) => r.featureId),
  [10],
);
check('trait manuel « court » : restauré à son max stocké (3/3)', manualShort.featureResets[0], {
  featureId: 10,
  counterMax: 3,
  counterCurrent: 3,
});
const manualLong = applyRest(restChar(), manual, { type: 'long' });
check(
  'repos long : « court » et « long » rechargés, « aucun » toujours ignoré',
  manualLong.featureResets.map((r) => r.featureId),
  [10, 11],
);

// --- Data : Corps immortel du Druide @18 (RAW) ---
check(
  'druide Corps immortel @18 (RAW, pas 15)',
  findClassFeature('druide-corps-immortel')?.level,
  18,
);

// --- Choix du joueur vs règle SRD du catalogue (le catalogue pré-remplit, le joueur décide) ---

// Recharge effective : null = règle SRD au niveau actuel (bardique 'long' < niv. 5)
check(
  'effectiveReset : Inspiration bardique suit le catalogue (long @3, short @5)',
  [
    effectiveFeatureReset({ catalogId: 'barde-inspiration-bardique', resetType: null }, 3),
    effectiveFeatureReset({ catalogId: 'barde-inspiration-bardique', resetType: null }, 5),
  ],
  ['long', 'short'],
);
check(
  'effectiveReset : le choix du joueur prime (override none/short)',
  [
    effectiveFeatureReset({ catalogId: 'barde-inspiration-bardique', resetType: 'none' }, 10),
    effectiveFeatureReset({ catalogId: 'moine-ki', resetType: 'long' }, 10),
    effectiveFeatureReset({ catalogId: null, resetType: null }, 10),
  ],
  ['none', 'long', null],
);

// Override 'long' sur un trait de catalogue dont la règle SRD est 'short'
// (Second souffle) : le repos court ne le recharge PLUS, le repos long si.
const overridden = [
  ...feats, // 1: second souffle (SRD court), 2: Inflexible (SRD long)
  mkFeature(20, 'guerrier-second-souffle', 0, 1, 'long'), // n'écrase pas : id distinct
];
const overrideShort = applyRest(restChar(), overridden, { type: 'short' });
check(
  'override long sur Second souffle : ignoré au repos court',
  overrideShort.featureResets.map((r) => r.featureId),
  [1], // seul le Second souffle SRD (id 1) est rechargé ; l'override (20) non
);
const overrideLong = applyRest(restChar(), overridden, { type: 'long' });
check(
  'override long sur Second souffle : rechargé au repos long',
  overrideLong.featureResets.map((r) => r.featureId).includes(20),
  true,
);

// Override 'none' : jamais rechargé, même au repos long
const banned = applyRest(restChar(), [mkFeature(21, 'moine-ki', 0, 5, 'none')], {
  type: 'long',
});
check('override none : jamais rechargé (même repos long)', banned.featureResets.length, 0);

// Override sur un trait de catalogue : la formule SRD du max reste appliquée
// (Imposition des mains niv 6 → 30 PV, rechargés au repos court grâce à l'override)
const layOnHands = mkFeature(
  22,
  'paladin-imposition-des-mains',
  0,
  35, // max stocké volontairement faux : la formule doit gagner
  'short',
);
const lohRest = applyRest(mkChar({ characterClass: 'Paladin', level: 6 }), [layOnHands], {
  type: 'short',
});
check(
  'override + formule : Imposition des mains override court, max recalculé à 30',
  lohRest.featureResets[0],
  { featureId: 22, counterMax: 30, counterCurrent: 30 },
);

// Régression bardique : la règle SRD (long → court au niv. 5) s'applique sans override
const bardic5 = applyRest(
  mkChar({ characterClass: 'Barde', level: 5, charisma: 18 }),
  [mkFeature(23, 'barde-inspiration-bardique', 0, 4)],
  { type: 'short' },
);
check('bardique niv 5 : rechargée au repos court (palier SRD)', bardic5.featureResets.length, 1);
const bardic3 = applyRest(
  mkChar({ characterClass: 'Barde', level: 3, charisma: 18 }),
  [mkFeature(24, 'barde-inspiration-bardique', 0, 4)],
  { type: 'short' },
);
check('bardique niv 3 : PAS rechargée au repos court', bardic3.featureResets.length, 0);

// --- Couverture complète & placeholders (passe AideDD par agent) ---

// Wiring des colonnes dédiées : domaines/serments/cercles alimentent le catalogue
check(
  'Clerc/Vie @8 voit la Frappe divine du domaine',
  featuresForCharacter({ characterClass: 'Clerc', divineDomain: 'vie', level: 8 }).some(
    (f) => f.id === 'vie-frappe-divine',
  ),
  true,
);
check(
  'Paladin/Vengeance @20 voit l’Ange de la vengeance',
  featuresForCharacter({ characterClass: 'Paladin', sacredOath: 'vengeance', level: 20 }).some(
    (f) => f.id === 'paladin-ange-vengeance',
  ),
  true,
);
check(
  'Artificier/Artilleur @3 voit le Canon occulte',
  featuresForCharacter({ characterClass: 'Artificier', subclass: 'artilleur', level: 3 }).some(
    (f) => f.id === 'artilleur-canon-occulte',
  ),
  true,
);

// Placeholders : aucune description de catalogue ne laisse de {{...}} non rendu
// pour sa classe (les {{save_dc}} sont réservés aux classes à incantation —
// les non-lanceurs portent la formule littérale « 8 + {{prof}} + mod »).
const RENDER_CLASSES: Array<[string, Record<string, unknown>]> = [
  ['Artificier', { subclass: 'alchimiste', intelligence: 16 }],
  ['Barbare', { subclass: 'berserker', charisma: 12 }],
  ['Barde', { subclass: 'savoir', charisma: 14 }],
  ['Clerc', { divineDomain: 'tempete', wisdom: 14 }],
  ['Druide', { druidCircle: 'lune', wisdom: 14 }],
  ['Ensorceleur', { subclass: 'draconique', charisma: 14 }],
  ['Guerrier', { subclass: 'maitre-de-guerre', strength: 16 }],
  ['Magicien', { subclass: 'evocation', intelligence: 16 }],
  ['Moine', { subclass: 'main-ouverte', wisdom: 14 }],
  ['Occultiste', { subclass: 'fielon', charisma: 14 }],
  ['Paladin', { sacredOath: 'vengeance', charisma: 14 }],
  ['Rôdeur', { subclass: 'chasseur', wisdom: 14 }],
  ['Roublard', { subclass: 'assassin', dexterity: 16 }],
];
const mkRenderChar = (cls: string, over: Record<string, unknown>): Character =>
  mkChar({ characterClass: cls, ...over });
for (const [cls, over] of RENDER_CLASSES) {
  const ch = mkRenderChar(cls, over);
  const all = featuresForCharacter(ch as never);
  const unrendered: string[] = [];
  for (const f of all) {
    const rendered = renderFeatureTemplate(f.description, ch);
    const leftover = rendered.match(/\{\{[^}]+\}\}/g);
    if (leftover) unrendered.push(`${f.id}: ${leftover.join(',')}`);
  }
  check(`placeholders rendus — ${cls} (${all.length} capacités)`, unrendered, []);
}

console.log(failures === 0 ? '\n✅ All class-feature checks pass' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
