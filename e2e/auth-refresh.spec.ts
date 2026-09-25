/**
 * Session par cookies — plus AUCUN matériau d'auth en localStorage.
 *
 * Le login par l'UI pose deux cookies HttpOnly (ts_access : JWT 24 h,
 * Path=/api ; ts_refresh : preuve de renouvellement 30 j, Path=/api/auth).
 * Un rechargement restaure la session par les cookies seuls (boot : échange
 * GET /api/auth/token, sans rotation). Un cookie ts_access PÉRIMÉ (écrasé
 * par un JWT expiré signé du secret de la stack e2e) se rattrape par le
 * refresh transparent (intercepteur 401). La déconnexion efface les deux
 * cookies et révoque la ligne. La WebSocket « Synchronisé » survit au
 * rechargement (JWT mémoire obtenu par l'échange).
 *
 * Utilisateurs dédiés créés au runtime : les specs partagent une seule base.
 */
import { createHmac } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { API_BASE, WEB_BASE } from './env';

const JWT_SECRET = 'e2e-test-secret';

/** JWT HS256 périmé d'une semaine, structure identique à ceux de l'API. */
function expiredJwt(userId: number, username: string): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, username, iat: now - 8 * 86400, exp: now - 7 * 86400 });
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Présente un refresh token par cookie (le chemin du navigateur). PAS de
 *  content-type sans corps : Fastify rejette un corps vide annoncé JSON
 *  (FST_ERR_CTP_EMPTY_JSON_BODY, cf. global-setup.ts) — le 400 masquerait
 *  le verdict réel de la route. */
async function directRefresh(refreshToken: string): Promise<number> {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `ts_refresh=${refreshToken}` },
    signal: AbortSignal.timeout(5000),
  });
  // Drainer le corps pour libérer la connexion.
  await res.text().catch(() => {});
  return res.status;
}

async function registerUser(username: string): Promise<{
  token: string;
  user: { id: number; username: string };
}> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'e2e-refresh-1',
      displayName: 'Rafraîchie',
      email: `${username}@e2e.table-sync`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  expect(res.ok, `inscription ${username}`).toBeTruthy();
  const body = (await res.json()) as { token: string; user: { id: number; username: string } };
  expect(body.token, 'le corps porte le JWT (les tests REST n’ont pas de cookie jar)').toBeTruthy();
  return body;
}

/** Un cookie vu par le navigateur (HttpOnly ne gêne pas Playwright). */
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

test.describe('session par cookies', () => {
  test('login : aucun jeton en localStorage, session restaurée au reload, WS synchronisé', async ({
    page,
  }) => {
    const username = `rt-cookie-${Date.now()}`;
    const auth = await registerUser(username);

    // Pas de visite guidée : elle masquerait la page.
    await page.addInitScript(() => {
      localStorage.setItem('dnd-inv-tour-seen', '1');
    });

    // — Login par l'UI : le serveur pose le COUPLE de cookies —
    await page.goto('/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', 'e2e-refresh-1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();

    // — localStorage SANS AUCUN jeton : seule l'UI non-secrète est cachée —
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-token'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-refresh'))).toBeNull();

    const access = await browserCookie(page, 'ts_access');
    expect(access, 'cookie ts_access posé au login').toBeTruthy();
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe('Strict');
    expect(access?.path).toBe('/api');
    // Fenêtre 24 h (expires en secondes epoch), alignée sur le JWT.
    expect(access?.expires).toBeGreaterThan(Date.now() / 1000 + 23 * 3600);
    const refresh = await browserCookie(page, 'ts_refresh');
    expect(refresh, 'cookie ts_refresh posé au login').toBeTruthy();
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe('/api/auth');
    // Fenêtre 30 j glissante.
    expect(refresh?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
    // Le login par l'UI a posé une NOUVELLE ligne, distincte du register.
    expect(refresh?.value).not.toBe('');
    const cookieAtLogin = refresh?.value as string;
    expect(cookieAtLogin).not.toBe(auth.token);

    // — La WebSocket s'est connectée (JWT mémoire du login) —
    await page.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

    // — Rechargement : session rétablie par les cookies SEULS, pas de
    //   /login — le boot échange ts_access contre un JWT mémoire (aucune
    //   rotation : le cookie ts_refresh d'origine est intact) —
    await page.reload();
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-token'))).toBeNull();
    // Toujours PAS de rotation : le refresh cookie survit au rechargement.
    expect(await browserCookie(page, 'ts_refresh')?.then((c) => c?.value)).toBe(cookieAtLogin);
    // WS re-synchronisée après le reload (échange /token au boot).
    await page.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

    // — Déconnexion : le serveur efface les cookies et révoque la ligne —
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      await browserCookie(page, 'ts_access'),
      'cookie d’accès effacé au logout',
    ).toBeUndefined();
    expect(
      await browserCookie(page, 'ts_refresh'),
      'cookie de refresh effacé au logout',
    ).toBeUndefined();
    // La ligne révoquée ne re-connecte personne (requête directe, hors page).
    expect(await directRefresh(cookieAtLogin)).toBe(401);
    // Rechargement : plus rien en session, on reste sur la connexion.
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-user'))).toBeNull();
  });

  test('cookie ts_access périmé : refresh transparent, session sauvée sans /login', async ({
    page,
  }) => {
    const username = `rt-stale-${Date.now()}`;
    const auth = await registerUser(username);

    await page.addInitScript(() => {
      localStorage.setItem('dnd-inv-tour-seen', '1');
    });
    await page.goto('/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', 'e2e-refresh-1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();
    const refreshAtLogin = (await browserCookie(page, 'ts_refresh'))?.value as string;

    // — Le cookie d'accès vieillit mal (JWT périmé d'une semaine, signé du
    //   secret de la stack) : appareil revenu après > 24 h —
    const stale = expiredJwt(auth.user.id, auth.user.username);
    await overwriteAccessCookie(page, stale);

    // — Rechargement : le boot échoue son échange, l'intercepteur 401
    //   rafraîchit par ts_refresh PUIS REJOUE — la session survit, PAS de
    //   redirection /login —
    await page.reload();
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();

    // La rotation serveur a REPLACÉ les deux cookies : le JWT neuf n'est plus
    // le périmé, et le refresh token a tourné.
    const accessAfter = await browserCookie(page, 'ts_access');
    expect(accessAfter?.value).toBeTruthy();
    expect(accessAfter?.value).not.toBe(stale);
    const refreshAfter = (await browserCookie(page, 'ts_refresh'))?.value as string;
    expect(refreshAfter).not.toBe(refreshAtLogin);

    // La WebSocket finit synchronisée elle aussi.
    await page.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

    // — L'ANCIEN refresh token est mort : le représenter → 401 + family
    //   kill (requête directe, hors page — un attaquant qui garde une copie) —
    expect(await directRefresh(refreshAtLogin)).toBe(401);
    // … et le successeur (le cookie posé par le refresh) ne re-connecte plus
    // personne après family kill.
    expect(await directRefresh(refreshAfter)).toBe(401);
  });
});
