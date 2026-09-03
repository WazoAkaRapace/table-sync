import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { openTab, playerTest, seed, sheetUrl } from './fixtures';

/**
 * Visite guidée (docs/tutorial-script.md) : démarrage auto au premier
 * chargement, enchaînement Bienvenue → Survie, abandon par « Passer »,
 * drapeau partagé serveur + localStorage, et rejeu via « Mon compte →
 * Réinitialiser le tutoriel ». La fixture pré-positionne le drapeau LOCAL ;
 * depuis la synchro serveur, chaque test qui retire ce drapeau doit AUSSI
 * réarmer le serveur (PATCH tutorialSeenAt: null) — sinon la convergence
 * le repose au chargement suivant (les init scripts s'exécutent dans
 * l'ordre d'enregistrement).
 */

/** Réarme l'état visite guidée côté serveur pour la joueuse seedée. */
async function resetServerTutorial(): Promise<void> {
  const s = seed();
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.player.token}` },
    body: JSON.stringify({ tutorialSeenAt: null }),
  });
  if (!res.ok) throw new Error(`reset tutoriel serveur : ${res.status} ${await res.text()}`);
}

/** Avance jusqu'au « Terminer » — tolère les étapes sautées (cible absente,
 *  ex. ressources de classe sur un guerrier sans traits : joyride avance
 *  tout seul après son targetWaitTimeout). */
async function advanceToFinish(page: import('playwright/test').Page) {
  const next = page.getByRole('button', { name: 'Suivant', exact: true });
  for (let guard = 0; guard < 15; guard++) {
    const hasNext = await next.waitFor({ state: 'visible', timeout: 2500 }).then(
      () => true,
      () => false,
    );
    if (!hasNext) break;
    await next.click();
  }
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
}

playerTest.describe('visite guidée', () => {
  playerTest('démarre sur une fiche vierge de drapeau et avance', async ({ page }) => {
    await resetServerTutorial();
    await page.addInitScript(() => localStorage.removeItem('dnd-inv-tour-seen'));
    await page.goto(sheetUrl(seed().guerrier.id));

    // Étape 1 — carte d'accueil centrée.
    await expect(page.getByRole('alertdialog').first()).toBeVisible();
    await expect(page.getByText('Bienvenue sur ta fiche !')).toBeVisible();
    await expect(page.getByText('1 / 5')).toBeVisible();

    // Étape 2 — bandeau d'état.
    await page.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(page.getByText('Ta survie, toujours en vue')).toBeVisible();
    await expect(page.getByText('2 / 5')).toBeVisible();

    // Étapes 3-4 (dock + hub, vue mobile 390px) puis étape finale.
    await page.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(page.getByText('Tes onglets')).toBeVisible();
    await page.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(page.getByText('Le bouton central')).toBeVisible();
    await page.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(page.getByText("C'est parti pour la Survie")).toBeVisible();
  });

  playerTest(
    "la chaîne Bienvenue → Survie change d'onglet et pose le drapeau (serveur inclus)",
    async ({ page }) => {
      await resetServerTutorial();
      await page.addInitScript(() => localStorage.removeItem('dnd-inv-tour-seen'));
      await page.goto(sheetUrl(seed().guerrier.id));

      // Déroule les 5 étapes de Bienvenue (la fiche s'ouvre déjà sur Survie,
      // mais l'étape 1 peut arriver depuis n'importe quel onglet).
      const next = page.getByRole('button', { name: 'Suivant', exact: true });
      await expect(page.getByRole('alertdialog').first()).toBeVisible();
      for (let i = 0; i < 4; i++) await next.click();

      // Terminer la Bienvenue enchaîne sur la Survie — bulle 1/n, panneau
      // vitalité affiché (le crochet before a basculé l'onglet).
      await page.getByRole('button', { name: 'Terminer', exact: true }).click();
      await expect(page.getByText('Tes points de vie et leurs temporaires')).toBeVisible();

      // Terminer la Survie : fin de visite, drapeau posé, bulle fermée.
      await advanceToFinish(page);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('dnd-inv-tour-seen'))).toBe('1');
    },
  );

  playerTest('« Passer » arrête la visite sans enchaîner et pose le drapeau', async ({ page }) => {
    await resetServerTutorial();
    await page.addInitScript(() => localStorage.removeItem('dnd-inv-tour-seen'));
    await page.goto(sheetUrl(seed().guerrier.id));

    await expect(page.getByRole('alertdialog').first()).toBeVisible();
    await page.getByRole('button', { name: 'Suivant', exact: true }).click();
    await page.getByRole('button', { name: 'Passer', exact: true }).click();

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-tour-seen'))).toBe('1');
    // Pas d'enchaînement sur la Survie : le texte de la bulle vitalité est absent.
    await expect(page.getByText('Tes points de vie et leurs temporaires')).toHaveCount(0);
  });

  playerTest(
    '« Réinitialiser le tutoriel » rejoue la visite depuis Mon compte',
    async ({ page }) => {
      // Drapeau posé par la fixture : pas de visite au premier chargement
      // (la fiche est rendue et le délai de 800 ms est passé).
      await page.goto(sheetUrl(seed().guerrier.id));
      await expect(page.getByRole('heading', { name: '❤️ Vitalité' })).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);

      // La fixture repose le drapeau à CHAQUE chargement de page ; ce retrait
      // ne s'enregistre qu'après la première moitié du test (les init scripts
      // s'exécutent dans l'ordre d'enregistrement).
      await page.addInitScript(() => localStorage.removeItem('dnd-inv-tour-seen'));
      await page.goto('/compte');
      await page.getByRole('button', { name: 'Réinitialiser le tutoriel' }).click();
      await expect(page.getByText('Visite guidée réactivée')).toBeVisible();

      // Retour sur la fiche : la visite redémarre.
      await page.goto(sheetUrl(seed().guerrier.id));
      await expect(page.getByText('Bienvenue sur ta fiche !')).toBeVisible();
    },
  );

  // Le CŒUR du stockage serveur : un compte ayant déjà vu la visite ne la
  // rejoue pas sur un navigateur vierge (nouvel appareil) — le drapeau
  // serveur l'emporte sur l'absence de drapeau local.
  playerTest('vu côté serveur : pas de visite sur un navigateur vierge', async ({ page }) => {
    const s = seed();
    const mark = await fetch(`${API_BASE}/api/auth/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.player.token}` },
      body: JSON.stringify({ tutorialSeenAt: new Date().toISOString() }),
    });
    if (!mark.ok) throw new Error(`marquage serveur : ${mark.status}`);

    // Navigateur vierge : la fixture pose le drapeau local, on le retire
    // (script enregistré après le sien → il gagne).
    await page.addInitScript(() => {
      localStorage.removeItem('dnd-inv-tour-seen');
      localStorage.removeItem('dnd-inv-tour-tabs');
    });
    await page.goto(sheetUrl(s.guerrier.id));
    await expect(page.getByRole('heading', { name: '❤️ Vitalité' })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  playerTest('locale EN — la visite parle anglais', async ({ page }) => {
    await resetServerTutorial();
    await page.addInitScript(() => {
      localStorage.setItem('dnd-inv-lang', 'en');
      localStorage.removeItem('dnd-inv-tour-seen');
    });
    await page.goto(sheetUrl(seed().guerrier.id));

    await expect(page.getByText('Welcome to your sheet!')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
  });

  // Visites propres d'onglet : premier passage = sa visite, une seule fois.
  playerTest('le premier passage sur un onglet déclenche sa visite propre', async ({ page }) => {
    // La fixture marque tout comme vu ; on ne réarme que l'inventaire.
    // (reset serveur aussi : la convergence fusionnerait les onglets du
    //  serveur dans le local, réarmant l'inventaire par la même occasion.)
    await resetServerTutorial();
    await page.addInitScript(() =>
      localStorage.setItem(
        'dnd-inv-tour-tabs',
        JSON.stringify([
          'survival',
          'stats',
          'spells',
          'skills',
          'features',
          'description',
          'npcs',
          'notes',
        ]),
      ),
    );
    await page.goto(sheetUrl(seed().guerrier.id));
    await expect(page.getByRole('heading', { name: '❤️ Vitalité' })).toBeVisible();

    await openTab(page, 'Inventaire');
    await expect(page.getByText('Tes rangements')).toBeVisible();
    await expect(page.getByText('1 / 7')).toBeVisible();

    // « Passer » clôt l'onglet : il ne se redéclenchera plus.
    await page.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('dnd-inv-tour-tabs'))).toContain(
      'inventory',
    );

    await openTab(page, 'Survie');
    await openTab(page, 'Inventaire');
    await page.waitForTimeout(1200);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  // Desktop : la barre d'onglets haute remplace le dock, l'étape hub
  // (mobile seule) est filtrée — la Bienvenue y compte 4 étapes.
  playerTest.describe('vue desktop', () => {
    playerTest.use({ viewport: { width: 1280, height: 800 } });

    playerTest("la visite cible la barre d'onglets haute", async ({ page }) => {
      await resetServerTutorial();
      await page.addInitScript(() => localStorage.removeItem('dnd-inv-tour-seen'));
      await page.goto(sheetUrl(seed().guerrier.id));

      await expect(page.getByText('Bienvenue sur ta fiche !')).toBeVisible();
      await expect(page.getByText('1 / 4')).toBeVisible();

      const next = page.getByRole('button', { name: 'Suivant', exact: true });
      await next.click();
      await expect(page.getByText('Ta survie, toujours en vue')).toBeVisible();
      await next.click();
      await expect(page.getByText('Tes onglets')).toBeVisible();
      await expect(page.locator('[data-tuto="tabbar"]')).toBeVisible();
      await next.click();
      await expect(page.getByText("C'est parti pour la Survie")).toBeVisible();
      await expect(page.getByText('4 / 4')).toBeVisible();
    });
  });
});
