/**
 * In-process mock of the GM Assistant v1 API for `npm run test-api`.
 *
 * Implements exactly the surface our integration touches (account, campaigns,
 * campaign player-characters, sessions, session recaps + memorable moments)
 * with the conventions the real API documents: Bearer key auth, read/
 * full_access scopes, the `{error:{code,message,status}}` envelope, and
 * cursor pagination (sessions paginate at 2/page on purpose — it exercises
 * the client's cursor-following).
 *
 * The harness passes GMA_BASE_URL=<mock url> to the API server; tests mutate
 * `state` directly to stage scenarios and read `state.requests` to assert the
 * exact outbound payloads.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockGmaState {
  keys: Map<string, { scope: 'read' | 'full_access'; accountId: string; email: string }>;
  campaigns: Map<string, Record<string, any>>;
  /** campaignId → player characters */
  pcs: Map<string, Array<Record<string, any>>>;
  /** campaignId → sessions */
  sessions: Map<string, Array<Record<string, any>>>;
  /** sessionId → recaps */
  recaps: Map<string, Array<Record<string, any>>>;
  /** sessionId → memorable moments */
  moments: Map<string, Array<Record<string, any>>>;
  /** 'down' = simulate an outage (destroy the socket → network error). */
  failMode: 'off' | 'down';
  /** One-shot: fail the next player-character POST with this message. */
  failNextPcPost: string | null;
  /** Every authenticated request, for payload assertions. */
  requests: Array<{ method: string; path: string; body: any }>;
  reset: () => void;
}

export interface MockGmaHandle {
  /** Base URL to pass as GMA_BASE_URL (includes /v1). */
  url: string;
  state: MockGmaState;
  stop: () => Promise<void>;
}

const CAMPAIGN_EXISTING = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN_OTHER = '22222222-2222-2222-2222-222222222222';
export const MOCK_GMA_EXISTING_CAMPAIGN_ID = CAMPAIGN_EXISTING;
export const MOCK_GMA_OTHER_CAMPAIGN_ID = CAMPAIGN_OTHER;

function iso(): string {
  return new Date().toISOString();
}

function freshState(): MockGmaState {
  const state: MockGmaState = {
    keys: new Map([
      [
        'gma_test_full_good_key',
        { scope: 'full_access', accountId: 'acc-1', email: 'gma-test@example.com' },
      ],
      ['gma_test_read_key', { scope: 'read', accountId: 'acc-1', email: 'gma-test@example.com' }],
    ]),
    campaigns: new Map([
      [
        CAMPAIGN_EXISTING,
        {
          id: CAMPAIGN_EXISTING,
          title: 'Campagne Existante',
          created_at: iso(),
          updated_at: iso(),
        },
      ],
      [
        CAMPAIGN_OTHER,
        { id: CAMPAIGN_OTHER, title: 'Autre Campagne', created_at: iso(), updated_at: iso() },
      ],
    ]),
    pcs: new Map([
      [CAMPAIGN_EXISTING, []],
      [CAMPAIGN_OTHER, []],
    ]),
    sessions: new Map([
      [
        CAMPAIGN_EXISTING,
        [
          { id: 'sess-1', title: 'Le port de Baldur', played_at: '2026-05-20', order: 0 },
          { id: 'sess-2', title: 'La route de l’ouest', played_at: '2026-06-03', order: 1 },
          { id: 'sess-3', title: 'Les marais', played_at: null, order: 2 },
        ],
      ],
      [CAMPAIGN_OTHER, []],
    ]),
    recaps: new Map([
      [
        'sess-1',
        [
          { style: 'short_summary', text: 'Le groupe atteint le port.', updated_at: iso() },
          {
            style: 'default',
            text: 'Le groupe atteint le port de Baldur après trois jours de mer.',
            updated_at: iso(),
          },
        ],
      ],
    ]),
    moments: new Map([
      [
        'sess-1',
        [
          {
            id: 'mom-1',
            is_quote: true,
            type: 'dramatic',
            description: "J'attendais votre venue.",
            speaker: 'Rahadin',
            context: 'Aux portes du château',
            order: 0,
          },
          {
            id: 'mom-2',
            is_quote: false,
            type: 'funny',
            description: 'Le barde revend le memento du gardien au gardien lui-même.',
            speaker: null,
            context: null,
            order: 1,
          },
        ],
      ],
    ]),
    failMode: 'off',
    failNextPcPost: null,
    requests: [],
    reset: () => {
      const fresh = freshState();
      state.keys = fresh.keys;
      state.campaigns = fresh.campaigns;
      state.pcs = fresh.pcs;
      state.sessions = fresh.sessions;
      state.recaps = fresh.recaps;
      state.moments = fresh.moments;
      state.failMode = 'off';
      state.failNextPcPost = null;
      state.requests = [];
    },
  };
  return state;
}

function errorEnvelope(res: any, status: number, code: string, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message, status } }));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function page(data: any[], pageSize: number, cursor: string | null) {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const slice = data.slice(offset, offset + pageSize);
  const next = offset + pageSize < data.length ? String(offset + pageSize) : null;
  return { data: slice, page: { next_cursor: next, has_more: next !== null } };
}

