/**
 * Session par cookies — jetons de rafraîchissement (rotation 30 jours
 * glissants, family kill à la réutilisation) + cookie d'accès `ts_access`
 * (le JWT lui-même, 24 h, Path=/api). Plus AUCUN matériau d'auth dans le
 * corps au-delà du JWT lisible ({token, user}).
 *
 * /api/auth/refresh est PUBLIC (allowlist du guard : le refresh token EST la
 * preuve) et n'accepte PLUS que le cookie HttpOnly ts_refresh — l'en-tête
 * x-refresh-token et le corps JSON de transition PR #127 n'ont jamais été
 * déployés, le chemin est supprimé. GET /api/auth/token vit SOUS le garde
 * global : la preuve est le cookie ts_access ou l'en-tête Authorization
 * (scripts/tests sans cookie jar).
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
  user: { id: number; username: string };
}

/** Un Set-Cookie vu dans la réponse : valeur brute + attributs bas de casse. */
interface SeenCookie {
  value: string;
  attrs: string[];
}

/** Tous les Set-Cookie d'une réponse, indexés par nom. */
function setCookies(res: ApiResponse): Map<string, SeenCookie> {
  const all = ((res.headers as any).getSetCookie?.() ?? []) as string[];
  const map = new Map<string, SeenCookie>();
  for (const raw of all) {
    const [pair, ...attrs] = raw.split(';');
    const eqPos = pair.indexOf('=');
    map.set(pair.slice(0, eqPos).trim(), {
      value: pair.slice(eqPos + 1),
      attrs: attrs.map((a) => a.trim().toLowerCase()),
    });
  }
  return map;
}

