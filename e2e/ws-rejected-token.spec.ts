/**
 * WS refusée pour jeton refusé (4001) → la boucle de reconnexion ne doit pas
 * représenter indéfiniment le même JWT mémoire.
 *
 * Scénario du rapport tablette (2026-10) : le serveur refuse la poignée de
 * main WS avec close(4001, 'Invalid token') — jeton dont la signature n'est
 * plus acceptée alors que son `exp` local n'est pas passé (secret tourné, DB
 * restaurée, horloge décalée). L'ancien client jugeait le jeton « utilisable »
 * sur son seul `exp` et le représentait à chaque backoff : « Synchronisé »
 * ne revenait jamais, même après déconnexion/reconnexion dans l'app — seul
 * un vidage de cache/reload vidait la mémoire. Le correctif : onclose code
 * 4001 jette le JWT mémoire ; la reconnexion suivante force l'échange
 * GET /api/auth/token, qui obtient un jeton que le serveur accepte.
 *
 * Méthode : on ne peut pas fabriquer un « jeton refusé » via l'API réelle
 * (tout jeton signé du secret courant est accepté, et l'échange /token
 * renvoie exactement le jeton vérifié). Le mock routeWebSocket PROXIE donc
 * tout vers le vrai serveur, sauf l'incident simulé : le test ferme la
 * connexion vivante avec le code 4001 (ce que le serveur réel fait sur un
 * jeton refusé), puis le mock REFUSE toute reconnexion tant qu'aucun
 * échange GET /api/auth/token n'a suivi le refus.
 *  • AVANT le correctif : le client représente le même JWT (exp intact) →
 *    refus en boucle → « Synchronisé » ne revient jamais → timeout ROUGE.
 *  • APRÈS : le client jette le jeton → échange → reconnexion acceptée →
 *    « Synchronisé » revient SANS reload.
 */
import { createHmac } from 'node:crypto';
import { expect, test, type WebSocketRoute } from 'playwright/test';
import { WEB_BASE } from './env';

/** Secret JWT de la stack e2e (cf. playwright.config.ts / global-setup). */
const JWT_SECRET = 'e2e-test-secret';

/** JWT HS256 périmé d'une semaine — structure identique à ceux de l'API. */
function expiredJwt(userId: number, username: string): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, username, iat: now - 8 * 86400, exp: now - 7 * 86400 });
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Cookie vu par le navigateur (HttpOnly ne gêne pas Playwright). */
async function browserCookie(page: { context(): { cookies(): Promise<any[]> } }, name: string) {
  return (await page.context().cookies()).find((c: any) => c.name === name);
}

