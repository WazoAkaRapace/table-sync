// déplacement pur depuis CombatPage.tsx (ratchet R1)
import type { Combatant, EncounterRosterEntry } from '@table-sync/shared';

// ---------- Small combat helpers ----------

export function rollD20(bonus: number): number {
  return Math.floor(Math.random() * 20) + 1 + bonus;
}

/** Signed initiative bonus, e.g. "+3" / "-1". */
export function signedBonus(bonus: number): string {
  return `${bonus >= 0 ? '+' : ''}${bonus}`;
}

/**
 * Next combatant to act after the current one (mirrors the server's
 * next-turn skips: whole groups act together, defeated combatants are
 * skipped with their group). Null when nobody else can act.
 */
export function findNext(combatants: Combatant[], turnIndex: number): Combatant | null {
  const cur = combatants[turnIndex];
  if (!cur) return null;
  const inCurrentTurn = (c: Combatant) =>
    cur.groupId !== null ? c.groupId === cur.groupId : c.id === cur.id;

  let i = turnIndex + 1;
  if (cur.groupId !== null) {
    while (i < combatants.length && combatants[i]?.groupId === cur.groupId) i++;
  }
  let guard = 0;
  const maxGuard = combatants.length * 2 + 2;
  while (guard++ < maxGuard) {
    if (i >= combatants.length) i = 0;
    const c = combatants[i];
    if (c && !c.defeated && !inCurrentTurn(c)) return c;
    const g = c?.groupId ?? null;
    i++;
    if (g !== null) {
      while (i < combatants.length && combatants[i]?.groupId === g) i++;
    }
  }
  return null;
}

/** Roster preview label: characters plain, monster groups as "Nom ×N". */
export function rosterLine(roster: EncounterRosterEntry[]): string {
  return roster
    .map((r) => (r.player || r.count <= 1 ? r.name : `${r.name} ×${r.count}`))
    .join(' · ');
}

export const CARD_COLORS = [
  null, // default
  '#fef3c7', // amber
  '#dcfce7', // green
  '#dbeafe', // blue
  '#fce7f3', // pink
  '#f3e8ff', // purple
  '#fed7aa', // orange
  '#fee2e2', // red
  '#e0e7ff', // indigo
];

/* Les pastilles de couleur portent un IDENTIFIANT stocké (cardColor en
   base) : les valeurs hex ci-dessus sont l'identité lumineuse (le
   rendu bougie vit dans combatDisplay.ts). */

/** Color marks — i18n keys announced when picking a swatch. */
export const CARD_COLOR_NAMES: Record<string, string> = {
  '#fef3c7': 'combat.couleur.ambre',
  '#dcfce7': 'combat.couleur.vert',
  '#dbeafe': 'combat.couleur.bleu',
  '#fce7f3': 'combat.couleur.rose',
  '#f3e8ff': 'combat.couleur.violet',
  '#fed7aa': 'combat.couleur.orange',
  '#fee2e2': 'combat.couleur.rouge',
  '#e0e7ff': 'combat.couleur.indigo',
};
