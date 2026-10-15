#!/usr/bin/env tsx
/**
 * Gate changelog — trois modes :
 *   --check-format  : schéma, phrases, unicité des SHA, ordre antichronologique
 *   --check-sha X   : le SHA X (préfixe/suffixe) doit avoir son entrée
 *   --selftest      : fixtures internes (tourne en CI)
 *
 * Le contrat complet vit dans .github/skills/changelog/SKILL.md.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = resolve(ROOT, 'CHANGELOG.json');

type Entry = { sha: string; date: string; title: string; items: string[] };

const SHA_RE = /^[0-9a-f]{7,8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtErrors(raw: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(raw)) return ['CHANGELOG.json doit être un tableau JSON.'];
  if (raw.length === 0) errs.push('CHANGELOG.json est vide — chaque version doit y figurer.');
  const seen = new Set<string>();
  let prevDate = '';
  raw.forEach((e, i) => {
    const where = `entrée ${i}`;
    if (typeof e !== 'object' || e === null) {
      errs.push(`${where} : doit être un objet.`);
      return;
    }
    const { sha, date, title, items } = e as Record<string, unknown>;
    if (typeof sha !== 'string' || !SHA_RE.test(sha))
      errs.push(`${where} : sha invalide (« ${String(sha)} », 7-8 hex attendus).`);
    else if (seen.has(sha)) errs.push(`${where} : sha ${sha} déjà présent.`);
    else seen.add(sha);
    if (typeof date !== 'string' || !DATE_RE.test(date))
      errs.push(`${where} : date invalide (YYYY-MM-DD attendu).`);
    else if (prevDate && date > prevDate)
      errs.push(`${where} : ordre non antichronologique (${date} après ${prevDate}).`);
    else prevDate = date;
    if (typeof title !== 'string' || title.trim().length < 3)
      errs.push(`${where} : title trop court (2-5 mots attendus).`);
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

function shaMatches(entry: string, want: string): boolean {
  const w = want.replace(/^sha-/, '').slice(0, 8);
  return entry === w || entry.startsWith(w) || w.startsWith(entry);
}

function selftest(): number {
  const cases: { name: string; raw: unknown; ok: boolean }[] = [
    {
      name: 'valide',
      raw: [
        { sha: 'a1b2c3d', date: '2026-10-15', title: 'ok titre', items: ['Une phrase simple.'] },
      ],
      ok: true,
    },
    {
      name: 'sha dupliqué',
      raw: [
        { sha: 'a1b2c3d', date: '2026-10-15', title: 'ok titre', items: ['Une phrase simple.'] },
        { sha: 'a1b2c3d', date: '2026-10-14', title: 'ok titre', items: ['Une autre phrase.'] },
      ],
      ok: false,
    },
    {
      name: 'ordre remontant',
      raw: [
        { sha: 'a1b2c3d', date: '2026-10-14', title: 'ok titre', items: ['Une phrase simple.'] },
        { sha: 'e4f5a6b', date: '2026-10-15', title: 'ok titre', items: ['Une autre phrase.'] },
      ],
      ok: false,
    },
    {
      name: 'puce sans point',
      raw: [{ sha: 'a1b2c3d', date: '2026-10-15', title: 'ok titre', items: ['Sans point final'] }],
      ok: false,
    },
    {
      name: 'items vide',
      raw: [{ sha: 'a1b2c3d', date: '2026-10-15', title: 'ok titre', items: [] }],
      ok: false,
    },
  ];
  let fail = 0;
  for (const c of cases) {
    const errs = fmtErrors(c.raw);
    const pass = c.ok ? errs.length === 0 : errs.length > 0;
    if (!pass) fail++;
    console.log(`${pass ? '✓' : '✗'} selftest ${c.name}${errs.length ? ` (${errs[0]})` : ''}`);
  }
  return fail;
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
  const shaIdx = args.indexOf('--check-sha');
  if (shaIdx !== -1) {
    let want = args[shaIdx + 1] ?? 'HEAD';
    if (want === 'HEAD')
      want = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    const entries = Array.isArray(raw) ? (raw as Entry[]) : [];
    // Exceptions : merge commits GitHub et stamp — pas d'entrée requise.
    const subjects = execSync('git log -1 --format=%s', { cwd: ROOT }).toString().trim();
    if (/^Merge (pull request|branch)|^\[?changelog-stamp\]?|^\[skip ci\]/i.test(subjects)) {
      console.log(`✓ Commit « ${subjects} » exempté (merge/stamp).`);
      return 0;
    }
    const hit = entries.find((e) => typeof e.sha === 'string' && shaMatches(e.sha, want));
    if (!hit) {
      console.error(
        `✗ Aucune entrée changelog pour ${want} — ajoute-la dans CHANGELOG.json (voir .github/skills/changelog/SKILL.md).`,
      );
      return 1;
    }
    console.log(`✓ Entrée changelog présente pour ${want} (« ${hit.title} »).`);
  }
  if (!args.includes('--check-format') && shaIdx === -1) {
    console.error('Usage : check-changelog.ts --check-format | --check-sha <sha> | --selftest');
    return 1;
  }
  return 0;
}

process.exit(main());
