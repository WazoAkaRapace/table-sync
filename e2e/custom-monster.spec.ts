/**
 * Monstres personnalisés (PR2 « Contenus personnalisés ») — parcours MD
 * complet : création depuis le pupitre (statblock hybride + aperçu embarqué),
 * recherche du bestiaire du traqueur (badge or « Monstre de la table »),
 * ajout ×3 en rencontre (PV roulés, groupe, masque « Créature inconnue »
 * côté joueur, vérifié sur l'état servi), bloc de stats depuis la carte,
 * édition entre séances, puis le garde-fou de suppression : bloquée pendant
 * la rencontre vivante (modal listant les rencontres), permise après `ended`.
 *
 * La spec crée SA PROPRE rencontre par API (elle ne touche jamais la
 * rencontre seedée des autres specs) et la termine/relâche elle-même.
 */

import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, seed } from './fixtures';

const MONSTER_NAME = 'Zalkir, prêtre-serpent';

/** Crée une rencontre propre à la spec (jamais la rencontre seedée). */
async function createEncounter(name: string, token: string): Promise<number> {
  const res = await fetch(`${API_BASE}/api/parties/${seed().partyId}/encounters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`createEncounter → ${res.status}`);
  const { encounter } = (await res.json()) as { encounter: { id: number } };
  return encounter.id;
}

async function patchEncounter(id: number, body: object, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/encounters/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`patchEncounter → ${res.status}`);
}

/** Recherche le monstre custom du groupe par son nom (état servi). */
async function fetchCustomMonster(name: string, token: string) {
  const res = await fetch(
    `${API_BASE}/api/monsters?partyId=${seed().partyId}&origin=custom&limit=100`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) throw new Error(`fetchCustomMonster « ${name} » → ${res.status}`);
  const { monsters } = (await res.json()) as { monsters: any[] };
  const hit = monsters.find((m) => m.name === name);
  if (!hit) throw new Error(`« ${name} » introuvable dans les monstres custom`);
  return hit;
}

gmTest.describe('Monstre personnalisé (MD)', () => {
  gmTest('création, ajout en rencontre, édition, garde-fou de suppression', async ({ page }) => {
    // ---------- 1. Création depuis le pupitre ----------
    await page.goto(`/party/${seed().partyId}/gm`);
    await page.getByRole('button', { name: 'Monstres custom' }).click();
    await expect(page.getByRole('button', { name: '+ Ajouter' })).toBeVisible();

    await page.getByRole('button', { name: '+ Ajouter' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Nom').fill(MONSTER_NAME);
    await modal.getByLabel('CA', { exact: true }).fill('15');
    await modal.getByLabel('PV').fill('65');
    await modal.getByLabel('Dés de vie').fill('10d8+20');
    // PV moyens dérivés des dés : 10d8+20 → 65.
    await expect(modal.getByText('PV moyens : 65')).toBeVisible();
    // PX et bonus de maîtrise dérivés du FP (défaut 0 → 10 PX / bonus +2).
    await expect(modal.getByText('10 PX')).toBeVisible();
    await expect(modal.getByText('bonus +2')).toBeVisible();
    // Une action en texte libre — les bonus parsés ne bloquent jamais.
    await modal.getByRole('button', { name: '＋ Action' }).click();
    await modal.getByLabel('Nom de l’action 1').fill('Cimeterre');
    await modal
      .getByLabel('Texte de Cimeterre')
      .fill('Attaque au corps à corps : +4 pour toucher, 5 (1d6+2) dégâts tranchants.');
    // Aperçu embarqué : le VRAI bloc de stats, recalculé à la frappe.
    await expect(modal.getByRole('heading', { name: MONSTER_NAME })).toBeVisible();

    await modal.getByRole('button', { name: '+ Ajouter au bestiaire' }).click();
    await expect(modal).toBeHidden();
    const row = page.getByRole('listitem').filter({ hasText: MONSTER_NAME }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('FP 0');

    // Vérification par l'état servi : slug serveur préfixé, dés transportés.
    const created = await fetchCustomMonster(MONSTER_NAME, seed().gm.token);
    expect(created.slug.startsWith('custom-zalkir')).toBe(true);
    expect(created.hitDice).toBe('10d8+20');

    // ---------- 2. Recherche du bestiaire du traqueur + ajout ×3 masqué ----------
    const encId = await createEncounter('Sanctuaire du serpent', seed().gm.token);
    // Le clerc de la joueuse rejoint la rencontre : une joueuse non-membre
    // n'a pas le droit de lire le détail (visibilité par combatant).
    const joinRes = await fetch(`${API_BASE}/api/encounters/${encId}/combatants/player`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${seed().gm.token}` },
      body: JSON.stringify({ characterIds: [seed().clerc.id] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!joinRes.ok) throw new Error(`join player → ${joinRes.status}`);
    await page.goto(`/party/${seed().partyId}/combat?enc=${encId}`);
    await page.getByRole('button', { name: '+ Monstre' }).click();
    const search = page.getByPlaceholder('Rechercher un monstre… (gobelin, dragon,…)');

    await search.fill('Zalkir');
    // Badge or « Monstre de la table » en suffixe du nom — mêlé au SRD.
    const resultRow = page.getByRole('button').filter({ hasText: MONSTER_NAME });
    await expect(resultRow.first()).toBeVisible();
    await expect(resultRow.first()).toContainText('Monstre de la table');
    await resultRow.first().click();

    // Quantité ×3 + masque : gestes identiques aux SRD.
    await page.locator('#monster-count').fill('3');
    await page.getByText('Masquer le nom aux joueurs').click();
    await page.getByRole('button', { name: '+ Ajouter', exact: true }).click();

    // PV roulés par exemplaire : trois dentes Zalkir sur le banc.
    await expect(page.getByText(/Zalkir, prêtre-serpent/).first()).toBeVisible();
    const detail = (await (
      await fetch(`${API_BASE}/api/encounters/${encId}`, {
        headers: { authorization: `Bearer ${seed().gm.token}` },
        signal: AbortSignal.timeout(5000),
      })
    ).json()) as {
      encounter: { combatants: { id: number; monsterSlug: string; groupId: number }[] };
    };
    const zalkirs = detail.encounter.combatants.filter((c) => c.monsterSlug === created.slug);
    expect(zalkirs.length).toBe(3);
    expect(new Set(zalkirs.map((c) => c.groupId)).size).toBe(1);

    // Masque : côté joueur (état servi), le nom ET le slug sont redactés.
    const playerView = (await (
      await fetch(`${API_BASE}/api/encounters/${encId}`, {
        headers: { authorization: `Bearer ${seed().player.token}` },
        signal: AbortSignal.timeout(5000),
      })
    ).json()) as {
      encounter: { combatants: { type: string; name: string; monsterSlug: string | null }[] };
    };
    const seenMonsters = playerView.encounter.combatants.filter((c) => c.type === 'monster');
    expect(seenMonsters.length).toBeGreaterThanOrEqual(3);
    expect(seenMonsters.every((c) => c.name === 'Créature inconnue')).toBe(true);
    expect(seenMonsters.every((c) => c.monsterSlug === null)).toBe(true);

    // ---------- 3. Bloc de stats depuis la carte (badge or du titre) ----------
    // Mobile : la carte du combatant s'ouvre depuis le rail, le bloc suit.
    await page
      .getByRole('button', { name: /Zalkir/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Stats' }).first().click();
    // Le titre du bloc porte la pilule or « Monstre de la table » — le badge
    // n'existe nulle part ailleurs sur la page du traqueur.
    await expect(page.getByText('Monstre de la table').first()).toBeVisible();

    // ---------- 4. Édition entre séances (PATCH hydraté) ----------
    await page.goto(`/party/${seed().partyId}/gm`);
    await page.getByRole('button', { name: 'Monstres custom' }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: MONSTER_NAME })
      .first()
      .getByRole('button', { name: 'Modifier' })
      .click();
    await expect(page.getByRole('dialog').getByLabel('PV')).toHaveValue('65');
    await page.getByRole('dialog').getByLabel('PV').fill('78');
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const edited = await fetchCustomMonster(MONSTER_NAME, seed().gm.token);
    expect(edited.hitPoints).toBe(78);

    // ---------- 5. Garde-fou de suppression ----------
    // La méta « Dans 1 rencontre » est visible en continu sur la carte.
    await expect(
      page.getByRole('listitem').filter({ hasText: MONSTER_NAME }).first(),
    ).toContainText('Dans 1 rencontre');
    // Confirmer la suppression → 409 → modal de conséquences listant la
    // rencontre vivante ; aucune porte de sortie force ici. (ConfirmButton :
    // premier tap armé, second tap sur le libellé « — confirmer ? ».)
    const confirm = page
      .getByRole('listitem')
      .filter({ hasText: MONSTER_NAME })
      .first()
      .getByRole('button', { name: new RegExp(`Supprimer « ${MONSTER_NAME} »`) });
    await confirm.click();
    await confirm.click(); // armé puis confirmé
    const consequences = page
      .getByRole('dialog')
      .filter({ hasText: `Supprimer « ${MONSTER_NAME} » ?` });
    await expect(consequences).toContainText('Utilisé par :');
    await expect(consequences).toContainText('Sanctuaire du serpent');
    await expect(consequences).toContainText(/Retire d’abord ce monstre/);
    await consequences.getByRole('button', { name: 'Annuler' }).click();

    // Rencontre terminée → la suppression passe (le snapshot survit).
    await patchEncounter(encId, { status: 'ended' }, seed().gm.token);
    await confirm.click();
    await confirm.click();
    await expect(page.getByRole('listitem').filter({ hasText: MONSTER_NAME })).toHaveCount(0);
    expect(created.slug.startsWith('custom-')).toBe(true);
  });
});
