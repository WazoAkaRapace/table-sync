import { expect, test } from 'playwright/test';

/**
 * Réinitialisation de mot de passe — docs/transactional-emails.md.
 *
 * Le serveur e2e démarre SANS config Mailjet : l'état réel observable est la
 * note « e-mails non configurés ». Le parcours complet (formulaire →
 * confirmation, reset → redirection) passe par des stubs page.route sur
 * /api/auth/* : la chaîne réelle d'envoi est couverte par `npm run test-api`
 * (faux Mailjet HTTP), la validation visuelle par appareil réel.
 */

const OUBLI = '/mot-de-passe-oublie';
const RESET = '/reinitialiser-mot-de-passe';

test.describe('mot de passe oublié', () => {
  test('lien depuis la connexion', async ({ page }) => {
    await page.goto('/login');
    const link = page.getByRole('link', { name: 'Mot de passe oublié ?' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${OUBLI}$`));
  });

  test('serveur sans Mailjet : note dédiée après envoi', async ({ page }) => {
    await page.goto(OUBLI);
    await expect(page.getByRole('heading', { name: 'Mot de passe oublié' })).toBeVisible();
    // La note n'apparaît qu'après la soumission (l'API répond 503 réel).
    await page.getByLabel('Adresse e-mail').fill('lyra@example.com');
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await expect(page.getByText(/ne sont pas configurés sur ce serveur/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer le lien' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Retour à la connexion' })).toBeVisible();
  });

  test('parcours complet stubbé : demande → confirmation avec décompte', async ({ page }) => {
    const bodies: string[] = [];
    await page.route('**/api/auth/forgot-password', (route) => {
      bodies.push(route.request().postData() ?? '');
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(OUBLI);
    await page.getByLabel('Adresse e-mail').fill('lyra@example.com');
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();

    await expect(page.getByText(/un e-mail de réinitialisation vient d'être envoyé/)).toBeVisible();
    await expect(page.getByText(/Renvoyer possible dans/)).toBeVisible();
    // Bouton désactivé pendant le décompte de renvoi (60 s côté client).
    await expect(page.getByRole('button', { name: 'Envoyer le lien' })).toBeDisabled();

    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0] || '{}');
    expect(body.email).toBe('lyra@example.com');
    expect(['fr', 'en']).toContain(body.locale);
  });
});

test.describe('réinitialisation', () => {
  test('sans jeton : lien incomplet', async ({ page }) => {
    await page.goto(RESET);
    await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible();
    await expect(page.getByText(/Lien de réinitialisation incomplet/)).toBeVisible();
  });

  test('validation locale : mots de passe différents', async ({ page }) => {
    await page.goto(`${RESET}?token=abc123`);
    await page.getByLabel('Mot de passe (≥ 6 caractères)').fill('nouveaumdp1');
    await page.getByLabel('Confirmer le mot de passe').fill('autremdp2');
    await page.getByRole('button', { name: 'Réinitialiser mon mot de passe' }).click();
    await expect(page.getByText('Les deux mots de passe ne correspondent pas.')).toBeVisible();
  });

  test('succès : auto-login et redirection vers les groupes', async ({ page }) => {
    let resetBody: any = null;
    await page.route('**/api/auth/reset-password', (route) => {
      resetBody = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({
        json: {
          token: 'e2e-stub-jwt',
          user: {
            id: 2,
            username: 'lyra',
            displayName: 'Lyra',
            email: 'lyra@example.com',
            createdAt: '2026-01-01',
          },
        },
      });
    });
    // La page d'après (groupes) charge sa liste — stub vide pour ne pas
    // dépendre de la fixture.
    await page.route('**/api/parties', (route) => route.fulfill({ json: { parties: [] } }));

    await page.goto(`${RESET}?token=jeton-e2e-43-caracteres-aaaaaaaaaaaaa`);
    await page.getByLabel('Mot de passe (≥ 6 caractères)').fill('nouveaumdp1');
    await page.getByLabel('Confirmer le mot de passe').fill('nouveaumdp1');
    await page.getByRole('button', { name: 'Réinitialiser mon mot de passe' }).click();

    await expect(page).toHaveURL(/\/parties$/);
    expect(resetBody).toEqual({
      token: 'jeton-e2e-43-caracteres-aaaaaaaaaaaaa',
      newPassword: 'nouveaumdp1',
    });
    // Session adoptée : le token est stocké pour les requêtes suivantes.
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-token'))).toBe('e2e-stub-jwt');
  });

  test('lien invalide : erreur serveur + redemande un lien', async ({ page }) => {
    await page.route('**/api/auth/reset-password', (route) =>
      route.fulfill({
        status: 400,
        json: { error: 'lien de réinitialisation invalide ou expiré' },
      }),
    );

    await page.goto(`${RESET}?token=jeton-perime`);
    await page.getByLabel('Mot de passe (≥ 6 caractères)').fill('nouveaumdp1');
    await page.getByLabel('Confirmer le mot de passe').fill('nouveaumdp1');
    await page.getByRole('button', { name: 'Réinitialiser mon mot de passe' }).click();

    await expect(page.getByText(/invalide ou expiré/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Demander un nouveau lien' })).toBeVisible();
  });
});
