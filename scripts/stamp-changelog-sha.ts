#!/usr/bin/env tsx
/**
 * Post-merge : réécrit l'entrée changelog portant le SHA de la branche PR
 * vers le SHA squash réel du commit main. Lancé par le job changelog-stamp
 * (ci.yml) — args : <nouveau sha court> <ancien sha (head de PR)>.
 * Le commit résultant porte [skip ci].
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = resolve(ROOT, 'CHANGELOG.json');

const [newSha, oldSha] = process.argv.slice(2);
if (!newSha || !oldSha) {
  console.error('Usage : stamp-changelog-sha.ts <nouveau-sha-court> <ancien-sha>');
  process.exit(1);
}

type Entry = { sha: string; date: string; title: string; items: string[] };
const entries: Entry[] = JSON.parse(readFileSync(FILE, 'utf8'));
const norm = (s: string) => s.replace(/^sha-/, '').slice(0, 8);
const idx = entries.findIndex((e) => {
  const n = norm(e.sha);
  return n === norm(oldSha) || n.startsWith(norm(oldSha)) || norm(oldSha).startsWith(n);
});
if (idx === -1) {
  console.error(`Aucune entrée à tamponner pour ${oldSha} — rien à faire.`);
  process.exit(0);
}
entries[idx] = { ...entries[idx], sha: norm(newSha) };
writeFileSync(FILE, `${JSON.stringify(entries, null, 2)}\n`);

// Recale la date sur le jour du commit main (le squash peut glisser au lendemain).
try {
  const d = execSync(`git log -1 --format=%ad --date=short ${newSha}`, { cwd: ROOT })
    .toString()
    .trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) entries[idx].date = d;
  writeFileSync(FILE, `${JSON.stringify(entries, null, 2)}\n`);
} catch {
  /* garde la date d'origine */
}
console.log(
  `✓ Entrée « ${entries[idx].title} » tamponnée : ${oldSha} → ${norm(newSha)} (${entries[idx].date})`,
);
