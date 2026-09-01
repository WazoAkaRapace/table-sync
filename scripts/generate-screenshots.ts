/**
 * Régénère les captures d'écran du README (docs/screenshots/*.png en FR,
 * docs/screenshots-en/*.png via --lang en).
 *
 * Monte une stack jetable entièrement isolée (aucun risque pour les vraies
 * campagnes) puis pilote Chromium via Playwright en viewport mobile 390×844 :
 *
 *   1. API   — tsx apps/api/src/server.ts sur un port libre, SQLite neuf
 *              (data/db/screenshots-demo.sqlite, gitignoré) ; le serveur
 *              s'auto-migre et sème le catalogue (646 objets, 490 sorts,
 *              964 monstres) avant d'écouter. GMA_BASE_URL pointe vers le
 *              mock GM Assistant in-process (scripts/api-tests/mock-gma.ts) :
 *              la clé, la campagne et la chronique de démo vivent là — aucune
 *              vraie clé, aucun appel réseau sortant. NB : le mock meurt avec
 *              le script (--keep ne le conserve pas).
 *   2. Web   — vite en dev sur un port libre, proxy /api + /ws vers l'API.
 *   3. Seed  — campagne de démo par REST : groupe « Les Héros de Chult »,
 *              3 PJ (Druide cercle de la Lune, Guerrier, Clerc) avec équipement
 *              et sorts, puis une « Embuscade gobeline » active en plein tour ;
 *              côté GM Assistant : init (campagne + PJ) puis séances, résumés
 *              et moments de démo injectés dans le mock.
 *   4. Shots — chaque capture reproduit l'état documenté dans le README.
 *
 * Bilingue : `--lang en` produit les mêmes 17 captures en anglais vers
 * docs/screenshots-en/ — l'API reçoit ?lang=en sur chaque appel du seed
 * (payloads mono-locale : `name` devient anglais), Chromium démarre en
 * locale en-US avec localStorage dnd-inv-lang=en, et tous les sélecteurs /
 * textes attendus passent par S(fr, en) avec les chaînes EXACTES du
 * catalogue EN (apps/web/src/i18n/locales/en.json — ne pas inventer).
 * Les PV des monstres restent lancés aux dés (randomité volontaire : les
 * captures 11–13 peuvent différer entre deux runs d'une même langue).
 *
 * Usage :
 *   npm run screenshots                    # régénère les 17 captures (FR)
 *   npm run screenshots -- --only 03,07    # seulement certaines (numéros ou noms)
 *   npm run screenshots -- --lang en       # version anglaise → docs/screenshots-en/
 *   npm run screenshots -- --keep          # laisser les serveurs tourner (debug)
 *
 * Prérequis : `npx playwright install chromium` une fois par machine
 * (les navigateurs sont déjà en cache si Playwright a déjà servi).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { type MockGmaHandle, startMockGma } from './api-tests/mock-gma.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = path.join(ROOT, 'data', 'db', 'screenshots-demo.sqlite');
const DEMO_PASSWORD = 'demo1234';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const opts = { only: [] as string[], keep: false, lang: 'fr' as 'fr' | 'en' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') opts.keep = true;
    else if (a.startsWith('--only=')) opts.only = a.slice(7).split(',');
    else if (a === '--only') {
      opts.only = (argv[i + 1] ?? '').split(',');
      i++;
    } else if (a === '--lang' || a.startsWith('--lang=')) {
      const v = a.startsWith('--lang=') ? a.slice(7) : (argv[++i] ?? '');
      if (v !== 'fr' && v !== 'en') {
        console.error(`--lang attend « fr » ou « en » (reçu : « ${v} »)`);
        process.exit(1);
      }
      opts.lang = v;
    } else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: tsx scripts/generate-screenshots.ts [--lang fr|en] [--only 01,03-arme…] [--keep]',
      );
      process.exit(0);
    } else {
      console.error(`Argument inconnu : ${a}`);
      process.exit(1);
    }
  }
  opts.only = opts.only.map((s) => s.trim()).filter(Boolean);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

/** Langue des captures : 'fr' (défaut → docs/screenshots/) ou 'en'
 * (→ docs/screenshots-en/). Pilote l'API (?lang=en), Chromium (locale +
 * localStorage) et tous les sélecteurs via S(). */
const lang = opts.lang;
const OUT_DIR = path.join(ROOT, 'docs', lang === 'en' ? 'screenshots-en' : 'screenshots');

/** Sélecteur/texte bilingue : la valeur FR, ou la traduction EXACTE du
 * catalogue EN (apps/web/src/i18n/locales/en.json + libellés partagés
 * CATEGORY_LABELS_EN) quand --lang en. */
const S = <T>(fr: T, en: T): T => (lang === 'en' ? en : fr);

/** Titre de la dernière séance de la chronique de démo — semé dans le mock
 * GMA puis attendu par les captures 16 et 17. */
const LAST_SESSION_TITLE = S('Le campement des batiri', 'The Batiri campsite');

// ---------------------------------------------------------------------------
// Processus : lancement + arrêt en groupe
// ---------------------------------------------------------------------------

class Proc {
  child: ChildProcess;
  private logs: string[] = [];
  constructor(
    readonly name: string,
    cmd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd = ROOT,
  ) {
    this.child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      detached: true, // groupe de processus dédié → stop() emporte les enfants
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (d: string) => {
        this.logs.push(...d.split('\n'));
        if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
      });
    }
    this.child.on('exit', (code, sig) => {
      if (code !== 0 && sig !== 'SIGTERM') {
        this.logs.push(`[${this.name}] processus mort (code=${code} sig=${sig})`);
      }
    });
  }

  get exited() {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  stop() {
    if (!this.child.pid || this.exited) return;
    try {
      process.kill(-this.child.pid, 'SIGTERM'); // groupe entier (esbuild, vite…)
    } catch {
      /* déjà parti */
    }
  }

  detachForKeepAlive() {
    // --keep : on quitte le script sans tuer les serveurs ; les pipes doivent
    // être détruits sinon ils maintiennent la boucle d'événements en vie.
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    this.child.unref();
  }

  tail(n = 30) {
    return this.logs.slice(-n).join('\n');
  }
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function freePort(preferred: number): Promise<number> {
  if (await isFree(preferred)) return preferred;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('listening', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.listen(0, '127.0.0.1');
  });
}

