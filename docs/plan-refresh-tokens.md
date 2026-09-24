# Refresh-Token Implementation Plan (table-sync)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a proper refresh-token mechanism so users stopped being kicked to /login every 7 days: opaque DB-backed refresh tokens (30-day lifespan) that mint a fresh 7-day JWT, with rotation on every use.

**Architecture:** Keep the existing JWT (7d, `@fastify/jwt`) for stateless API/WS auth. Add a `refresh_tokens` table storing SHA-256 hashes (never the raw token), one active token per device/session, with `expiresAt` (30d), `revokedAt`, and rotation metadata (`rotatedFromId`, `replacedByHash`-free design: rotate = revoke old row + insert new row, one transaction). The web client stores the refresh token in `localStorage` next to the JWT, transparently calls `POST /api/auth/refresh` on boot/401, and persists the rotated token. Login/register/reset mint the initial pair; logout revokes the row.

**Decisions locked by user (2026-09-24):**
- Refresh tokens: 30-day lifespan
- "Refresh also when refreshing the JWT" → every successful `/refresh` call ROTATES: new JWT **and** new refresh token, new 30-day window. Active devices stay logged in forever; 30 days of inactivity = clean logout.
- Design follows the Better Auth session model (opaque DB tokens, sliding window) without the framework migration.

**Tech Stack:** Fastify 5, @fastify/jwt, Drizzle (SQLite, versioned migrations), React 19 + axios, oxlint/oxfmt.

**Commands (repo root = `~/dnd-inventory`):**
- `npm run test-api` — API integration suite
- `npm run test:e2e` — Playwright E2E
- `npm run lint` — oxlint + oxfmt --check
- `npm -w api run db:generate` — generate Drizzle migration after schema.ts edit

---

## Current state (verified in repo)

- JWT signed with 7d expiry at: `apps/api/src/routes/auth.ts:185` (register), `:210` (login), `:575` (reset-password).
- Web client storage: `dnd-inv-token` + `dnd-inv-user` keys in localStorage. 401 → purge + redirect `/login` (`apps/web/src/api.ts:27-39`).
- WS auth: same JWT via `?token=` query param (`apps/api/src/sync/ws.ts:114`, `apps/web/src/sync.tsx:217,256,327,344`).
- Global auth guard: `apps/api/src/server.ts:115-136` — public-route allowlist.
- Logout is currently a no-op POST (`apps/api/src/routes/auth.ts:745`).
- Existing token-table precedent to copy: `passwordResetTokens` (`apps/api/src/db/schema.ts:955`) — SHA-256 hash, single active per user, transaction pattern. Reuse `sha256Hex` helper from `apps/api/src/routes/auth.ts`.
- Password change route (`auth.ts` ~line 730) currently does NOT revoke anything → must revoke all refresh tokens (see Task 8).

**Repo conventions that apply:**
- Drizzle: edit `schema.ts` → `npm -w api run db:generate` → commit generated `apps/api/drizzle/00NN_*.sql`. Server boot auto-applies. Never grow `schema.sql`/`COLUMN_MIGRATIONS` (frozen baseline).
- All user-facing strings in French via `apiMsg(req, '…')`.
- House style: 2 spaces, single quotes, semicolons, trailing commas, width 100, `objectWrap: preserve` (`npm run lint` must stay clean).
- `users.username` COLLATE NOCASE lives only in schema.sql — irrelevant here (no user table rebuild).

---

### Task 1: `refresh_tokens` table (schema + migration)

**Objective:** DB storage for refresh tokens, hashed, one-active-per-user optional (multiple devices allowed — each login creates its own row; see Task 3 rationale).

**Files:**
- Modify: `apps/api/src/db/schema.ts` (after `emailVerificationTokens`, ~line 997)
- Create: `apps/api/drizzle/00NN_refresh_tokens.sql` (generated)

**Step 1: Add to schema.ts**

```ts
/**
 * Jetons de rafraîchissement — un par appareil/session, SHA-256 uniquement
 * (le jeton brut ne vit que chez le client). Durée de vie 30 jours, glissante :
 * chaque /refresh consomme le jeton et en émet un neuf (rotation), repoussant
 * la fenêtre de 30 jours — un appareil actif ne se déconnecte jamais seul.
 * revokedAt = déconnexion explicite (logout) ou changement de mot de passe.
 */
export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique('refresh_tokens_hash_unique'),
    expiresAt: text('expires_at').notNull(),
    // NULL = actif ; renseigné à la révocation (logout / rotation sur échec).
    revokedAt: text('revoked_at'),
    // Tracing de la chaîne de rotation (famille de jetons) — détection de réutilisation.
    rotatedFromId: integer('rotated_from_id'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index('idx_refresh_tokens_user').on(t.userId)],
);
```

