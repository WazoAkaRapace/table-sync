/**
 * Régénère les captures d'écran du README (docs/screenshots/*.png en FR,
 * docs/screenshots-en/*.png via --lang en).
 *
 * Monte une stack jetable entièrement isolée (aucun risque pour les vraies
 * campagnes) puis pilote Chromium via Playwright :
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
 *              Viewports : mobile 390×844 (la majorité des captures, la fiche
 *              est mobile-first), tablette 820×1180 en portrait pour la fiche
 *              (23) et 1180×820 en paysage pour la Survie sans dock (25) et
 *              la demande d'initiative dans l'en-tête (30), bureau 1440×900
 *              pour le traqueur du MD (24) — les captures de vue élargie
 *              créent leur propre contexte Playwright via newSession().
 *
 * Bilingue : `--lang en` produit les mêmes 40 captures en anglais vers
 * docs/screenshots-en/ — l'API reçoit ?lang=en sur chaque appel du seed
 * (payloads mono-locale : `name` devient anglais), Chromium démarre en
 * locale en-US avec localStorage dnd-inv-lang=en, et tous les sélecteurs /
 * textes attendus passent par S(fr, en) avec les chaînes EXACTES du
 * catalogue EN (apps/web/src/i18n/locales/en.json — ne pas inventer).
 * Les PV des monstres restent tirés aux dés (randomité volontaire : les
 * captures 11–13 peuvent différer entre deux runs d'une même langue).
 *
 * Usage :
 *   npm run screenshots                    # régénère les 40 captures (FR)
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

/** Contenus personnalisés de la démo (section « Votre monde, vos règles »,
 *  captures 34–40) : même règle mono-locale que le reste du seed — en EN les
 *  noms créés sont anglais. */
const CUSTOM_WEAPON_NAME = S('Croc de mégalodon', 'Megashark Fang');
const CUSTOM_SPELL_NAME = S('Chant des neuvièmes vagues', 'Song of the Ninth Waves');
const CUSTOM_MONSTER_NAME = S('Rôdeur batiri à plumes', 'Feathered Batiri Ranger');
const CUSTOM_ENCOUNTER_NAME = S('Embuscade du rôdeur', "Ranger's Ambush");

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
    // Sans host : écoute double pile, comme l'API qu'on va lancer. Une sonde
    // épinglée à 127.0.0.1 laissait passer un serveur oublié sur « *:port » —
    // le check de santé lui parlait LUI, et le semis 409 sur son utilisateur.
    srv.listen(port);
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
    srv.listen(0);
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
  /** Slug du monstre personnalisé « Rôdeur batiri à plumes » (posé par
   *  ensureCustomContent, consommé par ensureCustomEncounter — capture 39). */
  customMonsterSlug?: string;
  /** Id de « Embuscade du rôdeur » dressée par ensureCustomEncounter. */
  customEncounterId?: number;
}

/** Dresse « Embuscade gobeline » en pleine morsure : initiatives posées,
 *  tour de Lyra, dégâts déjà échangés (miroir fiche ↔ traqueur), gobelin
 *  effrayé, ogre marqué. Partagé entre le semis initial et les captures
 *  de combat qui recréent la rencontre après une pause (ensureAmbushMidFight). */
