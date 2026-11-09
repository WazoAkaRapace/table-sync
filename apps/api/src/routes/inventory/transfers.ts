/**
 * Transferts entre personnages — objet (fusion dans le porté du receveur)
 * et bourse (#160 : spendCoins chez le donneur, gainCoins chez le
 * receveur). Découpage 2026-11 (phase 4) : déplacement pur depuis
 * routes/inventory.ts.
 */

import {
  type CoinAmounts,
  coinsTotalCp,
  EMPTY_COINS,
  gainCoins,
  spendCoins,
  type TransferPayload,
} from '@table-sync/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { characters, inventory } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { mirrorAcToCombatants } from '../character-spell-effects.ts';
import { requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
import { itemDisplayName, logTransaction, resolveTransferChars } from './shared.ts';

export async function transfersRoutes(app: FastifyInstance) {
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
      const pair = resolveTransferChars(req, reply, drizzle, userId, fromCharId, toCharacterId);
      if (pair === null) return;
      const { fromChar, toChar } = pair;

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
      const { ensureCarriedLocation } = await import('../locations.ts');
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
      const pair = resolveTransferChars(req, reply, drizzle, userId, fromCharId, toCharacterId);
      if (pair === null) return;
      const { fromChar, toChar } = pair;

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