/** Écrase le cookie ts_access du contexte par `value` (même Path=/api). */
async function overwriteAccessCookie(page: any, value: string) {
  await page.context().clearCookies({ name: 'ts_access' });
  await page.context().addCookies([
    {
      name: 'ts_access',
      value,
      domain: new URL(WEB_BASE).hostname,
      path: '/api',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

test('WS close 4001 : le JWT rejeté est jeté et la sync revient sans reload', async ({ page }) => {
  const username = `ws-reject-${Date.now()}`;
  const password = 'e2e-refresh-1';

  // Inscription directe (le login UI posera cookies + JWT mémoire).
  const reg = await fetch(`${WEB_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      displayName: 'Rejet WS',
      email: `${username}@e2e.table-sync`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  expect(reg.ok, 'inscription').toBeTruthy();
  await reg.json();

  // — État du mock : incident déclenché ? échangé depuis ? compteur d'échanges —
  let killed = false;
  let exchangesSinceKill = 0;
  let liveWs: WebSocketRoute | null = null;

  // L'échange JWT ↔ cookie compte (et passe au vrai serveur).
  await page.route('**/api/auth/token', async (route) => {
    if (killed) exchangesSinceKill++;
    await route.continue();
  });

  // Proxy WS permanent ; après l'incident, refus 4001 tant que le client
  // n'a pas échangé son jeton (comportement d'un serveur qui refuse la
  // signature présentée mais accepterait un jeton neuvement prouvé).
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (killed && exchangesSinceKill === 0) {
      ws.close({ code: 4001, reason: 'Invalid token' });
      return;
    }
    liveWs = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
  });

  await page.addInitScript(() => {
    localStorage.setItem('dnd-inv-tour-seen', '1');
  });
  await page.goto('/login');
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/parties$/);

  // — Synchronisé : le WS du login est vivant (JWT mémoire légitime) —
  await page.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

  // — L'incident : le serveur (mocké) ferme la connexion pour jeton refusé —
  killed = true;
  liveWs?.close({ code: 4001, reason: 'Invalid token' });

  // — LE test : la synchronie revient SANS reload, via un échange de jeton
  //    APRÈS le refus. Avant le correctif : re-présentation du même jeton →
  //    refus en boucle → timeout rouge ici —
  await page.getByLabel('Synchronisé').first().waitFor({ timeout: 20_000 });
  expect(
    exchangesSinceKill,
    'un échange GET /api/auth/token a suivi le refus',
  ).toBeGreaterThanOrEqual(1);
  expect(page.url(), 'aucun reload ni redirection').toContain('/parties');
});

test('WS close 4001 + cookie ts_access périmé : le refresh token sauve la session, PAS de déconnexion', async ({
  page,
}) => {
  const username = `ws-refresh-${Date.now()}`;
  const password = 'e2e-refresh-1';

  const reg = await fetch(`${WEB_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      displayName: 'Rejet WS Refresh',
      email: `${username}@e2e.table-sync`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  expect(reg.ok, 'inscription').toBeTruthy();
  const { user } = (await reg.json()) as { token: string; user: { id: number; username: string } };

  // — Mock WS : proxy ; après l'incident, refus 4001 tant que le client n'a
  //    pas échangé de jeton (comme un serveur qui refuse la signature
  //    présentée mais accepterait un jeton neuvement prouvé) —
  let killed = false;
  let exchangesSinceKill = 0;
  let liveWs: WebSocketRoute | null = null;
  await page.route('**/api/auth/token', async (route) => {
    if (killed) exchangesSinceKill++;
    await route.continue();
  });
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (killed && exchangesSinceKill === 0) {
      ws.close({ code: 4001, reason: 'Invalid token' });
      return;
    }
    liveWs = ws;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
  });

  await page.addInitScript(() => {
    localStorage.setItem('dnd-inv-tour-seen', '1');
  });
  await page.goto('/login');
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/parties$/);
  await page.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

  const refreshAtLogin = (await browserCookie(page, 'ts_refresh'))?.value as string;
  expect(refreshAtLogin).toBeTruthy();

  // — L'appareil revient « d'ailleurs » : son cookie ts_access a expiré
  //    depuis une semaine. Le refresh token (30 j) est TOUJOURS bon —
  //    c'est LUI qui doit reprendre, pas une déconnexion —
  await overwriteAccessCookie(page, expiredJwt(user.id, user.username));

  // — L'incident WS : le serveur refuse le jeton mémoire (4001) —
  killed = true;
  liveWs?.close({ code: 4001, reason: 'Invalid token' });

  // — LE contrat : « Synchronisé » revient SANS reload ET SANS /login.
  //    Chemin attendu : 4001 → jeton jeté → échange /token → 401 (cookie
  //    périmé) → intercepteur → refreshSession() (rotation ts_refresh) →
  //    cookies neufs → échange rejoué → JWT neuf → WS acceptée —
  await page.getByLabel('Synchronisé').first().waitFor({ timeout: 20_000 });
  expect(page.url(), 'l’utilisateur reste sur l’app, pas de /login').toContain('/parties');
  expect(exchangesSinceKill, 'l’échange a bien eu lieu après le refus').toBeGreaterThanOrEqual(1);

  // La session a été sauvée par le REFRESH : le cookie a tourné (rotation
  // intégrale) et ts_access porte un JWT différent du périmé injecté.
  const refreshAfter = (await browserCookie(page, 'ts_refresh'))?.value as string;
  expect(refreshAfter, 'le refresh token a tourné (rotation serveur)').not.toBe(refreshAtLogin);
  const accessAfter = (await browserCookie(page, 'ts_access'))?.value as string;
  expect(accessAfter, 'ts_access porte un JWT neuf').toBeTruthy();
});
