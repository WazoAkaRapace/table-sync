/**
 * Multiclassage (SRD 5.1) — feuille guidée d'ajout de classe, deux pools
 * d'emplacements (Incantation + Magie de pacte), lancement inter-pools,
 * compteurs de préparation par classe, dés de vie par type de dé.
 *
 * Les personnages multiclassés sont créés par REST au début du spec (la
 * campagne seedée reste mono-classe — aucune autre spec ne les connaît).
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { openTab, playerTest, seed, sheetUrl } from './fixtures';

playerTest.describe('Multiclassage', () => {
  let siofraId = 0;
  let morriganId = 0;
  let korgId = 0;

  playerTest.beforeAll(async () => {
    const token = seed().player.token;
    const create = async (body: Record<string, unknown>) => {
      const res = await fetch(`${API_BASE}/api/parties/${seed().partyId}/characters`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`E2E : création multiclassée → ${res.status}`);
      const data = (await res.json()) as { character: { id: number } };
      return data.character.id;
    };
    const patch = async (id: number, body: Record<string, unknown>) => {
      const res = await fetch(`${API_BASE}/api/characters/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`E2E : patch multiclassé → ${res.status}`);
    };

    // Clerc 2 (SAG 14) / Magicien 3 (INT 16) — deux classes préparant
    siofraId = await create({
      name: 'Siofra',
      wisdom: 14,
      intelligence: 16,
      maxHp: 30,
      classes: [
        { classKey: 'Clerc', level: 2 },
        { classKey: 'Magicien', level: 3 },
      ],
    });

    // Occultiste 5 (CHA 16) / Magicien 5 (INT 14) — pacte + incantation
    morriganId = await create({
      name: 'Morrigan',
      charisma: 16,
      intelligence: 14,
      maxHp: 50,
      classes: [
        { classKey: 'Occultiste', level: 5 },
        { classKey: 'Magicien', level: 5 },
      ],
    });
    // Épuise l'incantation (4/3/2) et apprend Boule de feu côté Occultiste
    await patch(morriganId, { spellSlotsUsed: [4, 3, 2, 0, 0, 0, 0, 0, 0] });
    const search = await fetch(
      `${API_BASE}/api/spells?search=${encodeURIComponent('Boule de feu')}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    const found = (
      (await search.json()) as {
        spells: Array<{ id: number; nameFr: string | null; name: string }>;
      }
    ).spells;
    const fireball = found.find((sp) => (sp.nameFr ?? sp.name) === 'Boule de feu');
    if (!fireball) throw new Error('E2E : Boule de feu introuvable au catalogue');
    await fetch(`${API_BASE}/api/characters/${morriganId}/spells`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ spellId: fireball.id, classSource: 'Occultiste' }),
      signal: AbortSignal.timeout(8000),
    });

    // Barbare 1 — servira à tester la feuille guidée d'ajout (prérequis ⚠)
    korgId = await create({
      name: 'Korg',
      strength: 15,
      intelligence: 10,
      maxHp: 12,
      classes: [{ classKey: 'Barbare', level: 1 }],
    });
  });

  playerTest.describe('feuille guidée « Ajouter une classe »', () => {
    playerTest.beforeEach(async ({ page }) => {
      await page.goto(sheetUrl(korgId));
      await expect(page.getByText('Korg').first()).toBeVisible();
      await openTab(page, 'Description');
      await page.getByRole('button', { name: '✎ Modifier' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Identité & classe' }).getByText('Barbare'),
      ).toBeVisible();
    });

    playerTest(
      'prérequis non satisfait : ⚠ affiché, jamais bloquant, puis résumé',
      async ({ page }) => {
        const identity = page.getByRole('dialog', { name: 'Identité & classe' });
        await identity.getByRole('button', { name: '＋ Ajouter une classe' }).click();
        const sheet = page.getByRole('dialog', { name: 'Ajouter une classe' });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: /Magicien/ }).click();
        // INT 10 < 13 → avertissement orange, le bouton Ajouter reste actif
        await expect(sheet.getByText('(13 requis)')).toBeVisible();
        await expect(sheet.getByText('Maîtrises acquises')).toBeVisible();
        await sheet.getByRole('button', { name: 'Ajouter', exact: true }).click();
        await expect(sheet).toBeHidden();
        // La feuille d'identité porte les deux lignes…
        await expect(identity.getByText('Barbare')).toBeVisible();
        await expect(identity.getByText('Magicien')).toBeVisible();
        // …et la carte résumé de l'onglet aussi
        await page.keyboard.press('Escape');
        await expect(page.getByText('Barbare 1 / Magicien 1').first()).toBeVisible({
          timeout: 8000,
        });
      },
    );
  });

  playerTest.describe('Sorts — deux pools (Occultiste 5 / Magicien 5)', () => {
    playerTest.beforeEach(async ({ page }) => {
      await page.goto(sheetUrl(morriganId));
      await expect(page.getByText('Morrigan').first()).toBeVisible();
      await openTab(page, 'Sorts');
      await expect(page.getByRole('heading', { name: 'Emplacements de sort' })).toBeVisible();
    });

    playerTest('les deux rails étiquetés coexistent (incantation + pacte or)', async ({ page }) => {
      await expect(page.getByText('Incantation', { exact: true })).toBeVisible();
      await expect(page.getByText('Magie de pacte', { exact: true })).toBeVisible();
      await expect(page.getByText('recharge au repos court')).toBeVisible();
      // Incantation 10 : [4,3,2] — niveau 1 épuisé (0/4), pacte intact (2× niv. 3)
      await expect(
        page.getByRole('button', { name: 'Niveau 1 : 0 emplacement disponible sur 4 — corriger' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: 'Niveau 3 : 2 emplacements disponibles sur 2 — corriger',
        }),
      ).toBeVisible();
    });

    playerTest('le bandeau liste la DD de chaque classe lancante', async ({ page }) => {
      await expect(page.getByText(/Occultiste : DD/)).toBeVisible();
      await expect(page.getByText(/Magicien : DD/)).toBeVisible();
    });

    playerTest(
      'lancer Boule de feu puise dans le PACTE (incantation épuisée)',
      async ({ page }) => {
        await page.getByRole('button', { name: 'Lancer Boule de feu' }).click();
        const castSheet = page.getByRole('dialog', { name: 'Lancer Boule de feu' });
        await expect(castSheet).toBeVisible();
        await castSheet.getByRole('button', { name: '🪄 Lancer au niveau 3' }).click();
        // Le pool de pacte passe de 2/2 à 1/2 — le label reste unique car
        // l'incantation de niveau 3 est à 0/2.
        await expect(
          page.getByRole('button', {
            name: 'Niveau 3 : 1 emplacement disponible sur 2 — corriger',
          }),
        ).toBeVisible({ timeout: 8000 });
      },
    );

    playerTest(
      'aux deux pools disponibles, le joueur CHOISIT ses emplacements',
      async ({ page }) => {
        // Reset complet des deux pools + un sort de niveau 1 connu (Occultiste)
        const token = seed().player.token;
        await fetch(`${API_BASE}/api/characters/${morriganId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
            pactSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
          }),
          signal: AbortSignal.timeout(8000),
        });
        const search = await fetch(
          `${API_BASE}/api/spells?search=${encodeURIComponent('Charme-personne')}`,
          { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
        );
        const charm = (
          (await search.json()) as {
            spells: Array<{ id: number; nameFr: string | null; name: string }>;
          }
        ).spells.find((sp) => (sp.nameFr ?? sp.name) === 'Charme-personne');
        if (!charm) throw new Error('E2E : Charme-personne introuvable');
        await fetch(`${API_BASE}/api/characters/${morriganId}/spells`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ spellId: charm.id, classSource: 'Occultiste' }),
          signal: AbortSignal.timeout(8000),
        });
        await page.reload();
        await expect(page.getByText('Morrigan').first()).toBeVisible();
        await openTab(page, 'Sorts');

        // La feuille d'incantation propose UNE option par pool : l'incantation
        // au niveau du sort, et le pacte AU NIVEAU DE SON PROPRE emplacement
        // (Occultiste 5 → niveau 3) — SRD : les pools sont interchangeables.
        await page.getByRole('button', { name: 'Lancer Charme-personne' }).click();
        const castSheet = page.getByRole('dialog', { name: 'Lancer Charme-personne' });
        await expect(castSheet).toBeVisible();
        const incantation = castSheet.getByRole('button', { name: /Niveau 1/ }).first();
        const pacte = castSheet.getByRole('button', { name: /pacte/ });
        await expect(incantation).toBeVisible();
        await expect(pacte).toBeVisible();

        // Choix explicite du PACTE : seul ce pool se décrémente.
        await pacte.click();
        await castSheet.getByRole('button', { name: '🪄 Lancer au niveau 3' }).click();
        await expect(
          page.getByRole('button', {
            name: 'Niveau 3 : 1 emplacement disponible sur 2 — corriger',
          }),
        ).toBeVisible({ timeout: 8000 });
        await expect(
          page.getByRole('button', {
            name: 'Niveau 1 : 4 emplacements disponibles sur 4 — corriger',
          }),
        ).toBeVisible();
      },
    );
  });

  playerTest.describe('Sorts — préparation par classe (Clerc 2 / Magicien 3)', () => {
    playerTest('les segments Préparés portent chacun leur compteur', async ({ page }) => {
      await page.goto(sheetUrl(siofraId));
      await expect(page.getByText('Siofra').first()).toBeVisible();
      await openTab(page, 'Sorts');
      // Clerc 2 (SAG 14) : 4 préparés · Magicien 3 (INT 16) : 6 préparés
      await expect(page.getByRole('button', { name: /Clerc Préparés 0 \/ 4/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Magicien Préparés 0 \/ 6/ })).toBeVisible();
    });
  });

  playerTest.describe('Caractéristiques & Survie', () => {
    playerTest('DD de sort par classe lancante + dés de vie par type', async ({ page }) => {
      await page.goto(sheetUrl(siofraId));
      await openTab(page, 'Caractéristiques');
      await expect(page.getByText('DD de sort · Clerc')).toBeVisible();
      await expect(page.getByText('DD de sort · Magicien')).toBeVisible();
    });

    playerTest('dés de vie : deux types de dés (Occultiste d8 / Magicien d6)', async ({ page }) => {
      await page.goto(sheetUrl(morriganId));
      await openTab(page, 'Survie');
      // Le pool garde ses types de dés — SRD multiclassage : une rangée par
      // type dans le panneau Repos, chaque stepper porte classe + dé.
      await expect(
        page.getByRole('button', { name: 'Dépenser un dé de vie d8 — Occultiste' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Dépenser un dé de vie d6 — Magicien' }),
      ).toBeVisible();
    });
  });
});
