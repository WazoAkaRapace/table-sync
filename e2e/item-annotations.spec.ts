/**
 * Annotations d'exemplaires : depuis la visionneuse ouverte sur SA fiche, le
 * joueur dessine un trait, pose un texte, enregistre — la ligne devient un
 * objet dérivé (l'image de base ne change jamais d'un octet). L'exemplaire
 * annoté survit ensuite au transfert vers un autre personnage.
 *
 * Autonome par rapport au seed : la spec crée SON personnage (Rook, propriété
 * de la joueuse) et SON objet illustré (« Croquis annotable ») au runtime —
 * la « Lettre du duc » de Kael reste l'apanage de item-images.spec.ts, qui
 * tourne après celle-ci (ordre alphabétique, état partagé).
 */

import type { Page } from 'playwright/test';
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, openTab, playerTest, seed, sheetUrl } from './fixtures';

// 1×1 JPEG RÉEL (encodé PIL, données de scan incluses) — le navigateur doit
// pouvoir le DÉCODER (constante partagée avec item-images.spec.ts).
const REAL_1X1_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
  'base64',
);

// ---------------------------------------------------------------------------
// Campagne dédiée (lazy, une fois par worker) : Rook + croquis illustré
// ---------------------------------------------------------------------------

let campaign: { rookId: number; croquisId: number } | null = null;

async function setupCampaign(): Promise<{ rookId: number; croquisId: number }> {
  if (campaign) return campaign;
  const { partyId, gm, player } = seed();

  const charRes = await fetch(`${API_BASE}/api/parties/${partyId}/characters`, {
    method: 'POST',
    headers: { authorization: `Bearer ${player.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Rook Marchecombe',
      characterClass: 'Rôdeur',
      level: 3,
      race: 'Half-elfe',
    }),
    signal: AbortSignal.timeout(5000),
  });
  expect(charRes.ok, `création Rook → ${charRes.status}`).toBe(true);
  const rookId = (await charRes.json()).character.id;

  const itemRes = await fetch(`${API_BASE}/api/parties/${partyId}/items`, {
    method: 'POST',
    headers: { authorization: `Bearer ${gm.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Croquis annotable',
      description: 'Un plan de campagne à annoter',
    }),
    signal: AbortSignal.timeout(5000),
  });
  expect(itemRes.ok, `création croquis → ${itemRes.status}`).toBe(true);
  const croquisId = (await itemRes.json()).item.id;

  const form = new FormData();
  form.append('image', new Blob([REAL_1X1_JPEG], { type: 'image/jpeg' }), 'illustration.jpg');
  const put = await fetch(`${API_BASE}/api/items/${croquisId}/image`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${gm.token}` },
    body: form,
    signal: AbortSignal.timeout(5000),
  });
  expect(put.ok, `illustration croquis → ${put.status}`).toBe(true);

  const add = await fetch(`${API_BASE}/api/characters/${rookId}/inventory`, {
    method: 'POST',
    headers: { authorization: `Bearer ${player.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: croquisId, quantity: 1 }),
    signal: AbortSignal.timeout(5000),
  });
  expect(add.ok, `croquis ajouté à Rook → ${add.status}`).toBe(true);

  campaign = { rookId, croquisId };
  return campaign;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Déplie le groupe « Personnalisé (n) » de l'inventaire (en-têtes repliés). */
async function expandCustomGroup(page: Page) {
  const header = page
    .locator('button[aria-expanded="false"]')
    .filter({ hasText: /Personnalisé\s*\(\s*\d+\s*\)/ })
    .first();
  await header.click();
}

/** La ligne d'inventaire du croquis, groupe déjà déplié. */
function croquisRow(page: Page) {
  return page.getByRole('listitem').filter({ hasText: 'Croquis annotable' }).first();
}

