/**
 * Indicateur de synchronisation d'en-tête : pendant « Hors ligne », le délai
 * jusqu'à la prochaine tentative de reconnexion s'affiche à côté du libellé
 * (« Hors ligne (nouvelle tentative dans N s) ») — le joueur SAIT que l'app
 * réessaie toute seule et quand (pas un état mort figé).
 *
 * Méthode : context.setOffline ne coupe PAS une WS établie ( Chromium garde
 * le socket idle ouvert — constaté : l'indicateur restait « Synchronisé »).
 * On simule donc la mort du canal au niveau réseau : routeWebSocket proxie
 * tout, puis le test ferme la connexion vivante et REFUSE chaque nouvelle
 * connexion tant que « blocked » est armé. Le client vit son chemin réel de
 * panne (onclose → backoff → « Hors ligne » + compte à rebours) ; au
 * déblocage, la reconnexion suivante passe et le compteur disparaît.
 */
import { expect, type WebSocketRoute } from 'playwright/test';
import { gmTest, seed, sheetUrl } from './fixtures';

gmTest(
  'hors ligne : l’indicateur montre le délai avant la prochaine tentative',
  async ({ page: playerPage }) => {
    let blocked = false;
    let liveWs: WebSocketRoute | null = null;
    await playerPage.routeWebSocket(/\/ws$/, (ws) => {
      if (blocked) {
        ws.close({ code: 1000, reason: 'simulated network failure' });
        return;
      }
      liveWs = ws;
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });

    await playerPage.goto(sheetUrl(seed().guerrier.id));
    await expect(playerPage.getByLabel('Points de vie actuels')).toBeVisible();
    await playerPage.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });

    // — Le canal meurt (serveur/proxy coupé) ; chaque reconnexion échoue —
    blocked = true;
    liveWs?.close({ code: 1000, reason: 'simulated network failure' });

    // Compte à rebours « … dans N s » dans l'indicateur d'EN-TÊTE (le bandeau
    // navigator.onLine n'est pas concerné — hors ligne de la radio simulée,
    // l'onglet reste « online » pour le navigateur).
    const headerStatus = playerPage.locator('header [role="status"]').first();
    const withCount = async (): Promise<number | null> => {
      const text = await headerStatus.innerText().catch(() => null);
      if (text === null) return null;
      const m = text.match(/(\d+)\s*s/);
      return m ? Number(m[1]) : null;
    };

    // Un compte apparaît (backoff ≤ 10 s)…
    let first: number | null = null;
    for (let i = 0; i < 50 && first === null; i++) {
      first = await withCount();
      if (first === null) await playerPage.waitForTimeout(200);
    }
    expect(first, 'compteur affiché pendant le hors-ligne').not.toBeNull();
    expect(first!).toBeGreaterThan(0);
    expect(first!).toBeLessThanOrEqual(10);
    // …et il DÉCROÎT (ou une tentative a re-planifié — borné pareil).
    await playerPage.waitForTimeout(1200);
    const second = await withCount();
    expect(second).not.toBeNull();
    expect(second!).toBeLessThanOrEqual(first!);

    // — Retour du réseau : reconnexion, le compteur disparaît —
    blocked = false;
    await playerPage.getByLabel('Synchronisé').first().waitFor({ timeout: 20_000 });
    expect(await withCount(), 'plus de compte à rebours une fois synchronisé').toBeNull();
  },
);
