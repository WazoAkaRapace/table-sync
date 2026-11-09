/**
 * Transfert de conteneur (#161) — le conteneur change de personnage AVEC
 * son contenu ; l'objet conteneur lui-même suit le chemin de POST
 * /transfer. Découpage 2026-11 (phase 4) : déplacement pur depuis
 * routes/inventory.ts.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { inventory, storageLocations } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { mirrorAcToCombatants } from '../character-spell-effects.ts';
import { requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
import { logTransaction, resolveTransferChars } from './shared.ts';

export async function containersRoutes(app: FastifyInstance) {
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
      const pair = resolveTransferChars(
        req,
        reply,
        drizzle,
        userId,
        fromCharId,
        Number(toCharacterId),
      );
      if (pair === null) return;
      const { fromChar, toChar } = pair;

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
          const { ensureCarriedLocation } = await import('../locations.ts');
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
}
