/*
 * Table du MD — noms très longs : la page ne doit jamais scroller
 * horizontalement (mobile 390px). Régression 2026-09 : la grille mobile des
 * cartes PJ (pas de grid-cols au premier palier) se dimensionnait sur le
 * max-content du nom le plus long — 129 caractères insécables poussaient
 * toutes les cartes à 1327px de large.
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, seed } from './fixtures';

const LONG_NAME = 'BartholoméussondelaValléedeRocmontpellier'.repeat(3); // 129 chars, sans espace

gmTest('Table du MD : nom de PJ très long ne fait pas déborder la page', async ({ page }) => {
  const s = seed();
  const res = await fetch(`${API_BASE}/api/parties/${s.partyId}/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.player.token}` },
    body: JSON.stringify({
      name: LONG_NAME,
      characterClass: 'Magicien',
      level: 7,
      race: 'Haut-Elfe',
    }),
  });
  if (!res.ok) throw new Error(`création PJ : ${res.status} ${await res.text()}`);

  await page.goto(`/party/${s.partyId}/gm`);
  const card = page.locator('.card', { hasText: LONG_NAME.slice(0, 20) }).first();
  await expect(card).toBeVisible();

  // 1. Le document ne scroll pas horizontalement, la carte tient dans l'écran.
  const doc = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(doc.scrollW).toBeLessThanOrEqual(doc.clientW);
  const cardRect = await card.boundingBox();
  expect((cardRect?.x ?? 0) + (cardRect?.width ?? 0)).toBeLessThanOrEqual(doc.clientW + 0.5);

  // 2. Le nom est tronqué (ellipsis), pas étalé.
  const nameEl = await card
    .locator('h3 span')
    .first()
    .evaluate((el) => ({
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
    }));
  expect(nameEl.scrollW).toBeGreaterThan(nameEl.clientW);

  // 3. Même verdict modale de suppression ouverte (le titre porte le nom).
  await card.locator('button[title]').first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  const docModal = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(docModal.scrollW).toBeLessThanOrEqual(docModal.clientW);
});