async function waitFor(
  what: string,
  fn: () => Promise<boolean>,
  { timeoutMs = 90_000, intervalMs = 300 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Délai dépassé en attendant : ${what}`);
}

// ---------------------------------------------------------------------------
// Stack jetable (API + Web)
// ---------------------------------------------------------------------------

interface Stack {
  apiPort: number;
  webPort: number;
  procs: Proc[];
  gma: MockGmaHandle;
}

async function bootStack(): Promise<Stack> {
  const apiPort = await freePort(4187);
  const webPort = await freePort(5199);

  for (const suffix of ['', '-wal', '-shm']) {
    await rm(`${DB_PATH}${suffix}`, { force: true });
  }

  const tsxBin = path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const viteBin = [
    path.join(ROOT, 'apps', 'web', 'node_modules', '.bin', 'vite'),
    path.join(ROOT, 'node_modules', '.bin', 'vite'),
  ].find((p) => existsSync(p));
  if (!existsSync(tsxBin) || !viteBin) {
    throw new Error("tsx ou vite introuvable dans node_modules — lance `npm install` d'abord.");
  }

  const procs: Proc[] = [];

  // Mock GM Assistant in-process : la stack de captures n'a aucune clé réelle.
  const gma = await startMockGma();

  // API — la migration + le seed du catalogue terminent AVANT listen, donc
  // /api/health vert ⇒ catalogue complet prêt.
  procs.push(
    new Proc('api', tsxBin, ['apps/api/src/server.ts'], {
      PORT: String(apiPort),
      DATABASE_PATH: DB_PATH,
      GMA_BASE_URL: gma.url,
    }),
  );
  const api = procs[0];

  const apiBase = `http://127.0.0.1:${apiPort}`;
  await waitFor(`API prête sur :${apiPort}`, async () => {
    if (api.exited) throw new Error(`L'API est morte au démarrage :\n${api.tail()}`);
    try {
      const res = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  });

  // Web — vite dev, proxy /api + /ws vers notre API.
  procs.push(
    new Proc(
      'web',
      viteBin,
      ['--port', String(webPort), '--strictPort', '--host', '127.0.0.1'],
      { DND_API_TARGET: apiBase },
      path.join(ROOT, 'apps', 'web'),
    ),
  );
  const web = procs[1];

  const webBase = `http://127.0.0.1:${webPort}`;
  await waitFor(`Web prêt sur :${webPort} (compilation initiale de vite…)`, async () => {
    if (web.exited) throw new Error(`vite est morte au démarrage :\n${web.tail()}`);
    try {
      const res = await fetch(webBase, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  });

  return { apiPort, webPort, procs, gma };
}

// ---------------------------------------------------------------------------
// Client API + seed de la campagne de démo
// ---------------------------------------------------------------------------

type Session = { token: string; user: { id: number; username: string; displayName: string } };
type Api = ReturnType<typeof makeApi>;

function makeApi(apiPort: number, token?: string) {
  const base = `http://127.0.0.1:${apiPort}`;
  return async function call<T = any>(method: string, p: string, body?: unknown): Promise<T> {
    // Payloads mono-locale : en EN chaque appel du seed porte ?lang=en pour
    // que noms stockés/calculés (recherches catalogue notamment) soient
    // anglais — le champ `name` EST alors le nom anglais.
    const url = lang === 'en' ? `${base}${p}${p.includes('?') ? '&' : '?'}lang=en` : `${base}${p}`;
    const res = await fetch(url, {
      method,
      headers: {
        // Sans body, content-type: application/json ferait rejeter la requête
        // par Fastify (FST_ERR_CTP_EMPTY_JSON_BODY) — on ne l'envoie que si utile.
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`${method} ${p} → ${res.status} ${await res.text().catch(() => '')}`);
    }
    return res.status === 204 ? undefined : res.json();
  };
}

async function register(apiPort: number, username: string, displayName: string): Promise<Session> {
  const call = makeApi(apiPort);
  const { token, user } = await call<{ token: string; user: Session['user'] }>(
    'POST',
    '/api/auth/register',
    { username, password: DEMO_PASSWORD, displayName, email: `${username}@demo.table-sync` },
  );
  return { token, user };
}

/** Résout l'id numérique d'un objet/sort du catalogue par son nom exact dans
 * la langue active (FR par défaut ; EN via ?lang=en — `name` est alors le
 * nom anglais, la recherche doit donc l'être aussi). */
async function catalogId(api: Api, kind: 'items' | 'spells', name: string): Promise<number> {
  const key = kind === 'items' ? 'items' : 'spells';
  const res = await api<{ [k: string]: { id: number; name: string }[] }>(
    'GET',
    `/api/${kind}?search=${encodeURIComponent(name)}&limit=25`,
  );
  const hit = res[key].find((r) => r.name === name);
  if (!hit) throw new Error(`${kind} introuvable dans le catalogue : « ${name} »`);
  return hit.id;
}

async function addItem(api: Api, charId: number, name: string, equipped: boolean, qty = 1) {
  const itemId = await catalogId(api, 'items', name);
  await api('POST', `/api/characters/${charId}/inventory`, {
    itemId,
    quantity: qty,
    equipped,
  });
}

async function addSpell(api: Api, charId: number, name: string, prepared: boolean) {
  const spellId = await catalogId(api, 'spells', name);
  await api('POST', `/api/characters/${charId}/spells`, { spellId, prepared });
}

/** EN : l'emplacement porté par défaut est créé par l'API avec un nom figé
 * « Sur moi » (non localisé) — on pré-crée « On me » (type carried) pour que
 * la fiche anglaise n'affiche pas de français ; l'API réutilise l'existant
 * plutôt que d'en recréer un. No-op en FR. */
async function ensureEnCarriedLocation(api: Api, charId: number) {
  if (lang !== 'en') return;
  await api('POST', `/api/characters/${charId}/locations`, { name: 'On me', type: 'carried' });
}

interface SeedRefs {
  partyId: number;
  encounterId: number;
  chars: { lyra: number; kael: number; mira: number; vesper: number };
}

async function seed(
  apiPort: number,
  gmaMock: MockGmaHandle['state'],
): Promise<SeedRefs & { sessions: Session[] }> {
  const md = await register(apiPort, 'mdj', 'Maître Jehan');
  const aurore = await register(apiPort, 'aurore', 'Aurore');
  const bastien = await register(apiPort, 'bastien', 'Bastien');
  const mdCall = makeApi(apiPort, md.token);
  const auCall = makeApi(apiPort, aurore.token);
  const baCall = makeApi(apiPort, bastien.token);

  // — Groupe + adhésions — le créateur est MD, les joueurs rejoignent par code.
  const { party } = await mdCall<{ party: { id: number; inviteCode: string } }>(
    'POST',
    '/api/parties',
    { name: S('Les Héros de Chult', 'The Heroes of Chult') },
  );
  await auCall('POST', '/api/parties/join', { inviteCode: party.inviteCode });
  await baCall('POST', '/api/parties/join', { inviteCode: party.inviteCode });

  // — Lyra, Druide cercle de la Lune : sortilèges, bêtes vues, forme sauvage —
  const { character: lyra } = await auCall<{ character: { id: number } }>(
    'POST',
    `/api/parties/${party.id}/characters`,
    {
      name: 'Lyra Feuillenoire',
      characterClass: 'Druide',
      level: 5,
      race: S('Elfe des bois', 'Wood Elf'),
      background: 'Ermite',
    },
  );
  await auCall('PATCH', `/api/characters/${lyra.id}`, {
    strength: 12,
    dexterity: 14,
    constitution: 14,
    intelligence: 10,
    wisdom: 18,
    charisma: 12,
    maxHp: 38,
    currentHp: 38,
    druidCircle: 'lune',
    wildShapeSeen: ['loup', 'ours-noir', 'panthere'],
    gold: 24,
    copper: 60,
  });
  await ensureEnCarriedLocation(auCall, lyra.id);
  for (const [name, equipped, qty] of [
    [S('Bâton', 'Quarterstaff'), true, 1],
    [S('Cuir', 'Leather Armor'), true, 1],
    [S('Brin de gui', 'Sprig of mistletoe'), true, 1],
    [S('Potion de soin', 'Potion of Healing'), false, 2],
    [S('Rations (1 jour)', 'Rations (1 day)'), false, 5],
    [S('Gourde', 'Waterskin'), false, 1],
    [S('Torche', 'Torch'), false, 3],
  ] as const) {
    await addItem(auCall, lyra.id, name, equipped, qty);
  }
  for (const [name, prepared] of [
    [S('Flammes', 'Produce Flame'), true],
    [S('Fouet épineux', 'Thorn whip'), true],
    [S('Vague tonnante', 'Thunderwave'), true],
    [S('Lueurs féeriques', 'Faerie Fire'), true],
    [S('Mot de guérison', 'Healing Word'), false],
    [S('Rayon de lune', 'Moonbeam'), true],
    [S('Appel de la foudre', 'Call Lightning'), true],
  ] as const) {
    await addSpell(auCall, lyra.id, name, prepared);
  }

  // — Kael, Guerrier duel : les puces 🎯 ⚔ ✨ de l'inventaire —
  const { character: kael } = await baCall<{ character: { id: number } }>(
    'POST',
    `/api/parties/${party.id}/characters`,
    {
      name: 'Kael Aubemarteau',
      characterClass: 'Guerrier',
      level: 5,
      race: S('Humain', 'Human'),
      background: 'Soldat',
    },
  );
  await baCall('PATCH', `/api/characters/${kael.id}`, {
    strength: 18,
    dexterity: 12,
    constitution: 16,
    intelligence: 9,
    wisdom: 12,
    charisma: 10,
    maxHp: 49,
    currentHp: 49,
    fightingStyle: 'dueling',
    gold: 31,
  });
  await ensureEnCarriedLocation(baCall, kael.id);
  for (const [name, equipped] of [
    [S('Épée longue', 'Longsword'), true],
    [S('Arme +1', 'Weapon, +1'), true],
    [S('Bouclier', 'Shield'), true],
    [S('Cotte de mailles', 'Chain Mail'), true],
    [S('Dague', 'Dagger'), false],
    [S('Potion de soin', 'Potion of Healing'), false],
    [S('Rations (1 jour)', 'Rations (1 day)'), false],
  ] as const) {
    await addItem(baCall, kael.id, name, equipped, equipped ? 1 : 2);
  }

  // — Mira, Clerc : soigneuse du groupe —
  const { character: mira } = await auCall<{ character: { id: number } }>(
    'POST',
    `/api/parties/${party.id}/characters`,
    {
      name: 'Mira Aubedouce',
      characterClass: 'Clerc',
      level: 5,
      race: S('Halfelin', 'Halfling'),
      background: 'Acolyte',
    },
  );
  await auCall('PATCH', `/api/characters/${mira.id}`, {
    strength: 14,
    dexterity: 10,
    constitution: 16,
    intelligence: 11,
    wisdom: 18,
    charisma: 12,
    maxHp: 40,
    currentHp: 40,
    gold: 17,
  });
  await ensureEnCarriedLocation(auCall, mira.id);
  for (const [name, equipped] of [
    [S("Masse d'armes", 'Mace'), true],
    [S('Bouclier', 'Shield'), true],
    [S("Cotte d'écailles", 'Scale Mail'), true],
    [S('Potion de soin', 'Potion of Healing'), false],
  ] as const) {
    await addItem(auCall, mira.id, name, equipped);
  }

  // — Rencontre « Embuscade gobeline » : setup, initiatives, démarrage —
  const { encounter } = await mdCall<{ encounter: { id: number } }>(
    'POST',
    `/api/parties/${party.id}/encounters`,
    { name: S('Embuscade gobeline', 'Goblin Ambush') },
  );
  const enc = encounter.id;
  await mdCall('POST', `/api/encounters/${enc}/combatants/monster`, {
    monsterSlug: 'gobelin',
    count: 3,
    // Le nom du combattant est stocké au POST depuis name_fr (« Gobelin 1… »)
    // sans re-localisation à la lecture — en EN on nomme « Goblin » (l'overlay
    // EN du slug « gobelin » est d'ailleurs erroné en base : « Dum-Dum Goblin »).
    name: S('Gobelin', 'Goblin'),
  });
  await mdCall('POST', `/api/encounters/${enc}/combatants/monster`, {
    monsterSlug: 'ogre',
    count: 1,
  });
  await mdCall('POST', `/api/encounters/${enc}/combatants/player`, {
    characterIds: [lyra.id, kael.id, mira.id],
  });

  const { encounter: full } = await mdCall<{
    encounter: {
      combatants: {
        id: number;
        name: string;
        monsterSlug: string | null;
        characterId: number | null;
      }[];
    };
  }>('GET', `/api/encounters/${enc}`);
  const cbs = full.combatants;
  const byCharacter = (cid: number) => cbs.find((c) => c.characterId === cid);
  const goblins = cbs
    .filter((c) => c.monsterSlug === 'gobelin')
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const ogre = cbs.find((c) => c.monsterSlug === 'ogre');

  // — Vesper, Occultiste 5 (fielon) / Magicien 3 (évocation) : la fiche
  // multiclassée de la capture 14 — DEUX pools d'emplacements (incantation
  // + magie de pacte), DD par classe lancente, sorts à classe d'origine.
  const { character: vesper } = await baCall<{ character: { id: number } }>(
    'POST',
    `/api/parties/${party.id}/characters`,
    {
      name: 'Vesper Ducroc',
      maxHp: 34,
      classes: [
        { classKey: 'Occultiste', level: 5, subclassKey: 'fielon' },
        { classKey: 'Magicien', level: 3, subclassKey: 'evocation' },
      ],
    },
  );
  await baCall('PATCH', `/api/characters/${vesper.id}`, {
    strength: 8,
    dexterity: 14,
    constitution: 12,
    intelligence: 16,
    wisdom: 10,
    charisma: 16,
    currentHp: 27,
    spellSlotsUsed: [2, 1, 0, 0, 0, 0, 0, 0, 0],
    pactSlotsUsed: [0, 1, 0, 0, 0, 0, 0, 0, 0],
  });
  for (const [name, classSource] of [
    [S('Décharge occulte', 'Eldritch Blast'), 'Occultiste'],
    [S('Maléfice', 'Hex'), 'Occultiste'],
    [S('Trait de feu', 'Fire Bolt'), 'Magicien'],
    [S('Flèche acide de Melf', 'Acid Arrow'), 'Magicien'],
    [S('Boule de feu', 'Fireball'), 'Magicien'],
  ] as const) {
    const id = await catalogId(baCall, 'spells', name);
    await baCall('POST', `/api/characters/${vesper.id}/spells`, {
      spellId: id,
      classSource,
      prepared: true,
    });
  }

  // Initiatives (le MD peut tout saisir) : Lyra 18, gobelins 14, Kael 12,
  // Mira 10, ogre 8 — puis premier next-turn : round 1, tour de Lyra.
  const setInit = (cid: number, initiative: number) =>
    mdCall('PATCH', `/api/encounters/${enc}/combatants/${cid}/initiative`, { initiative });
  await setInit(byCharacter(lyra.id)!.id, 18);
  await setInit(goblins[0].id, 14);
  await setInit(byCharacter(kael.id)!.id, 12);
  await setInit(byCharacter(mira.id)!.id, 10);
  await setInit(ogre!.id, 8);
  await mdCall('POST', `/api/encounters/${enc}/next-turn`);

  // Le combat a déjà mordu : dégâts (miroir fiche ↔ traqueur), un gobelin
  // effrayé, l'ogre marqué en rouge — un état vivant pour les captures.
  const patchC = (cid: number, body: unknown) => mdCall('PATCH', `/api/combatants/${cid}`, body);
  await patchC(byCharacter(lyra.id)!.id, { hitPoints: 31 });
  await patchC(byCharacter(kael.id)!.id, { hitPoints: 38 });
  await patchC(goblins[0].id, { hitPoints: 3 });
  await patchC(goblins[1].id, {
    hitPoints: 5,
    conditions: [{ name: S('Effrayé', 'Frightened'), duration: 1 }],
  });
  await patchC(ogre!.id, { hitPoints: 41, cardColor: '#fee2e2' });

  // — GM Assistant : le vrai parcours MD, contre le mock — clé du compte puis
  // init (la campagne « Les Héros de Chult » + les 3 PJ de table naissent
  // côté GMA). Vesper reste hors sync — multiclassé en pleine démo.
  await mdCall('PUT', '/api/gma/key', { apiKey: 'gma_test_full_good_key' });
  const { campaign } = await mdCall<{ campaign: { id: string } }>(
    'POST',
    `/api/parties/${party.id}/gma/init`,
    { characterIds: [lyra.id, kael.id, mira.id] },
  );

  // Chronique de démo, directement dans l'état du mock : trois séances,
  // résumés multi-styles et moments de chaque type pour l'enluminure.
  // (Contenu de démo bilingue : la prose anglaise ne vit dans aucun
  // catalogue — elle est semée ici pour des captures EN cohérentes.)
  const iso = () => new Date().toISOString();
  gmaMock.sessions.set(campaign.id, [
    {
      id: 'demo-1',
      title: S("L'arrivée à Port Nyanzaru", 'Arrival at Port Nyanzaru'),
      played_at: '2026-06-12',
      order: 0,
    },
    {
      id: 'demo-2',
      title: S('La jungle éternelle', 'The endless jungle'),
      played_at: '2026-06-26',
      order: 1,
    },
    { id: 'demo-3', title: LAST_SESSION_TITLE, played_at: '2026-07-10', order: 2 },
  ]);
  gmaMock.recaps.set('demo-3', [
    {
      style: 'short_summary',
      text: S(
        'Négociation tendue au campement batiri : une idole brisée, un passage gagné.',
        'Tense negotiation at the Batiri camp: a shattered idol, safe passage won.',
      ),
      updated_at: iso(),
    },
    {
      style: 'sonnet_summary',
      text: S(
        'Sous la pluie de Chult, le pont tenait peu,\nLe chamane brandissait un crâne qui crie ;\nMira frappa l’idole au signe de la foi,\nEt le passage s’ouvrit pour la compagnie.',
        'Under Chult’s rain the bridge barely held,\nThe shaman raised a shrieking skull on high;\nMira struck the idol where the faith was sealed,\nAnd passage opened for the company.',
      ),
      updated_at: iso(),
    },
    {
      style: 'classic_summary',
      text: S(
        'Oyez, oyez ! Par la bruine et la liane, nos héros approachèrent du camp batiri. Là, Kael le Marteau tint tête au chamane au crâne hurlant, tandis que dame Mira, d’un coup nourri, brisa l’idole impie — et le passage fut gagné contre promesse de tribut !',
        'Hear ye, hear ye! Through drizzle and liana our heroes came upon the Batiri camp. There Kael the Hammer stood fast against the shrieking-skull shaman, while Lady Mira, with one mighty blow, shattered the unholy idol — and passage was won against the promise of tribute!',
      ),
      updated_at: iso(),
    },
    {
      style: 'default',
      text: S(
        "Après trois jours de marche dans la bruine, les héros atteignent le campement batiri signalé par le guide. Kael négocie le passage du pont pendant que Lyra, changée en panthère, repère les sentinelles depuis la rive. Quand le chamane brandit un crâne hurlant, la table bascule : Mira brise l'idole d'un coup de masse au signe sacré et le campement s'ouvre enfin — contre la promesse d'un tribut à discuter demain. Dans la nuit, la jungle garde un œil sur le camp.",
        'After three days of marching through drizzle, the heroes reach the Batiri camp their guide described. Kael negotiates passage over the bridge while Lyra, shifted into a panther, scouts the sentries from the riverbank. When the shaman brandishes a shrieking skull, the table turns: Mira smashes the idol with a sacred-sigil blow of her mace and the camp finally opens — against the promise of a tribute to be discussed tomorrow. In the night, the jungle keeps an eye on the camp.',
      ),
      updated_at: iso(),
    },
  ]);
  gmaMock.moments.set('demo-3', [
    {
      id: 'demo-m1',
      is_quote: true,
      type: 'epic',
      description: S(
        'Je ne paie pas deux fois le même pont.',
        "I won't pay twice for the same bridge.",
      ),
      speaker: 'Kael Aubemarteau',
      context: S('Le pont de rondins', 'The log bridge'),
      order: 0,
    },
    {
      id: 'demo-m2',
      is_quote: false,
      type: 'funny',
      description: S(
        'Vesper tente de vendre au chamane un crâne identique à son idole — la négociation ne survit pas au premier éternuement.',
        'Vesper tries to sell the shaman a skull identical to his idol — the negotiation does not survive the first sneeze.',
      ),
      speaker: null,
      context: null,
      order: 1,
    },
    {
      id: 'demo-m3',
      is_quote: true,
      type: 'dramatic',
      description: S(
        'Le crâne a crié votre nom avant votre arrivée.',
        'The skull screamed your name before you arrived.',
      ),
      speaker: S('Le chamane batiri', 'The Batiri shaman'),
      context: S('Le feu de camp', 'The campfire'),
      order: 2,
    },
    {
      id: 'demo-m4',
      is_quote: false,
      type: 'tragic',
      description: S(
        'La mule Emmeline s’enfonce dans la mangrove avec trois jours de rations.',
        'The mule Emmeline sinks into the mangrove with three days of rations.',
      ),
      speaker: null,
      context: null,
      order: 3,
    },
    {
      id: 'demo-m5',
      is_quote: true,
      type: 'intriguing',
      description: S(
        'Quelque chose suit notre trace depuis la rivière.',
        'Something has been tracking us since the river.',
      ),
      speaker: 'Lyra Feuillenoire',
      context: null,
      order: 4,
    },
  ]);

  return {
    partyId: party.id,
    encounterId: enc,
    chars: { lyra: lyra.id, kael: kael.id, mira: mira.id, vesper: vesper.id },
    sessions: [md, aurore, bastien],
  };
}

// ---------------------------------------------------------------------------
// Playwright — sessions et captures
// ---------------------------------------------------------------------------

async function newSession(browser: Browser, session: Session): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: lang === 'en' ? 'en-US' : 'fr-FR',
    timezoneId: 'Europe/Paris',
    colorScheme: 'light',
  });
  await ctx.addInitScript(
    ({ token, user, langCode }) => {
      localStorage.setItem('dnd-inv-token', token);
      localStorage.setItem('dnd-inv-user', JSON.stringify(user));
      localStorage.setItem('dnd-inv-tour-seen', '1');
      // Visites propres d'onglet éteintes elles aussi : sans cette clé, le
      // premier changement d'onglet ouvre le spotlight react-joyride qui
      // intercepte les clics du pilotage (même liste que e2e/fixtures.ts).
      localStorage.setItem(
        'dnd-inv-tour-tabs',
        JSON.stringify([
          'survival',
          'stats',
          'spells',
          'skills',
          'inventory',
          'features',
          'description',
          'npcs',
          'notes',
        ]),
      );
      // Interface EN : i18next lit cette clé au chargement, et l'axios de
      // l'app en déduit l'en-tête Accept-Language des payloads mono-locale.
      if (langCode === 'en') localStorage.setItem('dnd-inv-lang', 'en');
    },
    { token: session.token, user: session.user, langCode: lang },
  );
  return ctx;
}

async function settle(page: Page, extraMs = 450) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // Le point de synchro de l'en-tête passe à « Synchronisé » / « Synced »
  // une fois la WS OK.
  await page
    .getByText(S('Synchronisé', 'Synced'), { exact: false })
    .first()
    .waitFor({ timeout: 6000 })
    .catch(() => {});
  await page.waitForTimeout(extraMs);
}

const webUrl = (webPort: number, p = '') => `http://127.0.0.1:${webPort}${p}`;

async function openSheet(
  ctx: BrowserContext,
  webPort: number,
  partyId: number,
  charId: number,
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(webUrl(webPort, `/party/${partyId}/character/${charId}`), {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await settle(page);
  return page;
}

/** Ouvre un onglet de la fiche sur mobile : dock direct, ou hub si secondaire. */
async function openTab(page: Page, label: string) {
  const dockBtn = page.getByRole('button', { name: label, exact: true }).first();
  if (await dockBtn.isVisible().catch(() => false)) {
    await dockBtn.click();
  } else {
    // Pendant un combat actif, le hub s'appelle « Combat en cours ».
    const hub = page
      .getByRole('button', { name: S('Autres onglets', 'Other tabs') })
      .or(page.getByRole('button', { name: S('Combat en cours', 'Combat in progress') }))
      .first();
    await hub.click();
    await page.waitForTimeout(400); // animation d'ouverture du hub
    await page.getByRole('button', { name: label }).last().click();
    await page.waitForTimeout(400); // fermeture du hub
  }
  await page.waitForTimeout(250);
}

/** Déploie les groupes de catégories de l'inventaire (repliés par défaut). */
async function expandInventoryCategories(page: Page) {
  const header = page
    .locator('button[aria-expanded="false"]')
    .filter({
      // En-tête rendu sans espaces internes : « ▼Arme(3)3.9 kg » /
      // « ▼Weapon(3)3.9 kg » (libellés CATEGORY_LABELS_FR/_EN du shared).
      hasText: S(
        /(Arme|Armure|Équipement|Outil|Monture|Munitions|Objet magique|Personnalisé)\s*\(\s*\d+\s*\)/,
        /(Weapon|Armor|Ammunition|Gear|Tool|Mount|Magic|Custom)\s*\(\s*\d+\s*\)/,
      ),
    })
    .first();
  for (let guard = 0; guard < 10; guard++) {
    if (!(await header.isVisible().catch(() => false))) break;
    await header.click();
    await page.waitForTimeout(250);
  }
}

async function shoot(page: Page, file: string, opts: { animations?: 'allow' | 'disabled' } = {}) {
  await page.screenshot({
    path: path.join(OUT_DIR, file),
    animations: opts.animations ?? 'disabled',
  });
  console.log(`  📸 ${file}`);
}

// ---------------------------------------------------------------------------
// Les 17 captures du README
// ---------------------------------------------------------------------------

interface ShotCtx {
  webPort: number;
  refs: SeedRefs;
  md: BrowserContext;
  aurore: BrowserContext;
  bastien: BrowserContext;
}

// Ces trois-là se prennent après avoir avancé jusqu'au tour des gobelins.
const GM_SHOTS = new Set(['11-table-md.png', '12-traqueur.png', '13-bloc-stats.png']);

const SHOTS: { file: string; run: (c: ShotCtx) => Promise<void> }[] = [
  {
    file: '01-parties.png',
    async run({ webPort, md }) {
      const page = await md.newPage();
      await page.goto(webUrl(webPort, '/parties'), { waitUntil: 'networkidle', timeout: 90_000 });
      await settle(page, 600);
      await page
        .getByText(S('Les Héros de Chult', 'The Heroes of Chult'))
        .first()
        .waitFor({ timeout: 10_000 });
      await shoot(page, '01-parties.png');
      await page.close();
    },
  },
  {
    file: '02-inventaire.png',
    async run(c) {
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Inventaire', 'Inventory'));
      await expandInventoryCategories(page);
      await page
        .getByText(S('Brin de gui', 'Sprig of mistletoe'))
        .first()
        .waitFor({ timeout: 10_000 });
      await shoot(page, '02-inventaire.png');
      await page.close();
    },
  },
  {
    file: '03-arme-calcul.png',
    async run(c) {
      const page = await openSheet(c.bastien, c.webPort, c.refs.partyId, c.refs.chars.kael);
      await openTab(page, S('Inventaire', 'Inventory'));
      await expandInventoryCategories(page);
      // Libellé accessible de la ligne : FR « Épée longue, 1 exemplaire » /
      // EN « Longsword × 1 » (clé rangee.itemname.quantity.exemplaire…).
      const row = page.getByRole('button', {
        name: S('Épée longue, 1 exemplaire', 'Longsword × 1'),
      });
      await row.waitFor({ timeout: 10_000 });
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await row.click(); // déploie description + puces 🎯 ⚔ ✨
      await page.waitForTimeout(350);
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await shoot(page, '03-arme-calcul.png');
      await page.close();
    },
  },
  {
    file: '04-survie-attaques.png',
    async run(c) {
      const page = await openSheet(c.bastien, c.webPort, c.refs.partyId, c.refs.chars.kael);
      await openTab(page, S('Survie', 'Survival'));
      const section = page.getByText(S('⚔ Attaques', '⚔ Attacks')).first();
      await section.waitFor({ timeout: 10_000 });
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shoot(page, '04-survie-attaques.png');
      await page.close();
    },
  },
  {
    file: '05-widget-combat.png',
    async run(c) {
      // Tour de Lyra : la carte de combat au-dessus du dock clignote « À toi ».
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await page
        .getByText(S('⚔ À toi de jouer !', '⚔ Your turn!'))
        .first()
        .waitFor({ timeout: 10_000 });
      // animations: 'allow' — la lueur pulsée combat-turn-glow fait partie de la démo
      await shoot(page, '05-widget-combat.png', { animations: 'allow' });
      await page.close();
    },
  },
  {
    file: '06-sorts.png',
    async run(c) {
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Sorts', 'Spells'));
      await page.getByText(S('Vague tonnante', 'Thunderwave')).first().waitFor({ timeout: 10_000 });
      await shoot(page, '06-sorts.png');
      await page.close();
    },
  },
  {
    file: '07-lancer-sort.png',
    async run(c) {
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Sorts', 'Spells'));
      const cast = page
        .getByRole('button', { name: S('Lancer Vague tonnante', 'Cast Thunderwave') })
        .first();
      await cast.waitFor({ timeout: 10_000 });
      await cast.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ timeout: 10_000 });
      // Incantation supérieure : emplacement de niveau 2 → dégâts à l'échelle
      await dialog
        .getByRole('button', { name: S('Niveau 2', 'Level 2') })
        .first()
        .click();
      await page.waitForTimeout(300);
      await dialog.getByText(S('Au niveau 2', 'At level 2')).first().waitFor({ timeout: 5000 });
      await shoot(page, '07-lancer-sort.png');
      await page.close();
    },
  },
  {
    file: '08-caracteristiques.png',
    async run(c) {
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Caractéristiques', 'Abilities'));
      await page
        .getByText(S('Statistiques dérivées', 'Derived statistics'))
        .first()
        .waitFor({ timeout: 10_000 });
      await shoot(page, '08-caracteristiques.png');
      await page.close();
    },
  },
  {
    file: '09-forme-sauvage.png',
    async run(c) {
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Survie', 'Survival'));
      const section = page.getByText(S('🐾 Forme sauvage', '🐾 Wild shape')).first();
      await section.waitFor({ timeout: 10_000 });
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shoot(page, '09-forme-sauvage.png');
      await page.close();
    },
  },
  {
    file: '10-formes.png',
    async run(c) {
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Survie', 'Survival'));
      const take = page.getByRole('button', {
        name: S('🐾 Prendre une forme', '🐾 Take a form'),
      });
      await take.waitFor({ timeout: 10_000 });
      await take.scrollIntoViewIfNeeded();
      await take.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ timeout: 10_000 });
      // Filtre « bêtes déjà vues » — la liste emblématique du README
      await dialog.getByRole('button', { name: S('👁 Vues', '👁 Seen') }).click();
      await page.waitForTimeout(400);
      await dialog.getByText(S('Loup', 'Wolf')).first().waitFor({ timeout: 5000 });
      await shoot(page, '10-formes.png');
      await page.close();
    },
  },
  {
    file: '11-table-md.png',
    async run(c) {
      const page = await c.md.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/gm`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page.getByText('Lyra Feuillenoire').first().waitFor({ timeout: 10_000 });
      await shoot(page, '11-table-md.png');
      await page.close();
    },
  },
  {
    file: '12-traqueur.png',
    async run(c) {
      const page = await c.md.newPage();
      await page.goto(
        webUrl(c.webPort, `/party/${c.refs.partyId}/combat?enc=${c.refs.encounterId}`),
        { waitUntil: 'networkidle', timeout: 90_000 },
      );
      await settle(page, 600);
      await page.getByText(S('Tour suivant', 'Next turn')).first().waitFor({ timeout: 10_000 });
      await page.getByText('Ogre').first().waitFor({ timeout: 10_000 });
      await shoot(page, '12-traqueur.png');
      await page.close();
    },
  },
  {
    file: '13-bloc-stats.png',
    async run(c) {
      const page = await c.md.newPage();
      await page.goto(
        webUrl(c.webPort, `/party/${c.refs.partyId}/combat?enc=${c.refs.encounterId}`),
        { waitUntil: 'networkidle', timeout: 90_000 },
      );
      await settle(page, 600);
      // Focus sur l'ogre via le rail d'initiative, puis bloc de stats amarré.
      // Les monstres sont numérotés même seuls : le bouton s'appelle « Ogre 1 ».
      await page
        .getByRole('button', { name: /^Ogre 1,/ })
        .first()
        .click();
      // La scène affiche un <h2> au nom du combattant focalisé — le rail le
      // numérote « Ogre 1 » mais la scène titre un monstre seul « Ogre ».
      await page.getByRole('heading', { name: 'Ogre', exact: true }).waitFor({ timeout: 10_000 });
      await page
        .getByRole('button', { name: /📜\s*Stats/ })
        .first()
        .click();
      // Sur mobile le bloc de stats est une feuille portée SANS role="dialog" —
      // on attend son titre (le second <h2> « Ogre », après celui de la scène).
      await page.getByRole('heading', { name: 'Ogre', exact: true }).last().waitFor({
        timeout: 10_000,
      });
      await page.waitForTimeout(600);
      await shoot(page, '13-bloc-stats.png');
      await page.close();
    },
  },
  {
    file: '14-multiclasse.png',
    async run(c) {
      // Sorts de Vesper (Occultiste 5 / Magicien 3) : deux rails étiquetés —
      // Incantation (4/2, 2+1 dépensés) et Magie de pacte en or (2× niv. 2,
      // 1 dépensé), bandeau DD par classe, sorts à classe d'origine.
      const page = await openSheet(c.bastien, c.webPort, c.refs.partyId, c.refs.chars.vesper);
      await openTab(page, S('Sorts', 'Spells'));
      await page
        .getByText(S('Magie de pacte', 'Pact magic'), { exact: true })
        .waitFor({ timeout: 10_000 });
      const rail = page.getByRole('heading', {
        name: S('Emplacements de sort', 'Spell slots'),
      });
      await rail.waitFor({ timeout: 10_000 });
      await rail.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shoot(page, '14-multiclasse.png');
      await page.close();
    },
  },
  {
    file: '15-gm-assistant.png',
    async run(c) {
      // Onglet GM Assistant de la Table du MD : compte connecté (email masqué,
      // portée), campagne liée par l'init, actions de vie de la liaison.
      const page = await c.md.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/gm`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page.getByRole('button', { name: 'GM Assistant' }).click();
      await page
        .getByRole('button', { name: S('↺ Rafraîchir les séances', '↺ Refresh the sessions') })
        .waitFor({
          timeout: 10_000,
        });
      await page.waitForTimeout(300);
      await shoot(page, '15-gm-assistant.png');
      await page.close();
    },
  },
  {
    file: '16-chronique.png',
    async run(c) {
      // La Chronique vue d'un joueur : registre des séances, la dernière en
      // entrée courante (ordinal sang), les anciennes compactes.
      const page = await c.aurore.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/chronique`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page.getByText(LAST_SESSION_TITLE).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400); // register-rise décalé
      await shoot(page, '16-chronique.png');
      await page.close();
    },
  },
  {
    file: '17-moments.png',
    async run(c) {
      // Lecture de la dernière séance : pastilles de styles puis les moments
      // mémorables enluminés par type (⚔ épique gravé, 🕯 tragique éteint…).
      const page = await c.aurore.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/chronique`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page
        .getByRole('button', {
          // FR « Lire le résumé : … » (espace avant le deux-points) /
          // EN « Read the summary: … » (clé chronique.lire.le.resume.s.title).
          name: S(
            `Lire le résumé : ${LAST_SESSION_TITLE}`,
            `Read the summary: ${LAST_SESSION_TITLE}`,
          ),
        })
        .click();
      await page
        .getByRole('heading', { name: S('Moments mémorables', 'Memorable moments') })
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400); // register-rise de la section
      await page
        .getByRole('heading', { name: S('Moments mémorables', 'Memorable moments') })
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shoot(page, '17-moments.png');
      await page.close();
    },
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('🚀 Démarrage de la stack jetable (API + Web)…');
  const stack = await bootStack();
  console.log(`   API : http://127.0.0.1:${stack.apiPort}`);
  console.log(`   Web : http://127.0.0.1:${stack.webPort}`);
  console.log(
    `   Langue : ${lang === 'en' ? 'anglaise (EN → docs/screenshots-en/)' : 'française (FR → docs/screenshots/)'}`,
  );

  let exitCode = 0;
  try {
    console.log('🌱 Semis de la campagne de démo…');
    const { sessions, ...refs } = await seed(stack.apiPort, stack.gma.state);
    const [mdS, auS, baS] = sessions;

    console.log('🎭 Ouverture de Chromium (390×844, mobile)…');
    let browser: Browser;
    try {
      browser = await chromium.launch();
    } catch (err) {
      throw new Error(
        `Chromium introuvable pour Playwright (${(err as Error).message}). ` +
          'Lance `npx playwright install chromium` puis relance.',
      );
    }

    const ctx: ShotCtx = {
      webPort: stack.webPort,
      refs,
      md: await newSession(browser, mdS),
      aurore: await newSession(browser, auS),
      bastien: await newSession(browser, baS),
    };

    const selected = SHOTS.filter(
      (s) =>
        opts.only.length === 0 ||
        opts.only.some((o) => s.file === o || s.file === `${o}.png` || s.file.startsWith(o)),
    );

    console.log(`📸 ${selected.length} capture(s) → ${path.relative(ROOT, OUT_DIR)}/`);
    const failed: { file: string; err: Error }[] = [];
    const runShot = async (s: (typeof SHOTS)[number]) => {
      try {
        process.stdout.write(`${s.file}… `);
        await s.run(ctx);
      } catch (err) {
        failed.push({ file: s.file, err: err as Error });
        console.error(`\n❌ ${s.file} : ${(err as Error).message.split('\n')[0]}`);
      }
    };

    // Ordre important : les captures joueur se font pendant le tour de Lyra
    // (la 05 montre « À toi de jouer ! »), puis on avance jusqu'aux gobelins
    // pour l'état « combat en cours » des captures MD.
    const gmShots = selected.filter((s) => GM_SHOTS.has(s.file));
    const playerShots = selected.filter((s) => !GM_SHOTS.has(s.file));
    const advanceTurn = () =>
      makeApi(stack.apiPort, mdS.token)('POST', `/api/encounters/${refs.encounterId}/next-turn`);
    if (gmShots.length > 0 && playerShots.length === 0) await advanceTurn(); // déjà en tour gobelins
    for (const s of playerShots) await runShot(s);
    if (gmShots.length > 0 && playerShots.length > 0) await advanceTurn();
    for (const s of gmShots) await runShot(s);

    await browser.close();

    if (failed.length > 0) {
      exitCode = 1;
      console.error(`\n❌ ${failed.length} capture(s) échouée(s) :\n`);
      for (const f of failed) console.error(`   ${f.file} —\n${f.err.message}`);
    } else {
      console.log('\n✅ Toutes les captures sont régénérées.');
    }
  } catch (err) {
    exitCode = 1;
    console.error(`\n💥 ${(err as Error).message}`);
    for (const p of stack.procs) console.error(`\n--- logs ${p.name} ---\n${p.tail(40)}`);
  } finally {
    if (opts.keep) {
      for (const p of stack.procs) p.detachForKeepAlive();
      console.log(
        `\n⏳ --keep : serveurs laissés en marche (api :${stack.apiPort}, web :${stack.webPort}, db : ${DB_PATH})`,
      );
    } else {
      for (const p of stack.procs) p.stop();
    }
  }

  process.exit(exitCode);
}

void main();
