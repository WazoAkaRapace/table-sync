/**
 * Modularity gate — miroir du gate raw-SQL (scripts/api-tests/coverage.ts).
 *
 * Règles appliquées à apps/api/src/** et apps/web/src/** :
 *  R1 — taille : fichier > MAX_LINES (700) ⇒ doit figurer dans la baseline
 *       (ratchet shrink-only : la baseline ne peut que baisser, un fichier
 *       repassé sous le seuil en est retiré, AUCUN nouveau fichier géant ne
 *       peut y entrer).
 *  R2 — fourre-tout : fichiers listés SHRINK_ONLY (routes/helpers.ts) — leur
 *       nombre d'exports ne peut que baisser, tout nouvel export est refusé.
 *  R3 — un registrar par fichier routes : routes/*.ts n'exporte qu'UNE
 *       fonction *Routes (+ types/const privés autorisés).
 *  R4 — pas d'import d'un autre fichier routes/* TOP-LEVEL (hors lib
 *       autorisée : helpers, lang, messages, httpCache). Raffiné 2026-11-09
 *       (phase 4) : les imports ENTRE FICHIERS DU MÊME dossier
 *       routes/<resource>/ sont autorisés (le registrar index.ts agrège ses
 *       sous-modules), ainsi que vers la future lib routes/lib/* ; un import
 *       vers un AUTRE dossier routes/<autre>/ est un couplage cross-resource
 *       refusé. Les sites hérités sont listés dans R4_LEGACY (shrink-only :
 *       retirez une entrée quand l'import disparaît).
 *
 * Usage :
 *   tsx scripts/check-modularity.ts                   # gate (exit 1 si violation)
 *   tsx scripts/check-modularity.ts --update-baseline # enregistre l'état
 *       courant — REFUSE toute hausse (lignes) et tout nouveau fichier
 *       au-dessus du seuil ; retire les fichiers repassés sous le seuil.
 *       Le TOUT PREMIER lancement (baseline inexistante sur disque) est une
 *       INITIALISATION : les géants actuels y entrent une seule fois.
 *   tsx scripts/check-modularity.ts --selftest        # auto-test (comme
 *       check-changelog) : fichier 701 l. hors baseline, hausse vs ratchet,
 *       baisse acceptée, exempté déclaratif, nouvel export helpers.ts, double
 *       registrar, import croisé, import cross-dossier (R4 raffiné).
 *
 * Exemptions déclaratives (fichiers de définition de données, jamais de logique) :
 *   - apps/api/src/db/schema.ts (jamais dans la baseline : pas de ratchet)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './api-tests/harness.ts';

const MAX_LINES = 700;

/** Fichiers dont la taille est tolérée uniquement par héritage (ratchet). */
interface BaselineEntry {
  lines: number;
}

interface Baseline {
  /** "apps/api/src/routes/gma.ts" → { lines: 2181 } */
  files: Record<string, BaselineEntry>;
}

const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'modularity-baseline.json');

/** Exemptions de raison (jamais dans la baseline : elles ne sont pas ratchetées). */
const DECLARATIVE_EXEMPT: Record<string, string> = {
  'apps/api/src/db/schema.ts': 'déclaratif Drizzle (tables, index) — pas de logique',
};

/** R2 : fourre-tout historiques — exports en ratchet shrink-only (mesuré 2026-11-09). */
const SHRINK_ONLY: Record<string, number> = {
  'apps/api/src/routes/helpers.ts': 22,
};

/** R4 : bibliothèque partagée autorisée pour les imports entre fichiers routes. */
const ROUTE_LIB_ALLOWLIST = new Set(['helpers', 'lang', 'messages', 'httpCache']);

/**
 * R4 : imports croisés hérités (pré-découpage), shrink-only — retirez une
 * entrée quand l'import disparaît (le découpage phase 4 les élimine au fil
 * des PR). Toute NOUVELLE cible top-level routes/* hors allowlist échoue.
 *
 * Phase 4c (2026-11-09, split inventory) : l'entrée routes/inventory.ts a
 * disparu avec le fichier ; le couplage mirrorAcToCombatants (character-
 * spell-effects) est UN SITE PHYSIQUE inchangé par le split, désormais
 * importé depuis les 4 sous-modules qui l'utilisent (entries, flows,
 * transfers, containers) ; les specs '../inventory.ts'/'./inventory.ts' deviennent
 * '../inventory/index.ts'/'./inventory/index.ts' (même import, nouveau
 * chemin du registrar). Pas de nouveau couplage : extraction routes/lib en
 * phase 4b retirera ces entrées.
 */
