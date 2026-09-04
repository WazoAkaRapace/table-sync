/**
 * Stress WebSocket : une table complète qui joue en même temps — le MD sur
 * deux écrans (rencontre, initiative, tours) et 5 joueurs qui patchent leurs
 * fiches en parallèle. Vérifie trois choses :
 *
 *  1. Les sockets TIENNENT : aucun close/error spontané, readyState OPEN du
 *     début à la fin, y compris sous charge et après la tempête.
 *  2. La diffusion est sans perte ni doublon : chaque socket voit EXACTEMENT
 *     la même séquence d'événements (le fan-out du bus est synchrone, donc
 *     l'ordre est identique pour tous), et les character:change arrivent au
 *     compte exact — 1 par PATCH, l'écho étant exempté pour ce type.
 *  3. SILENCE RADIO INTÉGRAL sous WS_HEARTBEAT_MS=0 : ni trame protocole
 *     ping/pong (le client `ws` les compte), ni message applicatif de
 *     keep-alive — les fenêtres de silence avant et après la partie doivent
 *     rester totalement muettes. Le heartbeat serveur existe désormais
 *     (2026-09, « vieille tablette » — voir ws.ts) mais le runner boote la
 *     suite à WS_HEARTBEAT_MS=0 : ces asserts épinglent CETTE configuration
 *     calme — toute trame parasite qui réapparaîtrait (keep-alive débridé,
 *     fan-out bruyant) les cassera. Le chemin heartbeat lui-même est épinglé
 *     par mod-heartbeat.ts sur une instance dédiée à balayage rapide (300 ms).
 *
 * On utilise le paquet `ws` (et non le WebSocket global d'undici) car il
 * expose les événements 'ping'/'pong' au niveau protocole.
 */
import { createRequire } from 'node:module';
import {
  api,
  createCharacter,
  createParty,
  eq,
  type Fixtures,
  ok,
  registerUser,
  type ServerHandle,
} from './harness.ts';

const require = createRequire(import.meta.url);
const Ws = require('ws');

const PATCHES_PER_PLAYER = 6;
const QUIET_MS = 1500;

interface StressSocket {
  label: string;
  ws: any;
  messages: any[];
  /** Horodatage de réception, parallèle à messages (latence bout-en-bout). */
  arrivals: number[];
  pings: number;
  pongs: number;
  errors: string[];
  closed: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

/** Ouvre un socket authentifié par sous-protocole (comme le client web — le
 *  JWT reste hors des URLs et des logs de proxy) et compte les trames ping/pong. */
function openSocket(base: string, token: string, label: string): Promise<StressSocket> {
  const url = `${base.replace(/^http/, 'ws')}/ws`;
  const ws = new Ws(url, [token]);
  const s: StressSocket = {
    label,
    ws,
    messages: [],
    arrivals: [],
    pings: 0,
    pongs: 0,
    errors: [],
    closed: false,
  };
  ws.on('message', (data: unknown) => {
    try {
      s.messages.push(JSON.parse(String(data)));
      s.arrivals.push(Date.now());
    } catch {
      /* fragment non-JSON : ignoré */
    }
  });
  ws.on('ping', () => {
    s.pings++;
  });
  ws.on('pong', () => {
    s.pongs++;
  });
  ws.on('close', () => {
    s.closed = true;
  });
  ws.on('error', (e: Error) => {
    s.errors.push(String(e?.message || e));
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} : pas d'accusé 'connected' WS en 5 s`)),
      5000,
    );
    // Résoudre seulement sur l'accusé 'connected' — le message peut arriver
    // juste après 'open', et le socket n'est réellement enregistré côté
    // serveur qu'à ce moment-là.
    const ackTimer = setInterval(() => {
      if (s.messages.some((m) => m.type === 'connected')) {
        clearInterval(ackTimer);
        clearTimeout(timer);
        resolve(s);
      }
    }, 10);
    ws.once('close', (code: number, reason: Buffer) => {
      clearInterval(ackTimer);
      clearTimeout(timer);
      reject(new Error(`${label} : connexion fermée (${code} ${reason})`));
    });
    ws.once('error', (e: Error) => {
      clearInterval(ackTimer);
      clearTimeout(timer);
      reject(new Error(`${label} : ${e?.message}`));
    });
  });
}

const KNOWN_EVENT_TYPES = new Set([
  'connected',
  'inventory:change',
  'character:change',
  'party:change',
  'combat:change',
  'campaign:change',
  'gma:change',
  'message:new',
]);

/** Le pacte de solidité : ouvert, sans erreur, et muet côté keep-alive. */
function assertSocketsStrong(sockets: StressSocket[], ctx: string): void {
  for (const s of sockets) {
    ok(!s.closed, `${ctx} : ${s.label} n'a jamais été fermé par le serveur`);
    eq(s.errors.length, 0, `${ctx} : ${s.label} sans erreur de socket`);
    ok(s.ws.readyState === 1, `${ctx} : ${s.label} est toujours OPEN`);
    eq(s.pings, 0, `${ctx} : ${s.label} — aucune trame ping serveur (pas de heartbeat)`);
    eq(s.pongs, 0, `${ctx} : ${s.label} — aucune trame pong serveur`);
    for (const m of s.messages) {
      ok(
        m && typeof m.type === 'string' && KNOWN_EVENT_TYPES.has(m.type),
        `${ctx} : ${s.label} — message applicatif inconnu (keep-alive ?) : ${JSON.stringify(m)}`,
      );
    }
  }
}

