/**
 * Correspondance secrète MD ↔ joueur : un fil par personnage.
 *
 * Star topology — the GM exchanges with every character, a player only with
 * the GM(s). The thread is owner+GM readable (STRICTER than notes, which any
 * member can read: another party member gets 403 here). No edit, no delete:
 * le fil est un journal.
 *
 * Sync: every write emits `message:new` with targetUserId — ws.ts delivers to
 * the recipient only, never a party fan-out. Push rides the VAPID infra
 * (docs/push-notifications.md) with NO message body in the payload: a secret
 * must not sit on a lock screen.
 */

import type {
  CreateMessagePayload,
  MessageThreadSummary,
  SecretMessage,
  UnreadMessages,
} from '@table-sync/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { characterMessages, characters, partyMembers, users } from '../db/schema.ts';
import { type PushPayload, type PushSendOptions, sendPushToUser } from '../push/send.ts';
import { bus } from '../sync/bus.ts';
import { characterVisibleTo, isPartyGM, isPartyMember, requireUser } from './helpers.ts';
import { apiMsg } from './messages.ts';

const MAX_MESSAGE_LENGTH = 2000;

function mapMessage(row: any, gmUserIds: Set<number>): SecretMessage {
  return {
    id: row.id,
    characterId: row.character_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name ?? '',
    fromGM: gmUserIds.has(row.sender_user_id),
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

function getGMUserIds(drizzle: ReturnType<typeof getDrizzle>, partyId: number): number[] {
  return (
    drizzle
      .select({ user_id: partyMembers.userId })
      .from(partyMembers)
      .where(sql`${partyMembers.partyId} = ${partyId} and ${partyMembers.role} = 'gm'`)
      .all() as any[]
  ).map((r) => r.user_id);
}

/** Display names for a batch of sender ids (avoids the join's ambiguous `id`). */
function getSenderNames(
  drizzle: ReturnType<typeof getDrizzle>,
  ids: number[],
): Map<number, string> {
  const unique = [...new Set(ids)];
  const map = new Map<number, string>();
  if (unique.length === 0) return map;
  const rows = drizzle
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, unique))
    .all() as any[];
  for (const row of rows) map.set(row.id, row.name);
  return map;
}

/** Push fire-and-forget : un échec d'envoi ne doit jamais toucher la réponse de la route. */
function pushSafe(userId: number, payload: PushPayload, options?: PushSendOptions): void {
  sendPushToUser(userId, payload, options).catch((err) =>
    console.warn('[push] messages:', (err as Error).message),
  );
}

/**
 * Notification de correspondance — le CORPS ne contient jamais le message
 * (écran de verrouillage), seulement l'émetteur et le personnage concerné.
 * ttl 1 h : pertinent pour la séance, pas pour la semaine.
 */
function notifyMessagePush(recipientId: number, char: any, message: SecretMessage): void {
  const payload: PushPayload = message.fromGM
    ? {
        kind: 'message',
        title: { fr: 'Le MD vous a écrit', en: 'A message from your GM' },
        body: {
          fr: `Correspondance secrète — ${char.name}`,
          en: `Secret correspondence — ${char.name}`,
        },
        url: `/party/${char.party_id}/character/${char.id}?tab=messages`,
        tag: `message:${char.id}`,
      }
    : {
        kind: 'message',
        title: { fr: 'Message d’un joueur', en: 'A player messaged you' },
        body: {
          fr: `${message.senderName} — ${char.name}`,
          en: `${message.senderName} — ${char.name}`,
        },
        url: `/party/${char.party_id}/messages`,
        tag: `message:${char.id}`,
      };
  pushSafe(recipientId, payload, { ttl: 3600, urgency: 'normal' });
}

/** Emit a targeted message:new to the OTHER side of the thread.
 *  action 'new' = a message landed (banner-worthy); 'read' = the recipient
 *  side just read (only « Vu » ticks and badges reflow). */
function emitToSide(
  partyId: number,
  characterId: number,
  actorUserId: number,
  recipientIds: number[],
  action: 'new' | 'read',
  fromGM: boolean,
  senderName = '',
  characterName = '',
): void {
  for (const recipientId of recipientIds) {
    bus.emitChange({
      type: 'message:new',
      partyId,
      characterId,
      messageCharacterId: characterId,
      messageFromGM: fromGM,
      messageCharacterName: characterName || undefined,
      messageSenderName: senderName || undefined,
      action,
      actorUserId,
      targetUserId: recipientId,
    });
  }
}

/**
 * The recipient side of a thread, from the actor's perspective: the GMs when
 * the actor is the owner, the owner otherwise. A GM messaging their own
 * character yields an empty list — both sides are the same user.
 */
