#!/usr/bin/env tsx
/**
 * Post-merge (job changelog-release) :
 * 1. pose le SHA squash réel dans l'entrée de la version,
 * 2. crée (ou met à jour) la release GitHub <version> avec les notes
 *    générées depuis l'entrée changelog — le déclencheur du déploiement.
 * Args : <version> [sha]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = resolve(ROOT, 'CHANGELOG.json');

type Entry = { version: string; sha: string | null; date: string; title: string; items: string[] };

const version = process.argv[2];
if (!version) {
  console.error('Usage : release-changelog.ts <version> [sha]');
  process.exit(1);
}
const sha = process.argv[3]
  ? process.argv[3].replace(/^sha-/, '').slice(0, 8)
  : execSync('git rev-parse --short=7 HEAD', { cwd: ROOT }).toString().trim();

const entries: Entry[] = JSON.parse(readFileSync(FILE, 'utf8'));
const idx = entries.findIndex((e) => e.version === version);
if (idx === -1) {
  console.error(`Version ${version} introuvable dans CHANGELOG.json.`);
  process.exit(1);
}
entries[idx] = { ...entries[idx], sha };
writeFileSync(FILE, `${JSON.stringify(entries, null, 2)}\n`);

const e = entries[idx];
const notes = [
  `## ${e.title}`,
  '',
  ...e.items.map((i) => `- ${i}`),
  '',
  `_Version ${e.version} · ${e.date} · commit ${sha}_`,
].join('\n');

// Notes pour le job CI (fichier — corps multiline pour gh release create).
writeFileSync('/tmp/release-notes.md', notes);
console.log(`✓ Entrée « ${e.title} » : sha ${sha}, notes générées (${e.items.length} puces).`);
