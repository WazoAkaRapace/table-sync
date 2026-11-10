/**
 * Effets de sort sur la CA — v2 ciblage (Task 4 du plan effets-sort-ca-v2).
 *
 * 1. Mira (clerc) lance Bouclier de la foi SUR Kael (guerrier seedé) via le
 *    picker de la feuille d'incantation (rangée Cible → BottomSheet →
 *    « Cibler Kael » → « Lancer sur Kael » → emplacement consommé) : la
 *    fiche de Kael porte CA +2 (20 → 22, tuile liserée or, mini-feuille
 *    « posé par Mira ») ; Mira garde SA CA nue et voit la chip
 *    « +2 · Bouclier de la foi → Kael Aubemarteau » plus la section
 *    « Posés sur autrui » de sa mini-feuille. Rompre la concentration de
 *    MIRA — Neutralisé, condition brisante de
 *    CONCENTRATION_BREAKING_CONDITIONS_FR, via le picker d'états de Survie —
 *    fait retomber la CA de Kael à 20 et disparaître les chips des DEUX
 *    fiches.
 * 2. « Autre » : label libre « Gobelin » → annonce sans chiffre
 *    « +2 · CA de Gobelin », chip lanceur pense-bête SANS impact CA,
 *    levée depuis la mini-feuille du lanceur.
 *
 * Chromium seulement, pas de @smoke : la spec mute le seed (effets posés
 * par Mira sur Kael ou « Autre », conditions, concentration) et réarme les
 * DEUX fiches en beforeEach/afterEach — rendu idempotent quel que soit
 * l'état laissé par un run ou une retry précédente.
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

/** Lève toutes les lignes d'effet ACTIVES d'un personnage (portées PAR lui
 *  ou castées PAR lui vers autrui/« Autre ») — la table garde l'historique
 *  inactif, seul l'actif gêne un re-run. */
