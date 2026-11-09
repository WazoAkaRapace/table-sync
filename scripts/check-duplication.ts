/**
 * Duplication gate — R5 (anti-duplication).
 *
 * Détecteur : jscpd (devDependency, moteur token-based — insensible au
 * reformatage). CE script n'est qu'un wrapper ratchet : il fait tourner jscpd
 * sur apps/api/src + apps/web/src + packages/shared/src, lit le rapport JSON
 * et impose la même philosophie shrink-only que check-modularity :
 * l'état actuel est la baseline, elle ne peut que BAISSER.
 *
 * Métriques ratchetées (agrégats — robustes à l'édition du contenu d'un
 * clone existant) :
 *   - dupLines : lignes dupliquées totales (jscpd)
 *   - clones   : nombre de clones exacts >= MIN_TOKENS
 *
 * Usage :
 *   tsx scripts/check-duplication.ts                   # gate (exit 1 si hausse)
 *   tsx scripts/check-duplication.ts --update-baseline # refuse toute hausse
 *   tsx scripts/check-duplication.ts --report          # top clones + localisations
 *
 * jscpd est invoqué via son binaire local (node_modules/.bin/jscpd) ; le
 * rapport est écrit dans un tempdir, jamais dans le repo.
 * Seuil : --min-tokens 70 (≈ 10-12 lignes significatives ; calibré 2026-11-09 :
 * 131 clones / 1735 lignes — les vraies zones chaudes passent, le bruit de
 * préambule Fastify reste sous le seuil).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './api-tests/harness.ts';

const MIN_TOKENS = 70;
const SCOPES = ['apps/api/src', 'apps/web/src', 'packages/shared/src'];
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'duplication-baseline.json');
const JSCPD_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'jscpd');

interface DupBaseline {
  dupLines: number;
  clones: number;
}

interface JscpdClone {
  lines: number;
  tokens: number;
  firstFile: { name: string; start: number; end: number };
  secondFile: { name: string; start: number; end: number };
}

function runJscpd(): { dupLines: number; clones: JscpdClone[] } {
  const outDir = mkdtempSync(join(tmpdir(), 'ts-jscpd-'));
  try {
    execFileSync(
      JSCPD_BIN,
      [
        ...SCOPES,
        '--min-tokens',
        String(MIN_TOKENS),
        '--reporters',
        'json',
        '--output',
        outDir,
        '--ignore',
        '**/*.d.ts,**/node_modules/**',
        '--silent',
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const report = JSON.parse(readFileSync(join(outDir, 'jscpd-report.json'), 'utf8'));
    const clones: JscpdClone[] = report.duplicates ?? [];
    const dupLines = clones.reduce((sum: number, c: JscpdClone) => sum + c.lines, 0);
    return { dupLines, clones };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function loadBaseline(): DupBaseline | null {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as DupBaseline;
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const { dupLines, clones } = runJscpd();

if (args.includes('--report')) {
  console.log(`== ${clones.length} clones >= ${MIN_TOKENS} tokens (${dupLines} lignes) ==`);
  for (const c of [...clones].sort((a, b) => b.lines - a.lines).slice(0, 20)) {
    console.log(
      `  ${String(c.lines).padStart(4)} l.  ${c.firstFile.name}:${c.firstFile.start}-${c.firstFile.end}  <->  ${c.secondFile.name}:${c.secondFile.start}-${c.secondFile.end}`,
    );
  }
  process.exit(0);
}

if (args.includes('--update-baseline')) {
  const prev = loadBaseline();
  if (prev && (dupLines > prev.dupLines || clones.length > prev.clones)) {
    console.error(
      `✗ baseline : refuse la hausse (dupLines ${prev.dupLines} → ${dupLines}, clones ${prev.clones} → ${clones.length}). La duplication ne peut que baisser — dédupliquez d'abord (--report).`,
    );
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({ dupLines, clones: clones.length }, null, 2) + '\n');
  console.log(`✓ baseline duplication : ${dupLines} lignes / ${clones.length} clones.`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(
    "✗ scripts/duplication-baseline.json absent — lancez d'abord --update-baseline (init).",
  );
  process.exit(1);
}

if (dupLines > baseline.dupLines || clones.length > baseline.clones) {
  console.error(
    `✗ duplication en HAUSSE : dupLines ${baseline.dupLines} → ${dupLines}, clones ${baseline.clones} → ${clones.length}. Extrayez le code commun au lieu de copier (--report pour les localisations).`,
  );
  process.exit(1);
}
console.log(
  `✓ duplication sous ratchet : ${dupLines} lignes / ${clones.length} clones (baseline ${baseline.dupLines}/${baseline.clones}).`,
);
