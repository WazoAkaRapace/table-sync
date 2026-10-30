#!/usr/bin/env tsx
/**
 * Release par tag : versionne TOUTES les entrées en attente (version:null)
 * de CHANGELOG.json avec le calver du tag, les stamp du sha, et génère les
 * notes de release (une section par entrée).
 *
 * Args : <version> <sha>
 * Sortie : /tmp/release-notes.md (corps de la release GitHub).
 * Le fichier est réécrit AU FORMAT OXFMT (repli JSON.stringify) — un stamp
 * naïf casse la gate lint de toutes les PR suivantes (leçon 2026-10-20).
 *
 * Règles :
 * - les N entrées null de tête forment le lot de la release ; s'il n'y a
 *   aucune entrée en attente → erreur (tag sans contenu).
 * - plusieurs entrées le même jour → suffixes -2, -3… automatiques,
 *   l'entrée la plus récente (index 0) portant le suffixe le plus haut.
 * - unicité sha : toutes les entrées du lot reçoivent le MÊME sha de tag ;
 *   la gate format est assouplie en conséquence (sha partagé par lot).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = resolve(ROOT, 'CHANGELOG.json');

type Entry = {
  version: string | null;
  sha: string | null;
  date: string;
  title: string;
  items: string[];
};

const version = process.argv[2];
if (!version || !process.argv[3]) {
  console.error('Usage : release-tag.ts <version> <sha>');
  process.exit(1);
}
const sha = process.argv[3].replace(/^sha-/, '').slice(0, 8);

const entries: Entry[] = JSON.parse(readFileSync(FILE, 'utf8'));

// Lot = bloc contigu d'entrées version:null en tête.
let lot = 0;
while (lot < entries.length && entries[lot].version === null) lot++;
if (lot === 0) {
  console.error('✗ Aucune entrée changelog en attente (version:null) — rien à versionner.');
  console.error(
    '  Chaque PR doit poser son entrée "version": null ; voir .github/skills/changelog/SKILL.md.',
  );
  process.exit(1);
}

// Suffixes : le lot occupe les premiers identifiants LIBRES du jour, en
// séquence. Convention : si AUCUNE version du jour n'existe encore, la plus
// ancienne entrée du lot prend le calver nu et les suivantes -2, -3… ; sinon
// tout le lot démarre au premier suffixe libre (jamais de « -1 », jamais de
// trou). L'entrée [0] (la plus récente) porte le suffixe le plus haut.
// Le TAG lui-même peut être nu (v2026.10.30) ou suffixé (v2026.10.30-2,
// deuxième release du même jour) : on en retire le préfixe du JOUR — la
// numérotation du lot reste continue avec ce qui est déjà sorti.
const dayPrefix = version.replace(/-\d+$/, '');
const tagSuffix = /-\d+$/.test(version);
const existing = new Set(entries.map((e) => e.version));
const dayHasAny = entries.some(
  (e) => e.version === dayPrefix || (e.version ?? '').startsWith(`${dayPrefix}-`),
);
let depth = dayHasAny || tagSuffix ? 1 : 0; // 0 = calver nu ; sinon on démarre à -2
while (existing.has(depth === 0 ? dayPrefix : `${dayPrefix}-${depth + 1}`)) depth++;
const suffixes: string[] = [];
for (let i = 0; i < lot; i++) {
  suffixes.unshift(depth === 0 ? dayPrefix : `${dayPrefix}-${depth + 1}`);
  depth++;
}

const sections: string[] = [];
for (let i = 0; i < lot; i++) {
  entries[i] = { ...entries[i], version: suffixes[i], sha };
  const e = entries[i];
  sections.push(
    [
      `## ${e.title}`,
      '',
      ...e.items.map((it) => `- ${it}`),
      '',
      `_Version ${e.version} · ${e.date} · commit ${sha}_`,
    ].join('\n'),
  );
  console.log(`✓ Entrée « ${e.title} » → ${e.version} (sha ${sha}).`);
}

writeFileSync('/tmp/release-notes.md', sections.join('\n\n---\n\n') + '\n');
console.log(`✓ Notes de release générées (${lot} section(s)) → /tmp/release-notes.md`);

// Écriture finale, formatée oxfmt — binaire stdin d'abord (le job CI
// n'installe pas les deps), API en secours. Un stamp naïf JSON.stringify
// casse la gate lint des PR suivantes (leçon 2026-10-20).
async function writeFormatted(): Promise<void> {
  const json = `${JSON.stringify(entries, null, 2)}\n`;
  let out = json;
  try {
    out = execSync('npx --yes oxfmt --stdin-filepath CHANGELOG.json', {
      input: json,
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch {
    try {
      const { format } = await import('oxfmt');
      const res = (await format('CHANGELOG.json', json)) as unknown as {
        code?: string;
        content?: string;
      };
      if (typeof res?.code === 'string') out = res.code;
      else if (typeof res?.content === 'string') out = res.content;
    } catch {
      console.warn('oxfmt indisponible — écriture JSON brute (la gate lint pourrait dériver).');
    }
  }
  writeFileSync(FILE, out);
  console.log('✓ CHANGELOG.json réécrit au format oxfmt.');
}
void writeFormatted().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
