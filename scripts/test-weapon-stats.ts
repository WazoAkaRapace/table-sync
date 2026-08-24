/**
 * Sanity checks for computeWeaponStats / resolveMagicWeaponBase.
 * Run: npx tsx scripts/test-weapon-stats.ts
 */
import {
  type Character,
  computeWeaponStats,
  effectiveWeaponProficiencies,
  type Item,
  resolveMagicWeaponBase,
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

const mkChar = (over: Partial<Character>): Character => ({
  id: 1,
  partyId: 1,
  ownerId: 1,
  ownerName: '',
  name: 'Test',
  strength: 10,
  capacityMultiplier: 1,
  exhaustion: 0,
  conditions: [],
  foodDays: 0,
  waterDays: 0,
  maxHp: 10,
  currentHp: 10,
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
  spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  alignment: null,
  sex: null,
  height: null,
  weight: null,
  age: null,
  skin: null,
  eyes: null,
  hair: null,
  portraitUrl: null,
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
  hidden: false,
  notes: null,
  copper: 0,
  silver: 0,
  electrum: 0,
  gold: 0,
  platinum: 0,
  createdAt: '',
  ...over,
});

const mkWeapon = (over: Partial<Item>): Item => ({
  id: 1,
  source: 'srd',
  partyId: null,
  category: 'weapon',
  name: 'Greatsword',
  nameFr: 'Épée à deux mains',
  rarity: 'none',
  weightKg: 3,
  costQty: null,
  costUnit: null,
  description: null,
  damageDice: '2d6',
  damageType: 'Slashing',
  acBase: null,
  strMin: null,
  stealthDisadvantage: false,
  properties: ['heavy', 'two-handed'],
  survivalTags: [],
  aliases: [],
  imagePath: null,
  ...over,
});

// --- Mundane weapons ---
const guerrier5 = mkChar({ strength: 16, level: 5 }); // STR +3, prof +3
let s = computeWeaponStats(mkWeapon({}), guerrier5);
check(
  'Guerrier 5, FOR 16, épée à deux mains',
  s && { ab: s.attackBonus, dmg: s.damageStr, prof: s.proficient, ability: s.ability },
  { ab: 6, dmg: '2d6+3', prof: true, ability: 'strength' },
);

const artificier5 = mkChar({ strength: 16, level: 5, characterClass: 'Artificier' });
s = computeWeaponStats(mkWeapon({}), artificier5);
check('Artificier (simple only) → non qualifié', s && { ab: s.attackBonus, prof: s.proficient }, {
  ab: 3,
  prof: false,
});

const rapiere = mkWeapon({
  name: 'Rapier',
  nameFr: 'Rapière',
  damageDice: '1d8',
  damageType: 'Piercing',
  properties: ['finesse'],
});
s = computeWeaponStats(
  rapiere,
  mkChar({ strength: 8, dexterity: 16, level: 1, characterClass: 'Roublard' }),
);
check(
  'Rapière finesse → DEX (prof +2 via spécifiques Roublard)',
  s && { ab: s.attackBonus, dmg: s.damageStr, ability: s.ability },
  { ab: 5, dmg: '1d8+3', ability: 'dexterity' },
);

const arcLong = mkWeapon({
  name: 'Longbow',
  nameFr: 'Arc long',
  damageDice: '1d8',
  damageType: 'Piercing',
  properties: ['ammunition', 'heavy', 'two-handed'],
});
s = computeWeaponStats(arcLong, mkChar({ strength: 18, dexterity: 12, level: 1 }));
check('Arc long → DEX même avec FOR 18', s && { ability: s.ability, ab: s.attackBonus }, {
  ability: 'dexterity',
  ab: 3,
});

const javeline = mkWeapon({
  name: 'Javelin',
  nameFr: 'Javeline',
  damageDice: '1d6',
  damageType: 'Piercing',
  properties: ['thrown'],
});
s = computeWeaponStats(javeline, mkChar({ strength: 14, dexterity: 18 }));
check('Javeline (lancer, sans finesse) → FOR', s && { ability: s.ability, dmg: s.damageStr }, {
  ability: 'strength',
  dmg: '1d6+2',
});

const faible = mkChar({ strength: 6 }); // FOR -2
s = computeWeaponStats(
  mkWeapon({
    name: 'Longsword',
    nameFr: 'Épée longue',
    damageDice: '1d8',
    damageType: 'Slashing',
    properties: ['versatile'],
  }),
  faible,
);
check('FOR 6 → modificateur négatif', s && { dmg: s.damageStr, v: s.versatileDamageStr }, {
  dmg: '1d8-2',
  v: '1d10-2',
});

const baton = mkWeapon({
  name: 'Quarterstaff',
  nameFr: 'Bâton',
  damageDice: '1d6',
  damageType: 'Bludgeoning',
  properties: ['versatile'],
});
s = computeWeaponStats(
  baton,
  mkChar({ strength: 8, dexterity: 16, characterClass: 'Moine', level: 1 }),
);
check('Bâton de Moine → DEX (arts martiaux)', s && { ability: s.ability, dmg: s.damageStr }, {
  ability: 'dexterity',
  dmg: '1d6+3',
});

// --- Magic weapons ---
const langueDeFeu = mkWeapon({
  name: 'Flame Tongue',
  nameFr: 'Langue de feu',
  rarity: 'rare',
  description:
    "Arme (n'importe quelle épée), rare (requiert une harmonisation) Vous pouvez utiliser une action bonus pour provoquer une éruption de flammes depuis la lame.",
  damageDice: null,
  damageType: null,
  properties: [],
});
s = computeWeaponStats(langueDeFeu, guerrier5);
check(
  'Langue de feu → base présumée épée longue, +0',
  s && { dmg: s.damageStr, presumed: s.presumedBase, magic: s.magicBonus, prof: s.proficient },
  { dmg: '1d8+3', presumed: true, magic: 0, prof: true },
);

const dagueVen = mkWeapon({
  name: 'Dagger of Venom',
  nameFr: 'Dague venimeuse',
  rarity: 'rare',
  description:
    'Arme (dague), rare Vous gagnez un bonus de +1 aux jets d’attaque et de dégâts effectués avec cette arme magique.',
  damageDice: null,
  damageType: null,
  properties: [],
});
s = computeWeaponStats(dagueVen, mkChar({ dexterity: 16, level: 5, characterClass: 'Roublard' }));
check(
  'Dague venimeuse → dague, +1 magique, finesse DEX',
  s && { ab: s.attackBonus, dmg: s.damageStr, presumed: s.presumedBase },
  { ab: 7, dmg: '1d4+4', presumed: false },
);

const defenseur = mkWeapon({
  name: 'Defender',
  nameFr: 'Défenseur',
  rarity: 'legendary',
  description:
    "Arme (n'importe quelle épée), légendaire (requiert une harmonisation) Vous gagnez un bonus de +3 aux jets d'attaque et de dégâts.",
  damageDice: null,
  damageType: null,
  properties: [],
});
s = computeWeaponStats(defenseur, guerrier5);
check(
  'Défenseur → épée longue présumée +3',
  s && { ab: s.attackBonus, dmg: s.damageStr, magic: s.magicBonus },
  { ab: 9, dmg: '1d8+6', magic: 3 },
);

const oathbow = mkWeapon({
  name: 'Oathbow',
  nameFr: 'Arc du serment',
  rarity: 'veryRare',
  description: 'Arme (arc long), très rare (requiert une harmonisation)...',
  damageDice: null,
  damageType: null,
  properties: [],
});
s = computeWeaponStats(oathbow, mkChar({ dexterity: 16, level: 5 }));
check('Arc du serment → arc long DEX', s && { ability: s.ability, dmg: s.damageStr }, {
  ability: 'dexterity',
  dmg: '1d8+3',
});

const arme2 = mkWeapon({
  name: 'Weapon, +2',
  nameFr: 'Arme +2',
  rarity: 'rare',
  description: 'Arme (quelconque), rare Vous avez un bonus de +2 aux jets d’attaque et de dégâts.',
  damageDice: null,
  damageType: null,
  properties: [],
});
s = computeWeaponStats(arme2, guerrier5);
check('Arme +2 (quelconque) → null', s, null);

const sunBlade = mkWeapon({
  name: 'Sun Blade',
  nameFr: 'Lame solaire',
  rarity: 'rare',
  description: "Arme (épée longue), rare Cet objet a l'apparence de la poignée d'une épée longue.",
  damageDice: null,
  damageType: null,
  properties: [],
});
s = computeWeaponStats(sunBlade, guerrier5);
check('Lame solaire → épée longue exacte', s && { dmg: s.damageStr, presumed: s.presumedBase }, {
  dmg: '1d8+3',
  presumed: false,
});

// --- Proficiency list handling ---
check(
  "Druide explicite: masse d'armes non qualifiée par défaut",
  computeWeaponStats(
    mkWeapon({
      name: 'Mace',
      nameFr: "Masse d'armes",
      damageDice: '1d6',
      damageType: 'Bludgeoning',
      properties: [],
    }),
    mkChar({ characterClass: 'Druide' }),
  )?.proficient,
  false,
);
check(
  'Druide: gourdin qualifié',
  computeWeaponStats(
    mkWeapon({
      name: 'Club',
      nameFr: 'Gourdin',
      damageDice: '1d4',
      damageType: 'Bludgeoning',
      properties: ['light'],
    }),
    mkChar({ characterClass: 'Druide' }),
  )?.proficient,
  true,
);
check(
  'Liste explicite martial only → épée longue qualifiée, gourdin non',
  effectiveWeaponProficiencies(mkChar({ weaponProficiencies: ['martial'] })),
  { simple: false, martial: true, specific: [] },
);

// --- Unarmed strikes ---
import { computeUnarmedStats, martialArtsDie } from '@table-sync/shared';

let u = computeUnarmedStats(mkChar({ strength: 18, level: 5, characterClass: 'Guerrier' }));
check(
  'Frappe sans arme Guerrier FOR 18 → +7, 1+4 contondants',
  { ab: u.attackBonus, dmg: u.damageStr, ability: u.ability, monk: u.monk },
  { ab: 7, dmg: '1+4', ability: 'strength', monk: false },
);

u = computeUnarmedStats(mkChar({ strength: 8, dexterity: 16, level: 1, characterClass: 'Moine' }));
check(
  'Moine niv 1 DEX 16 → +5, 1d4+3, action bonus',
  {
    ab: u.attackBonus,
    dmg: u.damageStr,
    ability: u.ability,
    monk: u.monk,
    bonus: u.bonusActionAttack,
  },
  { ab: 5, dmg: '1d4+3', ability: 'dexterity', monk: true, bonus: true },
);

u = computeUnarmedStats(mkChar({ strength: 18, dexterity: 10, level: 1, characterClass: 'Moine' }));
check('Moine FOR 18 > DEX → FOR utilisé', u.ability, 'strength');

check(
  'Dé arts martiaux : 1d4/1d6/1d8/1d10',
  [martialArtsDie(1), martialArtsDie(5), martialArtsDie(11), martialArtsDie(17)],
  ['1d4', '1d6', '1d8', '1d10'],
);

u = computeUnarmedStats(
  mkChar({ strength: 10, dexterity: 18, characterClass: 'Roublard', level: 5 }),
);
check(
  'Non-moine avec DEX 18 → FOR quand même (SRD)',
  { ability: u.ability, dmg: u.damageStr },
  { ability: 'strength', dmg: '1' },
);

// --- Monk weapons & martial arts die ---
const epeeCourte = mkWeapon({
  name: 'Shortsword',
  nameFr: 'Épée courte',
  damageDice: '1d6',
  damageType: 'Piercing',
  properties: ['finesse', 'light'],
});
s = computeWeaponStats(
  epeeCourte,
  mkChar({ strength: 8, dexterity: 16, level: 11, characterClass: 'Moine' }),
);
check(
  "Moine niv 11 épée courte → dé d'arts martiaux 1d8",
  s && { dmg: s.damageStr, ability: s.ability, martial: s.martialArtsDie },
  { dmg: '1d8+3', ability: 'dexterity', martial: true },
);

s = computeWeaponStats(
  epeeCourte,
  mkChar({ strength: 8, dexterity: 16, level: 10, characterClass: 'Moine' }),
);
check(
  'Moine niv 10 épée courte → garde 1d6 (d6 = d6)',
  s && { dmg: s.damageStr, martial: s.martialArtsDie },
  { dmg: '1d6+3', martial: false },
);

s = computeWeaponStats(
  epeeCourte,
  mkChar({ strength: 8, dexterity: 16, level: 1, characterClass: 'Moine' }),
);
check(
  'Moine niv 1 épée courte → garde 1d6 (d4 < d6)',
  s && { dmg: s.damageStr, martial: s.martialArtsDie },
  { dmg: '1d6+3', martial: false },
);

const dague = mkWeapon({
  name: 'Dagger',
  nameFr: 'Dague',
  damageDice: '1d4',
  damageType: 'Piercing',
  properties: ['finesse', 'light', 'thrown'],
});
s = computeWeaponStats(
  dague,
  mkChar({ strength: 8, dexterity: 16, level: 5, characterClass: 'Moine' }),
);
check('Moine niv 5 dague (1d4) → 1d6', s && { dmg: s.damageStr, martial: s.martialArtsDie }, {
  dmg: '1d6+3',
  martial: true,
});

s = computeWeaponStats(
  epeeCourte,
  mkChar({ strength: 8, dexterity: 16, level: 10, characterClass: 'Roublard' }),
);
check(
  'Roublard niv 10 épée courte → inchangé 1d6+3',
  s && { dmg: s.damageStr, martial: s.martialArtsDie },
  { dmg: '1d6+3', martial: false },
);

// --- Sneak Attack / Extra Attack / spell damage ---
import { extraAttacks, sneakAttackDice, spellDamageAtLevel } from '@table-sync/shared';

check(
  'Attaque furtive : 1d6/3d6/10d6 (niv 1/5/20)',
  [sneakAttackDice(1), sneakAttackDice(5), sneakAttackDice(20)],
  ['1d6', '3d6', '10d6'],
);
check(
  'Extra Attack : Guerrier 1/5/11/20 → 1/2/3/4',
  [
    extraAttacks('Guerrier', 1),
    extraAttacks('Guerrier', 5),
    extraAttacks('Guerrier', 11),
    extraAttacks('Guerrier', 20),
  ],
  [1, 2, 3, 4],
);
check(
  'Extra Attack : Barbare 5 → 2, Moine 10 → 2 (SRD @5), Magicien 20 → 1',
  [extraAttacks('Barbare', 5), extraAttacks('Moine', 10), extraAttacks('Magicien', 20)],
  [2, 2, 1],
);
check('Extra Attack : Moine 4 → 1 (débloqué au niveau 5)', extraAttacks('Moine', 4), 1);

const bouleDeFeu: any = {
  level: 3,
  damageJson: JSON.stringify({
    damage_type: { index: 'fire' },
    damage_at_slot_level: {
      '3': '8d6',
      '4': '9d6',
      '6': '12d6',
      '8': '14d6',
      '9': '15d6',
      '10': '16d6',
      '11': '17d6',
      '12': '18d6',
      '13': '19d6',
      '14': '20d6',
      '15': '21d6',
      '16': '22d6',
      '17': '23d6',
      '18': '24d6',
      '19': '25d6',
      '20': '26d6',
    },
  }),
};
check('Boule de feu niveau 3 → 8d6 de feu', spellDamageAtLevel(bouleDeFeu, 3, 10), {
  dice: '8d6',
  typeFr: 'de feu',
});
check('Boule de feu niveau 4 → 9d6 (upcast)', spellDamageAtLevel(bouleDeFeu, 4, 10).dice, '9d6');
check(
  'Boule de feu niveau 5 → reste 9d6 (palier suivant à 6)',
  spellDamageAtLevel(bouleDeFeu, 5, 10).dice,
  '9d6',
);
const rayonFeu: any = {
  level: 0,
  damageJson: JSON.stringify({
    damage_type: { index: 'fire' },
    damage_at_character_level: { '1': '1d10', '5': '2d10', '11': '3d10', '17': '4d10' },
  }),
};
check('Sort mineur niveau 10 → 2d10 (palier 5)', spellDamageAtLevel(rayonFeu, 0, 10).dice, '2d10');
check('Sort sans dégâts → null', spellDamageAtLevel({ level: 1, damageJson: null } as any, 1, 10), {
  dice: null,
  typeFr: null,
});

// --- Fighting styles ---
const rodeur5 = mkChar({
  dexterity: 16,
  level: 5,
  characterClass: 'Rôdeur',
  fightingStyle: 'archery',
});
s = computeWeaponStats(arcLong, rodeur5);
check('Rôdeur Archerie → +2 att. arc long (3 DEX + 3 maîtrise + 2)', s && { ab: s.attackBonus }, {
  ab: 8,
});
s = computeWeaponStats(mkWeapon({}), rodeur5);
check('Archerie sans effet en mêlée (FOR 10 → 0 + 3 maîtrise)', s?.attackBonus, 3);

const duelliste = mkChar({
  strength: 16,
  level: 5,
  characterClass: 'Guerrier',
  fightingStyle: 'dueling',
});
const epeeLongue = mkWeapon({
  name: 'Longsword',
  nameFr: 'Épée longue',
  damageDice: '1d8',
  damageType: 'Slashing',
  properties: ['versatile'],
});
s = computeWeaponStats(epeeLongue, duelliste);
check(
  'Duel → +2 dégâts une main, pas à deux mains',
  s && { dmg: s.damageStr, v: s.versatileDamageStr },
  { dmg: '1d8+5', v: '1d10+3' },
);
s = computeWeaponStats(mkWeapon({}), duelliste);
check('Duel sans effet arme à deux mains', s?.damageStr, '2d6+3');

// --- resolveMagicWeaponBase direct ---
check('Bonus depuis nom « Arme +3 »', resolveMagicWeaponBase(arme2).magicBonus, 2);
check(
  'Marteau de lancer nain → Warhammer',
  resolveMagicWeaponBase(
    mkWeapon({
      name: 'Dwarven Thrower',
      nameFr: 'Marteau de lancer nain',
      description: 'Arme (marteau de guerre), très rare (requiert une harmonisation par un nain)',
      damageDice: null,
      damageType: null,
      properties: [],
    }),
  ).base?.nameEn,
  'Warhammer',
);

console.log(failures === 0 ? '\n✅ All weapon stats checks pass' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
