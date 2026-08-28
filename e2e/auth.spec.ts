/**
 * Connexion — les seuls tests SANS fixture de session : ils pilotent
 * l'écran de login comme un vrai nouvel appareil.
 */
import { expect, test } from 'playwright/test';
import { seed } from './fixtures';

test.describe('Authentification', () => {
  test('un mauvais mot de passe affiche l’erreur et reste sur /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel("Nom d'utilisateur").fill(seed().player.username);
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    // Le message exact vient de l'API (« identifiants invalides ») ; on accepte
    // aussi le repli générique du client au cas où la formulation évolue.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/identifiants invalides|connexion échouée/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('un couple correct connecte la joueuse et redirige vers les groupes', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel("Nom d'utilisateur").fill(seed().player.username);
    await page.getByLabel('Mot de passe').fill(seed().player.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page).toHaveURL(/\/parties$/);
    await expect(page.getByRole('heading', { name: 'Mes groupes' })).toBeVisible();
    // État « connecté » : le bouton de déconnexion n'existe que pour une session.
    await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible();
  });
});
