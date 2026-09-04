/**
 * Fumigènes de gabarits jamais couverts ailleurs : téléphone en PAYSAGE
 * (844×390 — le dock bas et la carte combat restent ancrés, rien ne déborde)
 * et petit téléphone 320 px (iPhone SE — la barre d'onglets replie derrière
 * « ⋯ Plus », la mise en page doit tenir sans défilement horizontal).
 * Lecture seule : visible + absence de débordement horizontal, rien d'autre.
 */
import { expect, type Page } from 'playwright/test';
import { playerTest, seed, sheetUrl } from './fixtures';

const VIEWPORTS = [
  { label: 'téléphone paysage', size: { width: 844, height: 390 } },
  { label: 'petit téléphone', size: { width: 320, height: 568 } },
] as const;

/** scrollWidth total − clientWidth : > 1 px = du contenu fuit à droite. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) -
      document.documentElement.clientWidth,
  );
  expect(overflow, 'débordement horizontal').toBeLessThanOrEqual(1);
}

playerTest.describe('Gabarits de sécurité (paysage & 320 px)', () => {
  for (const vp of VIEWPORTS) {
    playerTest(`connexion tient le coup — ${vp.label} @smoke`, async ({ page }) => {
      await page.setViewportSize(vp.size);
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Table Sync' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    playerTest(`fiche Survie tient le coup — ${vp.label} @smoke`, async ({ page }) => {
      await page.setViewportSize(vp.size);
      await page.goto(sheetUrl(seed().guerrier.id));
      await expect(page.getByRole('heading', { name: '❤️ Vitalité' })).toBeVisible();
      // Le dock bas rend bien à ce gabarit (bouton Survie du dock ou hub).
      await expect(
        page
          .getByRole('button', { name: 'Autres onglets' })
          .or(page.getByRole('button', { name: 'Survie', exact: true }))
          .first(),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});
