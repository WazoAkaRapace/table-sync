import type { Combatant } from '@table-sync/shared';

/**
 * Helpers d'affichage du combat, partagés entre l'échelle d'initiative de la
 * page Combat (outil du MD) et le rail d'initiative de la fiche joueur
 * (InitiativeStrip) : un seul dialecte pour les dents — visibilité des PV,
 * état apparent des monstres masqués, pastilles de couleur, compte de
 * conditions, numérotation des groupes.
 */

/** SQLite HP visibility: non-GM viewers get null HP/AC for combatants they don't own. */
export function hpVisible(c: Combatant): boolean {
  return c.hitPoints !== null && c.maxHitPoints !== null;
}

export function conditionsTitle(
  conditions: Combatant['conditions'],
  t: (key: string) => string,
): string {
  return conditions
    .map((c) => (c.duration == null ? c.name : `${c.name} (${c.duration} ${t('combat.tour.s')})`))
    .join(', ');
}

/** Number group members ("Gobelin 1", "Gobelin 2"…) in list order. */
export function numberedCombatantLabels(combatants: Combatant[]): string[] {
  const counters = new Map<number, number>();
  return combatants.map((c) => {
    if (c.groupId === null) return c.name;
    const n = (counters.get(c.groupId) ?? 0) + 1;
    counters.set(c.groupId, n);
    return `${c.name} ${n}`;
  });
}

// ---------- Apparent health (monsters, redacted views) ----------
// The tier comes from the server (stable jitter on its boundaries); the wording
// varies per monster so the field reads like a table call, not a gauge.

// Phrases indexées par palier d'état apparent — clés i18n, traduites au rendu.
const FEELING_PHRASES: string[][] = [
  [
    'combat.etat.a.l.agonie',
    'combat.etat.au.bord.de.l.effondrement',
    'combat.etat.il.tient.a.peine.debout',
  ],
  ['combat.etat.gravement.blesse', 'combat.etat.il.chancelle', 'combat.etat.couvert.de.sang'],
  ['combat.etat.blesse', 'combat.etat.touche', 'combat.etat.en.difficulte'],
  ['combat.etat.en.pleine.forme', 'combat.etat.frais.et.dispos', 'combat.etat.a.peine.egratigne'],
];
const FEELING_DOTS = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];

const FEELING_DOTS_LIGHT = ['bg-red-600', 'bg-orange-600', 'bg-yellow-600', 'bg-green-600'];
const FEELING_DOTS_DARK = FEELING_DOTS;

/** Stable word choice per monster + tier — no flicker between polls. */
export function feelingPhraseKey(c: Combatant): string | null {
  if (c.feeling == null) return null;
  const tier = Math.max(0, Math.min(3, Math.round(c.feeling)));
  const variants = FEELING_PHRASES[tier];
  return variants[(c.id * 7 + tier * 3) % variants.length];
}

export function feelingDot(c: Combatant): string | null {
  if (c.feeling == null) return null;
  const tier = Math.max(0, Math.min(3, Math.round(c.feeling)));
  /* Clair : les -500 Tailwind bruts tombaient à 1.8–2.7:1 sur le
     parchemin — les -600 tiennent ≥ 3.1:1. Bougie : les tokens -500 du
     thème (≥ 3.2:1 sur le cuir). */
  const ramp =
    typeof document !== 'undefined' && document.documentElement.classList.contains('ts-dark')
      ? FEELING_DOTS_DARK
      : FEELING_DOTS_LIGHT;
  return ramp[tier];
}

// ---------- Color marks ----------

/* Les pastilles de couleur portent un IDENTIFIANT stocké (cardColor en
   base) : les valeurs hex du sélecteur sont l'identité lumineuse, mais le
   RENDU vit ici — les pastels d'origine (L* 88–96) tombaient à 1.0–1.3:1
   sur le parchemin et se confondaient entre eux (audit 2026-10, ΔE00
   < 10 pour la plupart des paires). Chaque mode rend donc une version
   SATURÉE de la même teinte, ≥ 3:1 contre les surfaces réelles (page
   parch-50, dent focus parch-100, sélecteur sur raised) et séparée de
   ses voisines (ΔE00 ≥ 13 ou écart de teinte franc) :
   — clair : nuances profondes (L* 35–55), le parchemin les porte ;
   — bougie : nuances claires (L* 70–82), le cuir les porte.
   Le sélecteur rend les MÊMES valeurs (cardColorDisplay) : ce que le MD
   choisit est exactement ce que la table voit. Contrat gardé par
   scripts/test-theme-contrast.ts (paires « pastille monstre »). */
const CARD_COLORS_DARK: Record<string, string> = {
  '#fef3c7': '#fbbf24',
  '#dcfce7': '#4ade80',
  '#dbeafe': '#bfdbfe',
  '#fce7f3': '#fbcfe8',
  '#f3e8ff': '#c084fc',
  '#fed7aa': '#fdba74',
  '#fee2e2': '#ef4444',
  '#e0e7ff': '#818cf8',
};

/* Clair : version saturée profonde de la même teinte (le pastel d'origine
   ne se détache pas du parchemin). */
const CARD_COLORS_LIGHT: Record<string, string> = {
  '#fef3c7': '#92610a',
  '#dcfce7': '#15803d',
  '#dbeafe': '#2563eb',
  '#fce7f3': '#db2777',
  '#f3e8ff': '#9333ea',
  '#fed7aa': '#ea580c',
  '#fee2e2': '#b91c1c',
  '#e0e7ff': '#312e81',
};

export function cardColorDisplay(hex: string): string {
  const dark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('ts-dark');
  return (dark ? CARD_COLORS_DARK[hex] : CARD_COLORS_LIGHT[hex]) ?? hex;
}
