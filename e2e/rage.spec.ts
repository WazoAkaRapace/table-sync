/**
 * Issue #189 — État Rage du barbare.
 *
 * Bouton « 🔥 Entrer en rage » sur la rangée du trait Rage (Survie →
 * Ressources) : un tap consomme une charge ET pose l'état — le bandeau
 * épinglé porte alors la pastille 🔥, et « Rompre la rage » la retire
 * (la charge reste dépensée). Perso dédié : la suite partage une base.
 */
import { expect } from 'playwright/test';

import { gmTest, openTab, seed, sheetUrl } from './fixtures';

gmTest('rage: consommer une charge pose l’état, rompre le retire', async ({ page }) => {
  const s = seed();
  const auth = { Authorization: `Bearer ${s.gm.token}` };
  // Barbare dédié niveau 5 (3 charges de rage) avec le trait du catalogue
  const res = await page.request.post(`/api/parties/${s.partyId}/characters`, {
    data: { name: 'Brutanex E2E', characterClass: 'Barbare', level: 5, maxHp: 20, currentHp: 20 },
    headers: auth,
  });
  const cid = (await res.json()).character.id;
  await page.request.post(`/api/characters/${cid}/features`, {
    data: { title: 'Rage', catalogId: 'barbare-rage', category: 'class' },
    headers: auth,
  });

  await page.goto(sheetUrl(cid));
  await openTab(page, 'Survie');
  await expect(page.getByRole('heading', { name: '⚡ Ressources' })).toBeVisible();

  // Pas d'état au repos : ni pastille bandeau, ni chip
  await expect(page.locator('[title="Rage en cours"]')).toHaveCount(0);

  // Entrer en rage : la charge passe 3/3 → 2/3 et l'état se pose
  await page.getByRole('button', { name: '🔥 Entrer en rage' }).click();
  await expect(page.getByText(/2\s*\/\s*3/).first()).toBeVisible();
  await expect(page.locator('[title="Rage en cours"]').first()).toBeVisible();

  // Rompre : la pastille disparaît, la charge reste dépensée (2/3)
  await page.getByRole('button', { name: 'Rompre la rage' }).click();
  await expect(page.locator('[title="Rage en cours"]')).toHaveCount(0);
  await expect(page.getByText(/2\s*\/\s*3/).first()).toBeVisible();

  // Nettoyage : l'état retombe (les specs suivantes partagent la base)
  await page.request.patch(`/api/characters/${cid}`, { data: { raging: false }, headers: auth });
});