function otherSide(char: any, actorUserId: number, gmUserIds: number[]): number[] {
  if (char.owner_id === actorUserId) return gmUserIds.filter((id) => id !== actorUserId);
  return [char.owner_id];
}

/** Shared guard: fetch character, check the caller can access this thread. */
function getThreadCharacter(
  req: any,
  reply: any,
  charId: number,
): { char: any; drizzle: ReturnType<typeof getDrizzle> } | null {
  const userId = requireUser(req, reply);
  if (!userId) return null;
  const drizzle = getDrizzle();
  const char = getCharacter(drizzle, charId);
  if (!char) {
    reply.code(404).send({ error: apiMsg(req, 'Character not found') });
    return null;
  }
  if (!isPartyMember(char.party_id, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'Not a party member') });
    return null;
  }
  // Hidden character: 404 for everyone but its owner and the GM
  if (!characterVisibleTo(char, userId)) {
    reply.code(404).send({ error: apiMsg(req, 'Character not found') });
    return null;
  }
  // Secret: owner + GMs only — stricter than notes
  if (char.owner_id !== userId && !isPartyGM(char.party_id, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'Only the owner or GM can modify') });
    return null;
  }
  return { char, drizzle };
}

export async function characterMessageRoutes(app: FastifyInstance) {
  // ---------- The thread (owner + GMs) ----------

  app.get('/characters/:id/messages', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const charId = Number((req.params as any).id);
    const ctx = getThreadCharacter(req, reply, charId);
    if (!ctx) return;
    const { char, drizzle } = ctx;

    const gmSet = new Set(getGMUserIds(drizzle, char.party_id));
    const rows = drizzle
      .select(cols(characterMessages))
      .from(characterMessages)
      .where(eq(characterMessages.characterId, charId))
      .orderBy(characterMessages.createdAt, characterMessages.id)
      .all() as any[];
    const names = getSenderNames(
      drizzle,
      rows.map((r) => r.sender_user_id),
    );
    const messages = rows.map((r) =>
      mapMessage({ ...r, sender_name: names.get(r.sender_user_id) }, gmSet),
    );
    // Caller-side unread: GM-sent when the owner asks, owner-sent for a GM
    const unread = messages.filter(
      (m) =>
        !m.readAt &&
        (char.owner_id === userId
          ? m.senderUserId !== char.owner_id
          : m.senderUserId === char.owner_id),
    ).length;
    return { messages, unread };
  });

  app.post('/characters/:id/messages', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const charId = Number((req.params as any).id);
    const ctx = getThreadCharacter(req, reply, charId);
    if (!ctx) return;
    const { char, drizzle } = ctx;

    const body = req.body as CreateMessagePayload;
    const text = body?.body?.trim();
    if (!text) return reply.code(400).send({ error: apiMsg(req, 'Le message est requis') });
    if (text.length > MAX_MESSAGE_LENGTH) {
      return reply.code(400).send({ error: apiMsg(req, 'Message trop long') });
    }

    const row = drizzle
      .insert(characterMessages)
      .values({
        characterId: charId,
        partyId: char.party_id,
        senderUserId: userId,
        body: text,
      })
      .returning(cols(characterMessages))
      .get() as any;
    const gmUserIds = getGMUserIds(drizzle, char.party_id);
    const senderName = getSenderNames(drizzle, [userId]).get(userId) ?? '';
    const message = mapMessage({ ...row, sender_name: senderName }, new Set(gmUserIds));

    const recipients = otherSide(char, userId, gmUserIds);
    for (const recipientId of recipients) {
      emitToSide(
        char.party_id,
        charId,
        userId,
        [recipientId],
        'new',
        message.fromGM,
        senderName,
        char.name,
      );
      notifyMessagePush(recipientId, char, message);
    }
    return reply.code(201).send({ message });
  });

  // ---------- Mark the caller's side as read (idempotent) ----------
  app.post('/characters/:id/messages/read', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const charId = Number((req.params as any).id);
    const ctx = getThreadCharacter(req, reply, charId);
    if (!ctx) return;
    const { char, drizzle } = ctx;

    // The caller's incoming side only: GM-sent for the owner, owner-sent for a GM
    const senderIsGM = char.owner_id === userId;
    const result = drizzle
      .update(characterMessages)
      .set({ readAt: sql`datetime('now')` })
      .where(
        senderIsGM
          ? sql`${characterMessages.characterId} = ${charId} and ${characterMessages.readAt} is null and ${characterMessages.senderUserId} <> ${char.owner_id}`
          : sql`${characterMessages.characterId} = ${charId} and ${characterMessages.readAt} is null and ${characterMessages.senderUserId} = ${char.owner_id}`,
      )
      .run();

    if (result.changes > 0) {
      // Reflow to the other side: their « Vu » ticks and inbox badge update live
      const gmUserIds = getGMUserIds(drizzle, char.party_id);
      emitToSide(char.party_id, charId, userId, otherSide(char, userId, gmUserIds), 'read', true);
    }
    return { ok: true, read: result.changes };
  });

  // ---------- GM inbox: one register entry per character thread ----------

  app.get('/parties/:id/message-threads', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const partyId = Number((req.params as any).id);
    if (!isPartyMember(partyId, userId))
      return reply.code(403).send({ error: apiMsg(req, 'Not a party member') });
    if (!isPartyGM(partyId, userId)) return reply.code(403).send({ error: apiMsg(req, 'GM only') });

    const drizzle = getDrizzle();
    const chars = drizzle
      .select(cols(characters))
      .from(characters)
      .where(eq(characters.partyId, partyId))
      .orderBy(sql`${characters.name} collate nocase`)
      .all() as any[];
    const charIds = chars.map((c) => c.id);
    const rows =
      charIds.length === 0
        ? []
        : (drizzle
            .select(cols(characterMessages))
            .from(characterMessages)
            .where(inArray(characterMessages.characterId, charIds))
            .orderBy(characterMessages.createdAt, characterMessages.id)
            .all() as any[]);
    const gmSet = new Set(getGMUserIds(drizzle, partyId));
    const names = getSenderNames(
      drizzle,
      rows.map((r) => r.sender_user_id).concat(chars.map((c) => c.owner_id)),
    );

    const threads: MessageThreadSummary[] = chars.map((c) => {
      const own = rows.filter((r) => r.character_id === c.id);
      const mapped = own.map((r) =>
        mapMessage({ ...r, sender_name: names.get(r.sender_user_id) }, gmSet),
      );
      const last = mapped.length > 0 ? mapped[mapped.length - 1] : null;
      // GM-side waiting = owner-sent by a NON-GM. On a GM-owned character
      // (préparation secrète), the MD's own notes are sender AND recipient —
      // they never count as waiting for the MD.
      const unread = mapped.filter(
        (m) => !m.readAt && m.senderUserId === c.owner_id && !gmSet.has(m.senderUserId),
      ).length;
      return {
        characterId: c.id,
        characterName: c.name,
        ownerName: names.get(c.owner_id) ?? '',
        ownerUserId: c.owner_id,
        hidden: !!c.hidden,
        lastMessage: last,
        unread,
      };
    });
    // Activity first (most recent exchange on top), empty threads sink to the
    // bottom in name order — the register's freshness hierarchy.
    threads.sort((a, b) => {
      const at = a.lastMessage?.createdAt ?? '';
      const bt = b.lastMessage?.createdAt ?? '';
      if (at !== bt) return bt.localeCompare(at);
      if (!!a.lastMessage !== !!b.lastMessage) return a.lastMessage ? -1 : 1;
      return a.characterName.localeCompare(b.characterName, 'fr');
    });
    return { threads };
  });

  // ---------- Caller-side unread counts (badges) ----------

  app.get('/parties/:id/messages/unread', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const partyId = Number((req.params as any).id);
    if (!isPartyMember(partyId, userId))
      return reply.code(403).send({ error: apiMsg(req, 'Not a party member') });

    const drizzle = getDrizzle();
    const isGM = isPartyGM(partyId, userId);
    const chars = drizzle
      .select({ id: characters.id, owner_id: characters.ownerId })
      .from(characters)
      .where(eq(characters.partyId, partyId))
      .all() as any[];
    // Players only ever hear about their own characters
    const scope = isGM ? chars : chars.filter((c) => c.owner_id === userId);
    const charIds = scope.map((c) => c.id);
    const rows =
      charIds.length === 0
        ? []
        : (drizzle
            .select({
              character_id: characterMessages.characterId,
              sender_user_id: characterMessages.senderUserId,
              read_at: characterMessages.readAt,
            })
            .from(characterMessages)
            .where(inArray(characterMessages.characterId, charIds))
            .all() as any[]);
    const gmSet = new Set(getGMUserIds(drizzle, partyId));

    const unread: UnreadMessages = { byCharacter: {}, total: 0 };
    for (const c of scope) {
      // GM side waits for owner-sent by a NON-GM (the MD's own notes on a
      // GM-owned character wait for nobody); player side waits for GM-sent
      const count = rows.filter(
        (r) =>
          r.character_id === c.id &&
          !r.read_at &&
          (isGM
            ? r.sender_user_id === c.owner_id && !gmSet.has(r.sender_user_id)
            : gmSet.has(r.sender_user_id)),
      ).length;
      if (count > 0) {
        unread.byCharacter[String(c.id)] = count;
        unread.total += count;
      }
    }
    return unread;
  });
}
