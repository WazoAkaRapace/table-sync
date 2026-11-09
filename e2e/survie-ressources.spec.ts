/**
 * Onglet Survie — panneau « ⚡ Ressources » par catégorie :
 * les compteurs de traits de TOUTES catégories (classe, race, historique,
 * dons, personnalisé) s'affichent, groupés en sections ; un perso sans
 * aucune ressource ne rend pas le panneau (garde d'avant, conservée).
 */
import { expect } from 'playwright/test';

import { gmTest, openTab, seed, sheetUrl } from './fixtures';

gmTest(
  'survie: ressources par catégorie — sections classe/race/historique/dons/perso',
  async ({ page }) => {
    const s = seed();
    const auth = { Authorization: `Bearer ${s.gm.token}` };
    // Personnage avec une ressource par catégorie hors classe
    const res = await page.request.post(`/api/parties/${s.partyId}/characters`, {
      data: { name: 'Sylve Ressources', characterClass: 'Roublard', level: 5 },
      headers: auth,
    });
    const cid = (await res.json()).character.id;
    const feats: Array<[string, string, number]> = [
      ['Férocité half-orque', 'racial', 1],
      ['Faveur du fort', 'background', 2],
      ['Don ténébreux', 'feat', 3],
      ['Ressource perso', 'custom', 5],
    ];
    for (const [title, category, counterMax] of feats) {
      await page.request.post(`/api/characters/${cid}/features`, {
        data: { title, category, counterMax, resetType: 'long' },
        headers: auth,
      });
    }

    await page.goto(sheetUrl(cid));
    await openTab(page, 'Survie');
    await expect(page.getByRole('heading', { name: 'Ressources' })).toBeVisible();
    const sections = page.locator('h4', {
      hasText: /^(Classe|Race|Historique|Dons|Personnalisé)$/,
    });
    await expect(sections).toHaveCount(4);
    await expect(sections.nth(0)).toHaveText('Race');
    await expect(sections.nth(1)).toHaveText('Historique');
    await expect(sections.nth(2)).toHaveText('Dons');
    await expect(sections.nth(3)).toHaveText('Personnalisé');
    await expect(page.getByText('Ressource perso')).toBeVisible();
    // Le stepper − décrémente et persiste (5 → 4)
    await page
      .getByRole('button', { name: /Ressource perso/ })
      .first()
      .click();
    await expect(page.getByText(/4\s*\/\s*5/).first()).toBeVisible();
  },
);

gmTest('survie: aucun compteur → panneau Ressources absent', async ({ page }) => {
  const s = seed();
  const res = await page.request.post(`/api/parties/${s.partyId}/characters`, {
    data: { name: 'Barde Nu', characterClass: 'Barde', level: 2 },
    headers: { Authorization: `Bearer ${s.gm.token}` },
  });
  const cid = (await res.json()).character.id;
  await page.goto(sheetUrl(cid));
  await openTab(page, 'Survie');
  await expect(page.getByRole('heading', { name: 'Ressources' })).toHaveCount(0);
});
