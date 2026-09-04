/**
 * Résilience réseau — la coupe pendant une session de jeu ne doit ni geler
 * la fiche ni perdre la synchronisation : au retour du réseau, la reconnexion
 * WS déclenche la resynchronisation globale (SyncProvider invalide les
 * requêtes actives), les événements tombés pendant le trou sont rattrapés
 * SANS rechargement.
 *
 * Scénario : la joueuse ouvre sa fiche → son appareil passe hors ligne
 * (context.setOffline) → le MD change ses PV pendant le trou → retour du
 * réseau → la fiche affiche les nouveaux PV d'elle-même.
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { gmTest, seed, sheetUrl } from './fixtures';

gmTest(
  'un trou réseau est rattrapé à la reconnexion (resync sans rechargement)',
  async ({ page: playerPage }) => {
    await playerPage.goto(sheetUrl(seed().guerrier.id));
    const hpInput = playerPage.getByLabel('Points de vie actuels');
    await expect(hpInput).toBeVisible();
    // La WS doit être connectée AVANT la coupe (indicateur d'en-tête).
    await playerPage.getByLabel('Synchronisé').first().waitFor({ timeout: 10_000 });
    const before = Number(await hpInput.inputValue());

    // — La tablette perd le réseau —
    await playerPage.context().setOffline(true);

    // — Pendant le trou : le MD (autre connexion) corrige les PV —
    const target = before >= 5 ? before - 5 : before + 5;
    const res = await fetch(`${API_BASE}/api/characters/${seed().guerrier.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${seed().gm.token}`,
        'content-type': 'application/json',
        'x-real-ip': '10.9.9.9',
      },
      body: JSON.stringify({ currentHp: target }),
    });
    expect(res.ok, 'le MD patche les PV pendant le trou réseau').toBeTruthy();
    // Laisser le temps au trou d'être « vécu » (la WS joueur est morte,
    // l'événement character:change est perdu pour elle — pas de replay).
    await playerPage.waitForTimeout(1500);
    // Hors ligne : l'UI garde l'ancienne valeur (aucune fausse nouvelle).
    expect(Number(await hpInput.inputValue())).toBe(before);

    // — Retour du réseau : reconnexion WS → resync globale → nouveau PV —
    await playerPage.context().setOffline(false);
    await expect
      .poll(async () => Number(await hpInput.inputValue()), { timeout: 15_000 })
      .toBe(target);
    // Aucun rechargement : la page n'est jamais repartie de zéro.
    expect(playerPage.url()).toContain(`/character/${seed().guerrier.id}`);
  },
);
