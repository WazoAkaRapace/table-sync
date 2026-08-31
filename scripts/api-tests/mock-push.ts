/**
 * In-process mock of a browser push service for `npm run test-api`.
 *
 * Web Push delivery is an HTTPS POST to the subscription's endpoint URL —
 * and the web-push library hardcodes the `https` module, so the mock MUST
 * serve TLS. It generates a throwaway self-signed certificate via openssl
 * (cached per machine) and exposes its path: the harness passes it as
 * NODE_EXTRA_CA_CERTS to the API server, which then trusts the mock without
 * disabling TLS validation anywhere.
 *
 * Tests subscribe with endpoint = `${url}/<device>`; the mock records every
 * POST (headers + encrypted body) and serves per-path statuses (404/410) to
 * exercise dead-subscription cleanup. Real crypto still flows: web-push
 * signs (VAPID) and encrypts (aes128gcm) before POSTing — those headers are
 * part of the assertions.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MockPushRequest {
  /** Device path ('/device-a') — the subscription's endpoint suffix. */
  path: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

export interface MockPushHandle {
  /** HTTPS base URL — subscribe with endpoint = `${url}/<device>`. */
  url: string;
  /** Self-signed cert path — pass to the API as NODE_EXTRA_CA_CERTS. */
  certPath: string;
  requests: MockPushRequest[];
  /** Per-path response status (default 201). Set 404/410 to kill a device. */
  statuses: Map<string, number>;
  reset: () => void;
  stop: () => Promise<void>;
}

// Cached per machine: openssl signing takes ~100 ms and nothing rotates.
const CERT_DIR = join(tmpdir(), 'dnd-push-mock-cert');

function ensureTestCert(): { keyPath: string; certPath: string } {
  const keyPath = join(CERT_DIR, 'key.pem');
  const certPath = join(CERT_DIR, 'cert.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    mkdirSync(CERT_DIR, { recursive: true });
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
        -keyout ${keyPath} -out ${certPath} \
        -subj "/CN=127.0.0.1" \
        -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
        -addext "basicConstraints=critical,CA:TRUE"`,
      { stdio: 'pipe' },
    );
  }
  return { keyPath, certPath };
}

export async function startMockPush(): Promise<MockPushHandle> {
  const { keyPath, certPath } = ensureTestCert();
  const requests: MockPushRequest[] = [];
  const statuses = new Map<string, number>();

  const handle = (req: IncomingMessage, res: any) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0];
      requests.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
      const status = statuses.get(path) ?? 201;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status }));
    });
  };

  const server: Server = createHttpsServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    handle,
  );
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as { port: number }).port;
  return {
    url: `https://127.0.0.1:${port}`,
    certPath,
    requests,
    statuses,
    reset: () => {
      requests.length = 0;
      statuses.clear();
    },
    stop: () =>
      new Promise<void>((resolveStop) => {
        server.close(() => resolveStop());
        setTimeout(resolveStop, 1000).unref?.();
      }),
  };
}
