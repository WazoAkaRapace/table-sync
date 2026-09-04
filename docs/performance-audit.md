# Audit performance & connectivité — vieille tablette, lien lent (2026-09)

> **État d'implémentation (branche `perf/connectivity-optimizations`, 2026-09-04) :**
> tout l'audit est implémenté SAUF le heartbeat WebSocket (§P2-11 — décision
> « no heartbeat » documentée + verrouillée par les asserts de
> `mod-sync-stress.ts`, à rediscuter séparément). Les gains mesurés :
> coquille de login ~994 KB brut → ~132 KB gzippés (compression + régimes
> i18n/catalogues), 304 sans corps sur les catalogues SRD, inventaire en
> résumé (~80 % de prose en moins), recherche monstres sans UDF par ligne,
> resync globale à la reconnexion WS (spec e2e `offline-resync.spec.ts`),
> et le recalcul local des poids après mutation (moteur partagé
> `computeInventoryWeights`). Suites : lint ✓, 5 règles ✓, test-api ✓ (18
> modules + asserts ETag/résumé), e2e 82/82 ✓.

**Objectif :** la table joue sur une vieille tablette avec un réseau instable et à forte latence.
**Méthode :** 6 investigations parallèles (bundle/assets, fetch client & polling, payloads API,
transport nginx/Docker, résilience réseau, runtime CPU/GPU) + build de production réel pour les
chiffres. Les affirmations clés ont été revérifiées à la main dans le code.

---

## TL;DR — les 10 problèmes dominants