**Step 2:** `npm -w api run db:generate` → verify new `apps/api/drizzle/00NN_refresh_tokens.sql` contains `CREATE TABLE refresh_tokens`.

**Step 3:** Boot check: `docker compose up --build api` (dev: `npm run dev`) → logs show migration applied, no boot error. Commit.

---

### Task 2: `issueRefreshToken()` + `rotateRefreshToken()` helpers

**Objective:** Single place where refresh tokens are minted/consumed, transaction-safe.

**Files:**
- Create: `apps/api/src/auth/refresh.ts`

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { getDrizzle } from '../db';
import { refreshTokens, users } from '../db/schema';
import { sanitizeUser } from './user-helpers'; // ADJUST to wherever sanitizeUser lives

/** Durée de vie du jeton de rafraîchissement (30 jours, glissante). */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** crypto.randomUUID() x2 = 244 bits d'entropie, URL-safe. */
function newRawToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

export function issueRefreshToken(userId: number, req: any): string {
  const raw = newRawToken();
  getDb().transaction(() => {
    getDrizzle()
      .insert(refreshTokens)
      .values({
        userId,
        tokenHash: sha256Hex(raw),
        expiresAt: daysFromNow(REFRESH_TOKEN_TTL_DAYS),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        ipAddress: req.ip ?? null,
        rotatedFromId: null,
      })
      .run();
  })();
  return raw;
}
```

`rotateRefreshToken(rawToken)`: lookup by hash → validate (not revoked, not expired) → transaction { revoke old (set `revokedAt`), insert new row with `rotatedFromId = old.id` } → return `{ raw, userId, oldRow }`. On failure return null (route decides 401).

Reuse `sha256Hex` — export it from `auth.ts` or move to a shared `apps/api/src/auth/tokens.ts` (prefer move; Task 3 wires imports).

**Verification:** `npx tsx -e` smoke: insert+rotate+re-rotate, then assert old raw token fails. Commit.

---

### Task 3: Auth routes mint + return refresh tokens

**Objective:** login/register/reset responses gain `refreshToken`; logout revokes.

**Files:**
- Modify: `apps/api/src/routes/auth.ts:185,210,575` (3 sign sites), `:745` (logout)

Each site becomes:

```ts
const token = app.jwt.sign({ sub: user.id, username: user.username });
const refreshToken = issueRefreshToken(user.id, req);
return reply.send({ token, refreshToken, user });
```

Logout (`POST /logout`, currently no-op):

```ts
app.post('/logout', async (req, reply) => {
  const raw = req.headers['x-refresh-token'];
  if (typeof raw === 'string' && raw) {
    getDrizzle()
      .update(refreshTokens)
      .set({ revokedAt: sql`datetime('now')` })
      .where(and(eq(refreshTokens.tokenHash, sha256Hex(raw)), isNull(refreshTokens.revokedAt)))
      .run();
  }
  return reply.send({ ok: true });
});
```

(Client sends `x-refresh-token` header — no body, keeps route public/no-JWT as today. Note logout is in the public allowlist `server.ts:121` — fine: it's a token revocation, not an auth-required op.)

**Verification:** `npm run test-api` — existing tests assert `token` field; they keep passing (additive). Commit.

---

### Task 3b: `POST /api/auth/refresh` route

**Objective:** The core endpoint. Public (no JWT — the refresh token IS the credential).

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (new route) + `apps/api/src/server.ts:117-127` (allowlist entry `url === '/api/auth/refresh'`)

```ts
// ---------- Refresh (public : le refresh token EST la preuve) ----------
app.post('/refresh', async (req: FastifyRequest<{ Body: { refreshToken?: string } }>, reply) => {
  const raw = req.body?.refreshToken;
  if (!raw) return reply.code(400).send({ error: apiMsg(req, 'jeton de rafraîchissement requis') });

  const result = rotateRefreshToken(String(raw));
  if (!result) {
    // Réutilisation ou jeton inconnu/révoqué/expiré : 401, le client purgera.
    return reply.code(401).send({ error: apiMsg(req, 'jeton de rafraîchissement invalide ou expiré') });
  }

  // Hygiène : purge des jetons expirés/révoqués de plus de 30 j (best effort).
  drizzle.delete(refreshTokens).where(lt(refreshTokens.expiresAt, sql`datetime('now', '-30 day')`)).run();

  const userRow = /* fetch user by result.userId */;
  if (!userRow) return reply.code(401).send({ error: apiMsg(req, 'utilisateur introuvable') });
  const user = sanitizeUser(userRow);
  const token = app.jwt.sign({ sub: user.id, username: user.username });
  return reply.send({ token, refreshToken: result.raw, user });
});
```

Add reuse detection: if `rotateRefreshToken` finds the hash with `revokedAt` set AND `revokedAt` within the last 30 days AND row's successor chain active → revoke ALL tokens for that user (token-family kill, Auth0 pattern). Keep simple: **revoked-token reuse → revoke entire family for that user** (delete all rows where userId = X). Log warn.

**Verification:** `npm run test-api` + manual curl sequence below (Task 6). Commit.

---

### Task 4: Web client — store & transparent refresh (single-flight)

**Objective:** Client keeps `dnd-inv-refresh` in localStorage; refreshes on boot & on 401 before purging.

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/auth.tsx`, `apps/web/src/sync.tsx`, `apps/web/src/pages/Login.tsx` (if it reads res.data directly)

