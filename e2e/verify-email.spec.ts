import { expect, test } from 'playwright/test';
import { playerTest, seed } from './fixtures';

/**
 * Vérification d'adresse e-mail — docs/transactional-emails.md.
 *
 * Le serveur e2e démarre SANS config Mailjet : l'inscription n'envoie rien,
 * l'état observable est « adresse non vérifiée ». La consommation du lien
 * passe par des stubs page.route : la chaîne réelle (e-mail → jeton →
 * consommation) est couverte par `npm run test-api`. Les états de Mon compte
 * utilisent la session seedée réelle (les composants globaux font des appels
 * authentifiés qu'un faux jeton ferait 401-redirecter) avec /me stubbé pour
 * forcer l'état de vérification testé.
 */

const VERIFY = '/verifier-email';
const COMPTE = '/compte';

/** L'utilisateur seedé (joueur) tel que /me le renvoie, ajustable par scénario. */
function meStub(overrides: Record<string, unknown>) {
  const s = seed().player;
  return {
    id: s.user.id,
    username: s.user.username,
    displayName: s.user.displayName,
    email: `${s.username}@example.com`,
    emailVerifiedAt: null,
    pendingEmail: null,
    createdAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

test.describe('page de vérification', () => {
  test('sans jeton : lien incomplet', async ({ page }) => {
    await page.goto(VERIFY);
    await expect(
      page.getByRole('heading', { name: "Vérification de l'adresse e-mail" }),
    ).toBeVisible();
    await expect(page.getByText(/Lien de vérification incomplet/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Retour à la connexion' })).toBeVisible();
  });

  test('jeton invalide (réponse réelle du serveur sans Mailjet)', async ({ page }) => {
    await page.goto(`${VERIFY}?token=jeton-inconnu`);
    await expect(page.getByText(/invalide ou expiré/)).toBeVisible();
    await expect(page.getByText(/Connecte-toi puis demande un nouveau lien/)).toBeVisible();
  });

  test('succès : adresse vérifiée + continuer (stub)', async ({ page }) => {
    let verifyBody: any = null;
    await page.route('**/api/auth/verify-email', (route) => {
      verifyBody = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({ json: { user: meStub({ emailVerifiedAt: '2026-08-31 12:00:00' }) } });
    });

    await page.goto(`${VERIFY}?token=jeton-e2e-valide`);
    await expect(page.getByText('Adresse vérifiée — merci !')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continuer' })).toBeVisible();
    expect(verifyBody).toEqual({ token: 'jeton-e2e-valide' });
  });
});

playerTest.describe('Mon compte — état de vérification', () => {
  playerTest('adresse non vérifiée : note + renvoi (stub /me)', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ json: { user: meStub({ emailVerifiedAt: null }) } }),
    );
    const resends: string[] = [];
    await page.route('**/api/auth/verify-email/resend', (route) => {
      resends.push(route.request().url());
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(COMPTE);
    await expect(
      page.getByText('Adresse non vérifiée — vérifie ta boîte de réception.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Renvoyer le lien' }).click();
    await expect(
      page.getByText('Lien de vérification renvoyé — vérifie ta boîte de réception.'),
    ).toBeVisible();
    expect(resends).toHaveLength(1);
  });

  playerTest(
    'changement en attente : bandeau doré + adresse active conservée (stub /me)',
    async ({ page }) => {
      await page.route('**/api/auth/me', (route) =>
        route.fulfill({
          json: {
            user: meStub({
              emailVerifiedAt: '2026-08-01 00:00:00',
              pendingEmail: 'lyra-nouvelle@example.com',
            }),
          },
        }),
      );

      await page.goto(COMPTE);
      await expect(
        page.getByText(/Nouvelle adresse en attente de vérification : lyra-nouvelle@example.com/),
      ).toBeVisible();
      // Le champ montre l'adresse ACTIVE, pas celle en attente.
      await expect(page.getByLabel('Adresse e-mail')).toHaveValue(
        `${seed().player.username}@example.com`,
      );
      await expect(page.getByRole('button', { name: 'Renvoyer le lien' })).toBeVisible();
      // Vérifiée MAIS changement en vol : pas de chip « Vérifiée » sur le label.
      await expect(page.getByText('Vérifiée', { exact: true })).toHaveCount(0);
    },
  );
});
