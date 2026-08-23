/**
 * Test harness for the API data-query test suite (npm run test-api).
 *
 * Boots the real Fastify server (tsx) on a free port against a throwaway
 * SQLite DB, drives it over HTTP with rotating fake client IPs (so the
 * error-scoped rate limiter is never tripped by deliberate 4xx probes),
 * and exposes a read-only second connection to the same DB for direct
 * state assertions.
 *
 * With DB_SQL_TRACE set (the runner always sets it), db/index.ts records
 * every prepared statement + callsite — coverage.ts turns that trace into
 * the per-query-site coverage gate.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');

const JWT_SECRET = 'test-api-fixed-secret';

// ---------- asserts ----------

let failures = 0;

export function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    failures++;
    throw new Error(`assert failed: ${msg}`);
  }
}

export function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    failures++;
    throw new Error(
      `assert failed: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function includes(haystack: unknown[], needle: unknown, msg: string): void {
  if (!haystack.includes(needle)) {
    failures++;
    throw new Error(
      `assert failed: ${msg} — ${JSON.stringify(needle)} not in ${JSON.stringify(haystack)}`,
    );
  }
}

export function approximate(
  actual: number,
  expected: number,
  tolerance: number,
  msg: string,
): void {
  if (Math.abs(actual - expected) > tolerance) {
    failures++;
    throw new Error(`assert failed: ${msg} — expected ≈${expected}, got ${actual}`);
  }
}

export function failureCount(): number {
  return failures;
}

// ---------- HTTP ----------

let ipCounter = 0;
function nextIp(): string {
  ipCounter = (ipCounter % 250) + 1;
  return `198.51.100.${ipCounter}`;
}

export interface ApiResponse {
  status: number;
  data: any;
}

export async function api(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'x-real-ip': nextIp() };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  if (res.status !== 204) {
    data = await res.json().catch(() => null);
  }
  return { status: res.status, data };
}

/** Mint a JWT for a user id directly (HS256, same secret as the test server). */
export function mintToken(userId: number): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, username: 'forged' });
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ---------- server lifecycle ----------

function freePort(preferred: number): Promise<number> {
  return new Promise((resolvePort) => {
    const srv: Server = createServer();
    srv.listen(preferred, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolvePort(port));
    });
    srv.on('error', () => {
      // preferred taken — grab an ephemeral one
      const srv2: Server = createServer();
      srv2.listen(0, '127.0.0.1', () => {
        const { port } = srv2.address() as { port: number };
        srv2.close(() => resolvePort(port));
      });
    });
  });
}

export interface ServerHandle {
  base: string;
  dbPath: string;
  imagesDir: string;
  tracePath: string;
  serverLog: string;
  child: ChildProcess;
  /** Read-only query against the live test DB (WAL allows concurrent readers). */
  query: (sql: string, ...params: unknown[]) => any;
  queryAll: (sql: string, ...params: unknown[]) => any[];
  stop: () => Promise<void>;
}