async function deleteAllEffects(charId: number) {
  const effects = await fetch(`${API_BASE}/api/characters/${charId}/spell-effects`, {
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
}

/** Réarme une fiche comme au seed : effets levés, conditions/override/
 *  concentration neutres (emplacements réarmés pour la lanceuse seulement). */
async function resetCharacter(charId: number, withSlots: boolean) {
  await deleteAllEffects(charId);
  await patchCharacter(charId, {
    conditions: [],
    armorClassOverride: null,
    concentrating: false,
    ...(withSlots ? { spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0] } : {}),
  });
}

/** Ouvre la feuille d'incantation d'un sort connu et la confirme. */
async function openCastSheet(page: import('playwright/test').Page, spellName: string) {
  await page.getByRole('button', { name: `Lancer ${spellName}` }).click();
  const sheet = page.getByRole('dialog', { name: `Lancer ${spellName}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

playerTest.describe('Effets de sort sur la CA — ciblage v2', () => {
  playerTest.beforeEach(async ({ page }) => {
    // Point de départ propre pour les DEUX fiches mutées par la spec : la
    // cible (Kael) peut porter un effet posé par un run précédent, et Mira
    // peut être restée concentrée avec conditions/emplacements entamés.
    await resetCharacter(seed().clerc.id, true);
    await resetCharacter(seed().guerrier.id, false);
    await page.goto(sheetUrl(seed().clerc.id));
    await expect(page.getByText(seed().clerc.name).first()).toBeVisible();
    await openTab(page, 'Sorts');
    await expect(page.getByRole('heading', { name: 'Emplacements de sort' })).toBeVisible();
  });

  playerTest.afterEach(async () => {
    await resetCharacter(seed().clerc.id, true);
    await resetCharacter(seed().guerrier.id, false);
  });

  playerTest(
    'Bouclier de la foi de Mira sur Kael : CA +2 chez la cible, chips des deux fiches, rupture par la concentration du LANCEUR',
    async ({ page }) => {
      const kael = seed().guerrier;
      const mira = seed().clerc;

      // — Feuille d'incantation : « Moi » par défaut, annonce self —
      const sheet = await openCastSheet(page, 'Bouclier de la foi');
      await expect(sheet.getByText('CA 16 → 18 (+2)')).toBeVisible();

      // — Rangée Cible → picker : « Moi » épinglé, membres non cachés —
      await sheet
        .getByRole('button', {
          name: 'Cible de Bouclier de la foi : Moi — ouvrir la liste des cibles',
        })
        .click();
      const picker = page.getByRole('dialog', { name: 'Cible de Bouclier de la foi' });
      await expect(picker).toBeVisible();
      await picker
        .getByRole('button', { name: 'Cibler Kael Aubemarteau avec Bouclier de la foi' })
        .click();
      await expect(picker).toBeHidden();

      // — L'annonce suit la CIBLE : CA de Kael (harnois 18 + bouclier 2) —
      await expect(sheet.getByText('CA 20 → 22 (+2)')).toBeVisible();
      await sheet.getByRole('button', { name: 'Lancer sur Kael Aubemarteau' }).click();
      await expect(sheet).toBeHidden();

      // — Chez le LANCEUR : chip « → Kael » (title : formule + concentration),
      //    SA CA à elle ne bouge pas (l'effet vit sur la fiche de Kael) —
      await expect(page.getByText('+2 · Bouclier de la foi → Kael Aubemarteau')).toBeVisible();
      await expect(
        page.getByTitle(
          'Bouclier de la foi : +2 à la CA de Kael Aubemarteau — tenu par votre concentration',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Classe d'armure 16 — ouvrir les/ }),
      ).toBeVisible();

      // — Mini-feuille du lanceur : section « Posés sur autrui » —
      await page
        .getByRole('button', { name: /1 effet\(s\) de sort actif\(s\) sur la classe d'armure/ })
        .click();
      const casterSheet = page.getByRole('dialog', { name: 'Effets de sort sur la CA' });
      await expect(casterSheet.getByText('Posés sur autrui')).toBeVisible();
      await expect(casterSheet.getByText('Bouclier de la foi → Kael Aubemarteau')).toBeVisible();

      // — Fiche de Kael : CA 20 → 22, tuile liserée or, chip du porteur —
      await page.goto(sheetUrl(kael.id));
      await expect(page.getByText(kael.name).first()).toBeVisible();
      const kaelTile = page.getByRole('button', { name: /Classe d'armure 22 — ouvrir les/ });
      await expect(kaelTile).toBeVisible();
      await expect(kaelTile).toHaveClass(/border-gold-400/);
      await expect(page.getByText('+2 · Bouclier de la foi')).toBeVisible();

      // — Mini-feuille du porteur : l'effet est attribué « posé par Mira » —
      await page
        .getByRole('button', { name: /1 effet\(s\) de sort actif\(s\) sur la classe d'armure/ })
        .click();
      await expect(page.getByTitle(`Posé par ${mira.name}`)).toBeVisible();
      await expect(page.getByText(/posé par Mira Aubedouce/)).toBeVisible();

      // — Rupture : Neutralisé (condition brisante) sur MIRA, pas sur Kael —
      await page.goto(sheetUrl(mira.id));
      await expect(page.getByText(mira.name).first()).toBeVisible();
      await openTab(page, 'Survie');
      await page.getByRole('button', { name: 'Ajouter un état' }).click();
      await page.getByRole('button', { name: /^Neutralisé/ }).click();
      await expect(
        page.getByText('Concentration rompue : Neutralisé — le sort en cours est interrompu'),
      ).toBeVisible();

      // — La concentration est celle du LANCEUR : sa chip tombe d'abord —
      await expect(page.getByText('+2 · Bouclier de la foi → Kael Aubemarteau')).toBeHidden();

      // — … puis la fiche de Kael : CA retombée à 20, chip disparue —
      await page.goto(sheetUrl(kael.id));
      await expect(page.getByText(kael.name).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Classe d'armure 20 — ouvrir les/ }),
      ).toBeVisible();
      await expect(page.getByText('+2 · Bouclier de la foi')).toBeHidden();
    },
  );

  playerTest(
    '« Autre » (Gobelin) : chip lanceur pense-bête, aucune CA calculée',
    async ({ page }) => {
      const sheet = await openCastSheet(page, 'Bouclier de la foi');

      // — Picker → « Autre… » → nom libre « Gobelin » → Valider —
      await sheet
        .getByRole('button', {
          name: 'Cible de Bouclier de la foi : Moi — ouvrir la liste des cibles',
        })
        .click();
      const picker = page.getByRole('dialog', { name: 'Cible de Bouclier de la foi' });
      await expect(picker).toBeVisible();
      await picker
        .getByRole('button', { name: 'Cibler une autre créature avec Bouclier de la foi' })
        .click();
      await picker.getByLabel('Nom de la créature').fill('Gobelin');
      await picker
        .getByRole('button', { name: 'Cibler cette créature avec Bouclier de la foi' })
        .click();
      await expect(picker).toBeHidden();

      // — Annonce sans chiffre (pas de fiche) : la formule seule —
      await expect(sheet.getByText('+2 · CA de Gobelin')).toBeVisible();
      await expect(sheet.getByText('Tant que vous restez concentré')).toBeVisible();
      await sheet.getByRole('button', { name: 'Lancer sur Gobelin' }).click();
      await expect(sheet).toBeHidden();

      // — Chip lanceur SANS delta CA (pense-bête) ; la CA de Mira ne bouge pas —
      await expect(page.getByText('Bouclier de la foi → Gobelin')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Classe d'armure 16 — ouvrir les/ }),
      ).toBeVisible();

      // — Mini-feuille : ligne « sans CA », Lever retombe l'effet —
      await page
        .getByRole('button', { name: /1 effet\(s\) de sort actif\(s\) sur la classe d'armure/ })
        .click();
      const mini = page.getByRole('dialog', { name: 'Effets de sort sur la CA' });
      await expect(mini.getByText('Bouclier de la foi → Gobelin')).toBeVisible();
      await expect(mini.getByText('sans CA — pense-bête de règle')).toBeVisible();
      await mini.getByRole('button', { name: 'Lever Bouclier de la foi → Gobelin' }).click();
      // La chip ET la ligne mini-feuille disparaissent (BottomSheet encore ouverte
      // un instant : .first() lève l'ambiguïté chip/ligne le temps du repli).
      await expect(page.getByText('Bouclier de la foi → Gobelin').first()).toBeHidden();
    },
  );
});