/** Payload décodé d'un JWT (vérification non requise ici : on lit exp/iat). */
function jwtPayload(token: string): any {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
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
    api(base, 'POST', '/api/auth/refresh', {
      headers: { cookie: `ts_refresh=${refreshToken}` },
    });
  const login = (username: string, password = 'password123') =>
    api(base, 'POST', '/api/auth/login', { body: { username, password } });
  const rowsFor = (userId: number) =>
    srv.queryAll('SELECT * FROM refresh_tokens WHERE user_id = ?', userId);

  // ---------- Émission : register et login posent le COUPLE de cookies ----------
  const reg = await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-herve') });
  eq(reg.status, 201, 'register rt-herve');
  const regData = reg.data as AuthRes;
  ok(!('refreshToken' in (reg.data as object)), 'le corps ne porte PLUS de refreshToken');
  ok(typeof regData.token === 'string' && regData.token.length > 20, 'JWT émis au corps');
  const regCookies = setCookies(reg);
  const regAccess = regCookies.get('ts_access');
  const regRefresh = regCookies.get('ts_refresh');
  ok(!!regAccess, 'register pose un Set-Cookie ts_access');
  ok(!!regRefresh, 'register pose un Set-Cookie ts_refresh');
  if (regAccess) {
    eq(regAccess.value, regData.token, 'ts_access porte le MÊME JWT que le corps');
    includes(regAccess.attrs, 'httponly', 'ts_access HttpOnly (invisible du JS de la page)');
    includes(regAccess.attrs, 'samesite=strict', 'ts_access SameSite=Strict');
    includes(regAccess.attrs, 'path=/api', 'ts_access Path=/api (TOUTES les routes API)');
    includes(regAccess.attrs, 'max-age=86400', 'ts_access Max-Age 24 h (aligné sur le JWT)');
    // TTL signé : exp − iat = 24 h pile (la fenêtre de vol du JWT).
    const payload = jwtPayload(regData.token);
    eq(payload.exp - payload.iat, 86_400, 'JWT signé pour 24 h exactement');
  }
  if (regRefresh) {
    includes(regRefresh.attrs, 'httponly', 'ts_refresh HttpOnly');
    includes(regRefresh.attrs, 'samesite=strict', 'ts_refresh SameSite=Strict');
    includes(regRefresh.attrs, 'path=/api/auth', 'ts_refresh Path restreint à /api/auth');
    includes(
      regRefresh.attrs,
      'max-age=2592000',
      'ts_refresh Max-Age 30 jours (aligné sur le TTL serveur)',
    );
    ok(regRefresh.value.length >= 64, 'le refresh token brut fait ≥ 64 caractères');
  }

  const loginRes = await login('rt-herve');
  eq(loginRes.status, 200, 'login rt-herve');
  const herveId = (loginRes.data as AuthRes).user.id;
  const loginJwt = (loginRes.data as AuthRes).token;
  const tokenA = setCookies(loginRes).get('ts_refresh')?.value ?? '';
  ok(!!tokenA, 'login pose un Set-Cookie ts_refresh');
  // Deux sessions posées (inscription + login) : une ligne par appareil.
  eq(rowsFor(herveId).length, 2, 'register puis login = 2 lignes (2 appareils)');
  ok(
    rowsFor(herveId).every((r: any) => r.token_hash !== tokenA && r.token_hash.length === 64),
    'la base ne stocke QUE des hash SHA-256, jamais le brut',
  );

  // ---------- Bascule cookie : une route métier s'authentifie par ts_access ----------
  const meByCookie = await api(base, 'GET', '/api/auth/me', {
    headers: { cookie: `ts_access=${loginJwt}` },
  });
  eq(meByCookie.status, 200, 'GET /me authentifié par le cookie ts_access SEUL');
  // En-tête PÉRIMÉ + cookie valide : le garde bascule sur le cookie.
  const meStaleHeader = await api(base, 'GET', '/api/auth/me', {
    headers: { authorization: 'Bearer jeton.périmé.forgé', cookie: `ts_access=${loginJwt}` },
  });
  eq(meStaleHeader.status, 200, 'en-tête invalide + cookie valide → le cookie tranche');

  // ---------- GET /api/auth/token : l'échange contrôlé JWT ↔ cookie ----------
  const tokenRoute = await api(base, 'GET', '/api/auth/token', { token: loginJwt });
  eq(tokenRoute.status, 200, 'GET /api/auth/token par en-tête Authorization');
  eq((tokenRoute.data as any).token, loginJwt, 'écho : le MÊME jeton que la preuve');
  const tokenByCookie = await api(base, 'GET', '/api/auth/token', {
    headers: { cookie: `ts_access=${loginJwt}` },
  });
  eq(tokenByCookie.status, 200, 'GET /api/auth/token par cookie ts_access');
  eq((tokenByCookie.data as any).token, loginJwt, 'écho du cookie');
  eq(
    (await api(base, 'GET', '/api/auth/token')).status,
    401,
    'GET /api/auth/token sans preuve → 401 (sous le garde global)',
  );

  // ---------- Rotation : /refresh consomme A et émet B ----------
  const rot = await refresh(tokenA);
  eq(rot.status, 200, 'refresh avec un cookie valide');
  const rotData = rot.data as AuthRes;
  ok(!('refreshToken' in (rot.data as object)), 'le refresh ne renvoie PAS de refreshToken');
  ok(typeof rotData.token === 'string' && rotData.token.length > 20, 'JWT émis');
  eq(rotData.user.username, 'rt-herve', 'réponse complète avec user');
  const rotCookies = setCookies(rot);
  const rotAccess = rotCookies.get('ts_access');
  const rotRefresh = rotCookies.get('ts_refresh');
  ok(!!rotAccess && rotAccess.value === rotData.token, 'le refresh RE-POSE ts_access (JWT neuf)');
  ok(
    !!rotRefresh && rotRefresh.value !== tokenA && rotRefresh.value.length >= 64,
    'le refresh RE-POSE ts_refresh (rotation intégrale)',
  );
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
  eq(reuse.status, 401, 'réutilisation du cookie consommé → 401');
  eq(rowsFor(herveId).length, 0, 'family kill : toutes les lignes de rt-herve supprimées');
  const deadSuccessor = await refresh(rotRefresh?.value ?? '');
  eq(deadSuccessor.status, 401, 'le successeur meurt avec la famille');
  // Le 401 efface les deux miettes du navigateur.
  const clearedReuse = setCookies(reuse);
  for (const [name, path] of [
    ['ts_refresh', '/api/auth'],
    ['ts_access', '/api'],
  ] as const) {
    const crumb = clearedReuse.get(name);
    ok(
      !!crumb &&
        crumb.value === '' &&
        crumb.attrs.includes('max-age=0') &&
        crumb.attrs.includes(`path=${path}`),
      `le 401 efface la miette ${name} (Max-Age=0, même Path)`,
    );
  }

  // ---------- Entrées invalides : cookie SEUL, la transition est morte ----------
  eq((await api(base, 'POST', '/api/auth/refresh')).status, 400, 'aucune preuve → 400');
  eq(
    (
      await api(base, 'POST', '/api/auth/refresh', {
        headers: { 'x-refresh-token': tokenA },
      })
    ).status,
    400,
    'en-tête x-refresh-token seul → 400 (transition supprimée)',
  );
  eq(
    (
      await api(base, 'POST', '/api/auth/refresh', {
        body: { refreshToken: tokenA },
      })
    ).status,
    400,
    'corps JSON refreshToken seul → 400 (transition supprimée)',
  );
  eq((await refresh('jeton-inconnu')).status, 401, 'cookie inconnu → 401');

  // ---------- Expiration : fenêtre 30 j dépassée ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-gael') });
  const gaelLogin = await login('rt-gael');
  const gaelId = (gaelLogin.data as AuthRes).user.id;
  const tokenG = setCookies(gaelLogin).get('ts_refresh')?.value ?? '';
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

  // ---------- Logout par cookie : révocation + effacement des DEUX miettes ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-ivo') });
  const ivoLogin = await login('rt-ivo');
  const ivoId = (ivoLogin.data as AuthRes).user.id;
  const tokenI = setCookies(ivoLogin).get('ts_refresh')?.value ?? '';
  const ivoAccess = setCookies(ivoLogin).get('ts_access')?.value ?? '';
  const logout = await api(base, 'POST', '/api/auth/logout', {
    headers: { cookie: `ts_refresh=${tokenI}` },
  });
  eq(logout.status, 204, 'logout par cookie → 204');
  const clearedLogout = setCookies(logout);
  for (const [name, path] of [
    ['ts_refresh', '/api/auth'],
    ['ts_access', '/api'],
  ] as const) {
    const crumb = clearedLogout.get(name);
    ok(
      !!crumb &&
        crumb.value === '' &&
        crumb.attrs.includes('max-age=0') &&
        crumb.attrs.includes(`path=${path}`),
      `logout efface ${name} (Max-Age=0, même Path)`,
    );
  }
  // L'accès survit au logout jusqu'à expiration (stateless, 24 h) : la
  // miette est effacée du NAVIGATEUR, c'est le cookie qui portait la preuve.
  const ivoRows = rowsFor(ivoId);
  eq(ivoRows.length, 2, 'logout révoque (UPDATE), ne supprime pas');
  eq(
    ivoRows.filter((r: any) => r.revoked_at === null).length,
    1,
    "l'autre session de rt-ivo survit au logout",
  );
  // Représenter le refresh token révoqué au logout → 401 + family kill (même
  // règle que la réutilisation post-rotation : un jeton révoqué qui revient
  // est un signal de vol). Le client légitime purge au logout, il ne le
  // représente jamais — c'est le multi-onglet ou l'attaquant qui frappe ici.
  eq((await refresh(tokenI)).status, 401, 'le refresh token révoqué au logout → 401');
  eq(rowsFor(ivoId).length, 0, 'et la famille entière meurt avec lui');
  // Le cookie d'accès du logout reste un JWT VALIDE jusqu'à expiration
  // (stateless) : c'est la règle documentée — la fenêtre de vol est de 24 h
  // maximum, plus 7 jours.
  eq(
    (await api(base, 'GET', '/api/auth/me', { token: ivoAccess })).status,
    200,
    'le JWT reste stateless jusqu’à expiration (24 h max)',
  );

  // ---------- Changement de mot de passe : tout meurt ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-jean') });
  const jeanLogin = await login('rt-jean');
  const jeanData = jeanLogin.data as AuthRes;
  const jeanRefresh = setCookies(jeanLogin).get('ts_refresh')?.value ?? '';
  ok(rowsFor(jeanData.user.id).length >= 1, 'rt-jean a des sessions posées');
  const pwd = await api(base, 'POST', '/api/auth/password', {
    token: jeanData.token,
    body: { currentPassword: 'password123', newPassword: 'nouveau-mot-de-passe-1' },
  });
  eq(pwd.status, 200, 'changement de mot de passe');
  eq((await refresh(jeanRefresh)).status, 401, 'refresh après changement de mdp → 401');
  eq(rowsFor(jeanData.user.id).length, 0, 'toutes les sessions de rt-jean sont supprimées');

  // ---------- Secure conditionnel : X-Forwarded-Proto puis la socket ----------
  // Le serveur de test écoute en http nu — la détection doit y laisser les
  // cookies SANS Secure (l'accès LAN direct en http doit vivre) et les poser
  // dès qu'un proxy amont annonce https.
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-nour') });
  const nourLogin = await login('rt-nour');
  const nourCookies = setCookies(nourLogin);
  ok(!!nourCookies.get('ts_access') && !!nourCookies.get('ts_refresh'), 'login http nu → cookies');
  ok(
    !!nourCookies.get('ts_access') &&
      !nourCookies.get('ts_access')!.attrs.includes('secure') &&
      !nourCookies.get('ts_refresh')!.attrs.includes('secure'),
    'http nu : pas de Secure (LAN http garde sa session)',
  );
  const nourHttps = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'rt-nour', password: 'password123' },
    headers: { 'x-forwarded-proto': 'https' },
  });
  const httpsCookies = setCookies(nourHttps);
  ok(
    !!httpsCookies.get('ts_access') && httpsCookies.get('ts_access')!.attrs.includes('secure'),
    'X-Forwarded-Proto: https → Secure posé sur ts_access',
  );
  ok(
    !!httpsCookies.get('ts_refresh') && httpsCookies.get('ts_refresh')!.attrs.includes('secure'),
    'X-Forwarded-Proto: https → Secure posé sur ts_refresh',
  );

  // ---------- Refresh par cookie SEUL, dernier tour : rotation + échos ----------
  await api(base, 'POST', '/api/auth/register', { body: registerBody('rt-marta') });
  const martaLogin = await login('rt-marta');
  const martaId = (martaLogin.data as AuthRes).user.id;
  const cookieA = setCookies(martaLogin).get('ts_refresh')?.value ?? '';
  ok(!!cookieA, 'cookie de rt-marta capturé');
  // Cookie seul : ni en-tête, ni corps — exactement ce que le navigateur
  // envoie tout seul (le JS de la page ne voit même pas ce cookie).
  const byCookie = await api(base, 'POST', '/api/auth/refresh', {
    headers: { cookie: `ts_refresh=${cookieA}` },
  });
  eq(byCookie.status, 200, 'refresh par cookie seul');
  const byCookieData = byCookie.data as AuthRes;
  const martaRotated = setCookies(byCookie).get('ts_refresh')?.value ?? '';
  ok(!!martaRotated && martaRotated !== cookieA, 'rotation intégrale');
  eq(
    setCookies(byCookie).get('ts_access')?.value ?? '',
    byCookieData.token,
    'le couple est RE-POSÉ ensemble (ts_access = JWT du corps)',
  );
  // Réutilisation du cookie consommé (replay d'une capture volée) → 401 +
  // family kill, et les miettes mortes sont effacées du navigateur.
  const replay = await api(base, 'POST', '/api/auth/refresh', {
    headers: { cookie: `ts_refresh=${cookieA}` },
  });
  eq(replay.status, 401, 'réutilisation du cookie consommé → 401');
  eq(rowsFor(martaId).length, 0, 'family kill déclenché depuis le cookie');
}
