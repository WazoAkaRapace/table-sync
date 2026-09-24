/**
 * Jetons de rafraîchissement (sessions 30 jours glissants) : émission à
 * l'inscription/login, rotation intégrale à chaque /refresh (le jeton
 * présenté meurt, le successeur hérite de la fenêtre), family kill à la
 * réutilisation d'un jeton consommé, expiration, révocation au logout et au
 * changement de mot de passe. /api/auth/refresh est PUBLIC (pas de JWT — le
 * refresh token EST la preuve, tous les appels ci-dessous partent sans
 * en-tête Authorization).
 *
 * Cookie HttpOnly (docs/plan-refresh-cookie.md) : la preuve vit dans
 * ts_refresh (Path=/api/auth, SameSite=Strict, Max-Age 30 j, Secure
 * conditionnel sur X-Forwarded-Proto) ; l'en-tête x-refresh-token et le
 * corps JSON restent des chemins de transition pour les clients
 * pré-cookie.
 */
import {
  api,
  type ApiResponse,
  eq,
  type Fixtures,
  includes,
  ok,
  type ServerHandle,
} from './harness.ts';

interface AuthRes {
  token: string;
  refreshToken: string;
  user: { id: number; username: string };
}

/** Le Set-Cookie ts_refresh d'une réponse : valeur brute + attributs bas de casse. */
function cookieHeader(res: ApiResponse): { value: string; attrs: string[] } | null {
  const all = ((res.headers as any).getSetCookie?.() ?? []) as string[];
  const raw = all.find((c) => c.startsWith('ts_refresh='));
  if (!raw) return null;
  const [pair, ...attrs] = raw.split(';');
  return {
    value: pair.slice('ts_refresh='.length),
    attrs: attrs.map((a) => a.trim().toLowerCase()),
  };
}

function registerBody(username: string) {
  return {
    username,
    password: 'password123',
    displayName: username.toUpperCase(),
    email: `${username}@example.com`,
  };
}