/** Ouvre la visionneuse depuis la vignette du croquis (ligne dépliée). */
async function openCroquisViewer(page: Page) {
  await croquisRow(page)
    .getByRole('button', { name: 'Croquis annotable, 1 exemplaire, illustré' })
    .click();
  await page.getByRole('button', { name: "Agrandir l'illustration de Croquis annotable" }).click();
  const dialog = page.getByRole('dialog', { name: 'Illustration — Croquis annotable' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveJSProperty('naturalWidth', 1);
  return dialog;
}

/** GET authentifié (JSON) contre l'API e2e. */
async function getJson(path: string, token: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  expect(res.ok, `GET ${path} → ${res.status}`).toBe(true);
  return res.json();
}

/** GET de l'octet servi d'une illustration (route token'ée). */
async function getImageBytes(itemId: number, token: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/api/items/${itemId}/image?token=${token}`, {
    signal: AbortSignal.timeout(5000),
  });
  expect(res.ok, `GET image ${itemId} → ${res.status}`).toBe(true);
  return Buffer.from(await res.arrayBuffer());
}

playerTest.describe('Annotations (joueuse)', () => {
  let rookId = 0;
  let croquisId = 0;

  playerTest.beforeEach(async ({ page }) => {
    ({ rookId, croquisId } = await setupCampaign());
    await page.goto(sheetUrl(rookId));
    await expect(page.getByText('Rook Marchecombe').first()).toBeVisible();
    await openTab(page, 'Inventaire');
    await expandCustomGroup(page);
  });

  playerTest('dessiner + écrire + enregistrer : la ligne devient un dérivé', async ({ page }) => {
    const baseBefore = await getImageBytes(croquisId, seed().player.token);

    const dialog = await openCroquisViewer(page);
    // Barre d'outils présente (ligne éditable), tous les outils au rendez-vous.
    for (const label of ['Naviguer', 'Dessiner', 'Écrire', 'Annuler la dernière annotation']) {
      await expect(dialog.getByRole('button', { name: label })).toBeVisible();
    }
    // Rien à enregistrer tant qu'il n'y a pas d'annotation.
    await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    // ✏️ un trait au centre de l'image (souris = pointer events unifiés).
    await dialog.getByRole('button', { name: 'Dessiner' }).click();
    const box = await dialog.locator('img').boundingBox();
    expect(box, 'image bounding box').not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();

    // T un texte posé au point tapé.
    await dialog.getByRole('button', { name: 'Écrire' }).click();
    await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.3);
    const input = dialog.getByLabel('Texte de la note');
    await expect(input).toBeFocused();
    await input.fill('Ici !');
    await input.press('Enter');
    await expect(dialog.getByText('Ici !')).toBeVisible();

    // Enregistrer : POST composite → visionneuse refermée, ligne re-rendue.
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: "Agrandir l'illustration de Croquis annotable" }),
    ).toBeVisible();

    // Vérification par l'état servi : la ligne pointe un dérivé de la base.
    const inv = await getJson(`/api/characters/${rookId}/inventory`, seed().player.token);
    const entry = inv.entries.find(
      (e: { item: { name: string } }) => e.item.name === 'Croquis annotable',
    );
    expect(entry?.item?.derivedFromItemId).toBe(croquisId);
    // … et l'image de BASE n'a pas bougé d'un octet.
    const baseAfter = await getImageBytes(croquisId, seed().player.token);
    expect(baseAfter.equals(baseBefore)).toBe(true);
  });

  playerTest('annuler et effacer vident la session, fermer protège', async ({ page }) => {
    const dialog = await openCroquisViewer(page);
    const box = await dialog.locator('img').boundingBox();
    const save = dialog.getByRole('button', { name: 'Enregistrer' });

    await dialog.getByRole('button', { name: 'Dessiner' }).click();
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await expect(save).toBeEnabled();

    // ↩︎ annule le dernier trait → plus rien à enregistrer.
    await dialog.getByRole('button', { name: 'Annuler la dernière annotation' }).click();
    await expect(save).toBeDisabled();

    // 🗑 deux temps (ConfirmButton) : armé puis confirmé.
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.6, { steps: 6 });
    await page.mouse.up();
    await expect(save).toBeEnabled();
    const clear = dialog.getByRole('button', { name: 'Effacer les annotations' });
    await clear.click();
    await expect(clear).toHaveText(/Effacer \?/);
    await clear.click();
    await expect(save).toBeDisabled();

    // Fermer avec du non-enregistré → garde-fou, jamais de perte silencieuse.
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.4, { steps: 6 });
    await page.mouse.up();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(dialog.getByText('Annotations non enregistrées')).toBeVisible();
    await dialog.getByRole('button', { name: 'rester' }).click();
    await expect(dialog.getByText('Annotations non enregistrées')).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  playerTest("l'exemplaire annoté survit au transfert vers Mira", async ({ page }) => {
    // L'état annoté provient du premier test (même base e2e, ordre du fichier).
    const rookInv = await getJson(`/api/characters/${rookId}/inventory`, seed().player.token);
    const annotated = rookInv.entries.find(
      (e: { item: { derivedFromItemId: number | null } }) => e.item.derivedFromItemId === croquisId,
    );
    expect(annotated, 'croquis annoté chez Rook (test précédent)').toBeTruthy();
    const derivedId = annotated.itemId;
    const bytesBefore = await getImageBytes(derivedId, seed().player.token);

    // Transfert par l'API au nom du MD (porte propriétaire/MD du personnage source).
    const res = await fetch(`${API_BASE}/api/characters/${rookId}/transfer`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${seed().gm.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toCharacterId: seed().clerc.id,
        inventoryId: annotated.id,
        quantity: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    expect(res.ok, `transfert → ${res.status}`).toBe(true);

    // Chez Mira : la vignette sert l'image annotée, octet pour octet.
    await page.goto(sheetUrl(seed().clerc.id));
    await expect(page.getByText(seed().clerc.name).first()).toBeVisible();
    await openTab(page, 'Inventaire');
    await expandCustomGroup(page);
    await croquisRow(page)
      .getByRole('button', { name: 'Croquis annotable, 1 exemplaire, illustré' })
      .click();
    const chassis = page.getByRole('button', {
      name: "Agrandir l'illustration de Croquis annotable",
    });
    await expect(chassis).toBeVisible();
    await expect(chassis.getByText('🔍')).toBeVisible();

    const bytesAfter = await getImageBytes(derivedId, seed().gm.token);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
    // L'annoté diffère de la base (composite JPEG recomposé côté navigateur).
    const baseNow = await getImageBytes(croquisId, seed().player.token);
    expect(baseNow.equals(bytesBefore)).toBe(false);
  });
});

gmTest('le dashboard MD ouvre la visionneuse en lecture seule', async ({ page }) => {
  // L'objet custom de la lettre est listé côté MD : la vignette 40px ouvre la
  // visionneuse SANS barre d'outils (annoter = le joueur sur sa fiche).
  await page.goto(`/party/${seed().partyId}/gm`);
  await page.getByRole('button', { name: 'Objets custom' }).click();
  const mini = page
    .getByRole('button', { name: "Agrandir l'illustration de Lettre du duc" })
    .first();
  await expect(mini).toBeVisible();
  await mini.click();
  const dialog = page.getByRole('dialog', { name: 'Illustration — Lettre du duc' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(dialog.getByRole('button', { name: 'Dessiner' })).toHaveCount(0);
});
