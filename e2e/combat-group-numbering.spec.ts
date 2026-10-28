/**
 * Numérotation STABLE des mobs groupés : le numéro (« Gobelin 1 »,
 * « Gobelin 2 ») est le rang d'insertion dans le groupe, pas la position
 * dans la liste triée. La mort (le serveur renvoie les vaincus en fin de
 * liste) ne renumérote donc JAMAIS les survivants.
 */
import { expect } from 'playwright/test';
import { gmTest, seed } from './fixtures';

gmTest.describe('Numérotation des mobs groupés', () => {
  gmTest('la mort du n°1 ne renumérote pas le n°2', async ({ page }) => {
    const s = seed();
    // Gobelin 1 = plus petit id du groupe (rang d'insertion).
    const firstId = Math.min(...s.gobelinIds);

    // Tuer le gobelin 1 via l'API MD (PV à 0 → vaincu, envoyé en fin de liste).
    const res = await page.request.patch(`/api/combatants/${firstId}`, {
      data: { hitPoints: 0 },
      headers: { Authorization: `Bearer ${s.gm.token}` },
    });
    expect(res.status()).toBe(200);

    await page.goto(`/party/${s.partyId}/combat?enc=${s.encounterId}`);
    const rail = page.getByRole('navigation', { name: "Ordre d'initiative" });

    // Avant le fix, le survivant devenait « Gobelin 1 » (renumérotation
    // positionnelle après le tri des vaincus en fin de liste).
    await expect(rail.getByRole('button', { name: /Gobelin 2/ })).toBeVisible();
    await expect(rail.getByRole('button', { name: /Gobelin 1/ })).toBeVisible();

    // Le numéro identifie bien le bon mob : « Gobelin 1 » est le VAINCU
    // (aria-label porte « vaincu »), « Gobelin 2 » le survivant — pas l'inverse.
    const g1 = rail.getByRole('button', { name: /Gobelin 1/ });
    const g2 = rail.getByRole('button', { name: /Gobelin 2/ });
    await expect(g1).toHaveAttribute('aria-label', /vaincu/);
    await expect(g2).not.toHaveAttribute('aria-label', /vaincu/);
  });
});
