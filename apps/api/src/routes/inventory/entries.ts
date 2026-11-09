/**
 * Ajustement d'entrées d'inventaire — modification (quantité, équipé,
 * notes) et déplacement d'emplacement avec fusion à l'arrivée (la
 * destination SOMME ses quantités), suppression. Découpage 2026-11
 * (phase 4) : déplacement pur depuis routes/inventory.ts.
 */

import { type PatchInventoryPayload } from '@table-sync/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { inventory, items, storageLocations } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { mirrorAcToCombatants } from '../character-spell-effects.ts';
import { mapInventoryEntry } from '../lib/mappers.ts';
import { langFromReq } from '../lang.ts';
import { apiMsg } from '../messages.ts';
import {
  getEntryWithItem,
  getInvEntryForEditor,
  INVENTORY_WITH_ITEM,
  itemDisplayName,
  logTransaction,
} from './shared.ts';

export async function entriesRoutes(app: FastifyInstance) {
  // ---------- Update inventory entry (quantity, equipped, notes) ----------
  app.patch(
    '/inventory/:invId',
    async (
      req: FastifyRequest<{ Params: { invId: string }; Body: PatchInventoryPayload }>,
      reply: FastifyReply,
    ) => {
      const ctx = getInvEntryForEditor(req, reply, Number(req.params.invId));
      if (ctx === null) return;
      const { userId, inv, char } = ctx;
      const drizzle = getDrizzle();

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
      const ctx = getInvEntryForEditor(req, reply, Number(req.params.invId));
      if (ctx === null) return;
      const { userId, inv, char } = ctx;
      const drizzle = getDrizzle();

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
}
