/**
 * Correspondance secrète MD ↔ joueur — le chemin complet en live :
 * le MD écrit depuis sa boîte, la bannière tombe sur la fiche OUVERTE chez
 * la joueuse (WS ciblé), « Ouvrir » mène au fil, la réponse reflue chez le
 * MD et le « Vu » coche la ligne de la joueuse. L'annexe de la table des
 * matières porte la porte MD.
 */
import { expect } from 'playwright/test';
import { gmTest, seed, sheetUrl } from './fixtures';

const TOUR_TABS = JSON.stringify([
  'survival',
  'stats',
  'spells',
  'skills',
  'inventory',
  'features',
  'description',
  'npcs',
  'notes',
  'messages',
]);

gmTest(
  'le MD écrit, la bannière tombe chez la joueuse, la réponse reflue',
  async ({ page: gmPage, browser }) => {
    // — Page joueuse : fiche de Kael, onglet Survie, aucune interaction —
    const playerCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'fr-FR',
    });
    await playerCtx.addInitScript(
      ({ token, user, tourTabs }) => {
        localStorage.setItem('dnd-inv-token', token);
        localStorage.setItem('dnd-inv-user', JSON.stringify(user));
        localStorage.setItem('dnd-inv-tour-seen', '1');
        localStorage.setItem('dnd-inv-tour-tabs', tourTabs);
      },
      { token: seed().player.token, user: seed().player.user, tourTabs: TOUR_TABS },
    );
    const playerPage = await playerCtx.newPage();
    await playerPage.goto(sheetUrl(seed().guerrier.id));
    await playerPage.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

    // — Page MD : la boîte, le volume de Kael, le fil vierge —
    await gmPage.goto(`/party/${seed().partyId}/messages`);
    await gmPage
      .getByRole('button', { name: `Ouvrir la correspondance de ${seed().guerrier.name}` })
      .click();
    await expect(
      gmPage.getByRole('heading', { name: `Correspondance — ${seed().guerrier.name}` }),
    ).toBeVisible();

    // — Le MD scelle le secret —
    const secret = 'La cassette est sous l’autel — n’en parle à personne.';
    await gmPage.getByPlaceholder(`Écrire à ${seed().guerrier.name}…`).fill(secret);
    await gmPage.getByRole('button', { name: 'Envoyer' }).click();

    // — La bannière tombe sur la fiche, où que la joueuse se tienne —
    const banner = playerPage.getByRole('status').filter({ hasText: 'Le MD vous a écrit' });
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(seed().guerrier.name);
    await banner.getByRole('button', { name: 'Ouvrir' }).click();

    // — Le fil s'ouvre : tampon MD + le texte intégral, jamais dans la bannière —
    await expect(
      playerPage.getByRole('heading', { name: 'Correspondance avec le MD' }),
    ).toBeVisible();
    await expect(playerPage.getByText(secret, { exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0); // ouvrir le fil retire son sceau

    // — La joueuse répond ; le fil du MD la reçoit en direct —
    await playerPage.getByPlaceholder('Écrire au MD…').fill('Je fouille l’autel dès ce soir.');
    await playerPage.getByRole('button', { name: 'Envoyer' }).click();
    // (le texte vit AUSSI dans l'aperçu du registre MD — l'assert vise le fil)
    await expect(gmPage.getByText('Je fouille l’autel dès ce soir.', { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // — Le « Vu » coche la réponse chez la joueuse (reflow du marquage MD) —
    await expect(playerPage.getByText('Vu ✓').first()).toBeVisible({ timeout: 10_000 });

    await playerCtx.close();
  },
);

gmTest("l'annexe « Correspondance » ouvre la boîte du MD", async ({ page }) => {
  await page.goto(`/party/${seed().partyId}`);
  const door = page.getByRole('link', { name: 'Correspondance' });
  await expect(door).toBeVisible();
  await door.click();
  await expect(page.getByRole('heading', { name: 'Correspondance', exact: true })).toBeVisible();
});
