#!/usr/bin/env tsx
/**
 * Gate changelog — modes :
 *   --check-format    : schéma, phrases, unicité versions/sha, ordre antichronologique
 *   --check-version V : une entrée porte la version V (mode PR obligatoire)
 *   --selftest        : fixtures internes (tourne en CI)
 *
 * Le contrat complet vit dans .github/skills/changelog/SKILL.md.
 * Versionnement calver YYYY.MM.DD (suffixe -2, -3… si plusieurs versions le
 * même jour) : la version est déclarée PAR L'AUTEUR dans son entrée — pas de
 * course au SHA. La CI crée la release <version> au merge, le build déploie
 * sur release: published.
 */
import { readFileSync } from 'node:fs';
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

const SHA_RE = /^[0-9a-f]{7,8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VER_RE = /^\d{4}\.\d{2}\.\d{2}(-\d+)?$/;

function fmtErrors(raw: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(raw)) return ['CHANGELOG.json doit être un tableau JSON.'];
  if (raw.length === 0) errs.push('CHANGELOG.json est vide — chaque version doit y figurer.');
  const versions = new Set<string>();
  const shas = new Set<string>();
  let prevDate = '';
  raw.forEach((e, i) => {
    const where = `entrée ${i}`;
    if (typeof e !== 'object' || e === null) {
      errs.push(`${where} : doit être un objet.`);
      return;
    }
    const { version, sha, date, title, items } = e as Record<string, unknown>;
    // version: calver OU null (entrée en attente du versionnement par tag)
    if (version === null) {
      if (sha !== null) errs.push(`${where} : une entrée version:null doit avoir sha:null.`);
    } else if (typeof version !== 'string' || !VER_RE.test(version)) {
      errs.push(
        `${where} : version invalide (« ${String(version)} », calver YYYY.MM.DD ou null attendu).`,
      );
    } else if (versions.has(version)) {
      errs.push(`${where} : version ${version} déjà présente.`);
    } else versions.add(version);
    if (sha !== null && (typeof sha !== 'string' || !SHA_RE.test(sha))) {
      errs.push(`${where} : sha invalide (« ${String(sha)} », 7-8 hex ou null avant merge).`);
    } else if (typeof sha === 'string') {
      if (shas.has(sha)) errs.push(`${where} : sha ${sha} déjà présent.`);
      else shas.add(sha);
    }
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      errs.push(`${where} : date invalide (YYYY-MM-DD attendu).`);
    } else if (prevDate && date > prevDate) {
      errs.push(`${where} : ordre non antichronologique (${date} après ${prevDate}).`);
    } else prevDate = date;
    if (typeof title !== 'string' || title.trim().length < 3) {
      errs.push(`${where} : title trop court (2-5 mots attendus).`);
    }
    if (!Array.isArray(items) || items.length === 0) {
      errs.push(`${where} : items doit contenir au moins une puce.`);
    } else {
      items.forEach((it, j) => {
        if (typeof it !== 'string') errs.push(`${where} puce ${j} : doit être une chaîne.`);
        else if (!/^[A-ZÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/.test(it))
          errs.push(`${where} puce ${j} : commence par une majuscule.`);
        else if (!/[.!?]$/.test(it)) errs.push(`${where} puce ${j} : doit finir par un point.`);
        else if (it.length > 140)
          errs.push(`${where} puce ${j} : trop longue (${it.length} car., 140 max).`);
      });
    }
  });
  return errs;
}

