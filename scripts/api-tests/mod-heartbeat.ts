/**
 * Heartbeat WebSocket : le serveur balaye ses clients au ping protocole et
 * répond aux sondes applicatives des pages (voir l'en-tête de
 * apps/api/src/sync/ws.ts). La suite tourne à WS_HEARTBEAT_MS=0 (les modules
 * sync/stress restent déterministes : zéro trame parasite) — ce module boote
 * SA PROPRE instance à 300 ms et vérifie :
 *
 *  1. L'accusé 'connected' annonce bien heartbeat:true (le client web ne
 *     sonde que si le serveur le comprend — compatibilité montante).
 *  2. Aller-retour applicatif : {type:'ping'} → {type:'pong'} rapide.
 *  3. Le balayage protocole est réellement vu par un client sain (le `ws`
 *     de Node compte les trames ping) — et le client sain SURVIT à de
 *     nombreux balayages : l'auto-pong du `ws` le garde vivant.
 *  4. Un client MUET — socket TCP nu : poignée de main puis silence, la
 *     tablette disparue sans trame close — est débranché (terminate()) après
 *     ~2 balayages sans vie : EOF/RST côté client.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { connect as netConnect, type Socket } from 'node:net';
import { type Fixtures, ok, registerUser, type ServerHandle, startServer } from './harness.ts';

const require = createRequire(import.meta.url);
const Ws = require('ws');

function waitUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (pred()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timeout (${timeoutMs} ms) : ${what}`));
      }
    }, 20);
  });
}

/**
 * Poignée de main WebSocket à la main sur un socket TCP nu, puis silence
 * éternel : côté serveur c'est un client parfaitement enregistré qui ne
 * répondra jamais aux pings. (Le `ws` de Node auto-ponge toujours — pour
 * simuler le mort il faut passer sous la bibliothèque.)
 */
function openSilentSocket(base: string, token: string): Promise<Socket> {
  const url = new URL(base);
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const sock = netConnect(Number(url.port), url.hostname);
    const fail = (e: unknown) => {
      sock.destroy();
      reject(new Error(`silent socket : ${String(e)}`));
    };
    sock.once('error', fail);
    sock.once('connect', () => {
      sock.write(
        `GET /ws?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
          `Host: ${url.host}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    let handshake = '';
    const onData = (d: Buffer) => {
      handshake += d.toString('latin1');
      if (!handshake.includes('\r\n\r\n')) return;
      if (!handshake.startsWith('HTTP/1.1 101')) {
        fail(`handshake inattendu — ${handshake.slice(0, 60)}`);
        return;
      }
      // 101 reçu : le serveur nous compte. On se tait pour toujours (les
      // trames 'connected' et pings suivantes dorment dans le tampon TCP).
      sock.removeListener('data', onData);
      resolve(sock);
    };
    sock.on('data', onData);
  });
}

export async function run(_base: string, _fx: Fixtures, _srv: ServerHandle): Promise<void> {
  console.log('    [heartbeat] boot dédié WS_HEARTBEAT_MS=300…');
  const srv = await startServer({ extraEnv: { WS_HEARTBEAT_MS: '300' } });
  try {
    const user = await registerUser(srv.base, 'coeur');

    // ---------- Client sain (ws) : accusé, sondes, survie au balayage ----------
    const ws: any = new Ws(`${srv.base.replace(/^http/, 'ws')}/ws`, [user.token]);
    const messages: any[] = [];
    let protocolPings = 0;
    let closed = false;
    const errors: string[] = [];
    ws.on('message', (data: unknown) => {
      try {
        messages.push(JSON.parse(String(data)));
      } catch {
        errors.push('trame non-JSON reçue');
      }
    });
    ws.on('ping', () => {
      protocolPings++;
    });
    ws.on('close', () => {
      closed = true;
    });
    ws.on('error', (e: Error) => {
      errors.push(String(e?.message || e));
    });
    await waitUntil(
      () => messages.some((m) => m.type === 'connected'),
      5000,
      "l'accusé 'connected' du client sain",
    );

    // 1. Le serveur annonce la compatibilité sondes.
    const ack = messages.find((m) => m.type === 'connected');
    ok(
      ack?.heartbeat === true,
      `l'accusé connected annonce heartbeat:true — reçu ${JSON.stringify(ack)}`,
    );

    // 2. Aller-retour applicatif immédiat.
    const sentAt = Date.now();
    ws.send(JSON.stringify({ type: 'ping' }));
    await waitUntil(() => messages.some((m) => m.type === 'pong'), 2000, 'la réponse pong');
    const rtt = Date.now() - sentAt;
    ok(rtt < 1000, `ping applicatif → pong : ${rtt} ms (aller-retour local)`);

    // 3. Le balayage protocole tourne : ≥ 2 pings vus en ~600 ms, et le
    // client sain (auto-pong) les encaisse SANS être débranché.
    await waitUntil(() => protocolPings >= 2, 5000, 'au moins 2 pings protocole du balayage');

    // ---------- Client muet : le fantôme est débranché ----------
    const silent = await openSilentSocket(srv.base, user.token);
    const culled = new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('timeout : le client muet n a pas été débranché (5 s)')),
        5000,
      );
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      silent.once('close', done);
      silent.once('end', done);
      silent.once('error', done); // terminate() → RST selon la pile
    });
    await culled;

    // ---------- Verdict final du client sain : toujours vivant ----------
    // ~10+ balayages plus tard, jamais fermé, aucun pong manqué ne l'a tué.
    const survivedPings = protocolPings;
    await waitUntil(() => protocolPings >= survivedPings + 2, 5000, 'le balayage continue');
    ok(!closed, 'le client sain n a jamais été fermé par le balayage');
    ok(errors.length === 0, `le client sain est sans erreur — ${errors.join(', ')}`);
    ok(ws.readyState === 1, 'le client sain est toujours OPEN');
    const unknown = messages.filter((m) => !['connected', 'pong'].includes(m.type));
    ok(unknown.length === 0, `aucun message applicatif inattendu — ${JSON.stringify(unknown)}`);

    try {
      ws.close();
    } catch {
      /* déjà fermé */
    }
  } finally {
    await srv.stop();
  }
}
