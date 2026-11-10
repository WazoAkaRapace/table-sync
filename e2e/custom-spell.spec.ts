/**
 * Sorts personnalisés (PR3 « Contenus personnalisés ») — parcours complet :
 * création depuis le pupitre MD (fiche de sort structurée + aperçu embarqué
 * recalculé à la frappe), fusion dans le grimoire joueur (badge or « Sort de
 * la table », apprentissage libre filtré par classes déclarées), aperçu
 * d'upcast du CastSpellSheet recalculé sur la table damage_at_slot_level,
 * édition MD qui se propage au refetch (JOIN, aucune copie figée), puis le
 * garde-fou de suppression : 409 listant les porteurs → modal de
 * conséquences → ?force=1 CASCADE.
 *
 * La spec crée SON sort à elle (jamais le seed) et le supprime en fin de
 * parcours ; l'apprentissage se fait sur la clerc seedée (Mira).
 */

import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, openTab, playerTest, seed, sheetUrl } from './fixtures';

const SPELL_NAME = 'Grâce de la Serpente';

/** Corps de création complet (miroir du contrat API). */
const SPELL_BODY = {
  name: SPELL_NAME,
  level: 2,
  school: 'evocation',
  castingTime: '1 action',
  rangeText: '18 mètres',
  duration: 'Concentration, jusqu’à 1 minute',
  components: ['V', 'S'],
  concentration: true,
  ritual: false,
  classes: ['Clerc', 'Druide'],
  damageType: 'poison',
  damage: { dice: '3d6', perSlotLevel: '1d6' },
  dc: { ability: 'con', success: 'half' },
  description: 'Un serpent d’ombre verte s’enroule autour de la cible.',
};

