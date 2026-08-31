/**
 * Push notifications: config gate, subscribe (validation + upsert),
 * ownership-scoped unsubscribe, test-send over REAL web-push crypto
 * (VAPID signature + aes128gcm encryption → recorded by the mock push
 * service), dead-subscription cleanup on 410, and the VAPID-less disabled
 * path (separate server boot).
 *
 * Subscription endpoints point at the in-process mock (mock-push.ts); keys
 * are genuine P-256 material because web-push encrypts to the p256dh key —
 * random bytes would fail before any HTTP reaches the mock.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { api, eq, type Fixtures, ok, type ServerHandle, startServer } from './harness.ts';

/** Genuine P-256 subscription keys (base64url, like a real browser). */
function makeSubscriptionKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const mock = srv.push;
  const keysA = makeSubscriptionKeys();
  const keysB = makeSubscriptionKeys();
  const endpointA = `${mock.url}/device-a`;
  const endpointB = `${mock.url}/device-b`;

  // ---------- config gate ----------
  let r = await api(base, 'GET', '/api/push/config', { token: fx.player.token });
  eq(r.status, 200, 'config responds');
  eq(r.data.enabled, true, 'VAPID configured in tests');
  ok(
    typeof r.data.publicKey === 'string' && r.data.publicKey.length > 20,
    'config exposes the public key',
  );
  r = await api(base, 'GET', '/api/push/config');
  eq(r.status, 401, 'config requires auth');

  // ---------- subscribe: validation ----------
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: 'http://insecure.example/push', keys: keysA },
  });
  eq(r.status, 400, 'non-https endpoint rejected');
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: endpointA, keys: { p256dh: keysA.p256dh } },
  });
  eq(r.status, 400, 'missing auth key rejected');

  // ---------- subscribe: insert + locale ----------
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: endpointA, keys: keysA },
  });
  eq(r.status, 201, 'device A subscribed');
  let row = srv.query('SELECT * FROM push_subscriptions WHERE endpoint = ?', endpointA);
  eq(row.user_id, fx.player.userId, 'row owned by subscriber');
  eq(row.locale, 'fr', 'locale defaults to fr');

  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: endpointB, keys: keysB },
    headers: { 'accept-language': 'en-US,en;q=0.9' },
  });
  eq(r.status, 201, 'device B subscribed under locale en');
  eq(
    srv.query('SELECT locale FROM push_subscriptions WHERE endpoint = ?', endpointB).locale,
    'en',
    'accept-language captured at subscribe time',
  );

  // ---------- subscribe: upsert (keys rotate, same endpoint) ----------
  const keysA2 = makeSubscriptionKeys();
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: endpointA, keys: keysA2 },
  });
  eq(r.status, 201, 're-subscribe upserts');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', fx.player.userId).n,
    2,
    'still two devices — no duplicate row',
  );
  row = srv.query('SELECT * FROM push_subscriptions WHERE endpoint = ?', endpointA);
  eq(row.p256dh, keysA2.p256dh, 'rotated key stored');

  // ---------- unsubscribe: ownership-scoped ----------
  r = await api(base, 'POST', '/api/push/unsubscribe', {
    token: fx.outsider.token,
    body: { endpoint: endpointA },
  });
  eq(r.status, 204, 'unsubscribe is idempotent 204');
  ok(
    srv.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?', endpointA).n === 1,
    "another user's unsubscribe does not touch the row",
  );
  r = await api(base, 'POST', '/api/push/unsubscribe', {
    token: fx.player.token,
    body: { endpoint: endpointA },
  });
  eq(r.status, 204, 'own unsubscribe');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?', endpointA).n,
    0,
    'row gone',
  );

  // ---------- test send: real VAPID + encryption through the mock ----------
  r = await api(base, 'POST', '/api/push/test', { token: fx.player.token });
  eq(r.status, 200, 'test send responds');
  eq(r.data.sent, 1, 'one device reached (device B)');
  eq(r.data.removed, 0, 'nothing cleaned');
  const hit = mock.requests.find((req) => req.path === '/device-b');
  ok(!!hit, 'push POST landed on the mock endpoint');
  if (hit) {
    eq(String(hit.headers.ttl), '60', 'TTL honored');
    eq(String(hit.headers.urgency), 'normal', 'urgency honored');
    ok(
      String(hit.headers.authorization ?? '').startsWith('vapid '),
      'VAPID Authorization header signed',
    );
    eq(String(hit.headers['content-encoding']), 'aes128gcm', 'payload encrypted per RFC 8291');
    ok(hit.body.length > 0, 'encrypted body present');
  }
  ok(
    !!srv.query('SELECT last_used_at FROM push_subscriptions WHERE endpoint = ?', endpointB)
      .last_used_at,
    'last_used_at stamped on successful send',
  );

  // ---------- dead subscription: 410 → row removed ----------
  mock.statuses.set('/device-b', 410);
  r = await api(base, 'POST', '/api/push/test', { token: fx.player.token });
  eq(r.status, 200, 'test send still 200 after cleanup');
  eq(r.data.sent, 0, 'nothing delivered');
  eq(r.data.removed, 1, 'dead subscription reported');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?', endpointB).n,
    0,
    'dead row deleted',
  );
  mock.reset();

  // ---------- VAPID-less boot: feature disabled, storage unaffected ----------
  const bare = await startServer({ withoutVapid: true });
  try {
    // Same JWT_SECRET on both boots and requireUser() reads the token's sub
    // without a DB lookup — the main run's token authenticates fine here,
    // but its user ROW doesn't exist in the bare DB (FK on subscribe), so
    // the storage assertions use a user registered on this boot.
    r = await api(bare.base, 'GET', '/api/push/config', { token: fx.player.token });
    eq(r.status, 200, 'config responds');
    eq(r.data.enabled, false, 'no VAPID → disabled');
    eq(r.data.publicKey, null, 'no public key exposed');
    const reg = await api(bare.base, 'POST', '/api/auth/register', {
      body: {
        username: 'pushless',
        password: 'password123',
        displayName: 'Pushless',
        email: 'pushless@example.com',
      },
    });
    eq(reg.status, 201, 'fresh user on the bare boot');
    const token = reg.data.token;
    const sub = await api(bare.base, 'POST', '/api/push/subscribe', {
      token,
      body: { endpoint: 'https://push.example/dev', keys: makeSubscriptionKeys() },
    });
    eq(sub.status, 201, 'subscriptions still stored when disabled');
    const test = await api(bare.base, 'POST', '/api/push/test', { token });
    eq(test.status, 503, 'test send refuses when disabled');
    ok(String(test.data.error).includes('VAPID'), 'disabled error mentions VAPID');
  } finally {
    await bare.stop();
  }
}
