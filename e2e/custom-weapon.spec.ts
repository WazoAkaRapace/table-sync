/**
 * Armes personnalisées complètes (plan 2026-11, task 11) — le panneau Arme
 * partagé du créateur d'objet : aperçu live, création joueur (rendu chiffré
 * par le moteur sur le personnage seedé), création + édition MD (aperçu
 * symbolique — FOR reste une lettre, aucun porteur).
 *
 * Le seed laisse « les joueurs peuvent créer des objets » FERMÉ : la spec
 * l'ouvre par API au nom du MD (le kill switch reste au tableau MD).
 * Score FOR du guerrier seedé (global-setup.ts) : 16 → modificateur +3 —
 * « 4d6+FOR+2 » rend « 4d6+5 » (le bonus magique explicite d'un template à
 * mot-clé vaut l'attaque, il ne double-passe pas dans les dégâts).
 */

import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, openTab, playerTest, seed, sheetUrl } from './fixtures';

const PLAYER_NAME = 'Lame du cocheur de géants';
const GM_NAME = 'Fléau du planteur de pieux';

/** Déploie un groupe de catégories replié de l'inventaire (même idiom que
 *  inventory.spec.ts : « ▼Arme(3)… kg »). */
async function expandCategory(page: Page, label: string) {
  const header = page
    .locator('button[aria-expanded="false"]')
    .filter({ hasText: new RegExp(`${label}\\s*\\(\\s*\\d+\\s*\\)`) })
    .first();
  await header.click();
}

