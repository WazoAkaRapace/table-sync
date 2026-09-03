/**
 * Inventaire du guerrier (Kael) — charge de la fiche, puces de dégâts
 * calculées par le moteur de règles partagé, et pipeline
 * mutation react-query → invalidation → refetch via le bouton quantité +.
 */

import type { Page } from 'playwright/test';
import { expect } from 'playwright/test';
import { openTab, playerTest, seed, sheetUrl } from './fixtures';

/** Déploie un groupe de catégories replié de l'inventaire (en-têtes sans espaces : « ▼Arme(3)… kg »). */
async function expandCategory(page: Page, label: string) {
  const header = page
    .locator('button[aria-expanded="false"]')
    .filter({ hasText: new RegExp(`${label}\\s*\\(\\s*\\d+\\s*\\)`) })
    .first();
  await header.click();
}

playerTest.describe('Inventaire (guerrier)', () => {
  playerTest.beforeEach(async ({ page }) => {
    await page.goto(sheetUrl(seed().guerrier.id));
    await expect(page.getByText(seed().guerrier.name).first()).toBeVisible();
    await openTab(page, 'Inventaire');
    // L'onglet est monté quand la bourse (en tête d'inventaire) apparaît.
    await expect(page.getByRole('button', { name: /Bourse/ })).toBeVisible();
  });

  playerTest('la bourse affiche l’or du personnage', async ({ page }) => {
    // Seed : 31 PO pour Kael.
    await expect(page.getByRole('button', { name: /Bourse \(31 PO/ })).toBeVisible();
  });

  playerTest('la bourse encaisse, dépense et rend la monnaie', async ({ page }) => {
    // Départ : 31 PO (laissé par le test précédent). Le parcours du changeur :
    // encaisser, dépenser avec casse de pièce, fonds insuffisants.
    const bourseCard = page.locator('[data-tuto="inv-bourse"]');
    const modal = page.getByRole('dialog');

    // On déploie la carte une bonne fois — elle reste ouverte entre les passages.
    await bourseCard.getByRole('button', { name: /Bourse \(/ }).click();

    // --- Encaisser 2 PO : 31 → 33 PO ---
    await bourseCard.getByRole('button', { name: '＋ Encaisser' }).click();
    await modal.getByLabel('Quantité de PO').fill('2');
    await modal.getByRole('button', { name: 'Encaisser 2 PO' }).click();
    await expect(page.getByRole('button', { name: /Bourse \(33 PO/ })).toBeVisible();

    // --- Dépenser 5 PA sans menue monnaie : 1 PO cassée en 10 PA ---
    await bourseCard.getByRole('button', { name: '− Dépenser' }).click();
    await modal.getByLabel('Quantité de PA').fill('5');
    // Le grand livre montre la bourse réelle, pas une conversion canonique.
    await expect(modal.getByText('32 PO · 5 PA')).toBeVisible();
    await expect(modal.getByText(/1 PO cassée en 10 PA/)).toBeVisible();
    await modal.getByRole('button', { name: 'Dépenser 5 PA' }).click();
    await expect(page.getByRole('button', { name: /Bourse \(32 PO/ })).toBeVisible();

    // --- Fonds insuffisants : le manque s'affiche, le CTA se verrouille ---
    await bourseCard.getByRole('button', { name: '− Dépenser' }).click();
    await modal.getByLabel('Quantité de PP').fill('999');
    await expect(modal.getByText(/Il manque/)).toBeVisible();
    await expect(modal.getByRole('button', { name: /^Dépenser/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // --- Corriger : remet la bourse au seed (31 PO) pour les specs suivantes ---
    await bourseCard.getByRole('button', { name: '− Dépenser' }).click();
    await modal.getByRole('button', { name: /✎ Corriger/ }).click();
    await expect(modal.getByLabel('Quantité de PO')).toHaveValue('32'); // draft pré-rempli
    await modal.getByLabel('Quantité de PA').fill('0');
    await modal.getByLabel('Quantité de PO').fill('31');
    await modal.getByRole('button', { name: 'Corriger la bourse' }).click();
    await expect(page.getByRole('button', { name: /Bourse \(31 PO/ })).toBeVisible();
  });

  playerTest('une arme déploie ses dégâts calculés (FOR 16 → 1d8+3)', async ({ page }) => {
    await expandCategory(page, 'Arme');
    const rowButton = page.getByRole('button', { name: 'Épée longue, 1 exemplaire' });
    await rowButton.click(); // déploie description + puces 🎯 ⚔
    // Les puces vivent dans le panneau déplié (frère du bouton, même <li>).
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Épée longue, 1 exemplaire' }) });
    await expect(row).toContainText('1d8+3');
  });

  playerTest('le bouton + incrémente la quantité côté serveur', async ({ page }) => {
    await expandCategory(page, 'Objet magique');
    await expect(
      page.getByRole('button', { name: /Potion de soin, \d+ exemplaires/ }),
    ).toBeVisible();

    // Valeur de départ lue dans l'UI (retry-safe : la ligne repart de l'état
    // laissé par la tentative précédente).
    const qtyInput = page.getByLabel('Quantité de Potion de soin').filter({ visible: true });
    const before = Number(await qtyInput.inputValue());

    // Le stepper existe en double dans le DOM (mobile + desktop masqué) —
    // on ne clique que l'instance visible au viewport 390.
    const plus = page
      .getByRole('button', { name: 'Augmenter Potion de soin' })
      .filter({ visible: true });
    await plus.click();

    // Le champ ne repasse par la valeur servie qu'après le PATCH →
    // invalidation → refetch : preuve du aller-retour, pas d'un état local.
    await expect(qtyInput).toHaveValue(String(before + 1));
  });
});
