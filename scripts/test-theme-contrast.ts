// Garde-fou contraste — le mode bougie ne peut plus dériver silencieusement.
//
// Le RGAA 4.1 d'avant (commentaire d'index.css) décrivait une rampe qui
// n'était plus celle du code (DESIGN.md revendiquait #a76b6b, le code
// livrait #96403c) : un audit écrit à la main n'est pas un audit. Ici on
// lit les VALEURS RÉELLES d'index.css (@theme = clair, html.ts-dark =
// bougie) et on asserte les paires effectivement rendues.
//
// Barèmes WCAG : texte 4.5:1 · texte large & composants (bordures de
// champ, focus, pastilles) 3:1 · présence de forme des jauges : parité
// avec le mode clair (~1.7:1 fill/track — choix du design d'origine,
// les jauges vivent de leur teinte).
//
// Dettes ASSUMÉES du mode clair, volontairement non assertées ici :
// pills or 2.6:1, dés de mort armés blanc/vert-500 ~1.9:1 (le monde
// clair est l'incumbent inchangé — voir la critique 2026-09-30).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'web',
  'src',
  'index.css',
);
const css = readFileSync(cssPath, 'utf8');

function extractBlock(opener: string): Map<string, string> {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`bloc introuvable : ${opener}`);
  const end = css.indexOf('\n}', start);
  const body = css.slice(start, end);
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--color-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    vars.set(m[1], m[2].toLowerCase());
  }
  return vars;
}

const light = extractBlock('@theme {');
const dark = extractBlock('html.ts-dark {');

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const WHITE = '#ffffff';

type Pair = { name: string; mode: 'clair' | 'bougie'; fg: string; bg: string; min: number };

const resolve = (mode: 'clair' | 'bougie', token: string) => {
  const scope = mode === 'bougie' ? dark : light;
  const v = scope.get(token) ?? light.get(token);
  if (!v) throw new Error(`token inconnu : ${token} (${mode})`);
  return v;
};

const pairs: Pair[] = [
  // ---- BOUGIE : le contrat complet ----
  {
    name: 'corps — ink-900 sur cuir',
    mode: 'bougie',
    fg: '--color-ink-900',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'méta — ink-400 sur cuir',
    mode: 'bougie',
    fg: '--color-ink-400',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'imprimé discret — ink-300 sur cuir',
    mode: 'bougie',
    fg: '--color-ink-300',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'texte sang — blood-500 sur cuir',
    mode: 'bougie',
    fg: '--color-blood-500',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'texte or — gold-700 sur cuir',
    mode: 'bougie',
    fg: '--color-gold-700',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'surfaces levées — ink-900 sur raised',
    mode: 'bougie',
    fg: '--color-ink-900',
    bg: '--color-raised',
    min: 4.5,
  },
  {
    name: 'nappes — ink-900 sur parchment-100',
    mode: 'bougie',
    fg: '--color-ink-900',
    bg: '--color-parchment-100',
    min: 4.5,
  },
  {
    name: 'bandeau nuit — night-100 sur night-800',
    mode: 'bougie',
    fg: '--color-night-100',
    bg: '--color-night-800',
    min: 4.5,
  },
  {
    name: 'pilules sang (Tour N, détent) — blanc sur blood-600',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-blood-600',
    min: 4.5,
  },
  {
    name: 'texte règle — red-700 sur cuir',
    mode: 'bougie',
    fg: '--color-red-700',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'texte règle — green-700 sur cuir',
    mode: 'bougie',
    fg: '--color-green-700',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'texte règle — orange-700 sur cuir',
    mode: 'bougie',
    fg: '--color-orange-700',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'texte règle — blue-700 sur cuir',
    mode: 'bougie',
    fg: '--color-blue-700',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'cartouche initiative — ink-900 sur yellow-400',
    mode: 'bougie',
    fg: '--color-ink-900',
    bg: '--color-yellow-400',
    min: 4.5,
  },
  {
    name: 'chiffres HpBar — blanc sur track',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-parchment-200',
    min: 4.5,
  },
  {
    name: 'jauge PV haute — blanc sur green-500',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-green-500',
    min: 4.5,
  },
  {
    name: 'jauge PV critique — blanc sur red-500',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-red-500',
    min: 4.5,
  },
  {
    name: 'jauge PV blessé — blanc sur yellow-500',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-yellow-500',
    min: 4.5,
  },
  {
    name: 'jauge épuisement — blanc sur orange-500',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-orange-500',
    min: 4.5,
  },
  {
    name: 'PV temporaires — blanc sur blue-500',
    mode: 'bougie',
    fg: WHITE,
    bg: '--color-blue-500',
    min: 4.5,
  },
  {
    name: 'présence de jauge — green-500 vs track',
    mode: 'bougie',
    fg: '--color-green-500',
    bg: '--color-parchment-200',
    min: 1.6,
  },
  {
    name: 'présence de jauge — red-500 vs track',
    mode: 'bougie',
    fg: '--color-red-500',
    bg: '--color-parchment-200',
    min: 1.6,
  },
  {
    name: 'présence de jauge — yellow-500 vs track',
    mode: 'bougie',
    fg: '--color-yellow-500',
    bg: '--color-parchment-200',
    min: 1.6,
  },
  {
    name: 'focus champ — blood-500 vs raised',
    mode: 'bougie',
    fg: '--color-blood-500',
    bg: '--color-raised',
    min: 3,
  },
  {
    name: 'focus dés de vie — green-600 vs raised',
    mode: 'bougie',
    fg: '--color-green-600',
    bg: '--color-raised',
    min: 3,
  },
  {
    name: 'bordure champ repos — #8a744b vs raised',
    mode: 'bougie',
    fg: '#8a744b',
    bg: '--color-raised',
    min: 3,
  },
  {
    name: 'chip initiative dûe (bordure or) — gold-400 vs night-800',
    mode: 'bougie',
    fg: '--color-gold-400',
    bg: '--color-night-800',
    min: 3,
  },
  {
    name: 'point sync connecté — green-400 vs night-900',
    mode: 'bougie',
    fg: '--color-green-400',
    bg: '--color-night-900',
    min: 3,
  },
  {
    name: 'point sync connecté — gold-400 vs night-900',
    mode: 'bougie',
    fg: '--color-gold-400',
    bg: '--color-night-900',
    min: 3,
  },
  // ---- CLAIR : l'incumbent, garde de non-régression ----
  {
    name: 'corps — ink-900 sur parchemin',
    mode: 'clair',
    fg: '--color-ink-900',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'méta — ink-400 sur parchemin',
    mode: 'clair',
    fg: '--color-ink-400',
    bg: '--color-parchment-50',
    min: 4.5,
  },
  {
    name: 'boutons primaires — blanc sur blood-600',
    mode: 'clair',
    fg: WHITE,
    bg: '--color-blood-600',
    min: 4.5,
  },
  {
    name: 'bandeau nuit — night-100 sur night-800',
    mode: 'clair',
    fg: '--color-night-100',
    bg: '--color-night-800',
    min: 4.5,
  },
];

