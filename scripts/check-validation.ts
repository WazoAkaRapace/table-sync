/**
 * Validation ratchet — routes en écriture sans schéma (phase 3 qualité
 * backend, T3.3).
 *
 * Compte les enregistrements de routes en écriture
 * (`app.post|patch|put|delete`) de apps/api/src/routes/** qui ne déclarent
 * pas d'option `schema:` (validation TypeBox du corps — voir
 * apps/api/src/validation.ts). Même philosophie shrink-only que
 * check-modularity / check-duplication : l'état actuel est la baseline,
 * elle ne peut que BAISSER — chaque PR convertit des routes, le compteur
 * descend, aucune route en écriture nouvelle ne peut naître sans schéma.
 *
 * Heuristique de détection (documentée, volontairement simple) : pour
 * chaque occurrence `app.<méthode>(`, le segment jusqu'à l'enregistrement
 * suivant (`app.<méthode>(` quelconque) est le périmètre de la route —
 * l'objet d'options Fastify `{ schema: … }` y précède toujours le handler.
 * Les seuls registrars de routes/** utilisent le récepteur `app.` (convention
 * R3 de check-modularity).
 *
 * Usage :
 *   tsx scripts/check-validation.ts                   # gate (exit 1 si hausse)
 *   tsx scripts/check-validation.ts --update-baseline # refuse toute hausse
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './api-tests/harness.ts';

const ROUTES_DIR = join(REPO_ROOT, 'apps', 'api', 'src', 'routes');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'validation-baseline.json');
const WRITE_METHODS = new Set(['post', 'patch', 'put', 'delete']);
const REGISTRATION_RE = /\bapp\.(\w+)\s*\(/g;

interface RouteSite {
  file: string;
  method: string;
  line: number;
}

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Tous les enregistrements de routes en ÉCRITURE, dans l'ordre du fichier. */
function writeRoutesIn(source: string, relFile: string, totals: { total: number }): RouteSite[] {
  const sites: RouteSite[] = [];
  const matches = [...source.matchAll(REGISTRATION_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const method = m[1];
    if (!WRITE_METHODS.has(method)) continue;
    totals.total++;
    const line = source.slice(0, m.index).split('\n').length;
    // Périmètre de la route : jusqu'au prochain enregistrement (le handler
    // d'une route ne peut pas contenir `app.xxx(` — R3 : un registrar par
    // fichier, pas de routes imbriquées).
    const end = matches[i + 1]?.index ?? source.length;
    const segment = source.slice(m.index, end);
    if (!/\bschema\s*:/.test(segment)) {
      sites.push({ file: relFile, method, line });
    }
  }
  return sites;
}

function computeWithoutSchema(): { sites: RouteSite[]; total: number } {
  const sites: RouteSite[] = [];
  const totals = { total: 0 };
  for (const abs of listRouteFiles(ROUTES_DIR)) {
    const rel = abs.slice(REPO_ROOT.length + 1);
    sites.push(...writeRoutesIn(readFileSync(abs, 'utf8'), rel, totals));
  }
  return {
    sites: sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    total: totals.total,
  };
}

interface ValBaseline {
  withoutSchema: number;
}

function loadBaseline(): ValBaseline | null {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ValBaseline;
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const { sites, total } = computeWithoutSchema();

if (args.includes('--update-baseline')) {
  const prev = loadBaseline();
  if (prev && sites.length > prev.withoutSchema) {
    console.error(
      `✗ baseline : refuse la hausse (${prev.withoutSchema} → ${sites.length}). ` +
        'Une route en écriture nouvelle ou modifiée DOIT fournir son schéma TypeBox ' +
        '(apps/api/src/validation.ts ; NoBody pour les routes sans corps).',
    );
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({ withoutSchema: sites.length }, null, 2) + '\n');
  console.log(`✓ baseline validation : ${sites.length} routes en écriture sans schéma.`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(
    "✗ scripts/validation-baseline.json absent — lancez d'abord --update-baseline (init).",
  );
  process.exit(1);
}

if (sites.length > baseline.withoutSchema) {
  console.error(
    `✗ routes en écriture sans schéma : ${baseline.withoutSchema} → ${sites.length} (HAUSSE). ` +
      'Chaque route en écriture nouvelle ou modifiée fournit son schéma TypeBox — convertissez-la ' +
      '(apps/api/src/validation.ts, mapping validationMessage dans server.ts) puis --update-baseline.',
  );
  for (const s of sites) console.error(`    - ${s.file}:${s.line} app.${s}`);
  process.exit(1);
}
console.log(
  `✓ validation ratchet : ${sites.length} routes en écriture sans schéma ` +
    `(baseline ${baseline.withoutSchema}, shrink-only) — ${total - sites.length}/${total} couvertes.`,
);
