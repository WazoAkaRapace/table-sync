/**
 * Sanity checks for resolveMagicArmorBase / computeAC magic-armor handling.
 * Run: npm run test-armor-stats
 */
import { computeAC, computeSpeed, type Item, resolveMagicArmorBase } from '@table-sync/shared';

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

const mkArmor = (over: Partial<Item>): Item => ({
  id: 1,
  source: 'srd',
  partyId: null,
  category: 'armor',
  name: 'Plate Armor',
  nameFr: 'Harnois',
  rarity: 'veryRare',
  weightKg: 32.5,
  costQty: null,
  costUnit: null,
  description: 'Armure (plates), très rare',
  damageDice: null,
  damageType: null,
  acBase: null,
  strMin: null,
  stealthDisadvantage: false,
  properties: [],
  survivalTags: [],
  aliases: [],
  imagePath: null,
  ...over,
});

const entry = (item: Item) => ({ item: { ...item, category: item.category }, equipped: true });

// --- Base resolution ---
let r = resolveMagicArmorBase(
  mkArmor({
    name: 'Dwarven Plate',
    nameFr: 'Harnois nain',
    description:
      'Armure (plates), très rare (requiert une harmonisation) Vous gagnez un bonus de +2 à la CA.',
  }),
);
check(
  'Harnois nain → plates +2',
  { base: r.base?.nameEn, bonus: r.magicBonus, shield: r.shield },
  { base: 'Plate Armor', bonus: 2, shield: false },
);

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Elven Chain',
    nameFr: 'Chemise de mailles elfique',
    weightKg: 10,
    description:
      'Armure (chemise de mailles), rare Vous gagnez un bonus de +1 à la CA tant que vous portez cette armure.',
  }),
);
check(
  'Chemise elfique → chain shirt +1',
  { base: r.base?.nameEn, bonus: r.magicBonus },
  { base: 'Chain Shirt', bonus: 1 },
);

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Red Dragon Scale Mail',
    nameFr: "Cotte d'écailles de dragon rouge",
    weightKg: 22.5,
    description: "Armure (cotte d'écailles), très rare Vous gagnez un bonus de +1 à la CA.",
  }),
);
check(
  'Cotte de dragon rouge → scale mail +1',
  { base: r.base?.nameEn, bonus: r.magicBonus },
  { base: 'Scale Mail', bonus: 1 },
);

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Glamoured Studded Leather Armor',
    nameFr: 'Armure de cuir cloutée illusoire',
    weightKg: 6.5,
    description: 'Armure (cuir clouté), rare … vous gagnez un bonus de +1 à la CA.',
  }),
);
check(
  'Cuir clouté illusoire (accord féminin) via en-tête',
  r.base?.nameEn,
  'Studded Leather Armor',
);

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Armor of Invulnerability',
    nameFr: "Armure d'invulnérabilité",
    description: 'Armure (armure de plates), légendaire …',
  }),
);
check('Invulnérabilité → plates (synonyme)', r.base?.nameEn, 'Plate Armor');

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Armor, +1',
    nameFr: 'Armure +1',
    rarity: 'rare',
    description:
      'Armure (légère, intermédiaire ou lourde), rare Vous bénéficiez d\u2019un bonus de +1 à la CA tant que vous portez cette armure.',
  }),
);
check(
  'Armure +1 → famille sans base, bonus 1',
  { base: r.base, bonus: r.magicBonus },
  { base: null, bonus: 1 },
);

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Bouclier animé',
    nameFr: 'Bouclier animé',
    description: 'Armure (bouclier), très rare …',
    weightKg: 2.7,
  }),
);
check(
  'Bouclier animé → shield',
  { shield: r.shield, bonus: r.magicBonus },
  { shield: true, bonus: 0 },
);

r = resolveMagicArmorBase(
  mkArmor({
    name: 'Arrow-Catching Shield',
    nameFr: 'Bouclier attrape-flèches',
    description: 'Armure (bouclier), rare … bonus de +2 à la CA contre les attaques à distance …',
    weightKg: 2.7,
  }),
);
check(
  'Attrape-flèches : bonus conditionnel exclu',
  { shield: r.shield, bonus: r.magicBonus },
  { shield: true, bonus: 0 },
);

