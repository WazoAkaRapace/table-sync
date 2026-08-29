// Backfill boot : clés de base des objets créés avant le découplage moteur
// (docs/i18n-engine-refactor-plan.md § 2). Idempotent — ne touche que les
// lignes arme/armure encore sans clés ; devient un no-op dès que tout est résolu.

import { resolveItemBases } from '@table-sync/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDrizzle } from './drizzle.ts';
import { items } from './schema.ts';

export function backfillItemBases(): void {
  const db = getDrizzle();
  const pending = db
    .select({
      id: items.id,
      category: items.category,
      name: items.name,
      nameFr: items.nameFr,
      description: items.description,
      propertiesJson: items.propertiesJson,
      damageDice: items.damageDice,
    })
    .from(items)
    .where(
      and(
        inArray(items.category, ['weapon', 'armor']),
        isNull(items.baseWeapon),
        isNull(items.baseArmor),
        isNull(items.armorFamily),
      ),
    )
    .all() as Array<{
    id: number;
    category: string;
    name: string | null;
    nameFr: string | null;
    description: string | null;
    propertiesJson: string | null;
    damageDice: string | null;
  }>;

  let resolved = 0;
  for (const row of pending) {
    const bases = resolveItemBases({
      category: row.category,
      name: row.name,
      nameFr: row.nameFr,
      description: row.description,
      properties: row.propertiesJson ? JSON.parse(row.propertiesJson) : [],
      damageDice: row.damageDice,
    });
    if (!bases.baseWeapon && !bases.baseArmor && !bases.armorFamily) continue;
    db.update(items)
      .set({
        baseWeapon: bases.baseWeapon,
        baseArmor: bases.baseArmor,
        armorFamily: bases.armorFamily,
        magicBonus: bases.magicBonus,
      })
      .where(eq(items.id, row.id))
      .run();
    resolved += 1;
  }
  if (pending.length > 0) {
    console.log(`[backfill] item bases: ${resolved}/${pending.length} unresolved rows keyed`);
  }
}
