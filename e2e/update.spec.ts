/**
 * Bandeau de mise à jour PWA : le build courant porte sa version, le
 * serveur sert /version.json — quand ils divergent, la recharge se propose.
 * Ici la sonde est bouchonnée : « dev » (concordant) ne dit rien, un SHA
 * inconnu fait tomber le bandeau, ✕ l'écarte pour cette version.
 */
import { expect } from 'playwright/test';
import { playerTest } from './fixtures';

playerTest(
  'la sonde de version propose la recharge quand le serveur est plus frais',
  async ({ page }) => {
    // Aucune divergence : pas de bandeau.
    await page.route('**/version.json', (route) => route.fulfill({ json: { version: 'dev' } }));
    await page.goto('/parties');
    await expect(page.getByRole('status').filter({ hasText: 'mise à jour' })).toHaveCount(0);
    await page.waitForTimeout(800);

    // Le serveur sert un build plus récent : le bandeau tombe.
    await page.route('**/version.json', (route) =>
      route.fulfill({ json: { version: 'sha-deadbeef' } }),
    );
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(
      page.getByRole('status').filter({ hasText: 'Une mise à jour est prête' }),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('status').filter({ hasText: 'sha-deadbeef' })).toBeVisible();

    // ✕ écarte CETTE version — une sonde suivante ne la réaffiche pas.
    await page.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Une mise à jour est prête' }),
    ).toHaveCount(0);
  },
);
