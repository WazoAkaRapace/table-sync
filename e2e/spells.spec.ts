/**
 * Sorts de la clerc (Mira, niv. 5) — rail d'emplacements, sorts connus et
 * flow de lancement : la feuille de sort dépense un emplacement de niveau 1
 * (PATCH spellSlotsUsed) et le rail reflète le décompte.
 *
 * Upcast #171 : le drapeau scalesAtHigherLevel (posé par l'API dans les
 * RÉSUMÉS, où la prose higherLevel est absente) débloque les sorts à upcast
 * purement textuel (Aide : prose, aucune table damage_json).
 */
import { expect } from 'playwright/test';
import { openTab, playerTest, seed, sheetUrl } from './fixtures';

/** id catalogue d'un sort par nom FR exact (via /api/spells/light). */
async function spellIdByFrName(page: import('playwright/test').Page, nameFr: string) {
  const res = await page.request.get('/api/spells/light');
  const body = (await res.json()) as { spells: Array<{ id: number; name: string }> };
  const hit = body.spells.find((s) => s.name === nameFr);
  if (!hit) throw new Error(`Sort introuvable dans le catalogue light : ${nameFr}`);
  return hit.id;
}

playerTest.describe('Sorts (clerc)', () => {
  playerTest.beforeEach(async ({ page }) => {
    await page.goto(sheetUrl(seed().clerc.id));
    await expect(page.getByText(seed().clerc.name).first()).toBeVisible();
    // Sorts est un onglet primaire du dock pour les lanceurs de sorts.
    await openTab(page, 'Sorts');
    await expect(page.getByRole('heading', { name: 'Emplacements de sort' })).toBeVisible();
  });

  playerTest('le rail d’emplacements rend les 4 emplacements de niveau 1', async ({ page }) => {
    // Clerc niv. 5 : 4 emplacements de niveau 1 (table SRD pleine lanceuse).
    await expect(
      page.getByRole('button', {
        name: 'Niveau 1 : 4 emplacements disponibles sur 4 — corriger',
      }),
    ).toBeVisible();
  });

  playerTest('un sort connu est listé avec ses tours de magie', async ({ page }) => {
    await expect(page.getByText('Tours de magie').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Flamme sacrée/ }).first()).toBeVisible();
    await expect(page.getByText('Mot de guérison').first()).toBeVisible();
  });

  playerTest('lancer Mot de guérison dépense un emplacement de niveau 1', async ({ page }) => {
    await page.getByRole('button', { name: 'Lancer Mot de guérison' }).click();

    // La feuille de lancement (portale) présélectionne l'emplacement de
    // niveau 1 (premier castable) — le bouton de lancement l'affiche.
    const castSheet = page.getByRole('dialog', { name: 'Lancer Mot de guérison' });
    await expect(castSheet).toBeVisible();

    // …et le lancer consomme l'emplacement : 4 → 3 dans le rail.
    await castSheet.getByRole('button', { name: '🪄 Lancer au niveau 1' }).click();
    await expect(
      page.getByRole('button', {
        name: 'Niveau 1 : 3 emplacements disponibles sur 4 — corriger',
      }),
    ).toBeVisible();
  });

  playerTest(
    'les tours de magie ne comptent pas dans la limite de préparation',
    async ({ page }) => {
      // SRD : les tours de magie sont toujours lançables, jamais « préparés » —
      // ni bascule ★/☆, ni consommation du compteur Préparés N / limite (#164).
      // Mira : Clerc niv. 5, SAG 18 → mod +4, limite 9. Le seed pose 3 sorts de
      // niveau 1 préparés (Mot de guérison, Blessure, Bouclier de la foi) et un
      // tour (Flamme sacrée) AUSSI seedé prepared:1 — le compteur doit rester à
      // 3 / 9 : le tour ne compte pas, et sa rangée porte l'indicateur ◆ « toujours
      // préparé » (pas de bascule).
      await expect(page.getByRole('button', { name: /Préparés 3 \/ 9/ })).toBeVisible();
      const row = page.getByRole('button', { name: /Flamme sacrée/ }).first();
      await expect(row).toBeVisible();
      // La ligne du tour porte l'img ◆ « toujours préparé » (pas la bascule ★).
      await expect(
        page.getByRole('img', { name: 'Tour de magie toujours préparé' }).first(),
      ).toBeVisible();
    },
  );

  playerTest(
    'le filtre « Préparés » est sélectionné d’arrivée sur l’onglet (#187)',
    async ({ page }) => {
      // Combat : la liste « prête à lancer » doit s'afficher d'emblée. Mira a
      // 3 sorts préparés → le chip Préparés est armé (aria-pressed), les non-
      // préparés (Armure de mage) sont cachés, les tours/domaine restent.
      const prepChip = page.getByRole('button', { name: /Préparés 3 \/ 9/ });
      await expect(prepChip).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Tous' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(page.getByText('Mot de guérison').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Armure de mage/ })).toHaveCount(0);

      // Retour manuel à « Tous » : respecté — les refetchs silencieux (WS,
      // rattrapage de reconnexion) ne doivent pas réarmer le défaut.
      await page.getByRole('button', { name: 'Tous' }).click();
      await expect(page.getByRole('button', { name: /Armure de mage/ }).first()).toBeVisible();
      await expect(prepChip).toHaveAttribute('aria-pressed', 'false');

      // #187 (persist) : le choix est MÉMORISÉ — après un rechargement complet,
      // l'onglet ré-ouvre sur « Tous » (pas de réarmement du défaut Préparés).
      await page.reload();
      await expect(page.getByText(s.clerc.name).first()).toBeVisible();
      await openTab(page, 'Sorts');
      await expect(page.getByRole('button', { name: 'Tous' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: /Armure de mage/ }).first()).toBeVisible();
      // La clé localStorage porte la préférence…
      expect(await page.evaluate(() => localStorage.getItem('dnd-inv-spells-filter'))).toBe('all');

      // …et un choix « Préparés » persiste AUSSI à travers un reload.
      await page.getByRole('button', { name: /Préparés 3 \/ 9/ }).click();
      await expect(prepChip).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(page.getByText(s.clerc.name).first()).toBeVisible();
      await openTab(page, 'Sorts');
      await expect(prepChip).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => localStorage.getItem('dnd-inv-spells-filter'))).toMatch(
        /^prep:/,
      );
    },
  );
});

