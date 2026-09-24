/**
 * Jetons de rafraîchissement (sessions 30 jours glissants) : émission à
 * l'inscription/login, rotation intégrale à chaque /refresh (le jeton
 * présenté meurt, le successeur hérite de la fenêtre), family kill à la
 * réutilisation d'un jeton consommé, expiration, révocation au logout et au
 * changement de mot de passe. /api/auth/refresh est PUBLIC (pas de JWT — le
 * refresh token EST la preuve, tous les appels ci-dessous partent sans
 * en-tête Authorization).
 */
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

interface AuthRes {
  token: string;
  refreshToken: string;
  user: { id: number; username: string };
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

  const loginRes = await login('rt-herve');
  eq(loginRes.status, 200, 'login rt-herve');
  const herveId = (loginRes.data as AuthRes).user.id;
  const tokenA = (loginRes.data as AuthRes).refreshToken;
  ok(!!tokenA, 'login renvoie un refreshToken');
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
}
