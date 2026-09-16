/**
 * WebSocket sync: fanout, echo suppression (+ its combat/character
 * exemptions), hidden-character gating, membership-cache refresh.
 * Covers every .prepare site in sync/ws.ts (via Node's global WebSocket).
 */
import { api, createParty, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

interface WsClient {
  userId: number;
  messages: any[];
  close: () => void;
}

function wsUrl(base: string, token: string): string {
  return `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
}

async function connect(base: string, token: string, userId: number): Promise<WsClient> {
  const ws = new WebSocket(wsUrl(base, token));
  const messages: any[] = [];
  const opened = new Promise<void>((resolve, reject) => {
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
  await opened;
  // wait for the server's connected confirmation
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

function silence(messages: any[], pred: (m: any) => boolean, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (messages.some(pred) || Date.now() - started > ms) {
        clearInterval(timer);
        resolve();
      }
    }, 25);
  });
}

export async function run(base: string, fx: Fixtures, _srv: ServerHandle): Promise<void> {
  const alice = await connect(base, fx.gm.token, fx.gm.userId);
  const bob = await connect(base, fx.player.token, fx.player.userId);
  try {
    // character:change fans out to members — INCLUDING the actor (echo-exempt)
    await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
      token: fx.gm.token,
      body: { notes: `sync ${Date.now()}` },
    });
    await waitMsg(alice.messages, (m) => m.type === 'character:change', 5000);
    await waitMsg(bob.messages, (m) => m.type === 'character:change', 5000);
    eq(alice.messages.at(-1).partyId, fx.partyId, 'event carries party id');

    // echo suppression: party:change from bob does NOT come back to bob…
    // (vocabulaire v2 : l'écriture PNJ porte action 'npcs' — distincte de
    // 'custom-item' pour que l'onglet Objets custom du MD et la page PNJ ne
    // se réveillent plus l'un l'autre)
    await api(base, 'POST', `/api/parties/${fx.partyId}/npcs`, {
      token: fx.player.token,
      body: { name: 'Ping' },
    });
    await waitMsg(alice.messages, (m) => m.type === 'party:change' && m.action === 'npcs', 5000);
    await silence(bob.messages, (m) => m.type === 'party:change' && m.action === 'npcs', 700);
    ok(
      !bob.messages.some((m) => m.type === 'party:change' && m.action === 'npcs'),
      'actor does not receive their own party:change (echo suppressed)',
    );

    // hidden character: character:change reaches owner + GM only
    await api(base, 'PATCH', `/api/characters/${fx.charSecret.id}`, {
      token: fx.gm.token,
      body: { notes: `secret ${Date.now()}` },
    });
    await waitMsg(
      alice.messages,
      (m) => m.type === 'character:change' && m.characterId === fx.charSecret.id,
      5000,
    );
    await silence(
      bob.messages,
      (m) => m.type === 'character:change' && m.characterId === fx.charSecret.id,
      700,
    );
    ok(
      !bob.messages.some(
        (m) => m.type === 'character:change' && m.characterId === fx.charSecret.id,
      ),
      "hidden character events don't reach other players",
    );

    // membership cache refresh: bob's party set was cached at connect time —
    // a party:change (join) refreshes it, and subsequent events flow.
    await api(base, 'POST', '/api/parties/join', {
      token: fx.player2.token,
      body: { inviteCode: fx.inviteCode },
    });
    await waitMsg(alice.messages, (m) => m.type === 'party:change' && m.action === 'join', 5000);
    // targeted delivery to carol herself
    // (carol has no socket here — the targetUserId loop just no-ops.)

    // ---------- vocabulaire v2 : granularité des rafraîchis ----------
    // Notes de fiche = données PRIVÉES : action 'sheet', PAS 'stats' — les
    // pages qui ne rendent que le résumé du roster peuvent les ignorer.
    await api(base, 'POST', `/api/characters/${fx.charBran.id}/notes`, {
      token: fx.player.token,
      body: { title: 'journal', content: 'secrète' },
    });
    const sheetEv = await waitMsg(
      alice.messages,
      (m) => m.type === 'character:change' && m.action === 'sheet',
      5000,
    );
    eq(sheetEv.characterId, fx.charBran.id, 'sheet event carries the character id');

    // combat:change porte la RENCONTRE : les combats parallèles ne doivent
    // pas rafraîchir le détail d'une autre rencontre.
    const enc = await api(base, 'POST', `/api/parties/${fx.partyId}/encounters`, {
      token: fx.gm.token,
      body: { name: 'WS granularité' },
    });
    const turnEv = await waitMsg(
      alice.messages,
      (m) => m.type === 'combat:change' && m.partyId === fx.partyId,
      5000,
    );
    ok(turnEv.encounterId === enc.data.encounter.id, 'combat:change carries encounterId');

    // Écriture de localisation : l'acteur doit être identifié (suppression
    // d'echo) — l'événement ne repart plus à SA propre connexion.
    await api(base, 'POST', `/api/characters/${fx.charBran.id}/locations`, {
      token: fx.player.token,
      body: { name: 'Besace', type: 'container' },
    });
    const locEv = await waitMsg(
      alice.messages,
      (m) => m.type === 'inventory:change' && m.action === 'adjust',
      5000,
    );
    eq(locEv.actorUserId, fx.player.userId, 'locations emit identifies the actor');
    await silence(
      bob.messages,
      (m) => m.type === 'inventory:change' && m.characterId === fx.charBran.id,
      700,
    );
    ok(
      !bob.messages.some((m) => m.type === 'inventory:change' && m.characterId === fx.charBran.id),
      'locations emit is echo-suppressed for the actor',
    );

    // disband: the DB cascade empties party_members BEFORE fan-out, so ws.ts
    // delivers on the PRE-refresh membership snapshot. bob (member, connected
    // before the party existed — his cache gained it via the join refresh
    // above) must still receive 'disband'; the acting GM is echo-suppressed.
    const doomed = await createParty(base, fx.gm.token, 'WS Disband');
    await api(base, 'POST', '/api/parties/join', {
      token: fx.player.token,
      body: { inviteCode: doomed.inviteCode },
    });
    await waitMsg(
      alice.messages,
      (m) => m.type === 'party:change' && m.action === 'join' && m.partyId === doomed.id,
      5000,
    );
    const del = await api(base, 'DELETE', `/api/parties/${doomed.id}`, { token: fx.gm.token });
    eq(del.status, 204, 'GM disbands the WS-test party');
    await waitMsg(
      bob.messages,
      (m) => m.type === 'party:change' && m.action === 'disband' && m.partyId === doomed.id,
      5000,
    );
    await silence(alice.messages, (m) => m.type === 'party:change' && m.action === 'disband', 700);
    ok(
      !alice.messages.some((m) => m.type === 'party:change' && m.action === 'disband'),
      'disband echo-suppressed for the acting GM',
    );
  } finally {
    alice.close();
    bob.close();
  }
}
