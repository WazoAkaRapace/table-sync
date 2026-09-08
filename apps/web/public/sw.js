/*
 * Service worker Table Sync — push Web Push + cache de coquille.
 *
 * Le cache reste SOUS TUTELLE du mécanisme de fraîcheur existant :
 *  - /api/* et /version.json ne passent JAMAIS par le SW — les données
 *    vivent au réseau (fraîcheur pilotée par les WebSocket), et la sonde de
 *    version du bandeau doit voir le vrai serveur ;
 *  - les navigations vont d'abord au réseau — la coquille reste
 *    revalidée à chaque chargement, le cache n'est que le repli hors ligne ;
 *  - /assets/* (hashés, `immutable` côté nginx) et fichiers racine
 *    précachés sont servis cache-d'abord — le même contrat que leur
 *    Cache-Control, en instantané et hors ligne.
 *
 * Précache : le build injecte le manifeste en tête de fichier (plugin vite
 * « table-sync:precache-sw » → self.__PRECACHE_MANIFEST__, version + liste
 * d'URLs). Chaque déploiement change les octets du SW → réinstallation →
 * précache dans un cache versionné, les anciens caches sont purgés à
 * l'activation. Le bandeau de mise à jour (UpdateBanner) déclenche
 * registration.update() à la dérive de version puis n'annonce
 * « Recharger » qu'une fois le précache fini (broadcast « precache-done »)
 * — le rechargement retombe alors dans un cache tiède, même sur la radio
 * lente de la table. Hors ligne, l'app démarre sur la coquille cachée.
 *
 * Chaîne push : l'API envoie au push service du navigateur → événement
 * `push` ci-dessous → notification système → clic → focus de l'app ou lien
 * profond. Titre/corps arrivent déjà localisés par le serveur (locale figée
 * à l'abonnement) : ce fichier n'affiche que ce qu'il reçoit.
 */

// Manifeste de précache : l'injecteur du build le prépose en tête de fichier
// (ligne self.__PRECACHE_MANIFEST__ = {...}). En dev, vite sert CE fichier
// tel quel : manifeste vide = aucun précache, le handler fetch est de fait
// inerte (vite ne sert rien sous /assets/).
const PRECACHE_MANIFEST = self.__PRECACHE_MANIFEST__ || { version: 'dev', urls: [] };

// Le nom porte la version : un déploiement = un cache neuf, l'ancien est
// purgé à l'activation. (Version « dev » en local.)
const CACHE_NAME = `table-sync-shell-v${PRECACHE_MANIFEST.version}`;

// Résolution contre le scope, pas l'origine : reste juste si l'app vit un
// jour sous un sous-chemin (même idiome que les icônes de notification).
const abs = (p) => new URL(p, self.registration.scope).href;

// Petites vagues parallèles : saturer la radio de la table ne sert à rien,
// le SW partage la bande passante avec les requêtes de l'app.
const PRECACHE_CONCURRENCY = 4;

// Bilan du dernier précache (répondu aux sondes « precache-status »).
let lastPrecacheFailed = 0;

// ---------------------------------------------------------------------------
// Cache de coquille
// ---------------------------------------------------------------------------

async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  const failed = [];
  const urls = [...PRECACHE_MANIFEST.urls];
  for (let i = 0; i < urls.length; i += PRECACHE_CONCURRENCY) {
    await Promise.all(
      urls.slice(i, i + PRECACHE_CONCURRENCY).map(async (url) => {
        try {
          // cache:'reload' : le cache HTTP ne peut pas empoisonner le SW.
          const res = await fetch(new Request(abs(url), { cache: 'reload' }));
          if (!res.ok) throw new Error(String(res.status));
          // La coquille est aussi posée sous '/index.html' : le repli hors
          // ligne sert CETTE clé quelle que soit l'URL naviguée (SPA).
          if (url === '/') await cache.put(abs('/index.html'), res.clone());
          await cache.put(abs(url), res);
        } catch {
          failed.push(url);
        }
      }),
    );
  }
  return failed;
}

async function cacheFirst(req) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

async function shellFallback() {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(abs('/index.html'))) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  // Données vivantes + sonde de version : jamais interceptés.
  if (path.startsWith('/api/') || path === '/version.json') return;
  // Navigations : réseau d'abord (coquille revalidée), cache en repli hors
  // ligne — y compris pour les liens profonds SPA (/party/…, tout chemin).
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => shellFallback()));
    return;
  }
  // Assets hashés + fichiers racine précachés : cache d'abord, le réseau
  // remplit les trous (une page ANCIENNE qui demande un asset absent du
  // cache courant retombe sur le réseau, jamais en erreur).
  if (path.startsWith('/assets/') || PRECACHE_MANIFEST.urls.includes(path)) {
    event.respondWith(cacheFirst(req));
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const failed = await precacheAll();
      lastPrecacheFailed = failed.length;
      await self.skipWaiting();
      await broadcastPrecacheDone();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge des caches des versions précédentes.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Protocole page ↔ SW : le bandeau sonde l'état du précache du contrôleur
// (l'installation a pu être consommée lors d'une visite précédente — le
// broadcast n'arrivera jamais). Un contrôleur ACTIF a par construction fini
// son installation : la réponse dit au bandeau si la version servie est tiède.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache-status') return;
  event.source?.postMessage(precacheDoneMessage());
});

function precacheDoneMessage() {
  return {
    type: 'precache-done',
    version: PRECACHE_MANIFEST.version,
    failed: lastPrecacheFailed,
  };
}

async function broadcastPrecacheDone() {
  const windowClients = await self.clients.matchAll({ type: 'window' });
  for (const client of windowClients) client.postMessage(precacheDoneMessage());
}

// ---------------------------------------------------------------------------
// Web Push (inchangé)
// ---------------------------------------------------------------------------

// Une fenêtre visible = l'app est à l'écran : le WebSocket et le widget de
// combat informent déjà (TurnSlash, dock), une notification serait du bruit.
// On n'affiche que si l'app est fermée ou en arrière-plan — SAUF payload
// `force` : la notification de TEST vérifie la chaîne app ouverte, la
// supprimer la ferait « ne rien faire ».
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
      if (!payload.force && (await hasVisibleClient())) return;
      // Icônes en URL ABSOLUE : Chrome Android ne résout pas les chemins
      // relatifs du champ `icon` et rend un carré blanc — desktop, lui, s'en
      // accommode. Résolution contre le scope, pas origin, pour rester juste
      // si l'app vit sous un sous-chemin.
      // Grand icône = le SCEAU (emblème sur disque blanc) : l'icône carrée
      // sombre de l'app est illisible sur la nuance sombre d'Android. Le
      // PETIT icône (masque alpha teinté) vient du manifest purpose
      // "monochrome" — voir icon-mono.svg.
      await self.registration.showNotification(payload.title || 'Table Sync', {
        body: payload.body || '',
        icon: abs('/icon-seal-192.png'),
        badge: abs('/icon-mono-192.png'),
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
