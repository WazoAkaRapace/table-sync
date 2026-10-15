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

/** Stable word choice per monster + tier — no flicker between polls. */
export function feelingPhraseKey(c: Combatant): string | null {
  if (c.feeling == null) return null;
  const tier = Math.max(0, Math.min(3, Math.round(c.feeling)));
  const variants = FEELING_PHRASES[tier];
  return variants[(c.id * 7 + tier * 3) % variants.length];
}

export function feelingDot(c: Combatant): string | null {
  if (c.feeling == null) return null;
  return FEELING_DOTS[Math.max(0, Math.min(3, Math.round(c.feeling)))];
}

// ---------- Color marks ----------

/* Les pastilles de couleur portent un IDENTIFIANT stocké (cardColor en
   base) : les valeurs hex du sélecteur sont l'identité lumineuse. En mode
   bougie on éclaircit la même teinte (le cuir sombre mangerait les
   pastilles pastel — la couleur doit rester un repère lisible). */
const CARD_COLORS_DARK: Record<string, string> = {
  '#fef3c7': '#8a6d1d',
  '#dcfce7': '#2e6b3f',
  '#dbeafe': '#2f5a94',
  '#fce7f3': '#99436f',
  '#f3e8ff': '#6f4e99',
  '#fed7aa': '#9c5d22',
  '#fee2e2': '#9c3030',
  '#e0e7ff': '#4a51a3',
};

export function cardColorDisplay(hex: string): string {
  return (
    (typeof document !== 'undefined' &&
      document.documentElement.classList.contains('ts-dark') &&
      CARD_COLORS_DARK[hex]) ||
    hex
  );
}
