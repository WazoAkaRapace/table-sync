/**
 * Seed de la campagne E2E — une fois par lancement, via REST contre l'API
 * dont le health-check webServer vient de passer (catalogue prêt).
 *
 * Crée : 2 comptes (MD « maitre », joueuse « lyra »), un groupe rejoint par
 * code d'invitation, 2 PJ possédés par la joueuse (Kael le Guerrier avec
 * harnois + épée longue, Mira la Clerce avec sorts), et une rencontre
 * « Embuscade gobeline » NON DÉMARRÉE (2 gobelins + Kael en combattant) —
 * c'est la spec combat qui pilote initiatives → démarrage → tour suivant.
 *
 * Tout ce dont les specs ont besoin atterrit dans e2e/.seed.json (gitignoré).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from './env';

const PASSWORD = 'e2e-secret-1';

// ---------------------------------------------------------------------------
// Mini-client REST — messages d'erreur explicites en français
// ---------------------------------------------------------------------------

type Session = { token: string; user: { id: number; username: string; displayName: string } };

async function call<T = any>(
  method: string,
  p: string,
  { body, token }: { body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${p}`, {
    method,
    headers: {
      // Sans corps, content-type: application/json ferait rejeter la requête
      // par Fastify (FST_ERR_CTP_EMPTY_JSON_BODY) — on ne l'envoie que si utile.
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(
      `Seed E2E : ${method} ${p} → ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  return (res.status === 204 ? undefined : res.json()) as T;
}

/** Résout l'id numérique d'un objet/sort du catalogue par son nom français exact. */
async function catalogId(kind: 'items' | 'spells', nameFr: string, token: string): Promise<number> {
  const res = await call<{ [k: string]: { id: number; nameFr: string }[] }>(
    'GET',
    `/api/${kind}?search=${encodeURIComponent(nameFr)}&limit=25`,
    { token },
  );
  const hit = res[kind].find((r) => r.nameFr === nameFr);
  if (!hit) throw new Error(`Seed E2E : « ${nameFr} » introuvable dans le catalogue ${kind}.`);
  return hit.id;
}

async function addItem(token: string, charId: number, nameFr: string, equipped: boolean, qty = 1) {
  const itemId = await catalogId('items', nameFr, token);
  await call('POST', `/api/characters/${charId}/inventory`, {
    token,
    body: { itemId, quantity: qty, equipped },
  });
}

async function addSpell(token: string, charId: number, nameFr: string, prepared: boolean) {
  const spellId = await catalogId('spells', nameFr, token);
  await call('POST', `/api/characters/${charId}/spells`, { token, body: { spellId, prepared } });
}

async function register(username: string, displayName: string): Promise<Session> {
  return call('POST', '/api/auth/register', {
    body: { username, password: PASSWORD, displayName },
  });
}

// ---------------------------------------------------------------------------
// Le seed proprement dit
// ---------------------------------------------------------------------------