// --- computeAC ---
const dex4 = 4; // DEX 18
check(
  'Harnois nain équipé → 18 + 2, sans DEX',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Dwarven Plate',
          nameFr: 'Harnois nain',
          description: 'Armure (plates) … bonus de +2 à la CA.',
        }),
      ),
    ],
    dex4,
  ).ac,
  20,
);

check(
  'Chemise elfique → 13 + min(4,2) + 1 = 16',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Elven Chain',
          nameFr: 'Chemise de mailles elfique',
          description: 'Armure (chemise de mailles) … bonus de +1 à la CA.',
        }),
      ),
    ],
    dex4,
  ).ac,
  16,
);

check(
  'Cuir clouté illusoire → 12 + DEX + 1 = 17',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Glamoured Studded Leather',
          nameFr: 'Armure de cuir cloutée illusoire',
          description: 'Armure (cuir clouté) … bonus de +1 à la CA.',
        }),
      ),
    ],
    dex4,
  ).ac,
  17,
);

check(
  'Bouclier animé → +2 sur sans armure',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Animated Shield',
          nameFr: 'Bouclier animé',
          description: 'Armure (bouclier) …',
        }),
      ),
    ],
    dex4,
  ).ac,
  16,
);

check(
  'Armure +1 seule (famille) → sans armure 10 + DEX',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Armor, +1',
          nameFr: 'Armure +1',
          description: 'Armure (légère, intermédiaire ou lourde) … bonus de +1 à la CA …',
        }),
      ),
    ],
    dex4,
  ).ac,
  14,
);

// Mundane armor regression: light/medium DEX handling (strMin 0 in the data)
const cuirasse = mkArmor({
  name: 'Breastplate',
  nameFr: 'Cuirasse',
  rarity: 'none' as any,
  acBase: 14,
  strMin: 0,
  description: '',
});
check(
  'Cuirasse simple → 14 + min(4,2) = 16 (DEX plafonnée)',
  computeAC([entry(cuirasse)], dex4).ac,
  16,
);
const cuir = mkArmor({
  name: 'Leather Armor',
  nameFr: 'Cuir',
  rarity: 'none' as any,
  acBase: 11,
  strMin: 0,
  description: '',
});
check('Cuir simple → 11 + 4 = 15', computeAC([entry(cuir)], dex4).ac, 15);
const harnois = mkArmor({
  name: 'Plate Armor',
  nameFr: 'Harnois',
  rarity: 'none' as any,
  acBase: 18,
  strMin: 15,
  description: '',
});
check('Harnois simple → 18 sans DEX', computeAC([entry(harnois)], dex4).ac, 18);

// --- Class unarmored defense & armor-dependent speed ---
const barbare = { constitution: 16, wisdom: 10, characterClass: 'Barbare' };
const moine = { constitution: 10, wisdom: 16, characterClass: 'Moine' };

check('Barbare sans armure → 10 + 4 DEX + 3 CON = 17', computeAC([], 4, false, barbare).ac, 17);
check(
  'Barbare sans armure + bouclier → 17 + 2 = 19',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Shield',
          nameFr: 'Bouclier',
          rarity: 'none' as any,
          acBase: 2,
          strMin: 0,
          description: '',
        }),
      ),
    ],
    4,
    false,
    barbare,
  ).ac,
  19,
);
check(
  'Barbare en armure → règle normale (Cuir 11 + 4)',
  computeAC([entry(cuir)], 4, false, barbare).ac,
  15,
);
check(
  'Moine sans armure ni bouclier → 10 + 4 DEX + 3 SAG = 17',
  computeAC([], 4, false, moine).ac,
  17,
);
check(
  'Moine AVEC bouclier → perd la SAG mais garde le bouclier : 10 + 4 + 2 = 16',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Shield',
          nameFr: 'Bouclier',
          rarity: 'none' as any,
          acBase: 2,
          strMin: 0,
          description: '',
        }),
      ),
    ],
    4,
    false,
    moine,
  ).ac,
  16,
);
check('Moine en armure → règle normale', computeAC([entry(cuir)], 4, false, moine).ac, 15);
check(
  'Non-classe sans armure → 10 + DEX (inchangé)',
  computeAC([], 4, false, { constitution: 18, wisdom: 18, characterClass: 'Guerrier' }).ac,
  14,
);

