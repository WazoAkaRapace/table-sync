/**
 * Character class lines (multiclassage SRD 5.1): batch load for the mappers,
 * payload validation, transactional replace with flat-column re-sync.
 */

import { type CharacterClassEntry, findClass } from '@table-sync/shared';
import { CLASS_SUBCLASSES } from '@table-sync/shared/classFeatures';
import { eq, inArray } from 'drizzle-orm';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { characterClasses, characters } from '../../db/schema.ts';

// ---------- Multiclassage (SRD 5.1) : lignes de classe ----------

/**
 * Load the character_classes rows for a batch of characters (position order).
 * Map key = character_id → raw rows; mapCharacterSummary reads `row._classes`.
 */
export function loadCharacterClasses(characterIds: number[]): Map<number, any[]> {
  const map = new Map<number, any[]>();
  if (characterIds.length === 0) return map;
  const rows = getDrizzle()
    .select(cols(characterClasses))
    .from(characterClasses)
    .where(inArray(characterClasses.characterId, characterIds))
    .orderBy(characterClasses.position, characterClasses.id)
    .all() as any[];
  for (const row of rows) {
    const list = map.get(row.character_id) ?? [];
    list.push(row);
    map.set(row.character_id, list);
  }
  return map;
}

/** Attach `row._classes` (raw character_classes rows) in place, for the mappers. */
export function attachCharacterClasses(rows: any[]): void {
  const map = loadCharacterClasses(rows.map((r) => r.id));
  for (const row of rows) row._classes = map.get(row.id) ?? [];
}

/**
 * Validate a `classes[]` payload (structural only — prereq violations are the
 * UI's job, per the app's helper-not-automation philosophy). Checks: known
 * class keys, unique keys, per-class level 1-20, total ≤ 20, subclass ∈
 * catalog and past its RAW acquisition level.
 */
export function validateClassEntries(
  raw: unknown,
): { ok: true; entries: CharacterClassEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'classes doit être un tableau non vide' };
  }
  const seen = new Set<string>();
  let total = 0;
  const entries: CharacterClassEntry[] = [];
  for (const item of raw) {
    const info = findClass(item?.classKey ?? '');
    if (!info) return { ok: false, error: `classe inconnue : ${item?.classKey}` };
    if (seen.has(info.name)) {
      return { ok: false, error: `classe en double : ${info.name}` };
    }
    seen.add(info.name);
    const level = item?.level;
    if (!Number.isInteger(level) || level < 1 || level > 20) {
      return { ok: false, error: `niveau invalide pour ${info.name} (1-20)` };
    }
    total += level;
    let subclassKey: string | null = item?.subclassKey ?? null;
    if (subclassKey !== null) {
      const defs = CLASS_SUBCLASSES[info.name] ?? [];
      const def = defs.find((s) => s.key === subclassKey);
      if (!def)
        return { ok: false, error: `sous-classe inconnue pour ${info.name} : ${subclassKey}` };
      if (def.level > level) {
        return {
          ok: false,
          error: `${def.label} nécessite ${info.name} niveau ${def.level} (actuel ${level})`,
        };
      }
      if (typeof subclassKey !== 'string') subclassKey = null;
    }
    entries.push({
      classKey: info.name,
      level,
      subclassKey,
      hitDiceUsed: Number.isInteger(item?.hitDiceUsed) ? Math.max(0, item.hitDiceUsed) : 0,
      fightingStyle: item?.fightingStyle ?? null,
    });
  }
  if (total > 20) return { ok: false, error: `niveau total > 20 (${total})` };
  return { ok: true, entries };
}

/**
 * Replace a character's class lines in one transaction and re-sync the
 * denormalized flat columns (character_class/level/subclass columns/
 * fighting_style/hit_dice_used = sum). Position 0 = starting class.
 */
export function replaceCharacterClasses(characterId: number, entries: CharacterClassEntry[]): void {
  const db = getDb();
  const drizzle = getDrizzle();
  db.transaction(() => {
    drizzle.delete(characterClasses).where(eq(characterClasses.characterId, characterId)).run();
    for (const [position, entry] of entries.entries()) {
      drizzle
        .insert(characterClasses)
        .values({
          characterId,
          classKey: entry.classKey,
          level: entry.level,
          subclassKey: entry.subclassKey ?? null,
          hitDiceUsed: entry.hitDiceUsed ?? 0,
          fightingStyle: entry.fightingStyle ?? null,
          position,
        })
        .run();
    }
    const first = entries[0];
    const hitDiceTotal = entries.reduce((sum, e) => sum + (e.hitDiceUsed ?? 0), 0);
    const style = entries.find((e) => e.fightingStyle)?.fightingStyle ?? null;
    // The starting class's subclass lands in its dedicated column (Clerc/
    // Druide/Paladin) or the generic one — property-keyed spread replaces
    // the old interpolated `${col}` column picker.
    const subclassSet =
      first.classKey === 'Clerc'
        ? { divineDomain: first.subclassKey ?? null }
        : first.classKey === 'Druide'
          ? { druidCircle: first.subclassKey ?? null }
          : first.classKey === 'Paladin'
            ? { sacredOath: first.subclassKey ?? null }
            : { subclass: first.subclassKey ?? null };
    drizzle
      .update(characters)
      .set({
        characterClass: first.classKey,
        level: entries.reduce((sum, e) => sum + e.level, 0),
        ...subclassSet,
        fightingStyle: style,
        hitDiceUsed: hitDiceTotal,
      })
      .where(eq(characters.id, characterId))
      .run();
  })();
}
