/**
 * Occultiste — manifestations occultes (Vesper, niv. 11, seedée avec Arcanum 6
 * + faveur de pacte Lame posés) : sélecteur borné du catalogue de classe
 * (compteur n/max, prérequis grisés), aperçu Décharge déchirante, sort à
 * volonté sans consommer de perle de pacte, Arcanum gratuit qui décrémente
 * le compteur et revient au repos long.
 *
 * Chromium (pas de @smoke : la spec mute l'état seedé de Vesper).
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { openTab, playerTest, seed, sheetUrl } from './fixtures';

/** Le sélecteur : overlay Catalogue de classe → sous-section Manifestations. */
async function openInvocations(page: import('playwright/test').Page) {
  await openTab(page, 'Traits');
  await page.getByRole('button', { name: 'Catalogue de classe' }).click();
  const section = page.locator('div').filter({
    has: page.getByRole('heading', { name: 'Manifestations occultes' }),
  });
  await expect(section.first()).toBeVisible();
  return section.first();
}

playerTest.describe('Occultiste (manifestations)', () => {
  playerTest(
    'la sous-section manifestations n’apparaît pas pour un non-occultiste',
    async ({ page }) => {
      await page.goto(sheetUrl(seed().guerrier.id));
      await openTab(page, 'Traits');
      await page.getByRole('button', { name: 'Catalogue de classe' }).click();
      await expect(
        page.getByRole('combobox', { name: 'Classe du catalogue', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Manifestations occultes')).toHaveCount(0);
    },
  );

  playerTest(
    'sélecteur : compteur n/max, ajout, prérequis grisés avec raison',
    async ({ page }) => {
      await page.goto(sheetUrl(seed().occultiste.id));
      await expect(page.getByText(seed().occultiste.name).first()).toBeVisible();
      const section = await openInvocations(page);

      // Occultiste 11 : 5 manifestations possibles, 0 posées.
      await expect(section.getByText('0/5 connues')).toBeVisible();

      // Deux manifestations cochables tant que connues < max.
      await page.getByRole('button', { name: 'Ajouter Décharge déchirante' }).click();
      await expect(section.getByText('1/5 connues')).toBeVisible();
      await page.getByRole('button', { name: 'Ajouter Lance occulte' }).click();
      await expect(section.getByText('2/5 connues')).toBeVisible();

      // Prérequis de niveau manquant : rang désactivé + raison (Vesper 11 < 12).
      const lifedrinker = page.getByRole('button', {
        name: 'Buveuse de vie — Niv. occultiste 12 requis',
      });
      await expect(lifedrinker).toBeDisabled();
      await expect(section.getByText('Niv. occultiste 12 requis').first()).toBeVisible();

      // Prérequis de faveur de pacte manquant : Lame posée, Chaîne absente.
      const chainVoice = page.getByRole('button', {
        name: 'Voix du maître des Chaînes — Faveur de pacte : Chaîne requise',
      });
      await expect(chainVoice).toBeDisabled();
      await expect(section.getByText('Faveur de pacte : Chaîne requise').first()).toBeVisible();

      // Faveur Lame POSÉE : Lame assoiffée (pacte lame, niv. 5) reste cochable.
      await expect(page.getByRole('button', { name: 'Ajouter Lame assoiffée' })).toBeEnabled();
    },
  );

  playerTest(
    'Décharge occulte : aperçu 3 rayons +3 (Décharge déchirante, CHA 16)',
    async ({ page }) => {
      // Auto-suffisant : pose Décharge déchirante par REST (pas de dépendance
      // à l'ordre des tests — la base est partagée, workers: 1).
      const token = seed().player.token;
      const charId = seed().occultiste.id;
      const post = await fetch(`${API_BASE}/api/characters/${charId}/features`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: 'Décharge déchirante',
          category: 'class',
          catalogId: 'occultiste-invo-decharge-dechirante',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!post.ok) throw new Error(`E2E : pose Décharge déchirante → ${post.status}`);

      await page.goto(sheetUrl(charId));
      await openTab(page, 'Sorts');
      await page.getByRole('button', { name: 'Lancer Décharge occulte' }).click();
      const cast = page.getByRole('dialog', { name: 'Lancer Décharge occulte' });
      await expect(cast).toBeVisible();
      // Niv. occultiste 11 → 3 rayons ; CHA 16 → +3 par rayon.
      await expect(cast.getByText(/3 × 1d10\+3/)).toBeVisible();
      await expect(cast.getByText('3 rayons')).toBeVisible();
      await expect(cast.getByText('+3 / rayon')).toBeVisible();
    },
  );

  playerTest(
    'sort à volonté (manifestation) : lancer sans consommer de perle de pacte',
    async ({ page }) => {
      const token = seed().player.token;
      const charId = seed().occultiste.id;

      // Vision occulte (Détection de la magie à volonté) par REST, puis le sort
      // au grimoire — la manifestation l'accorde, la ligne sert de porte
      // d'entrée au lanceur.
      const post = await fetch(`${API_BASE}/api/characters/${charId}/features`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: 'Vision occulte',
          category: 'class',
          catalogId: 'occultiste-invo-vision-occulte',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!post.ok) throw new Error(`E2E : pose Vision occulte → ${post.status}`);

      const search = await fetch(
        `${API_BASE}/api/spells?search=${encodeURIComponent('Détection de la magie')}`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
      );
      const found = (
        (await search.json()) as {
          spells: Array<{ id: number; nameFr: string | null; name: string }>;
        }
      ).spells;
      const hit = found.find((sp) => (sp.nameFr ?? sp.name) === 'Détection de la magie');
      if (!hit) throw new Error('E2E : « Détection de la magie » introuvable au catalogue');
      const postSpell = await fetch(`${API_BASE}/api/characters/${charId}/spells`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ spellId: hit.id, prepared: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (!postSpell.ok) throw new Error(`E2E : ajout Détection de la magie → ${postSpell.status}`);

      await page.goto(sheetUrl(charId));
      await openTab(page, 'Sorts');

      // Badge or « à volonté » sur la ligne portée par la manifestation.
      const row = page.locator('li', { hasText: 'Détection de la magie' });
      await expect(row.getByText('à volonté')).toBeVisible();

      // Lancer à volonté : le pool de pacte (3×L5) reste plein.
      const pactFull = page.getByRole('button', {
        name: 'Niveau 5 : 3 emplacements disponibles sur 3 — corriger',
      });
      await expect(pactFull).toBeVisible();
      await row.getByRole('button', { name: 'Lancer Détection de la magie' }).click();
      const cast = page.getByRole('dialog', { name: 'Lancer Détection de la magie' });
      await expect(cast.getByText('À volonté — manifestation occulte')).toBeVisible();
      await cast.getByRole('button', { name: 'Lancer à volonté' }).click();
      await expect(cast).toHaveCount(0);
      await expect(pactFull).toBeVisible();
    },
  );

  playerTest(
    'Arcanum mystique : cast gratuit décrémente le compteur, revient au repos long',
    async ({ page }) => {
      await page.goto(sheetUrl(seed().occultiste.id));
      await openTab(page, 'Sorts');

      // Cercle de mort (niv. 6) : l'option Arcanum — sans emplacement — en
      // tête, présélectionnée (compteur du trait à 1).
      await page.getByRole('button', { name: 'Lancer Cercle de mort' }).click();
      const cast = page.getByRole('dialog', { name: 'Lancer Cercle de mort' });
      const freeOption = cast.getByRole('button', { name: /Gratuit/ }).first();
      await expect(freeOption).toBeVisible();
      await expect(freeOption).toHaveAttribute('aria-pressed', 'true');
      await expect(freeOption).toContainText('Arcanum mystique');

      // Le lancer ne touche PAS les perles de pacte…
      const pactFull = page.getByRole('button', {
        name: 'Niveau 5 : 3 emplacements disponibles sur 3 — corriger',
      });
      await expect(pactFull).toBeVisible();
      await cast.getByRole('button', { name: 'Lancer sans emplacement' }).click();
      await expect(cast).toHaveCount(0);
      await expect(pactFull).toBeVisible();

      // …mais décrémente le compteur du trait Arcanum (1 → 0).
      await openTab(page, 'Traits');
      await expect(page.getByText('0 / 1').first()).toBeVisible();

      // Compteur épuisé : plus d'option gratuite ni d'emplacement L6+.
      await openTab(page, 'Sorts');
      await page.getByRole('button', { name: 'Lancer Cercle de mort' }).click();
      const drained = page.getByRole('dialog', { name: 'Lancer Cercle de mort' });
      await expect(drained.getByRole('button', { name: /Gratuit/ })).toHaveCount(0);
      await expect(
        drained.getByText('Aucun emplacement de sort disponible. Il te faut un repos.'),
      ).toBeVisible();
      await drained.getByRole('button', { name: 'Fermer' }).click();

      // Repos long : le compteur revient, l'option Arcanum réapparaît.
      await openTab(page, 'Survie');
      await page.getByRole('button', { name: 'Repos long' }).click();
      const restSheet = page.getByRole('dialog', { name: 'Repos long (8 h)' });
      await restSheet.getByRole('button', { name: 'Se reposer' }).click();
      await expect(restSheet).toHaveCount(0);
      await openTab(page, 'Traits');
      await expect(page.getByText('1 / 1').first()).toBeVisible();
      await openTab(page, 'Sorts');
      await page.getByRole('button', { name: 'Lancer Cercle de mort' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Lancer Cercle de mort' }).getByRole('button', {
          name: /Gratuit/,
        }),
      ).toBeVisible();
    },
  );
});
