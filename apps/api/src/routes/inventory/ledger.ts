/**
 * Journal des transactions d'un groupe — lecture GM, cache ETag (le tableau
 * MD rafraîchit à chaque inventory:change). Découpage 2026-11 (phase 4) :
 * déplacement pur depuis routes/inventory.ts.
 */

import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { transactions, users } from '../../db/schema.ts';
import { isPartyGM, requireUser } from '../lib/membership.ts';
import { sendCachedJson } from '../httpCache.ts';
import { apiMsg } from '../messages.ts';

export async function ledgerRoutes(app: FastifyInstance) {
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
}
