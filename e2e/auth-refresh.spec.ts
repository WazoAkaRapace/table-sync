/**
 * Jetons de rafraîchissement — docs/plan-refresh-cookie.md (cookie HttpOnly)
 * et docs/plan-refresh-tokens.md (rotation/family kill).
 *
 * Deux scénarios :
 * 1. Migration : une session de l'ère localStorage (PR #127) survit à un JWT
 *    périmé via l'en-tête x-refresh-token UNE fois, puis la clé disparaît et
 *    le cookie ts_refresh prend le relais.
 * 2. Régime cookie : le login par l'UI pose ts_refresh (HttpOnly,
 *    SameSite=Strict, Path=/api/auth), un JWT périmé se rattrape par le
 *    cookie SEUL (le JS ne le voit même pas), la déconnexion l'efface et
 *    révoque ce qu'il reste.
 *
 * Utilisateurs dédiés créés au runtime : les specs partagent une seule base.
 * Le JWT expiré est signé avec le secret connu de la stack e2e
 * (playwright.config.ts, webServer env JWT_SECRET).
 */
import { createHmac } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { API_BASE } from './env';

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

async function directRefresh(refreshToken: string): Promise<number> {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    signal: AbortSignal.timeout(5000),
  });
  // Drainer le corps pour libérer la connexion.
  await res.text().catch(() => {});
  return res.status;
}

async function registerUser(username: string): Promise<{
  token: string;
  refreshToken: string;
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
  return (await res.json()) as {
    token: string;
    refreshToken: string;
    user: { id: number; username: string };
  };
}

/** Le cookie ts_refresh vu par le navigateur (HttpOnly ne gêne pas Playwright). */
async function refreshCookie(page: { context(): { cookies(): Promise<any[]> } }) {
  return (await page.context().cookies()).find((c: any) => c.name === 'ts_refresh');
}

test.describe('jetons de rafraîchissement', () => {
  test('JWT expiré + refresh token valide : session sauvée sans /login', async ({ page }) => {
    // — Utilisateur dédié (la base est partagée entre specs, on ne touche
    //   rien de seedé) : inscription, couple complet en retour —
    const username = `rt-e2e-${Date.now()}`;
    const auth = await registerUser(username);
    expect(auth.refreshToken).toBeTruthy();

    // — Session locale : un JWT PÉRIMÉ + le refresh token localStorage
    //   (héritage PR #127) — un appareil d'avant le cookie qui revient
    //   d'une semaine d'absence. Pas de cookie dans ce contexte. —
    await page.addInitScript(
      ({ token, user, refresh }) => {
        localStorage.setItem('dnd-inv-token', token);
        localStorage.setItem('dnd-inv-refresh', refresh);
        localStorage.setItem('dnd-inv-user', JSON.stringify(user));
        // Pas de visite guidée : elle masquerait la page.
        localStorage.setItem('dnd-inv-tour-seen', '1');
      },
      {
        token: expiredJwt(auth.user.id, auth.user.username),
        user: auth.user,
        refresh: auth.refreshToken,
      },
    );

    // — La session survit : PAS de redirection /login, contenu authentifié —
    await page.goto('/parties');
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible();
    // La WebSocket s'est connectée avec le jeton rafraîchi (le chemin de
    // reconnexion rafraîchit d'abord un JWT expiré).
    await page.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

    // — Migration one-shot : la clé localStorage a servi UNE fois en
    //   en-tête, puis elle disparaît — le cookie HttpOnly prend le relais —
    const rotated = await page.evaluate(() => ({
      token: localStorage.getItem('dnd-inv-token'),
      legacy: localStorage.getItem('dnd-inv-refresh'),
    }));
    expect(rotated.legacy).toBeNull();
    expect(rotated.token).toBeTruthy();
    expect(rotated.token).not.toBe(expiredJwt(auth.user.id, auth.user.username));
    const cookie = await refreshCookie(page);
    expect(cookie?.value, 'le refresh a posé le cookie ts_refresh').toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).not.toBe(auth.refreshToken);

    // — Déconnexion depuis l'UI : purge locale + page de connexion —
    // (avant les sondes directes : une fois la famille tuée, la page ne doit
    // plus ÉMETTRE de rafraîchissement spontané qui viendrait purger avant nous)
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // — L'ANCIEN refresh token est mort : le représenter → 401 + family
    //   kill (requête directe, hors page — un attaquant qui garde une copie) —
    expect(await directRefresh(auth.refreshToken)).toBe(401);
    // … et le successeur (le cookie posé par le refresh, révoqué au logout)
    // ne re-connecte personne non plus.
    expect(await directRefresh(cookie?.value as string)).toBe(401);

    // Rechargement : plus rien en session, on reste sur la connexion.
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-token'))).toBeNull();
  });

  test('login pose ts_refresh HttpOnly ; JWT expiré → survie par cookie seul', async ({ page }) => {
    const username = `rt-cookie-${Date.now()}`;
    const auth = await registerUser(username);

    // Pas de visite guidée : elle masquerait la page.
    await page.addInitScript(() => {
      localStorage.setItem('dnd-inv-tour-seen', '1');
    });

    // — Login par l'UI : le serveur pose ts_refresh en Set-Cookie —
    await page.goto('/login');
    await page.fill('#login-username', username);
    await page.fill('#login-password', 'e2e-refresh-1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();

    const cookie = await refreshCookie(page);
    expect(cookie, 'cookie ts_refresh posé au login').toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/api/auth');
    // Fenêtre 30 j glissante (expires est en secondes epoch).
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
    // Le client ne stocke PLUS le refresh token en localStorage — le login
    // par l'UI a posé une NOUVELLE ligne, distincte de celle du register.
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-refresh'))).toBeNull();
    const cookieAtLogin = cookie?.value as string;
    expect(cookieAtLogin).not.toBe(auth.refreshToken);

    // — JWT périmé + rechargement : le cookie HttpOnly sauve la session
    //   tout seul (appel de refresh au corps VIDE — le JS ne voit pas la
    //   preuve, le navigateur la pose sur /api/auth) —
    await page.evaluate(
      (expired) => localStorage.setItem('dnd-inv-token', expired),
      expiredJwt(auth.user.id, auth.user.username),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();

    // La rotation serveur a REPLACÉ le cookie : valeur ≠ celle du login.
    const cookieAfter = await refreshCookie(page);
    expect(cookieAfter?.value).toBeTruthy();
    expect(cookieAfter?.value).not.toBe(cookieAtLogin);

    // — Déconnexion : le serveur efface le cookie et révoque la ligne —
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await refreshCookie(page), 'cookie effacé au logout').toBeUndefined();
    expect(await directRefresh(cookieAfter?.value as string)).toBe(401);
    expect(await directRefresh(cookieAtLogin)).toBe(401);
  });
});
