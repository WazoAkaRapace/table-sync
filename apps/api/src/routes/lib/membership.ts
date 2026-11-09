/**
 * Access-control helpers shared across route modules: auth guard, party
 * membership/GM checks, invite codes.
 */

import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { partyMembers } from '../../db/schema.ts';
import { apiMsg } from '../messages.ts';

/** Get the authenticated user id from the JWT-decoded payload. */
export function getUserId(req: FastifyRequest): number | null {
  const sub = req.user?.sub;
  return typeof sub === 'number' ? sub : null;
}

/** Reject if not authenticated. Returns userId or sends 401 and returns null. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): number | null {
  const id = getUserId(req);
  if (id === null) {
    reply.code(401).send({ error: apiMsg(req, 'unauthorized') });
    return null;
  }
  return id;
}

/** Is this user a member (gm or player) of this party? */
export function isPartyMember(partyId: number, userId: number): boolean {
  const row = getDrizzle()
    .select({ one: sql`1` })
    .from(partyMembers)
    .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.userId, userId)))
    .get();
  return !!row;
}

/** Is this user the GM of this party? */
export function isPartyGM(partyId: number, userId: number): boolean {
  const row = getDrizzle()
    .select({ one: sql`1` })
    .from(partyMembers)
    .where(
      and(
        eq(partyMembers.partyId, partyId),
        eq(partyMembers.userId, userId),
        eq(partyMembers.role, 'gm'),
      ),
    )
    .get();
  return !!row;
}

/** Can this user mutate the character's inventory (sheet owner or party GM)? */
export function isOwnerOrGM(char: any, userId: number): boolean {
  return char.owner_id === userId || isPartyGM(char.party_id, userId);
}

/**
 * Can this user SEE this character? Hidden (secret prep) characters are
 * visible to their owner and the GM only — other party members get 404s.
 */
export function characterVisibleTo(char: any, userId: number): boolean {
  return !char.hidden || char.owner_id === userId || isPartyGM(char.party_id, userId);
}

/** Generate a 6-char invite code (uppercase, unambiguous chars, crypto-random). */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[randomInt(chars.length)];
  return out;
}