/** Recherche un objet custom du groupe par son nom (état servi, pas l'UI). */
async function fetchCustomItem(name: string, token: string) {
  const res = await fetch(
    `${API_BASE}/api/items?search=${encodeURIComponent(name)}&source=custom&partyId=${seed().partyId}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) throw new Error(`fetchCustomItem « ${name} » → ${res.status}`);
  const { items } = (await res.json()) as { items: any[] };
  const hit = items.find((i) => i.name === name);
  if (!hit) throw new Error(`« ${name} » introuvable dans les objets custom`);
  return hit;
}

playerTest.describe('Arme personnalisée (joueur)', () => {
  playerTest.beforeAll(async () => {
    const res = await fetch(`${API_BASE}/api/parties/${seed().partyId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${seed().gm.token}`,
      },
      body: JSON.stringify({ playersCreateItems: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`playersCreateItems: ${res.status}`);
  });

  playerTest('création complète : aperçu chiffré, puis puces de fiche', async ({ page }) => {
    await page.goto(sheetUrl(seed().guerrier.id));
    await expect(page.getByText(seed().guerrier.name).first()).toBeVisible();
    await openTab(page, 'Inventaire');
    await expect(page.getByRole('button', { name: /Bourse/ })).toBeVisible();

    // Créateur d'objet : FAB catalogue → recherche infructueuse → CTA créer.
    await page.getByRole('button', { name: 'Ajouter un objet au catalogue' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('Rechercher un objet…').fill(PLAYER_NAME);
    await sheet.getByRole('button', { name: `+ Créer « ${PLAYER_NAME} »` }).click();

    // Le modal du créateur prend la relais de la feuille catalogue.
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Catégorie').selectOption('weapon');

    // « Basée sur » pré-remplit les dés SRD — tout reste éditable (D2).
    await modal.getByLabel('Basée sur').selectOption({ label: 'Épée à deux mains' });
    const diceInput = modal.getByLabel('Dégâts (dés, FOR, DEX ou magie)');
    await expect(diceInput).toHaveValue('2d6');
    await diceInput.fill('4d6+FOR+2');
    await modal.getByRole('button', { name: '+2', exact: true }).click();

    // Aperçu live AVANT soumission : FOR 16 → +3, template 4d6+FOR+2 → 4d6+5
    // (le bonus +2 vaut l'attaque : puce or à part).
    await expect(modal).toContainText('4d6+5 · tranchants');
    // puce magique : le glyphe ✨ est un SVG, on cible la puce par son texte
    await expect(modal.locator('span.inline-flex').filter({ hasText: '+2' })).toBeVisible();
    await page.screenshot({ path: 'e2e/.captures/custom-weapon-joueur.png' });

    await modal.getByRole('button', { name: 'Créer et ajouter' }).click();

    // L'arme atterrit dans le sac : la ligne déployée rend les puces moteur.
    await expandCategory(page, 'Arme');
    const rowButton = page.getByRole('button', { name: `${PLAYER_NAME}, 1 exemplaire` });
    await rowButton.click();
    const row = page.getByRole('listitem').filter({ has: rowButton });
    await expect(row).toContainText('4d6+5');

    // Vérification par l'état servi : les champs d'arme sont bien partis.
    const item = await fetchCustomItem(PLAYER_NAME, seed().player.token);
    expect(item.damageDice).toBe('4d6+FOR+2');
    expect(item.damageType).toBe('Slashing');
    expect(item.magicBonus).toBe(2);
    expect(item.baseWeapon).toBe('Greatsword');
    expect(item.properties).toEqual(['heavy', 'two-handed']);
  });
});

gmTest.describe('Arme personnalisée (MD)', () => {
  gmTest('création symbolique, erreur inline, puis édition PATCH hydratée', async ({ page }) => {
    await page.goto(`/party/${seed().partyId}/gm`);
    await page.getByRole('button', { name: 'Objets custom' }).click();
    await page.getByRole('button', { name: '+ Ajouter' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByLabel('Nom *').fill(GM_NAME);
    await modal.getByLabel('Catégorie').selectOption('weapon');

    // Épée longue : polyvalente — le champ dés 2M se révèle, prérempli (1d10).
    await modal.getByLabel('Basée sur').selectOption({ label: 'Épée longue' });
    const diceInput = modal.getByLabel('Dégâts (dés, FOR, DEX ou magie)');
    await expect(diceInput).toHaveValue('1d8');
    await expect(modal.getByLabel('Dés à deux mains')).toHaveValue('1d10');
    await diceInput.fill('4d6+FOR+2');

    // Aperçu SYMBOLIQUE : sans porteur, FOR reste une lettre.
    await expect(modal).toContainText('4d6+FOR+2 · tranchants');
    await expect(modal).toContainText('1d10 · deux mains');
    await page.screenshot({ path: 'e2e/.captures/custom-weapon-md.png' });

    // Template invalide → erreur inline orange, l'aperçu s'efface.
    await diceInput.fill('4d6+FOO');
    await expect(modal.getByText('Modèle de dégâts invalide')).toBeVisible();
    await diceInput.fill('4d6+FOR+2');

    await modal.getByRole('button', { name: '+ Ajouter au catalogue' }).click();
    await expect(page.getByText(GM_NAME)).toBeVisible();

    // Édition : le panneau repart de l'état réel de l'item (hydratation),
    // la soumission PATCH les champs d'arme.
    const row = page.getByRole('listitem').filter({ hasText: GM_NAME });
    await row.getByRole('button', { name: 'Modifier' }).click();
    await expect(modal.getByLabel('Dégâts (dés, FOR, DEX ou magie)')).toHaveValue('4d6+FOR+2');
    await expect(modal.getByLabel('Dés à deux mains')).toHaveValue('1d10');
    await modal.getByLabel('Dégâts (dés, FOR, DEX ou magie)').fill('3d6+FOR');
    await modal.getByRole('button', { name: '+1', exact: true }).click();
    await modal.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(modal).toBeHidden();

    // Vérification par l'état servi : le PATCH a re-écrit les champs d'arme.
    const item = await fetchCustomItem(GM_NAME, seed().gm.token);
    expect(item.damageDice).toBe('3d6+FOR');
    expect(item.magicBonus).toBe(1);
    expect(item.twoHandedDice).toBe('1d10');
    expect(item.baseWeapon).toBe('Longsword');
    expect(item.properties).toEqual(['versatile']);
  });
});