const R4_LEGACY: Record<string, string[]> = {
  'apps/api/src/routes/character-spells.ts': ['./spells.ts'],
  'apps/api/src/routes/characters/sheet.ts': [
    '../inventory/index.ts',
    '../character-spell-effects.ts',
  ],
  'apps/api/src/routes/characters/update.ts': ['../character-spell-effects.ts'],
  'apps/api/src/routes/combat.ts': ['./character-spell-effects.ts'],
  'apps/api/src/routes/domain-spells.ts': ['./spells.ts'],
  'apps/api/src/routes/gma.ts': ['./npcs.ts'],
  'apps/api/src/routes/inventory/containers.ts': ['../character-spell-effects.ts'],
  'apps/api/src/routes/inventory/entries.ts': ['../character-spell-effects.ts'],
  'apps/api/src/routes/inventory/flows.ts': ['../character-spell-effects.ts'],
  'apps/api/src/routes/inventory/transfers.ts': ['../character-spell-effects.ts'],
  'apps/api/src/routes/item-images.ts': ['./inventory/index.ts'],
  'apps/api/src/routes/rest.ts': ['./character-spell-effects.ts'],
  'apps/api/src/routes/wildshape.ts': ['./character-spell-effects.ts'],
};

const ROUTES_DIR = 'apps/api/src/routes/';

const SCOPES = ['apps/api/src', 'apps/web/src'];

// ---------------------------------------------------------------------------
// outillage
// ---------------------------------------------------------------------------

interface FileInfo {
  repoPath: string; // toujours avec des '/', ex. apps/api/src/routes/gma.ts
  lines: number;
  exports: number;
  routeRegistrars: string[];
  routeImportsFromRoutes: string[];
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name.startsWith('.')) continue;
      listFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name.name) && !name.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

function countLines(text: string): number {
  return text.split('\n').length;
}

function countExports(text: string): number {
  const re = /^export\s+(?:async\s+)?(?:function|const|class|let|var|type|interface|enum)\b/gm;
  return (text.match(re) ?? []).length;
}

