# Notifications push (Web Push / VAPID)

Fondation d'envoi de notifications **hors application** — écran éteint, app
fermée ou en arrière-plan. Posée en v1 comme infrastructure générique, les
déclencheurs actifs sont maintenant :

- **le bouton « notification de test »** de Mon compte ;
- **« ⚔ Le combat se prépare ! »** — le MD ajoute des PJ à une rencontre
  (`POST /encounters/:id/combatants/player`) : chaque propriétaire est invité
  à lancer son initiative, le clic ouvre sa fiche avec la saisie d'initiative
  déployée (`?combat=init`, carte du dock en mobile / tiroir en desktop) ;
- **« À toi de jouer ! »** — démarrage du combat ou avance de tour
  (`next-turn` MD comme `end-my-turn` joueur) quand le tour échoit à un PJ :
  le clic ouvre l'onglet **Survie** de la fiche (`?tab=survie`) ;
- **« ✉ Le MD vous a écrit » / « Message d'un joueur »** — correspondance
  secrète (`POST /characters/:id/messages`) : chaque envoi pousse l'autre camp
  (le propriétaire pour un message du MD, tous les MD pour un message du
  joueur ; jamais l'expéditeur). Le **corps ne contient jamais le message** —
  seulement l'émetteur et le personnage : un secret ne s'affiche pas sur un
  écran de verrouillage. Clic : onglet **Messages** de la fiche
  (`?tab=messages`) côté joueur, boîte de correspondance (`/party/:id/messages`)
  côté MD. `tag: 'message:<characterId>'` (une notification par fil),
  `ttl: 3600, urgency: 'normal'` — pertinent pour la séance, pas pour la
  semaine.

Les déclencheurs suivants (jet de concentration…) se branchent de la même
façon via `sendPushToUser()` sans toucher au navigateur.

## Architecture

```
navigateur                          API (apps/api)                push service
─────────                           ──────────────                ────────────
Mon compte → Activer
  Notification.requestPermission
  pushManager.subscribe(VAPID clé)  GET  /api/push/config   → enabled + clé
  POST /api/push/subscribe    →    push_subscriptions (upsert par endpoint)
                                   POST /api/push/test ──────────▶ POST chiffré
                                                                    (VAPID signé,
                                                                     aes128gcm)
sw.js (push-only, aucun cache)
  push → showNotification      ◀── livraison
  (fenêtre visible → silence : le WebSocket gère déjà)
  notificationclick → focus / openWindow(data.url)
```

- **Table** `push_subscriptions` : un abonnement par **appareil** (l'endpoint
  du push service est la clé naturelle, upsert à la re-souscription). La
  colonne `locale` fige la langue au moment de l'abonnement — le serveur
  localise titre/corps, le SW n'affiche que ce qu'il reçoit.
- **Service worker** (`apps/web/public/sw.js`) : volontairement sans handler
  `fetch` — aucun cache offline, le mécanisme de fraîcheur au déploiement
  reste inchangé. Enregistré depuis `main.tsx` (échec silencieux).
  Les icônes de notification sont résolues en **URL absolues** contre le
  scope du SW (`new URL(p, self.registration.scope)`) : Chrome Android ne
  résout pas les chemins relatifs du champ `icon` et rend un carré blanc
  (desktop s'en accommode) — vécu sur l'appareil, corrigé 2026-09.
  Le **grand icône** est le sceau (`icon-seal-192.png`, emblème sur disque
  blanc — l'icône carrée sombre de l'app est illisible sur la nuance
  sombre) ; le **petit icône** d'Android est un masque alpha teinté : il
  vient du manifest `purpose: "monochrome"` (`icon-mono.svg`, d20 en trait
  blanc sur transparent — l'emblème complet, sombre à ~95 % opaque, s'y
  rendrait en carré plein). ⚠️ le petit icône est figé dans la WebAPK :
  Android le resynchronise de façon asynchrone après un changement de
  manifest (jusqu'à ~24 h, ou réinstaller la PWA pour forcer).
- **Suppression « fenêtre visible »** : si l'app est ouverte à l'écran, le SW
  ne montre pas la notification (le widget de combat/TurnSlash informe déjà).
  C'est la seule suppression v1 — pas de vérification de connexion WS côté
  serveur (multi-appareils : la tablette en arrière-plan doit être notifiée
  même si le téléphone est connecté).
- **VAPID absent = fonctionnalité éteinte proprement** : `GET /api/push/config`
  répond `enabled: false`, `POST /api/push/test` renvoie 503, les abonnements
  restent stockables. Jamais d'erreur au boot — mais une ligne de log tranche
  l'état : `docker compose logs api | grep push` affiche « VAPID configuré —
  notifications web push actives » ou « VAPID absent — notifications web push
  désactivées » (et un avertissement si le jeu est PARTIEL).

## Mise en route (MD / hébergeur)

1. Générer une paire de clés **une seule fois pour la vie du serveur** :

   ```bash
   npm run vapid-keys
   # copier les trois lignes dans le .env de l'API (docker-compose les passe)
   ```

   ⚠️ Ne JAMAIS regénérer après coup : les abonnements existants sont liés à
   la paire de clés, une rotation les orpheline tous (chaque joueur repasse
   par « Activer »).

2. **HTTPS obligatoire** (contexte sécurisé exigé par les navigateurs pour
   SW + PushManager). Le TLS est terminé en amont du stack Docker de ce
   repo — si l'app est servie en `http://IP:8080`, la carte Notifications
   affiche l'explication au lieu du bouton. `localhost` est exempt (dev).

3. Côté joueur : Mon compte → Notifications → **Activer**. Un appareil =
   un abonnement ; chaque tablette le fait de son côté.

### Spécificités par plateforme

| Plateforme | Exigences |
|---|---|
| iPhone/iPad | iOS ≥ 16.4 ET app installée à l'écran d'accueil (« Ajouter à l'écran d'accueil ») — l'onglet Safari ne propose pas le push |
| Android | PWA ou Chrome/Firefox, rien de spécial |
| Desktop | Chrome/Edge/Firefox/Safari 16+, bouton native |

## Ajouter un déclencheur (la recette)

Tout déclencheur est UN appel serveur — côté navigateur rien à faire :

```ts
import { sendPushToUser } from '../push/send.ts';

void sendPushToUser(
  ownerId, // userId du destinataire
  {
    kind: 'turn',                       // nature, informative
    title: { fr: 'À toi de jouer !', en: 'Your turn!' },
    body: { fr: `Tour de ${name}`, en: `${name}'s turn` },
    url: `/party/${partyId}/combat?enc=${encId}`, // lien profond du clic
    tag: `turn:${encId}`,               // même tag = remplace l'ancienne
  },
  { ttl: 0, urgency: 'high' },          // ttl 0 : livrer maintenant ou jeter
).catch((err) => console.warn('[push] échec envoi', err));
```

Règles :

- **fire-and-forget** : jamais `await` sur le chemin critique d'une route —
  l'envoi HTTP vers le push service ne doit pas ralentir la réponse.
- **ttl** : `0` pour ce qui périme (un tour de jeu dépassé ne vaut rien) ;
  quelques minutes pour un événement rattrapable. Le test utilise `60`.
- **tag** : groupe les notifications d'un même sujet — la nouvelle remplace
  l'ancienne à l'écran.
- **titre/corps** : `{ fr, en }` (ou chaîne brute), résolus par la `locale`
  de chaque abonnement.
- Nettoyage automatique : un endpoint qui répond 404/410 supprime sa ligne —
  pas de gestion d'erreur à prévoir côté déclencheur.

## API

| Route | Rôle |
|---|---|
| `GET /api/push/config` | `{ enabled, publicKey }` — gate de l'UI |
| `POST /api/push/subscribe` | `{ endpoint, keys: { p256dh, auth } }` — upsert (endpoint unique) |
| `POST /api/push/unsubscribe` | `{ endpoint }` — suppression, scopée à l'appelant |
| `POST /api/push/test` | envoie la notification de test à ses propres appareils |

**Auto-réparation du test** (2026-09) : l'état « abonné » de l'UI lit
l'abonnement du NAVIGATEUR ; si la ligne serveur est morte (404/410
nettoyés, VAPID régénéré — tous les abonnés orphelins, WebAPK
réinstallé), l'UI croit « abonné » et n'offre que « Désactiver ». Quand
`POST /push/test` répond `sent: 0`, Mon compte refait donc un
**réabonnement forcé** (`resubscribePush` : désabonnement → nouvel
abonnement contre la clé VAPID courante → re-POST) puis relance le test
une fois — toast « Abonnement réparé » si ça passe, sinon échec honnête
avec la première erreur serveur.

## Tests

- **`npm run test-api`** (module `push notifications`) : cycle complet sur un
  vrai serveur — abonnement/upsert/ownership, envoi **réellement signé VAPID
  et chiffré aes128gcm** vers un mock push HTTPS (certificat auto-signé
  trusted via `NODE_EXTRA_CA_CERTS`), nettoyage 410, boot sans VAPID (config
  désactivée + 503). Les clés d'abonnement sont de vraies clés P-256 :
  web-push chiffre vers `p256dh`, des octets aléatoires échoueraient avant
  tout HTTP.
- **`e2e/notifications.spec.ts`** : carte Mon compte (note serveur sans
  VAPID, note d'incompatibilité, SW enregistré `clients.claim`) + cycle
  activer/test/désactiver avec navigateur simulé (stubs `page.route` +
  `addInitScript`). Un vrai abonnement exigerait le push service de Chromium
  — hors CI ; la chaîne réelle est celle de test-api + validation manuelle.
- **Manuel** (dev localhost) : `npm run vapid-keys` → exporter les 3 vars →
  `npm run dev` → Mon compte → Activer → Envoyer une notification de test.

## Pièges connus

- **nginx** : `location = /sw.js` en `no-cache` — la regex des assets
  (`immutable`, 1 an) gèlerait le SW et brickerait toute mise à jour push.
- **iOS** : pas de `Notification` dans l'onglet Safari, uniquement via la
  PWA installée — `pushSupported()` est faux, la carte l'explique.
- **web-push exige des endpoints https** (module `https` codé en dur) — le
  mock de test sert donc du TLS.
- **Payload ≤ 4 ko** après chiffrement : titre/corps courts, pas de contenu.
- Chiffrement au repos des clés d'abonnement : non fait à ce jour
  (durcissement possible en réutilisant le précédent GMA `encryptSecret`).
- Après déploiement : `docker compose pull && up -d` puis **redémarrer la
  PWA** sur les appareils pour que le nouveau sw.js soit pris en compte.
