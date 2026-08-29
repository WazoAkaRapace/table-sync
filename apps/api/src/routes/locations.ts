/**
 * Storage locations routes: CRUD for mounts, containers, and carried.
 * Each character gets a default "carried" location on creation.
 */

import type { CreateStorageLocationPayload } from '@table-sync/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { characters, inventory, storageLocations } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { characterVisibleTo, isOwnerOrGM, isPartyMember, requireUser } from './helpers.ts';
import { apiMsg } from './messages.ts';

/**
 * Ensure a character has a default "carried" location. Returns its ID.
 * Queries through Drizzle on the shared connection — inside a native
 * better-sqlite3 transaction it joins that transaction like any raw statement.
 */
export function ensureCarriedLocation(characterId: number): number {
  const drizzle = getDrizzle();
  const existing = drizzle
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(and(eq(storageLocations.characterId, characterId), eq(storageLocations.type, 'carried')))
    .get();
  if (existing) return existing.id;

  const { id } = drizzle
    .insert(storageLocations)
    .values({ characterId, name: 'Sur moi', type: 'carried', sortOrder: 0 })
    .returning({ id: storageLocations.id })
    .get();
  return id;
}

function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

function mapLocation(r: any) {
  return {
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
  };
}

export async function locationRoutes(app: FastifyInstance) {
  // ---------- List locations for a character ----------
  app.get(
    '/characters/:id/locations',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      // Hidden character: 404 for everyone but its owner and the GM
      if (!characterVisibleTo(char, userId))
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });

      // Ensure carried exists
      ensureCarriedLocation(char.id);

      const rows = drizzle
        .select(cols(storageLocations))
        .from(storageLocations)
        .where(eq(storageLocations.characterId, char.id))
        .orderBy(storageLocations.sortOrder, storageLocations.type, storageLocations.id)
        .all();

      return reply.send({ locations: rows.map(mapLocation) });
    },
  );

  // ---------- Create a storage location ----------
  app.post(
    '/characters/:id/locations',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: CreateStorageLocationPayload }>,
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

      const body = req.body || ({} as CreateStorageLocationPayload);
      if (!body.name?.trim())
        return reply.code(400).send({ error: apiMsg(req, 'name is required') });

      const maxOrder =
        (
          drizzle
            .select({ m: sql<number | null>`max(${storageLocations.sortOrder})` })
            .from(storageLocations)
            .where(eq(storageLocations.characterId, char.id))
            .get() as any
        )?.m ?? 0;

      const row = drizzle
        .insert(storageLocations)
        .values({
          characterId: char.id,
          name: body.name.trim(),
          type: body.type || 'mount',
          strength: body.strength ?? null,
          multiplier: body.multiplier ?? 1,
          capacityKg: body.capacityKg ?? null,
          ownWeightKg: body.ownWeightKg ?? 0,
          itemId: body.itemId ?? null,
          sortOrder: maxOrder + 1,
        })
        .returning(cols(storageLocations))
        .get() as any;

      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
      });

      return reply.code(201).send({ location: mapLocation(row) });
    },
  );

  // ---------- Delete a storage location ----------
  app.delete(
    '/locations/:locId',
    async (req: FastifyRequest<{ Params: { locId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const loc = drizzle
        .select(cols(storageLocations))
        .from(storageLocations)
        .where(eq(storageLocations.id, Number(req.params.locId)))
        .get() as any;
      if (!loc) return reply.code(404).send({ error: apiMsg(req, 'location not found') });

      // Don't allow deleting the carried location
      if (loc.type === 'carried')
        return reply.code(400).send({ error: apiMsg(req, 'cannot delete carried location') });

      const char = getCharacter(drizzle, loc.character_id);
      if (!isOwnerOrGM(char, userId))
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });

      // Move items back to carried (merge with existing entries to avoid UNIQUE constraint).
      // One transaction: merge/move every entry, then drop the location — a
      // mid-failure must not leave items pointing at a deleted (or
      // half-emptied) storage location.
      const db = getDb();
      db.transaction(() => {
        const carriedId = ensureCarriedLocation(char.id);

        // For each item on this location, either add to existing carried
        // entry or move it
        const itemsToMove = drizzle
          .select({
            id: inventory.id,
            item_id: inventory.itemId,
            quantity: inventory.quantity,
            equipped: inventory.equipped,
            notes: inventory.notes,
          })
          .from(inventory)
          .where(eq(inventory.storageLocationId, loc.id))
          .all();

        for (const item of itemsToMove) {
          const existing = drizzle
            .select({ id: inventory.id, quantity: inventory.quantity })
            .from(inventory)
            .where(
              and(
                eq(inventory.characterId, char.id),
                eq(inventory.itemId, item.item_id),
                eq(inventory.storageLocationId, carriedId),
              ),
            )
            .get();

          if (existing) {
            // Merge: add quantity to existing entry, delete the moving one
            drizzle
              .update(inventory)
              .set({ quantity: sql`${inventory.quantity} + ${item.quantity}` })
              .where(eq(inventory.id, existing.id))
              .run();
            drizzle.delete(inventory).where(eq(inventory.id, item.id)).run();
          } else {
            // Just move it
            drizzle
              .update(inventory)
              .set({ storageLocationId: carriedId })
              .where(eq(inventory.id, item.id))
              .run();
          }
        }

        drizzle.delete(storageLocations).where(eq(storageLocations.id, loc.id)).run();
      })();

      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
      });

      return reply.code(204).send();
    },
  );
}
