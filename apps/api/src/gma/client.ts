/**
 * GM Assistant API client — the ONLY outbound HTTP in the app.
 *
 * Auth: personal API key (`Authorization: Bearer gma_…`), server-side only.
 * Our writes over there are exactly two (init + character resync); everything
 * else is read. Conventions honored here: JSON bodies, merge-patch for PATCH,
 * cursor pagination, `{error:{code,message}}` envelope with open-enum codes.
 *
 * Env:
 * - GMA_BASE_URL     (default https://backend.gmassistant.app/v1) — overridable
 *                    so the test suite can point at a local mock.
 * - GMA_TIMEOUT_MS   (default 8000)
 * - GMA_CACHE_TTL_MS (default 300000) — sessions/recaps cache freshness
 * - GMA_SECRET       AES key material for the stored API key (falls back to
 *                    JWT_SECRET + fixed salt; rotating either orphans the
 *                    stored keys → the GM re-enters the key, shown cleanly).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const GMA_DEFAULT_BASE_URL = 'https://backend.gmassistant.app/v1';

export function gmaBaseUrl(): string {
  const base = process.env.GMA_BASE_URL || GMA_DEFAULT_BASE_URL;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export function gmaTimeoutMs(): number {
  return Number(process.env.GMA_TIMEOUT_MS) > 0 ? Number(process.env.GMA_TIMEOUT_MS) : 8000;
}

export function gmaCacheTtlMs(): number {
  return Number(process.env.GMA_CACHE_TTL_MS) >= 0 ? Number(process.env.GMA_CACHE_TTL_MS) : 300_000;
}

/** GMA-side failure, normalized. status 0 = network/timeout error. */
export class GmaError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Map a GmaError to the status + French message our API responds with. */
export function gmaErrorToResponse(err: unknown): { status: number; message: string } {
  if (err instanceof GmaError) {
    if (err.status === 0) {
      return { status: 502, message: 'GM Assistant est injoignable.' };
    }
    switch (err.status) {
      case 401:
        return {
          status: 401,
          message:
            'Clé GM Assistant invalide ou révoquée — ressaisis-la dans la Table du MD (onglet GM Assistant).',
        };
      case 403:
        if (err.code === 'insufficient_scope') {
          return {
            status: 403,
            message:
              'Cette clé est en lecture seule. Crée une clé « full access » sur gmassistant.app pour créer la campagne ou resynchroniser les personnages.',
          };
        }
        return { status: 403, message: 'GM Assistant a refusé l’accès à cette ressource.' };
      case 404:
        return {
          status: 404,
          message: 'Introuvable côté GM Assistant — la campagne a peut-être été supprimée là-bas.',
        };
      case 429:
        return {
          status: 503,
          message: 'GM Assistant limite les appels pour l’instant — réessaie dans un instant.',
        };
      default:
        return { status: 502, message: `GM Assistant a répondu une erreur (${err.status}).` };
    }
  }
  return { status: 502, message: 'GM Assistant est injoignable.' };
}

export interface GmaRequestOptions {
  body?: unknown;
  /** Content type for the body (PATCH uses application/merge-patch+json). */
  contentType?: string;
  query?: Record<string, string>;
}

/** One authenticated call. Throws GmaError on any failure (network included). */
export async function gmaRequest<T = any>(
  apiKey: string,
  method: string,
  path: string,
  opts: GmaRequestOptions = {},
): Promise<T> {
  const url = new URL(`${gmaBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(opts.body !== undefined
          ? { 'content-type': opts.contentType ?? 'application/json' }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(gmaTimeoutMs()),
    });
  } catch {
    throw new GmaError(0, 'network', 'GM Assistant est injoignable');
  }
  if (res.status === 204) return null as T;
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* fall through to the generic error below */
  }
  if (!res.ok) {
    const err = parsed?.error;
    throw new GmaError(
      res.status,
      typeof err?.code === 'string' ? err.code : `http_${res.status}`,
      typeof err?.message === 'string' ? err.message : `GM Assistant a répondu ${res.status}`,
    );
  }
  return parsed as T;
}

/** Follow cursor pagination to exhaustion (bounded — 10 pages max). */
export async function gmaListAll<T = any>(
  apiKey: string,
  path: string,
  query: Record<string, string> = {},
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const q = { ...query };
    if (cursor) q.cursor = cursor;
    const res = await gmaRequest<{ data?: T[]; page?: { next_cursor?: string | null } }>(
      apiKey,
      'GET',
      path,
      { query: q },
    );
    out.push(...(Array.isArray(res?.data) ? res.data : []));
    cursor = res?.page?.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

// ---------- API-key encryption at rest (AES-256-GCM) ----------

function encryptionKey(): Buffer {
  const secret =
    process.env.GMA_SECRET || process.env.JWT_SECRET || 'dev-only-change-me-in-production';
  return scryptSync(secret, 'dnd-inventory:gma:v1', 32);
}

/** Encrypt a secret into `v1:<iv>:<tag>:<ciphertext>` (all base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a `encryptSecret` blob. Throws when the key material changed. */
export function decryptSecret(enc: string): string {
  const parts = enc.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('encrypted secret: bad format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(parts[1], 'base64'),
  );
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Mask an email for display: `mika@example.com` → `m***@example.com`. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email?.includes('@')) return email ?? null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
