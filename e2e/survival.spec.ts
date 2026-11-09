/**
 * Survie du guerrier (Kael) — suivi de PV courant/max, dégâts via l'UI avec
 * persistance après rechargement (PATCH débouncé → refetch), dés de vie et
 * boutons de repos.
 *
 * Les PV de départ sont LUS dans l'UI (pas codés 44) : la suite partage une
 * base, les specs doivent rester indépendantes de l'ordre et des retries.
 */
import { expect } from 'playwright/test';
import { fetchCharacter, playerTest, seed, sheetUrl } from './fixtures';

playerTest.describe('Survie (guerrier)', () => {
  playerTest.beforeEach(async ({ page }) => {
    await page.goto(sheetUrl(seed().guerrier.id));
    // La fiche s'ouvre par défaut sur Survie : le suivi PV est en tête.
    await expect(page.getByLabel('Points de vie actuels')).toBeVisible();
  });

  playerTest('le suivi PV affiche courant / max', async ({ page }) => {
    // Le max ne bouge jamais (seed : 44) ; le courant peut avoir été entamé
    // par une autre spec — on vérifie la présence et la cohérence 0 < cur ≤ max.
    const cur = Number(await page.getByLabel('Points de vie actuels').inputValue());
    const max = Number(await page.getByLabel('Points de vie maximum').inputValue());
    expect(max).toBe(44);
    expect(cur).toBeGreaterThan(0);
    expect(cur).toBeLessThanOrEqual(max);
  });

  playerTest('les dégâts appliqués persistent après rechargement', async ({ page }) => {
    const hpInput = page.getByLabel('Points de vie actuels');
    const before = Number(await hpInput.inputValue());
    const after = Math.max(0, before - 5);

    await page.getByRole('button', { name: 'Blesser de 5' }).first().click();
    // État local immédiat…
    await expect(hpInput).toHaveValue(String(after));

    // …puis le PATCH débouncé (1 s) atteint le serveur : on poll l'API
    // directement avant de recharger, pour ne pas courir après la persistance.
    await expect
      .poll(() => fetchCharacter(seed().guerrier.id), { timeout: 10_000 })
      .toHaveProperty('currentHp', after);

    await page.reload();
    await expect(hpInput).toHaveValue(String(after));
  });

  playerTest('dés de vie et boutons de repos sont présents', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Repos' })).toBeVisible();
    await expect(page.getByLabel('Dépenser un dé de vie')).toBeVisible();
    await expect(page.getByRole('button', { name: '⛺ Repos court' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Repos long' })).toBeVisible();
  });
});