function selftest(): number {
  const mk = (version: string | null, sha: string | null = 'a1b2c3d', date = '2026-10-15') => ({
    version,
    sha,
    date,
    title: 'ok titre',
    items: ['Une phrase simple.'],
  });
  const cases: { name: string; raw: unknown; expectErrors: boolean }[] = [
    { name: 'valide', raw: [mk('2026.10.15')], expectErrors: false },
    { name: 'sha null avant merge', raw: [mk('2026.10.15', null)], expectErrors: false },
    {
      name: 'entrée en attente (version null)',
      raw: [mk(null, null), mk('2026.10.15')],
      expectErrors: false,
    },
    { name: 'en attente avec sha (interdit)', raw: [mk(null, 'a1b2c3d')], expectErrors: true },
    {
      name: 'version dupliquée',
      raw: [mk('2026.10.15'), mk('2026.10.15', 'e4f5a6b')],
      expectErrors: true,
    },
    { name: 'calver invalide', raw: [mk('v1.2.3')], expectErrors: true },
    {
      name: 'ordre remontant',
      raw: [mk('2026.10.14', 'a1b2c3d', '2026-10-14'), mk('2026.10.15', 'e4f5a6b')],
      expectErrors: true,
    },
    {
      name: 'suffixe même jour',
      raw: [mk('2026.10.15'), mk('2026.10.15-2', 'e4f5a6b')],
      expectErrors: false,
    },
    {
      name: 'puce sans point',
      raw: [{ ...mk('2026.10.15'), items: ['Sans point'] }],
      expectErrors: true,
    },
    { name: 'items vide', raw: [{ ...mk('2026.10.15'), items: [] }], expectErrors: true },
  ];
  let fail = 0;
  for (const c of cases) {
    const errs = fmtErrors(c.raw);
    const pass = c.expectErrors ? errs.length > 0 : errs.length === 0;
    if (!pass) fail++;
    console.log(`${pass ? '✓' : '✗'} selftest ${c.name}${errs.length ? ` (${errs[0]})` : ''}`);
  }
  return fail;
}

/** Commits du bot exemptés des gates PR (stamp, release). */
function botCommitted(): boolean {
  const subjects = execSync('git log -1 --format=%s', { cwd: ROOT }).toString().trim();
  if (/^\[?changelog-(stamp|release)\]?|^changelog:|^\[skip ci\]/i.test(subjects)) {
    console.log(`✓ Commit « ${subjects} » exempté.`);
    return true;
  }
  return false;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    const f = selftest();
    console.log(f === 0 ? 'selftest OK' : `${f} échec(s) selftest`);
    return f === 0 ? 0 : 1;
  }
  const raw: unknown = JSON.parse(readFileSync(FILE, 'utf8'));
  if (args.includes('--check-format')) {
    const errs = fmtErrors(raw);
    if (errs.length) {
      console.error(
        `✗ Format changelog — ${errs.length} problème(s) :\n${errs.map((e) => `  - ${e}`).join('\n')}`,
      );
      return 1;
    }
    console.log(`✓ Format changelog (${(raw as Entry[]).length} entrée(s)).`);
  }
  const pIdx = args.indexOf('--check-pending');
  if (pIdx !== -1) {
    // Mode PR (flow par tag) : le tip de la PR doit ajouter AU MOINS une
    // entrée en attente (version:null). Exempté : les commits du bot.
    if (botCommitted()) return 0;
    const pending = (Array.isArray(raw) ? (raw as Entry[]) : []).filter((e) => e.version === null);
    if (pending.length === 0) {
      console.error(
        '✗ Aucune entrée changelog en attente — ajoute une entrée "version": null en tête de CHANGELOG.json (voir .github/skills/changelog/SKILL.md).',
      );
      return 1;
    }
    console.log(`✓ ${pending.length} entrée(s) changelog en attente (« ${pending[0].title} »…).`);
  }
  const vIdx = args.indexOf('--check-version');
  if (vIdx !== -1) {
    const want = args[vIdx + 1];
    if (!want) {
      console.error('Usage : --check-version <version>');
      return 1;
    }
    const entries = Array.isArray(raw) ? (raw as Entry[]) : [];
    if (botCommitted()) return 0;
    const hit = entries.find((e) => e.version === want);
    if (!hit) {
      console.error(
        `✗ Aucune entrée changelog pour la version ${want} — ajoute-la dans CHANGELOG.json (voir .github/skills/changelog/SKILL.md).`,
      );
      return 1;
    }
    console.log(`✓ Entrée changelog présente pour ${want} (« ${hit.title} »).`);
  }
  if (!args.includes('--check-format') && pIdx === -1 && vIdx === -1) {
    console.error(
      'Usage : check-changelog.ts --check-format | --check-pending | --check-version <v> | --selftest',
    );
    return 1;
  }
  return 0;
}

process.exit(main());