function handle(req: IncomingMessage, res: any, state: MockGmaState): void {
  const url = new URL(req.url ?? '/', 'http://mock');
  const path = url.pathname.replace(/^\/v1/, '');
  let body: any = null;
  let bodyRead: Promise<any> | null = null;
  const getBody = () => (bodyRead ??= readBody(req));

  req.on('close', () => {
    /* body may go unread on early responses — nothing to do */
  });

  if (state.failMode === 'down') {
    res.socket?.destroy();
    return;
  }

  const auth = req.headers.authorization ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const keyInfo = state.keys.get(key);
  if (!keyInfo) {
    errorEnvelope(res, 401, 'unauthorized', 'Missing, malformed, unknown, or revoked API key');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && keyInfo.scope !== 'full_access') {
    errorEnvelope(res, 403, 'insufficient_scope', 'The API key lacks the scope required');
    return;
  }

  const respond = (status: number, payload: any) => {
    state.requests.push({ method: req.method ?? '', path, body: bodyCache });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 204 ? undefined : JSON.stringify(payload));
  };
  let bodyCache: any = null;

  const run = async () => {
    if (req.method !== 'GET') {
      bodyCache = await getBody();
      body = bodyCache;
    }
    // ---- /account ----
    if (path === '/account' && req.method === 'GET') {
      return respond(200, {
        id: keyInfo.accountId,
        email: keyInfo.email,
        is_alpha_tester: true,
        credit_balance: 42,
        free_analysis_balance: 2,
        subscription: null,
        next_credit_expiration: null,
        pending_agreements: [],
      });
    }
    // ---- /campaigns ----
    if (path === '/campaigns') {
      if (req.method === 'GET') {
        return respond(
          200,
          page([...state.campaigns.values()], 500, url.searchParams.get('cursor')),
        );
      }
      if (req.method === 'POST') {
        const id = `c-${state.campaigns.size + 1}-${Date.now()}`;
        const campaign = {
          id,
          title: body?.title ?? 'Sans titre',
          ttrpg_system: body?.ttrpg_system ?? null,
          ttrpg_system_edition: body?.ttrpg_system_edition ?? null,
          created_at: iso(),
          updated_at: iso(),
        };
        state.campaigns.set(id, campaign);
        state.pcs.set(id, []);
        state.sessions.set(id, []);
        return respond(201, campaign);
      }
    }
    const campMatch = path.match(/^\/campaigns\/([^/]+)$/);
    if (campMatch) {
      const camp = state.campaigns.get(campMatch[1]);
      if (!camp) return errorEnvelope(res, 404, 'not_found', 'Resource not found');
      if (req.method === 'GET') return respond(200, camp);
    }
    // ---- player characters ----
    const pcMatch = path.match(/^\/campaigns\/([^/]+)\/player-characters$/);
    if (pcMatch) {
      if (!state.campaigns.has(pcMatch[1])) {
        return errorEnvelope(res, 404, 'not_found', 'Campaign not found');
      }
      const list = state.pcs.get(pcMatch[1]) ?? [];
      if (req.method === 'GET') {
        return respond(200, page(list, 500, url.searchParams.get('cursor')));
      }
      if (req.method === 'POST') {
        if (state.failNextPcPost !== null) {
          const message = state.failNextPcPost;
          state.failNextPcPost = null;
          return errorEnvelope(res, 400, 'validation_error', message);
        }
        const pc = {
          id: `pc-${pcMatch[1].slice(0, 4)}-${list.length + 1}`,
          name: body?.name ?? '',
          played_by: body?.played_by ?? null,
          description: body?.description ?? null,
          order: list.length,
          created_at: iso(),
          updated_at: iso(),
        };
        list.push(pc);
        return respond(201, pc);
      }
    }
    const pcIdMatch = path.match(/^\/campaigns\/([^/]+)\/player-characters\/([^/]+)$/);
    if (pcIdMatch) {
      const list = state.pcs.get(pcIdMatch[1]) ?? [];
      const idx = list.findIndex((p) => p.id === pcIdMatch[2]);
      if (idx === -1) return errorEnvelope(res, 404, 'not_found', 'Player character not found');
      if (req.method === 'PATCH') {
        // merge-patch: null clears, omitted stays
        for (const field of ['name', 'played_by', 'description']) {
          if (body && field in body) (list[idx] as any)[field] = body[field];
        }
        list[idx].updated_at = iso();
        return respond(200, list[idx]);
      }
      if (req.method === 'DELETE') {
        list.splice(idx, 1);
        res.writeHead(204);
        state.requests.push({ method: req.method ?? '', path, body });
        res.end();
        return;
      }
    }
    // ---- sessions ----
    const sessMatch = path.match(/^\/campaigns\/([^/]+)\/sessions$/);
    if (sessMatch && req.method === 'GET') {
      const list = state.sessions.get(sessMatch[1]) ?? [];
      // Page size 2 on purpose: 3 seeded sessions → the client must follow
      // next_cursor to see them all.
      return respond(200, page(list, 2, url.searchParams.get('cursor')));
    }
    const recapMatch = path.match(/^\/campaigns\/([^/]+)\/sessions\/([^/]+)\/recaps$/);
    if (recapMatch && req.method === 'GET') {
      const list = state.recaps.get(recapMatch[2]) ?? [];
      return respond(200, { data: list, page: { next_cursor: null, has_more: false } });
    }
    const momentsMatch = path.match(/^\/campaigns\/([^/]+)\/sessions\/([^/]+)\/memorable-moments$/);
    if (momentsMatch && req.method === 'GET') {
      const list = state.moments.get(momentsMatch[2]) ?? [];
      return respond(200, page(list, 500, url.searchParams.get('cursor')));
    }
    errorEnvelope(res, 404, 'not_found', `No mock route for ${req.method} ${path}`);
  };

  run().catch(() => errorEnvelope(res, 500, 'internal_error', 'mock failure'));
}

export async function startMockGma(): Promise<MockGmaHandle> {
  const state = freshState();
  const server: Server = createServer((req, res) => handle(req, res, state));
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    state,
    stop: () =>
      new Promise<void>((resolveStop) => {
        server.close(() => resolveStop());
        setTimeout(resolveStop, 1000).unref?.();
      }),
  };
}
