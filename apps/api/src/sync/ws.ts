/**
 * WebSocket route for real-time sync.
 *
 * Clients connect to /ws?token=<JWT> and receive push notifications
 * when inventory/character/party data changes in any party they're a member of.
 *
 * The event bus (bus.ts) emits after mutations; this module fans out
 * to connected clients whose user is a member of the affected party.
 *
 * Echo suppression: the actor who triggered the change is NOT sent the
 * event (they already have the optimistic update from their own mutation).
 */

import type { WebSocket } from '@fastify/websocket';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { characters, partyMembers } from '../db/schema.ts';
import { bus, type SyncEvent } from './bus.ts';

interface ClientInfo {
  userId: number;
  ws: WebSocket;
  partyIds: Set<number>; // cached at connection time
}

// All connected clients
const clients = new Set<ClientInfo>();

/** Get all party IDs a user belongs to (queried once at connection time). */
function getUserPartyIds(userId: number): Set<number> {
  const rows = getDrizzle()
    .select({ party_id: partyMembers.partyId })
    .from(partyMembers)
    .where(eq(partyMembers.userId, userId))
    .all();
  return new Set(rows.map((r) => r.party_id));
}

export async function registerWsRoutes(app: FastifyInstance) {
  // In @fastify/websocket v11, the handler receives (socket, req) — socket IS the WebSocket
  app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    // Prefer the Sec-WebSocket-Protocol header (keeps tokens out of URLs/proxy logs);
    // the ?token= query param still works for older clients.
    const token = (req.headers['sec-websocket-protocol'] as string) || (req.query as any)?.token;
    let userId: number | null = null;

    if (token) {
      try {
        const payload = app.jwt.verify(token) as any;
        userId = payload.sub;
      } catch {
        socket.close(4001, 'Invalid token');
        return;
      }
    }

    if (!userId) {
      socket.close(4001, 'No token');
      return;
    }

    const clientInfo: ClientInfo = {
      userId,
      ws: socket,
      partyIds: getUserPartyIds(userId), // cache once, no per-event DB queries
    };
    clients.add(clientInfo);

    socket.on('close', () => {
      clients.delete(clientInfo);
    });

    // Send a confirmation message
    socket.send(JSON.stringify({ type: 'connected', userId }));
  });

  // Listen to the event bus and fan out to relevant clients
  bus.on('change', (event: SyncEvent) => {
    const message = JSON.stringify(event);
    // Secret correspondence: user-targeted delivery, full stop. The general
    // fan-out below must NOT run — even the event's shape (which character
    // just got a message) would leak activity to the rest of the table.
    if (event.type === 'message:new') {
      const target = event.targetUserId;
      if (target === undefined) return;
      for (const client of clients) {
        if (client.userId !== target || client.ws.readyState !== 1) continue;
        try {
          client.ws.send(message);
        } catch {
          clients.delete(client);
        }
      }
      return;
    }
    // Targeted delivery: a removed/banned user is no longer a member at fan-out
    // time, so the membership gate below would skip their open tabs. They must
    // still hear the event — their PartyPage flips to "no longer at the table".
    if (event.targetUserId !== undefined) {
      for (const client of clients) {
        if (client.userId !== event.targetUserId || client.ws.readyState !== 1) continue;
        try {
          client.ws.send(message);
        } catch {
          clients.delete(client);
        }
      }
    }
    // Membership may have changed (join/leave) — refresh the cached party sets
    if (event.type === 'party:change') {
      // Party dissolution: the DB cascade already emptied party_members, so
      // the refresh below would empty every member's cached set BEFORE the
      // fan-out gate could match. Snapshot the pre-refresh members so their
      // open tabs still hear 'disband' and leave the dead party's pages.
      const disbandRecipients = new Set<ClientInfo>();
      if (event.action === 'disband') {
        for (const client of clients) {
          if (client.partyIds.has(event.partyId)) disbandRecipients.add(client);
        }
      }
      const refreshed = new Set<number>();
      for (const client of clients) {
        if (!refreshed.has(client.userId)) {
          client.partyIds = getUserPartyIds(client.userId);
          refreshed.add(client.userId);
        }
      }
      // Deliver on pre-refresh membership (disband only — joins rely on the
      // refresh ADDING the party to the joiner's other tabs).
      if (event.action === 'disband') {
        for (const client of disbandRecipients) {
          if (client.ws.readyState !== 1 || client.userId === event.actorUserId) continue;
          try {
            client.ws.send(message);
          } catch {
            clients.delete(client);
          }
        }
        return; // already delivered to everyone who mattered
      }
    }
    // Hidden (secret prep) characters: character:change events — including
    // the concentration payloads that carry the character name — reach only
    // the owner and the GM. Other event types carry no sheet data and stay
    // public (party:change / combat:change refresh lists for everyone).
    let restrictTo: Set<number> | null = null;
    if (event.type === 'character:change' && event.characterId !== undefined) {
      const drizzle = getDrizzle();
      const char = drizzle
        .select({ hidden: characters.hidden, owner_id: characters.ownerId })
        .from(characters)
        .where(eq(characters.id, event.characterId))
        .get() as any;
      // No row = deleted character: deliver to everyone so lists refresh
      if (char?.hidden) {
        restrictTo = new Set([char.owner_id]);
        const gms = drizzle
          .select({ user_id: partyMembers.userId })
          .from(partyMembers)
          .where(and(eq(partyMembers.partyId, event.partyId), eq(partyMembers.role, 'gm')))
          .all();
        for (const g of gms) restrictTo.add(g.user_id);
      }
    }
    for (const client of clients) {
      if (client.ws.readyState !== 1) {
        // OPEN
        clients.delete(client);
        continue;
      }
      // Echo suppression: don't send the event back to the user who triggered it.
      // They already have the optimistic result from their own API call.
      // Exceptions: combat:change, character:change and campaign:change — a
      // user can be GM in one tab and player in another (own character in the
      // fight), and the MD runs on several screens (laptop + tablet) whose
      // carnet must stay in sync (initiative widget, HP mirroring, clock).
      const isEchoExempt =
        event.type === 'combat:change' ||
        event.type === 'character:change' ||
        event.type === 'campaign:change';
      if (event.actorUserId && client.userId === event.actorUserId && !isEchoExempt) continue;
      // Hidden-character events stop at owner / GM connections
      if (restrictTo && !restrictTo.has(client.userId)) continue;
      // Only push to clients who are members of the affected party
      if (client.partyIds.has(event.partyId)) {
        try {
          client.ws.send(message);
        } catch {
          clients.delete(client);
        }
      }
    }
  });
}
