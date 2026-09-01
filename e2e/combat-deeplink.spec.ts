/**
 * Liens profonds des notifications push combat (docs/push-notifications.md).
 *
 * Le serveur e2e tourne sans VAPID — l'envoi réel est couvert par test-api ;
 * ici on vérifie la mécanique du CLIC : `?tab=…` sélectionne l'onglet (le
 * push « À toi de jouer » vise Survie) et `?combat=init` déploie la saisie
 * d'initiative du dock (push « lance ton initiative »).
 *
 * La rencontre seedée a pu démarrer entre-temps (combat.spec pilote
 * initiatives → démarrage) : la spec crée la sienne, la plus récente — c'est
 * elle que la fiche suit — où Kael rejoint sans initiative : état déterministe.
 * Elle est SUPPRIMÉE après le test : les specs suivantes (end-turn…) pilotent
 * la rencontre seedée, que la fiche ne doit pas perdre de vue.
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { playerTest, seed, sheetUrl } from './fixtures';

/** Rencontres créées par la spec — supprimées quoi qu'il arrive ensuite. */
const createdEncounters: number[] = [];

playerTest.afterEach(async () => {
  for (const id of createdEncounters.splice(0)) {
    await fetch(`${API_BASE}/api/encounters/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${seed().gm.token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      /* la rencontre est déjà partie — rien à nettoyer */
    });
  }
});

/** Rencontre dédiée où Kael rejoint sans initiative (POST joueur = déclencheur push réel, sans VAPID ici). */
async function freshEncounterWithKael(): Promise<void> {
  const s = seed();
  const encRes = await fetch(`${API_BASE}/api/parties/${s.partyId}/encounters`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.gm.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Reposte gobeline' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!encRes.ok) throw new Error(`E2E : création rencontre → ${encRes.status}`);
  const { encounter } = (await encRes.json()) as { encounter: { id: number } };
  createdEncounters.push(encounter.id);
  const addRes = await fetch(`${API_BASE}/api/encounters/${encounter.id}/combatants/player`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.gm.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ characterIds: [s.guerrier.id] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!addRes.ok) throw new Error(`E2E : Kael rejoint la rencontre → ${addRes.status}`);
}

playerTest.describe('liens profonds combat (clic notification push)', () => {
  playerTest('?tab= ouvre l’onglet demandé puis quitte l’URL', async ({ page }) => {
    // Onglet Inventaire (clé interne, pas le libellé français), pas Survie :
    // prouve que le paramètre pilote l'onglet (Survie est le défaut — il ne
    // discriminerait rien).
    await page.goto(`${sheetUrl(seed().guerrier.id)}?tab=inventory`);
    await expect(page.getByText(seed().guerrier.name).first()).toBeVisible();
    // L'onglet est monté quand la bourse (en tête d'inventaire) apparaît.
    await expect(page.getByRole('button', { name: /Bourse/ })).toBeVisible();
    // Le paramètre est consommé puis retiré : un clic ultérieur sur une
    // notification doit pouvoir re-naviguer (le SW compare aussi la query).
    await expect(page).toHaveURL(/\/character\/\d+$/);
  });

  playerTest('?combat=init déploie la carte d’initiative du dock', async ({ page }) => {
    await freshEncounterWithKael();
    const s = seed();
    await page.goto(`${sheetUrl(s.guerrier.id)}?combat=init`);
    await expect(page.getByText(s.guerrier.name).first()).toBeVisible();
    // La carte jaune au-dessus du dock est DÉPLOYÉE, input visible. Le
    // bandeau d'état porte son PROPRE bouton « Lance ton initiative » : la
    // carte du dock se distingue par son aria-expanded.
    const card = page.locator('button[aria-expanded]', { hasText: /Lance ton initiative/ });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Ton initiative')).toBeVisible();
    await expect(page).toHaveURL(/\/character\/\d+$/);
  });
});