/** Le sort custom du groupe existe-t-il déjà (état servi) ? */
async function findCustomSpell(name: string): Promise<any | null> {
  const res = await fetch(
    `${API_BASE}/api/spells?partyId=${seed().partyId}&source=custom&limit=100`,
    {
      headers: { authorization: `Bearer ${seed().gm.token}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) return null;
  const { spells } = (await res.json()) as { spells: any[] };
  return spells.find((s) => s.name === name) ?? null;
}

/** Crée le sort au nom du MD si absent (idempotent — specs replayables). */
async function ensureCustomSpell(): Promise<any> {
  const existing = await findCustomSpell(SPELL_NAME);
  if (existing) return existing;
  const res = await fetch(`${API_BASE}/api/parties/${seed().partyId}/spells`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${seed().gm.token}` },
    body: JSON.stringify(SPELL_BODY),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`ensureCustomSpell → ${res.status}`);
  const { spell } = (await res.json()) as { spell: any };
  return spell;
}

gmTest.describe('Sort personnalisé (MD)', () => {
  gmTest('création depuis le pupitre, aperçu embarqué, état servi', async ({ page }) => {
    // ---------- 1. Création depuis le pupitre ----------
    await page.goto(`/party/${seed().partyId}/gm`);
    await page.getByRole('button', { name: 'Sorts custom' }).click();
    await expect(page.getByRole('button', { name: '+ Ajouter' })).toBeVisible();

    await page.getByRole('button', { name: '+ Ajouter' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Nom').fill(SPELL_NAME);
    // Les selects wrappés dans leur label voient le texte des options
    // rejoindre leur nom accessible — on pointe les ids stables.
    await modal.locator('#spell-level-input').selectOption('2');
    // Concentration + DD CON « demi dégâts » + dégâts 3d6 poison + 1d6/cran.
    await modal.getByLabel('Concentration').check();
    await modal.locator('#spell-dc-ability-input').selectOption('con');
    await modal.locator('#spell-dc-success-input').selectOption('half');
    await modal.getByLabel('Dégâts', { exact: true }).fill('3d6');
    await modal.locator('#spell-damage-type-input').selectOption('poison');
    await modal.getByLabel('+ dés de dégâts par cran').fill('1d6');
    // Chips enseignées à la saisie : DD + upcast par cran (aperçu or).
    // (la note ET la chip de l'aperçu portent le texte — .first())
    await expect(modal.getByText('DD CON · Dégâts réduits de moitié').first()).toBeVisible();
    await expect(modal.getByText('+1d6 par cran')).toBeVisible();
    // Aperçu embarqué (pied de modal) : la fiche de sort en lecture — la
    // ligne d'upcast relit la MÊME table que la feuille d'incantation.
    await expect(modal.getByText('Niv. 3 : 4d6')).toBeVisible();

    await modal.getByRole('button', { name: '+ Ajouter au grimoire' }).click();
    await expect(modal).toBeHidden();
    const row = page.getByRole('listitem').filter({ hasText: SPELL_NAME }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Niv. 2');

    // ---------- 2. État servi : index synthétique + table d'upcast ----------
    const created = await findCustomSpell(SPELL_NAME);
    expect(created).not.toBeNull();
    expect(created.srdIndex.startsWith(`custom-${seed().partyId}-`)).toBe(true);
    const table = JSON.parse(created.damageJson).damage_at_slot_level;
    expect(table['2']).toBe('3d6');
    expect(table['3']).toBe('4d6');
    expect(table['9']).toBe('10d6');
  });
});

playerTest.describe('Sort personnalisé (joueur)', () => {
  playerTest('grimoire fusionné + apprentissage + upcast du CastSpellSheet', async ({ page }) => {
    // Le MD a préparé le terrain (création idempotente au nom du MD).
    const spell = await ensureCustomSpell();

    // ---------- 3. Grimoire : fusion + badge or ----------
    await page.goto(sheetUrl(seed().clerc.id));
    await expect(page.getByText(seed().clerc.name).first()).toBeVisible();
    await openTab(page, 'Sorts');
    await expect(page.getByRole('heading', { name: 'Emplacements de sort' })).toBeVisible();

    // Mobile : le grimoire vit dans une bottom sheet ouverte par « + Ajouter ».
    await page.getByRole('button', { name: '+ Ajouter' }).first().click();
    // Le catalogue desktop (`hidden lg:block`) reste dans le DOM : on SCOPE
    // la sheet pour ne viser que le catalogue visible.
    const sheet = page.getByRole('dialog', { name: 'Grimoire' });
    // Recherche du catalogue : le custom fusionne, badge or en suffixe.
    await sheet.getByPlaceholder('Rechercher un sort…').fill('Serpente');
    const catalogRow = sheet.getByRole('listitem').filter({ hasText: SPELL_NAME }).first();
    await expect(catalogRow).toBeVisible();
    await expect(catalogRow.getByText('Sort de la table')).toBeVisible();
    const addBtn = catalogRow.getByRole('button', { name: '+ Ajouter' });
    // Idempotent (replay/retry) : « Sort déjà connu » = déjà appris.
    if ((await addBtn.count()) > 0) await addBtn.click();

    // ---------- 4. Lancer : l'aperçu d'upcast lit la table ----------
    // Mira Clerc 5 : emplacements 4/3/2/1 — le niveau 3 est un cran
    // supérieur au niveau natif 2, la table donne « 4d6 ».
    // Le filtre « Préparés » est actif par défaut : fermer la sheet puis
    // déplier « Tous » pour voir le sort fraîchement appris (non préparé).
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: 'Tous' }).click();
    await expect(page.getByRole('button', { name: `Lancer ${SPELL_NAME}` })).toBeVisible();
    // Ligne connue (la première du DOM — le catalogue desktop caché vient
    // après le panneau des sorts connus) : badge or en suffixe du nom.
    const knownRow = page.getByRole('listitem').filter({ hasText: SPELL_NAME }).first();
    await expect(knownRow.getByText('Sort de la table')).toBeVisible();
    await page.getByRole('button', { name: `Lancer ${SPELL_NAME}` }).click();
    const castSheet = page.getByRole('dialog', { name: `Lancer ${SPELL_NAME}` });
    await expect(castSheet).toBeVisible();
    await castSheet.getByRole('button', { name: /^Niveau 2/ }).click();
    await expect(castSheet.getByText('3d6 dégâts de poison')).toBeVisible();
    await castSheet.getByRole('button', { name: /^Niveau 3 supérieur/ }).click();
    await expect(castSheet.getByText('4d6 dégâts de poison')).toBeVisible();
    // Concentration 🌀 : le flux du custom est celui du SRD.
    await expect(castSheet.getByText(/concentration/i).first()).toBeVisible();
    await page.keyboard.press('Escape'); // contrat du CastSpellSheet : Échap ferme
    expect(spell.source).toBe('custom');
  });
});

gmTest.describe('Sort personnalisé (MD, suite)', () => {
  gmTest('édition propagée puis garde-fou de suppression', async ({ page }) => {
    const spell = await ensureCustomSpell();
    // La clerc seedée connaît le sort (l'apprentissage de la spec joueur —
    // replayable : upsert idempotent au nom du MD).
    await fetch(`${API_BASE}/api/characters/${seed().clerc.id}/spells`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${seed().gm.token}`,
      },
      body: JSON.stringify({ spellId: spell.id, prepared: true }),
      signal: AbortSignal.timeout(5000),
    });

    await page.goto(`/party/${seed().partyId}/gm`);
    await page.getByRole('button', { name: 'Sorts custom' }).click();
    const row = page.getByRole('listitem').filter({ hasText: SPELL_NAME }).first();
    await expect(row).toContainText('Connu par 1');

    // ---------- 5. Édition entre séances : les dés corrigés ----------
    await row.getByRole('button', { name: 'Modifier' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByLabel('Dégâts', { exact: true })).toHaveValue('3d6');
    await modal.getByLabel('Dégâts', { exact: true }).fill('4d6');
    await modal.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(modal).toBeHidden();
    const edited = await findCustomSpell(SPELL_NAME);
    expect(JSON.parse(edited.damageJson).damage_at_slot_level['3']).toBe('5d6');

    // ---------- 6. Garde-fou : 409 + porteurs, puis CASCADE forcée ----------
    const confirm = row.getByRole('button', {
      name: new RegExp(`Supprimer « ${SPELL_NAME} »`),
    });
    await confirm.click();
    await confirm.click(); // armé puis confirmé → 409 → modal de conséquences
    const consequences = page
      .getByRole('dialog')
      .filter({ hasText: `Supprimer « ${SPELL_NAME} » ?` });
    await expect(consequences).toContainText('Ce sort est connu par :');
    await expect(consequences).toContainText(`${seed().clerc.name} (Clerc 5)`);
    await expect(consequences).toContainText(/perdront ce sort/);
    await consequences.getByRole('button', { name: 'Supprimer ?' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: SPELL_NAME })).toHaveCount(0);

    // État servi : le lien de la clerc est parti (CASCADE), le sort aussi.
    const learned = await fetch(`${API_BASE}/api/characters/${seed().clerc.id}/spells`, {
      headers: { authorization: `Bearer ${seed().player.token}` },
      signal: AbortSignal.timeout(5000),
    });
    const learnedBody = (await learned.json()) as { spells: any[] };
    expect(learnedBody.spells.some((s) => s.spell.id === spell.id)).toBe(false);
    expect(await findCustomSpell(SPELL_NAME)).toBeNull();
  });
});
