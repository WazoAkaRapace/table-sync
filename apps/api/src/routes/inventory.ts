/**
 * Inventory routes: list (with encumbrance in kg), add, update, delete, transfer.
 * All weight math uses the shared computeEncumbrance() helper (kg).
 */

import {
  type AddInventoryPayload,
  type CharacterInventory,
  computeEncumbrance,
  type PatchInventoryPayload,
  type TransferPayload,
} from '@table-sync/shared';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import {
  characters,
  inventory,
  items,
  parties,
  storageLocations,
  transactions,
  users,
} from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  attachCharacterClasses,
  characterVisibleTo,
  imageRevision,
  isOwnerOrGM,
  isPartyGM,
  isPartyMember,
  mapCharacter,
  mapInventoryEntry,
  requireUser,
} from './helpers.ts';
import { langFromReq, pickLocalized } from './lang.ts';

/**
 * inventory JOIN items with the item columns prefixed `i_` — the shape
 * mapInventoryEntry expects (avoids collisions between the two tables'
 * id/name/notes columns). Exported: the annotation routes (item-images.ts)
 * return the same updated-entry payload.
 */
export const INVENTORY_WITH_ITEM = {
  id: inventory.id,
  character_id: inventory.characterId,
  item_id: inventory.itemId,
  quantity: inventory.quantity,
  equipped: inventory.equipped,
  notes: inventory.notes,
  storage_location_id: inventory.storageLocationId,
  added_at: inventory.addedAt,
  i_id: items.id,
  i_source: items.source,
  i_party_id: items.partyId,
  i_category: items.category,
  i_srd_index: items.srdIndex,
  i_name: items.name,
  i_name_fr: items.nameFr,
  i_rarity: items.rarity,
  i_weight_kg: items.weightKg,
  i_cost_qty: items.costQty,
  i_cost_unit: items.costUnit,
  i_description: items.description,
  i_description_en: items.descriptionEn,
  i_base_weapon: items.baseWeapon,
  i_base_armor: items.baseArmor,
  i_armor_family: items.armorFamily,
  i_magic_bonus: items.magicBonus,
  i_damage_dice: items.damageDice,
  i_damage_type: items.damageType,
  i_ac_base: items.acBase,
  i_str_min: items.strMin,
  i_stealth_disadvantage: items.stealthDisadvantage,
  i_properties_json: items.propertiesJson,
  i_survival_tags: items.survivalTags,
  i_image_path: items.imagePath,
  i_image_url: items.imageUrl,
  i_derived_from_item_id: items.derivedFromItemId,
};

/** The entry row (with its item) for one inventory id. */
function getEntryWithItem(invId: number): any {
  return (
    getDrizzle()
      .select(INVENTORY_WITH_ITEM)
      .from(inventory)
      .innerJoin(items, eq(items.id, inventory.itemId))
      .where(eq(inventory.id, invId))
      .get() ?? null
  );
}

/** French display name of an item ('item' fallback), for the transaction log. */
function itemDisplayName(itemId: number): { name: string; nameFr: string | null } {
  const row = getDrizzle()
    .select({ name: sql<string>`COALESCE(${items.nameFr}, ${items.name})`, name_fr: items.nameFr })
    .from(items)
    .where(eq(items.id, itemId))
    .get() as any;
  return { name: row?.name ?? 'item', nameFr: row?.name_fr ?? null };
}

function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

function logTransaction(
  drizzle: ReturnType<typeof getDrizzle>,
  values: typeof transactions.$inferInsert,
): void {
  drizzle.insert(transactions).values(values).run();
}