export async function startServer(): Promise<ServerHandle> {
  const port = await freePort(4611);
  const dir = mkdtempSync(join(tmpdir(), 'dnd-api-test-'));
  const dbPath = join(dir, 'test.sqlite');
  const imagesDir = join(dir, 'images');
  const tracePath = join(dir, 'trace.log');
  const serverLog = join(dir, 'server.log');

  const child = spawn('npx', ['tsx', 'apps/api/src/server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: dbPath,
      ITEM_IMAGES_PATH: imagesDir,
      JWT_SECRET,
      DB_SQL_TRACE: tracePath,
      // The harness rotates a fake x-real-ip per request precisely so the
      // error-scoped rate limiter never trips on deliberate 4xx probes —
      // trust the header here (the default, direct-exposure mode would key
      // every probe on 127.0.0.1 and 429 the suite).
      TRUST_PROXY: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logChunks: Buffer[] = [];
  child.stdout!.on('data', (d: Buffer) => logChunks.push(d));
  child.stderr!.on('data', (d: Buffer) => logChunks.push(d));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in 90s — log:\n${Buffer.concat(logChunks).toString()}`);
    }
    if (child.exitCode !== null) {
      throw new Error(
        `server exited early (code ${child.exitCode}) — log:\n${Buffer.concat(logChunks).toString()}`,
      );
    }
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  let roConn: any = null;
  const query = (sql: string, ...params: unknown[]) => {
    if (!roConn) roConn = new Database(dbPath, { readonly: true });
    return params.length > 0 ? roConn.prepare(sql).get(...params) : roConn.prepare(sql).get();
  };
  const queryAll = (sql: string, ...params: unknown[]) => {
    if (!roConn) roConn = new Database(dbPath, { readonly: true });
    return params.length > 0 ? roConn.prepare(sql).all(...params) : roConn.prepare(sql).all();
  };

  const stop = async () => {
    child.kill('SIGTERM');
    await new Promise<void>((resolveStop) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolveStop();
      }, 5000);
      child.on('exit', () => {
        clearTimeout(t);
        resolveStop();
      });
    });
    try {
      roConn?.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  };

  return { base, dbPath, imagesDir, tracePath, serverLog, child, query, queryAll, stop };
}

// ---------- fixtures ----------

export interface UserFix {
  username: string;
  token: string;
  userId: number;
}

export async function registerUser(base: string, username: string): Promise<UserFix> {
  const res = await api(base, 'POST', '/api/auth/register', {
    body: { username, password: 'password123', displayName: username.toUpperCase() },
  });
  ok(
    res.status === 201,
    `register ${username} should be 201, got ${res.status}: ${JSON.stringify(res.data)}`,
  );
  return { username, token: res.data.token, userId: res.data.user.id };
}

export async function createParty(
  base: string,
  token: string,
  name: string,
  encumbranceMode?: string,
): Promise<{ id: number; inviteCode: string }> {
  const res = await api(base, 'POST', '/api/parties', {
    token,
    body: { name, ...(encumbranceMode ? { encumbranceMode } : {}) },
  });
  ok(res.status === 201, `createParty ${name} failed: ${JSON.stringify(res.data)}`);
  return { id: res.data.party.id, inviteCode: res.data.party.inviteCode };
}

export async function createCharacter(
  base: string,
  token: string,
  partyId: number,
  body: Record<string, unknown>,
): Promise<{ id: number; name: string }> {
  const res = await api(base, 'POST', `/api/parties/${partyId}/characters`, { token, body });
  ok(res.status === 201, `createCharacter failed: ${JSON.stringify(res.data)}`);
  return { id: res.data.character.id, name: res.data.character.name };
}

/** Shared fixtures created once by the runner, available to every module. */
export interface Fixtures {
  gm: UserFix; // alice — GM of the party
  player: UserFix; // bob — player
  player2: UserFix; // carol — player
  outsider: UserFix; // dave — in his own party, not ours
  partyId: number;
  inviteCode: string;
  charAlya: { id: number }; // alice's character
  charBran: { id: number }; // bob's character
  charSecret: { id: number }; // alice's hidden character
}

export async function buildFixtures(base: string): Promise<Fixtures> {
  const gm = await registerUser(base, 'alice');
  const player = await registerUser(base, 'bob');
  const player2 = await registerUser(base, 'carol');
  const outsider = await registerUser(base, 'dave');
  const party = await createParty(base, gm.token, 'Compagnie de Test');

  const join = await api(base, 'POST', '/api/parties/join', {
    token: player.token,
    body: { inviteCode: party.inviteCode },
  });
  ok(join.status === 201, 'bob joins party');

  const charAlya = await createCharacter(base, gm.token, party.id, {
    name: 'Alya',
    strength: 14,
    dexterity: 12,
    maxHp: 20,
    level: 5,
  });
  const charBran = await createCharacter(base, player.token, party.id, {
    name: 'Bran',
    strength: 8,
    dexterity: 16,
    maxHp: 12,
    level: 5,
  });
  const charSecret = await createCharacter(base, gm.token, party.id, {
    name: 'Ombre',
    hidden: true,
    maxHp: 10,
  });
  return {
    gm,
    player,
    player2,
    outsider,
    partyId: party.id,
    inviteCode: party.inviteCode,
    charAlya,
    charBran,
    charSecret,
  };
}