// --- Ensorceleur / Lignée draconique : Résilience draconique (13 + DEX, bouclier ok) ---
const draconique = {
  constitution: 10,
  wisdom: 10,
  characterClass: 'Ensorceleur',
  subclass: 'draconique',
};
check('Draconique sans armure → 13 + 4 DEX = 17', computeAC([], 4, false, draconique).ac, 17);
check(
  'Draconique sans armure + bouclier → 17 + 2 = 19',
  computeAC(
    [
      entry(
        mkArmor({
          name: 'Shield',
          nameFr: 'Bouclier',
          rarity: 'none' as any,
          acBase: 2,
          strMin: 0,
          description: '',
        }),
      ),
    ],
    4,
    false,
    draconique,
  ).ac,
  19,
);
check(
  'Draconique en armure → règle normale (Cuir 11 + 4)',
  computeAC([entry(cuir)], 4, false, draconique).ac,
  15,
);
check(
  'Ensorceleur sans lignée → 10 + DEX',
  computeAC([], 4, false, { characterClass: 'Ensorceleur', subclass: 'sauvage' }).ac,
  14,
);

// Speed
check(
  'Moine niv 10 sans armure → +6 m (9 → 15)',
  computeSpeed({ characterClass: 'Moine', level: 10, speed: 9 }, []),
  { speed: 15, bonus: 6, sources: ['Déplacement sans armure +6 m'] },
);
check(
  'Moine niv 10 avec bouclier → pas de bonus',
  computeSpeed(
    { characterClass: 'Moine', level: 10, speed: 9 },
    [
      entry(
        mkArmor({
          name: 'Shield',
          nameFr: 'Bouclier',
          rarity: 'none' as any,
          acBase: 2,
          strMin: 0,
          description: '',
        }),
      ),
    ].map((e) => e),
  ).bonus,
  0,
);
check(
  'Moine niv 1 → pas de bonus (niveau 2 requis)',
  computeSpeed({ characterClass: 'Moine', level: 1, speed: 9 }, []).bonus,
  0,
);
check(
  'Barbare niv 5 sans armure → +3 m',
  computeSpeed({ characterClass: 'Barbare', level: 5, speed: 9 }, []).bonus,
  3,
);
check(
  'Barbare niv 5 en armure légère → +3 m quand même',
  computeSpeed({ characterClass: 'Barbare', level: 5, speed: 9 }, [entry(cuir)]).bonus,
  3,
);
check(
  'Barbare niv 5 en armure lourde (FOR 20) → pas de bonus',
  computeSpeed({ characterClass: 'Barbare', level: 5, speed: 9, strength: 20 }, [entry(harnois)])
    .bonus,
  0,
);
check(
  'Barbare niv 5 en armure lourde MAGIQUE (FOR 20) → pas de bonus',
  computeSpeed({ characterClass: 'Barbare', level: 5, speed: 9, strength: 20 }, [
    entry(
      mkArmor({
        name: 'Dwarven Plate',
        nameFr: 'Harnois nain',
        description: 'Armure (plates) … bonus de +2 à la CA.',
      }),
    ),
  ]).bonus,
  0,
);
check(
  'Guerrier → pas de bonus',
  computeSpeed({ characterClass: 'Guerrier', level: 20, speed: 9 }, []).bonus,
  0,
);

