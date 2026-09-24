/**
 * Jetons de rafraîchissement — sessions de 30 jours à fenêtre glissante,
 * un row par appareil/session (`refresh_tokens`).
 *
 * Le jeton brut ne vit QUE chez le client : la base ne connaît que son
 * SHA-256. Chaque /refresh consomme le jeton présenté (revokedAt) et en
 * émet un neuf — rotation intégrale, la fenêtre de 30 jours repart de
 * zéro : un appareil actif ne se déconnecte jamais seul, 30 jours
 * d'inactivité = déconnexion nette.
 *
 * Réutiliser un jeton déjà consommé = vol présumé : toute la famille de
 * jetons de l'utilisateur est supprimée (pattern Auth0 — le légitime
 * détenteur est toujours sur le SUCCESSEUR, jamais sur un jeton révoqué).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { refreshTokens } from '../db/schema.ts';
import { sha256Hex } from './tokens.ts';

/** Durée de vie du jeton de rafraîchissement (30 jours, glissante). */
export const REFRESH_TOKEN_TTL_DAYS = 30;

type Drizzle = ReturnType<typeof getDrizzle>;

/** randomUUID() ×2 = 244 bits d'entropie, URL-safe sans remplacement. */
function newRawToken(): string {
  return `${randomUUID()}${randomUUID()}`;
}

function tokenExpiry(): ReturnType<typeof sql> {
  return sql`datetime('now', ${`+${REFRESH_TOKEN_TTL_DAYS} days`})`;
}

/** Émet un jeton neuf pour `userId` et retourne sa forme brute (client). */
export function issueRefreshToken(drizzle: Drizzle, userId: number, req: FastifyRequest): string {
  const raw = newRawToken();
  drizzle
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: sha256Hex(raw),
      expiresAt: tokenExpiry(),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      ipAddress: req.ip ?? null,
      rotatedFromId: null,
    })
    .run();
  return raw;
}

export interface RotatedRefresh {
  /** Jeton brut successeur (à renvoyer au client, jamais stocké). */
  raw: string;
  userId: number;
}

/**
 * Consomme `rawToken` et en émet le successeur — transaction : révoquer la
 * ligne présentée + poser la neuve, `rotated_from_id` chaîne la famille.
 *
 * Retourne null si le jeton est inconnu ou expiré. Si le jeton est
 * RÉVOQUÉ (déjà consommé par une rotation précédente — réutilisation
 * suspecte), toutes les lignes de l'utilisateur sont supprimées avant
 * l'échec : le vrai détenteur repasse par un login, l'attaquant perd
 * l'accès.
 */
export function rotateRefreshToken(drizzle: Drizzle, rawToken: string): RotatedRefresh | null {
  const tokenHash = sha256Hex(rawToken);
  const active = drizzle
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`datetime('now')`),
      ),
    )
    .get() as any;
  if (active) {
    const successor = newRawToken();
    // NB : getDb().transaction(fn) RETOURNE la fonction transaction — il faut
    // l'invoquer (pattern `})();`). Drizzle rejoint la transaction ambiante
    // sur la connexion partagée.
    getDb().transaction(() => {
      drizzle
        .update(refreshTokens)
        .set({ revokedAt: sql`datetime('now')` })
        .where(eq(refreshTokens.id, active.id))
        .run();
      drizzle
        .insert(refreshTokens)
        .values({
          userId: active.userId,
          tokenHash: sha256Hex(successor),
          expiresAt: tokenExpiry(),
          rotatedFromId: active.id,
          userAgent: active.userAgent,
          ipAddress: active.ipAddress,
        })
        .run();
    })();
    return { raw: successor, userId: active.userId };
  }

  // Échec : inconnu/expiré (rien à faire) ou RÉVOQUÉ réutilisé → family kill.
  const revoked = drizzle
    .select({ userId: refreshTokens.userId })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNotNull(refreshTokens.revokedAt)))
    .get() as any;
  if (revoked) {
    drizzle.delete(refreshTokens).where(eq(refreshTokens.userId, revoked.userId)).run();
    console.warn(
      `[auth] réutilisation d'un jeton de rafraîchissement révoqué — ` +
        `toutes les sessions de l'utilisateur ${revoked.userId} sont révoquées`,
    );
  }
  return null;
}

/** Déconnexion : révoque le jeton présenté (s'il est encore actif). */
export function revokeRefreshToken(drizzle: Drizzle, rawToken: string): void {
  drizzle
    .update(refreshTokens)
    .set({ revokedAt: sql`datetime('now')` })
    .where(and(eq(refreshTokens.tokenHash, sha256Hex(rawToken)), isNull(refreshTokens.revokedAt)))
    .run();
}

/** Changement de mot de passe : toutes les sessions de l'utilisateur meurent. */
export function revokeAllRefreshTokens(drizzle: Drizzle, userId: number): void {
  drizzle.delete(refreshTokens).where(eq(refreshTokens.userId, userId)).run();
}

/** Hygiène best-effort : lignes mortes depuis plus d'un cycle de 30 jours. */
export function purgeStaleRefreshTokens(drizzle: Drizzle): void {
  drizzle
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, sql`datetime('now', ${`-${REFRESH_TOKEN_TTL_DAYS} days`})`))
    .run();
}
