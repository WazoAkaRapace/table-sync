/**
 * Effets de sort sur la CA (v1) — Task 5 du plan effets-sort-ca-v1.
 *
 * 1. Mira (clerce) lance Bouclier de la foi depuis la feuille d'incantation :
 *    l'annonce or « CA 16 → 18 (+2) » précède le lancer, puis le bandeau
 *    porte la tuile CA liserée or et la chip « +2 · Bouclier de la foi ».
 *    Poser Neutralisé (condition brisante — CONCENTRATION_BREAKING_CONDITIONS_FR)
 *    via le picker d'états de l'onglet Survie rompt la concentration : la
 *    concentration et les effets tombent, la CA revient à sa valeur nue.
 * 2. Armure de mage (13 + DEX) sur Mira dont la CA d'équipement est déjà
 *    ≥ 13 + DEX : la chip est posée mais la CA ne bouge pas (max, pas de
 *    somme) — l'annonce « reste 16 » le dit dès la feuille de lancer.
 * 3. La CA manuelle GAGNE : avec un override posé, la chip reste visible
 *    mais la tuile affiche la CA manuelle et l'avertissement orange règle.
 *
 * Chromium seulement, pas de @smoke : la spec mute le seed (sorts de Mira,
 * effet actif, conditions, override manuel).
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { openTab, playerTest, seed, sheetUrl } from './fixtures';

/** PATCH authentifié joueuse sur un personnage du seed. */
async function patchCharacter(charId: number, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/characters/${charId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${seed().player.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`E2E : PATCH personnage ${charId} → ${res.status}`);
}

/** Ouvre la feuille d'incantation d'un sort connu et la confirme. */
async function openCastSheet(page: import('playwright/test').Page, spellName: string) {
  // #187 : l'onglet Sorts démarre sur « Préparés » — un sort non préparé
  // (Armure de mage) est masqué ; rebasculer sur « Tous » pour le voir.
  await page.getByRole('button', { name: 'Tous', exact: true }).click();
  await page.getByRole('button', { name: `Lancer ${spellName}` }).click();
  const sheet = page.getByRole('dialog', { name: `Lancer ${spellName}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

playerTest.describe('Effets de sort sur la CA', () => {
  playerTest.beforeEach(async ({ page }) => {
    await page.goto(sheetUrl(seed().clerc.id));
    await expect(page.getByText(seed().clerc.name).first()).toBeVisible();
    // Point de départ propre, QUEL QUE SOIT l'état laissé par un run ou une
    // retry précédente (effet actif, concentration, conditions, override) :
    // lever les effets actifs par l'API (la table garde l'historique inactif),
    // puis réarmer la fiche de Mira comme au seed.
    const effects = await fetch(`${API_BASE}/api/characters/${seed().clerc.id}/spell-effects`, {
      headers: { authorization: `Bearer ${seed().player.token}` },
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.json() as Promise<{ effects: { id: number }[] }>);
    for (const e of effects.effects ?? []) {
      const res = await fetch(`${API_BASE}/api/spell-effects/${e.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${seed().player.token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`E2E : DELETE spell-effect ${e.id} → ${res.status}`);
    }
    await patchCharacter(seed().clerc.id, {
      conditions: [],
      armorClassOverride: null,
      concentrating: false,
      spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    // Sorts est un onglet du dock pour les lanceurs de sorts (fiche ouverte
    // sur Survie par défaut).
    await openTab(page, 'Sorts');
    await expect(page.getByRole('heading', { name: 'Emplacements de sort' })).toBeVisible();
  });

  // La spec consomme des emplacements et laisse un effet Armure de mage actif :
  // rendre la fiche de Mira au seed pour les specs suivantes (spells.spec.ts
  // compte sur 4/4 emplacements de niveau 1 — ordre alphabétique des fichiers).
  playerTest.afterEach(async () => {
    const effects = await fetch(`${API_BASE}/api/characters/${seed().clerc.id}/spell-effects`, {
      headers: { authorization: `Bearer ${seed().player.token}` },
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.json() as Promise<{ effects: { id: number }[] }>);
    for (const e of effects.effects ?? []) {
      await fetch(`${API_BASE}/api/spell-effects/${e.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${seed().player.token}` },
        signal: AbortSignal.timeout(5000),
      }).then((r) => {
        if (!r.ok) throw new Error(`E2E : DELETE spell-effect ${e.id} → ${r.status}`);
      });
    }
    await patchCharacter(seed().clerc.id, {
      conditions: [],
      armorClassOverride: null,
      concentrating: false,
      spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });

  playerTest(
    'Bouclier de la foi : annonce, chip or, CA +2 puis rupture par condition',
    async ({ page }) => {
      // CA nue de Mira (Cotte d'écailles + Bouclier + DEX +0) : 14 + 2 = 16.
      const acTile = page.getByRole('button', {
        name: /Classe d'armure 16 — ouvrir les/,
      });
      await expect(acTile).toBeVisible();

      // — Lancer : l'annonce or « CA 16 → 18 (+2) » précède la consommation —
      const sheet = await openCastSheet(page, 'Bouclier de la foi');
      await expect(sheet.getByText('CA 16 → 18 (+2)')).toBeVisible();
      await sheet.getByRole('button', { name: '🪄 Lancer au niveau 1' }).click();
      await expect(sheet).toBeHidden();

      // — Bandeau : tuile CA 18 liserée or + chip de l'effet actif —
      await expect(
        page.getByRole('button', { name: /Classe d'armure 18 — ouvrir les/ }),
      ).toBeVisible();
      await expect(page.getByText('+2 · Bouclier de la foi')).toBeVisible();

      // — Rupture par condition brisante : Neutralisé via le picker d'états —
      await openTab(page, 'Survie');
      await page.getByRole('button', { name: '🎭 Ajouter un état' }).click();
      await page.getByRole('button', { name: /^Neutralisé/ }).click();
      // Toast règle : la concentration est rompue, le sort interrompu…
      await expect(
        page.getByText('Concentration rompue : Neutralisé — le sort en cours est interrompu'),
      ).toBeVisible();

      // — Les effets tombent, la CA revient à sa valeur nue —
      await expect(
        page.getByRole('button', { name: /Classe d'armure 16 — ouvrir les/ }),
      ).toBeVisible();
      await expect(page.getByText('+2 · Bouclier de la foi')).toBeHidden();
    },
  );

  playerTest('Armure de mage sur CA déjà couverte : chip posée, CA inchangée', async ({ page }) => {
    // CA d'équipement 16 ≥ 13 + DEX (14) : le set 13+DEX ne monte rien.
    const sheet = await openCastSheet(page, 'Armure de mage');
    // Annonce « plate » : la CA ne bouge pas mais l'effet se pose quand même.
    await expect(sheet.getByText('CA 16 — reste 16 (13 + DEX déjà atteint)')).toBeVisible();
    await sheet.getByRole('button', { name: '🪄 Lancer au niveau 1' }).click();
    await expect(sheet).toBeHidden();

    // La chip est là, la tuile ne bouge pas : 16 avant comme après.
    await expect(page.getByText('13 + DEX · Armure de mage')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Classe d'armure 16 — ouvrir les/ }),
    ).toBeVisible();

    // — La CA manuelle GAGNE : chips visibles, contribution non appliquée —
    // Le PATCH part du contexte Node (pas du navigateur) : la fiche ne suit
    // que par l'événement WS character:change. Attendre « Synchronisé » ET
    // dépasser la fenêtre anti-écho de 2 s (useOwnEchoGuard : mon PATCH de
    // lancer vient de tamponner — l'événement d'un PATCH du MÊME utilisateur
    // dans les 2 s serait avalé comme propre écho, fiche figée).
    await expect(page.getByLabel('Synchronisé').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2200);
    await patchCharacter(seed().clerc.id, { armorClassOverride: 15 });
    await expect(
      page.getByRole('button', { name: /Classe d'armure 15 — ouvrir les/ }),
    ).toBeVisible();
    await expect(page.getByText('13 + DEX · Armure de mage')).toBeVisible();
    await expect(page.getByText('CA manuelle — effet non appliqué')).toBeVisible();
  });
});
