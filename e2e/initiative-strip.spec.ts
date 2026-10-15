/**
 * Rail d'initiative de la fiche joueur — l'ordre du combat lisible sans
 * quitter la fiche, sous le bandeau « État du personnage » (mobile et
 * desktop) : puce de rencontre vers le traqueur, dents triées (initiative
 * mono, nom, groupes numérotés), dent courante au sang (aria-current),
 * marque « toi » sur la propre dent. L'état d'entrée — rencontre active,
 * initiatives posées — est amené par API au nom du MD (ensureKaelTurn,
 * partagé avec la spec end-turn).
 */
import { expect } from 'playwright/test';
import { detail, ensureKaelTurn, gm } from './combat-state';
import { playerTest, seed, sheetUrl } from './fixtures';

const RAIL_NAME = "Ordre d'initiative";
const END_TURN = 'Terminer mon tour — passer au combattant suivant';

/** Amène la fiche à l'état calme : le tour rendu au groupe gobelin. */
async function quietState(): Promise<void> {
  await ensureKaelTurn(); // Kael titulaire du tour (initiative 20, gobelins 5)
  await gm('POST', `/api/encounters/${seed().encounterId}/next-turn`);
}

playerTest.describe("Rail d'initiative de la fiche joueur", () => {
  playerTest('état calme : ordre complet, dent courante, marque « toi »', async ({ page }) => {
    await quietState();
    // Vérité API : le filet de manche n'existe que si des combattants ont
    // déjà joué ce tour-ci (tourIndex > 0 — tout juste enroulé = pas de filet).
    const turnIndex = (await detail()).encounter.turnIndex;
    await page.goto(sheetUrl(seed().guerrier.id));

    // Le rail vit sous le bandeau d'état : la navigation annonce l'ordre.
    const rail = page.getByRole('navigation', { name: RAIL_NAME });
    await expect(rail).toBeVisible();
    const dents = rail.locator('li');

    // Ordre circulaire : la dent courante ouvre la marche, les déjà servis
    // (Kael, seul hors groupe) ferment la file APRÈS le filet de manche.
    await expect(dents.first()).toContainText('Gobelin');
    await expect(rail.locator('li > div').first()).toHaveAttribute('aria-current', 'true');
    await expect(dents.last()).toContainText(seed().guerrier.name);
    const filet = rail.getByText(/^Tour \d+$/);
    if (turnIndex > 0) {
      await expect(filet).toBeVisible();
    } else {
      await expect(filet).toBeHidden();
    }

    // Marque « toi » sur la propre dent + dent courante au sang (les groupes
    // jouent ensemble — plusieurs dents portent le tour, la première parle).
    await expect(rail.locator('[aria-current="true"]').first()).toContainText('Gobelin');
    await expect(dents.filter({ hasText: seed().guerrier.name })).toContainText("c'est toi");

    // La porte vers le traqueur du MD reste la carte dockée calme (le
    // repère de manche du rail n'est plus un lien — retour test 2026-10).
    await expect(
      page.getByRole('link', { name: 'Combat en cours — ouvrir le traqueur' }),
    ).toContainText(/Gobelin|Kael|Mira/);
  });

  playerTest("tour du joueur : l'étendard prime au dock, le rail reste", async ({ page }) => {
    await ensureKaelTurn();
    await page.goto(sheetUrl(seed().guerrier.id));

    // La carte dockée devient la carte d'action ; le rail, lui, vit sous le
    // bandeau — l'ordre reste lisible même pendant son propre tour.
    await expect(page.getByRole('button', { name: END_TURN })).toBeVisible();
    const rail = page.getByRole('navigation', { name: RAIL_NAME });
    await expect(rail).toBeVisible();
    await expect(rail.locator('[aria-current="true"]').first()).toContainText(seed().guerrier.name);
  });

  playerTest("desktop lg+ : rail in-flux sous le bandeau d'état", async ({ page }) => {
    await quietState();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(sheetUrl(seed().guerrier.id));

    const rail = page.getByRole('navigation', { name: RAIL_NAME });
    await expect(rail).toBeVisible();
    await expect(rail.locator('[aria-current="true"]').first()).toContainText('Gobelin');
    await expect(rail.locator('li').filter({ hasText: seed().guerrier.name })).toContainText(
      "c'est toi",
    );
  });
});
