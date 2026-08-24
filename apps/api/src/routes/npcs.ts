/**
 * NPC routes: CRUD with party-level sharing + private visibility.
 * Any party member can create NPCs. Creator chooses shared/private.
 * Secrets are visible only to creator + GM.
 */

import type { CreateNpcPayload, PatchNpcPayload } from '@table-sync/shared';
import { and, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { npcs, users } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { isPartyGM, isPartyMember, requireUser } from './helpers.ts';

export interface NpcRow {
  id: number;
  partyId: number;
  createdBy: number;
  createdByName: string;
  name: string;
  role: string | null;
  location: string | null;
  faction: string | null;
  disposition: string;
  status: string;
  description: string | null;
  secret: string | null;
  isShared: boolean;
  sortOrder: number;
}

/** npcs.* + the creator's display_name (JOIN users) — the shape mapNpc reads. */
const NPC_WITH_CREATOR = { ...cols(npcs), creator_name: users.displayName };

function mapNpc(row: any, includeSecret: boolean): NpcRow {
  return {
    id: row.id,
    partyId: row.party_id,
    createdBy: row.created_by,
    createdByName: row.creator_name ?? '',
    name: row.name,
    role: row.role,
    location: row.location,
    faction: row.faction,
    disposition: row.disposition,
    status: row.status,
    description: row.description,
    secret: includeSecret ? row.secret || null : null,
    isShared: !!row.is_shared,
    sortOrder: row.sort_order ?? 0,
  };
}

/** NPC by id with creator name — used by PATCH/DELETE to resolve ownership. */
function getNpcWithCreator(drizzle: ReturnType<typeof getDrizzle>, npcId: number): any {
  return drizzle
    .select(NPC_WITH_CREATOR)
    .from(npcs)
    .innerJoin(users, eq(npcs.createdBy, users.id))
    .where(eq(npcs.id, npcId))
    .get();
}

export async function npcRoutes(app: FastifyInstance) {
  // ---------- List NPCs visible to the requesting user ----------
  app.get(
    '/parties/:partyId/npcs',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) return reply.code(403).send({ error: 'not a member' });

      const gm = isPartyGM(partyId, userId);
      const drizzle = getDrizzle();

      // GM sees all; players see shared + their own private
      const visibility = gm
        ? eq(npcs.partyId, partyId)
        : and(eq(npcs.partyId, partyId), or(eq(npcs.isShared, 1), eq(npcs.createdBy, userId)));

      const rows = drizzle
        .select(NPC_WITH_CREATOR)
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(visibility)
        .orderBy(npcs.sortOrder, sql`${npcs.name} COLLATE NOCASE ASC`)
        .all();

      const npcsOut = rows.map((r: any) => {
        // Secret visible to creator + GM
        const canSeeSecret = gm || r.created_by === userId;
        return mapNpc(r, canSeeSecret);
      });

      return reply.send({ npcs: npcsOut });
    },
  );

  // ---------- Create NPC ----------
  app.post(
    '/parties/:partyId/npcs',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateNpcPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) return reply.code(403).send({ error: 'not a member' });

      const body = req.body || ({} as CreateNpcPayload);
      if (!body.name?.trim()) return reply.code(400).send({ error: 'name is required' });

      const drizzle = getDrizzle();
      const maxOrder =
        (
          drizzle
            .select({ m: sql<number | null>`max(${npcs.sortOrder})` })
            .from(npcs)
            .where(eq(npcs.partyId, partyId))
            .get() as any
        )?.m ?? 0;

      const { id } = drizzle
        .insert(npcs)
        .values({
          partyId,
          createdBy: userId,
          name: body.name.trim(),
          role: body.role || null,
          location: body.location || null,
          faction: body.faction || null,
          disposition: body.disposition || 'neutral',
          status: body.status || 'alive',
          description: body.description || null,
          secret: body.secret || null,
          isShared: body.isShared === false ? 0 : 1,
          sortOrder: maxOrder + 1,
        })
        .returning({ id: npcs.id })
        .get();

      const row = getNpcWithCreator(drizzle, id);

      bus.emitChange({ type: 'party:change', partyId, action: 'custom-item', actorUserId: userId });

      return reply.code(201).send({ npc: mapNpc(row, true) });
    },
  );

  // ---------- Update NPC (creator or GM) ----------
  app.patch(
    '/npcs/:npcId',
    async (
      req: FastifyRequest<{ Params: { npcId: string }; Body: PatchNpcPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const npc = drizzle
        .select(cols(npcs))
        .from(npcs)
        .where(eq(npcs.id, Number(req.params.npcId)))
        .get() as any;
      if (!npc) return reply.code(404).send({ error: 'NPC not found' });

      const gm = isPartyGM(npc.party_id, userId);
      if (npc.created_by !== userId && !gm) {
        return reply.code(403).send({ error: 'only the creator or GM can edit' });
      }

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      const editable: Array<[keyof PatchNpcPayload, keyof typeof npcs.$inferInsert]> = [
        ['name', 'name'],
        ['role', 'role'],
        ['location', 'location'],
        ['faction', 'faction'],
        ['disposition', 'disposition'],
        ['status', 'status'],
        ['description', 'description'],
        ['secret', 'secret'],
      ];
      for (const [key, column] of editable) {
        const val = (body as Record<string, unknown>)[key];
        if (val === undefined) continue;
        values[column] = val;
      }
      if (body.isShared !== undefined) {
        values.isShared = body.isShared ? 1 : 0;
      }

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: 'no fields to update' });
      }
      drizzle.update(npcs).set(values).where(eq(npcs.id, npc.id)).run();

      const row = getNpcWithCreator(drizzle, npc.id);

      bus.emitChange({
        type: 'party:change',
        partyId: npc.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });

      return reply.send({ npc: mapNpc(row, gm || row.created_by === userId) });
    },
  );

  // ---------- Delete NPC (creator or GM) ----------
  app.delete(
    '/npcs/:npcId',
    async (req: FastifyRequest<{ Params: { npcId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const npc = drizzle
        .select(cols(npcs))
        .from(npcs)
        .where(eq(npcs.id, Number(req.params.npcId)))
        .get() as any;
      if (!npc) return reply.code(404).send({ error: 'NPC not found' });

      const gm = isPartyGM(npc.party_id, userId);
      if (npc.created_by !== userId && !gm) {
        return reply.code(403).send({ error: 'only the creator or GM can delete' });
      }

      drizzle.delete(npcs).where(eq(npcs.id, npc.id)).run();
      bus.emitChange({
        type: 'party:change',
        partyId: npc.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });

      return reply.code(204).send();
    },
  );
}