**api.ts changes:**
1. Request interceptor: attach JWT as today (unchanged).
2. New `refreshSession()` (exported):

```ts
let refreshing: Promise<string | null> | null = null;
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    const rt = localStorage.getItem('dnd-inv-refresh');
    if (!rt) return null;
    try {
      // axios instance SANS intercepteur (pas de récursion 401→refresh→401)
      const res = await axios.post(
        `${API_BASE}/api/auth/refresh`,
        { refreshToken: rt },
        { headers: { 'Accept-Language': appLang() }, timeout: 15_000 },
      );
      localStorage.setItem('dnd-inv-token', res.data.token);
      localStorage.setItem('dnd-inv-refresh', res.data.refreshToken);
      localStorage.setItem('dnd-inv-user', JSON.stringify(res.data.user));
      return res.data.token;
    } catch {
      localStorage.removeItem('dnd-inv-token');
      localStorage.removeItem('dnd-inv-refresh');
      localStorage.removeItem('dnd-inv-user');
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
```


3. Response interceptor rewrite:

```ts
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    const cfg = err?.config;
    if (status === 401 && !cfg?._retried) {
      const token = await refreshSession();
      if (token) {
        cfg._retried = true;
        cfg.headers.Authorization = `Bearer ${token}`;
        return api(cfg); // rejoue la requête avec le jeton neuf
        // NOTE: intercepteur request RE-lit localStorage → pas de param à passer
      }
    }
    if (status === 401) {
      purgeSession(); // helper central : removeItem x3
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    purgeSession() must NOT run when refresh succeeded — structure the if/else carefully.
  },
);
```

**auth.tsx changes:**
- On boot (`useEffect`): if `dnd-inv-token` exists but 401 from `/me` → try `refreshSession()` first; only purge if that fails. (Currently lines 60-85.)
- `login`/`register`/`adoptSession`: store `refreshToken` from `res.data`.
- `logout`: fire-and-forget `api.post('/api/auth/logout', {}, { headers: { 'x-refresh-token': rt } })` then purge localStorage.

**sync.tsx changes (WS reconnect):**
- In the 3 reconnect call sites (`:217, :256, :327`) + `:344` token read: before `connect(savedToken)`, if a refresh is needed… simplest robust path: attempt `refreshSession()` (await) then `connect(localStorage.getItem('dnd-inv-token'))`. Wrap in try/catch; on null → existing disconnect UI.

**Verification:** `npx tsc -b` (web must stay CLEAN — hard CI gate), `npm run lint`. Commit.

---

### Task 5: E2E test — expiry survival

**Objective:** Prove the headline scenario: JWT expires mid-use, app survives via refresh.

**Files:**
- Create: `e2e/auth-refresh.spec.ts`