/** Fenêtre de silence : rien ne doit arriver quand personne n'agit. */
async function quietWindow(sockets: StressSocket[], ms: number, ctx: string): Promise<void> {
  const before = sockets.map((s) => s.messages.length);
  await sleep(ms);
  for (const [i, s] of sockets.entries()) {
    eq(
      s.messages.length,
      before[i],
      `${ctx} : silence radio sur ${s.label} — un ping-pong/keep-alive parle dans le vide`,
    );
  }
  assertSocketsStrong(sockets, ctx);
}

function countEvents(s: StressSocket, pred: (m: any) => boolean): number {
  return s.messages.filter(pred).length;
}

function eventKey(m: any): string {
  return `${m.type}|${m.characterId ?? ''}|${m.action ?? ''}`;
}

export async function run(base: string, _fx: Fixtures, _srv: ServerHandle): Promise<void> {
  // ---------- La table : 1 MD + 5 joueurs, partie dédiée ----------
  const gm = await registerUser(base, 'sigma-md');
  const players = [
    await registerUser(base, 'sigma-p1'),
    await registerUser(base, 'sigma-p2'),
    await registerUser(base, 'sigma-p3'),
    await registerUser(base, 'sigma-p4'),
    await registerUser(base, 'sigma-p5'),
  ];
  const party = await createParty(base, gm.token, 'Table de stress WS');
  for (const p of players) {
    const join = await api(base, 'POST', '/api/parties/join', {
      token: p.token,
      body: { inviteCode: party.inviteCode },
    });
    eq(join.status, 201, `${p.username} rejoint la table de stress`);
  }
  const chars = [] as Array<{ id: number; name: string }>;
  for (const [i, p] of players.entries()) {
    chars.push(
      await createCharacter(base, p.token, party.id, {
        name: `Sigrid ${i + 1}`,
        maxHp: 20,
        level: 3,
      }),
    );
  }

  // ---------- Connexion : le MD sur 2 écrans, chaque joueur 1 onglet ----------
  const sockets: StressSocket[] = [];
  sockets.push(await openSocket(base, gm.token, 'md-portable'));
  sockets.push(await openSocket(base, gm.token, 'md-tablette'));
  for (const [i, p] of players.entries())
    sockets.push(await openSocket(base, p.token, `joueur-${i + 1}`));
  try {
    for (const s of sockets) {
      eq(
        countEvents(s, (m) => m.type === 'connected'),
        1,
        `${s.label} : accusé de connexion`,
      );
      eq(s.messages.length, 1, `${s.label} : rien d'autre que l'accusé à la connexion`);
    }

    // ---------- Silence avant la partie ----------
    await quietWindow(sockets, QUIET_MS, 'avant-partie');

    // ---------- La tempête : tout le monde joue en même temps ----------
    let gmCombatCalls = 0; // chaque appel MD émet AU MOINS un combat:change
    const gmRuns = (async () => {
      let r = await api(base, 'POST', `/api/parties/${party.id}/encounters`, {
        token: gm.token,
        body: { name: 'Émeute au comptoir' },
      });
      eq(r.status, 201, 'MD crée la rencontre');
      gmCombatCalls++;
      const encId = r.data.encounter.id;

      r = await api(base, 'POST', `/api/encounters/${encId}/combatants/player`, {
        token: gm.token,
        body: { characterIds: chars.map((c) => c.id) },
      });
      eq(r.status, 201, 'MD ajoute les 5 PJ d un coup');
      gmCombatCalls++;
      const combatants: any[] = r.data.combatants;

      let init = 20;
      for (const c of combatants) {
        r = await api(base, 'PATCH', `/api/encounters/${encId}/combatants/${c.id}/initiative`, {
          token: gm.token,
          body: { initiative: init },
        });
        eq(r.status, 200, 'MD règle une initiative');
        gmCombatCalls++;
        init -= 2;
      }

      for (let turn = 0; turn < 4; turn++) {
        r = await api(base, 'POST', `/api/encounters/${encId}/next-turn`, { token: gm.token });
        eq(r.status, 200, `MD avance le tour (${turn + 1}/4)`);
        gmCombatCalls++;
      }
      return encId;
    })();

    const playerRuns = players.map((p, i) =>
      (async () => {
        for (let k = 0; k < PATCHES_PER_PLAYER; k++) {
          const r = await api(base, 'PATCH', `/api/characters/${chars[i].id}`, {
            token: p.token,
            body: { notes: `stress ${Date.now()} r${k}` },
          });
          eq(r.status, 200, `${p.username} patche sa fiche (tour ${k + 1})`);
        }
      })(),
    );

    const stormStarted = Date.now();
    await Promise.all([gmRuns, ...playerRuns]);
    const stormMs = Date.now() - stormStarted;

    // Convergence : chaque socket doit avoir les 30 character:change, puis un
    // délai de grâce — un doublon tardif échouerait l'assert exact ci-dessous.
    const totalPatches = PATCHES_PER_PLAYER * players.length;
    await waitUntil(
      () =>
        sockets.every((s) => countEvents(s, (m) => m.type === 'character:change') >= totalPatches),
      6000,
      'chaque socket reçoit les character:change de la tempête',
    );
    await sleep(350);

    // Compte exact : 1 character:change PAR PATCH, pour CHAQUE socket (l'écho
    // est exempté sur ce type — même l'acteur reçoit son événement).
    for (const char of chars) {
      for (const s of sockets) {
        eq(
          countEvents(s, (m) => m.type === 'character:change' && m.characterId === char.id),
          PATCHES_PER_PLAYER,
          `${s.label} : exactement ${PATCHES_PER_PLAYER} character:change pour ${char.name} (ni perte, ni doublon)`,
        );
      }
    }
    // Plancher combat : chaque appel MD émet au moins un combat:change.
    for (const s of sockets) {
      ok(
        countEvents(s, (m) => m.type === 'combat:change') >= gmCombatCalls,
        `${s.label} : au moins ${gmCombatCalls} combat:change reçus`,
      );
    }
    // Uniformité stricte : le fan-out du bus est synchrone — tous les sockets
    // voient la MÊME séquence d'événements, dans le même ordre.
    const ref = sockets[0].messages.filter((m) => m.type !== 'connected').map(eventKey);
    for (const s of sockets.slice(1)) {
      eq(
        JSON.stringify(s.messages.filter((m) => m.type !== 'connected').map(eventKey)),
        JSON.stringify(ref),
        `${s.label} a vu exactement le même flux que ${sockets[0].label} (sans perte, doublon ni réordonnancement)`,
      );
    }
    assertSocketsStrong(sockets, 'après-tempête');
    console.log(
      `    [stress-ws] tempête ${stormMs} ms — ${ref.length} événements diffusés × ${sockets.length} sockets, ${gmCombatCalls} appels combat MD`,
    );

    // ---------- Sonde de latence bout-en-bout ----------
    const probeChar = chars[2];
    const before = sockets.map((s) =>
      countEvents(s, (m) => m.type === 'character:change' && m.characterId === probeChar.id),
    );
    const probe = await api(base, 'PATCH', `/api/characters/${probeChar.id}`, {
      token: players[2].token,
      body: { notes: `sonde ${Date.now()}` },
    });
    eq(probe.status, 200, 'sonde de latence envoyée');
    const sentAt = Date.now();
    await waitUntil(
      () =>
        sockets.every(
          (s, i) =>
            countEvents(s, (m) => m.type === 'character:change' && m.characterId === probeChar.id) >
            before[i],
        ),
      3000,
      'la sonde atteint chaque socket',
    );
    const worst = Math.max(
      ...sockets.map((s, i) => {
        // index d'arrivée du (before+1)-ième événement de la sonde sur ce socket
        const target = before[i] + 1;
        let seen = 0;
        for (let j = 0; j < s.messages.length; j++) {
          const m = s.messages[j];
          if (m.type === 'character:change' && m.characterId === probeChar.id) {
            seen++;
            if (seen === target) return s.arrivals[j] - sentAt;
          }
        }
        return Number.POSITIVE_INFINITY;
      }),
    );
    ok(
      worst < 1000,
      `latence bout-en-bout PATCH → WS : ${worst} ms au pire (aucun ping-pong ne vient grever le canal)`,
    );

    // ---------- Second onglet ouvert APRÈS la tempête ----------
    // Pas de replay d'historique : le nouveau socket ne doit voir que la
    // suite, et recevoir les événements à venir comme les autres.
    const late = await openSocket(base, players[0].token, 'joueur-1 (2e onglet)');
    sockets.push(late);
    eq(late.messages.length, 1, '2e onglet : juste l accusé de connexion, aucun replay');
    const latePatch = await api(base, 'PATCH', `/api/characters/${chars[1].id}`, {
      token: players[1].token,
      body: { notes: `retard ${Date.now()}` },
    });
    eq(latePatch.status, 200, 'patch post-tempête');
    await waitUntil(
      () =>
        sockets.every(
          (s) =>
            countEvents(s, (m) => m.type === 'character:change' && m.characterId === chars[1].id) >=
            (s === late ? 1 : PATCHES_PER_PLAYER + 1),
        ),
      3000,
      'le 2e onglet reçoit le flux en direct',
    );
    eq(late.messages.length, 2, '2e onglet : connected + 1 événement, rien de plus');

    // ---------- Silence après la partie ----------
    await quietWindow(sockets, QUIET_MS, 'après-partie');
    assertSocketsStrong(sockets, 'final');
  } finally {
    for (const s of sockets) {
      try {
        s.ws.close();
      } catch {
        /* déjà fermé */
      }
    }
  }
}
