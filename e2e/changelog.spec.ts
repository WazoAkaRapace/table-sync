import { expect, test } from 'playwright/test';
import { playerTest } from './fixtures';

/**
 * Journal des modifications :
 * 1. première visite → pas de popup de nouveautés ;
 * 2. version vue plus vieille → popup de diff, fermeture → stamp ;
 * 3. « Mon compte » → « Journal » à côté du SHA → dialog complet.
 *
 * NB : en dev (APP_VERSION=dev), le popup est volontairement éteint —
 * les tests de popup ne passent que sur le build CI (sha réel). La
 * version du build se lit DEPUIS LA PAGE (rendue dans Mon compte),
 * jamais depuis le contexte Node (__APP_VERSION__ n'y existe pas).
 */

playerTest('première visite : pas de popup de nouveautés', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('ts-changelog-seen'));
  await page.goto('/');
  // Au-delà du délai d'apparition (2,4 s).
  await page.waitForTimeout(3200);
  await expect(page.getByRole('dialog', { name: /nouveautés|what/i })).toHaveCount(0);
});

playerTest('version plus vieille vue : popup de diff, stamp à la fermeture', async ({ page }) => {
  // « vu » = un SHA absent du journal → le popup montre la version courante.
  await page.addInitScript(() => localStorage.setItem('ts-changelog-seen', 'sha-old-old-old'));
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: /nouveautés|what/i });
  // Dev : popup éteint — lire la version affichée dans Mon compte.
  await page.goto('/compte');
  const footer = await page
    .getByText(/Table Sync ·/)
    .first()
    .textContent();
  if (footer && footer.includes('dev')) {
    test.skip(true, 'popup désactivé en dev');
    return;
  }
  await page.goBack();
  await expect(dialog).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: /continuer|continue/i }).click();
  await expect(dialog).toBeHidden();
  const seen = await page.evaluate(() => localStorage.getItem('ts-changelog-seen'));
  expect(seen).toBeTruthy();
  expect(seen).not.toBe('sha-old-old-old');
});

playerTest('Mon compte : la version ouvre le journal', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('ts-changelog-seen'));
  await page.goto('/compte');
  // La version ELLE-MÊME est le bouton (aria-label « Journal des
  // modifications de la version <v> ») — plus de libellé « Journal ».
  await page
    .getByRole('button', { name: /journal des modifications|changelog/i })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: /journal des modifications|changelog/i }),
  ).toBeVisible();
});
