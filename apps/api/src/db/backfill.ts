// Backfill boot : clés de base des objets créés avant le découplage moteur
// (docs/i18n-engine-refactor-plan.md § 2). Idempotent — ne touche que les
// lignes arme/armure encore sans clés ; devient un no-op dès que tout est résolu.

import { AMMO_PACKS, resolveItemBases } from '@table-sync/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDrizzle } from './drizzle.ts';
import { getDb, normalizeText } from './index.ts';
import { inventory, items, monsters } from './schema.ts';

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

/**
 * Backfill monsters.search_text : texte de recherche normalisé (nom FR +
 * type + overlay EN brut) précalculé une fois, pour que la route de recherche
 * fasse un LIKE simple au lieu d'appeler l'UDF normalize() sur trois colonnes
 * de chacune des 964 lignes. Idempotent — ne touche que les lignes NULL
 * (le seed n'écrit pas la colonne, le boot la remplit).
 */
export function backfillMonsterSearchText(): void {
  const db = getDrizzle();
  const pending = db
    .select({
      slug: monsters.slug,
      nameFr: monsters.nameFr,
      type: monsters.type,
      overlayEn: monsters.overlayEn,
    })
    .from(monsters)
    .where(isNull(monsters.searchText))
    .all();
  if (pending.length === 0) return;
  // better-sqlite3 : .transaction(fn) RETOURNE une fonction enveloppée —
  // l'invoquer (pattern « ()(); » des routes, cf. inventory.ts transfer).
  getDb().transaction(() => {
    for (const row of pending) {
      const text = normalizeText(
        `${row.nameFr ?? ''} ${row.type ?? ''} ${row.overlayEn ?? ''}`.replace(/\s+/g, ' ').trim(),
      );
      db.update(monsters).set({ searchText: text }).where(eq(monsters.slug, row.slug)).run();
    }
  })();
  console.log(`[backfill] monsters.search_text rempli pour ${pending.length} lignes`);
}

/**
 * #143/A7 : réconcilie les lots de munitions (« Flèches (20) », srd_index
 * arrows-20…) ajoutés aux inventaires AVANT le fix — des lignes mortes,
 * sans tag de tir. Chaque ligne devient `quantité × taille` unités de la
 * munition unitaire taggée (même personnage, même lieu de stockage),
 * puis la ligne de lot est supprimée. Idempotent : sans ligne de lot,
 * la passe est un no-op.
 */
export function reconcileAmmoPacks(): void {
  const db = getDrizzle();
  const packIndex = new Map(Object.entries(AMMO_PACKS).map(([k, v]) => [k, v]));
  // Ids catalogue des lots et de leurs munitions unitaires (globaux, hors items custom de partie)
  const packRows = db
    .select({ id: items.id, srdIndex: items.srdIndex })
    .from(items)
    .where(inArray(items.srdIndex, [...packIndex.keys()]))
    .all() as Array<{ id: number; srdIndex: string | null }>;
  if (packRows.length === 0) return;
  const unitIds = new Map<string, number>();
  for (const [, pack] of packIndex) {
    if (unitIds.has(pack.unit)) continue;
    const row = db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.srdIndex, pack.unit), isNull(items.partyId)))
      .get() as { id: number } | undefined;
    if (row) unitIds.set(pack.unit, row.id);
  }
  let migrated = 0;
  let credited = 0;
  for (const packRow of packRows) {
    const pack = packRow.srdIndex ? packIndex.get(packRow.srdIndex) : undefined;
    const unitId = pack ? unitIds.get(pack.unit) : undefined;
    if (!pack || !unitId) continue;
    const lots = db
      .select({
        id: inventory.id,
        characterId: inventory.characterId,
        quantity: inventory.quantity,
        storageLocationId: inventory.storageLocationId,
      })
      .from(inventory)
      .where(eq(inventory.itemId, packRow.id))
      .all() as Array<{
      id: number;
      characterId: number;
      quantity: number;
      storageLocationId: number | null;
    }>;
    for (const lot of lots) {
      const units = lot.quantity * pack.size;
      getDb().transaction(() => {
        db.insert(inventory)
          .values({
            characterId: lot.characterId,
            itemId: unitId,
            quantity: units,
            equipped: 0,
            storageLocationId: lot.storageLocationId,
          })
          .onConflictDoUpdate({
            target: [inventory.characterId, inventory.itemId, inventory.storageLocationId],
            set: { quantity: sql`${inventory.quantity} + ${units}` },
          })
          .run();
        db.delete(inventory).where(eq(inventory.id, lot.id)).run();
      })();
      migrated += 1;
      credited += units;
    }
  }
  if (migrated > 0) {
    console.log(
      `[backfill] ammo packs : ${migrated} ligne(s) de lot → ${credited} munitions unitaires`,
    );
  }
}