// --- Vitesse décimale (petites races : base 7,5 m) ---
check('Base 7.5 sans classe → conservée telle quelle', computeSpeed({ level: 5, speed: 7.5 }, []), {
  speed: 7.5,
  bonus: 0,
  sources: [],
});
check(
  'Moine niv 6 base 7.5 → +4.5 m (7.5 → 12)',
  computeSpeed({ characterClass: 'Moine', level: 6, speed: 7.5 }, []),
  { speed: 12, bonus: 4.5, sources: ['Déplacement sans armure +4.5 m'] },
);
check(
  'Moine niv 14 base 7.5 → +7.5 m (7.5 → 15)',
  computeSpeed({ characterClass: 'Moine', level: 14, speed: 7.5 }, []),
  { speed: 15, bonus: 7.5, sources: ['Déplacement sans armure +7.5 m'] },
);
check(
  'Barbare niv 5 base 7.5 → +3 m (7.5 → 10.5)',
  computeSpeed({ characterClass: 'Barbare', level: 5, speed: 7.5 }, []),
  { speed: 10.5, bonus: 3, sources: ['Déplacement rapide +3 m'] },
);

console.log('class rules: done');

// --- Heavy armor STR-minimum speed penalty (SRD) ---
const cuirasse_armor = cuirasse; // alias for clarity
check(
  'Cotte de mailles (min 13) avec FOR 12 → −3 m',
  computeSpeed({ characterClass: 'Guerrier', level: 10, speed: 9, strength: 12 }, [
    entry(
      mkArmor({
        name: 'Chain Mail',
        nameFr: 'Cotte de mailles',
        rarity: 'none' as any,
        acBase: 16,
        strMin: 13,
        description: '',
      }),
    ),
  ]),
  { speed: 6, bonus: -3, sources: ['Armure lourde −3 m (FOR insuffisante)'] },
);

check(
  'Cotte de mailles avec FOR 13 → pas de pénalité',
  computeSpeed({ characterClass: 'Guerrier', level: 10, speed: 9, strength: 13 }, [
    entry(
      mkArmor({
        name: 'Chain Mail',
        nameFr: 'Cotte de mailles',
        rarity: 'none' as any,
        acBase: 16,
        strMin: 13,
        description: '',
      }),
    ),
  ]).bonus,
  0,
);

check(
  'Harnois nain magique (min 15) avec FOR 14 → −3 m',
  computeSpeed({ characterClass: 'Guerrier', level: 10, speed: 9, strength: 14 }, [
    entry(
      mkArmor({
        name: 'Dwarven Plate',
        nameFr: 'Harnois nain',
        description: 'Armure (plates) … bonus de +2 à la CA.',
      }),
    ),
  ]).bonus,
  -3,
);

check(
  'Armure légère avec FOR 6 → pas de pénalité',
  computeSpeed({ characterClass: 'Guerrier', level: 10, speed: 9, strength: 6 }, [
    entry(cuirasse_armor),
  ]).bonus,
  0,
);

check(
  'Barbare FOR 12 en cotte de mailles → lourd : pas de déplacement rapide, −3',
  computeSpeed({ characterClass: 'Barbare', level: 5, speed: 9, strength: 12 }, [
    entry(
      mkArmor({
        name: 'Chain Mail',
        nameFr: 'Cotte de mailles',
        rarity: 'none' as any,
        acBase: 16,
        strMin: 13,
        description: '',
      }),
    ),
  ]),
  { speed: 6, bonus: -3, sources: ['Armure lourde −3 m (FOR insuffisante)'] },
);

check(
  'Cotte de mailles (min 13) avec FOR 12, base 7.5 → −3 m (7.5 → 4.5)',
  computeSpeed({ characterClass: 'Guerrier', level: 10, speed: 7.5, strength: 12 }, [
    entry(
      mkArmor({
        name: 'Chain Mail',
        nameFr: 'Cotte de mailles',
        rarity: 'none' as any,
        acBase: 16,
        strMin: 13,
        description: '',
      }),
    ),
  ]),
  { speed: 4.5, bonus: -3, sources: ['Armure lourde −3 m (FOR insuffisante)'] },
);

console.log(failures === 0 ? '\n✅ All armor stats checks pass' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
