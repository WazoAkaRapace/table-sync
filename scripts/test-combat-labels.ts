/**
 * Épingle la numérotation STABLE des mobs groupés (combatDisplay.ts) :
 * le numéro est le rang d'INSERTION (id croissant), pas la position
 * d'affichage — la mort d'un membre (sortCombatants l'envoie en fin de
 * liste) ne renumérote jamais les survivants.
 *
 * Run: npx tsx scripts/test-combat-labels.ts
 */
import assert from 'node:assert/strict';

type C = {
  id: number;
  name: string;
  groupId: number | null;
  defeated?: boolean;
};

// Réplique minimale du type Combatant consommé par les helpers.
function asCombatant(c: C): any {
  return { ...c };
}

// Import du module web — tsx résout le chemin .ts du repo.
function loadModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../apps/web/src/combatDisplay.ts') as typeof import('../apps/web/src/combatDisplay.ts');
}
const { numberedCombatantLabels, groupMemberNumber } = loadModule();

function check(name: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('Numérotation des mobs groupés — stabilité');

check('ordre affiché = ordre insertion : Gobelin 1, 2, 3', () => {
  const cs = [
    { id: 11, name: 'Gobelin', groupId: 100 },
    { id: 12, name: 'Gobelin', groupId: 100 },
    { id: 13, name: 'Gobelin', groupId: 100 },
  ].map(asCombatant);
  assert.deepEqual(numberedCombatantLabels(cs), ['Gobelin 1', 'Gobelin 2', 'Gobelin 3']);
});

check('mort du n°2 (vaincus en fin de liste) : les survivants gardent 1 et 3', () => {
  // Après le tri serveur, le vaincu (id 12) est en fin de liste.
  const cs = [
    { id: 11, name: 'Gobelin', groupId: 100 },
    { id: 13, name: 'Gobelin', groupId: 100 },
    { id: 12, name: 'Gobelin', groupId: 100, defeated: true },
  ].map(asCombatant);
  const labels = numberedCombatantLabels(cs);
  assert.deepEqual(labels, ['Gobelin 1', 'Gobelin 3', 'Gobelin 2']);
  // Le mort garde SON numéro, les vivants ne bougent pas.
  assert.equal(labels[0], 'Gobelin 1');
  assert.equal(labels[1], 'Gobelin 3');
});

check('groupes distincts : compteurs indépendants', () => {
  const cs = [
    { id: 1, name: 'Zombi', groupId: 7 },
    { id: 2, name: 'Gobelin', groupId: 8 },
    { id: 3, name: 'Zombi', groupId: 7 },
    { id: 4, name: 'Gobelin', groupId: 8 },
  ].map(asCombatant);
  assert.deepEqual(numberedCombatantLabels(cs), ['Zombi 1', 'Gobelin 1', 'Zombi 2', 'Gobelin 2']);
});

check('groupe réduit à 1 vivant + 1 mort : numéro du vivant inchangé', () => {
  const cs = [
    { id: 21, name: 'Orque', groupId: 30 },
    { id: 22, name: 'Orque', groupId: 30, defeated: true },
  ].map(asCombatant);
  assert.equal(groupMemberNumber(cs, cs[0]), 1);
  assert.equal(groupMemberNumber(cs, cs[1]), 2);
  assert.equal(numberedCombatantLabels(cs)[0], 'Orque 1');
});

check('sans groupe : nom seul', () => {
  const cs = [{ id: 5, name: 'Acerérak', groupId: null }].map(asCombatant);
  assert.deepEqual(numberedCombatantLabels(cs), ['Acerérak']);
});

console.log('Tous les tests passent.');