**Test flow (Playwright, using existing `seed()` fixtures from `e2e/fixtures.ts`):**
1. Login via UI → app loads → assert logged in.
2. Evaluate in page: decode JWT payload (`atob(base64)` of middle segment) → `exp` — set `localStorage.dnd-inv-token` to a crafted expired token (sign offline with the test JWT secret — read from env like other tests do; if not exported, boot server with known `JWT_SECRET=test-secret` in the throwaway stack, which e2e already does).
```
3. Reload → expect NOT redirected to /login; expect a working authenticated request (e.g. character list renders).
4. Assert `localStorage.dnd-inv-refresh` ROTATED (value ≠ initial).
5. Assert old refresh token now 401s (direct fetch to /api/auth/refresh with old token → 401).
6. Logout → reload → login page; direct refresh with the latest token → 401.

**Step:** Run `npm run test:e2e -- e2e/auth-refresh.spec.ts`. Expected: PASS. Commit.

---

### Task 6: API integration tests

**Files:**
- Modify: `scripts/api-tests/` (add `auth-refresh.ts` harness test if that's the convention — check `harness.ts`).

Cover:
1. login → `refreshToken` present; `/refresh` mints new pair; old token re-use → 401 + family revoked.
2. expired refresh (insert row with past `expiresAt` via SQL) → 401.
3. logout with `x-refresh-token` → refresh attempt 401.
4. `/api/auth/refresh` is in the public allowlist (works with no JWT).
4b. **Password change revokes all refresh tokens** — wait, that's Task 8. Keep here only: password-change → all refresh tokens revoked (fetch DB directly or attempt refresh → 401).

**Run:** `npm run test-api`. Commit.

---

### Task 7: WS reconnection with expired token

**Files:**
- Modify: `apps/web/src/sync.tsx` (covered in Task 4 changes, call sites `:217, :256, :327`)

Acceptance: unit-level confidence via the axios interceptor change + e2e scenario simulating offline >7d:
- Existing `e2e/offline-resync.spec.ts` covers offline scenarios — extend it or add to `auth-refresh.spec.ts`: set expired JWT + valid refresh token, reload, assert WS status indicator returns to "connecté".

---

### Task 8: Password change revokes all refresh tokens

**Objective:** Security hygiene — a password change must kill every device session.

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (password-update route, ~line 700-745)

```ts
// Après le hash du nouveau mot de passe :
getDrizzle().delete(refreshTokens).where(eq(refreshTokens.userId, user.id)).run();
```

**Test:** in Task 6 suite. **Run:** `npm run test-api`. Commit.

---

### Task 9: Final gates + docs

1. `npm run lint` — clean.
2. `npm run test-api` — all green.
3. `npm run test:e2e` — all green.
4. `npx tsc -b` — web clean (hard gate).
5. Update `AGENTS.md` auth section (one line: refresh tokens, rotation, 30d, logout revokes).
6. `git log --oneline` sanity; PR via `agent-pr-delivery` skill / user's squash-merge convention.

---

## Risks / tradeoffs / open questions

- **localStorage refresh token = XSS-exposed** (same as today's JWT; Better Auth bearer docs warn the same). Family revocation on reuse mitigates. HttpOnly cookies would be the stricter path but are a bigger migration (CSRF, WS) — explicitly out of scope.
- **Existing sessions at deploy:** users logged in today have no `dnd-inv-refresh` → first 401 after their 7d JWT expires purges + /login as today, then they get a pair on next login. Acceptable one-time transition. (Alternative: issue on next /me — NOT worth it, YAGNI.)
- **Concurrent refresh calls** (multi-tab): single-flight per tab; rotation makes cross-tab races possible (tab B uses token tab A already rotated → family kill!). Mitigation: single-flight is per-tab; multi-tab localStorage events can be added later if it bites. **Open question for implementer:** consider a small broadcast via `storage` event to sync the pair across tabs — cheap, but decide during implementation and document in the PR.
- **JWT secret rotation:** unaffected (refresh flow re-fetches user, re-signs).
- **No clock-skew grace on refresh expiry** — 30d is generous; strict is fine.

## Files likely to change (summary)

- `apps/api/src/db/schema.ts` + generated `apps/api/drizzle/00NN_*.sql`
- `apps/api/src/auth/refresh.ts` (new) + `sha256Hex` extraction
- `apps/api/src/routes/auth.ts` (login/register/reset/logout/refresh + password change)
- `apps/api/src/server.ts` (public allowlist)
- `apps/web/src/api.ts` (interceptor + `refreshSession()`)
- `apps/web/src/auth.tsx` (boot path, login/register/logout)
- `apps/web/src/sync.tsx` (WS reconnect)
- `e2e/auth-refresh.spec.ts` (new) + `scripts/api-tests/` additions
- `AGENTS.md`
