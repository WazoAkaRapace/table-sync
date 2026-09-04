import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Réponse JSON avec négociation de cache pour les catalogues SRD (items,
 * sorts, monstres) : ETag = hash du corps, If-None-Match → 304 SANS corps.
 *
 * - `Vary: Accept-Language` : le même URL sert des corps différents par
 *   langue (payloads mono-locale) — @fastify/compress ajoute Accept-Encoding
 *   au même header, ils se cumulent.
 * - Sans `maxAge` : « no-cache » — revalidation à chaque requête, 304 tant
 *   que le corps n'a pas changé (données mutables : objets custom d'un
 *   groupe). Avec `maxAge` : fenêtre sans requête du tout pour les données
 *   seed-only (sorts, monstres).
 */
export function sendCachedJson(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  opts: { maxAge?: number } = {},
): FastifyReply {
  const body = JSON.stringify(payload);
  const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
  reply.header('etag', etag);
  reply.header('vary', 'accept-language');
  reply.header(
    'cache-control',
    opts.maxAge ? `private, max-age=${opts.maxAge}, must-revalidate` : 'private, no-cache',
  );
  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string' && inm === etag) {
    return reply.status(304).send();
  }
  return reply.send(body);
}
