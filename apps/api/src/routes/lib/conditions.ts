/**
 * Condition sync between the character sheet and the combat tracker.
 */

import { and, eq, ne } from 'drizzle-orm';
import { getDrizzle } from '../../db/drizzle.ts';
import { characters, combatants, encounters, inventory, items } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';

/** Parse a characters.conditions column (string[] of French names). */
function parseCharConditions(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parse a combatants.conditions column ({name, duration}[]). */
function parseCombatantConditions(raw: any): Array<{ name: string; duration: number | null }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as any;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Rows of equipped items feeding computeAC (armour/shield base, STR min). */
export function equippedAcRows(characterId: number): any[] {
  return getDrizzle()
    .select({
      category: items.category,
      ac_base: items.acBase,
      str_min: items.strMin,
      name_fr: items.nameFr,
      name: items.name,
      equipped: inventory.equipped,
    })
    .from(inventory)
    .innerJoin(items, eq(items.id, inventory.itemId))
    .where(and(eq(inventory.characterId, characterId), eq(inventory.equipped, 1)))
    .all() as any[];
}

/**
 * Sheet → tracker: apply condition name changes (added/removed) to a
 * character's combatants in non-ended encounters. Sheet-added conditions
 * carry no duration (until removed); tracker-only conditions with durations
 * are preserved. Emits combat:change.
 */
export function mirrorConditionsToCombatants(
  partyId: number,
  charId: number,
  added: string[],
  removed: string[],
  actorUserId: number,
): void {
  if (added.length === 0 && removed.length === 0) return;
  const drizzle = getDrizzle();
  const rows = drizzle
    .select({ id: combatants.id, conditions: combatants.conditions })
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(
      and(
        eq(combatants.characterId, charId),
        eq(combatants.type, 'player'),
        ne(encounters.status, 'ended'),
      ),
    )
    .all() as any[];
  let changed = false;
  for (const row of rows) {
    let conds = parseCombatantConditions(row.conditions);
    conds = conds.filter((c) => !removed.includes(c.name));
    for (const name of added) {
      if (!conds.some((c) => c.name === name)) conds.push({ name, duration: null });
    }
    const next = JSON.stringify(conds);
    if (next !== row.conditions) {
      drizzle.update(combatants).set({ conditions: next }).where(eq(combatants.id, row.id)).run();
      changed = true;
    }
  }
  if (changed) {
    bus.emitChange({ type: 'combat:change', partyId, action: 'condition', actorUserId });
  }
}

/**
 * Tracker → sheet: apply condition name changes to the character sheet
 * (plain name list, no durations). Emits character:change.
 */
export function mirrorConditionsToCharacter(
  partyId: number,
  characterId: number,
  added: string[],
  removed: string[],
  actorUserId: number,
): void {
  if (added.length === 0 && removed.length === 0) return;
  const drizzle = getDrizzle();
  const ch = drizzle
    .select({ conditions: characters.conditions })
    .from(characters)
    .where(eq(characters.id, characterId))
    .get() as any;
  if (!ch) return;
  let list = parseCharConditions(ch.conditions);
  list = list.filter((n) => !removed.includes(n));
  for (const name of added) {
    if (!list.includes(name)) list.push(name);
  }
  const next = JSON.stringify(list);
  if (next !== ch.conditions) {
    drizzle
      .update(characters)
      .set({ conditions: next })
      .where(eq(characters.id, characterId))
      .run();
    bus.emitChange({
      type: 'character:change',
      partyId,
      characterId,
      action: 'condition',
      actorUserId,
    });
  }
}
