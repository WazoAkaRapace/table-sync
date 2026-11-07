/**
 * Suite du moteur de template de dégâts (plan « Armes personnalisées
 * complètes », Task 9). Passe les cas pinnés du plan + un gardien
 * anti-régression du catalogue : TOUT damage_dice des seeds doit parser
 * (compatibilité descendante SRD).
 * Run: npm run test-damage-template
 */
import { readFileSync } from 'node:fs';
import { type DamageVars, parseDamageTemplate, renderDamageTemplate } from '@table-sync/shared';

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

const vars = (over: Partial<DamageVars> = {}): DamageVars => ({
  strMod: 0,
  dexMod: 0,
  magicBonus: 0,
  ...over,
});

// --- Parser : cas pinnés du plan ---
check('parse « 4d6+FOR+2 »', parseDamageTemplate('4d6+FOR+2'), {
  tokens: [{ kind: 'dice', count: 4, faces: 6 }, { kind: 'str' }, { kind: 'fixed', value: 2 }],
  diceStr: '4d6',
});
check('parse « 2d6 » pur (compat SRD)', parseDamageTemplate('2d6'), {
  tokens: [{ kind: 'dice', count: 2, faces: 6 }],
  diceStr: '2d6',
});
check('parse multi-dés « 2d6+1d4 »', parseDamageTemplate('2d6+1d4')?.diceStr, '2d6+1d4');
check('parse « 1d4-1 » (négatif)', parseDamageTemplate('1d4-1')?.tokens[1], {
  kind: 'fixed',
  value: -1,
});
check('parse « 1d8+DEX »', parseDamageTemplate('1d8+DEX')?.tokens[1], { kind: 'dex' });
check('parse « 2d6+magie »', parseDamageTemplate('2d6+magie')?.tokens[1], { kind: 'magic' });
check('parse « magie » insensible casse', parseDamageTemplate('2d6+MAGIE')?.tokens[1], {
  kind: 'magic',
});
check('parse espaces tolérés', parseDamageTemplate(' 4d6 + FOR + 2 ')?.diceStr, '4d6');
check('parse « 4d6+FOO » → null', parseDamageTemplate('4d6+FOO'), null);
check('parse « » → null', parseDamageTemplate(''), null);
check('parse «   » → null', parseDamageTemplate('   '), null);
check('parse dés impossibles « 4d7 » → null', parseDamageTemplate('4d7'), null);
check('parse bonus fixe > ±20 → null', parseDamageTemplate('1d6+25'), null);
check('parse « -FOR » (mot-clé nié) → null', parseDamageTemplate('1d6-FOR'), null);
check('parse « 4d6+ » (terme vide) → null', parseDamageTemplate('4d6+'), null);
check('parse junk « coucou » → null', parseDamageTemplate('coucou'), null);

// --- Renderer : cas pinnés du plan ---
check(
  'render « 4d6+FOR+2 » strMod 4 (magicBonus 2 hors template)',
  renderDamageTemplate(parseDamageTemplate('4d6+FOR+2')!, vars({ strMod: 4, magicBonus: 2 })),
  '4d6+6',
);
check(
  'render « 2d6 » pur (compat SRD, mods nuls)',
  renderDamageTemplate(parseDamageTemplate('2d6')!, vars()),
  '2d6',
);
check(
  'render « 4d6+6 » figé (mods ignorés)',
  renderDamageTemplate(parseDamageTemplate('4d6+6')!, vars({ strMod: 5, dexMod: 3 })),
  '4d6+6',
);
check(
  'render « 1d8+DEX » dexMod 3',
  renderDamageTemplate(parseDamageTemplate('1d8+DEX')!, vars({ dexMod: 3 })),
  '1d8+3',
);
check(
  'render « 2d6+magie » magicBonus 2',
  renderDamageTemplate(parseDamageTemplate('2d6+magie')!, vars({ magicBonus: 2 })),
  '2d6+2',
);
check(
  'render « 1d4-1 » négatif',
  renderDamageTemplate(parseDamageTemplate('1d4-1')!, vars()),
  '1d4-1',
);
check(
  'render « 1d4+FOR » strMod négatif → 1d4-2',
  renderDamageTemplate(parseDamageTemplate('1d4+FOR')!, vars({ strMod: -2 })),
  '1d4-2',
);
check(
  'render « 2d6+1d4+FOR » multi-dés + mod',
  renderDamageTemplate(parseDamageTemplate('2d6+1d4+FOR')!, vars({ strMod: 3 })),
  '2d6+1d4+3',
);
check(
  'render mods nuls → dés seuls',
  renderDamageTemplate(parseDamageTemplate('1d8+DEX')!, vars({ dexMod: 0 })),
  '1d8',
);
check(
  'render flatBonus (mods implicites + Duel) fondu dans la somme',
  renderDamageTemplate(parseDamageTemplate('1d8')!, vars(), 5),
  '1d8+5',
);
check(
  'render sans mot-clé → vars de capacité ignorées (seul le flat compte)',
  renderDamageTemplate(parseDamageTemplate('1d8')!, vars({ strMod: 3 }), 2),
  '1d8+2',
);

// --- Gardien anti-régression du catalogue : tout damage_dice des seeds parse ---
type SeedItem = { category?: string; damageDice?: string | null; name?: string };
const seeds: SeedItem[] = JSON.parse(
  readFileSync(new URL('../data/items-seed.json', import.meta.url), 'utf8'),
);
const diceValues = seeds.filter((i) => i.damageDice);
check('le catalogue porte des damage_dice à scanner', diceValues.length > 0, true);
const unparsable = diceValues.filter((i) => parseDamageTemplate(i.damageDice as string) === null);
check(
  `tous les damage_dice des seeds parsent (${diceValues.length} valeurs, aucun « + »)`,
  unparsable.map((i) => `${i.name}: ${i.damageDice}`),
  [],
);

console.log(
  failures === 0 ? '\n✅ All damage template checks pass' : `\n❌ ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