/** R3 : fonctions exportées qui ressemblent à un registrar Fastify. */
function findRouteRegistrars(text: string): string[] {
  const re = /^export\s+(?:async\s+)?function\s+(\w*Routes)\b/gm;
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** Résout un spec relatif contre un fichier du repo → chemin sans extension. */
function resolveRelative(fromFile: string, spec: string): string {
  const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const out: string[] = [];
  for (const seg of `${dir}/${spec}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/').replace(/\.(ts|tsx)$/, '');
}

/**
 * R4 : imports d'un fichier routes/** vers un AUTRE fichier routes :
 *  - top-level routes/*.ts : uniquement la lib partagée (allowlist) ;
 *  - sous-dossier : uniquement le MÊME dossier routes/<resource>/ (les
 *    sous-modules d'un découpage s'importent entre eux — index.ts agrège)
 *    ou la future lib routes/lib/* ;
 *  - tout autre dossier routes/<autre>/ = couplage cross-resource refusé.
 */
function findRouteCrossImports(text: string, repoPath: string): string[] {
  if (!repoPath.startsWith(ROUTES_DIR)) return [];
  const offenders: string[] = [];
  const srcDir = repoPath.slice(0, repoPath.lastIndexOf('/'));
  for (const m of text.matchAll(/from\s+'(\.[^']*)'/g)) {
    const spec = m[1];
    const resolved = resolveRelative(repoPath, spec);
    if (!resolved.startsWith(ROUTES_DIR)) continue; // db/, sync/, shared… : OK
    const rel = resolved.slice(ROUTES_DIR.length);
    if (!rel.includes('/')) {
      // Fichier top-level routes/*.ts : bibliothèque partagée uniquement.
      if (!ROUTE_LIB_ALLOWLIST.has(rel)) offenders.push(spec);
      continue;
    }
    // Sous-dossier : même dossier routes/<resource>/ ou routes/lib/*.
    const tgtDir = resolved.slice(0, resolved.lastIndexOf('/'));
    if (tgtDir !== srcDir && tgtDir !== `${ROUTES_DIR}lib`) offenders.push(spec);
  }
  return offenders;
}

function scan(): FileInfo[] {
  const files: FileInfo[] = [];
  for (const scope of SCOPES) {
    const absScope = join(REPO_ROOT, scope);
    if (!existsSync(absScope)) continue;
    for (const abs of listFiles(absScope)) {
      const text = readFileSync(abs, 'utf8');
      const repoPath = abs.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
      files.push({
        repoPath,
        lines: countLines(text),
        exports: countExports(text),
        routeRegistrars: findRouteRegistrars(text),
        routeImportsFromRoutes: findRouteCrossImports(text, repoPath),
      });
    }
  }
  return files;
}

function loadBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  } catch {
    return { files: {} };
  }
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

interface Violation {
  rule: 'R1' | 'R2' | 'R3' | 'R4';
  file: string;
  message: string;
}

function check(files: FileInfo[], baseline: Baseline): Violation[] {
  const violations: Violation[] = [];
  const byPath = new Map(files.map((f) => [f.repoPath, f]));

  // R1 — taille + ratchet
  for (const f of files) {
    if (
      f.lines > MAX_LINES &&
      !(f.repoPath in baseline.files) &&
      !(f.repoPath in DECLARATIVE_EXEMPT)
    ) {
      violations.push({
        rule: 'R1',
        file: f.repoPath,
        message: `${f.lines} lignes > ${MAX_LINES} et absent de la baseline — découpez-le (la baseline n'accepte aucun nouveau fichier).`,
      });
    }
  }
  for (const [path, entry] of Object.entries(baseline.files)) {
    const f = byPath.get(path);
    if (!f) continue; // fichier disparu : géré par checkBaselineIntegrity
    if (f.lines > entry.lines) {
      violations.push({
        rule: 'R1',
        file: path,
        message: `ratchet : ${f.lines} lignes > entrée baseline ${entry.lines} — un monolithe ne regrandit jamais.`,
      });
    }
  }

  // R2 — fourre-tout shrink-only
  for (const [path, maxExports] of Object.entries(SHRINK_ONLY)) {
    const f = byPath.get(path);
    if (!f) continue;
    if (f.exports > maxExports) {
      violations.push({
        rule: 'R2',
        file: path,
        message: `fourre-tout : ${f.exports} exports > ${maxExports} (ratchet shrink-only) — nouvel export interdit ici, créez un module ciblé.`,
      });
    }
  }

  // R3 — un registrar par fichier routes (fichiers top-level routes/*.ts)
  for (const f of files) {
    if (!/\/routes\/[^/]+\.ts$/.test(f.repoPath)) continue;
    if (f.routeRegistrars.length > 1) {
      violations.push({
        rule: 'R3',
        file: f.repoPath,
        message: `${f.routeRegistrars.length} registrars exportés (${f.routeRegistrars.join(', ')}) — un seul par fichier.`,
      });
    }
  }

  // R4 — imports croisés routes → routes top-level (hors allowlist + héritage)
  for (const f of files) {
    const legacy = R4_LEGACY[f.repoPath] ?? [];
    const offenders = f.routeImportsFromRoutes.filter((spec) => !legacy.includes(spec));
    if (offenders.length === 0) continue;
    violations.push({
      rule: 'R4',
      file: f.repoPath,
      message: `import(s) croisé(s) vers un autre fichier routes top-level : ${offenders.join(', ')} — factorisez dans routes/helpers.ts (shrink-only : préférez routes/lib/*).`,
    });
  }
  return violations;
}