| # | Problème | Où | Effet sur la tablette |
|---|----------|----|----------------------|
| 1 | **Aucune compression HTTP** (pas de gzip nginx, pas de `@fastify/compress`) | `nginx.conf`, `apps/api/src/server.ts` | Chaque octet voyage ~5× trop gros : visite à froid ≈ 990 KB au lieu de ~300 KB |
| 2 | **WebSocket half-open indétectable** (aucun heartbeat, aucun watchdog) | `apps/web/src/sync.tsx`, `apps/api/src/sync/ws.ts` | Le point vert ment : événements perdus pour toujours jusqu'au reboot de l'app |
| 3 | **Pas de resync après reconnexion** (seul CombatWidget refetch) | `sync.tsx`, `CombatPage.tsx`, sheet | Après un trou réseau, la fiche/le tracker affichent des données périmées |
| 4 | **Aucun timeout de requête** (axios timeout = 0, zéro AbortController) | `apps/web/src/api.ts:4-7` | Requête black-holeée = spinner infini, lignes « busy » bloquées |
| 5 | **Offline au boot = déconnexion forcée** (le `.catch()` de `/me` efface la session sur TOUTE erreur) | `apps/web/src/auth.tsx:70-75` | Ouvrir la PWA dans un trou réseau déconnecte le joueur |
| 6 | **Uploads cassés** : `client_max_body_size` nginx 1 Mo vs limite API 5 Mo | `nginx.conf` (absent) vs `server.ts:89` | Photo de tablette 1–5 Mo → 413 avant d'atteindre Fastify |
| 7 | **Payloads obèses** : descriptions complètes dans les listes (inventaire ~48 KB, sorts connus ~50 KB, détail de groupe avec backstory 10–30 KB, page items 45–190 KB) | `routes/inventory.ts`, `character-spells.ts`, `parties.ts`, `items.ts` | Chaque ouverture de fiche / chaque événement combat re-télécharge la prose |
| 8 | **Tempête de refetch par `combat:change`** : chaque tour de GM ≈ 20–30 requêtes table-wide, 0.5–1.5 MB | `CombatPage.tsx:254`, `CharacterInventoryPage.tsx:607-670`, `CombatWidget.tsx:139`, `GmDashboardPage.tsx:94-101` | À 300–800 ms de RTT, chaque tour est une cascade de secondes |
| 9 | **Bundle de boot** : 2 locales i18n (227 KB) + catalogue FR+EN de traits de classe (230 KB) dans les chunks partagés ; login ≈ 990 KB | `src/i18n/index.ts:14-15`, `packages/shared/src/index.ts:18-21` | Premier téléchargement inutilement lourd, cache peu granulaire |
| 10 | **GPU/CPU vieille tablette** : `backdrop-blur` sur CHAQUE `.card` (donc chaque ligne d'inventaire), 0 `React.memo` dans l'app, moteur de règles appelé par ligne à chaque render | `index.css:134-139`, `InventoryRow.tsx:350`, `CharacterInventoryPage.tsx` (1534 lignes) | Scroll < 20 fps possible, frappe dans la recherche = re-render total |

---

## Chiffres mesurés (build de production réel, vite 8)

| Chunk | Brut | gzip | Chargé par |
|-------|------|------|------------|
| `index-*.js` (entrée) | 605 KB | 194 KB | eager — contient react-dom, axios, i18next **+ fr.json 117 KB + en.json 110 KB** |
| `ui-*.js` | 301 KB | 86 KB | **toutes les pages, y compris /login** — contient ~230 KB de catalogues de traits de classe FR+EN |
| `CharacterInventoryPage-*.js` | 300 KB | 80 KB | route fiche (incl. dnd-kit, TutorialHost/joyride 82 KB) |
| `index-*.css` | 84.6 KB | 15.3 KB | eager |
| 13 autres chunks lazy | 2–42 KB | 1–12 KB | routes — découpage correct |

- **Visite à froid → login peint : ~990 KB–1 MB sur le fil** (915 KB JS+CSS + Google Fonts
  render-blocking + icônes). Avec gzip seul : ~300 KB. Avec gzip + P1 (locales/catalogues sortis) : ~215 KB.
- **Boot d'une fiche joueur** (9 requêtes séquentielles, ~27 requêtes SQL côté serveur) :
  ≈ 115–140 KB non compressés, 8–9 RTT. Avec gzip : ~20–25 KB. Avec prose retirée des listes : ~8 KB compressés.
- **Idle, fiche joueur ouverte** : ~4 req/min (poll CombatWidget 30 s : liste encounters + 1 détail,
  **tourne aussi onglet caché et sur mobile où le widget est invisible**).
- **Un tour de GM (next-turn + dégâts)** : ≈ 20–30 requêtes sur toute la table, 0.5–1.5 MB.

---

## P0 — Quick wins config (heures, zéro risque code)

### 1. Compression — LE levier n°1
Rien n'est compressé nulle part : `nginx.conf` n'a aucune directive gzip (le `gzip on` par défaut
de `nginx:alpine` ne couvre que `text/html`), l'API n'a pas `@fastify/compress`, et `dist/` n'a
aucun `.gz`/`.br` précompressé. JS/CSS/JSON/SVG traversent le lien en brut (~4–8× de gâchis).

```nginx
# nginx.conf, dans le bloc server
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_vary on;
gzip_proxied any;
gzip_types application/javascript application/json text/css image/svg+xml
           text/plain application/manifest+json font/woff2;
```

Côté API (le proxy nginx ne compresse que ses propres réponses statiques si on ne gzip que nginx —
les réponses `/api/` **proxifiées** nécessitent soit `gzip_proxied any` + le bloc ci-dessus, soit
`@fastify/compress` dans l'app) :

```ts
import compress from '@fastify/compress';
await app.register(compress, { threshold: 1024 });
```

Alternative/renfort : `vite-plugin-compression` à la build + `gzip_static on;` (gzip une fois au
build plutôt qu'à chaque requête).

### 2. `client_max_body_size 6m;` — bug fonctionnel
Le limiteur d'upload API est 5 Mo (`server.ts:89`, `item-images.ts:139`) mais nginx coupe à 1 Mo
par défaut → toute photo annotée entre 1 et 5 Mo meurt en 413 avant d'atteindre Fastify.

### 3. `index.html` sans Cache-Control
`location / { try_files … }` n'émet aucun header → cache heuristique du navigateur, coquille
potentiellement périmée après un déploiement (UpdateBanner rattrape, mais un boot périmé est possible).
Ajouter `location = /index.html { add_header Cache-Control "no-cache"; }` et
`location = /manifest.json { expires 1h; }` (le manifest n'est couvert par aucune règle actuelle).

### 4. Timeout axios
`api.ts:4-7` — `axios.create({ baseURL, headers })`, aucun `timeout` (défaut 0 = attendre
indéfiniment). Sur radio black-holeée : spinner infini. `timeout: 15000` +
traitement `ECONNABORTED` (toast avec bouton Réessayer plutôt que bannière `ErrorMsg` passive).

### 5. Offline au boot ≠ session invalide
`auth.tsx:70-75` : le `.catch()` de `GET /api/auth/me` efface token+user sur **n'importe quelle**
erreur. Une coupure réseau au lancement = déconnexion forcée. Ne purger que sur 401 réel
(`err.response?.status === 401`), garder l'utilisateur caché sur `ERR_NETWORK`/timeout.

### 6. Keepalive upstream + HTTP/1.1 sur `/api/`
`proxy_pass` via variable (`nginx.conf:15-18`) = nouvelle connexion TCP vers `api:4000` à chaque
requête, et `proxy_http_version` par défaut 1.0. Migrer vers un bloc
`upstream api_backend { server api:4000; keepalive 16; }` + `proxy_http_version 1.1;` +
`proxy_set_header Connection "";` (on perd l'astuce du resolver anti-boot-fail — acceptable, ou
garder la variable et vivre avec le churn interne, qui est bon marché sur le réseau compose).
HTTP/2 : à activer chez le terminateur TLS en amont (hors repo) — multiplexage utile à forte latence.

---

## P1 — Régime des payloads (1–2 jours)

### 7. Retirer la prose des listes
- **Inventaire** (`routes/inventory.ts:48-84,199`) : chaque ligne embarque `item.description`
  complète (~1.2 KB/ligne → 48 KB pour 40 lignes), **re-téléchargé après CHAQUE mutation** (le
  pattern PATCH-puis-GET-full-inventory). Striper `description`/`image_path` de l'item embarqué ;
  l'UI de détail le charge à l'ouverture (route déjà là).
- **Sorts connus** (`routes/character-spells.ts:137-152`) : JOIN colonnes complètes → ~1.7 KB/sort,
  50 KB pour 30 sorts, refetch à chaque ouverture de fiche. Liste = id/nom/niveau/préparé ;
  description lazy via `GET /api/spells/:id`.
- **Catalogue items** (`routes/items.ts:110-117`) : `cols(items)` complet, 45–50 KB/page de 50,
  190 KB pour la page GM `limit:200`. Projection légère pour la liste (le `/api/items/:id` garde tout).
- **Détail de groupe** (`routes/parties.ts:180-218`) : `mapCharacterSummary` traîne
  backstory/appearance/personalityTraits — 10–30 KB par fetch, fetch multiplié par surface
  (`usePartyRole`, `PartyPage`, `NpcPage`, `GmDashboard`). Un vrai résumé (id, nom, classe, niveau,
  portrait) suffirait au roster.
- **Monstres** (`routes/monsters.ts:180-199`) : le SELECT de recherche lit `overlay_en` (~1.6
  KB/monstre × 964) juste pour le nom EN, et le LIKE passe par l'UDF JS `normalize()` → ~1.5 MB de
  normalisation JS par recherche. Précalculer une colonne de recherche normalisée au seed.

### 8. Cache HTTP pour les données de référence SRD
Items/spells/monsters sont statiques entre déploiements, mais `GET /api/items|spells|monsters`
n'émet ni ETag ni Cache-Control (seul `item-images.ts:119-131` fait bien le travail). Ajouter un
ETag (hash version de seed + query) + `Cache-Control: private, max-age=86400` et honorer
If-None-Match → les catalogues deviennent gratuits (304) après la première visite.

### 9. Mutations : renvoyer l'entité mutée
Chaque mutation suit le pattern PATCH → re-GET complet (2 RTT minimum, payload entier). Faire
renvoyer la ressource modifiée par le PATCH et l'appliquer via `setQueryData` : HP, quantités,
équipement, sorts préparés. Divise le coût par action et supprime la fenêtre de course.

### 10. Bundle : sortir le mort du boot
- **Locales i18n** : `src/i18n/index.ts:14-15` importe `fr.json` (117 KB) + `en.json` (110 KB)
  statiquement — les deux dans l'entrée. Lazy-loader la locale inactive (~18 KB gz gagnés + entrée
  plus petite).
- **Catalogues de traits de classe** : `packages/shared/src/index.ts:18-21` ré-exporte
  `classFeatures.ts` (112 KB) + `.en.ts` (156 KB) ; consommés par `CharacterFeaturesTab` et
  `AddClassSheet` mais finissent dans le chunk partagé `ui-*.js` (301 KB) que **toutes** les pages
  téléchargent, login compris. Importer les catalogues depuis une seule feuille lazy → chunk ui
  ~60–70 KB.
- **joyride sur AccountPage** : `AccountPage.tsx:19` importe `tutorial/serverSync` → entraîne le
  chunk TutorialHost (82 KB avec joyride+floating-ui) sur la page Mon compte. Déplacer
  `serverSync.ts` dans un module autonome.
- **TutorialHost statique dans la fiche** : monter en `lazy()` derrière le flag localStorage
  `dnd-inv-tour-seen` (82 KB de moins pour les joueurs ayant fini la visite).
- **Google Fonts render-blocking** (`index.html:26-29`) : CSS cross-origin dans le chemin critique
  (2 DNS+TLS avant la première peinture). Self-héberger un woff2 Cinzel sous-ensemencé + preload.
- **Cible de build** : aucun `build.target` dans `vite.config.ts` — défaut ≈ Chrome 107/Safari 16.
  Si la tablette est en dessous, le bundle ne parse même pas. Pincer `es2020` et tester sur l'appareil.

---

## P2 — Robustesse temps réel sur lien instable

### 11. Le WebSocket muet (décision « no heartbeat » à revisiter pour CE déploiement)
Constat croisé : `nginx.conf` tolère 24 h de silence (`proxy_read_timeout 86400`), mais le
**proxo TLS en amont (hors repo)** coupera une connexion muette à ~60 s (défaut nginx) ou ~100 s
(Cloudflare). Aucun ping nulle part (client `sync.tsx`, serveur `sync/ws.ts`), et
`mod-sync-stress.ts:150-151` **verrouille** ce comportement par des asserts « zéro trame ping ».

Conséquences sur lien pourri :
- socket proprement droppée → reconnexion 2/4/8/10 s (backoff sans jitter, sans max) — OK ;
- **socket half-open** (NAT/wifi silencieux) → le point vert reste vert indéfiniment, tous les
  événements sont perdus, seule l'OS-kill au passage en arrière-plan sauve ;
- handshake black-holeé → coincé en `connecting` jusqu'au timeout TCP de l'OS (dizaines de secondes).

Un watchdog client « si aucune trame depuis 60 s, fermer » ne marche PAS : une table calme est
légitimement muette pendant des minutes. La seule détection fiable est un vrai ping/pong.

**Recommandation :** réintroduire un heartbeat serveur `ws.ping()` toutes les 30–45 s (2 octets,
négligeable même en 2G) + côté client `pong` attendu sous N secondes sinon `ws.close()` pour
déclencher le backoff. **Cela inverse une décision documentée (AGENTS.md + test) — à faire
explicitement** : mettre à jour `mod-sync-stress.ts` (les asserts zero-ping deviennent des asserts
de cadence), et vérifier/monter le `proxy_read_timeout` du proxy frontal au-dessus de l'intervalle.
Alternative minimale sans toucher au protocole : garantir que le proxy frontal tolère l'idle
longtemps (p.ex. 24 h) — mais le half-open NAT reste alors indétectable.

### 12. Resync à la reconnexion — généraliser CombatWidget
`CombatWidget.tsx:129-137` est le SEUL à refetch quand `status → 'connected'`. La fiche
(`['inventory']`), le tracker GM (`CombatPage`), les messages non lus et le dashboard restent
périmés jusqu'au prochain événement. Dans `SyncProvider` : sur la transition connected,
`queryClient.invalidateQueries()` (ou invalidation ciblée) + forcer la reconnexion au
`visibilitychange` visible si le socket est douteux. Ajouter du jitter au backoff
(`delay * (0.5 + Math.random())`) pour éviter le troupeau après restart serveur.

### 13. Courses de latence
- **HP last-write-wins** : le PATCH debouncé (1 s) de la fiche porte une valeur absolue calculée
  au clic ; une écriture tracker GM plus fraîche peut être écrasée (fenêtre élargie par la latence).
  Annuler le patch pending quand `character.currentHp` change en dessous (`HpTracker.tsx:53-65`).
- **HpTracker** : l'optimiste n'est JAMAIS annulé en cas d'échec (mauvais PV affiché jusqu'au
  prochain refetch) et le flush au démontage `.catch(() => {})` **perd silencieusement** l'édition
  (`HpTracker.tsx:87-97`). Resynchroniser depuis le serveur à l'échec + toaster l'échec du flush.
- **CombatPage** n'a pas le garde-fou `loadSeq` que CombatWidget a (`CombatWidget.tsx:83`) : une
  réponse GET retardée peut écraser un état plus récent du tracker. Porter le garde.

### 14. UX dégradée
Bannière offline (`online`/`offline` + `navigator.onLine` — zéro usage aujourd'hui), bouton
Réessayer sur `ErrorMsg` (actuellement statique), error boundary par route pour qu'un chunk qui
échoue au chargement (connexion coupée à mi-téléchargement) ne blanchisse pas toute l'app.
Test : aucune spec ne simule latence/perte (`context.setOffline` absent des e2e) — en ajouter une
(déconnexion mi-combat → reconnexion → resync asserté).

---

## P3 — Runtime vieille tablette (CPU/GPU)

### 15. `backdrop-blur-sm` sur chaque `.card` — LE tueur GPU
`index.css:134-139` : 87 usages, y compris **chaque ligne d'inventaire** (`InventoryRow.tsx:106`)
et chaque ligne de catalogue. Des dizaines de surfaces backdrop-filter = re-floutage GPU par frame
au scroll. Rendre `.card` opaque (`bg-white`), garder le blur pour 1–2 couches flottantes
(dock, bandeau épinglé).

### 16. Zéro `React.memo` dans toute l'app + moteur de règles en render
- `CharacterInventoryPage.tsx` : 1534 lignes, ~28 `useState`, chaque frappe de recherche
  catalogue re-render TOUT (lignes, bandeau, onglets, modals). `React.memo` sur `InventoryRow` +
  `useMemo` sur `grouped`/`entries`.
- `computeWeaponStats` par ligne d'arme à chaque render, y compris lignes repliées
  (`InventoryRow.tsx:350`) — `resolveMagicWeaponBase` re-trie 37 armes et construit ~74 RegExp par
  appel (`packages/shared/src/index.ts:3036-3048`). `computeAC`/`computeSpellcastingPools` dans le
  bandeau à chaque render (`CharacterStateBand.tsx:125,136`). `useMemo` partout.
- `SyncContext` : valeur objet inline (`sync.tsx:200`) → chaque flap WS re-render tous les
  consommateurs. `useMemo`.

### 17. Animations box-shadow infinies
`combat-turn-glow` (1.8 s, jusqu'à 3 éléments simultanés) et `target-breathe` (1.6 s × chaque
carte de combatant en mode dégâts) — box-shadow ne se compose pas = repaint continu du main thread.
Remplacer par un pseudo-élément animé en `opacity`.

### 18. Poll & événements
- Le poll 30 s de CombatWidget tourne **onglet caché** et **sur mobile où le strip est invisible**
  (`hidden lg:flex` du slot) : gater sur `document.visibilityState` + `matchMedia('(min-width:1024px)')`.
- Sur desktop, CombatWidget ET l'effet hub de la fiche fetchent encounters+détails à chaque
  `combat:change` (doublon) ; l'effet hub est séquentiel (détails un par un) — paralléliser/dédupliquer.
- `GmDashboardPage.tsx:94-101` écoute TOUS les types d'événements → un joueur qui change une
  quantité = 2 + N refetch d'inventaires complets sur le dashboard GM ouvert. Filtrer par type
  (idem `NpcPage.tsx:107-114`).

---

## Ce qui est déjà bien (ne pas casser)

- Découpage lazy des 16 routes (zéro chunk statique dans l'entrée), sourcemaps off.
- Assets hashés `immutable` 1 an + `no-cache` exact-match sur sw.js/version.json ; ETag/304 sur
  les images d'items avec cache-buster `?v=`.
- `attachCharacterClasses` batché (`inArray`, aucun N+1 vérifié) ; encounters + rosters en
  requêtes groupées ; payloads combat/encounter légers ; noms de monstres cachés redactés serveur.
- Rate limiting scoped erreurs (une table derrière une IP ne se fait pas bannir), debounces 300 ms
  sur toutes les recherches, pagination 30 des catalogues, steppers HP debouncés 1 s avec flush au
  démontage (le mécanisme — pas sa gestion d'erreur), optimistic update du tracker GM avec rollback.
- Debounce WS 300 ms par type d'événement, `loadSeq` dans CombatWidget, garde
  `JSON.stringify` sur le snapshot hub combat.

## Ordre d'attaque suggéré

1. **P0 complet** (une après-midi) : compression + body size + cache headers + timeout axios +
   fix logout offline + keepalive. Gain immédiat ~70–80 % de bande passante, zéro risque.
2. **P7/P8/P9** (payloads + caches HTTP + mutations renvoyées) : le plus gros gain par requête
   après compression, en particulier pendant les combats.
3. **P11/P12** (temps réel) : décision heartbeat à trancher, puis resync généralisé — c'est ce qui
   rendra l'app utilisable pendant les coupures.
4. **P10** (bundle) et **P15–P18** (runtime tablette) en fond, indépendants et cumulatifs.
