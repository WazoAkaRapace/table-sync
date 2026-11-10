/**
 * Combat (vue MD) — la rencontre seedée « Embuscade gobeline » part en
 * setup NON démarrée : ces specs pilotent le vrai flow de table :
 * tout lancer les initiatives → démarrer → Tour suivant, et vérifient que
 * l'indicateur de tour actif (aria-current) se déplace dans le rail.
 */
import { expect } from 'playwright/test';
import { gmTest, seed } from './fixtures';

gmTest.describe('Combat (MD)', () => {
  gmTest.beforeEach(async ({ page }) => {
    // Deep-link direct dans la rencontre (même lien que le widget joueur).
    // Le rail d'initiative prouve que le chunk lazy de CombatPage a résolu.
    await page.goto(`/party/${seed().partyId}/combat?enc=${seed().encounterId}`);
    await expect(page.getByRole('navigation', { name: "Ordre d'initiative" })).toBeVisible();
  });

  gmTest('la rencontre liste les gobelins et le PJ sur le banc', async ({ page }) => {
    const rail = page.getByRole('navigation', { name: "Ordre d'initiative" });
    await expect(rail.getByRole('button', { name: /Gobelin 1/ })).toBeVisible();
    await expect(rail.getByRole('button', { name: /Gobelin 2/ })).toBeVisible();
    await expect(rail.getByRole('button', { name: seed().guerrier.name })).toBeVisible();
    // Setup : le banc réclame les initiatives avant de démarrer.
    await expect(page.getByText('En attente', { exact: false })).toBeVisible();
  });

  gmTest('démarrer le combat puis avancer déplace le tour actif', async ({ page }) => {
    // Le PJ d'abord sur scène pour un point d'ancrage stable.
    const rail = page.getByRole('navigation', { name: "Ordre d'initiative" });
    await rail.getByRole('button', { name: seed().guerrier.name }).click();
    await expect(
      page.getByRole('heading', { name: seed().guerrier.name, exact: true }),
    ).toBeVisible();

    // Tolérant aux retries (combat déjà démarré) : roll-all et démarrage
    // n'existent qu'en setup — on ne les touche que s'ils sont là.
    const rollAll = page.getByRole('button', { name: 'Tout lancer' });
    if (
      await rollAll.waitFor({ state: 'visible', timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await rollAll.click();
    }
    const start = page.getByRole('button', { name: '▶ Démarrer le combat' });
    if (
      await start.waitFor({ state: 'visible', timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(start).toBeEnabled();
      await start.click();
    }

    // Combat actif : un combattant porte le tour (aria-current dans le rail).
    const active = rail.locator('button[aria-current="true"]');
    await expect(active.first()).toBeVisible();
    const before = (await active.allInnerTexts()).join('|');

    await page.getByRole('button', { name: '▶ Tour suivant' }).click();
    await expect
      .poll(async () => (await active.allInnerTexts()).join('|'), { timeout: 10_000 })
      .not.toBe(before);
  });
});
