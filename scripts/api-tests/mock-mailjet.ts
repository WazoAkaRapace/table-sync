/**
 * In-process mock of the Mailjet Send API v3.1 for `npm run test-api`.
 *
 * The email provider is our own fetch code, so no TLS dance is needed (unlike
 * mock-push.ts): the harness points MAILJET_API_URL at this plain-HTTP server.
 * Records every request (auth header + body) for payload assertions; the
 * response is the Mailjet success envelope by default — flip `status` (and
 * optionally `responseBody`) to stage provider failures.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockMailjetRequest {
  method: string;
  path: string;
  authorization: string;
  body: any;
}

export interface MockMailjetHandle {
  /** Base URL to pass as MAILJET_API_URL. */
  url: string;
  /** Every request so far, in order — assert outbound payloads here. */
  requests: MockMailjetRequest[];
  /** Response status for /send — 200 (success envelope) by default. */
  status: number;
  responseBody: string;
  reset: () => void;
  stop: () => Promise<void>;
}

export async function startMockMailjet(): Promise<MockMailjetHandle> {
  const handle: MockMailjetHandle = {
    url: '',
    requests: [],
    status: 200,
    responseBody: '{"Messages":[{"Status":"success"}]}',
    reset() {
      handle.requests = [];
      handle.status = 200;
      handle.responseBody = '{"Messages":[{"Status":"success"}]}';
    },
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  const server: Server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      handle.requests.push({
        method: req.method || '',
        path: req.url || '/',
        authorization: req.headers.authorization || '',
        body,
      });
      res.writeHead(handle.status, { 'Content-Type': 'application/json' });
      res.end(handle.responseBody);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  handle.url = `http://127.0.0.1:${port}`;
  return handle;
}
