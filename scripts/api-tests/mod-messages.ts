/**
 * Correspondance secrète MD ↔ joueur : fil par personnage, topologie en
 * étoile, permissions PLUS strictes que les notes (un autre membre de la
 * table ne lit JAMAIS un fil), livraison WS ciblée (jamais de fan-out parti),
 * marquage lu par camp, boîte MD, badges — et le déclencheur push dont le
 * corps ne porte JAMAIS le texte du message (écran de verrouillage).
 */
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';
import type { MockPushRequest } from './mock-push.ts';
import { decryptPushBody, makeSubscriptionKeys } from './mod-push.ts';

// ---------- WS client helpers (même gabarit que mod-sync-ws) ----------

interface WsClient {
  userId: number;
  messages: any[];
  close: () => void;
}

async function connect(base: string, token: string, userId: number): Promise<WsClient> {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
  const messages: any[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${JSON.stringify(e)}`)));
  });
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      messages.push(JSON.parse(String(ev.data)));
    } catch {
      /* ignore */
    }
  });
  await waitMsg(messages, (m) => m.type === 'connected', 5000);
  return { userId, messages, close: () => ws.close() };
}

function waitMsg(messages: any[], pred: (m: any) => boolean, timeoutMs: number): Promise<any> {
  const existing = messages.find(pred);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = messages.find(pred);
      if (hit) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(
          new Error(
            `ws message not received within ${timeoutMs}ms — have: ${JSON.stringify(messages.slice(-5))}`,
          ),
        );
      }
    }, 25);
  });
}

/** Prove nothing matching arrives within the window. */
function silence(messages: any[], pred: (m: any) => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (messages.some(pred) || Date.now() - started > ms) {
        clearInterval(timer);
        resolve(messages.some(pred));
      }
    }, 25);
  });
}

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const B = fx.charBran.id; // bob's character — the star's player side
  const A = fx.charAlya.id; // the GM's own character

  // Earlier modules (auth+parties, combat) removed carol from the party —
  // the secrecy contract needs a REAL member who is neither owner nor GM,
  // so she rejoins for this module and leaves at the end.
  let r = await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: fx.inviteCode },
  });
  eq(r.status, 201, 'carol rejoins for the secrecy contract');
  const removeCarol = () =>
    api(base, 'DELETE', `/api/parties/${fx.partyId}/members/${fx.player2.userId}`, {
      token: fx.gm.token,
    }).catch(() => {});

  // ---------- permissions : plus strict que les notes ----------
  r = await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.player.token });
  eq(r.status, 200, 'owner reads own empty thread');
  eq(r.data.messages.length, 0, 'thread starts empty');
  eq(r.data.unread, 0, 'nothing unread');

  r = await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.gm.token });
  eq(r.status, 200, 'GM reads the thread');
  r = await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.player2.token });
  eq(r.status, 403, 'another member CANNOT read the thread (secrecy contract)');
  r = await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.outsider.token });
  eq(r.status, 403, 'outsider rejected');
  r = await api(base, 'GET', '/api/characters/999999/messages', { token: fx.gm.token });
  eq(r.status, 404, 'unknown character → 404');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/messages`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'hidden character thread → 404 for a player');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/messages`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'GM reads the hidden character thread (prep continues in secret)');

  // ---------- envoi : validation + topologie ----------
  r = await api(base, 'POST', `/api/characters/${B}/messages`, {
    token: fx.player2.token,
    body: { body: 'espion' },
  });
  eq(r.status, 403, 'another member cannot write');
  r = await api(base, 'POST', `/api/characters/${B}/messages`, {
    token: fx.gm.token,
    body: { body: '   ' },
  });
  eq(r.status, 400, 'empty body → 400');
  r = await api(base, 'POST', `/api/characters/${B}/messages`, {
    token: fx.gm.token,
    body: { body: 'x'.repeat(2001) },
  });
  eq(r.status, 400, 'over-length body → 400');

  // ---------- observers : WS ciblé + push, en place AVANT le premier envoi ----------
  const gmWs = await connect(base, fx.gm.token, fx.gm.userId);
  const bobWs = await connect(base, fx.player.token, fx.player.userId);
  const carolWs = await connect(base, fx.player2.token, fx.player2.userId);
  const mock = srv.push;
  const keysBob = makeSubscriptionKeys();
  const keysGm = makeSubscriptionKeys();
  const bobEndpoint = `${mock.url}/bob-msg-device`;
  const gmEndpoint = `${mock.url}/gm-msg-device`;
  await api(base, 'POST', '/api/push/subscribe', {
    token: fx.player.token,
    body: { endpoint: bobEndpoint, keys: keysBob },
  });
  await api(base, 'POST', '/api/push/subscribe', {
    token: fx.gm.token,
    body: { endpoint: gmEndpoint, keys: keysGm },
  });
  mock.reset();

  const seen = new Set<MockPushRequest>();
  const waitForPush = async (
    path: string,
    keys: { ecdh: import('node:crypto').ECDH; auth: string },
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
      if (Date.now() > deadline) throw new Error(`push '${kind}' never arrived on ${path}`);
      await new Promise((res) => setTimeout(res, 150));
    }
  };

  try {
    // ---------- MD → joueur ----------
    const SECRET = 'La cassette est sous l’autel — n’en parle à personne.';
    r = await api(base, 'POST', `/api/characters/${B}/messages`, {
      token: fx.gm.token,
      body: { body: `  ${SECRET}  ` },
    });
    eq(r.status, 201, 'GM sends the secret');
    const s1 = r.data.message;
    eq(s1.body, SECRET, 'body stored trimmed');
    eq(s1.fromGM, true, 'sender resolved as GM');
    eq(s1.readAt, null, 'unread on arrival');
    ok(s1.senderName.length > 0, 'sender name carried');

    const bobEvent = await waitMsg(
      bobWs.messages,
      (m) => m.type === 'message:new' && m.action === 'new',
      5000,
    );
    eq(bobEvent.targetUserId, fx.player.userId, 'delivery targeted the owner');
    eq(bobEvent.characterId, B, 'event names the thread character');
    eq(bobEvent.messageFromGM, true, 'event flags the GM side');
    eq(bobEvent.messageCharacterName, 'Bran', 'character name rides the event');
    ok(
      !(await silence(gmWs.messages, (m: any) => m.type === 'message:new', 500)),
      'the SENDER hears no event for their own send',
    );
    ok(
      !(await silence(carolWs.messages, (m: any) => m.type === 'message:new', 500)),
      'another player receives NOTHING — secrecy holds at transport level',
    );

    const bobPush = await waitForPush('/bob-msg-device', keysBob, 'message');
    eq(
      bobPush.payload.url,
      `/party/${fx.partyId}/character/${B}?tab=messages`,
      'push deep-links the Messages tab',
    );
    eq(bobPush.payload.tag, `message:${B}`, 'push tagged per thread');
    ok(
      !String(bobPush.payload.body).includes('cassette'),
      'push body NEVER carries the secret text (lock screen)',
    );
    ok(String(bobPush.payload.body).includes('Bran'), 'push body names the character');
    eq(String(bobPush.req.headers.ttl), '3600', 'message ttl = the session evening');
    eq(
      mock.requests.filter((req) => req.path === '/gm-msg-device').length,
      0,
      'no push to the sender',
    );

    // ---------- lecture côté joueur + reflow « Vu » ----------
    r = await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.player.token });
    eq(r.data.messages.length, 1, 'thread lists the GM message');
    eq(r.data.unread, 1, 'owner-side unread counts GM-sent');
    r = await api(base, 'POST', `/api/characters/${B}/messages/read`, { token: fx.player.token });
    eq(r.status, 200, 'read marking responds');
    eq(r.data.read, 1, 'one message marked');
    r = await api(base, 'POST', `/api/characters/${B}/messages/read`, { token: fx.player.token });
    eq(r.data.read, 0, 'read marking is idempotent');

    const readReflow = await waitMsg(
      gmWs.messages,
      (m) => m.type === 'message:new' && m.action === 'read',
      5000,
    );
    eq(readReflow.targetUserId, fx.gm.userId, 'read reflow targets the GM');

    r = await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.gm.token });
    eq(r.data.messages[0].readAt !== null, true, 'GM sees the message as read (« Vu »)');
    eq(r.data.unread, 0, 'GM-side unread stays clear');

    // ---------- joueur → MD ----------
    const REPLY = 'Je fouille l’autel dès ce soir.';
    r = await api(base, 'POST', `/api/characters/${B}/messages`, {
      token: fx.player.token,
      body: { body: REPLY },
    });
    eq(r.status, 201, 'player replies');
    eq(r.data.message.fromGM, false, 'reply is player-side');

    const gmEvent = await waitMsg(
      gmWs.messages,
      (m) => m.type === 'message:new' && m.action === 'new' && m.messageFromGM === false,
      5000,
    );
    eq(gmEvent.targetUserId, fx.gm.userId, 'player send targets the GM');
    ok(gmEvent.messageSenderName.length > 0, 'sender name rides the event');
    ok(
      !(await silence(
        carolWs.messages,
        (m: any) => m.type === 'message:new' && m.action === 'new',
        500,
      )),
      'still nothing for the other player',
    );

    const gmPush = await waitForPush('/gm-msg-device', keysGm, 'message');
    eq(gmPush.payload.url, `/party/${fx.partyId}/messages`, 'GM push opens the inbox');
    ok(
      String(gmPush.payload.body).includes('Bran'),
      'GM push body names the character (not the text)',
    );

    // ---------- badges : les non-lus du camp en attente ----------
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.gm.token,
    });
    eq(r.data.byCharacter[String(B)], 1, 'GM badge counts the player reply');
    eq(r.data.total, 1, 'GM total aggregates');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.player.token,
    });
    eq(r.data.total, 0, 'player has nothing waiting (reply is own, secret read)');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.player2.token,
    });
    eq(r.data.total, 0, 'player2 owns no thread here');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.outsider.token,
    });
    eq(r.status, 403, 'outsider rejected on unread');

    // ---------- boîte MD ----------
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/message-threads`, {
      token: fx.player.token,
    });
    eq(r.status, 403, 'threads summary is GM-only');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/message-threads`, {
      token: fx.gm.token,
    });
    eq(r.status, 200, 'GM opens the inbox');
    const threads = r.data.threads as any[];
    const partyCharCount = srv.query(
      'SELECT COUNT(*) AS n FROM characters WHERE party_id = ?',
      fx.partyId,
    ).n as number;
    eq(threads.length, partyCharCount, 'every character is a volume (incl. hidden)');
    eq(threads[0].characterId, B, 'most recent activity leads the register');
    eq(threads[0].unread, 1, 'inbox flags the waiting reply');
    eq(threads[0].lastMessage.body, REPLY, 'preview carries the last message');
    const secretVol = threads.find((t: any) => t.characterId === fx.charSecret.id);
    eq(secretVol.hidden, true, 'hidden volume flagged');
    eq(secretVol.lastMessage, null, 'empty thread sinks with no preview');

    r = await api(base, 'POST', `/api/characters/${B}/messages/read`, { token: fx.gm.token });
    eq(r.data.read, 1, 'GM reads the reply');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.gm.token,
    });
    eq(r.data.total, 0, 'badge cleared');

    // ---------- MD ↔ son propre personnage : aucun destinataire ----------
    mock.reset();
    r = await api(base, 'POST', `/api/characters/${A}/messages`, {
      token: fx.gm.token,
      body: { body: 'Note à moi-même' },
    });
    eq(r.status, 201, 'GM messages own character');
    ok(
      !(await silence(
        bobWs.messages,
        (m: any) => m.type === 'message:new' && m.characterId === A,
        500,
      )),
      'own-character send events nobody',
    );
    await new Promise((res) => setTimeout(res, 400));
    eq(mock.requests.length, 0, 'own-character send pushes nobody');

    // Sa propre note ne l'attend pas : sur un personnage DU MD, le MD est
    // expéditeur ET propriétaire — les compteurs « non lus côté MD » doivent
    // l'ignorer (sinon la pastille ne descend jamais, régression vécue).
    r = await api(base, 'GET', `/api/characters/${A}/messages`, { token: fx.gm.token });
    eq(r.data.unread, 0, 'thread view: own note not unread');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.gm.token,
    });
    eq(r.data.byCharacter[String(A)], undefined, 'badge route ignores the own note');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/message-threads`, {
      token: fx.gm.token,
    });
    eq(
      (r.data.threads as any[]).find((t: any) => t.characterId === A)?.unread,
      0,
      'inbox chip ignores the own note',
    );

    // ---------- persistance ----------
    const rows = srv.queryAll(
      'SELECT character_id, party_id, sender_user_id, read_at FROM character_messages WHERE character_id = ? ORDER BY id',
      B,
    );
    eq(rows.length, 2, 'db holds the exchange');
    eq(rows[0].party_id, fx.partyId, 'party_id denormalized');
    eq(rows[0].sender_user_id, fx.gm.userId, 'first message from the GM');
    ok(rows[0].read_at !== null, 'read_at persisted for the read message');
    eq(rows[1].read_at !== null, true, 'GM read the reply too');

    // ---------- Rature MD : le journal reste, mais le MD peut rayer ----------
    let thread = (await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.gm.token }))
      .data;
    const replyMsg = thread.messages.find((m: any) => !m.fromGM);
    ok(!!replyMsg, 'the player reply is there before pruning');

    r = await api(base, 'DELETE', `/api/character-messages/${replyMsg.id}`, {
      token: fx.player.token,
    });
    eq(r.status, 403, 'the owner CANNOT delete (MD only)');
    r = await api(base, 'DELETE', `/api/character-messages/${replyMsg.id}`, {
      token: fx.outsider.token,
    });
    eq(r.status, 403, 'outsider cannot delete');
    r = await api(base, 'DELETE', '/api/character-messages/999999', { token: fx.gm.token });
    eq(r.status, 404, 'unknown message → 404');

    r = await api(base, 'DELETE', `/api/character-messages/${replyMsg.id}`, {
      token: fx.gm.token,
    });
    eq(r.status, 204, 'GM prunes the player reply');
    const delEvent = await waitMsg(
      bobWs.messages,
      (m) => m.type === 'message:new' && m.action === 'delete',
      5000,
    );
    eq(delEvent.targetUserId, fx.player.userId, "the delete reflows the owner's open view");
    thread = (await api(base, 'GET', `/api/characters/${B}/messages`, { token: fx.gm.token })).data;
    ok(!thread.messages.some((m: any) => m.id === replyMsg.id), 'reply gone from the thread');
    eq(thread.messages.length, 1, 'the secret line remains');

    // Rayer un message NON LU fait retomber le badge du destinataire (compteur dérivé)
    r = await api(base, 'POST', `/api/characters/${B}/messages`, {
      token: fx.gm.token,
      body: { body: 'Secret éphémère.' },
    });
    eq(r.status, 201, 'ephemeral secret sent');
    const ephemeral = r.data.message;
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.player.token,
    });
    eq(r.data.byCharacter[String(B)], 1, 'player badge counts the ephemeral');
    r = await api(base, 'DELETE', `/api/character-messages/${ephemeral.id}`, {
      token: fx.gm.token,
    });
    eq(r.status, 204, 'ephemeral pruned');
    r = await api(base, 'GET', `/api/parties/${fx.partyId}/messages/unread`, {
      token: fx.player.token,
    });
    eq(r.data.total, 0, 'badge dropped with the pruned unread');
  } finally {
    bobWs.close();
    gmWs.close();
    carolWs.close();
    await api(base, 'POST', '/api/push/unsubscribe', {
      token: fx.player.token,
      body: { endpoint: bobEndpoint },
    }).catch(() => {});
    await api(base, 'POST', '/api/push/unsubscribe', {
      token: fx.gm.token,
      body: { endpoint: gmEndpoint },
    }).catch(() => {});
    mock.reset();
    await removeCarol(); // restore the membership earlier modules left behind
  }
}
