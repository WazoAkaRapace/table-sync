import { expect } from 'playwright/test';
import { playerTest } from './fixtures';

/**
 * Notifications push (Mon compte) — docs/push-notifications.md.
 *
 * Le serveur e2e démarre SANS VAPID : l'état réel observable est la note
 * « désactivées sur ce serveur ». Les parcours actif/désactivé passent par
 * des stubs (page.route sur /api/push/* + APIs navigateur simulées par
 * addInitScript) : un vrai abonnement exigerait le push service de
 * Chromium, hors CI — la chaîne réelle est couverte par `npm run test-api`
 * (mock push TLS) et la validation manuelle sur appareil.
 */

/** Chemin du compte (relatif — la baseURL de la config Playwright fait foi). */
const COMPTE = '/compte';

/** Stub navigateur : permission accordée + pushManager pilotable. */
function stubBrowserPush(page: import('playwright/test').Page) {
  return page.addInitScript(() => {
    const fakeSub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device-1',
      toJSON() {
        return {
          endpoint: fakeSub.endpoint,
          expirationTime: null,
          keys: { p256dh: `B${'a'.repeat(85)}`, auth: 'b'.repeat(21) },
        };
      },
      unsubscribe: () => {
        (window as any).__pushSubscribed = false;
        return Promise.resolve(true);
      },
    };
    const fakeReg = {
      pushManager: {
        subscribe: () => {
          (window as any).__pushSubscribed = true;
          return Promise.resolve(fakeSub);
        },
        getSubscription: () => Promise.resolve((window as any).__pushSubscribed ? fakeSub : null),
      },
    };
    Object.defineProperty(Notification, 'permission', {
      get: () => 'granted',
      configurable: true,
    });
    (Notification as any).requestPermission = () => Promise.resolve('granted');
    navigator.serviceWorker.getRegistration = () => Promise.resolve(fakeReg as any);
  });
}

playerTest.describe('notifications push', () => {
  playerTest('serveur sans VAPID : note dédiée, pas de bouton', async ({ page }) => {
    await page.goto(COMPTE);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/désactivées sur ce serveur/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activer les notifications' })).toHaveCount(0);
  });

  playerTest('service worker push-only enregistré et actif', async ({ page }) => {
    await page.goto(COMPTE);
    // clients.claim() dans le SW → controller non nul dès l'activation.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 10_000,
    });
  });

  playerTest('navigateur sans PushManager : note d’incompatibilité (iOS)', async ({ page }) => {
    await page.addInitScript(() => {
      // Les objets interface du global sont configurables — le delete tient.
      delete (window as any).PushManager;
    });
    await page.goto(COMPTE);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/ne gère pas les notifications web/)).toBeVisible();
    await expect(page.getByText(/écran d'accueil/)).toBeVisible();
  });

  playerTest('cycle activer → test → désactiver (stubs)', async ({ page }) => {
    await stubBrowserPush(page);
    await page.route('**/api/push/config', (route) =>
      route.fulfill({
        json: { enabled: true, publicKey: `B${'k'.repeat(85)}` },
      }),
    );
    const subscribeReqs: string[] = [];
    await page.route('**/api/push/subscribe', (route) => {
      subscribeReqs.push(route.request().postData() ?? '');
      return route.fulfill({ json: { ok: true }, status: 201 });
    });
    await page.route('**/api/push/unsubscribe', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/push/test', (route) =>
      route.fulfill({ json: { sent: 1, removed: 0, errors: [] } }),
    );

    await page.goto(COMPTE);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

    // Activation : permission + abonnement pushManager + POST subscribe.
    await page.getByRole('button', { name: 'Activer les notifications' }).click();
    await expect(page.getByText('Notifications activées')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Envoyer une notification de test' }),
    ).toBeVisible();
    expect(subscribeReqs).toHaveLength(1);
    const body = JSON.parse(subscribeReqs[0] || '{}');
    expect(body.endpoint).toBe('https://fcm.googleapis.com/fcm/send/e2e-device-1');
    expect(body.keys?.p256dh).toBeTruthy();

    // Test : toast de succès.
    await page.getByRole('button', { name: 'Envoyer une notification de test' }).click();
    await expect(page.getByText('Notification envoyée — vérifie ton écran.')).toBeVisible();

    // Désactivation : retour à l'état « Activer ».
    await page.getByRole('button', { name: 'Désactiver sur ce navigateur' }).click();
    await expect(page.getByText('Notifications désactivées')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activer les notifications' })).toBeVisible();
  });

  playerTest('test sent:0 → réabonnement forcé puis second test réparé', async ({ page }) => {
    await stubBrowserPush(page);
    // État « abonné » côté navigateur alors que la ligne serveur est morte :
    // l'UI ne doit PAS rester dans l'impasse « Désactiver » sans réparation.
    await page.addInitScript(() => {
      (window as any).__pushSubscribed = true;
    });
    await page.route('**/api/push/config', (route) =>
      route.fulfill({ json: { enabled: true, publicKey: `B${'k'.repeat(85)}` } }),
    );
    const subscribeCalls: string[] = [];
    const unsubscribeCalls: string[] = [];
    await page.route('**/api/push/subscribe', (route) => {
      subscribeCalls.push(route.request().postData() ?? '');
      return route.fulfill({ json: { ok: true }, status: 201 });
    });
    await page.route('**/api/push/unsubscribe', (route) => {
      unsubscribeCalls.push(route.request().postData() ?? '');
      return route.fulfill({ status: 204 });
    });
    let testCalls = 0;
    await page.route('**/api/push/test', (route) => {
      testCalls += 1;
      // Premier envoi : la ligne serveur est absente → sent 0.
      // Après réabonnement : l'appareil est de retour → sent 1.
      route.fulfill({
        json:
          testCalls === 1
            ? { sent: 0, removed: 0, errors: [] }
            : { sent: 1, removed: 0, errors: [] },
      });
    });

    await page.goto(COMPTE);
    await expect(page.getByRole('button', { name: 'Désactiver sur ce navigateur' })).toBeVisible();

    await page.getByRole('button', { name: 'Envoyer une notification de test' }).click();
    await expect(page.getByText('Abonnement réparé')).toBeVisible();

    // La réparation est bien passée par désabonnement + nouvel abonnement.
    expect(testCalls).toBe(2);
    expect(unsubscribeCalls).toHaveLength(1);
    expect(subscribeCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(subscribeCalls[0] || '{}').endpoint).toBe(
      'https://fcm.googleapis.com/fcm/send/e2e-device-1',
    );
  });
});
