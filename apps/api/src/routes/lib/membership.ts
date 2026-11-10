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

// ---------- Contenus personnalisés (plan 2026-11, PR2 monstres / PR3 sorts) ----------

/**
 * Périmètre de groupe d'une requête catalogue (query `partyId`) : renvoie
 * l'id parsé, `null` si le paramètre est absent (catalogue SRD pur), ou
 * `undefined` après avoir répondu 400/403 (groupe invalide / non-membre).
 * Sans partyId les customs ne fuient jamais entre tables et la fenêtre
 * maxAge du catalogue SRD reste de mise.
 */
export function partyScopeFromQuery(
  raw: string | undefined,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: number,
): number | null | undefined {
  if (raw === undefined || raw === '') return null;
  const partyId = Number(raw);
  if (!Number.isInteger(partyId) || partyId <= 0) {
    reply.code(400).send({ error: apiMsg(req, 'groupe invalide') });
    return undefined;
  }
  if (!isPartyMember(partyId, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'pas membre du groupe') });
    return undefined;
  }
  return partyId;
}

/** Porte GM d'une création `POST /parties/:partyId/<contenu>` (MD seul,
 *  règle 3 — pas de branche joueur, pas de toggle) : renvoie l'id du groupe,
 *  ou `undefined` après avoir répondu 403. */
export function partyGMParamOr403(
  req: FastifyRequest<{ Params: { partyId: string } }>,
  reply: FastifyReply,
  userId: number,
  forbiddenMsg: string,
): number | undefined {
  const partyId = Number(req.params.partyId);
  if (!isPartyGM(partyId, userId)) {
    reply.code(403).send({ error: apiMsg(req, forbiddenMsg) });
    return undefined;
  }
  return partyId;
}

/** Garde PATCH/DELETE d'un contenu personnalisé : la ligne doit être un
 *  CUSTOM appartenant à un groupe dont l'auteur de la requête est MD —
 *  répond 403 et renvoie false sinon (le 404 reste à l'appelant : la clé
 *  diffère selon la table, slug ou id). */
export function denyUnlessCustomOfGM(
  row: any,
  isCustom: boolean,
  userId: number,
  req: FastifyRequest,
  reply: FastifyReply,
  notCustomMsg: string,
  notGMMsg: string,
): boolean {
  if (!isCustom) {
    reply.code(403).send({ error: apiMsg(req, notCustomMsg) });
    return false;
  }
  if (!isPartyGM(row.party_id, userId)) {
    reply.code(403).send({ error: apiMsg(req, notGMMsg) });
    return false;
  }
  return true;
}
