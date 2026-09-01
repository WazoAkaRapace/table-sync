/**
 * Party routes: create, list, detail, join, update.
 */

import type {
  CreatePartyPayload,
  EncumbranceMode,
  JoinPartyPayload,
  PartyRole,
} from '@table-sync/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { characters, parties, partyBans, partyMembers, users } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  attachCharacterClasses,
  generateInviteCode,
  isPartyGM,
  isPartyMember,
  mapCharacterSummary,
  requireUser,
} from './helpers.ts';
import { apiMsg } from './messages.ts';

export async function partyRoutes(app: FastifyInstance) {
  // ---------- List my parties ----------
  app.get('/parties', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = requireUser(req, reply);
    if (userId === null) return;
    const drizzle = getDrizzle();
    const rows = drizzle
      .select({
        ...cols(parties),
        role: partyMembers.role,
        gm_name: users.displayName,
        // Table-qualified outer reference by hand: drizzle renders
        // ${parties.id} as bare "id" in select fields — it resolves outward
        // only because party_members has no id column. Don't rely on that.
        member_count: sql<number>`(SELECT COUNT(*) FROM party_members x WHERE x.party_id = parties.id)`,
      })
      .from(parties)
      .innerJoin(
        partyMembers,
        and(eq(partyMembers.partyId, parties.id), eq(partyMembers.userId, userId)),
      )
      .leftJoin(users, eq(users.id, parties.gmUserId))
      // The register pins the LAST OPENED party first (per member —
      // party_members.last_opened_at). Never-opened parties fall back to
      // creation order. Hand-qualified: users is joined and a bare
      // "created_at" would be ambiguous.
      .orderBy(
        sql`COALESCE(party_members.last_opened_at, parties.created_at) DESC`,
        desc(parties.createdAt),
        desc(parties.id),
      )
      .all();
    // Roster names for the register's current entry — parties are few, one batched query.
    // The register writes ACTIVE characters only: hidden (secret prep) sheets
    // stay out of the names AND the count for everyone — the party page and
    // the GM dashboard carry them, with their « Caché » marker.
    const partyIds: number[] = rows.map((r: any) => r.id);
    const rosterByParty = new Map<number, string[]>();
    if (partyIds.length > 0) {
      const nameRows = drizzle
        .select({
          party_id: characters.partyId,
          name: characters.name,
          hidden: characters.hidden,
        })
        .from(characters)
        .where(inArray(characters.partyId, partyIds))
        .orderBy(sql`${characters.name} COLLATE NOCASE ASC`)
        .all() as any[];
      for (const nr of nameRows) {
        if (nr.hidden) continue;
        const list = rosterByParty.get(nr.party_id) ?? [];
        list.push(nr.name);
        rosterByParty.set(nr.party_id, list);
      }
    }
    return reply.send({
      parties: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        gmUserId: r.gm_user_id,
        gmName: r.gm_name,
        inviteCode: r.invite_code,
        encumbranceMode: r.encumbrance_mode,
        playersCreateItems: !!r.players_create_items,
        role: r.role,
        createdAt: r.created_at,
        memberCount: r.member_count,
        characterCount: rosterByParty.get(r.id)?.length ?? 0,
        characterNames: rosterByParty.get(r.id) ?? [],
      })),
    });
  });

  // ---------- Create party (creator becomes GM) ----------
  app.post(
    '/parties',
    async (req: FastifyRequest<{ Body: CreatePartyPayload }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const { name, encumbranceMode } = req.body || { name: '', encumbranceMode: 'variant' };
      if (!name?.trim()) return reply.code(400).send({ error: apiMsg(req, 'name is required') });
      const mode = (
        ['variant', 'standard', 'slots'].includes(encumbranceMode) ? encumbranceMode : 'variant'
      ) as EncumbranceMode;

      const drizzle = getDrizzle();
      const code = generateInviteCode();
      const partyId = getDb().transaction(() => {
        const { id } = drizzle
          .insert(parties)
          .values({ name: name.trim(), gmUserId: userId, inviteCode: code, encumbranceMode: mode })
          .returning({ id: parties.id })
          .get();
        drizzle.insert(partyMembers).values({ partyId: id, userId, role: 'gm' }).run();
        return id;
      })();
      const row = drizzle
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.id, partyId))
        .get() as any;
      return reply.code(201).send({
        party: {
          id: row.id,
          name: row.name,
          gmUserId: row.gm_user_id,
          inviteCode: row.invite_code,
          encumbranceMode: row.encumbrance_mode,
          playersCreateItems: !!row.players_create_items,
          createdAt: row.created_at,
        },
      });
    },
  );

  // ---------- Party detail ----------
  app.get(
    '/parties/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const drizzle = getDrizzle();
      const party = drizzle
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.id, partyId))
        .get() as any;
      if (!party) return reply.code(404).send({ error: apiMsg(req, 'party not found') });

      const members = drizzle
        .select({
          ...cols(partyMembers),
          username: users.username,
          display_name: users.displayName,
        })
        .from(partyMembers)
        .innerJoin(users, eq(users.id, partyMembers.userId))
        .where(eq(partyMembers.partyId, partyId))
        .orderBy(desc(partyMembers.role), partyMembers.joinedAt)
        .all();
      const banned = drizzle
        .select({ ...cols(partyBans), username: users.username, display_name: users.displayName })
        .from(partyBans)
        .innerJoin(users, eq(users.id, partyBans.userId))
        .where(eq(partyBans.partyId, partyId))
        .orderBy(partyBans.bannedAt)
        .all();
      const charactersAll = drizzle
        .select({ ...cols(characters), owner_name: users.displayName })
        .from(characters)
        .innerJoin(users, eq(users.id, characters.ownerId))
        .where(eq(characters.partyId, partyId))
        .orderBy(sql`${characters.name} COLLATE NOCASE ASC`)
        .all() as any[];
      // Hidden (secret prep) characters stay out of other players' views —
      // the owner and the GM (from the members rows above) still see them.
      const callerIsGM = members.some((m: any) => m.user_id === userId && m.role === 'gm');
      const visibleCharacters = charactersAll.filter(
        (c: any) => !c.hidden || c.owner_id === userId || callerIsGM,
      );

      attachCharacterClasses(visibleCharacters);
      return reply.send({
        party: {
          id: party.id,
          name: party.name,
          gmUserId: party.gm_user_id,
          inviteCode: party.invite_code,
          encumbranceMode: party.encumbrance_mode,
          playersCreateItems: !!party.players_create_items,
          createdAt: party.created_at,
        },
        members: members.map((m: any) => ({
          userId: m.user_id,
          username: m.username,
          displayName: m.display_name,
          role: m.role as PartyRole,
          joinedAt: m.joined_at,
        })),
        banned: banned.map((b: any) => ({
          userId: b.user_id,
          username: b.username,
          displayName: b.display_name,
          bannedAt: b.banned_at,
        })),
        characters: visibleCharacters.map(mapCharacterSummary),
      });
    },
  );

  // ---------- Record a party open (member) ----------
  // Fired by the web app whenever the user enters a /party/:id route.
  // Per-member register ordering only — no WS fan-out (nobody else's
  // view changes because I opened my table).
  app.post(
    '/parties/:id/open',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const drizzle = getDrizzle();
      drizzle
        .update(partyMembers)
        .set({ lastOpenedAt: sql`datetime('now')` })
        .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, userId)))
        .run();
      return reply.send({ ok: true });
    },
  );

  // ---------- Join party via invite code ----------
  app.post(
    '/parties/join',

    async (req: FastifyRequest<{ Body: JoinPartyPayload }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const { inviteCode } = req.body || {};
      if (!inviteCode)
        return reply.code(400).send({ error: apiMsg(req, 'inviteCode is required') });

      const drizzle = getDrizzle();
      const party = drizzle
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.inviteCode, String(inviteCode).toUpperCase()))
        .get() as any;
      if (!party) return reply.code(404).send({ error: apiMsg(req, 'invalid invite code') });

      const banned = drizzle
        .select({ one: sql`1` })
        .from(partyBans)
        .where(and(eq(partyBans.partyId, party.id), eq(partyBans.userId, userId)))
        .get();
      if (banned) return reply.code(403).send({ error: apiMsg(req, 'banned from this party') });

      const already = drizzle
        .select({ one: sql`1` })
        .from(partyMembers)
        .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.userId, userId)))
        .get();
      if (already)
        return reply.code(409).send({ error: apiMsg(req, 'already a member'), partyId: party.id });

      // Joining counts as an open — the fresh table leads the register.
      drizzle
        .insert(partyMembers)
        .values({ partyId: party.id, userId, role: 'player', lastOpenedAt: sql`datetime('now')` })
        .run();

      bus.emitChange({
        type: 'party:change',
        partyId: party.id,
        action: 'join',
        actorUserId: userId,
      });
      return reply.code(201).send({ partyId: party.id });
    },
  );

  // ---------- Remove a member (GM only) — door stays open, invite code works ----------
  app.delete(
    '/parties/:id/members/:userId',
    async (req: FastifyRequest<{ Params: { id: string; userId: string } }>, reply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);
      const targetId = Number(req.params.userId);
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'GM only') });

      const drizzle = getDrizzle();
      const target = drizzle
        .select(cols(partyMembers))
        .from(partyMembers)
        .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, targetId)))
        .get() as any;
      if (!target) return reply.code(404).send({ error: apiMsg(req, 'member not found') });
      if (target.role === 'gm')
        return reply.code(403).send({ error: apiMsg(req, 'cannot remove the GM') });

      drizzle
        .delete(partyMembers)
        .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, targetId)))
        .run();
      // Characters stay in the party — the sheet survives, only the seat is freed.
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'remove',
        actorUserId: userId,
        targetUserId: targetId,
      });
      return reply.send({ ok: true });
    },
  );

  // ---------- Ban a member (GM only) — seat freed AND the invite code is locked for them ----------
  app.post(
    '/parties/:id/bans',
    async (req: FastifyRequest<{ Params: { id: string }; Body: { userId?: number } }>, reply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);
      const targetId = Number(req.body?.userId);
      if (!targetId) return reply.code(400).send({ error: apiMsg(req, 'userId is required') });
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'GM only') });

      const drizzle = getDrizzle();
      const target = drizzle
        .select(cols(partyMembers))
        .from(partyMembers)
        .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, targetId)))
        .get() as any;
      if (!target) return reply.code(404).send({ error: apiMsg(req, 'member not found') });
      if (target.role === 'gm')
        return reply.code(403).send({ error: apiMsg(req, 'cannot ban the GM') });

      getDb().transaction(() => {
        drizzle
          .delete(partyMembers)
          .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, targetId)))
          .run();
        drizzle
          .insert(partyBans)
          .values({ partyId, userId: targetId, bannedAt: sql`datetime('now')` })
          .onConflictDoUpdate({
            target: [partyBans.partyId, partyBans.userId],
            set: { bannedAt: sql`datetime('now')` },
          })
          .run();
      })();
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'ban',
        actorUserId: userId,
        targetUserId: targetId,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  // ---------- Unban (GM only) — the invite code works again, no auto re-seat ----------
  app.delete(
    '/parties/:id/bans/:userId',
    async (req: FastifyRequest<{ Params: { id: string; userId: string } }>, reply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);
      const targetId = Number(req.params.userId);
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'GM only') });

      const drizzle = getDrizzle();
      const info = drizzle
        .delete(partyBans)
        .where(and(eq(partyBans.partyId, partyId), eq(partyBans.userId, targetId)))
        .run();
      if (info.changes === 0) return reply.code(404).send({ error: apiMsg(req, 'not banned') });

      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'unban',
        actorUserId: userId,
        targetUserId: targetId,
      });
      return reply.send({ ok: true });
    },
  );

  // ---------- Update party (GM only) ----------
  app.patch(
    '/parties/:id',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: {
          name?: string;
          encumbranceMode?: EncumbranceMode;
          playersCreateItems?: boolean;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'GM only') });

      const { name, encumbranceMode, playersCreateItems } = req.body || {};
      const drizzle = getDrizzle();
      if (name !== undefined) {
        if (!name.trim())
          return reply.code(400).send({ error: apiMsg(req, 'name cannot be empty') });
        drizzle.update(parties).set({ name: name.trim() }).where(eq(parties.id, partyId)).run();
      }
      if (encumbranceMode !== undefined) {
        if (!['variant', 'standard', 'slots'].includes(encumbranceMode)) {
          return reply.code(400).send({ error: apiMsg(req, 'invalid encumbranceMode') });
        }
        drizzle.update(parties).set({ encumbranceMode }).where(eq(parties.id, partyId)).run();
      }
      if (playersCreateItems !== undefined) {
        if (typeof playersCreateItems !== 'boolean') {
          return reply
            .code(400)
            .send({ error: apiMsg(req, 'playersCreateItems must be a boolean') });
        }
        drizzle
          .update(parties)
          .set({ playersCreateItems: playersCreateItems ? 1 : 0 })
          .where(eq(parties.id, partyId))
          .run();
      }
      const row = drizzle
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.id, partyId))
        .get() as any;
      bus.emitChange({ type: 'party:change', partyId, action: 'stats', actorUserId: userId });
      return reply.send({
        party: {
          id: row.id,
          name: row.name,
          gmUserId: row.gm_user_id,
          inviteCode: row.invite_code,
          encumbranceMode: row.encumbrance_mode,
          playersCreateItems: !!row.players_create_items,
          createdAt: row.created_at,
        },
      });
    },
  );

  // ---------- Disband party (GM only) — deletes EVERYTHING ----------
  // One DELETE cascades through every party-scoped table (foreign_keys=ON):
  // members, bans, characters (+ classes/spells/features/notes/inventory/
  // locations), transactions, PNJ, encounters (+ combatants) and the party's
  // custom items. Global SRD items (party_id NULL) are untouched.
  app.delete(
    '/parties/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.id);

      const drizzle = getDrizzle();
      const party = drizzle
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.id, partyId))
        .get() as any;
      if (!party) return reply.code(404).send({ error: apiMsg(req, 'party not found') });
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'GM only') });

      drizzle.delete(parties).where(eq(parties.id, partyId)).run();

      // 'disband' — ws.ts delivers on PRE-refresh membership (the cascade
      // already emptied party_members, so the usual member gate would skip
      // everyone) and every member's tab leaves the dead party's pages.
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'disband',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