playerTest.describe('Sorts — upcast (#171)', () => {
  playerTest.beforeEach(async ({ page }) => {
    const s = seed();
    // « Aide » (niv. 2, upcast PUREMENT textuel : prose higher_level, aucune
    // table damage_json) appris à Mira (Clerc 5 — emplacements 4/3/2/1, donc
    // L3 et L4 libres) via l'API : l'upsert est idempotent.
    const aideId = await spellIdByFrName(page, 'Aide');
    await page.request.post(`/api/characters/${s.clerc.id}/spells`, {
      data: { spellId: aideId, prepared: true },
      headers: { Authorization: `Bearer ${s.player.token}` },
    });
    await page.goto(sheetUrl(s.clerc.id));
    await expect(page.getByText(s.clerc.name).first()).toBeVisible();
    await openTab(page, 'Sorts');
    await expect(page.getByRole('heading', { name: 'Emplacements de sort' })).toBeVisible();
  });

  playerTest(
    'Aide (upcast textuel, sans table) propose les niveaux supérieurs',
    async ({ page }) => {
      // Résumé du grimoire : prose absente — le drapeau scalesAtHigherLevel
      // doit porter la décision (#171) : Aide se lance à son niveau 2 natif
      // ET au niveau 3 (Mira Clerc 5 n'a QUE des emplacements jusqu'à L3 —
      // la table SRD donne le L4 au niveau 7). Le « supérieur » atteste que
      // l'option vient de l'upcast, pas d'un niveau natif.
      await page.getByRole('button', { name: 'Lancer Aide' }).click();
      const castSheet = page.getByRole('dialog', { name: 'Lancer Aide' });
      await expect(castSheet).toBeVisible();
      await expect(castSheet.getByRole('button', { name: /^Niveau 2/ })).toBeVisible();
      await expect(castSheet.getByRole('button', { name: /^Niveau 3 supérieur/ })).toBeVisible();
      await expect(castSheet.getByRole('button', { name: /^Niveau 4/ })).toHaveCount(0);
    },
  );

  playerTest(
    'Bouclier de la foi (aucun upcast) ne propose QUE son niveau natif',
    async ({ page }) => {
      // Régression : ni prose higher_level ni table d'évolution → drapeau
      // false → seule l'option « Niveau 1 » (aucun « supérieur »).
      await page.getByRole('button', { name: 'Lancer Bouclier de la foi' }).click();
      const castSheet = page.getByRole('dialog', { name: 'Lancer Bouclier de la foi' });
      await expect(castSheet).toBeVisible();
      await expect(castSheet.getByRole('button', { name: /^Niveau 1/ })).toBeVisible();
      await expect(castSheet.getByRole('button', { name: /Niveau 2/ })).toHaveCount(0);
      await expect(castSheet.getByText('supérieur')).toHaveCount(0);
    },
  );
});
