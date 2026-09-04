/**
 * Garde navigateur d'index.html : le CSS produit par Tailwind v4 exige
 * @property/oklch/color-mix (plancher Safari 16.4 / Chromium 111 /
 * Firefox 128) — un moteur plus ancien doit voir l'écran statique
 * « Navigateur trop ancien », et le bundle ne doit PAS booter (main.tsx
 * lit le drapeau __TS_UNSUPPORTED__). Simulation : un script d'init posé
 * AVANT les scripts de la page neutralise CSS.registerProperty — exactement
 * ce qu'un moteur sans @property présenterait à la garde.
 */
import { expect } from 'playwright/test';
import { playerTest } from './fixtures';

playerTest.describe('Garde navigateur (index.html)', () => {
  playerTest('moteur sans @property → écran statique, aucun boot @smoke', async ({ page }) => {
    await page.addInitScript(`
      try {
        Object.defineProperty(window, 'CSS', {
          configurable: true,
          value: new Proxy(CSS, { get: (t, k) => (k === 'registerProperty' ? undefined : t[k]) }),
        });
      } catch (e) {}
    `);
    await page.goto('/login');

    await expect(page.getByText('Navigateur trop ancien')).toBeVisible();
    await expect(page.getByText('Browser not supported')).toBeVisible();
    // Aucun boot React par-dessus l'écran statique : le formulaire de
    // connexion (champs e-mail/mot de passe) n'existe pas.
    await expect(page.locator('input')).toHaveCount(0);
  });

  playerTest('moteur moderne → l’app boote normalement (contrôle) @smoke', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Table Sync' })).toBeVisible();
    await expect(page.locator('input').first()).toBeVisible();
  });
});
