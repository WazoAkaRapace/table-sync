/**
 * Garde-fou des routes lazy (React.lazy + Suspense, App.tsx) : chaque route
 * principale doit résoudre son chunk et rendre un contenu connu — un
    import dynamique cassé par un refactor échoue ici.
 */
import { expect } from 'playwright/test';
import { playerTest, seed, sheetUrl } from './fixtures';

playerTest.describe('Navigation (routes lazy)', () => {
  playerTest('la liste des groupes rend le groupe seedé', async ({ page }) => {
    await page.goto('/parties');
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: `Ouvrir le groupe ${seed().partyName}` }),
    ).toBeVisible();
  });

  playerTest('la page du groupe liste les fiches des personnages', async ({ page }) => {
    const s = seed();
    await page.goto(`/party/${s.partyId}`);
    await expect(page.getByRole('heading', { name: s.partyName })).toBeVisible();
    await expect(
      page.getByRole('link', { name: `Ouvrir la fiche de ${s.guerrier.name}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: `Ouvrir la fiche de ${s.clerc.name}` }),
    ).toBeVisible();
  });

  playerTest('la fiche de personnage charge sur l’onglet Survie', async ({ page }) => {
    await page.goto(sheetUrl(seed().guerrier.id));
    // Bandeau d'état : nom du personnage + section Vitalité (tab par défaut).
    await expect(page.getByText(seed().guerrier.name).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '❤️ Vitalité' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Survie', exact: true })).toBeVisible();
  });

  playerTest('l’écran de connexion reste accessible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Table Sync' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });
});
