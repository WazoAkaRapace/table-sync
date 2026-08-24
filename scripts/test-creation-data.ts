/**
 * Sanity checks for the character-creation catalogs and derivations:
 * standard array, class skill lists (SRD 5.1 counts), race & background
 * catalogs, averageMaxHp math, classSkillChoices fallback.
 * Run: npm run test-creation-data
 */
import {
  averageMaxHp,
  type ClassInfo,
  classSkillChoices,
  DND_BACKGROUNDS,
  DND_CLASSES,
  DND_RACES,
  DND_SKILLS,
  STANDARD_ARRAY,
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

const SKILL_KEYS = new Set(DND_SKILLS.map((s) => s.key));

// Standard array: the six SRD values, descending
check(
  'tableau standard',
  [...STANDARD_ARRAY].sort((a, b) => b - a),
  [15, 14, 13, 12, 10, 8],
);

// Every class has a valid skill choice; SRD 5.1 counts (Barde any 3, Roublard 4, others 2)
for (const cls of DND_CLASSES as ClassInfo[]) {
  const choice = classSkillChoices(cls.name);
  check(
    `${cls.name} — nb de choix`,
    choice.count,
    cls.name === 'Roublard' ? 4 : cls.name === 'Barde' ? 3 : 2,
  );
  check(`${cls.name} — barde parmi toutes`, choice.anySkill ?? false, cls.name === 'Barde');
  // Description AideDD : présente, une ligne raisonnable (saveur + traits)
  if (cls.description.trim().length < 20 || cls.description.length > 180) {
    failures++;
    console.error(`✗ ${cls.name} — description absente ou hors gabarit (20-180 caractères)`);
  }
  for (const key of choice.skills) {
    if (!SKILL_KEYS.has(key)) {
      failures++;
      console.error(`✗ ${cls.name} — compétence inconnue : ${key}`);
    }
  }
  if (choice.anySkill && choice.skills.length > 0) {
    failures++;
    console.error(`✗ ${cls.name} — anySkill ne doit pas lister de compétences`);
  }
  if (!choice.anySkill && choice.skills.length < choice.count) {
    failures++;
    console.error(`✗ ${cls.name} — liste plus courte que le nombre de choix`);
  }
}
check('Barde — parmi toutes les 18', classSkillChoices('Barde').anySkill, true);
check('classe inconnue — repli 2 parmi toutes', classSkillChoices('Pirate des astres'), {
  count: 2,
  skills: [],
  anySkill: true,
});

// Races: 8 SRD species, unique names (species + subraces), non-empty descriptions
const raceNames = DND_RACES.flatMap((r) => [r.name, ...r.subraces.map((s) => s.name)]);
check('espèces SRD', DND_RACES.length, 8);
check('noms d’espèces/sous-races uniques', new Set(raceNames).size, raceNames.length);
for (const race of DND_RACES) {
  if (!race.description.trim()) {
    failures++;
    console.error(`✗ ${race.name} — description vide`);
  }
  for (const sub of race.subraces) {
    if (!sub.description.trim()) {
      failures++;
      console.error(`✗ ${sub.name} — description vide`);
    }
  }
}
// Species that must carry subraces in the SRD
for (const name of ['Nain', 'Elfe', 'Halfelin', 'Gnome']) {
  const race = DND_RACES.find((r) => r.name === name);
  if (!race || race.subraces.length === 0) {
    failures++;
    console.error(`✗ ${name} doit avoir des sous-races`);
  }
}

// Backgrounds: the 7 SRD 5.1 entries, unique, described
const expectedBackgrounds = [
  'Acolyte',
  'Criminel',
  'Héros du peuple',
  'Noble',
  'Sage',
  'Soldat',
  'Orphelin',
];
check(
  'historiques SRD',
  DND_BACKGROUNDS.map((b) => b.name),
  expectedBackgrounds,
);

// Average HP: L1 = die + CON mod; L3 = die + 2×(die/2+1 + CON mod); min 1/level
check('PV L1 guerrier CON 10', averageMaxHp(1, 10, 10), 10);
check('PV L1 barbare CON 14', averageMaxHp(1, 12, 14), 14);
check('PV L3 magicien CON 10', averageMaxHp(3, 6, 10), 6 + 2 * 4);
check('PV L5 roublard CON 12', averageMaxHp(5, 8, 12), 9 + 4 * 6);
check('PV jamais sous le niveau', averageMaxHp(4, 6, 1), 4);

if (failures > 0) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log('\nCréation — données et dérivations : OK');
