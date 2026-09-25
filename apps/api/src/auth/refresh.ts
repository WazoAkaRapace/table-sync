/**
 * Jetons de rafraîchissement — sessions de 30 jours à fenêtre glissante,
 * un row par appareil/session (`refresh_tokens`) — et cookies de session.
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
 *
 * Deux cookies HttpOnly portent la session du navigateur : `ts_refresh`
 * (preuve de renouvellement, Path=/api/auth) et `ts_access` (le JWT lui-même,
 * Path=/api). AUCUN matériau d'auth ne vit en localStorage — le JS n'obtient
 * un JWT lisible que via GET /api/auth/token (WS + URLs d'images).
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

/**
 * Cookie HttpOnly qui porte le refresh token (docs/plan-refresh-cookie.md) :
 * le jeton devient illisible au JavaScript de la page — un XSS peut voler
 * une session JWT en cours, plus installer une persistance de 30 jours.
 */
export const REFRESH_COOKIE_NAME = 'ts_refresh';

/**
 * Cookie HttpOnly qui porte le JWT d'accès (bascule « plus rien en
 * localStorage ») : le navigateur le pose sur TOUTES les routes /api —
 * l'Authorization header n'est plus qu'un chemin pour les scripts et les
 * suites de test, qui n'ont pas de cookie jar.
 */
export const ACCESS_COOKIE_NAME = 'ts_access';

/**
 * Durée de vie du JWT d'accès (24 h, alignée sur le maxAge du cookie qui le
 * porte). Fenêtre de vol courte : le refresh cookie (30 j glissants) tient
 * la session, le JWT lui ne survit qu'une journée hors ligne.
 */
export const ACCESS_TOKEN_TTL_HOURS = 24;

/**
 * La requête est-elle arrivée en HTTPS ? X-Forwarded-Proto d'abord (posé par
 * nginx sur /api — `proxy_set_header X-Forwarded-Proto $scheme` — et par les
 * proxys publics devant lui), sinon le protocole de la socket. L'accès LAN
 * direct en http NE DOIT PAS poser Secure : le navigateur y rejetterait le
 * cookie et le refresh serait cassé pour la table.
 */
function arrivedOverHttps(req: FastifyRequest): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // Chaîne de proxys : « https, http » — la première entrée décrit le
    // protocole du client d'origine.
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.protocol === 'https';
}

/**
 * Options du cookie ts_refresh — DÉFINITION UNIQUE : chaque site
 * setCookie/clearCookie passe par ici (clearCookie exige le MÊME
 * path/sameSite, sinon le navigateur ne supprime pas la miette).
 * Path=/api/auth : la preuve de refresh ne voyage QUE sur les routes
 * d'auth ; SameSite=Strict : jamais envoyée inter-site, même en navigation
 * top-level — le CSRF y est mort-né, pas de token dédié à poser.
 */
export function refreshCookieOptions(req: FastifyRequest) {
  return {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'strict' as const,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    secure: arrivedOverHttps(req),
  };
}

/**
 * Options du cookie ts_access — même discipline de définition unique. Path=/api
 * (PAS seulement /api/auth) : le JWT doit partir sur TOUTES les routes API,
 * c'est lui qui authentifie le navigateur. CSRF : SameSite=Strict bloque
 * l'envoi inter-site par le navigateur (même en navigation top-level) — les
 * scripts CLI (Authorization header) ne sont pas soumis au CSRF, pas de jeton
 * dédié à poser. Max-Age aligné sur le TTL du JWT (24 h).
 */
export function accessCookieOptions(req: FastifyRequest) {
  return {
    path: '/api',
    httpOnly: true,
    sameSite: 'strict' as const,
    maxAge: ACCESS_TOKEN_TTL_HOURS * 60 * 60,
    secure: arrivedOverHttps(req),
  };
}

/**
 * Authentifie la requête par JWT — la bascule cookie se joue ici :
 * l'en-tête Authorization d'abord (scripts/tests sans cookie jar), et s'il
 * échoue ou manque, le cookie HttpOnly ts_access. Un en-tête PÉRIMÉ ne tue
 * pas la requête si le cookie est encore bon (onglet ouvert > 24 h rafraîchi
 * entre-temps par un autre chemin). Positionne request.user dans les deux
 * cas + la source sur request.tsAccessSource ('header' | 'cookie') — la
 * route GET /api/auth/token s'en sert pour renvoyer le jeton vérifié.
 */
export async function verifyAccess(request: FastifyRequest): Promise<boolean> {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header) {
    try {
      await request.jwtVerify(); // lit l'en-tête, positionne request.user
      (request as any).tsAccessSource = 'header';
      return true;
    } catch {
      /* en-tête périmé/forgé : le cookie a peut-être mieux vieilli */
    }
  }
  const cookieToken = request.cookies?.[ACCESS_COOKIE_NAME];
  if (cookieToken) {
    try {
      (request as any).user = (request.server as any).jwt.verify(cookieToken);
      (request as any).tsAccessSource = 'cookie';
      return true;
    } catch {
      /* expiré/invalidé */
    }
  }
  return false;
}

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
