/**
 * Push notifications: config gate, subscribe (validation + upsert),
 * ownership-scoped unsubscribe, test-send over REAL web-push crypto
 * (VAPID signature + aes128gcm encryption → recorded by the mock push
 * service), dead-subscription cleanup on 410, the VAPID-less disabled path
 * (separate server boot), and the combat triggers (« lance ton initiative »
 * when the GM adds players, « À toi de jouer » on start/turn advance) whose
 * payloads are DECRYPTED per RFC 8291 — the test holds the subscription's
 * private key, so kind/url/tag/title are assertable for real.
 *
 * Subscription endpoints point at the in-process mock (mock-push.ts); keys
 * are genuine P-256 material because web-push encrypts to the p256dh key —
 * random bytes would fail before any HTTP reaches the mock.
 */
import { createDecipheriv, createECDH, type ECDH, hkdfSync, randomBytes } from 'node:crypto';
import { api, eq, type Fixtures, ok, type ServerHandle, startServer } from './harness.ts';
import type { MockPushRequest } from './mock-push.ts';

/** Genuine P-256 subscription keys (base64url, like a real browser). */
export function makeSubscriptionKeys(): { ecdh: ECDH; p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    ecdh,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

/**
 * Decrypt an aes128gcm push body (RFC 8291). Key schedule: PRK from the ECDH
 * secret + auth secret ("WebPush: info"), then CEK/nonce from the header
 * salt; the last 16 ciphertext bytes are the GCM tag, and the plaintext ends
 * with the RFC 8188 padding delimiter (0x02, optional trailing zeros).
 */
export function decryptPushBody(ecdh: ECDH, auth: string, body: Buffer): any {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const eph = body.subarray(21, 21 + idlen); // server ephemeral public key
  const ciphertext = body.subarray(21 + idlen);
  const ikm = ecdh.computeSecret(eph);
  const uaPublic = Buffer.from(ecdh.getPublicKey());
  const prk = Buffer.from(
    hkdfSync(
      'sha256',
      ikm,
      Buffer.from(auth, 'base64url'),
      Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, eph]),
      32,
    ),
  );
  const cek = Buffer.from(
    hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  let end = plaintext.length;
  if (plaintext[end - 1] === 0x01) end -= 1;
  else if (plaintext[end - 1] === 0x02) {
    while (end > 0 && plaintext[end - 1] === 0x00) end--;
    end -= 1;
  }
  return JSON.parse(plaintext.subarray(0, end).toString('utf8'));
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
    // Déchiffré : le test porte `force` — le SW supprime les push quand
    // l'app est visible, or on teste justement app ouverte ; sans force le
    // bouton « ne fait rien » (régression vécue).
    const testPayload = decryptPushBody(keysB.ecdh, keysB.auth, hit.body);
    eq(testPayload.kind, 'test', 'test push kind');
    eq(testPayload.force, true, 'test push forces display even with app visible');
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

  // ---------- combat triggers: « lance ton initiative » + « À toi de jouer » ----------
  // Server-side triggers are fire-and-forget (the route answers before the
  // push POST completes) — we poll the mock until the notification lands,
  // then decrypt its body to assert kind/url/tag. `seen` remembers already
  // consumed requests so a second wait for the same kind returns the NEXT
  // push (turn notifications share a tag but are separate POSTs).
  const seen = new Set<MockPushRequest>();
  const waitForPush = async (
    path: string,
    keys: { ecdh: ECDH; auth: string },
    kind: string,
    timeoutMs = 5000,
  ): Promise<{ payload: any; req: MockPushRequest }> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const req of mock.requests) {
        if (req.path !== path || seen.has(req)) continue;
        seen.add(req);
        const payload = decryptPushBody(keys.ecdh, keys.auth, req.body);
        if (payload.kind === kind) return { payload, req };
      }
      if (Date.now() > deadline) {
        throw new Error(`push '${kind}' never arrived on ${path}`);
      }
      await new Promise((res) => setTimeout(res, 150));
    }
  };

  const keysBob = makeSubscriptionKeys();
  const keysGm = makeSubscriptionKeys();
  const bobEndpoint = `${mock.url}/bob-device`;
  const gmEndpoint = `${mock.url}/gm-device`;
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: bobEndpoint, keys: keysBob },
  });
  eq(r.status, 201, 'bob device subscribed for combat triggers');
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: fx.gm.token,
    body: { endpoint: gmEndpoint, keys: keysGm },
  });
  eq(r.status, 201, 'gm device subscribed for combat triggers');

  // Adding players to an encounter = the fight starts for them: the app
  // asks for initiative (the GM cannot start without it) — each owner gets
  // one push deep-linking to their sheet with the initiative UI expanded.
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/encounters`, {
    token: fx.gm.token,
    body: { name: 'Siège de la forge' },
  });
  eq(r.status, 201, 'encounter for combat push triggers');
  const pushEnc = r.data.encounter;
  const goblin = srv.query("SELECT slug FROM monsters WHERE name_fr LIKE '%obelin%' LIMIT 1");
  r = await api(base, 'POST', `/api/encounters/${pushEnc.id}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: goblin.slug, count: 1 },
  });
  eq(r.status, 201, 'monster added (no push expected for it)');
  r = await api(base, 'POST', `/api/encounters/${pushEnc.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterIds: [fx.charBran.id, fx.charAlya.id] },
  });
  eq(r.status, 201, 'players added — initiative pushes fired');

  const bobInit = await waitForPush('/bob-device', keysBob, 'initiative');
  eq(
    bobInit.payload.url,
    `/party/${fx.partyId}/character/${fx.charBran.id}?combat=init`,
    'initiative push deep-links bob to his sheet + initiative UI',
  );
  eq(bobInit.payload.tag, `init:${pushEnc.id}`, 'initiative push tagged per encounter');
  ok(
    String(bobInit.payload.body).includes('Siège de la forge'),
    'initiative body names the encounter',
  );
  eq(String(bobInit.req.headers.ttl), '600', 'initiative ttl is rattrapable');
  eq(String(bobInit.req.headers.urgency), 'high', 'initiative urgency high');
  const gmInit = await waitForPush('/gm-device', keysGm, 'initiative');
  eq(
    gmInit.payload.url,
    `/party/${fx.partyId}/character/${fx.charAlya.id}?combat=init`,
    'gm initiative push targets Alya (one per owner)',
  );

  // Initiative order: Bran 20 → Alya 19 → gobelin 5.
  r = await api(base, 'GET', `/api/encounters/${pushEnc.id}`, { token: fx.gm.token });
  const branCombatant = r.data.encounter.combatants.find(
    (c: any) => c.characterId === fx.charBran.id,
  );
  const alyaCombatant = r.data.encounter.combatants.find(
    (c: any) => c.characterId === fx.charAlya.id,
  );
  const gobCombatant = r.data.encounter.combatants.find((c: any) => c.type === 'monster');
  r = await api(
    base,
    'PATCH',
    `/api/encounters/${pushEnc.id}/combatants/${branCombatant.id}/initiative`,
    {
      token: fx.player.token,
      body: { initiative: 20 },
    },
  );
  eq(r.status, 200, 'bob sets own initiative (no push for that)');
  await api(
    base,
    'PATCH',
    `/api/encounters/${pushEnc.id}/combatants/${alyaCombatant.id}/initiative`,
    {
      token: fx.gm.token,
      body: { initiative: 19 },
    },
  );
  await api(
    base,
    'PATCH',
    `/api/encounters/${pushEnc.id}/combatants/${gobCombatant.id}/initiative`,
    {
      token: fx.gm.token,
      body: { initiative: 5 },
    },
  );
  mock.reset(); // drop the initiative pushes — only turn pushes from here

  // Starting the combat: Bran holds round 1 → bob's « À toi de jouer ».
  r = await api(base, 'POST', `/api/encounters/${pushEnc.id}/next-turn`, { token: fx.gm.token });
  eq(r.status, 200, 'combat started (setup → active)');
  eq(r.data.encounter.status, 'active', 'encounter is active');
  const turn1 = await waitForPush('/bob-device', keysBob, 'turn');
  eq(
    turn1.payload.url,
    `/party/${fx.partyId}/character/${fx.charBran.id}?tab=survival`,
    'turn push deep-links bob to the Survie tab (key, not the fr label)',
  );
  eq(turn1.payload.tag, `turn:${pushEnc.id}`, 'turn push tagged per encounter');
  ok(String(turn1.payload.body).includes('Bran'), 'turn body names the combatant');
  eq(String(turn1.req.headers.ttl), '0', 'turn ttl 0 (deliver now or drop)');
  eq(String(turn1.req.headers.urgency), 'high', 'turn urgency high');

  // bob closes his own turn → Alya is next: the END-MY-TURN path must push
  // the next player too (the GM plays Alya).
  r = await api(base, 'POST', `/api/encounters/${pushEnc.id}/end-my-turn`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'bob ends his turn');
  const turn2 = await waitForPush('/gm-device', keysGm, 'turn');
  eq(
    turn2.payload.url,
    `/party/${fx.partyId}/character/${fx.charAlya.id}?tab=survival`,
    'end-my-turn pushes the next player',
  );
  ok(String(turn2.payload.body).includes('Alya'), 'turn body names Alya');

  // GM advances: goblin's turn (no owner → NO push), then wraps to round 2
  // and Bran again — a second turn push to bob, same tag (screen replace).
  r = await api(base, 'POST', `/api/encounters/${pushEnc.id}/next-turn`, { token: fx.gm.token });
  eq(r.status, 200, 'gm advances to the goblin');
  r = await api(base, 'POST', `/api/encounters/${pushEnc.id}/next-turn`, { token: fx.gm.token });
  eq(r.status, 200, 'round wraps back to Bran');
  eq(r.data.encounter.round, 2, 'round 2');
  const turn3 = await waitForPush('/bob-device', keysBob, 'turn');
  ok(String(turn3.payload.body).includes('round 2'), 'turn body mentions the round');

  // Monster turns notify nobody: give in-flight sends time to land, then
  // count — since the reset above, gm-device saw only Alya's turn push and
  // bob-device only his two turn pushes (start + round-2 wrap).
  await new Promise((res) => setTimeout(res, 400));
  eq(
    mock.requests.filter((req) => req.path === '/gm-device').length,
    1,
    'no push on monster turns',
  );
  eq(
    mock.requests.filter((req) => req.path === '/bob-device').length,
    2,
    'bob saw exactly his two turn pushes',
  );

  // Leave clean state for the modules that follow.
  await api(base, 'POST', '/api/push/unsubscribe', {
    token: fx.player.token,
    body: { endpoint: bobEndpoint },
  });
  await api(base, 'POST', '/api/push/unsubscribe', {
    token: fx.gm.token,
    body: { endpoint: gmEndpoint },
  });
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
