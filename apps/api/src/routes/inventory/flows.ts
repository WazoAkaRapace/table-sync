/**
 * Flux d'unités d'inventaire — ajout d'objets (les lots de munitions #143
 * créditent la munition UNITAIRE taggée), consommation de survie (rations,
 * gourdes, munitions #143 : l'arme équipée désigne son type) et
 * remplissage des gourdes. Découpage 2026-11 (phase 4) : déplacement pur
 * depuis routes/inventory.ts.
 */

import { type AddInventoryPayload, AMMO_PACKS, WEAPON_AMMUNITION } from '@table-sync/shared';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { characters, inventory, items } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { mirrorAcToCombatants } from '../character-spell-effects.ts';
import { isOwnerOrGM, mapInventoryEntry, requireUser } from '../helpers.ts';
import { langFromReq } from '../lang.ts';
import { apiMsg } from '../messages.ts';
import {
  getCharacter,
  getEntryWithItem,
  INVENTORY_WITH_ITEM,
  type EntryChange,
  itemDisplayName,
  logTransaction,
} from './shared.ts';

/** #143 : genres de munitions consommables — tags de survie posés par le seed,
 * valeurs de WEAPON_AMMUNITION (shared) : l'arme équipée désigne SON type. */
const AMMO_KINDS = [...new Set(Object.values(WEAPON_AMMUNITION))];

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

export async function flowsRoutes(app: FastifyInstance) {
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
      const { ensureCarriedLocation } = await import('../locations.ts');
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

  // ---------- Consume food/water from inventory (resets deprivation) ----------
  app.post(
    '/characters/:id/consume',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { type: 'food' | 'water' | 'ammo'; ammo?: string };
      }>,
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
      if (type === 'ammo' && !AMMO_KINDS.includes(ammoKind ?? ''))
        return reply.code(400).send({
          error: apiMsg(req, `ammo kind must be one of: ${AMMO_KINDS.join(', ')}`),
        });
      // Garde ci-dessus : pour type 'ammo', ammoKind est validé (donc défini)
      const tag = type === 'ammo' ? ammoKind! : type;

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

      const { ensureCarriedLocation } = await import('../locations.ts');
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
}
