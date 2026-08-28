#!/usr/bin/env tsx
/**
 * Ratchet i18n : compte les caractères accentués FR restants dans apps/web/src
 * (hors commentaires, hors i18n/) et échoue si ça REMONTE au-dessus de la
 * baseline. Chaque lot de traduction doit faire descendre la baseline —
 * recalcul avec --update. Voir docs/i18n-app-translation-plan.md § 4.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../apps/web/src');
const BASELINE = resolve(HERE, 'ui-strings-baseline.json');

const ACC = /[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/g;
// FR non accentué — mots SÛRS (aucune collision EN/Tailwind)
const FR_UI = /\b(fermer|ajouter|annuler|enregistrer|supprimer|modifier|rechercher|créer|retirer|nouvelle?|aucun|aucune|rencontres?|monstres?|joueurs?|combattants?|maîtrises?|compétences?|sous-classe|personnages?|groupes?|sauvegarde|épuisement|encombrement|encombré|portage|utilisations?|inspiration|concentration|initiative|dégâts|quantité|poids|niveaux|disposition|invitations?|langues?|armures?)\b/gi;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'i18n' || name.startsWith('.')) continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const perFile: Record<string, number> = {};
for (const file of walk(ROOT)) {
  let src = readFileSync(file, 'utf8');
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Liste blanche : littéraux FR qui sont des CLÉS de logique/données (noms de
  // classe comparés, conditions stockées, listes SRD) — pas de l'affichage.
  src = src
    .replace(/(?:===|!==|==|\.includes\(|\.indexOf\(|\.filter\()[^\n]*/g, (l) =>
      l.replace(/'[^']*'/g, "''"),
    )
    .replace(/case '[^']*':/g, "case '':");
  const n = [...src.matchAll(ACC)].length + [...src.matchAll(FR_UI)].length;
  if (n > 0) perFile[file.replace(`${ROOT}/`, '')] = n;
}
const total = Object.values(perFile).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ total, perFile }, null, 2)}\n`);
  console.log(`baseline mise à jour : ${total} caractères FR résiduels`);
  process.exit(0);
}

let baseline = { total: 0 };
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error('baseline absente — lance `npm -w @table-sync/web run i18n:ratchet -- --update`');
  process.exit(1);
}

console.log(`FR résiduel : ${total} (baseline ${baseline.total})`);
if (total > baseline.total) {
  console.error(
    '❌ régression : du français hors catalogue est réapparu — passe par t() ou abaisse la baseline en traduisant.',
  );
  process.exit(1);
}
if (total < baseline.total) {
  console.log(
    `✓ progrès : ${baseline.total - total} caractères traduits — mets à jour la baseline (--update) dans le même commit.`,
  );
}
