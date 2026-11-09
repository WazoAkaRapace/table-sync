/**
 * Helpers du protocole de compte : sanitisation de ligne `users`, pose du
 * couple de cookies de session, normalisation/validation d'adresse e-mail
 * et émission des liens de vérification d'adresse. Extraits de
 * routes/auth.ts (phase 3 qualité — le monolithe est ratcheté shrink-only
 * par check-modularity, l'extraction en fait BAISSER la baseline) :
 * déplacement à l'identique, zéro changement de comportement.
 */

import { randomBytes } from 'node:crypto';
import type { User } from '@table-sync/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ACCESS_COOKIE_NAME,
  accessCookieOptions,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from './refresh.ts';
import { sha256Hex } from './tokens.ts';
import type { getDrizzle } from '../db/drizzle.ts';
import { emailVerificationTokens } from '../db/schema.ts';
import { emailEnabled } from '../email/config.ts';
import { appAssets, appLinkBase } from '../email/links.ts';
import { sendEmail } from '../email/send.ts';
import { buildVerifyEmail } from '../email/templates/verify-email.ts';

/** Durée de validité d'un lien de vérification (l'enjeu est moindre qu'un reset). */
export const VERIFY_TTL_HOURS = 24;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pose le couple de cookies de session : ts_access (JWT, Path=/api — c'est
 * lui qui authentifie le navigateur) + ts_refresh (Path=/api/auth). Le corps
 * JSON garde `token` (le JS en a besoin pour WS/images immédiatement — il ne
 * vit qu'en mémoire client), mais AUCUN refresh token : la preuve de
 * renouvellement ne quitte jamais le cookie HttpOnly.
 */
export function setSessionCookies(
  reply: FastifyReply,
  req: FastifyRequest,
  jwtToken: string,
  refreshToken: string,
): void {
  reply.setCookie(ACCESS_COOKIE_NAME, jwtToken, accessCookieOptions(req));
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(req));
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailError(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (!EMAIL_RE.test(email)) return 'adresse e-mail invalide';
  if (email.length > 254) return 'adresse e-mail trop longue';
  return null;
}

export function sanitizeUser(row: any): User {
  let tutorialTabsDone: string[] = [];
  try {
    const raw = JSON.parse(row.tutorial_tabs_done ?? '[]');
    if (Array.isArray(raw))
      tutorialTabsDone = raw.filter((id): id is string => typeof id === 'string');
  } catch {
    /* JSON illisible : aucun onglet visité */
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email ?? null,
    emailVerifiedAt: row.email_verified_at ?? null,
    pendingEmail: row.pending_email ?? null,
    tutorialSeenAt: row.tutorial_seen_at ?? null,
    tutorialTabsDone,
    tutorialDisabled: !!row.tutorial_disabled,
    createdAt: row.created_at,
  };
}

/**
 * Crée un jeton de vérification pour `email` et envoie le lien (fire-and-
 * forget). Un seul jeton actif par utilisateur — les précédents non
 * consommés sont remplacés. No-op silencieux si les e-mails sont désactivés
 * sur ce serveur : l'inscription ne doit jamais échouer pour ça, l'utilisateur
 * relancera la vérification depuis Mon compte une fois la config posée.
 */
export function issueEmailVerification(
  drizzle: ReturnType<typeof getDrizzle>,
  userId: number,
  displayName: string,
  email: string,
  locale: 'fr' | 'en',
  req: FastifyRequest,
  change: boolean,
): void {
  if (!emailEnabled) return;
  drizzle.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId)).run();
  const rawToken = randomBytes(32).toString('base64url');
  drizzle
    .insert(emailVerificationTokens)
    .values({
      userId,
      tokenHash: sha256Hex(rawToken),
      locale,
      expiresAt: sql`datetime('now', ${`+${VERIFY_TTL_HOURS * 60} minutes`})`,
    })
    .run();
  const link = `${appLinkBase(req)}/verifier-email?token=${rawToken}`;
  void sendEmail({
    to: email,
    toName: displayName,
    ...buildVerifyEmail(displayName, link, locale, change, appAssets(req)),
  });
}
