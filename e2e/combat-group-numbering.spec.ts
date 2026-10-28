/**
 * Numérotation STABLE des mobs groupés : le numéro (« Gobelin 1 »,
 * « Gobelin 2 ») est le rang d'insertion dans le groupe, pas la position
 * dans la liste triée. La mort (le serveur renvoie les vaincus en fin de
 * liste) ne renumérote donc JAMAIS les survivants.
 *
 * Rencontre DÉDIÉE (jamais la rencontre seedée) : la spec tue un gobelin,
 * et les specs suivantes partagent le même monde — aucune mutation de
 * « Embuscade gobeline ».
 */
import { expect } from 'playwright/test';
import { gmTest, seed } from './fixtures';

gmTest.describe('Numérotation des mobs groupés', () => {
  gmTest('la mort du n°1 ne renumérote pas les n°2 et n°3', async ({ page }) => {
    const s = seed();
    const auth = { Authorization: `Bearer ${s.gm.token}` };

    // — Rencontre dédiée : 3 gobelins groupés —
    const enc = await page.request.post(`/api/parties/${s.partyId}/encounters`, {
      data: { name: 'Test numérotation (e2e)' },
      headers: auth,
    });
    expect(enc.status()).toBe(201);
    const { encounter } = (await enc.json()) as { encounter: { id: number } };

    const add = await page.request.post(`/api/encounters/${encounter.id}/combatants/monster`, {
      data: { monsterSlug: 'gobelin', count: 3 },
      headers: auth,
    });
    expect(add.status()).toBe(201);
    const detail = await page.request.get(`/api/encounters/${encounter.id}`, { headers: auth });
    const { encounter: full } = (await detail.json()) as {
      encounter: { combatants: { id: number; monsterSlug: string | null }[] };
    };
    const ids = full.combatants
      .filter((c) => c.monsterSlug === 'gobelin')
      .map((c) => c.id)
      .sort((a, b) => a - b);
    expect(ids).toHaveLength(3);

    // Gobelin 1 = plus petit id du groupe (rang d'insertion). On le tue :
    // PV à 0 → vaincu, le tri serveur l'envoie en fin de liste.
    const kill = await page.request.patch(`/api/combatants/${ids[0]}`, {
      data: { hitPoints: 0 },
      headers: auth,
    });
    expect(kill.status()).toBe(200);

    await page.goto(`/party/${s.partyId}/combat?enc=${encounter.id}`);
    const rail = page.getByRole('navigation', { name: "Ordre d'initiative" });

    // Avant le fix, le survivant devenait « Gobelin 1 » (renumérotation
    // positionnelle après le tri des vaincus en fin de liste).
    await expect(rail.getByRole('button', { name: /Gobelin 3/ })).toBeVisible();

    // Le numéro identifie bien le bon mob : « Gobelin 1 » est le VAINCU
    // (aria-label porte « vaincu »), « Gobelin 2 » et « Gobelin 3 » non.
    const g1 = rail.getByRole('button', { name: /Gobelin 1/ });
    const g2 = rail.getByRole('button', { name: /Gobelin 2/ });
    const g3 = rail.getByRole('button', { name: /Gobelin 3/ });
    await expect(g1).toHaveAttribute('aria-label', /vaincu/);
    await expect(g2).not.toHaveAttribute('aria-label', /vaincu/);
    await expect(g3).not.toHaveAttribute('aria-label', /vaincu/);
  });
});
