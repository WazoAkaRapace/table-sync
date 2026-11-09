/**
 * Helpers d'inventaire partagés — projection entrée+objet (colonnes i_*),
 * lecture d'entrée, nom d'affichage d'un objet, personnage et journal des
 * transactions. Découpage 2026-11 (phase 4) : déplacement pur depuis
 * routes/inventory.ts, exportés depuis leur propriétaire pour les
 * sous-modules de routes/inventory/.
 */

import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { characters, inventory, items, transactions } from '../../db/schema.ts';
import { isOwnerOrGM, requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';

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
  i_two_handed_dice: items.twoHandedDice,
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
export function getEntryWithItem(invId: number): any {
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
export type EntryChange = { entry?: any; removedId?: number };

/** French display name of an item ('item' fallback), for the transaction log. */
export function itemDisplayName(itemId: number): { name: string; nameFr: string | null } {
  const row = getDrizzle()
    .select({ name: sql<string>`COALESCE(${items.nameFr}, ${items.name})`, name_fr: items.nameFr })
    .from(items)
    .where(eq(items.id, itemId))
    .get() as any;
  return { name: row?.name ?? 'item', nameFr: row?.name_fr ?? null };
}

export function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

/**
 * Porte « entrée d'inventaire + éditeur » (PATCH/DELETE /inventory/:invId) :
 * requireUser, 404 « inventory entry not found », puis owner/MD requis
 * (403 « only the owner or GM can edit this inventory »). Renvoie null après
 * avoir envoyé la réponse — l'appelant fait `return`.
 */
export function getInvEntryForEditor(
  req: FastifyRequest,
  reply: FastifyReply,
  invId: number,
): { userId: number; inv: any; char: any } | null {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const drizzle = getDrizzle();
  const inv = drizzle
    .select(cols(inventory))
    .from(inventory)
    .where(eq(inventory.id, invId))
    .get() as any;
  if (!inv) {
    reply.code(404).send({ error: apiMsg(req, 'inventory entry not found') });
    return null;
  }
  const char = getCharacter(drizzle, inv.character_id);
  if (!isOwnerOrGM(char, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });
    return null;
  }
  return { userId, inv, char };
}

/**
 * Porte « transfert entre deux fiches » (transfer objet, pièces, conteneur) :
 * 404 « character not found », 400 « characters must be in the same party »,
 * puis owner/MD requis sur la fiche SOURCE (403 « …transfer from this
 * character »). Renvoie null après avoir envoyé la réponse.
 */
export function resolveTransferChars(
  req: FastifyRequest,
  reply: FastifyReply,
  drizzle: ReturnType<typeof getDrizzle>,
  userId: number,
  fromCharId: number,
  toCharacterId: number,
): { fromChar: any; toChar: any } | null {
  const fromChar = getCharacter(drizzle, fromCharId);
  const toChar = getCharacter(drizzle, Number(toCharacterId));
  if (!fromChar || !toChar) {
    reply.code(404).send({ error: apiMsg(req, 'character not found') });
    return null;
  }
  if (fromChar.party_id !== toChar.party_id) {
    reply.code(400).send({ error: apiMsg(req, 'characters must be in the same party') });
    return null;
  }
  if (!isOwnerOrGM(fromChar, userId)) {
    reply
      .code(403)
      .send({ error: apiMsg(req, 'only the owner or GM can transfer from this character') });
    return null;
  }
  return { fromChar, toChar };
}

export function logTransaction(
  drizzle: ReturnType<typeof getDrizzle>,
  values: typeof transactions.$inferInsert,
): void {
  drizzle.insert(transactions).values(values).run();
}
