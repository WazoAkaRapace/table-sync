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
  path: string;
}

/** Identité stable d'une route (indépendante des numéros de ligne). */
function routeIdentity(s: RouteSite): string {
  return `${s.file.split('\\').join('/')} ${s.method.toUpperCase()} ${s.path}`;
}

/** Chemin déclaré de la route : 1re chaîne entre quotes après `app.méthode(`. */
function routePathOf(segment: string): string {
  const m = segment.match(/\(\s*['"`]([^'"`]+)['"`]/);
  return m ? m[1] : '?';
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
    // Couvert = l'option `schema` de la ROUTE déclare un `body:` (validation
    // du corps). Un `schema:` seul (ex. schema.response) ne compte PAS, et un
    // `body:` hors options non plus — d'où la double condition.
    const hasSchemaOption = /\bschema\s*:\s*\{/.test(segment);
    const hasBody = /\bbody\s*:/.test(segment);
    if (!(hasSchemaOption && hasBody)) {
      sites.push({ file: relFile, method, line, path: routePathOf(segment) });
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
  /** Identités des routes en écriture sans schéma (ratchet par identité :
   *  une NOUVELLE route sans schéma échoue même à total constant). */
  routes: string[];
}

function loadBaseline(): { baseline: ValBaseline | null; invalid: boolean } {
  let text: string;
  try {
    text = readFileSync(BASELINE_PATH, 'utf8');
  } catch {
    return { baseline: null, invalid: false }; // fichier absent = init possible
  }
  try {
    const raw = JSON.parse(text) as Partial<ValBaseline> & { withoutSchema?: number };
    if (Array.isArray(raw.routes)) return { baseline: { routes: raw.routes }, invalid: false };
    // Ancien format compteur (sansSchema numérique, pas de routes) : considéré
    // ABSENT mais valide — ré-initialisable via --update-baseline (migration).
    if (typeof raw.withoutSchema === 'number') return { baseline: null, invalid: false };
    return { baseline: null, invalid: true }; // format inconnu
  } catch {
    return { baseline: null, invalid: true }; // JSON invalide = ne jamais réécrire
  }
}

const args = process.argv.slice(2);
const { sites, total } = computeWithoutSchema();
const identities = sites.map(routeIdentity);

if (args.includes('--update-baseline')) {
  const { baseline: prev, invalid } = loadBaseline();
  if (invalid) {
    console.error(
      '✗ scripts/validation-baseline.json existe mais est illisible/invalide — corrigez-le à la main avant tout --update-baseline (jamais de réécriture par-dessus une baseline corrompue).',
    );
    process.exit(1);
  }
  const additions = prev ? identities.filter((id) => !prev.routes.includes(id)) : [];
  if (prev && additions.length > 0) {
    console.error(
      `✗ baseline : ${additions.length} nouvelle(s) route(s) en écriture sans schéma — ` +
        'refusé. Une route en écriture nouvelle ou modifiée DOIT fournir son schéma TypeBox ' +
        '(apps/api/src/validation.ts ; NoBody pour les routes sans corps) :',
    );
    for (const id of additions) console.error(`    - ${id}`);
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({ routes: identities }, null, 2) + '\n');
  console.log(`✓ baseline validation : ${identities.length} routes en écriture sans schéma.`);
  process.exit(0);
}

const { baseline, invalid } = loadBaseline();
if (!baseline) {
  console.error(
    invalid
      ? '✗ scripts/validation-baseline.json illisible/invalide — corrigez-le à la main.'
      : "✗ scripts/validation-baseline.json absent (ou ancien format compteur) — lancez d'abord --update-baseline (init).",
  );
  process.exit(1);
}

const additions = identities.filter((id) => !baseline.routes.includes(id));
if (additions.length > 0) {
  console.error(
    `✗ ${additions.length} route(s) en écriture SANS schéma et absentes de la baseline (ratchet par identité). ` +
      'Chaque route en écriture nouvelle ou modifiée fournit son schéma TypeBox — convertissez-la ' +
      '(apps/api/src/validation.ts, mapping validationMessage dans server.ts) puis --update-baseline :',
  );
  for (const id of additions) console.error(`    - ${id}`);
  process.exit(1);
}
console.log(
  `✓ validation ratchet : ${identities.length} routes en écriture sans schéma ` +
    `(baseline ${baseline.routes.length}, shrink-only par identité) — ${total - sites.length}/${total} couvertes.`,
);
