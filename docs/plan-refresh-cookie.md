# Migration du refresh token vers un cookie HttpOnly (table-sync)

**Investigation** — réponse à « localStorage isn't secured at all ». Document de
travail ; rien n'est implémenté. Base : branche `main` + PR #127 (refresh
localStorage) si elle est déjà mergée.

**Goal:** Le refresh token ne doit plus être lisible par le JavaScript de la
page (XSS) : il vit dans un cookie HttpOnly posé par le serveur. Le JWT
courta durée (7 j) reste dans le header Bearer — sa compromission est
bornée par sa durée de vie, le refresh token devient invisible du JS.

**Verdict de l'investigation : FAISABLE, et même le cas idéal.** La topologie
est déjà celle que les cookies exigent — aucune refonte CORS/proxy.

---

## 1. Faits vérifiés dans le repo (contraintes réelles)

1. **Le web et l'API sont same-origin dans TOUS les déploiements.**
   - Docker (prod) : `nginx.conf` du web proxifie `/api/` et `/ws` vers
     `api:4000` — le navigateur ne voit qu'une seule origine. Le port API
     4010 est publié mais n'est utilisé par le frontend nulle part
     (`VITE_API_URL` vide par défaut dans `Dockerfile.web`).
   - Dev : `vite.config.ts` proxifie `/api` et `/ws` (changeOrigin).
   - E2E : playwright `webServer` lance l'API sur son port propre mais le
     contexte navigateur passe par la base web (DND_API_TARGET/API_BASE) —
     même modèle proxy. À re-vérifier au moment d'implémenter : les specs qui
     frappent l'API en direct (`page.request` avec `Authorization`) continuent
     de marcher (le JWT header n'est pas concerné par les cookies).
2. **`@fastify/cookie` n'est PAS installé** — à ajouter (`npm i -w
   @table-sync/api @fastify/cookie`).
3. **Le JWT image-URL (`itemImageUrl`, `?token=` query) et le WS (`?token=`)
   restent inchangés** : ils portent le JWT court, pas le refresh token. Le
   JWT en localStorage peut disparaître aussi (voir option B ci-dessous).
4. **Chemin de purge** : `purgeSession()` (`apps/web/src/api.ts`) supprime
   3 clés localStorage ; le cookie exige en plus un appel serveur
   (`/logout` existe déjà, répond 204) — logout doit vider le cookie.
5. **La rotation /refresh retourne aujourd'hui `{token, refreshToken, user}`**
   en JSON : le champ `refreshToken` deviendrait un `Set-Cookie` HttpOnly.

## 2. Design proposé

### Cookie

Posé par le serveur sur login / register / reset-password / refresh :

```
Set-Cookie: ts_refresh=<raw>; Path=/api/auth; HttpOnly; Secure; SameSite=Strict;
            Max-Age=2592000
```

- `Path=/api/auth` : le cookie ne part QUE sur les routes d'auth — jamais sur
  /api/items, /ws, etc. Réduit drastiquement la surface d'envoi.
- `SameSite=Strict` : pas de CSRF possible sur les routes qui l'acceptent
  (le cookie ne voyage pas sur une requête inter-site, même top-level
  navigation). **Un token CSRF dédié devient INUTILE.** — c'est le gros gain
  de la topologie same-origin.
- `Secure` : le prod passe par Pangolin/Traefik → HTTPS de bout en bout pour
  l'extérieur ; l'accès LAN direct `http://192.168.x.x:8080` **ne peut pas
  poser de cookie Secure** — ⚠ VÉRIFIER comment la tablette de la table
  accède à l'app. Solutions si le LAN http existe : (a) garder ce déploiement
  en mode header legacy, (b) exiger HTTPS même en LAN (mDNS + certif local),
  (c) `Secure` conditionnel sur `X-Forwarded-Proto` (nginx le pose déjà :
  `proxy_set_header X-Forwarded-Proto $scheme`).
- `Max-Age` 30 j aligné sur le TTL serveur (purge 30 j côté base déjà en
  place).

### Routes (côté API)

- `POST /api/auth/login|register|reset-password` : en plus du JSON actuel,
  `reply.setCookie('ts_refresh', raw, cookieOpts)`.
- `POST /api/auth/refresh` : lit le cookie `ts_refresh` (prioritaire) sinon
  `x-refresh-token` header (transitoire, pour les clients déjà en localStorage
  — à supprimer après une période de grâce) — le `refreshToken` champ JSON
  disparaît des réponses.
- `POST /api/auth/logout` : `reply.clearCookie('ts_refresh')` + révocation
  existante.
- **IMPORTANT (chemin de grille)** : `Path=/api/auth` restreint l'envoi, mais
  le WS/image-URL ne le reçoivent pas non plus — parfait, ils utilisent le JWT.

### Client web

- `refreshSession()` : ne lit plus localStorage — le navigateur envoie le
  cookie automatiquement (axios **sans** `withCredentials` nécessaire car
  same-origin). Réponse : `{ token, user }` (JWT + user restent en
  localStorage — option B pour les retirer aussi).
- Suppression de `dnd-inv-refresh` à la migration : au premier 401, si ni
  cookie ni `x-refresh-token` n'aboutissent → purge complète + /login comme
  aujourd'hui.
- Interceptor 401 → refresh → replay : inchangé (déjà en place via PR #127).

### Sécurité — ce que ça apporte réellement

- **XSS ne vole plus le refresh token** (illisible via `document.cookie`).
  L'attaquant XSS peut encore VOLER UNE SESSION EN COURS (utiliser le JWT
  localStorage, faire des requêtes in-page) — mais ne peut plus installer une
  persistance 30 j. C'est la réduction de risque visée.
- **CSRF** : SameSite=Strict bloque l'envoi inter-site du cookie. Les routes
  API restent protégées par le JWT Bearer (CSRF sans cookie = rien). Pas de
  token CSRF à ajouter.
- **Rotation/family-kill/revocation** : inchangés (côté serveur).

## 3. Options de périmètre

**Option A — refresh token en cookie seulement (recommandée)**
- localStorage garde : JWT (7 j) + user. Disparaît : refresh token.
- Effort : ~1 jour-homme. Diff ~150 lignes. Gain : la persistance XSS est morte.

**Option B — tout cookie (JWT inclus)** ⚠ déconseillé ici
- Exigerait de re-travailler le WS `?token=` et `itemImageUrl` (qui ont
  BESOIN du JWT lisible JS pour construire les URLs) → cookies sur Path=/
  + CSRF sur TOUTES les routes. Contre-productif : c'est le modèle qui
  crée le problème CSRF qu'on évite en A.

## 4. Plan d'exécution (Option A)

Tâches dans l'ordre, chaque tâche = un commit :

1. **`@fastify/cookie` + lecture cookie/header dans /refresh**
   - `npm i -w @table-sync/api @fastify/cookie`; `app.register(cookie)`.
   - `/refresh` : `raw = req.cookies?.ts_refresh || req.headers['x-refresh-token']`.
   - login/register/reset : `reply.setCookie(...)` + GARDER le champ JSON
     `refreshToken` (phase transitoire).
2. **Client : `refreshSession()` passe au cookie**
   - Appel nu (le cookie part tout seul, same-origin) ; conserve le repli
     header `x-refresh-token` depuis localStorage si cookie absent
     (migration douce des sessions localStorage existantes).
3. **E2E + tests API : assertions cookie**
   - Playwright : `context.cookies()` pour lire `ts_refresh` (HttpOnly ne
     gêne pas Playwright) ; vérifier httpOnly=true, sameSite='Strict',
     path='/api/auth', maxAge=2592000.
   - API tests : login → Set-Cookie présent ; refresh via cookie seul ;
     logout → clearCookie + 401 au ré-emploi.
4. **(Post-grâce, PR séparée) Retrait du champ JSON `refreshToken` et du
   repli header** — une fois toutes les sessions migrées (> 7 j après
   déploiement, le temps que les JWT 7 j meurent).

**Gates** : lint, tsc web, test-api, test:e2e — identiques PR #127.

## 5. Risques / points ouverts

- **`Secure` + LAN http** (le seul vrai point ouvert) : déterminer si la
  table accède en http direct (probable : `http://192.168.x.x:8080`). Le
  cookie Secure serait alors rejeté par le navigateur → refresh cassé en
  LAN. Pistes listées §2 (X-Forwarded-Proto conditionnel recommandé).
- Vieux navigateurs/tablettes : `SameSite=Strict` non supporté → retombe sur
  pas de SameSite (cookie envoyé inter-site) → CSRF redevient théoriquement
  possible sur /api/auth/refresh. Table = iPads Safari récents : OK.
- Migration : sessions pré-cookie ne meurent pas (repli header), elles se
  convertissent au premier refresh réussi.
- e2e : le proxy vite doit laisser passer Set-Cookie (vite proxy le fait par
  défaut — à vérifier au premier run).
