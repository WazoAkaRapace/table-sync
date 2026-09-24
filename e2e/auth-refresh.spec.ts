/**
 * Jetons de rafraîchissement — docs/plan-refresh-tokens.md.
 *
 * Le scénario vedette : un appareil revient après plus de 7 jours, son JWT
 * est périmé mais son refresh token (30 jours) vit encore — la session se
 * rafraîchit TOUTE SEULE (intercepteur 401 → rotation → requête rejouée),
 * sans passage par /login. Le jeton consommé ne resert jamais (réutilisation
 * → 401 + family kill), la déconnexion révoque ce qu'il reste.
 *
 * Utilisateur dédié créé au runtime : les specs partagent une seule base.
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

test.describe('jetons de rafraîchissement', () => {
  test('JWT expiré + refresh token valide : session sauvée sans /login', async ({ page }) => {
    // — Utilisateur dédié (la base est partagée entre specs, on ne touche
    //   rien de seedé) : inscription, couple complet en retour —
    const username = `rt-e2e-${Date.now()}`;
    const reg = await fetch(`${API_BASE}/api/auth/register`, {
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
    expect(reg.ok, `inscription ${username}`).toBeTruthy();
    const auth = (await reg.json()) as {
      token: string;
      refreshToken: string;
      user: { id: number; username: string };
    };
    expect(auth.refreshToken).toBeTruthy();

    // — Session locale : un JWT PÉRIMÉ + le refresh token valide — le pire
    //   cas d'un appareil qui revient d'une semaine d'absence. —
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

    // — Rotation LOCALE : le triplet posé par le refresh n'est plus celui
    //   injecté (l'ancien jeton est consommé, le neuf lui a succédé) —
    const rotated = await page.evaluate(() => ({
      token: localStorage.getItem('dnd-inv-token'),
      refresh: localStorage.getItem('dnd-inv-refresh'),
    }));
    expect(rotated.refresh).toBeTruthy();
    expect(rotated.refresh).not.toBe(auth.refreshToken);
    expect(rotated.token).not.toBe(expiredJwt(auth.user.id, auth.user.username));

    // — Déconnexion depuis l'UI : purge locale + page de connexion —
    // (avant les sondes directes : une fois la famille tuée, la page ne doit
    // plus ÉMETTRE de rafraîchissement spontané qui viendrait purger avant nous)
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // — L'ANCIEN refresh token est mort : le représenter → 401 + family
    //   kill (requête directe, hors page — un attaquant qui garde une copie) —
    expect(await directRefresh(auth.refreshToken)).toBe(401);
    // … et le dernier jeton (successeur, révoqué au logout) ne re-connecte
    // personne non plus.
    expect(await directRefresh(rotated.refresh as string)).toBe(401);

    // Rechargement : plus rien en session, on reste sur la connexion.
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-token'))).toBeNull();
  });
});