async function stageAmbushMidFight(
  api: Api,
  partyId: number,
  chars: { lyra: number; kael: number; mira: number },
): Promise<number> {
  // — Rencontre « Embuscade gobeline » : setup, initiatives, démarrage —
  const { encounter } = await api<{ encounter: { id: number } }>(
    'POST',
    `/api/parties/${partyId}/encounters`,
    { name: S('Embuscade gobeline', 'Goblin Ambush') },
  );
  const enc = encounter.id;
  await api('POST', `/api/encounters/${enc}/combatants/monster`, {
    monsterSlug: 'gobelin',
    count: 3,
    // Le nom du combattant est stocké au POST depuis name_fr (« Gobelin 1… »)
    // sans re-localisation à la lecture — en EN on nomme « Goblin » (l'overlay
    // EN du slug « gobelin » est d'ailleurs erroné en base : « Dum-Dum Goblin »).
    name: S('Gobelin', 'Goblin'),
  });
  await api('POST', `/api/encounters/${enc}/combatants/monster`, {
    monsterSlug: 'ogre',
    count: 1,
  });
  await api('POST', `/api/encounters/${enc}/combatants/player`, {
    characterIds: [chars.lyra, chars.kael, chars.mira],
  });

  const { encounter: full } = await api<{
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

  // Initiatives (le MD peut tout saisir) : Lyra 18, gobelins 14, Kael 12,
  // Mira 10, ogre 8 — puis premier next-turn : round 1, tour de Lyra.
  const setInit = (cid: number, initiative: number) =>
    api('PATCH', `/api/encounters/${enc}/combatants/${cid}/initiative`, { initiative });
  await setInit(byCharacter(chars.lyra)!.id, 18);
  await setInit(goblins[0].id, 14);
  await setInit(byCharacter(chars.kael)!.id, 12);
  await setInit(byCharacter(chars.mira)!.id, 10);
  await setInit(ogre!.id, 8);
  await api('POST', `/api/encounters/${enc}/next-turn`);

  // Le combat a déjà mordu : dégâts (miroir fiche ↔ traqueur), un gobelin
  // effrayé, l'ogre marqué en rouge — un état vivant pour les captures.
  const patchC = (cid: number, body: unknown) => api('PATCH', `/api/combatants/${cid}`, body);
  await patchC(byCharacter(chars.lyra)!.id, { hitPoints: 31 });
  await patchC(byCharacter(chars.kael)!.id, { hitPoints: 38 });
  await patchC(goblins[0].id, { hitPoints: 3 });
  await patchC(goblins[1].id, {
    hitPoints: 5,
    conditions: [{ name: S('Effrayé', 'Frightened'), duration: 1 }],
  });
  await patchC(ogre!.id, { hitPoints: 41, cardColor: '#fee2e2' });
  return enc;
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

  // — Rencontre « Embuscade gobeline » : dressée par le partagé (voir
  // stageAmbushMidFight) : initiatives, tour de Lyra, morsure du combat. —
  const enc = await stageAmbushMidFight(mdCall, party.id, {
    lyra: lyra.id,
    kael: kael.id,
    mira: mira.id,
  });

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

  // — Correspondance secrète : un échange lu sur le fil de Lyra (tampons MD,
  // réponse à l'encre, « Vu »), un message de Bastien NON lu par le MD (la
  // pastille du registre) et une confidence du MD à Mira (aperçu du volume).
  const msg = (sender: Api, charId: number, body: string) =>
    sender('POST', `/api/characters/${charId}/messages`, { body });
  await msg(
    mdCall,
    lyra.id,
    S(
      'La cassette est sous l’autel — n’en parle à personne.',
      'The reliquary is under the altar — tell no one.',
    ),
  );
  await msg(auCall, lyra.id, S('Je fouille l’autel dès ce soir.', 'I search the altar tonight.'));
  await msg(
    mdCall,
    lyra.id,
    S('Bien. Préviens-moi avant de forcer le sceau.', 'Good. Warn me before forcing the seal.'),
  );
  // Chaque camp lit ce qui lui est adressé — la 18 montre des « Vu » sereins.
  await auCall('POST', `/api/characters/${lyra.id}/messages/read`, {});
  await mdCall('POST', `/api/characters/${lyra.id}/messages/read`, {});
  await msg(
    baCall,
    kael.id,
    S(
      'Le prêtre noir m’a repéré au marché — il cherche quelqu’un.',
      'The black priest spotted me at the market — he is looking for someone.',
    ),
  ); // NON lu côté MD : la pastille de la 20
  await msg(
    mdCall,
    mira.id,
    S(
      'Ton rituel de la veille a laissé une trace sur ton baudrier.',
      'Your ritual last night left a mark on your baldric.',
    ),
  );

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

async function newSession(
  browser: Browser,
  session: Session,
  opts: {
    tours?: boolean;
    viewport?: { width: number; height: number };
    desktop?: boolean;
    /** Mode bougie : pose la préférence explicite AVANT le premier
     *  chargement — le script inline d'index.html lit ts-theme et pose
     *  ts-dark avant la première peinture (zéro flash, comme un joueur
     *  qui aurait choisi Bougie dans Mon compte). */
    dark?: boolean;
  } = {},
): Promise<BrowserContext> {
  const tours = opts.tours ?? true;
  const ctx = await browser.newContext({
    // Mobile 390×844 par défaut ; les captures de vue élargie (tablette 23,
    // bureau 24) passent leur viewport et basculent en pointeur non tactile.
    viewport: opts.viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: !opts.desktop,
    hasTouch: !opts.desktop,
    locale: lang === 'en' ? 'en-US' : 'fr-FR',
    timezoneId: 'Europe/Paris',
    colorScheme: 'light',
  });
  // Session par cookie (régime « plus rien en localStorage ») : ts_access
  // authentifie les requêtes /api du navigateur, le port n'existe pas pour
  // un cookie (domain nu). Le cache user reste la seule clé posée.
  await ctx.addCookies([
    {
      name: 'ts_access',
      value: session.token,
      domain: '127.0.0.1',
      path: '/api',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await ctx.addInitScript(
    ({ user, langCode, tours, dark }) => {
      localStorage.setItem('dnd-inv-user', JSON.stringify(user));
      if (dark) localStorage.setItem('ts-theme', 'dark');
      if (tours) {
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
            'messages',
          ]),
        );
      }
      // Interface EN : i18next lit cette clé au chargement, et l'axios de
      // l'app en déduit l'en-tête Accept-Language des payloads mono-locale.
      if (langCode === 'en') localStorage.setItem('dnd-inv-lang', 'en');
    },
    { user: session.user, langCode: lang, tours, dark: opts.dark ?? false },
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

/** Dresse l'état « lance ton initiative » : l'embuscade en cours est close,
 *  « Embuscade batiri » naît en préparation et Lyra y est ajoutée — le geste
 *  même du MD qui, en prod, déclenche la notification push. Idempotent : la
 *  29 comme la 30 peuvent s'exécuter seules. */
async function ensureInitiativeEncounter(c: ShotCtx): Promise<void> {
  const name = S('Embuscade batiri', 'Batiri Ambush');
  const list = await c.mdApi<{ encounters: { id: number; name: string; status: string }[] }>(
    'GET',
    `/api/parties/${c.refs.partyId}/encounters`,
  );
  if (list.encounters.some((e) => e.name === name && e.status === 'setup')) return;
  for (const e of list.encounters) {
    if (e.status === 'active') {
      await c.mdApi('PATCH', `/api/encounters/${e.id}`, { status: 'ended' });
    }
  }
  const { encounter } = await c.mdApi<{ encounter: { id: number } }>(
    'POST',
    `/api/parties/${c.refs.partyId}/encounters`,
    { name },
  );
  await c.mdApi('POST', `/api/encounters/${encounter.id}/combatants/player`, {
    characterIds: [c.refs.chars.lyra],
  });
}

/** Termine TOUTES les rencontres non closes (actives comme en préparation) :
 *  les captures d'onglet montrent la fiche HORS combat — l'état vrai d'une
 *  table sans rencontre. Le chrome de combat (bandeau header, carte dockée,
 *  ligne de bandeau) n'y a alors rien à faire : il ne s'affiche QUE pendant
 *  une rencontre, on laisse le produit être son propre juge de paix. */
async function endFights(c: ShotCtx): Promise<void> {
  const list = await c.mdApi<{ encounters: { id: number; name: string; status: string }[] }>(
    'GET',
    `/api/parties/${c.refs.partyId}/encounters`,
  );
  for (const e of list.encounters) {
    if (e.status !== 'ended') {
      await c.mdApi('PATCH', `/api/encounters/${e.id}`, { status: 'ended' });
    }
  }
}

/** « Embuscade gobeline » vivante pour les captures de combat (05 widget,
 *  12/24/33 traqueur, 31 pupitre) : recréée à l'identique si une pause
 *  (endFights) l'a close — initiatives, tour de Lyra, morsure du combat. */
async function ensureAmbushMidFight(c: ShotCtx): Promise<void> {
  const name = S('Embuscade gobeline', 'Goblin Ambush');
  const list = await c.mdApi<{ encounters: { id: number; name: string; status: string }[] }>(
    'GET',
    `/api/parties/${c.refs.partyId}/encounters`,
  );
  if (list.encounters.some((e) => e.name === name && e.status === 'active')) return;
  await endFights(c);
  // les captures de traqueur ouvrent /combat?enc=<refs.encounterId> : la
  // rencontre recréée prend la place de l'ancienne dans les refs
  c.refs.encounterId = await stageAmbushMidFight(c.mdApi, c.refs.partyId, c.refs.chars);
}

/** Sème les contenus personnalisés de la démo (captures 34–40) : l'arme
 *  « Croc de mégalodon » créée par le MD et posée dans le sac de Kael, le
 *  sort « Chant des neuvièmes vagues » (avec table d'incantation
 *  supérieure) et le monstre « Rôdeur batiri à plumes ». Idempotent :
 *  chaque pièce vérifie son existence avant création — `--only 36` comme
 *  `--only 39` tournent seuls. Le sort 37 et l'objet 34/40 montrent des
 *  formulaires EN COURS de remplissage (aucun POST n'est déclenché par la
 *  capture elle-même). */
async function ensureCustomContent(c: ShotCtx): Promise<void> {
  const partyId = c.refs.partyId;

  // — Arme personnalisée (création MD) + sac de Kael —
  const itemRes = await c.mdApi<{ items: { id: number; name: string }[] }>(
    'GET',
    `/api/items?partyId=${partyId}&source=custom&limit=200`,
  );
  let weapon = itemRes.items.find((i) => i.name === CUSTOM_WEAPON_NAME);
  if (!weapon) {
    const { item } = await c.mdApi<{ item: { id: number } }>(
      'POST',
      `/api/parties/${partyId}/items`,
      {
        name: CUSTOM_WEAPON_NAME,
        category: 'weapon',
        weightKg: 2,
        rarity: 'rare',
        damageDice: '1d8+FOR',
        damageType: 'Slashing',
        twoHandedDice: '1d10',
        magicBonus: 2,
        baseWeapon: 'Longsword',
        properties: ['versatile'],
        description: S(
          "Arrachée à la mâchoire d'un mégalodon des côtes de Chult.",
          'Torn from the jaw of a megalodon off the Chult coast.',
        ),
      },
    );
    weapon = item;
  }
  const inv = await c.mdApi<{ entries: any[] }>(
    'GET',
    `/api/characters/${c.refs.chars.kael}/inventory`,
  );
  if (!inv.entries.some((e) => (e.itemId ?? e.item?.id) === weapon.id)) {
    await c.mdApi('POST', `/api/characters/${c.refs.chars.kael}/inventory`, {
      itemId: weapon.id,
      quantity: 1,
      equipped: false,
    });
  }

  // — Sort personnalisé (MD) avec incantation supérieure par cran —
  const spellRes = await c.mdApi<{ spells: { id: number; name: string }[] }>(
    'GET',
    `/api/spells?partyId=${partyId}&source=custom&limit=200`,
  );
  if (!spellRes.spells.some((s) => s.name === CUSTOM_SPELL_NAME)) {
    await c.mdApi('POST', `/api/parties/${partyId}/spells`, {
      name: CUSTOM_SPELL_NAME,
      level: 3,
      school: 'evocation',
      castingTime: S('1 action', '1 action'),
      rangeText: S('18 mètres', '18 meters'),
      duration: S('Instantané', 'Instantaneous'),
      components: ['V', 'S', 'M'],
      material: S('une conque des tempêtes', 'a storm conch'),
      classes: ['Barde', 'Druide'],
      damageType: 'cold',
      damage: { dice: '3d6', perSlotLevel: '1d6' },
      dc: { ability: 'con', success: 'half' },
      description: S(
        "La marée répond : une vague hurlante submerge la scène et givre tout ce qu'elle touche.",
        'The tide answers: a howling wave floods the scene and frosts everything it touches.',
      ),
      higherLevel: S('+1d6 par niveau d’emplacement supérieur.', '+1d6 per slot level above 3rd.'),
    });
  }

  // — Monstre personnalisé (MD) —
  const monsterRes = await c.mdApi<{ monsters: { slug: string; name: string }[] }>(
    'GET',
    `/api/monsters?partyId=${partyId}&origin=custom&limit=100`,
  );
  let monster = monsterRes.monsters.find((m) => m.name === CUSTOM_MONSTER_NAME);
  if (!monster) {
    const { monster: created } = await c.mdApi<{ monster: { slug: string } }>(
      'POST',
      `/api/parties/${partyId}/monsters`,
      {
        nameFr: CUSTOM_MONSTER_NAME,
        type: 'Humanoïde',
        size: 'M',
        alignment: S('neutre', 'neutral'),
        armorClass: 14,
        armorDesc: S('cuir renforcé', 'reinforced leather'),
        hitPoints: 65,
        hitDice: '10d8+20',
        speed: { walk: 9 },
        abilities: { for: 14, dex: 16, con: 14, int: 11, sag: 15, cha: 10 },
        challengeRating: 3,
        traits: [
          {
            name: S('Camouflage batiri', 'Batiri camouflage'),
            // NB : le contrat API lit `text` (le draft UI), pas `desc`.
            text: S(
              'Avantage aux jets de Discrétion dans la jungle.',
              'Advantage on Stealth checks in the jungle.',
            ),
          },
        ],
        actions: [
          {
            name: S('Arc de chasse', 'Hunting bow'),
            text: S(
              'Attaque à distance +5, portée 18 m : 6 (1d8 + 3) dégâts perforants.',
              'Ranged attack +5, range 18 m: 6 (1d8 + 3) piercing damage.',
            ),
          },
          {
            name: S('Croc rituel', 'Ritual fang'),
            text: S(
              'Attaque au corps à corps +5 : 6 (1d6 + 3) dégâts tranchants.',
              'Melee attack +5: 6 (1d6 + 3) slashing damage.',
            ),
          },
        ],
        senses: S('perception passive 14', 'passive Perception 14'),
        languages: ['commun'],
      },
    );
    monster = created;
  }
  c.refs.customMonsterSlug = monster.slug;
}

/** « Embuscade du rôdeur » vivante pour la capture 39 (traqueur bureau) :
 *  le monstre personnalisé côtoie les PJ en pleine rencontre. Miroir de
 *  ensureAmbushMidFight — recréée à l'identique si une pause l'a close.
 *  C'est la DERNIÈRE capture GM : elle clore l'embuscade gobeline au
 *  passage (endFights) comme les captures d'initiative closent la leur. */
async function ensureCustomEncounter(c: ShotCtx): Promise<void> {
  await ensureCustomContent(c);
  const list = await c.mdApi<{ encounters: { id: number; name: string; status: string }[] }>(
    'GET',
    `/api/parties/${c.refs.partyId}/encounters`,
  );
  const existing = list.encounters.find(
    (e) => e.name === CUSTOM_ENCOUNTER_NAME && e.status === 'active',
  );
  if (existing) {
    c.refs.customEncounterId = existing.id;
    return;
  }
  await endFights(c);
  const { encounter } = await c.mdApi<{ encounter: { id: number } }>(
    'POST',
    `/api/parties/${c.refs.partyId}/encounters`,
    { name: CUSTOM_ENCOUNTER_NAME },
  );
  const enc = encounter.id;
  await c.mdApi('POST', `/api/encounters/${enc}/combatants/monster`, {
    monsterSlug: c.refs.customMonsterSlug,
    count: 1,
    name: CUSTOM_MONSTER_NAME,
  });
  await c.mdApi('POST', `/api/encounters/${enc}/combatants/player`, {
    characterIds: [c.refs.chars.lyra, c.refs.chars.kael],
  });
  const { encounter: full } = await c.mdApi<{
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
  const byCharacter = (cid: number) => cbs.find((cb) => cb.characterId === cid);
  const ranger = cbs.find((cb) => cb.monsterSlug === c.refs.customMonsterSlug);
  const setInit = (cid: number, initiative: number) =>
    c.mdApi('PATCH', `/api/encounters/${enc}/combatants/${cid}/initiative`, { initiative });
  await setInit(byCharacter(c.refs.chars.lyra)!.id, 17);
  await setInit(ranger!.id, 13);
  await setInit(byCharacter(c.refs.chars.kael)!.id, 11);
  await c.mdApi('POST', `/api/encounters/${enc}/next-turn`);
  // La rencontre a déjà mordu : le rôdeur entamé (PV max posé à la fiche,
  // pas aux dés — la barre 52/65 colle au bloc de stats), Lyra égratignée.
  const patchC = (cid: number, body: unknown) => c.mdApi('PATCH', `/api/combatants/${cid}`, body);
  await patchC(ranger!.id, { hitPoints: 52, maxHitPoints: 65 });
  await patchC(byCharacter(c.refs.chars.lyra)!.id, { hitPoints: 33 });
  c.refs.customEncounterId = enc;
}

async function shoot(page: Page, file: string, opts: { animations?: 'allow' | 'disabled' } = {}) {
  await page.screenshot({
    path: path.join(OUT_DIR, file),
    animations: opts.animations ?? 'disabled',
  });
  console.log(`  📸 ${file}`);
}

// ---------------------------------------------------------------------------
// Les 40 captures du README
// ---------------------------------------------------------------------------

interface ShotCtx {
  webPort: number;
  refs: SeedRefs;
  /** Navigateur + sessions brutes : les captures multi-viewport (23, 24)
   *  bâtissent leur propre contexte via newSession(). */
  browser: Browser;
  sessions: { md: Session; aurore: Session; bastien: Session };
  md: BrowserContext;
  aurore: BrowserContext;
  bastien: BrowserContext;
  /** Session d'Aurore SANS clés de tutoriel — la visite guidée s'y déclenche
   *  (captures 21–22). */
  auroreFresh: BrowserContext;
  /** REST en tant que MD — pour faire ARRIVER un message en pleine capture
   *  (la bannière de la 19 ne se met en scène pas autrement). */
  sendAsMd: (charId: number, body: string) => Promise<void>;
  /** REST en tant que MD, usage général — les captures tardives (29–30)
   *  remodèlent le monde : clore l'embuscade, dresser celle qui réclame
   *  l'initiative. */
  mdApi: Api;
  auApi: Api;
}

// Celles-ci se prennent après avoir avancé jusqu'au tour des gobelins.
const GM_SHOTS = new Set([
  '11-table-md.png',
  '12-traqueur.png',
  '13-bloc-stats.png',
  '24-traqueur-bureau.png',
  '31-groupe-pupitre.png',
  '33-bougie-traqueur.png',
  '39-monstre-custom-rencontre.png',
]);

// Captures tardives : elles clorent l'embuscade et dressent « Embuscade
// batiri » (préparation, Lyra ajoutée) — l'état « lance ton initiative ».
// Elles coulent APRÈS les captures GM : le remodelage du monde ne doit rien
// casser aux autres, et chaque capture peut s'exécuter seule (--only 29).
const INIT_SHOTS = new Set(['29-initiative-mobile.png', '30-initiative-tablette.png']);

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
      await endFights(c);
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
    file: '26-catalogue.png',
    async run(c) {
      // Le catalogue en feuille du bas (FAB mobile) : recherche instantanée
      // « corde » — résultats avec poids en kg, prix et badge de rareté.
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Inventaire', 'Inventory'));
      await page
        .getByRole('button', {
          name: S('Ajouter un objet au catalogue', 'Add an item from the catalog'),
        })
        .click();
      const sheet = page.getByRole('dialog');
      await sheet.waitFor({ timeout: 10_000 });
      await sheet
        .getByLabel(S('Rechercher dans le catalogue', 'Search the catalog'))
        .fill(S('corde', 'rope'));
      await sheet
        .getByText(S('Corde en chanvre (15 mètres)', 'Rope, hempen (50 feet)'))
        .first()
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400); // la feuille se pose, les cartes se rangent
      await shoot(page, '26-catalogue.png');
      await page.close();
    },
  },
  {
    file: '27-bourse.png',
    async run(c) {
      // La bourse dépliée, figures au repos : les cinq coupures (Lyra : 60 PC,
      // 24 PO), le total en pièces d'or, les portes Encaisser / Dépenser.
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Inventaire', 'Inventory'));
      // Attendre les groupes : sur une page froide, react-query n'a pas encore
      // rendu les en-têtes — expandInventoryCategories sortirait aussitôt et
      // la page resterait trop courte pour ancrer la bourse.
      await page
        .getByText(S(/Arme\s*\(\s*\d+\s*\)/, /Weapon\s*\(\s*\d+\s*\)/))
        .first()
        .waitFor({ timeout: 10_000 });
      // Groupes dépliés (même pose que la 02) — sinon la page est trop courte
      // et la bourse, collée au bas, ne peut pas remonter au-dessus des UI
      // fixes (carte de combat + dock, ~230 px).
      await expandInventoryCategories(page);
      const purse = page.locator('[data-tuto="inv-bourse"]');
      await purse.scrollIntoViewIfNeeded();
      await purse.locator('button[aria-expanded="false"]').click();
      await page
        .getByRole('button', { name: S('＋ Encaisser', '＋ Gain') })
        .waitFor({ timeout: 10_000 });
      // La transition expand-grid (0.25 s) doit être FINIE avant d'ancre :
      // sinon le document grandit encore, maxScroll clamp trop tôt et la
      // bourse reste basse, sous la carte de combat.
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-tuto="inv-bourse"]');
          if (!el) return false;
          return el.getAnimations({ subtree: true }).every((a) => a.playState === 'finished');
        },
        undefined,
        { timeout: 5_000 },
      );
      // La bourse est le DERNIER bloc de l'onglet : l'ancre clampe à
      // maxScroll et la carte se pose au plus haut possible (top ≈ 354) —
      // les portes Encaisser/Dépenser dégagent la carte de combat fixée en
      // bas. Une passe de re-ancrage par image couvre tout décalage tardif.
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-tuto="inv-bourse"]');
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (rect.top > 400) {
            window.scrollTo({ top: rect.top + window.scrollY - 96, behavior: 'instant' });
            return false;
          }
          return true;
        },
        undefined,
        { timeout: 10_000 },
      );
      // Capture SANS animations:'disabled' — la passe de Playwright qui
      // fige les animations annule les transitions expand-grid déjà finies
      // et rend les groupes repliés (constaté au md5 : la même page, propre
      // en capture nue, sort repliée avec l'option). Tout est immobile ici :
      // on attend les animations ci-dessus, 'allow' ne change rien d'autre.
      await shoot(page, '27-bourse.png', { animations: 'allow' });
      await page.close();
    },
  },
  {
    file: '28-bourse-monnaie.png',
    async run(c) {
      // Le changeur : dépenser 15 PA sans une pièce d'argent sur soi — la
      // bourse casse 1 PO en 10 PA, rend la monnaie et affiche le comptoir
      // avant → après. La démonstration du rendu de monnaie AUTOMATIQUE.
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Inventaire', 'Inventory'));
      const purse = page.locator('[data-tuto="inv-bourse"]');
      await purse.scrollIntoViewIfNeeded();
      await purse.locator('button[aria-expanded="false"]').click();
      await page
        .getByRole('button', { name: S('− Dépenser', '− Spend') })
        .waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: S('− Dépenser', '− Spend') }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByLabel(S('Quantité de PA', 'Quantity of sp')).fill('15');
      // 60 PC + 24 PO − 15 PA : la pièce d'or cassée est le geste du changeur
      await dialog
        .getByText(S('1 PO cassée en 10 PA', '1 gp broken into 10 sp'))
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await shoot(page, '28-bourse-monnaie.png');
      await page.close();
    },
  },
  {
    file: '03-arme-calcul.png',
    async run(c) {
      await endFights(c);
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
      await endFights(c);
      const page = await openSheet(c.bastien, c.webPort, c.refs.partyId, c.refs.chars.kael);
      await openTab(page, S('Survie', 'Survival'));
      const section = page.getByText(S('Attaques', 'Attacks')).first();
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
      await ensureAmbushMidFight(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      // Cible le tampon du tour directement : getByText('À toi de jouer')
      // .first() attrape un span sr-only 0×0 en tête de DOM et n'est jamais
      // « visible » pour Playwright.
      await page.locator('.combat-turn-stamp').waitFor({ timeout: 25_000 });
      // animations: 'allow' — la lueur pulsée combat-turn-glow fait partie de la démo
      await shoot(page, '05-widget-combat.png', { animations: 'allow' });
      await page.close();
    },
  },
  {
    file: '06-sorts.png',
    async run(c) {
      await endFights(c);
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
      await endFights(c);
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
      await endFights(c);
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
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Survie', 'Survival'));
      const section = page.getByText(S('Forme sauvage', 'Wild shape')).first();
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
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Survie', 'Survival'));
      const take = page.getByRole('button', {
        name: S('Prendre une forme', 'Take a form'),
      });
      await take.waitFor({ timeout: 10_000 });
      await take.scrollIntoViewIfNeeded();
      await take.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ timeout: 10_000 });
      // Filtre « bêtes déjà vues » — la liste emblématique du README
      await dialog
        .getByRole('button', { name: S('Vues', 'Seen') })
        .first() // EN : « Seen » matche aussi les libellés de bêtes — la 1ʳᵉ est le filtre
        .click();
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
      await ensureAmbushMidFight(c);
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
      // numérote « Ogre 1 » mais la scène titre un monstre seul « Ogre ». Le
      // nom accessible du h2 embarque aussi le bouton « 👁 Masquer le nom »
      // (GM + monstre) : on ancre sur le préfixe, jamais sur l'exactitude.
      await page.getByRole('heading', { name: /^Ogre/ }).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: /Stats/ }).first().click();
      // Sur mobile le bloc de stats est une feuille portée SANS role="dialog" —
      // on attend son titre : le second <h2> « Ogre » (porté en fin de DOM),
      // après celui de la scène.
      await page.getByRole('heading', { name: /^Ogre/ }).last().waitFor({ timeout: 10_000 });
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
      await endFights(c);
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
  {
    file: '18-correspondance.png',
    async run(c) {
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Messages', 'Messages'));
      await page
        .getByRole('heading', {
          name: S('Correspondance avec le MD', 'Correspondence with the GM'),
        })
        .waitFor({ timeout: 10_000 });
      // Laisser le fil se marquer lu et retomber : la capture montre des
      // « Vu » sereins, le plus récent et le composeur au premier plan
      // (l'ouverture défile d'elle-même en bas du fil).
      await page.waitForTimeout(1200);
      await shoot(page, '18-correspondance.png');
      await page.close();
    },
  },
  {
    file: '19-banniere-correspondance.png',
    async run(c) {
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Inventaire', 'Inventory')); // un onglet neutre : la bannière tombe « où que tu sois »
      await c.sendAsMd(
        c.refs.chars.lyra,
        S(
          'Le prêtre noir a demandé ton nom à l’auberge. Ne dors pas seul.',
          'The black priest asked for your name at the inn. Do not sleep alone.',
        ),
      );
      await page
        .getByRole('status')
        .filter({ hasText: S('Le MD t’a écrit', 'Your GM sent you a message') })
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(350); // band-rise pose le sceau
      await shoot(page, '19-banniere-correspondance.png');
      await page.close();
    },
  },
  {
    file: '20-boite-md.png',
    async run(c) {
      const page = await c.md.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/messages`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      // Le registre porte ses trois volumes — la pastille attend sur Kael.
      await page
        .getByRole('button', {
          name: S(
            'Ouvrir la correspondance de Kael Aubemarteau',
            "Open Kael Aubemarteau's correspondence",
          ),
        })
        .waitFor({ timeout: 10_000 });
      await shoot(page, '20-boite-md.png');
      await page.close();
    },
  },
  {
    file: '21-tutoriel-bienvenue.png',
    async run(c) {
      // Session sans clés de tutoriel : la visite d'accueil part d'elle-même
      // (~800 ms après le chargement de la fiche).
      // NB : le suivi de la visite vit AU COMPTE (serverSync.ts) — la session
      // « aurore » normale a déjà posé le drapeau côté serveur. On réarme le
      // compte avant d'ouvrir la session vierge, sinon la convergence
      // AuthProvider éteint la visite et la capture attend indéfiniment.
      await c.auApi('PATCH', '/api/auth/me', { tutorialSeenAt: null });
      await endFights(c);
      const page = await openSheet(c.auroreFresh, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await page
        .getByText(S('Bienvenue sur ta fiche !', 'Welcome to your sheet!'))
        .first()
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500); // le spotlight se pose
      await shoot(page, '21-tutoriel-bienvenue.png');
      await page.close();
    },
  },
  {
    file: '22-tutoriel-hub.png',
    async run(c) {
      // Avancer jusqu'à l'étape 4 (mobile) : le spotlight sur le bouton
      // central du dock — l'onglet Messages y vit aussi.
      await endFights(c);
      const page = await openSheet(c.auroreFresh, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      // « Suivant » du tutoriel uniquement — l'aria-label de la carte de
      // combat (« passer au combattant suivant ») matche aussi le nom.
      const next = page
        .getByTestId('floater')
        .getByRole('button', { name: S('Suivant', 'Next'), exact: true });
      for (const titre of [
        S('Ta survie, toujours en vue', 'Your vitals, always in sight'),
        S('Tes onglets', 'Your tabs'),
        S('Le bouton central', 'The centre button'),
      ]) {
        await next.click();
        await page.getByText(titre).first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(450); // le spotlight glisse vers sa cible
      }
      await page.waitForTimeout(250);
      await shoot(page, '22-tutoriel-hub.png');
      await page.close();
    },
  },
  {
    file: '23-fiche-tablette.png',
    async run(c) {
      // La fiche du joueur sur tablette (820×1180, iPad portrait) : tuiles de
      // caractéristiques sur 3 colonnes, stats dérivées sur 4 — le dock
      // mobile reste sous le pouce (il ne cède la place qu'à 1024 px).
      const ctx = await newSession(c.browser, c.sessions.aurore, {
        viewport: { width: 820, height: 1180 },
      });
      try {
        await endFights(c);
        const page = await openSheet(ctx, c.webPort, c.refs.partyId, c.refs.chars.lyra);
        await openTab(page, S('Caractéristiques', 'Abilities'));
        await page
          .getByText(S('Statistiques dérivées', 'Derived statistics'))
          .first()
          .waitFor({ timeout: 10_000 });
        await page.waitForTimeout(300);
        await shoot(page, '23-fiche-tablette.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '25-survie-paysage.png',
    async run(c) {
      // La Survie sur tablette en paysage (1180×820, iPad Air) : ≥ 1024 px le
      // dock flottant s'efface devant la barre d'onglets du haut — Survie est
      // l'onglet d'accueil, la fiche se lit comme sur un ordinateur.
      const ctx = await newSession(c.browser, c.sessions.aurore, {
        viewport: { width: 1180, height: 820 },
      });
      try {
        await endFights(c);
        const page = await openSheet(ctx, c.webPort, c.refs.partyId, c.refs.chars.lyra);
        await page.getByText(S('Vitalité', 'Vitality')).first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(300);
        await shoot(page, '25-survie-paysage.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '24-traqueur-bureau.png',
    async run(c) {
      // L'écran du MD sur ordinateur (1440×900) : la page Combat s'ouvre en
      // trois colonnes — rail d'initiative à gauche, scène du tour au centre,
      // bloc de stats amarré à droite (clic « 📜 Stats » sur l'ogre focalisé).
      await ensureAmbushMidFight(c);
      const ctx = await newSession(c.browser, c.sessions.md, {
        viewport: { width: 1440, height: 900 },
        desktop: true,
      });
      try {
        const page = await ctx.newPage();
        await page.goto(
          webUrl(c.webPort, `/party/${c.refs.partyId}/combat?enc=${c.refs.encounterId}`),
          { waitUntil: 'networkidle', timeout: 90_000 },
        );
        await settle(page, 600);
        await page.getByText(S('Tour suivant', 'Next turn')).first().waitFor({ timeout: 10_000 });
        await page
          .getByRole('button', { name: /^Ogre 1,/ })
          .first()
          .click();
        // La scène titre l'ogre d'un <h2> dont le nom accessible embarque le
        // bouton « 👁 Masquer le nom » — ancre sur le préfixe, pas l'exact.
        await page.getByRole('heading', { name: /^Ogre/ }).waitFor({ timeout: 10_000 });
        await page.getByRole('button', { name: /Stats/ }).first().click();
        // Le bloc amarré porte son propre <h2> « Ogre », après celui de la
        // scène dans le DOM (l'aside est la 3e colonne de la grille).
        await page.getByRole('heading', { name: /^Ogre/ }).last().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(600);
        await shoot(page, '24-traqueur-bureau.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '31-groupe-pupitre.png',
    async run(c) {
      // La table des matières du groupe sur l'écran du MD (1440×900) : le
      // volume s'ouvre en sections réglées (I la porte sang, II le roster),
      // puis la section III devient le PUPITRE — panneau .card à quatre
      // instruments à filets internes, Combat portant l'état vif
      // « N rencontres · M en cours » (le sang ne porte que le vivant — la
      // capture se prend en plein combat gobelin), annexes réglées et code
      // d'invitation en pied de registre. Cadre : la section centrée, la
      // queue du roster de II visible au-dessus.
      await ensureAmbushMidFight(c);
      const ctx = await newSession(c.browser, c.sessions.md, {
        viewport: { width: 1440, height: 900 },
        desktop: true,
      });
      try {
        const page = await ctx.newPage();
        await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}`), {
          waitUntil: 'networkidle',
          timeout: 90_000,
        });
        await settle(page, 600);
        await page
          .getByText(S('Outils & annexes', 'Tools & extras'))
          .first()
          .waitFor({ timeout: 10_000 });
        // L'état vif du combat doit être servi (la sonde /encounters est
        // tombée) avant d'ancrer — sinon la tuile Combat dit « Aucune ».
        await page
          .getByText(S(/·\s*1\s*en\s*cours/, /·\s*1\s*underway/))
          .first()
          .waitFor({ timeout: 10_000 });
        await page.evaluate(() => {
          document
            .getElementById('toc-tools')
            ?.closest('section')
            ?.scrollIntoView({ block: 'center' });
        });
        await page.waitForTimeout(400);
        await shoot(page, '31-groupe-pupitre.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '29-initiative-mobile.png',
    async run(c) {
      // La demande d'initiative sur téléphone : le MD vient d'ajouter Lyra à
      // « Embuscade batiri » (préparation) — le déclencheur même de la
      // notification « lance ton initiative ». Le lien profond ?combat=init
      // (celui du clic sur la notification) déploie la carte dorée au-dessus
      // du dock : champ « Ton initiative », OK, dé.
      await ensureInitiativeEncounter(c);
      const page = await c.aurore.newPage();
      await page.goto(
        webUrl(c.webPort, `/party/${c.refs.partyId}/character/${c.refs.chars.lyra}?combat=init`),
        { waitUntil: 'networkidle', timeout: 90_000 },
      );
      await settle(page);
      // La carte dorée, déployée d'office par le lien profond. La bande
      // d'état porte elle aussi un bouton « Lance ton initiative ! » — on
      // ancre sur la bascule de la carte du dock, la seule avec
      // aria-expanded, et on exige qu'elle soit dépliée.
      const card = page.locator('button[aria-expanded="true"]').filter({
        hasText: S('Lance ton initiative !', 'Roll your initiative!'),
      });
      await card.waitFor({ timeout: 10_000 });
      await page.getByLabel(S('Ton initiative', 'Your initiative')).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400); // le dépliage se pose (max-h-44)
      await shoot(page, '29-initiative-mobile.png');
      await page.close();
    },
  },
  {
    file: '30-initiative-tablette.png',
    async run(c) {
      // La même demande sur tablette en paysage (1180×820) : ≥1024 px, la
      // carte du dock cède la place à la bande de combat de l'en-tête —
      // contour doré, « Lance ton initiative ! » en or, champ + OK + dé
      // déployés tant que le jet est dû, nom de la rencontre portant vers
      // le traqueur.
      await ensureInitiativeEncounter(c);
      const ctx = await newSession(c.browser, c.sessions.aurore, {
        viewport: { width: 1180, height: 820 },
      });
      try {
        const page = await ctx.newPage();
        await page.goto(
          webUrl(c.webPort, `/party/${c.refs.partyId}/character/${c.refs.chars.lyra}?combat=init`),
          { waitUntil: 'networkidle', timeout: 90_000 },
        );
        await settle(page);
        // La bande sonde #header-combat-slot jusqu'à ce que la session
        // résolve — elle finit toujours par s'y poser.
        await page.getByLabel(S('Mon initiative', 'My initiative')).waitFor({
          timeout: 10_000,
        });
        await page
          .getByText(S('Embuscade batiri', 'Batiri Ambush'))
          .first()
          .waitFor({ timeout: 10_000 });
        await page.waitForTimeout(400);
        await shoot(page, '30-initiative-tablette.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '32-bougie-fiche.png',
    async run(c) {
      // La fiche du joueur À LA BOUGIE (mobile) : le même grimoire, à la
      // lueur de la bougie — les ramps retournées (parchemin → cuir sombre,
      // encre → texte parchemin), le bandeau applicatif et le dock sur la
      // rampe night constante. Le choix « Bougie » est posé AVANT le
      // premier chargement (comme un joueur l'ayant choisi dans Mon compte) :
      // aucune bascule visible, la page naît sombre.
      const ctx = await newSession(c.browser, c.sessions.aurore, { dark: true });
      try {
        await endFights(c);
        const page = await openSheet(ctx, c.webPort, c.refs.partyId, c.refs.chars.lyra);
        await page.getByText(S('Vitalité', 'Vitality')).first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(300);
        await shoot(page, '32-bougie-fiche.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '33-bougie-traqueur.png',
    async run(c) {
      // Le traqueur de combat du MD À LA BOUGIE (1440×900) : la salle
      // tamisée où la table joue — rail d'initiative, scène du tour et
      // bloc de stats sur le cuir sombre, les couleurs de règle (PV,
      // conditions) ré-étalées pour rester lisibles à basse lumière.
      await ensureAmbushMidFight(c);
      const ctx = await newSession(c.browser, c.sessions.md, {
        viewport: { width: 1440, height: 900 },
        desktop: true,
        dark: true,
      });
      try {
        const page = await ctx.newPage();
        await page.goto(
          webUrl(c.webPort, `/party/${c.refs.partyId}/combat?enc=${c.refs.encounterId}`),
          { waitUntil: 'networkidle', timeout: 90_000 },
        );
        await settle(page, 600);
        await page.getByText(S('Tour suivant', 'Next turn')).first().waitFor({ timeout: 10_000 });
        await page.getByText('Ogre').first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(300);
        await shoot(page, '33-bougie-traqueur.png');
        await page.close();
      } finally {
        await ctx.close();
      }
    },
  },
  {
    file: '34-objet-personnalise.png',
    async run(c) {
      // Le joueur crée un objet que le SRD n'a jamais connu : depuis la
      // recherche du catalogue (l'autonomie players_create_items est à 1 par
      // défaut), le bouton « + Créer “…” » ouvre la feuille de création —
      // nom déjà saisi par la recherche, poids et description à la main, la
      // porte « ✨ Créer et ajouter » en bas. Aucun envoi : la capture
      // montre le geste, pas le résultat.
      await endFights(c);
      const page = await openSheet(c.aurore, c.webPort, c.refs.partyId, c.refs.chars.lyra);
      await openTab(page, S('Inventaire', 'Inventory'));
      await page
        .getByRole('button', {
          name: S('Ajouter un objet au catalogue', 'Add an item from the catalog'),
        })
        .click();
      const sheet = page.getByRole('dialog');
      await sheet.waitFor({ timeout: 10_000 });
      const itemName = S('Idole de jade batiri', 'Batiri jade idol');
      await sheet
        .getByLabel(S('Rechercher dans le catalogue', 'Search the catalog'))
        .fill(itemName);
      await sheet
        .getByRole('button', {
          name: S(`+ Créer « ${itemName} »`, `+ Create “${itemName}”`),
        })
        .waitFor({ timeout: 10_000 });
      await sheet
        .getByRole('button', {
          name: S(`+ Créer « ${itemName} »`, `+ Create “${itemName}”`),
        })
        .click();
      const modal = page.getByRole('dialog').last();
      await modal.waitFor({ timeout: 10_000 });
      await modal.getByLabel(S('Poids (kg)', 'Weight (kg)')).fill('2');
      await modal
        .getByLabel(S('Description', 'Description'), { exact: true })
        .fill(
          S(
            'Idole de jade vert de la taille du poing, tiède même la nuit.',
            'Fist-sized green jade idol, warm even at night.',
          ),
        );
      await modal
        .getByRole('button', { name: S('Créer et ajouter', 'Create and add') })
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(400); // la feuille se pose
      await shoot(page, '34-objet-personnalise.png');
      await page.close();
    },
  },
  {
    file: '35-arme-personnalisee.png',
    async run(c) {
      // Le formulaire d'arme du MD : onglet « Objets custom » du pupitre,
      // « + Ajouter » catégorie Arme — « Basée sur » une épée longue,
      // modèle de dégâts libre, propriété Polyvalente cochée, bonus magique
      // +2. Aucun POST avant la capture : le panneau montre l'arme en
      // devenir (aperçu symbolique, le MD n'a pas de porteur).
      const page = await c.md.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/gm`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page.getByRole('button', { name: S('Objets custom', 'Custom items') }).click();
      await page
        .getByRole('button', { name: S('+ Ajouter', '+ Add') })
        .first()
        .click();
      const modal = page.getByRole('dialog');
      await modal.waitFor({ timeout: 10_000 });
      await modal.getByLabel(S('Nom *', 'Name *'), { exact: true }).fill(CUSTOM_WEAPON_NAME);
      // NB : le label enveloppant du select embarque le TEXTE DES OPTIONS dans
      // son nom accessible (« CatégoriePersonnaliséArme… ») — jamais d'exact.
      await modal
        .getByLabel(S('Catégorie', 'Category'))
        .selectOption({ label: S('Arme', 'Weapon') });
      await page.waitForTimeout(250); // le panneau d'arme se pose
      await modal.getByLabel(S('Basée sur', 'Based on')).selectOption('Longsword');
      await modal
        .getByLabel(S('Dégâts (dés, FOR, DEX ou magie)', 'Damage (dice, FOR, DEX or magie)'))
        .fill('1d8+FOR');
      // La puce Polyvalente : le clic peut tomber pendant un re-rendu du
      // panneau (constaté : aria-pressed reste false) — on vérifie l'état et
      // on réessaie, puis le champ deux mains suit l'état.
      const poly = modal.getByRole('button', { name: S('Polyvalente', 'Versatile') });
      for (let guard = 0; guard < 3; guard++) {
        if ((await poly.getAttribute('aria-pressed')) === 'true') break;
        await poly.click();
        await page.waitForTimeout(300);
      }
      await modal.getByLabel(S('Dés à deux mains', 'Two-handed dice')).fill('1d10');
      await modal
        .getByRole('group', { name: S('Bonus magique', 'Magic bonus') })
        .getByRole('button', { name: '+2', exact: true })
        .click();
      await page.waitForTimeout(300);
      // Composition : le champ deux mains au centre — type, bonus et
      // propriétés se lisent au-dessus, l'aperçu suit en dessous.
      await modal
        .getByLabel(S('Dés à deux mains', 'Two-handed dice'))
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await shoot(page, '35-arme-personnalisee.png');
      await page.close();
    },
  },
  {
    file: '36-arme-custom-fiche.png',
    async run(c) {
      // L'arme custom sur la fiche de Kael : la ligne d'inventaire dépliée
      // porte les puces 🎯 ⚔ ✨ calculées par le moteur — la lame inventée
      // est traitée comme une lame du SRD (miroir de la 03, le geste du MD
      // est cette fois passé par ensureCustomContent).
      await endFights(c);
      await ensureCustomContent(c);
      const page = await openSheet(c.bastien, c.webPort, c.refs.partyId, c.refs.chars.kael);
      await openTab(page, S('Inventaire', 'Inventory'));
      await expandInventoryCategories(page);
      const row = page.getByRole('button', {
        name: S(`${CUSTOM_WEAPON_NAME}, 1 exemplaire`, `${CUSTOM_WEAPON_NAME} × 1`),
      });
      await row.waitFor({ timeout: 10_000 });
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await row.click(); // déploie description + puces 🎯 ⚔ ✨
      await page.waitForTimeout(350);
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await shoot(page, '36-arme-custom-fiche.png');
      await page.close();
    },
  },
  {
    file: '37-sort-personnalise.png',
    async run(c) {
      // Le MD inscrit un sort de la table : onglet « Sorts custom » du
      // pupitre, « + Ajouter » — nom, niveau 3, dés de dégâts et le
      // raccourci d'incantation supérieure « +1d6 par cran » dont la puce
      // or se pose sous le champ. ensureCustomContent a déjà semé le sort
      // (compteur de l'onglet) ; la capture montre le formulaire vivant,
      // sans envoi.
      await ensureCustomContent(c);
      const page = await c.md.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/gm`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page.getByRole('button', { name: S('Sorts custom', 'Custom spells') }).click();
      await page
        .getByRole('button', { name: S('+ Ajouter', '+ Add') })
        .first()
        .click();
      const modal = page.getByRole('dialog');
      await modal.waitFor({ timeout: 10_000 });
      await modal.getByLabel(S('Nom', 'Name'), { exact: true }).fill(CUSTOM_SPELL_NAME);
      // Id dédié : le label « Niveau » du select embarque ses options dans le
      // nom accessible, et « Niveaux supérieurs » (textarea) le matcherait aussi.
      await modal.locator('#spell-level-input').selectOption('3');
      await modal.locator('#spell-damage-input').fill('3d6');
      // Clés bas de casse côté SpellFields (« cold »), pas les clés
      // capitalisées du catalogue d'objets (« Cold »).
      await modal.locator('#spell-damage-type-input').selectOption('cold');
      await modal.locator('#spell-upcast-damage-input').fill('1d6');
      // La puce or « +1d6 par cran » vit sous le champ d'upcast : on l'ancre
      // au centre — le raccourci et les dés de base lisent ensemble.
      await modal.getByText(S('+1d6 par cran', '+1d6 per level')).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shoot(page, '37-sort-personnalise.png');
      await page.close();
    },
  },
  {
    file: '38-monstre-personnalise.png',
    async run(c) {
      // Le bloc de stats du monstre custom : onglet « Monstres custom » du
      // pupitre, « Modifier » sur la créature seedée — le pied de modal
      // porte l'aperçu embarqué (CA, PV, actions, dés cliquables), la vraie
      // fiche du bestiaire rendue par MonsterStatBlock.
      await ensureCustomContent(c);
      const page = await c.md.newPage();
      await page.goto(webUrl(c.webPort, `/party/${c.refs.partyId}/gm`), {
        waitUntil: 'networkidle',
        timeout: 90_000,
      });
      await settle(page, 600);
      await page.getByRole('button', { name: S('Monstres custom', 'Custom monsters') }).click();
      await page.getByText(CUSTOM_MONSTER_NAME).first().waitFor({ timeout: 10_000 });
      await page
        .getByRole('button', { name: S('Modifier', 'Edit'), exact: true })
        .first()
        .click();
      const modal = page.getByRole('dialog');
      await modal.waitFor({ timeout: 10_000 });
      // L'aperçu embarqué : le titre « Aperçu » du pied de modal (pas le
      // panneau Arme/Aperçu d'un autre onglet — on est ici monstre).
      await modal
        .getByText(S('Aperçu', 'Preview'), { exact: true })
        .last()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(400); // le bloc se pose
      await shoot(page, '38-monstre-personnalise.png');
      await page.close();
    },
  },
  {
    file: '40-armure-personnalisee.png',
    async run(c) {
      // Le joueur façonne une armure : même feuille de création d'objet,
      // catégorie Armure — type Intermédiaire, CA de base 14, et l'aperçu
      // computeAC sur le personnage courant (Kael : 14 + DEX) qui chiffre
      // la classe d'armure sur-le-champ. L'autonomie players_create_items
      // (défaut 1) est le kill switch du MD.
      await endFights(c);
      const page = await openSheet(c.bastien, c.webPort, c.refs.partyId, c.refs.chars.kael);
      await openTab(page, S('Inventaire', 'Inventory'));
      await page
        .getByRole('button', {
          name: S('Ajouter un objet au catalogue', 'Add an item from the catalog'),
        })
        .click();
      const sheet = page.getByRole('dialog');
      await sheet.waitFor({ timeout: 10_000 });
      const armorName = S('Écailles de mégalodon', 'Megashark scales');
      await sheet
        .getByLabel(S('Rechercher dans le catalogue', 'Search the catalog'))
        .fill(armorName);
      await sheet
        .getByRole('button', {
          name: S(`+ Créer « ${armorName} »`, `+ Create “${armorName}”`),
        })
        .waitFor({ timeout: 10_000 });
      await sheet
        .getByRole('button', {
          name: S(`+ Créer « ${armorName} »`, `+ Create “${armorName}”`),
        })
        .click();
      const modal = page.getByRole('dialog').last();
      await modal.waitFor({ timeout: 10_000 });
      // Label enveloppant du select : son nom accessible embarque les options
      // (« CatégoriePersonnaliséArme… ») — jamais de matching exact.
      await modal.getByLabel(S('Catégorie', 'Category')).selectOption('armor');
      await page.waitForTimeout(250); // le panneau d'armure se pose
      await modal.getByRole('button', { name: S('Intermédiaire', 'Medium'), exact: true }).click();
      await modal.getByLabel(S('CA de base', 'Base AC'), { exact: true }).fill('14');
      await page.waitForTimeout(300); // la puce CA calculée se pose
      await modal.getByLabel(S('CA de base', 'Base AC'), { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shoot(page, '40-armure-personnalisee.png');
      await page.close();
    },
  },
  {
    file: '39-monstre-custom-rencontre.png',
    async run(c) {
      // Le monstre custom en pleine rencontre, traqueur bureau (1440×900) —
      // miroir de la 24 avec la créature inventée : rail d'initiative,
      // scène du tour, bloc de stats amarré sur le rôdeur focalisé.
      // Dernière capture GM : ensureCustomEncounter clore l'embuscade
      // gobeline et dresse « Embuscade du rôdeur » (idempotent, --only 39
      // tourne seul).
      await ensureCustomEncounter(c);
      const ctx = await newSession(c.browser, c.sessions.md, {
        viewport: { width: 1440, height: 900 },
        desktop: true,
      });
      try {
        const page = await ctx.newPage();
        await page.goto(
          webUrl(c.webPort, `/party/${c.refs.partyId}/combat?enc=${c.refs.customEncounterId}`),
          { waitUntil: 'networkidle', timeout: 90_000 },
        );
        await settle(page, 600);
        await page.getByText(S('Tour suivant', 'Next turn')).first().waitFor({ timeout: 10_000 });
        // Le rail numérote même une créature seule : « Rôdeur batiri à
        // plumes 1 » — ancre sur le préfixe, jamais sur l'exactitude.
        await page
          .getByRole('button', {
            name: new RegExp(`^${CUSTOM_MONSTER_NAME} 1,`),
          })
          .first()
          .click();
        await page
          .getByRole('heading', { name: new RegExp(`^${CUSTOM_MONSTER_NAME}`) })
          .waitFor({ timeout: 10_000 });
        await page.getByRole('button', { name: /Stats/ }).first().click();
        await page
          .getByRole('heading', { name: new RegExp(`^${CUSTOM_MONSTER_NAME}`) })
          .last()
          .waitFor({ timeout: 10_000 });
        // Les actions du bloc (dés cliquables) vivent sous le pli de la
        // colonne : on les fait remonter sans chasser l'en-tête du bloc.
        await page
          .getByRole('heading', { name: S('Actions', 'Actions'), exact: true })
          .last()
          .evaluate((el) => el.scrollIntoView({ block: 'end' }));
        await page.waitForTimeout(600);
        await shoot(page, '39-monstre-custom-rencontre.png');
        await page.close();
      } finally {
        await ctx.close();
      }
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

    console.log('🎭 Ouverture de Chromium (mobile 390×844 · tablette et bureau à la demande)…');
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
      browser,
      sessions: { md: mdS, aurore: auS, bastien: baS },
      md: await newSession(browser, mdS),
      aurore: await newSession(browser, auS),
      bastien: await newSession(browser, baS),
      auroreFresh: await newSession(browser, auS, { tours: false }),
      sendAsMd: async (charId, body) => {
        await makeApi(stack.apiPort, mdS.token)('POST', `/api/characters/${charId}/messages`, {
          body,
        });
      },
      mdApi: makeApi(stack.apiPort, mdS.token),
      auApi: makeApi(stack.apiPort, auS.token),
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
    // pour l'état « combat en cours » des captures MD. Les captures tardives
    // (29–30) coulent en dernier : elles closent l'embuscade et dressent
    // « Embuscade batiri » — l'état « lance ton initiative ».
    const gmShots = selected.filter((s) => GM_SHOTS.has(s.file));
    const initShots = selected.filter((s) => INIT_SHOTS.has(s.file));
    const playerShots = selected.filter((s) => !GM_SHOTS.has(s.file) && !INIT_SHOTS.has(s.file));
    const advanceTurn = () =>
      makeApi(stack.apiPort, mdS.token)('POST', `/api/encounters/${refs.encounterId}/next-turn`);
    // L'encounter peut déjà être clos (des shots joueurs appellent endFights) —
    // un 400 « Combat terminé » n'est pas fatal : les gmShots re-stagent une
    // embuscade à mi-combat via ensureAmbushMidFight de toute façon.
    const advanceTurnSafe = async () => {
      try {
        await advanceTurn();
      } catch {
        // combat déjà terminé — les gmShots re-stagent leur propre état.
      }
    };
    if (gmShots.length > 0 && playerShots.length === 0) await advanceTurnSafe(); // déjà en tour gobelins
    for (const s of playerShots) await runShot(s);
    if (gmShots.length > 0 && playerShots.length > 0) await advanceTurnSafe();
    for (const s of gmShots) await runShot(s);
    for (const s of initShots) await runShot(s);

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