export default async function globalSetup(): Promise<void> {
  // — Comptes : le MD crée le groupe, la joueuse rejoint par code —
  await register('maitre', 'Maître Jehan');
  await register('lyra', 'Lyra');
  // Login réel (pas seulement le token du register) : prouve la route et
  // capture des tokens fraîchement signés.
  const gmLogin = await call<Session>('POST', '/api/auth/login', {
    body: { username: 'maitre', password: PASSWORD },
  });
  const playerLogin = await call<Session>('POST', '/api/auth/login', {
    body: { username: 'lyra', password: PASSWORD },
  });

  const gmToken = gmLogin.token;
  const playerToken = playerLogin.token;

  const { party } = await call<{ party: { id: number; name: string; inviteCode: string } }>(
    'POST',
    '/api/parties',
    { token: gmToken, body: { name: 'Les Éclaireurs de Chult' } },
  );
  await call('POST', '/api/parties/join', {
    token: playerToken,
    body: { inviteCode: party.inviteCode },
  });

  // — Kael, Guerrier niv. 5 : harnois (FOR min 15 ≤ 16), épée longue, bouclier —
  const { character: kael } = await call<{ character: { id: number; name: string } }>(
    'POST',
    `/api/parties/${party.id}/characters`,
    {
      token: playerToken,
      body: {
        name: 'Kael Aubemarteau',
        characterClass: 'Guerrier',
        level: 5,
        race: 'Humain',
        background: 'Soldat',
      },
    },
  );
  await call('PATCH', `/api/characters/${kael.id}`, {
    token: playerToken,
    body: {
      strength: 16,
      dexterity: 12,
      constitution: 16,
      intelligence: 9,
      wisdom: 12,
      charisma: 10,
      maxHp: 44,
      currentHp: 44,
      gold: 31,
    },
  });
  for (const [name, equipped, qty] of [
    ['Épée longue', true, 1],
    ['Harnois', true, 1],
    ['Bouclier', true, 1],
    ['Potion de soin', false, 2],
    ['Rations (1 jour)', false, 4],
  ] as const) {
    await addItem(playerToken, kael.id, name, equipped, qty);
  }

  // — Mira, Clerce niv. 5 : tour de magie + 2 sorts de niveau 1 —
  const { character: mira } = await call<{ character: { id: number; name: string } }>(
    'POST',
    `/api/parties/${party.id}/characters`,
    {
      token: playerToken,
      body: {
        name: 'Mira Aubedouce',
        characterClass: 'Clerc',
        level: 5,
        race: 'Halfelin',
        background: 'Acolyte',
      },
    },
  );
  await call('PATCH', `/api/characters/${mira.id}`, {
    token: playerToken,
    body: {
      strength: 14,
      dexterity: 10,
      constitution: 16,
      intelligence: 11,
      wisdom: 18,
      charisma: 12,
      maxHp: 40,
      currentHp: 40,
      gold: 17,
    },
  });
  for (const [name, equipped] of [
    ["Masse d'armes", true],
    ['Bouclier', true],
    ["Cotte d'écailles", true],
  ] as const) {
    await addItem(playerToken, mira.id, name, equipped);
  }
  for (const [name, prepared] of [
    ['Flamme sacrée', true],
    ['Mot de guérison', true],
    ['Blessure', true],
  ] as const) {
    await addSpell(playerToken, mira.id, name, prepared);
  }

  // — Objet illustré « Lettre du duc » : création MD + illustration multipart,
  //    portée par Kael — la spec objets-illustrations déplie sa ligne —
  const { item: lettre } = await call<{ item: { id: number } }>(
    'POST',
    `/api/parties/${party.id}/items`,
    {
      token: gmToken,
      body: { name: 'Lettre du duc', description: 'Un ordre de mission au sceau brisé' },
    },
  );
  // 1×1 JPEG RÉEL (données de scan incluses) — le navigateur du joueur doit le
  // DÉCODER dans la vignette : un JPEG réduit à son en-tête passe le sniff du
  // serveur mais fire img.onerror côté browser (leçon e2e 2026-08-23).
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
    'base64',
  );
  const form = new FormData();
  form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'illustration.jpg');
  const putImage = await fetch(`${API_BASE}/api/items/${lettre.id}/image`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${gmToken}` },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!putImage.ok) {
    throw new Error(`Seed E2E : illustration de la lettre → ${putImage.status}`);
  }
  await call('POST', `/api/characters/${kael.id}/inventory`, {
    token: playerToken,
    body: { itemId: lettre.id, quantity: 1 },
  });

  // — Rencontre « Embuscade gobeline » : setup, NON démarrée —
  const { encounter } = await call<{ encounter: { id: number; name: string } }>(
    'POST',
    `/api/parties/${party.id}/encounters`,
    { token: gmToken, body: { name: 'Embuscade gobeline' } },
  );
  await call('POST', `/api/encounters/${encounter.id}/combatants/monster`, {
    token: gmToken,
    body: { monsterSlug: 'gobelin', count: 2 },
  });
  await call('POST', `/api/encounters/${encounter.id}/combatants/player`, {
    token: gmToken,
    body: { characterIds: [kael.id] },
  });
  const { encounter: full } = await call<{
    encounter: {
      combatants: {
        id: number;
        name: string;
        monsterSlug: string | null;
        characterId: number | null;
      }[];
    };
  }>('GET', `/api/encounters/${encounter.id}`, { token: gmToken });
  const combatants = full.combatants;
  const goblins = combatants
    .filter((c) => c.monsterSlug === 'gobelin')
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const kaelCombatant = combatants.find((c) => c.characterId === kael.id);
  if (goblins.length !== 2 || !kaelCombatant) {
    throw new Error(
      'Seed E2E : combattants de la rencontre inattendus (gobelins ou Kael manquants).',
    );
  }

  // — Référence pour les specs (e2e/.seed.json, gitignoré) —
  const toSession = (login: Session) => ({
    id: login.user.id,
    username: login.user.username,
    displayName: login.user.displayName,
    password: PASSWORD,
    token: login.token,
    user: login.user,
  });
  const seed = {
    gm: toSession(gmLogin),
    player: toSession(playerLogin),
    partyId: party.id,
    partyName: party.name,
    inviteCode: party.inviteCode,
    guerrier: { id: kael.id, name: kael.name, combatantId: kaelCombatant.id },
    clerc: { id: mira.id, name: mira.name },
    lettreId: lettre.id,
    encounterId: encounter.id,
    encounterName: encounter.name,
    gobelinIds: goblins.map((g) => g.id),
  };
  const seedPath = path.resolve(process.cwd(), 'e2e', '.seed.json');
  await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
}
