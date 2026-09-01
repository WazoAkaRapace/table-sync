/*
 * Service worker Table Sync — notifications Web Push uniquement.
 *
 * Volontairement AUCUN handler `fetch` : le cache HTTP existant (chunks
 * immuables + index.html heuristique) reste l'unique mécanisme de fraîcheur.
 * Ajouter un cache offline serait un chantier séparé — voir
 * docs/push-notifications.md.
 *
 * Chaîne : l'API envoie au push service du navigateur → événement `push`
 * ci-dessous → notification système → clic → focus de l'app ou lien profond.
 * Titre/corps arrivent déjà localisés par le serveur (locale figée à
 * l'abonnement) : ce fichier n'affiche que ce qu'il reçoit.
 */

// Une fenêtre visible = l'app est à l'écran : le WebSocket et le widget de
// combat informent déjà (TurnSlash, dock), une notification serait du bruit.
// On n'affiche que si l'app est fermée ou en arrière-plan.
async function hasVisibleClient() {
  const windowClients = await self.clients.matchAll({ type: 'window', visible: true });
  return windowClients.length > 0;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  event.waitUntil(
    (async () => {
      if (await hasVisibleClient()) return;
      // Icônes en URL ABSOLUE : Chrome Android ne résout pas les chemins
      // relatifs du champ `icon` et rend un carré blanc — desktop, lui, s'en
      // accommode. Résolution contre le scope, pas origin, pour rester juste
      // si l'app vit sous un sous-chemin.
      const abs = (p) => new URL(p, self.registration.scope).href;
      await self.registration.showNotification(payload.title || 'Table Sync', {
        body: payload.body || '',
        icon: abs('/icon-192.png'),
        badge: abs('/icon-maskable-192.png'),
        // Même tag = la nouvelle notification remplace la précédente.
        tag: payload.tag,
        data: { url: payload.url || '/parties' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/parties', self.location.origin);
  event.waitUntil(
    (async () => {
      // Focus d'une fenêtre existante plutôt qu'une nouvelle — la session vit
      // dans localStorage, n'importe quelle fenêtre convient. On ne navigue
      // que si la fenêtre n'est pas déjà sur la cible.
      const windowClients = await self.clients.matchAll({ type: 'window' });
      for (const client of windowClients) {
        await client.focus();
        const current = new URL(client.url || target.href, self.location.origin);
        if (current.pathname !== target.pathname || current.search !== target.search) {
          try {
            await client.navigate(target.href);
          } catch {
            /* fenêtre fermée au moment du clic : le focus suffit */
          }
        }
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