export async function inventoryRoutes(app: FastifyInstance) {
  // ---------- Get character inventory (with computed kg encumbrance) ----------
  app.get(
    '/characters/:id/inventory',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();

      const char = drizzle
        .select({
          ...cols(characters),
          encumbrance_mode: parties.encumbranceMode,
          owner_name: users.displayName,
        })
        .from(characters)
        .innerJoin(parties, eq(parties.id, characters.partyId))
        .innerJoin(users, eq(users.id, characters.ownerId))
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      // Hidden character: 404 for everyone but its owner and the GM
      if (!characterVisibleTo(char, userId)) {
        return reply.code(404).send({ error: 'character not found' });
      }

      const cleanRows = drizzle
        .select(INVENTORY_WITH_ITEM)
        .from(inventory)
        .innerJoin(items, eq(items.id, inventory.itemId))
        .where(eq(inventory.characterId, char.id))
        .orderBy(desc(inventory.equipped), sql`${items.name} COLLATE NOCASE ASC`)
        .all();

      // Ensure carried location exists
      const { ensureCarriedLocation } = await import('./locations.ts');
      const carriedLocId = ensureCarriedLocation(char.id);

      // Load all storage locations for this character
      const locRows = drizzle
        .select(cols(storageLocations))
        .from(storageLocations)
        .where(eq(storageLocations.characterId, char.id))
        .orderBy(storageLocations.sortOrder, storageLocations.type, storageLocations.id)
        .all() as any[];
      const locations = locRows.map((r: any) => ({
        id: r.id,
        characterId: r.character_id,
        name: r.name,
        type: r.type,
        strength: r.strength,
        multiplier: r.multiplier,
        capacityKg: r.capacity_kg,
        ownWeightKg: r.own_weight_kg,
        itemId: r.item_id,
        sortOrder: r.sort_order,
      }));

      const lang = langFromReq(req);
      const cleanEntries = cleanRows.map((r: any) => ({
        id: r.id,
        characterId: r.character_id,
        itemId: r.item_id,
        item: {
          id: r.i_id,
          source: r.i_source,
          partyId: r.i_party_id,
          category: r.i_category,
          name: pickLocalized(lang, r.i_name, r.i_name_fr),
          rarity: r.i_rarity,
          weightKg: r.i_weight_kg,
          costQty: r.i_cost_qty,
          costUnit: r.i_cost_unit,
          description: pickLocalized(lang, r.i_description_en, r.i_description),
          baseWeapon: r.i_base_weapon ?? null,
          baseArmor: r.i_base_armor ?? null,
          armorFamily: r.i_armor_family ?? null,
          magicBonus: r.i_magic_bonus ?? null,
          damageDice: r.i_damage_dice,
          damageType: r.i_damage_type,
          acBase: r.i_ac_base,
          strMin: r.i_str_min,
          stealthDisadvantage: !!r.i_stealth_disadvantage,
          properties: r.i_properties_json ? JSON.parse(r.i_properties_json) : [],
          survivalTags: r.i_survival_tags
            ? typeof r.i_survival_tags === 'string'
              ? JSON.parse(r.i_survival_tags)
              : r.i_survival_tags
            : [],
          imagePath: r.i_image_path,
          hasImage: !!r.i_image_url,
          imageRev: r.i_image_url ? imageRevision(r.i_image_url) : null,
          derivedFromItemId: r.i_derived_from_item_id ?? null,
        },
        quantity: r.quantity,
        equipped: !!r.equipped,
        notes: r.notes,
        storageLocationId: r.storage_location_id ?? carriedLocId,
        addedAt: r.added_at,
      })) as any[];

      // ---- Compute per-location weights ----
      const COIN_WEIGHT_KG = 0.01;
      const coinCount = char.copper + char.silver + char.electrum + char.gold + char.platinum;
      const coinWeightKg = coinCount * COIN_WEIGHT_KG;

      const EMPTY_WATERSKIN_KG = 0.268; // leather skin only, without water

      const locationWeights = locations.map((loc: any) => {
        const locEntries = cleanEntries.filter(
          (e: any) => (e.storageLocationId ?? carriedLocId) === loc.id,
        );
        const itemsWeight = locEntries.reduce((sum: number, e: any) => {
          let w = e.item.weightKg;
          // Empty waterskins weigh less (just the leather, no water)
          if (
            e.notes?.includes('empty') &&
            e.item.survivalTags &&
            Array.isArray(e.item.survivalTags) &&
            e.item.survivalTags.includes('water')
          ) {
            w = EMPTY_WATERSKIN_KG;
          }
          return sum + (typeof w === 'number' ? w * e.quantity : 0);
        }, 0);

        // Compute max capacity for this location
        let maxCap: number | null = null;
        if (loc.type === 'carried') {
          // Uses character's STR formula
          maxCap = char.strength * 7.5 * (char.capacity_multiplier ?? 1);
        } else if (loc.type === 'mount') {
          // Mount: STR × 7.5 × multiplier
          const mountStr = loc.strength ?? 10;
          maxCap = mountStr * 7.5 * (loc.multiplier ?? 1);
        } else if (loc.type === 'container') {
          // Fixed capacity
          maxCap = loc.capacityKg;
        }

        // For "carried": add coins + container own_weights
        let effectiveWeight = itemsWeight;
        if (loc.type === 'carried') {
          effectiveWeight += coinWeightKg;
          // Add own weight of all containers on this character
          for (const l of locations) {
            if (l.type === 'container') effectiveWeight += l.ownWeightKg || 0;
          }
        }

        const pct = maxCap && maxCap > 0 ? Math.min(100, (effectiveWeight / maxCap) * 100) : 0;

        return {
          locationId: loc.id,
          locationName: loc.name,
          locationType: loc.type,
          itemsWeightKg: +itemsWeight.toFixed(3),
          ownWeightKg:
            loc.type === 'carried'
              ? +(
                  coinWeightKg +
                  locations
                    .filter((l: any) => l.type === 'container')
                    .reduce((s: number, l: any) => s + (l.ownWeightKg || 0), 0)
                ).toFixed(3)
              : 0,
          maxCapacityKg:
            maxCap !== null && maxCap !== undefined && !Number.isNaN(maxCap)
              ? +maxCap.toFixed(2)
              : null,
          pct,
        };
      });

      // ---- Carried encumbrance (uses the "carried" location weight) ----
      const carriedWeight = locationWeights.find((lw: any) => lw.locationType === 'carried');
      const carriedTotal = (carriedWeight?.itemsWeightKg ?? 0) + (carriedWeight?.ownWeightKg ?? 0);

      const encumbrance = computeEncumbrance(
        +carriedTotal.toFixed(3),
        char.strength,
        char.encumbrance_mode,
        +coinWeightKg.toFixed(3),
        char.capacity_multiplier ?? 1,
      );

      // Multiclassage : joindre les lignes de classe (source de vérité moteur)
      attachCharacterClasses([char]);
      const character = mapCharacter(char);

      const result: CharacterInventory = {
        character,
        entries: cleanEntries,
        encumbrance,
        locations,
        locationWeights,
      };
      return reply.send(result);
    },
  );

  // ---------- Add item to inventory ----------
  app.post(
    '/characters/:id/inventory',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: AddInventoryPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isOwnerOrGM(char, userId))
        return reply.code(403).send({ error: 'only the owner or GM can edit this inventory' });

      const body = req.body || ({} as AddInventoryPayload);
      if (!body.itemId) return reply.code(400).send({ error: 'itemId is required' });
      const qty = Math.max(1, body.quantity ?? 1);
      const equipped = body.equipped ? 1 : 0;
      const notes = body.notes || null;

      // A custom item only exists inside its party — it can't enter another
      // party's inventory, even by direct id (search scoping is not enough).
      const addedItem = drizzle
        .select(cols(items))
        .from(items)
        .where(eq(items.id, body.itemId))
        .get() as any;
      if (!addedItem) return reply.code(404).send({ error: 'item not found' });
      if (addedItem.party_id != null && addedItem.party_id !== char.party_id) {
        return reply.code(403).send({ error: 'this item belongs to another party' });
      }

      // Resolve storage location (default to carried)
      const { ensureCarriedLocation } = await import('./locations.ts');
      const carriedId = ensureCarriedLocation(char.id);
      const locId = body.storageLocationId ?? carriedId;

      drizzle
        .insert(inventory)
        .values({
          characterId: char.id,
          itemId: body.itemId,
          quantity: qty,
          equipped,
          notes,
          storageLocationId: locId,
        })
        .onConflictDoUpdate({
          target: [inventory.characterId, inventory.itemId, inventory.storageLocationId],
          set: {
            quantity: sql`${inventory.quantity} + excluded.quantity`,
            equipped: sql`excluded.equipped`,
            notes: sql`excluded.notes`,
          },
        })
        .run();

      // Log transaction
      const itemRow = itemDisplayName(body.itemId);
      logTransaction(drizzle, {
        partyId: char.party_id,
        characterId: char.id,
        itemId: body.itemId,
        itemName: itemRow.name,
        deltaQty: qty,
        reason: 'add',
        actorUserId: userId,
      });

      // Query by character_id + item_id (not lastInsertRowid, which is unreliable on UPSERT)
      const invRow = drizzle
        .select(INVENTORY_WITH_ITEM)
        .from(inventory)
        .innerJoin(items, eq(items.id, inventory.itemId))
        .where(and(eq(inventory.characterId, char.id), eq(inventory.itemId, body.itemId)))
        .get();
      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'add',
        itemName: itemRow.nameFr || itemRow.name,
        actorUserId: userId,
      });
      return reply.code(201).send({ entry: mapInventoryEntry(invRow, langFromReq(req)) });
    },
  );

  // ---------- Update inventory entry (quantity, equipped, notes) ----------
  app.patch(
    '/inventory/:invId',
    async (
      req: FastifyRequest<{ Params: { invId: string }; Body: PatchInventoryPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const inv = drizzle
        .select(cols(inventory))
        .from(inventory)
        .where(eq(inventory.id, Number(req.params.invId)))
        .get() as any;
      if (!inv) return reply.code(404).send({ error: 'inventory entry not found' });
      const char = getCharacter(drizzle, inv.character_id);
      if (!isOwnerOrGM(char, userId))
        return reply.code(403).send({ error: 'only the owner or GM can edit this inventory' });

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      const oldQty = inv.quantity;
      if (body.quantity !== undefined) {
        values.quantity = Math.max(0, Math.floor(body.quantity));
      }
      if (body.equipped !== undefined) {
        values.equipped = body.equipped ? 1 : 0;
      }
      if (body.notes !== undefined) {
        values.notes = body.notes;
      }
      if (body.storageLocationId !== undefined) {
        values.storageLocationId = body.storageLocationId;
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: 'no fields to update' });
      }
      drizzle.update(inventory).set(values).where(eq(inventory.id, inv.id)).run();

      // If quantity changed, log transaction
      if (body.quantity !== undefined) {
        const delta = body.quantity - oldQty;
        if (delta !== 0) {
          const itemRow = itemDisplayName(inv.item_id);
          logTransaction(drizzle, {
            partyId: char.party_id,
            characterId: char.id,
            itemId: inv.item_id,
            itemName: itemRow.name,
            deltaQty: delta,
            reason: 'adjust',
            actorUserId: userId,
          });
        }
      }

      // If quantity reached 0, delete the entry
      if (body.quantity === 0) {
        drizzle.delete(inventory).where(eq(inventory.id, inv.id)).run();
        bus.emitChange({
          type: 'inventory:change',
          partyId: char.party_id,
          characterId: char.id,
          action: 'remove',
          actorUserId: userId,
        });
        return reply.code(204).send();
      }

      const row = getEntryWithItem(inv.id);
      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
        actorUserId: userId,
      });
      return reply.send({ entry: mapInventoryEntry(row, langFromReq(req)) });
    },
  );

  // ---------- Delete inventory entry ----------
  app.delete(
    '/inventory/:invId',
    async (req: FastifyRequest<{ Params: { invId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const inv = drizzle
        .select(cols(inventory))
        .from(inventory)
        .where(eq(inventory.id, Number(req.params.invId)))
        .get() as any;
      if (!inv) return reply.code(404).send({ error: 'inventory entry not found' });
      const char = getCharacter(drizzle, inv.character_id);
      if (!isOwnerOrGM(char, userId))
        return reply.code(403).send({ error: 'only the owner or GM can edit this inventory' });

      const itemRow = itemDisplayName(inv.item_id);
      logTransaction(drizzle, {
        partyId: char.party_id,
        characterId: char.id,
        itemId: inv.item_id,
        itemName: itemRow.name,
        deltaQty: -inv.quantity,
        reason: 'remove',
        actorUserId: userId,
      });

      drizzle.delete(inventory).where(eq(inventory.id, inv.id)).run();
      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'remove',
        itemName: itemRow.nameFr || itemRow.name,
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );

  // ---------- Transfer item between characters ----------
  app.post(
    '/characters/:id/transfer',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: TransferPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const fromCharId = Number(req.params.id);
      const { toCharacterId, inventoryId, quantity } = req.body || {};
      const qty = Math.max(1, Math.floor(quantity ?? 1));

      const drizzle = getDrizzle();
      const fromChar = getCharacter(drizzle, fromCharId);
      const toChar = getCharacter(drizzle, toCharacterId);
      if (!fromChar || !toChar) return reply.code(404).send({ error: 'character not found' });
      if (fromChar.party_id !== toChar.party_id) {
        return reply.code(400).send({ error: 'characters must be in the same party' });
      }
      if (!isOwnerOrGM(fromChar, userId)) {
        return reply
          .code(403)
          .send({ error: 'only the owner or GM can transfer from this character' });
      }

      const inv = drizzle
        .select(cols(inventory))
        .from(inventory)
        .where(eq(inventory.id, inventoryId))
        .get() as any;
      if (!inv || inv.character_id !== fromCharId) {
        return reply.code(404).send({ error: 'inventory entry not found for this character' });
      }
      if (qty > inv.quantity)
        return reply.code(400).send({ error: 'not enough quantity to transfer' });

      const itemName = itemDisplayName(inv.item_id).name;

      // Destination upsert must target the carried location to match the
      // UNIQUE(character_id, item_id, storage_location_id) constraint.
      const { ensureCarriedLocation } = await import('./locations.ts');
      const destLocId = ensureCarriedLocation(toCharacterId);

      getDb().transaction(() => {
        // Remove from source
        if (qty >= inv.quantity) {
          drizzle.delete(inventory).where(eq(inventory.id, inv.id)).run();
        } else {
          drizzle
            .update(inventory)
            .set({ quantity: sql`${inventory.quantity} - ${qty}` })
            .where(eq(inventory.id, inv.id))
            .run();
        }
        // Add to destination (lands in carried, merging with an existing stack)
        drizzle
          .insert(inventory)
          .values({
            characterId: toCharacterId,
            itemId: inv.item_id,
            quantity: qty,
            equipped: 0,
            notes: null,
            storageLocationId: destLocId,
          })
          .onConflictDoUpdate({
            target: [inventory.characterId, inventory.itemId, inventory.storageLocationId],
            set: { quantity: sql`${inventory.quantity} + excluded.quantity` },
          })
          .run();

        logTransaction(drizzle, {
          partyId: fromChar.party_id,
          characterId: fromCharId,
          itemId: inv.item_id,
          itemName,
          deltaQty: -qty,
          reason: 'transfer-out',
          actorUserId: userId,
        });
        logTransaction(drizzle, {
          partyId: toChar.party_id,
          characterId: toCharacterId,
          itemId: inv.item_id,
          itemName,
          deltaQty: qty,
          reason: 'transfer-in',
          actorUserId: userId,
        });
      })();

      // Emit events for both source and destination characters
      bus.emitChange({
        type: 'inventory:change',
        partyId: fromChar.party_id,
        characterId: fromCharId,
        toCharacterId,
        action: 'transfer',
        itemName,
        actorUserId: userId,
      });

      return reply.code(200).send({ transferred: qty });
    },
  );

  // ---------- Consume food/water from inventory (resets deprivation) ----------
  app.post(
    '/characters/:id/consume',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { type: 'food' | 'water' } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isOwnerOrGM(char, userId))
        return reply.code(403).send({ error: 'only the owner or GM can edit this inventory' });

      const type = req.body?.type;
      if (type !== 'food' && type !== 'water')
        return reply.code(400).send({ error: 'type must be food or water' });

      // Find a tagged inventory item
      // For water: skip items with notes containing 'empty' (already drunk)
      const notEmpty =
        type === 'water'
          ? sql`AND (${inventory.notes} IS NULL OR ${inventory.notes} = '' OR ${inventory.notes} NOT LIKE '%empty%')`
          : sql``;

      const entry = drizzle
        .select({
          inv_id: inventory.id,
          quantity: inventory.quantity,
          item_id: inventory.itemId,
          notes: inventory.notes,
          name_fr: items.nameFr,
          name: items.name,
        })
        .from(inventory)
        .innerJoin(items, eq(items.id, inventory.itemId))
        .where(
          sql`${inventory.characterId} = ${char.id} AND ${items.survivalTags} LIKE ${`%"${type}"%`} ${notEmpty}`,
        )
        .orderBy(desc(inventory.quantity))
        .limit(1)
        .get() as any;

      if (!entry || entry.quantity < 1) {
        const msg =
          type === 'food'
            ? 'Aucune ration disponible'
            : 'Aucune gourde disponible (toutes vides ou absentes)';
        return reply.code(400).send({ error: msg });
      }

      const itemName = entry.name_fr || entry.name;

      if (type === 'food') {
        // Food is consumed (destroyed)
        getDb().transaction(() => {
          if (entry.quantity <= 1) {
            drizzle.delete(inventory).where(eq(inventory.id, entry.inv_id)).run();
          } else {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} - 1` })
              .where(eq(inventory.id, entry.inv_id))
              .run();
          }
          drizzle.update(characters).set({ foodDays: 0 }).where(eq(characters.id, char.id)).run();
          logTransaction(drizzle, {
            partyId: char.party_id,
            characterId: char.id,
            itemId: entry.item_id,
            itemName,
            deltaQty: -1,
            reason: 'consume-food',
            actorUserId: userId,
          });
        })();
      } else {
        // Water: decrement full waterskins, increment empty ones
        // The entry found is a "full" waterskin (not marked empty in notes)
        getDb().transaction(() => {
          // Decrement the full entry
          if (entry.quantity <= 1) {
            drizzle.delete(inventory).where(eq(inventory.id, entry.inv_id)).run();
          } else {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} - 1` })
              .where(eq(inventory.id, entry.inv_id))
              .run();
          }

          // Check if an "empty" entry already exists for this item+character
          // Empty entries are stored with storage_location_id = NULL to avoid UNIQUE collision
          const emptyEntry = drizzle
            .select({ id: inventory.id, quantity: inventory.quantity })
            .from(inventory)
            .where(
              and(
                eq(inventory.characterId, char.id),
                eq(inventory.itemId, entry.item_id),
                sql`${inventory.notes} LIKE '%empty%'`,
                isNull(inventory.storageLocationId),
              ),
            )
            .limit(1)
            .get() as any;

          if (emptyEntry) {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} + 1` })
              .where(eq(inventory.id, emptyEntry.id))
              .run();
          } else {
            drizzle
              .insert(inventory)
              .values({
                characterId: char.id,
                itemId: entry.item_id,
                quantity: 1,
                equipped: 0,
                notes: 'empty',
                storageLocationId: null,
              })
              .run();
          }

          drizzle.update(characters).set({ waterDays: 0 }).where(eq(characters.id, char.id)).run();
          logTransaction(drizzle, {
            partyId: char.party_id,
            characterId: char.id,
            itemId: entry.item_id,
            itemName,
            deltaQty: -1,
            reason: 'consume-water',
            actorUserId: userId,
          });
        })();
      }

      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
        actorUserId: userId,
      });

      return reply.send({ consumed: true, type });
    },
  );

  // ---------- Refill waterskins (at a water source) ----------
  app.post(
    '/characters/:id/refill',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      // No body expected — this endpoint just refills all empty waterskins
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isOwnerOrGM(char, userId))
        return reply.code(403).send({ error: 'only the owner or GM can edit this inventory' });

      // Find all empty waterskins
      const empties = drizzle
        .select({
          inv_id: inventory.id,
          quantity: inventory.quantity,
          notes: inventory.notes,
          item_id: inventory.itemId,
          storage_location_id: inventory.storageLocationId,
          name_fr: items.nameFr,
        })
        .from(inventory)
        .innerJoin(items, eq(items.id, inventory.itemId))
        .where(
          and(
            eq(inventory.characterId, char.id),
            sql`${items.survivalTags} LIKE '%water%'`,
            sql`${inventory.notes} LIKE '%empty%'`,
          ),
        )
        .all() as any[];

      if (!empties.length) {
        return reply.code(400).send({ error: 'Aucune gourde vide à remplir' });
      }

      const { ensureCarriedLocation } = await import('./locations.ts');
      const carriedId = ensureCarriedLocation(char.id);

      getDb().transaction(() => {
        for (const e of empties) {
          const emptyQty = e.quantity;
          // Find the corresponding full entry (any location, no 'empty' note)
          const fullEntry = drizzle
            .select({ id: inventory.id, quantity: inventory.quantity })
            .from(inventory)
            .where(
              and(
                eq(inventory.characterId, char.id),
                eq(inventory.itemId, e.item_id),
                or(
                  isNull(inventory.notes),
                  eq(inventory.notes, ''),
                  sql`${inventory.notes} NOT LIKE '%empty%'`,
                ),
              ),
            )
            .limit(1)
            .get() as any;

          if (fullEntry) {
            // Merge into existing full stack
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} + ${emptyQty}` })
              .where(eq(inventory.id, fullEntry.id))
              .run();
            // Delete the empty entry
            drizzle.delete(inventory).where(eq(inventory.id, e.inv_id)).run();
          } else {
            // No full entry exists — just clear the empty note and assign to carried
            drizzle
              .update(inventory)
              .set({ notes: null, storageLocationId: carriedId })
              .where(eq(inventory.id, e.inv_id))
              .run();
          }
        }
      })();

      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
        actorUserId: userId,
      });

      return reply.send({ refilled: empties.length });
    },
  );

  // ---------- GM: transaction log for a party ----------
  app.get(
    '/parties/:partyId/transactions',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyGM(partyId, userId)) return reply.code(403).send({ error: 'GM only' });

      const rows = getDrizzle()
        .select({ ...cols(transactions), actor_name: users.displayName })
        .from(transactions)
        .leftJoin(users, eq(users.id, transactions.actorUserId))
        .where(eq(transactions.partyId, partyId))
        .orderBy(desc(transactions.at), desc(transactions.id))
        .limit(200)
        .all();
      return reply.send({
        transactions: rows.map((r: any) => ({
          id: r.id,
          partyId: r.party_id,
          characterId: r.character_id,
          itemId: r.item_id,
          itemName: r.item_name,
          deltaQty: r.delta_qty,
          reason: r.reason,
          actorName: r.actor_name,
          at: r.at,
        })),
      });
    },
  );
}
