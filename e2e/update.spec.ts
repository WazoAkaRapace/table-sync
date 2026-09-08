/**
 * Bandeau de mise à jour PWA : le build courant porte sa version, le
 * serveur sert /version.json — quand ils divergent, le bandeau DÉCLENCHE
 * l'installation du nouveau service worker (registration.update()) et ne
 * paraît qu'une fois son précache annoncé fini. La sonde est bouchonnée
 * (« dev » concordant ne dit rien, un SHA inconnu dérive) et deux chemins
 * sont testés :
 *  - SW factice qui répond « precache-done » avec la version servie →
 *    le bandeau tombe après le warm-up, ✕ l'écarte pour cette version ;
 *  - pas de service worker du tout → le bandeau tombe immédiatement
 *    (secours : le rechargement HTTP reste possible).
 */
import { expect } from 'playwright/test';
import { playerTest } from './fixtures';

/**
 * SW factice : registration.update() noté dans __swUpdateCalled, et chaque
 * sonde « precache-status » reçoit « precache-done » portant `version`
 * (null = le SW ne répond jamais — le warm-up reste en attente).
 */
function stubServiceWorker(page: import('playwright/test').Page, version: string | null) {
  return page.addInitScript((precacheVersion) => {
    let onMessage: ((event: { data: unknown }) => void) | null = null;
    const fake = {
      addEventListener: (_type: string, cb: (event: { data: unknown }) => void) => {
        onMessage = cb;
      },
      removeEventListener: () => {},
      ready: Promise.resolve({
        update: () => {
          (window as any).__swUpdateCalled = true;
          return Promise.resolve();
        },
      }),
      controller: {
        postMessage: (msg: { type?: string }) => {
          if (msg?.type !== 'precache-status' || precacheVersion === null) return;
          // async : le bandeau a le temps de finir son montage.
          setTimeout(
            () => onMessage?.({ data: { type: 'precache-done', version: precacheVersion } }),
            50,
          );
        },
      },
      register: () => Promise.resolve(null),
    };
    Object.defineProperty(navigator, 'serviceWorker', { get: () => fake, configurable: true });
  }, version);
}

playerTest('dérive → warm-up SW → bandeau une fois le précache annoncé', async ({ page }) => {
  await stubServiceWorker(page, 'sha-deadbeef');
  // Aucune divergence : pas de bandeau.
  await page.route('**/version.json', (route) => route.fulfill({ json: { version: 'dev' } }));
  await page.goto('/parties');
  await expect(page.getByRole('status').filter({ hasText: 'mise à jour' })).toHaveCount(0);
  await page.waitForTimeout(800);

  // Le serveur sert un build plus récent : warm-up puis bandeau.
  await page.route('**/version.json', (route) =>
    route.fulfill({ json: { version: 'sha-deadbeef' } }),
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const banner = page.getByRole('status').filter({ hasText: 'Une mise à jour est prête' });
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('status').filter({ hasText: 'sha-deadbeef' })).toBeVisible();
  // Le bandeau a bien fait installer le nouveau SW pendant l'attente.
  expect(await page.evaluate(() => (window as any).__swUpdateCalled === true)).toBe(true);

  // ✕ écarte CETTE version — une sonde suivante ne la réaffiche pas.
  await page.getByRole('button', { name: 'Fermer' }).last().click();
  await expect(banner).toHaveCount(0);
});

playerTest('sans service worker : le bandeau tombe dès la dérive (secours)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: true });
  });
  await page.route('**/version.json', (route) => route.fulfill({ json: { version: 'dev' } }));
  await page.goto('/parties');
  await expect(page.getByRole('status').filter({ hasText: 'mise à jour' })).toHaveCount(0);

  await page.route('**/version.json', (route) =>
    route.fulfill({ json: { version: 'sha-deadbeef' } }),
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(
    page.getByRole('status').filter({ hasText: 'Une mise à jour est prête' }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('status').filter({ hasText: 'sha-deadbeef' })).toBeVisible();
});