export async function run(base: string, _fx: Fixtures, srv: ServerHandle): Promise<void> {
  const refresh = (refreshToken: string) =>
    api(base, 'POST', '/api/auth/refresh', { body: { refreshToken } });
  const login = (username: string, password = 'password123') =>
    api(base, 'POST', '/api/auth/login', { body: { username, password } });
  const rowsFor = (userId: number) =>
    srv.queryAll('SELECT * FROM refresh_tokens WHERE user_id = ?', userId);

  // ---------- Émission : register et login posent le couple ----------
  const reg = await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-herve') });
  eq(reg.status, 201, 'register rt-herve');
  const regData = reg.data as AuthRes;
  ok(
    typeof regData.refreshToken === 'string' && regData.refreshToken.length >= 64,
    'register renvoie un refreshToken (≥ 64 caractères)',
  );
  const regCookie = cookieHeader(reg);
  ok(!!regCookie, 'register pose un Set-Cookie ts_refresh');
  ok(
    !!regCookie && regCookie.value === regData.refreshToken,
    'le cookie du register porte le MÊME brut que le champ JSON (transition)',
  );

  const loginRes = await login('rt-herve');
  eq(loginRes.status, 200, 'login rt-herve');
  const herveId = (loginRes.data as AuthRes).user.id;
  const tokenA = (loginRes.data as AuthRes).refreshToken;
  ok(!!tokenA, 'login renvoie un refreshToken');
  // ---------- Cookie posé au login : attributs exacts ----------
  const loginCookie = cookieHeader(loginRes);
  ok(!!loginCookie, 'login pose un Set-Cookie ts_refresh');
  if (loginCookie) {
    eq(loginCookie.value, tokenA, 'le cookie porte le même jeton brut que le champ JSON');
    includes(loginCookie.attrs, 'httponly', 'cookie HttpOnly (invisible du JS de la page)');
    includes(loginCookie.attrs, 'samesite=strict', 'SameSite=Strict');
    includes(loginCookie.attrs, 'path=/api/auth', 'Path restreint à /api/auth');
    includes(loginCookie.attrs, 'max-age=2592000', 'Max-Age 30 jours (aligné sur le TTL serveur)');
    ok(
      !loginCookie.attrs.includes('secure'),
      'http nu : PAS de Secure — l’accès LAN doit garder son cookie',
    );
  }
  // Deux sessions posées (inscription + login) : une ligne par appareil.
  eq(rowsFor(herveId).length, 2, 'register puis login = 2 lignes (2 appareils)');
  ok(
    rowsFor(herveId).every((r: any) => r.token_hash !== tokenA && r.token_hash.length === 64),
    'la base ne stocke QUE des hash SHA-256, jamais le brut',
  );

  // ---------- Rotation : /refresh consomme A et émet B ----------
  const rot = await refresh(tokenA);
  eq(rot.status, 200, 'refresh avec un jeton valide');
  const rotData = rot.data as AuthRes;
  // NB : le JWT peut être octet-identique à l'ancien (même payload, iat à la
  // seconde) — c'est le refresh token qui porte la rotation, pas lui.
  ok(typeof rotData.token === 'string' && rotData.token.length > 20, 'JWT émis');
  ok(!!rotData.refreshToken && rotData.refreshToken !== tokenA, 'refresh token neuf ≠ ancien');
  eq(rotData.user.username, 'rt-herve', 'réponse complète avec user');
  // Le JWT neuf authentifie.
  const me = await api(base, 'GET', '/api/auth/me', { token: rotData.token });
  eq(me.status, 200, 'le JWT fraîchement émis passe /me');

  const rowsA = rowsFor(herveId);
  const consumed = rowsA.find((r: any) => r.token_hash.length === 64 && r.revoked_at !== null);
  ok(!!consumed, 'la ligne présentée est révoquée (revoked_at posé)');
  const successorRow = rowsA.find((r: any) => r.revoked_at === null && r.rotated_from_id !== null);
  ok(!!successorRow, 'la ligne successeure existe, chaînée par rotated_from_id');
  if (consumed && successorRow) {
    eq(successorRow.rotated_from_id, consumed.id, 'rotated_from_id pointe la ligne consommée');
  }
  // Fenêtre glissante : expires_at ≈ now + 30 jours.
  const window = srv.query(
    `SELECT expires_at > datetime('now', '+29 days') AS ok1,
            expires_at < datetime('now', '+31 days') AS ok2
     FROM refresh_tokens WHERE revoked_at IS NULL AND user_id = ?`,
    herveId,
  ) as any;
  ok(window?.ok1 === 1 && window?.ok2 === 1, 'expires_at ~ now + 30 jours');

  // ---------- Réutilisation de A : 401 + family kill ----------
  const reuse = await refresh(tokenA);
  eq(reuse.status, 401, 'réutilisation du jeton consommé → 401');
  eq(rowsFor(herveId).length, 0, 'family kill : toutes les lignes de rt-herve supprimées');
  const deadSuccessor = await refresh(rotData.refreshToken);
  eq(deadSuccessor.status, 401, 'le successeur meurt avec la famille');

  // ---------- Entrées invalides ----------
  eq((await refresh('')).status, 400, 'corps sans jeton → 400');
  eq((await refresh('jeton-inconnu')).status, 401, 'jeton inconnu → 401');

  // ---------- Expiration : fenêtre 30 j dépassée ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-gael') });
  const gaelLogin = await login('rt-gael');
  const gaelId = (gaelLogin.data as AuthRes).user.id;
  const tokenG = (gaelLogin.data as AuthRes).refreshToken;
  eq(rowsFor(gaelId).length, 2, 'rt-gael : register + login = 2 lignes');
  srv.exec(
    "UPDATE refresh_tokens SET expires_at = datetime('now', '-1 day') WHERE user_id = ?",
    gaelId,
  );
  eq((await refresh(tokenG)).status, 401, 'jeton expiré → 401');
  const gaelRows = rowsFor(gaelId);
  eq(gaelRows.length, 2, 'expiré ≠ réutilisé : pas de family kill, lignes en place');
  ok(
    gaelRows.every((r: any) => r.revoked_at === null),
    "un jeton expiré n'est pas marqué révoqué",
  );

  // ---------- Logout : l'en-tête x-refresh-token révoque ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-ivo') });
  const ivoLogin = await login('rt-ivo');
  const ivoId = (ivoLogin.data as AuthRes).user.id;
  const tokenI = (ivoLogin.data as AuthRes).refreshToken;
  const logout = await api(base, 'POST', '/api/auth/logout', {
    headers: { 'x-refresh-token': tokenI },
  });
  eq(logout.status, 204, 'logout → 204');
  const ivoRows = rowsFor(ivoId);
  eq(ivoRows.length, 2, 'logout révoque (UPDATE), ne supprime pas');
  // Seule la ligne ciblée est révoquée : l'autre appareil vit toujours.
  eq(
    ivoRows.filter((r: any) => r.revoked_at === null).length,
    1,
    "l'autre session de rt-ivo survit au logout",
  );
  // Représenter le jeton révoqué au logout → 401 + family kill (même règle
  // que la réutilisation post-rotation : un jeton révoqué qui revient est un
  // signal de vol). Le client légitime purge au logout, il ne le représente
  // jamais — c'est le multi-onglet ou l'attaquant qui frappe ici.
  eq((await refresh(tokenI)).status, 401, 'le refresh token révoqué au logout → 401');
  eq(rowsFor(ivoId).length, 0, 'et la famille entière meurt avec lui');

  // ---------- Changement de mot de passe : tout meurt ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-jean') });
  const jeanLogin = await login('rt-jean');
  const jeanData = jeanLogin.data as AuthRes;
  ok(rowsFor(jeanData.user.id).length >= 1, 'rt-jean a des sessions posées');
  const pwd = await api(base, 'POST', '/api/auth/password', {
    token: jeanData.token,
    body: { currentPassword: 'password123', newPassword: 'nouveau-mot-de-passe-1' },
  });
  eq(pwd.status, 200, 'changement de mot de passe');
  eq((await refresh(jeanData.refreshToken)).status, 401, 'refresh après changement de mdp → 401');
  eq(rowsFor(jeanData.user.id).length, 0, 'toutes les sessions de rt-jean sont supprimées');

  // ---------- Secure conditionnel : X-Forwarded-Proto puis la socket ----------
  // Le serveur de test écoute en http nu — la détection doit y laisser le
  // cookie SANS Secure (l'accès LAN direct en http doit vivre) et le poser
  // dès qu'un proxy amont annonce https.
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-nour') });
  const nourLogin = await login('rt-nour');
  const nourCookie = cookieHeader(nourLogin);
  ok(!!nourCookie, 'login http nu → cookie posé');
  ok(
    !!nourCookie && !nourCookie.attrs.includes('secure'),
    'http nu : pas de Secure (LAN http garde son refresh)',
  );
  const nourHttps = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'rt-nour', password: 'password123' },
    headers: { 'x-forwarded-proto': 'https' },
  });
  const httpsCookie = cookieHeader(nourHttps);
  ok(
    !!httpsCookie && httpsCookie.attrs.includes('secure'),
    'X-Forwarded-Proto: https → Secure posé',
  );

  // ---------- Refresh par cookie SEUL (le chemin du navigateur) ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-marta') });
  const martaLogin = await login('rt-marta');
  const martaId = (martaLogin.data as AuthRes).user.id;
  const cookieA = cookieHeader(martaLogin)?.value ?? '';
  ok(!!cookieA, 'cookie de rt-marta capturé');
  // Cookie seul : ni en-tête, ni corps — exactement ce que le navigateur
  // envoie tout seul (le JS de la page ne voit même pas ce cookie).
  const byCookie = await api(base, 'POST', '/api/auth/refresh', {
    headers: { cookie: `ts_refresh=${cookieA}` },
  });
  eq(byCookie.status, 200, 'refresh par cookie seul');
  const byCookieData = byCookie.data as AuthRes;
  ok(!!byCookieData.refreshToken && byCookieData.refreshToken !== cookieA, 'rotation intégrale');
  const rotatedCookie = cookieHeader(byCookie);
  ok(
    !!rotatedCookie && rotatedCookie.value === byCookieData.refreshToken,
    'le refresh RE-POSE le cookie du successeur',
  );
  // Réutilisation du cookie consommé (replay d'une capture volée) → 401 +
  // family kill, et la miette morte est effacée du navigateur.
  const replay = await api(base, 'POST', '/api/auth/refresh', {
    headers: { cookie: `ts_refresh=${cookieA}` },
  });
  eq(replay.status, 401, 'réutilisation du cookie consommé → 401');
  eq(rowsFor(martaId).length, 0, 'family kill déclenché depuis le cookie');
  const clearedReplay = cookieHeader(replay);
  ok(
    !!clearedReplay &&
      clearedReplay.value === '' &&
      clearedReplay.attrs.includes('max-age=0') &&
      clearedReplay.attrs.includes('path=/api/auth'),
    'le 401 efface la miette (Max-Age=0, même Path)',
  );

  // ---------- Transition : l'en-tête x-refresh-token (clients pré-cookie) ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-omar') });
  const omarLogin = await login('rt-omar');
  const omarToken = (omarLogin.data as AuthRes).refreshToken;
  eq(
    (
      await api(base, 'POST', '/api/auth/refresh', {
        headers: { 'x-refresh-token': omarToken },
      })
    ).status,
    200,
    'transition : refresh par en-tête x-refresh-token seul',
  );

  // ---------- Logout par cookie : révocation + effacement ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-paolo') });
  const paoloLogin = await login('rt-paolo');
  const paoloId = (paoloLogin.data as AuthRes).user.id;
  const paoloCookie = cookieHeader(paoloLogin)?.value ?? '';
  const paoloLogout = await api(base, 'POST', '/api/auth/logout', {
    headers: { cookie: `ts_refresh=${paoloCookie}` },
  });
  eq(paoloLogout.status, 204, 'logout par cookie → 204');
  const clearedLogout = cookieHeader(paoloLogout);
  ok(
    !!clearedLogout &&
      clearedLogout.value === '' &&
      clearedLogout.attrs.includes('max-age=0') &&
      clearedLogout.attrs.includes('path=/api/auth'),
    'logout efface le cookie (Max-Age=0, même Path)',
  );
  const paoloRows = rowsFor(paoloId);
  eq(paoloRows.length, 2, 'logout par cookie : 2 lignes en place (UPDATE, pas DELETE)');
  eq(
    paoloRows.filter((r: any) => r.revoked_at === null).length,
    1,
    "seule la ligne du cookie est révoquée — l'autre appareil survit",
  );
  eq(
    (
      await api(base, 'POST', '/api/auth/refresh', {
        headers: { 'x-refresh-token': paoloCookie },
      })
    ).status,
    401,
    'le jeton révoqué au logout par cookie → 401',
  );
}
