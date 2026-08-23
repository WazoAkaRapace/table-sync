/**
 * Objets-illustrations : glyphe 🗺 et indice « illustré » au replié, vignette
 * en châssis montée À L'OUVERTURE (l'octet arrive de GET /api/items/:id/image),
 * visionneuse plein écran (role=dialog) refermée par ✕ — puis le flux MD :
 * création d'objet avec illustration stagée → PUT multipart à l'enregistrement.
 *
 * Le seed joint la « Lettre du duc » illustrée au sac de Kael.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright/test';
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, openTab, playerTest, seed, sheetUrl } from './fixtures';

// 1×1 JPEG RÉEL (encodé PIL, données de scan incluses) — le navigateur doit
// pouvoir le DÉCODER : un JPEG réduit à ses octets d'en-tête (voire tronqué)
// passe le contrôle magic-bytes du serveur mais fire img.onerror côté browser.
const REAL_1X1_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
  'base64',
);

/** Déplie le groupe « Personnalisé (1) » de l'inventaire (en-têtes repliés). */
async function expandCustomGroup(page: Page) {
  const header = page
    .locator('button[aria-expanded="false"]')
    .filter({ hasText: /Personnalisé\s*\(\s*1\s*\)/ })
    .first();
  await header.click();
}

/** La ligne d'inventaire de la lettre, groupe déjà déplié. */
function lettreRow(page: Page) {
  return page.getByRole('listitem').filter({ hasText: 'Lettre du duc' }).first();
}

playerTest.describe('Objets-illustrations (joueur)', () => {
  playerTest.beforeEach(async ({ page }) => {
    await page.goto(sheetUrl(seed().guerrier.id));
    await expect(page.getByText(seed().guerrier.name).first()).toBeVisible();
    await openTab(page, 'Inventaire');
    await expect(page.getByRole('button', { name: /Bourse \(31 PO/ })).toBeVisible();
    await expandCustomGroup(page);
  });

  playerTest('la ligne repliée porte le glyphe 🗺 et l’indice « illustré »', async ({ page }) => {
    const rowButton = page.getByRole('button', {
      name: 'Lettre du duc, 1 exemplaire, illustré',
    });
    await expect(rowButton).toBeVisible();
    await expect(rowButton.getByTitle('Illustration — touche la ligne pour la voir')).toBeVisible();
  });

  playerTest('déplier monte la vignette en châssis, image chargée', async ({ page }) => {
    await lettreRow(page)
      .getByRole('button', { name: 'Lettre du duc, 1 exemplaire, illustré' })
      .click();
    const chassis = page.getByRole('button', {
      name: "Agrandir l'illustration de Lettre du duc",
    });
    await expect(chassis).toBeVisible();
    // La pastille 🔍 ne s'affiche qu'une fois l'octet arrivé (onLoad) —
    // preuve du chargement réel depuis l'API, pas d'un plateau vide.
    await expect(chassis.getByText('🔍')).toBeVisible();
    await expect(chassis.locator('img')).toHaveJSProperty('naturalWidth', 1);
  });

  playerTest('la tape ouvre la visionneuse plein écran, ✕ la referme', async ({ page }) => {
    await lettreRow(page)
      .getByRole('button', { name: 'Lettre du duc, 1 exemplaire, illustré' })
      .click();
    await page.getByRole('button', { name: "Agrandir l'illustration de Lettre du duc" }).click();

    const dialog = page.getByRole('dialog', { name: 'Illustration — Lettre du duc' });
    await expect(dialog).toBeVisible();
    // Même URL que la vignette → hit de cache : l'image est là immédiatement.
    await expect(dialog.locator('img')).toHaveJSProperty('naturalWidth', 1);

    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Le focus revient au châssis d'origine (contrat overlay maison).
    await expect(
      page.getByRole('button', { name: "Agrandir l'illustration de Lettre du duc" }),
    ).toBeFocused();
  });
});

gmTest.describe('Objets-illustrations (MD)', () => {
  gmTest(
    'créer un objet avec illustration : stagée au choix, envoyée au save',
    async ({ page }) => {
      await page.goto(`/party/${seed().partyId}/gm`);
      await page.getByRole('button', { name: 'Objets custom' }).click();
      await page.getByRole('button', { name: '+ Ajouter' }).click();

      await page.getByLabel('Nom *').fill('Carte au trésor');
      // L'illustration passe par le champ partagé (downscale canvas côté MD).
      const jpegPath = path.join(tmpdir(), 'e2e-carte-au-tresor.jpg');
      writeFileSync(jpegPath, REAL_1X1_JPEG);
      await page.setInputFiles('input[type="file"]', jpegPath);

      // Aperçu châssis + ligne mono : la réduction a opéré, rien n'est encore
      // envoyé (l'objet n'existe pas — le PUT ne peut pas avoir eu lieu).
      const modal = page.getByRole('dialog');
      await expect(modal.getByText('JPEG · 1 × 1 · 1 ko')).toBeVisible();

      await page.getByRole('button', { name: '+ Ajouter au catalogue' }).click();

      // La liste MD montre le mini-châssis 40px → l'image a bien été envoyée.
      await expect(
        page.getByRole('button', { name: "Agrandir l'illustration de Carte au trésor" }),
      ).toBeVisible();

      // Vérification par l'état servi (pas seulement l'UI) : hasImage dans le
      // payload catalogue, et l'octet servi par la route token'ée.
      const res = await fetch(
        `${API_BASE}/api/items?search=${encodeURIComponent('Carte au trésor')}&source=custom`,
        {
          headers: { authorization: `Bearer ${seed().gm.token}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      const body = await res.json();
      const created = body.items.find((i: { name: string }) => i.name === 'Carte au trésor');
      expect(created?.hasImage).toBe(true);
      const img = await fetch(`${API_BASE}/api/items/${created.id}/image?token=${seed().gm.token}`);
      expect(img.ok).toBe(true);
      expect(img.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    },
  );
});