// ---- Pastilles de couleur des monstres (cardColorDisplay) ----
// Les hex RENDUS vivent dans apps/web/src/combatDisplay.ts (l'identité
// stockée en base est un hex pastel, le rendu le sature par mode). On
// énumère ici le contrat : chaque rendu ≥ 3:1 contre page (parch-50),
// dent focus (parch-100) et sélecteur (raised), dans les DEUX modes ;
// + l'anneau blanc/85 qui sépare la pastille de la carte « tour
// courant » blood-600 (un fill ne peut jamais tenir 3:1 contre une
// nappe de sang ET contre le parchemin à la fois — d'où l'anneau).
const PILL_LIGHT: Record<string, string> = {
  ambre: '#92610a',
  vert: '#15803d',
  bleu: '#2563eb',
  rose: '#db2777',
  violet: '#9333ea',
  orange: '#ea580c',
  rouge: '#b91c1c',
  indigo: '#312e81',
};
const PILL_DARK: Record<string, string> = {
  ambre: '#fbbf24',
  vert: '#4ade80',
  bleu: '#bfdbfe',
  rose: '#fbcfe8',
  violet: '#c084fc',
  orange: '#fdba74',
  rouge: '#ef4444',
  indigo: '#818cf8',
};
const ringOnWhite85 = (bg: string) => blendHex('#ffffff', bg, 0.85);
function blendHex(fg: string, bg: string, alpha: number): string {
  const f = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const ch = (i: number) => Math.round(((f >> i) & 255) * alpha + ((b >> i) & 255) * (1 - alpha));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
for (const [modeName, pills] of [
  ['clair', PILL_LIGHT],
  ['bougie', PILL_DARK],
] as const) {
  const surfaces: [string, string][] = [
    ['page', resolve(modeName, '--color-parchment-50')],
    ['dent focus', resolve(modeName, '--color-parchment-100')],
    ['sélecteur (raised)', resolve(modeName, '--color-raised')],
  ];
  for (const [name, hex] of Object.entries(pills)) {
    for (const [surface, surfaceHex] of surfaces) {
      pairs.push({
        name: `pastille monstre ${name} — ${surface}`,
        mode: modeName,
        fg: hex,
        bg: surfaceHex,
        min: 3,
      });
    }
  }
  // Anneau de la carte « tour courant » : blanc/85 sur blood-600
  pairs.push({
    name: 'anneau pastille — tour courant (blood-600)',
    mode: modeName,
    fg: ringOnWhite85(resolve(modeName, '--color-blood-600')),
    bg: resolve(modeName, '--color-blood-600'),
    min: 3,
  });
}

let failures = 0;
console.log(`Garde contraste — ${pairs.length} paires réelles (index.css)\n`);
for (const p of pairs) {
  const fg = p.fg.startsWith('--') ? resolve(p.mode, p.fg) : p.fg;
  const bg = p.bg.startsWith('--') ? resolve(p.mode, p.bg) : p.bg;
  const r = ratio(fg, bg);
  const ok = r >= p.min;
  if (!ok) failures++;
  console.log(
    `${ok ? '✓' : '✗ ÉCHEC'}  [${p.mode}] ${p.name.padEnd(46)} ${fg} / ${bg}  ${r.toFixed(2)}:1 (min ${p.min})`,
  );
}
console.log(
  `\n${failures === 0 ? `${pairs.length} paires conformes — le contrat tient.` : `${failures} paire(s) en échec — le contrat a dérivé, corrige index.css ou la table.`}`,
);
process.exit(failures === 0 ? 0 : 1);