function checkBaselineIntegrity(files: FileInfo[], baseline: Baseline): Violation[] {
  const violations: Violation[] = [];
  const byPath = new Map(files.map((f) => [f.repoPath, f]));
  for (const path of Object.keys(baseline.files)) {
    if (!byPath.has(path)) {
      violations.push({
        rule: 'R1',
        file: path,
        message: 'présent dans la baseline mais le fichier n’existe plus — retirez l’entrée.',
      });
    }
  }
  for (const path of Object.keys(DECLARATIVE_EXEMPT)) {
    if (!byPath.has(path)) {
      violations.push({
        rule: 'R1',
        file: path,
        message: 'exempté déclaratif listé mais introuvable.',
      });
    }
  }
  for (const path of [...Object.keys(SHRINK_ONLY), ...Object.keys(R4_LEGACY)]) {
    if (!byPath.has(path)) {
      violations.push({
        rule: 'R2',
        file: path,
        message: 'listé SHRINK_ONLY/R4_LEGACY mais introuvable — retirez l’entrée du script.',
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// update-baseline (shrink-only, refuse toute hausse)
// ---------------------------------------------------------------------------

function updateBaseline(files: FileInfo[], baseline: Baseline, initializing: boolean): number {
  const next: Record<string, BaselineEntry> = {};
  let lowered = 0;
  for (const f of files) {
    if (f.repoPath in DECLARATIVE_EXEMPT) continue;
    if (f.lines > MAX_LINES) {
      const prev = baseline.files[f.repoPath];
      if (prev && f.lines > prev.lines) {
        console.error(
          `✗ ${f.repoPath} : ${f.lines} lignes > baseline ${prev.lines} — la baseline refuse toute hausse.`,
        );
        return 1;
      }
      if (!prev && !initializing) {
        console.error(
          `✗ ${f.repoPath} : ${f.lines} lignes > ${MAX_LINES} et hors baseline — un NOUVEAU fichier géant ne peut pas entrer en baseline : découpez-le.`,
        );
        return 1;
      }
      if (prev && f.lines < prev.lines) lowered++;
      next[f.repoPath] = { lines: f.lines };
    } else if (baseline.files[f.repoPath]) {
      console.log(`  ↘ ${f.repoPath} repassé sous ${MAX_LINES} l. — retiré de la baseline.`);
      lowered++;
    }
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({ files: next }, null, 2) + '\n');
  const tag = initializing ? 'INITIALISÉE' : 'mise à jour';
  console.log(
    `✓ baseline ${tag} (${Object.keys(next).length} fichiers géants, ${lowered} baisse(s)).`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// selftest (scénarios synthétiques en mémoire — jamais dans le repo)
// ---------------------------------------------------------------------------

function selftest(): number {
  const baseline: Baseline = {
    files: { 'apps/api/src/routes/fat.ts': { lines: 720 } },
  };
  const mk = (path: string, lines: number, extra: Partial<FileInfo> = {}): FileInfo => ({
    repoPath: path,
    lines,
    exports: 0,
    routeRegistrars: [],
    routeImportsFromRoutes: [],
    ...extra,
  });

  try {
    // 1. fichier 701 l. hors baseline → violation R1
    let v = check([mk('apps/api/src/routes/newfat.ts', 701)], { files: {} });
    if (!v.some((x) => x.rule === 'R1' && x.file.endsWith('newfat.ts'))) {
      throw new Error('701 lignes non détecté');
    }

    // 2. ratchet : 721 > baseline 720 → violation
    v = check([mk('apps/api/src/routes/fat.ts', 721)], baseline);
    if (!v.some((x) => x.rule === 'R1' && x.file.endsWith('fat.ts'))) {
      throw new Error('hausse non détectée');
    }

    // 3. baisse : 700 ≤ baseline → pas de violation R1
    v = check([mk('apps/api/src/routes/fat.ts', 700)], baseline);
    if (v.some((x) => x.rule === 'R1' && x.file.endsWith('fat.ts'))) {
      throw new Error('baisse refusée à tort');
    }

    // 4. exempté déclaratif 1300 l. → rien
    v = check([mk('apps/api/src/db/schema.ts', 1300)], { files: {} });
    if (v.length !== 0) throw new Error('exempté déclaratif flaggé');

    // 5. R2 : helpers.ts avec un export de plus que SHRINK_ONLY
    const helpers = Object.keys(SHRINK_ONLY)[0];
    v = check([mk(helpers, 100, { exports: SHRINK_ONLY[helpers] + 1 })], { files: {} });
    if (!v.some((x) => x.rule === 'R2' && x.file === helpers)) {
      throw new Error('nouvel export helpers.ts non détecté');
    }

    // 6. R3 : deux registrars
    const two = mk('apps/api/src/routes/dual.ts', 100, { routeRegistrars: ['aRoutes', 'bRoutes'] });
    v = check([two], { files: {} });
    if (!v.some((x) => x.rule === 'R3')) throw new Error('double registrar non détecté');

    // 7. R4 parsing : './combat.ts' flaggé ; allowlist/sous-dossier/hors routes non
    const src = [
      "import { x } from './combat.ts';",
      "import { y } from './helpers.ts';",
      "import { z } from '../db/schema.ts';",
      "import { w } from './lib/membership.ts';",
    ].join('\n');
    const found = findRouteCrossImports(src, 'apps/api/src/routes/characters.ts');
    if (found.length !== 1 || found[0] !== './combat.ts') {
      throw new Error(`parse R4 inattendu : ${found.join(', ')}`);
    }

    // 8. R4 héritage : l'import legacy connu ne viole pas, un nouveau si
    const legacyFile = Object.keys(R4_LEGACY)[0];
    const legacySpec = R4_LEGACY[legacyFile][0];
    v = check([mk(legacyFile, 100, { routeImportsFromRoutes: [legacySpec, './monsters.ts'] })], {
      files: {},
    });
    if (!v.some((x) => x.rule === 'R4' && x.message.includes('./monsters.ts'))) {
      throw new Error('nouvel import croisé non détecté');
    }
    if (v.some((x) => x.rule === 'R4' && x.message.includes(legacySpec))) {
      throw new Error('héritage R4 flaggé à tort');
    }

    // 9. R4 raffiné : intra-dossier routes/<resource>/ autorisé (index.ts qui
    // agrège ses sous-modules), vers un AUTRE dossier routes/<autre>/ refusé.
    const subSrc = [
      "import { x } from './sheet.ts';",
      "import { y } from '../helpers.ts';",
      "import { z } from '../inventory/sheet.ts';",
    ].join('\n');
    const foundSub = findRouteCrossImports(subSrc, 'apps/api/src/routes/characters/index.ts');
    if (foundSub.length !== 1 || foundSub[0] !== '../inventory/sheet.ts') {
      throw new Error(`parse R4 raffiné inattendu : ${foundSub.join(', ')}`);
    }
    v = check(
      [
        mk('apps/api/src/routes/characters/index.ts', 100, {
          routeImportsFromRoutes: foundSub,
        }),
      ],
      { files: {} },
    );
    if (!v.some((x) => x.rule === 'R4' && x.message.includes('../inventory/sheet.ts'))) {
      throw new Error('import cross-dossier non détecté');
    }

    console.log('✓ selftest check-modularity : 9/9 scénarios.');
    return 0;
  } catch (err) {
    console.error(`✗ selftest échoué : ${(err as Error).message}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--selftest')) process.exit(selftest());

const files = scan();
const baseline = loadBaseline();

if (args.includes('--update-baseline')) {
  process.exit(updateBaseline(files, baseline, !existsSync(BASELINE_PATH)));
}

const violations = [...checkBaselineIntegrity(files, baseline), ...check(files, baseline)];
if (violations.length > 0) {
  console.error(
    `✗ modularité : ${violations.length} violation(s) — une nouvelle violation est une régression, comme le gate raw-SQL.`,
  );
  for (const v of violations) console.error(`  ${v.rule} ${v.file} : ${v.message}`);
  process.exit(1);
}
const giants = files.filter((f) => f.lines > MAX_LINES).length;
const legacyLeft = files.reduce(
  (n, f) =>
    n +
    (f.routeImportsFromRoutes ?? []).filter((s) => (R4_LEGACY[f.repoPath] ?? []).includes(s))
      .length,
  0,
);
console.log(
  `✓ modularité OK : ${files.length} fichiers scannés (${SCOPES.join(', ')}), ${giants} fichier(s) géant(s) tous sous ratchet, ${legacyLeft} import(s) croisé(s) routes hérité(s).`,
);
