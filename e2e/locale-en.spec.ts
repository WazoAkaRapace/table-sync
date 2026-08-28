import { expect } from 'playwright/test';
import { playerTest, seed, sheetUrl } from './fixtures';

/**
 * Smoke EN : la préférence de langue bascule l'UI ET les payloads mono-locale.
 * Croît à chaque lot (plan i18n § 5) — aujourd'hui : connexion, groupes,
 * survie/stats/compétences, sorts, inventaire, combat.
 */
playerTest('locale EN — login et libellés localisés', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dnd-inv-lang', 'en'));
  await page.goto('/login');
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(
    page.getByText('The shared campaign companion, for the DM and the players'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
});

playerTest('locale EN — survie : vitalité, états, repos', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dnd-inv-lang', 'en'));
  await page.goto(sheetUrl(seed().guerrier.id));
  await expect(page.getByRole('heading', { name: '❤️ Vitality' })).toBeVisible();
  await expect(page.getByText('🎭 Conditions')).toBeVisible();
});

playerTest('locale EN — sorts de la fiche', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dnd-inv-lang', 'en'));
  await page.goto(sheetUrl(seed().clerc.id));
  await page.getByRole('button', { name: 'Sorts', exact: true }).click();
  await expect(page.getByText('Spell slots')).toBeVisible();
});
