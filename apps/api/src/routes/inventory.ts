/**
 * Inventory routes: list (with encumbrance in kg), add, update, delete, transfer.
 * All weight math uses the shared computeEncumbrance() helper (kg).
 */

import {
  type AddInventoryPayload,
  AMMO_PACKS,
  type CharacterInventory,
  type CoinAmounts,
  coinsTotalCp,
  computeInventoryWeights,
  EMPTY_COINS,
  gainCoins,
  type PatchInventoryPayload,
  spendCoins,
  type TransferPayload,
  WEAPON_AMMUNITION,
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
  isOwnerOrGM,
  isPartyGM,
  isPartyMember,
  mapCharacter,
  mapInventoryEntry,
  requireUser,
} from './helpers.ts';
import { mirrorAcToCombatants } from './character-spell-effects.ts';
import { sendCachedJson } from './httpCache.ts';
import { type AppLang, langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';

/** #143 : genres de munitions consommables — tags de survie posés par le seed,
 * valeurs de WEAPON_AMMUNITION (shared) : l'arme équipée désigne SON type. */
const AMMO_KINDS = [...new Set(Object.values(WEAPON_AMMUNITION))];

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
  // Existence seule : le résumé embarqué ne transporte jamais la prose
  // (mapItem(summary)), lire les colonnes TEXT était du I/O jeté à chaque
  // descente de fiche. Le drapeau pilote le même contrat client (lazyDetails
  // ouvre la ligne → GET /items/:id).
  i_has_description: sql<boolean>`(COALESCE(${items.description}, '') != '')`,
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

/** Changement d'entrée appliquable au cache client (même contrat que le PATCH
 *  quantité : `{ entry }` après mutation, `{ removedId }` après suppression). */
type EntryChange = { entry?: any; removedId?: number };

/** Total d'un tag de survie après le geste (pleines gourdes seulement si
 *  demandé) — le toast du client annonce au joueur ce qu'il reste. */
function countSurvivalTag(charId: number, tag: string, fullOnly: boolean): number {
  const notEmpty = fullOnly
    ? sql`AND (${inventory.notes} IS NULL OR ${inventory.notes} = '' OR ${inventory.notes} NOT LIKE '%empty%')`
    : sql``;
  const row = getDrizzle()
    .select({ total: sql<number>`COALESCE(SUM(${inventory.quantity}), 0)` })
    .from(inventory)
    .innerJoin(items, eq(items.id, inventory.itemId))
    .where(
      sql`${inventory.characterId} = ${charId} AND ${items.survivalTags} LIKE ${`%"${tag}"%`} ${notEmpty}`,
    )
    .get() as any;
  return row?.total ?? 0;
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

/**
 * Entrées + lieux + poids d'un personnage — le cœur de GET
 * /characters/:id/inventory, réutilisé par la vue d'ensemble du tableau MD
 * (GET /parties/:id/roster-overview : UNE requête par groupe au lieu de N
 * fiches complètes). `char` doit porter encumbrance_mode (JOIN parties).
 */
export async function loadInventoryView(
  drizzle: ReturnType<typeof getDrizzle>,
  char: any,
  lang: AppLang = 'fr',
): Promise<{
  entries: any[];
  locations: any[];
  encumbrance: any;
  locationWeights: any;
  carriedLocId: number;
  character: any;
}> {
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

  // Objets embarqués en RÉSUMÉ (description à null via mapInventoryEntry) :
  // la fiche entière re-descend après CHAQUE mutation et à chaque événement
  // de synchronisation — la prose des objets en était le gros du fil. Les
  // lignes la chargent à l'ouverture (GET /items/:id, mis en cache client).
  const cleanEntries = cleanRows.map((r: any) => {
    const entry = mapInventoryEntry(r, lang);
    if (entry.storageLocationId == null) entry.storageLocationId = carriedLocId;
    return entry;
  }) as any[];

  // ---- Poids par emplacement + encombrement (moteur partagé) ----
  // Extrait vers packages/shared (computeInventoryWeights) : le client le
  // rejoue après une mutation locale (setQueryData) sans re-télécharger
  // la fiche — UNE seule implémentation des deux côtés du fil.
  // Multiclassage : joindre les lignes de classe (source de vérité moteur)
  attachCharacterClasses([char]);
  const character = mapCharacter(char);
  const weights = computeInventoryWeights(
    character,
    cleanEntries,
    locations,
    char.encumbrance_mode,
    carriedLocId,
  );

  return {
    entries: cleanEntries,
    locations,
    encumbrance: weights.encumbrance,
    locationWeights: weights.locationWeights,
    carriedLocId,
    character,
  };
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
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      // Hidden character: 404 for everyone but its owner and the GM
      if (!characterVisibleTo(char, userId)) {
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      }

      const view = await loadInventoryView(drizzle, char, langFromReq(req));

      const result: CharacterInventory = {
        character: view.character,
        entries: view.entries,
        // Mode exposé pour que le client recalcule les poids localement
        encumbranceMode: char.encumbrance_mode,
        encumbrance: view.encumbrance,
        locations: view.locations,
        locationWeights: view.locationWeights,
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
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isOwnerOrGM(char, userId))
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });

      const body = req.body || ({} as AddInventoryPayload);
      if (!body.itemId) return reply.code(400).send({ error: apiMsg(req, 'itemId is required') });
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
      if (!addedItem) return reply.code(404).send({ error: apiMsg(req, 'item not found') });
      if (addedItem.party_id != null && addedItem.party_id !== char.party_id) {
        return reply.code(403).send({ error: apiMsg(req, 'this item belongs to another party') });
      }

      // Resolve storage location (default to carried) — AVANT le bloc lot :
      // l'interception munitions crédite la ligne unitaire au même endroit.
      const { ensureCarriedLocation } = await import('./locations.ts');
      const carriedId = ensureCarriedLocation(char.id);
      const locId = body.storageLocationId ?? carriedId;

      // Lot de munitions (A7/#143) : le lot lui-même n'est PAS une ligne
      // d'inventaire — il n'a pas de tag de tir. L'ajouter crédite la
      // munition UNITAIRE taggée (qty × taille) : « Flèches (20) » → 20
      // Flèches, la ligne que l'arc équipé décrémente au tir.
      const pack = AMMO_PACKS[addedItem.srd_index];
      if (pack) {
        const unitItem = drizzle
          .select(cols(items))
          .from(items)
          .where(and(eq(items.srdIndex, pack.unit), isNull(items.partyId)))
          .get() as any;
        if (unitItem) {
          const unitQty = qty * pack.size;
          drizzle
            .insert(inventory)
            .values({
              characterId: char.id,
              itemId: unitItem.id,
              quantity: unitQty,
              equipped: 0,
              notes,
              storageLocationId: locId,
            })
            .onConflictDoUpdate({
              target: [inventory.characterId, inventory.itemId, inventory.storageLocationId],
              set: { quantity: sql`${inventory.quantity} + excluded.quantity` },
            })
            .run();
          logTransaction(drizzle, {
            partyId: char.party_id,
            characterId: char.id,
            itemId: unitItem.id,
            itemName: unitItem.nameFr || unitItem.name,
            deltaQty: unitQty,
            reason: 'add',
            actorUserId: userId,
          });
          bus.emitChange({
            type: 'inventory:change',
            partyId: char.party_id,
            characterId: char.id,
            action: 'add',
            itemName: unitItem.nameFr || unitItem.name,
            actorUserId: userId,
          });
          const unitRow = drizzle
            .select(INVENTORY_WITH_ITEM)
            .from(inventory)
            .innerJoin(items, eq(items.id, inventory.itemId))
            .where(and(eq(inventory.characterId, char.id), eq(inventory.itemId, unitItem.id)))
            .get();
          return reply.code(201).send({ entry: mapInventoryEntry(unitRow, langFromReq(req)) });
        }
        // Item unitaire introuvable (seed exotique) : on retombe sur le
        // comportement générique ci-dessous — jamais d'échec silencieux.
      }

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
      // L'upsert réécrit `equipped` : une armure/bouclier équipé (ou déséquipé)
      // resynchronise la CA des combatants (no-op sinon).
      mirrorAcToCombatants(char.id, userId);

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
      if (!inv) return reply.code(404).send({ error: apiMsg(req, 'inventory entry not found') });
      const char = getCharacter(drizzle, inv.character_id);
      if (!isOwnerOrGM(char, userId))
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });

      const body = req.body || {};

      // — Déplacement d'emplacement : chemin DÉDIÉ (fusion à l'arrivée,
      //    quantité déplaçable). Un PATCH storageLocationId sur un UPDATE
      //    brut explosait la contrainte UNIQUE (character_id, item_id,
      //    storage_location_id) quand la destination tenait déjà le même
      //    objet — 500 en plein jeu (rapport joueurs 2026-10). Ici : la
      //    destination SOMME ses quantités (même dialecte que l'ajout POST,
      //    onConflictDoUpdate), la ligne source garde le reste ou disparaît.
      if (
        body.storageLocationId !== undefined &&
        body.storageLocationId !== null &&
        body.storageLocationId !== inv.storage_location_id
      ) {
        const targetLocId = body.storageLocationId;
        // L'emplacement doit appartenir au MÊME personnage (ou être null
        // interdit ici : le move explicite vise un conteneur/emplacement).
        const targetLoc = drizzle
          .select(cols(storageLocations))
          .from(storageLocations)
          .where(eq(storageLocations.id, targetLocId))
          .get() as any;
        if (!targetLoc || targetLoc.character_id !== inv.character_id) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid storage location') });
        }
        const moveQty = Math.max(1, Math.min(body.moveQuantity ?? inv.quantity, inv.quantity));
        getDb().transaction(() => {
          // Destination : somme (upsert, même dialecte que POST /inventory).
          drizzle
            .insert(inventory)
            .values({
              characterId: inv.character_id,
              itemId: inv.item_id,
              quantity: moveQty,
              equipped: inv.equipped, // l'état équipé voyage avec les unités
              notes: inv.notes,
              storageLocationId: targetLocId,
            })
            .onConflictDoUpdate({
              target: [inventory.characterId, inventory.itemId, inventory.storageLocationId],
              set: {
                quantity: sql`${inventory.quantity} + excluded.quantity`,
                equipped: sql`${inventory.equipped} | excluded.equipped`,
                notes: sql`coalesce(excluded.notes, ${inventory.notes})`,
              },
            })
            .run();
          // Source : garde le reste, ou disparaît si tout est parti.
          const remaining = inv.quantity - moveQty;
          if (remaining > 0) {
            drizzle
              .update(inventory)
              .set({ quantity: remaining, equipped: 0 })
              .where(eq(inventory.id, inv.id))
              .run();
          } else {
            drizzle.delete(inventory).where(eq(inventory.id, inv.id)).run();
          }
        })();
        // Un équipement qui déménage peut changer la CA effective du port
        // (bouclier vers un sac) — le traqueur suit (no-op sinon).
        mirrorAcToCombatants(char.id, userId);
        bus.emitChange({
          type: 'inventory:change',
          partyId: char.party_id,
          characterId: char.id,
          action: 'adjust',
          actorUserId: userId,
        });
        const movedRow = drizzle
          .select(INVENTORY_WITH_ITEM)
          .from(inventory)
          .innerJoin(items, eq(items.id, inventory.itemId))
          .where(
            and(
              eq(inventory.characterId, inv.character_id),
              eq(inventory.itemId, inv.item_id),
              eq(inventory.storageLocationId, targetLocId),
            ),
          )
          .get();
        return reply.send({ entry: mapInventoryEntry(movedRow, langFromReq(req)) });
      }

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
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      drizzle.update(inventory).set(values).where(eq(inventory.id, inv.id)).run();
      // Équiper/déséquiper change une entrée de la CA — le traqueur suit
      // (no-op si la CA ne bouge pas : arme, objet quelconque).
      if (body.equipped !== undefined) {
        mirrorAcToCombatants(char.id, userId);
      }

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
        // L'entrée supprimée pouvait être une armure/portée équipée — la CA
        // des combatants suit sa disparition.
        mirrorAcToCombatants(char.id, userId);
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
      if (!inv) return reply.code(404).send({ error: apiMsg(req, 'inventory entry not found') });
      const char = getCharacter(drizzle, inv.character_id);
      if (!isOwnerOrGM(char, userId))
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });

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
      // L'entrée supprimée pouvait être une armure/bouclier équipé — la CA
      // des combatants suit sa disparition (no-op sinon).
      mirrorAcToCombatants(char.id, userId);
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
      if (!fromChar || !toChar)
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (fromChar.party_id !== toChar.party_id) {
        return reply.code(400).send({ error: apiMsg(req, 'characters must be in the same party') });
      }
      if (!isOwnerOrGM(fromChar, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can transfer from this character') });
      }

      const inv = drizzle
        .select(cols(inventory))
        .from(inventory)
        .where(eq(inventory.id, inventoryId))
        .get() as any;
      if (!inv || inv.character_id !== fromCharId) {
        return reply
          .code(404)
          .send({ error: apiMsg(req, 'inventory entry not found for this character') });
      }
      if (qty > inv.quantity)
        return reply.code(400).send({ error: apiMsg(req, 'not enough quantity to transfer') });

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
        // L'entrée transférée arrive NON équipée : si elle était équipée au
        // départ, la CA du donneur suit (celle du receveur ne bouge pas).
        mirrorAcToCombatants(fromCharId, userId);
        mirrorAcToCombatants(toCharacterId, userId);
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

  // ---------- Transfer a container (with its content) between characters ----------
  // #161 : le conteneur (storage_locations type='container') change de
  // personnage AVEC son contenu — les lignes d'inventaire qui pointent sur
  // le lieu suivent le mouvement (elles gardent leur storage_location_id,
  // le lieu se déplace avec elles) et arrivent NON équipées, comme un objet
  // transféré. L'objet conteneur lui-même (location.item_id, d'ordinaire
  // posé dans le porté du donneur) suit le chemin de POST /transfer :
  // décrément/suppression chez le donneur + upsert dans le « Sur moi » du
  // receveur. Le journal n'enregistre QUE la ligne conteneur (±1, nom du
  // lieu + éventuel « (+N objets) »), jamais une ligne par contenu.
  app.post(
    '/characters/:id/transfer-container',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { toCharacterId: number; locationId: number };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const fromCharId = Number(req.params.id);
      const { toCharacterId, locationId } = req.body || {};
      if (!toCharacterId || !locationId) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'toCharacterId and locationId are required') });
      }

      const drizzle = getDrizzle();
      const fromChar = getCharacter(drizzle, fromCharId);
      const toChar = getCharacter(drizzle, Number(toCharacterId));
      if (!fromChar || !toChar)
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (fromChar.party_id !== toChar.party_id) {
        return reply.code(400).send({ error: apiMsg(req, 'characters must be in the same party') });
      }
      if (!isOwnerOrGM(fromChar, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can transfer from this character') });
      }

      const loc = drizzle
        .select(cols(storageLocations))
        .from(storageLocations)
        .where(eq(storageLocations.id, Number(locationId)))
        .get() as any;
      if (!loc || loc.character_id !== fromCharId) {
        return reply
          .code(404)
          .send({ error: apiMsg(req, 'storage location not found for this character') });
      }
      if (loc.type !== 'container') {
        return reply.code(400).send({ error: apiMsg(req, 'only containers can be transferred') });
      }

      const contentCount =
        (
          drizzle
            .select({ c: sql<number>`count(*)` })
            .from(inventory)
            .where(eq(inventory.storageLocationId, loc.id))
            .get() as any
        )?.c ?? 0;
      const itemName = contentCount > 0 ? `${loc.name} (+${contentCount} objets)` : loc.name;

      // Objet conteneur chez le donneur (s'il existe) + destination portée
      // du receveur — résolus AVANT la transaction, comme POST /transfer.
      let giverContainerRow: any = null;
      let destCarriedId = 0;
      if (loc.item_id != null) {
        giverContainerRow = drizzle
          .select(cols(inventory))
          .from(inventory)
          .where(and(eq(inventory.characterId, fromCharId), eq(inventory.itemId, loc.item_id)))
          .get() as any;
        if (giverContainerRow) {
          const { ensureCarriedLocation } = await import('./locations.ts');
          destCarriedId = ensureCarriedLocation(Number(toCharacterId));
        }
      }

      getDb().transaction(() => {
        // Le lieu déménage avec son contenu : les lignes gardent leur
        // storage_location_id, changent de personnage et arrivent déséquipées.
        drizzle
          .update(inventory)
          .set({ characterId: Number(toCharacterId), equipped: 0 })
          .where(eq(inventory.storageLocationId, loc.id))
          .run();
        drizzle
          .update(storageLocations)
          .set({ characterId: Number(toCharacterId) })
          .where(eq(storageLocations.id, loc.id))
          .run();

        // L'objet conteneur lui-même part comme un objet transféré.
        if (giverContainerRow) {
          if (giverContainerRow.quantity > 1) {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} - 1` })
              .where(eq(inventory.id, giverContainerRow.id))
              .run();
          } else {
            drizzle.delete(inventory).where(eq(inventory.id, giverContainerRow.id)).run();
          }
          drizzle
            .insert(inventory)
            .values({
              characterId: Number(toCharacterId),
              itemId: loc.item_id,
              quantity: 1,
              equipped: 0,
              notes: null,
              storageLocationId: destCarriedId,
            })
            .onConflictDoUpdate({
              target: [inventory.characterId, inventory.itemId, inventory.storageLocationId],
              set: { quantity: sql`${inventory.quantity} + excluded.quantity` },
            })
            .run();
        }

        logTransaction(drizzle, {
          partyId: fromChar.party_id,
          characterId: fromCharId,
          itemId: loc.item_id ?? null,
          itemName,
          deltaQty: -1,
          reason: 'transfer-out',
          actorUserId: userId,
        });
        logTransaction(drizzle, {
          partyId: toChar.party_id,
          characterId: Number(toCharacterId),
          itemId: loc.item_id ?? null,
          itemName,
          deltaQty: 1,
          reason: 'transfer-in',
          actorUserId: userId,
        });
        // Le contenu arrive déséquipé : si un objet équipé vivait dans le
        // conteneur, la CA du donneur suit (le receveur ne pouvait rien
        // équiper de ce lot — les objets étaient chez le donneur).
        mirrorAcToCombatants(fromCharId, userId);
        mirrorAcToCombatants(Number(toCharacterId), userId);
      })();

      bus.emitChange({
        type: 'inventory:change',
        partyId: fromChar.party_id,
        characterId: fromCharId,
        toCharacterId: Number(toCharacterId),
        action: 'transfer',
        itemName: loc.name,
        actorUserId: userId,
      });

      return reply.code(200).send({ transferred: 1, itemsMoved: contentCount });
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
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isOwnerOrGM(char, userId))
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });

      const type = req.body?.type;
      if (type !== 'food' && type !== 'water' && type !== 'ammo')
        return reply.code(400).send({ error: apiMsg(req, 'type must be food or water') });
      // #143 : le genre de munition est OBLIGATOIRE — tag d'inventaire dont la
      // valeur est celle de WEAPON_AMMUNITION (shared) : l'arme équipée
      // désigne SON consommable, arc → flèches, arbalète → carreaux.
      const ammoKind = req.body?.ammo;
      if (type === 'ammo' && !AMMO_KINDS.includes(ammoKind))
        return reply.code(400).send({
          error: apiMsg(req, `ammo kind must be one of: ${AMMO_KINDS.join(', ')}`),
        });
      const tag = type === 'ammo' ? ammoKind : type;

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
          sql`${inventory.characterId} = ${char.id} AND ${items.survivalTags} LIKE ${`%"${tag}"%`} ${notEmpty}`,
        )
        .orderBy(desc(inventory.quantity))
        .limit(1)
        .get() as any;

      if (!entry || entry.quantity < 1) {
        const msg =
          type === 'food'
            ? 'Aucune ration disponible'
            : type === 'ammo'
              ? 'Aucune munition disponible'
              : 'Aucune gourde disponible (toutes vides ou absentes)';
        return reply.code(400).send({ error: msg });
      }

      const itemName = entry.name_fr || entry.name;
      const lang = langFromReq(req);
      // Le geste renvoie les entrées mutées + le reste même-tag : le client
      // applique au cache react-query (1 RTT, pas de fiche entière) et le
      // toast dit ce qu'il reste.
      const changes: EntryChange[] = [];

      if (type === 'food') {
        // Food is consumed (destroyed)
        getDb().transaction(() => {
          if (entry.quantity <= 1) {
            drizzle.delete(inventory).where(eq(inventory.id, entry.inv_id)).run();
            changes.push({ removedId: entry.inv_id });
          } else {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} - 1` })
              .where(eq(inventory.id, entry.inv_id))
              .run();
            changes.push({ entry: mapInventoryEntry(getEntryWithItem(entry.inv_id), lang) });
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
      } else if (type === 'ammo') {
        // #143 : un tir consomme une munition — même geste que la ration,
        // sans toucher aux compteurs de privation.
        getDb().transaction(() => {
          if (entry.quantity <= 1) {
            drizzle.delete(inventory).where(eq(inventory.id, entry.inv_id)).run();
            changes.push({ removedId: entry.inv_id });
          } else {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} - 1` })
              .where(eq(inventory.id, entry.inv_id))
              .run();
            changes.push({ entry: mapInventoryEntry(getEntryWithItem(entry.inv_id), lang) });
          }
          logTransaction(drizzle, {
            partyId: char.party_id,
            characterId: char.id,
            itemId: entry.item_id,
            itemName,
            deltaQty: -1,
            reason: 'consume-ammo',
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
            changes.push({ removedId: entry.inv_id });
          } else {
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} - 1` })
              .where(eq(inventory.id, entry.inv_id))
              .run();
            changes.push({ entry: mapInventoryEntry(getEntryWithItem(entry.inv_id), lang) });
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
            changes.push({ entry: mapInventoryEntry(getEntryWithItem(emptyEntry.id), lang) });
          } else {
            const inserted = drizzle
              .insert(inventory)
              .values({
                characterId: char.id,
                itemId: entry.item_id,
                quantity: 1,
                equipped: 0,
                notes: 'empty',
                storageLocationId: null,
              })
              .returning({ id: inventory.id })
              .get() as any;
            changes.push({ entry: mapInventoryEntry(getEntryWithItem(inserted.id), lang) });
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

      return reply.send({
        consumed: true,
        type,
        name: itemName,
        remaining: countSurvivalTag(char.id, tag, type === 'water'),
        changes,
        ...(type === 'food' ? { foodDays: 0 } : {}),
        ...(type === 'water' ? { waterDays: 0 } : {}),
      });
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
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isOwnerOrGM(char, userId))
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });

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
        return reply.code(400).send({ error: apiMsg(req, 'Aucune gourde vide à remplir') });
      }

      const { ensureCarriedLocation } = await import('./locations.ts');
      const carriedId = ensureCarriedLocation(char.id);
      const lang = langFromReq(req);
      // Même contrat que /consume : les lignes réglées partent au client pour
      // l'application locale au cache.
      const changes: EntryChange[] = [];

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
            changes.push(
              { entry: mapInventoryEntry(getEntryWithItem(fullEntry.id), lang) },
              { removedId: e.inv_id },
            );
          } else {
            // No full entry exists — just clear the empty note and assign to carried
            drizzle
              .update(inventory)
              .set({ notes: null, storageLocationId: carriedId })
              .where(eq(inventory.id, e.inv_id))
              .run();
            changes.push({ entry: mapInventoryEntry(getEntryWithItem(e.inv_id), lang) });
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

      // Unités remplies (une pile de 2 gourdes vides = 2 gourdes pleines) —
      // le bouton affichait déjà ce compte-là, le toast dit la même chose.
      return reply.send({
        refilled: empties.reduce((sum: number, e: any) => sum + e.quantity, 0),
        changes,
      });
    },
  );

  // ---------- GM: transaction log for a party ----------
  app.get(
    '/parties/:partyId/transactions',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'GM only') });

      const rows = getDrizzle()
        .select({ ...cols(transactions), actor_name: users.displayName })
        .from(transactions)
        .leftJoin(users, eq(users.id, transactions.actorUserId))
        .where(eq(transactions.partyId, partyId))
        .orderBy(desc(transactions.at), desc(transactions.id))
        .limit(200)
        .all();
      // ETag : le tableau MD rafraîchit le journal à CHAQUE inventory:change
      // du groupe (vocabulaire v2) — inchangé entre deux gestes → 304.
      return sendCachedJson(req, reply, {
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

  // ---------- Transfer coins between characters (issue #160) ----------
  // Le donneur saisit un montant libre par dénomination (ou un total) ; le
  // serveur convertit via spendCoins (casse minimale) depuis la bourse du
  // DONNEUR, et le receveur encaisse exactement la répartition dépensée
  // (gainCoins, sans regroupement). Deux événements character:change
  // action 'coins', un par personnage.
  app.post(
    '/characters/:id/transfer-coins',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: {
          toCharacterId: number;
          amounts: Partial<Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number>>;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const fromCharId = Number(req.params.id);
      const body = req.body || ({} as typeof req.body);
      const toCharacterId = Number(body.toCharacterId);

      const drizzle = getDrizzle();
      const fromChar = getCharacter(drizzle, fromCharId);
      const toChar = getCharacter(drizzle, toCharacterId);
      if (!fromChar || !toChar)
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (fromChar.party_id !== toChar.party_id) {
        return reply.code(400).send({ error: apiMsg(req, 'characters must be in the same party') });
      }
      if (!isOwnerOrGM(fromChar, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can transfer from this character') });
      }

      // Montants : entiers >= 0 par dénomination, total strictement positif.
      const amounts: CoinAmounts = { ...EMPTY_COINS };
      for (const unit of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
        const v = (body.amounts ?? {})[unit];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          return reply.code(400).send({ error: apiMsg(req, 'montant de transfert invalide') });
        }
        amounts[unit] = v;
      }
      if (coinsTotalCp(amounts) <= 0) {
        return reply.code(400).send({ error: apiMsg(req, 'montant de transfert invalide') });
      }

      // Bourse du donneur : spendCoins fait la conversion (casse minimale) —
      // le receveur encaisse la RÉPARTITION DÉPENSÉE, pas la demande brute.
      const purse: CoinAmounts = {
        cp: fromChar.copper,
        sp: fromChar.silver,
        ep: fromChar.electrum,
        gp: fromChar.gold,
        pp: fromChar.platinum,
      };
      const spend = spendCoins(purse, amounts);
      if (!spend.ok) {
        return reply.code(400).send({
          error: apiMsg(req, 'bourse insuffisante'),
          shortfallCp: spend.shortfallCp,
        });
      }
      // Le receveur encaisse la répartition DEMANDÉE (le donneur a bien été
      // débité de sa valeur : spendCoins couvre exactement `amounts`, en
      // pièces exactes + casse + menue monnaie) — gainCoins sans regroupement.
      const receiverPurse: CoinAmounts = {
        cp: toChar.copper,
        sp: toChar.silver,
        ep: toChar.electrum,
        gp: toChar.gold,
        pp: toChar.platinum,
      };
      const credited = gainCoins(receiverPurse, amounts);

      getDb().transaction(() => {
        drizzle
          .update(characters)
          .set({
            copper: spend.purse.cp,
            silver: spend.purse.sp,
            electrum: spend.purse.ep,
            gold: spend.purse.gp,
            platinum: spend.purse.pp,
          })
          .where(eq(characters.id, fromCharId))
          .run();
        drizzle
          .update(characters)
          .set({
            copper: credited.cp,
            silver: credited.sp,
            electrum: credited.ep,
            gold: credited.gp,
            platinum: credited.pp,
          })
          .where(eq(characters.id, toCharacterId))
          .run();
      })();

      // Un événement par personnage (v2 : action 'coins' réveille le journal
      // de bourse, actorUserId obligatoire pour la suppression d'écho).
      bus.emitChange({
        type: 'character:change',
        partyId: fromChar.party_id,
        characterId: fromCharId,
        action: 'coins',
        actorUserId: userId,
      });
      bus.emitChange({
        type: 'character:change',
        partyId: toChar.party_id,
        characterId: toCharacterId,
        action: 'coins',
        actorUserId: userId,
      });

      return reply.code(200).send({
        from: { characterId: fromCharId, purse: spend.purse },
        to: { characterId: toCharacterId, purse: credited },
        breaks: spend.breaks,
      });
    },
  );
}
