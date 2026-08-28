/**
 * Error-scoped rate limiting.
 *
 * The whole table typically shares one IP (home Wi-Fi / VPN), and behind
 * nginx every client also shares the proxy's socket IP — so counting every
 * request would block legitimate play. Only FAILED responses (>= 400,
 * excluding 429 itself) consume budget; successes are free.
 *
 * Two buckets per client key (see clientKey below): 'err' (any /api error
 * response — brute force, broken loops) and 'auth' (failed logins/
 * registrations and failed invite-code joins — credential / invite-code
 * guessing).
 *
 * When a bucket overflows, all /api calls from that key get 429 until the
 * window resets. Tunable via RATE_LIMIT_ERROR_MAX, RATE_LIMIT_AUTH_FAIL_MAX
 * and RATE_LIMIT_WINDOW_MS.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const ERROR_MAX = parseInt(process.env.RATE_LIMIT_ERROR_MAX || '40', 10);
const AUTH_FAIL_MAX = parseInt(process.env.RATE_LIMIT_AUTH_FAIL_MAX || '5', 10);

// Forwarded headers (X-Real-IP / X-Forwarded-For) are only trusted behind our
// nginx proxy, which overwrites them from the actual TCP peer (unspoofable
// from outside the proxy). When the API port is published directly, a client
// can FORGE these headers and get a fresh bucket per request — evading every
// limit, including the 5/min login brute-force bucket. So they are honored
// only when TRUST_PROXY=true; the default (unset) keys on the socket address,
// which is always safe for direct exposure.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// Routes whose FAILURES point at credential/invite guessing
const TIGHT_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/password',
  '/api/parties/join',
]);

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>(); // "<kind>:<key>" -> bucket

// Behind nginx (TRUST_PROXY=true): X-Real-IP, set by our proxy from the
// actual TCP peer; fall back to X-Forwarded-For (first hop). Otherwise the
// forwarded headers are IGNORED (spoofable by any direct client) and we key
// on req.ip — the socket address, since the server doesn't enable Fastify's
// trustProxy.
function clientKey(req: FastifyRequest): string {
  if (TRUST_PROXY) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real) return real;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return req.ip;
}

function blockedBucket(key: string, now: number): Bucket | null {
  for (const kind of ['err', 'auth'] as const) {
    const b = buckets.get(`${kind}:${key}`);
    if (b && now < b.resetAt && b.count >= (kind === 'auth' ? AUTH_FAIL_MAX : ERROR_MAX)) {
      return b;
    }
  }
  return null;
}

function countFailure(key: string, kind: 'err' | 'auth', now: number) {
  const id = `${kind}:${key}`;
  const b = buckets.get(id);
  if (!b || now >= b.resetAt) buckets.set(id, { count: 1, resetAt: now + WINDOW_MS });
  else b.count += 1;
}

export async function errorRateLimit(app: FastifyInstance) {
  // Gate: reject blocked keys before doing any work
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url === '/api/health') return;
    const now = Date.now();
    const blocked = blockedBucket(clientKey(req), now);
    if (blocked) {
      reply.header('Retry-After', Math.max(1, Math.ceil((blocked.resetAt - now) / 1000)));
      return reply.code(429).send({
        error: 'Trop de requêtes en échec — réessayez dans un instant',
      });
    }
  });

  // Count: only failures consume budget
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const status = reply.statusCode;
    if (status < 400 || status === 429) return;
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url === '/api/health') return;
    const now = Date.now();
    const key = clientKey(req);
    if (TIGHT_ROUTES.has(url)) countFailure(key, 'auth', now);
    countFailure(key, 'err', now);
    // Opportunistic prune so the map never grows unbounded
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
    }
  });
}
