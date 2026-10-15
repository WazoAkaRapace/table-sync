/**
 * « J'ai fini mon tour » — le joueur clôt SON tour depuis sa fiche (carte
 * combat du dock) et depuis la vue combat (pied de scène joueur). L'état
 * d'entrée — Kael titulaire du tour — est amené par API au nom du MD ; la
 * spec ne pilote que le geste joueur côté UI.
 *
 * Les boutons portent l'aria-label « Terminer mon tour — … » (il prime sur
 * le texte visible pour les locateurs par rôle).
 */
import { expect } from 'playwright/test';
import { currentName, ensureKaelTurn } from './combat-state';
import { playerTest, seed, sheetUrl } from './fixtures';

/** Bouton de fin de tour — aria-label complet partagé par les trois surfaces. */
const END_TURN = 'Terminer mon tour — passer au combattant suivant';

const encId = () => seed().encounterId;

playerTest.describe('Fin de tour joueur', () => {
  playerTest('la carte combat de la fiche clôt le tour', async ({ page }) => {
    await ensureKaelTurn();
    await page.goto(sheetUrl(seed().guerrier.id));

    // Votre tour : la carte annonciatrice devient carte d'action.
    const end = page.getByRole('button', { name: END_TURN });
    await expect(end).toBeVisible();
    await end.click();

    // La carte retombe à l'état calme (bouton parti) et le tour rendu au
    // gobelin — vérifié dans l'API ET sur le rail d'initiative (la carte
    // calme EST le rail : dent courante aria-current au sang).
    await expect(end).toBeHidden();
    await expect.poll(currentName, { timeout: 10_000 }).not.toBe(seed().guerrier.name);
    const rail = page.getByRole('navigation', { name: "Ordre d'initiative" });
    await expect(rail).toBeVisible();
    await expect(rail.locator('[aria-current="true"]').first()).toContainText('Gobelin');
  });

  playerTest('le pied de scène de la vue combat clôt le tour', async ({ page }) => {
    await ensureKaelTurn();
    await page.goto(`/party/${seed().partyId}/combat?enc=${encId()}`);

    const end = page.getByRole('button', { name: END_TURN });
    await expect(end).toBeVisible();
    await end.click();

    // Le pied joueur disparaît avec le tour ; la scène passe au gobelin.
    await expect(end).toBeHidden();
    await expect.poll(currentName, { timeout: 10_000 }).not.toBe(seed().guerrier.name);
  });
});
