/**
 * Armures personnalisées (plan contenus personnalisés 2026-11, PR1) — le
 * panneau Armure partagé du créateur d'objet : aperçu live chiffré sur le
 * personnage seedé (joueur) ou symbolique (MD), création puis équipement,
 * la CA calculée suit la famille explicite lue par computeAC.
 *
 * Le seed laisse « les joueurs peuvent créer des objets » FERMÉ : la spec
 * l'ouvre par API au nom du MD (le kill switch reste au tableau MD).
 * Porteuse : Vesper l'Occultiste (DEX 14 → modificateur +2, ni armure ni
 * bouclier — CA « sans armure » 12). Une intermédiaire CA 14 +1 magique
 * rend 14 + min(+2, 2) + 1 = 17.
 */

import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, openTab, playerTest, seed, sheetUrl } from './fixtures';

const PLAYER_ARMOR = "Cuirasse d'écailles du temple";
const GM_ARMOR = 'Égide du veilleur';

/** Déploie un groupe de catégories replié de l'inventaire (même idiom que
 *  custom-weapon.spec.ts : « ▼Arme(3)… kg »). */
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

playerTest.describe('Armure personnalisée (joueur)', () => {
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

  playerTest('création complète : aperçu chiffré, équipement, CA du bandeau', async ({ page }) => {
    await page.goto(sheetUrl(seed().occultiste.id));
    await expect(page.getByText(seed().occultiste.name).first()).toBeVisible();
    await openTab(page, 'Inventaire');
    await expect(page.getByRole('button', { name: /Bourse/ })).toBeVisible();

    // Créateur d'objet : FAB catalogue → recherche infructueuse → CTA créer.
    await page.getByRole('button', { name: 'Ajouter un objet au catalogue' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('Rechercher un objet…').fill(PLAYER_ARMOR);
    await sheet.getByRole('button', { name: `+ Créer « ${PLAYER_ARMOR} »` }).click();

    // Le modal du créateur prend la relais de la feuille catalogue.
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Catégorie').selectOption('armor');

    // Famille explicite : la chip informative enseigne la règle à la saisie.
    await modal.getByRole('button', { name: 'Intermédiaire', exact: true }).click();
    await expect(modal.getByText('ajoute DEX plafonné à +2')).toBeVisible();

    await modal.getByLabel('CA de base').fill('14');
    await modal.getByRole('button', { name: '+1', exact: true }).click();

    // Aperçu live AVANT soumission : DEX 14 → +2 capé, bonus magique +1
    // appliqué même avec une CA explicite → 14 + 2 + 1 = 17.
    await expect(modal.locator('span.inline-flex').filter({ hasText: '17' })).toBeVisible();
    await page.screenshot({ path: 'e2e/.captures/custom-armor-joueur.png' });

    await modal.getByRole('button', { name: 'Créer et ajouter' }).click();

    // L'armure atterrit dans le sac : la ligne déployée rend la CA calculée.
    await expandCategory(page, 'Armure');
    const rowButton = page.getByRole('button', { name: `${PLAYER_ARMOR}, 1 exemplaire` });
    await rowButton.click();
    const row = page.getByRole('listitem').filter({ has: rowButton });
    await expect(row.locator('span.inline-flex').filter({ hasText: '17' })).toBeVisible();

    // Équipement : la CA du bandeau d'état passe de 12 (sans armure) à 17.
    await row.getByRole('button', { name: `Équiper ${PLAYER_ARMOR}` }).click();
    await expect(page.getByRole('button', { name: /Classe d'armure 17/ })).toBeVisible();
    await page.screenshot({ path: 'e2e/.captures/custom-armor-equipee.png' });

    // Vérification par l'état servi : les champs d'armure sont bien partis.
    const item = await fetchCustomItem(PLAYER_ARMOR, seed().player.token);
    expect(item.armorFamily).toBe('medium');
    expect(item.acBase).toBe(14);
    expect(item.magicBonus).toBe(1);
    expect(item.stealthDisadvantage).toBe(false);

    // Remise en état : l'armure de spec repart du sac (le seed reste intact).
    await row.getByRole('button', { name: `Retirer ${PLAYER_ARMOR}` }).click();
  });
});

gmTest.describe('Armure personnalisée (MD)', () => {
  gmTest('création symbolique « Basée sur », puis édition PATCH hydratée', async ({ page }) => {
    await page.goto(`/party/${seed().partyId}/gm`);
    await page.getByRole('button', { name: 'Objets custom' }).click();
    await page.getByRole('button', { name: '+ Ajouter' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByLabel('Nom *').fill(GM_ARMOR);
    await modal.getByLabel('Catégorie').selectOption('armor');

    // « Basée sur » pré-remplit famille/CA/FOR min/malus — tout reste
    // éditable (D2). Harnois : lourde, CA 18, FOR min 15, discrétion.
    await modal.getByLabel('Basée sur').selectOption({ label: 'Harnois' });
    await expect(modal.getByRole('button', { name: 'Lourde', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(modal.getByLabel('CA de base')).toHaveValue('18');
    await expect(modal.getByLabel('Force minimale')).toHaveValue('15');
    await expect(modal.getByLabel('Malus de discrétion')).toBeChecked();

    // Surcharge : armure exotique « CA 17 lourde à base de 18 ».
    await modal.getByLabel('CA de base').fill('17');

    // Aperçu SYMBOLIQUE : sans porteur, « + DEX » reste en lettres.
    await expect(modal.locator('span.inline-flex').filter({ hasText: '17' })).toBeVisible();
    await expect(modal.getByText('CA fixe', { exact: false })).toBeVisible();
    await page.screenshot({ path: 'e2e/.captures/custom-armor-md.png' });

    await modal.getByRole('button', { name: '+ Ajouter au catalogue' }).click();
    await expect(page.getByText(GM_ARMOR).first()).toBeVisible();

    // Édition : le panneau repart de l'état réel de l'item (hydratation),
    // la soumission PATCH les champs d'armure.
    const row = page.getByRole('listitem').filter({ hasText: GM_ARMOR });
    await row.getByRole('button', { name: 'Modifier' }).click();
    await expect(modal.getByLabel('CA de base')).toHaveValue('17');
    await expect(modal.getByRole('button', { name: 'Lourde', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await modal.getByLabel('CA de base').fill('16');
    await modal.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(modal).toBeHidden();

    // Vérification par l'état servi : le PATCH a re-écrit les champs d'armure.
    const item = await fetchCustomItem(GM_ARMOR, seed().gm.token);
    expect(item.armorFamily).toBe('heavy');
    expect(item.acBase).toBe(16);
    expect(item.strMin).toBe(15);
    expect(item.stealthDisadvantage).toBe(true);
    expect(item.baseArmor).toBe('Plate Armor');
  });
});
