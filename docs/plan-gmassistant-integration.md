# Plan — Intégration GM Assistant (liaison groupe ↔ campagne + chronique des séances)

Branche : `feat/gmassistant-integration` · Statut : **implémenté** (jalons 1–4 ; API + UI + tests `mod-gma` verts, écrans vérifiés au navigateur contre le mock GMA)

Objectif produit : le MD connecte son compte [GM Assistant](https://gmassistant.app), lie un **groupe** (notre `party`) à une **campagne** GMA — existante ou **créée depuis le groupe avec les personnages sélectionnés** — puis **resynchronise les personnages** quand la table change (nouvelle fiche, renommée, nouveau propriétaire) ; et toute la table relit les **résumés de séance** dans notre app, en français, sans quitter leurs fiches.

**Ligne rouge** : nos écritures sur GM Assistant sont exactement deux — l'**initialisation** (création de la campagne + des PJ) et la **resynchronisation des personnages** (créations et mises à jour en lot ; suppression toujours explicite, jamais implicite). Jamais d'upload audio, jamais d'édition de séances/résumés/scènes ni de métadonnées de campagne, jamais de clé API côté navigateur.

## 1. Ce que l'API GMA nous offre (recherche, spec 0.10)

- **Auth** : clé personnelle `Authorization: Bearer gma_<env>_<keyId>_<secret>`, créée dans les réglages du compte GMA (onglet Developer). Scopes : `read` (lecture seule) ou `full_access` (tout). Clé = pouvoir dépenser des crédits → secret serveur uniquement. Base : `https://backend.gmassistant.app/v1`.
- **Concepts** : campagne → sessions (titre, `played_at`, `order`) → par session : recaps (collection indexée par **style**, `default` = résumé canonique ≤ 50 000 car., max 21 styles), moments mémorables, scènes, entités. PJ au niveau campagne : `name`, `description`, `played_by`.
- **Endpoints utilisés** (tous préfixés `/v1`) :

| Route | Usage chez nous | Scope |
|---|---|---|
| `GET /account` | valider la clé du MD (email, crédits) | read |
| `GET /campaigns` | picker « lier une campagne existante » | read |
| `GET /campaigns/{id}` | vérifier le choix avant liaison | read |
| `POST /campaigns` | **init** : créer la campagne | full_access |
| `POST /campaigns/{id}/player-characters` | **init + resync** : créer les PJ (`name`, `played_by`) | full_access |
| `GET /campaigns/{id}/player-characters` | **resync** : lire les PJ côté GMA (diff) | read |
| `PATCH /campaigns/{id}/player-characters/{pid}` | **resync** : maj nom / joué par / description | full_access |
| `DELETE /campaigns/{id}/player-characters/{pid}` | **resync** : suppression explicite d'un PJ orphelin | full_access |
| `GET /campaigns/{id}/sessions` | liste des séances (défaut : `id,title,played_at,order`, tri `order`) | read |
| `GET /campaigns/{id}/sessions/{sid}/recaps` | tous les résumés d'une séance, `default` en premier | read |

- **Conventions à respecter** : pagination par curseur (`page.next_cursor` à relayer verbatim, `limit` max 500) ; erreurs en enveloppe `{error:{code,message,status}}` avec `code` open enum (`unauthorized`, `insufficient_scope`, `not_found`, `rate_limited`…) ; `429` + `Retry-After` ; tolérer champs/enum inconnus ; `ETag`/`GMA-Revision` dispo (on ignore au J1, on note pour plus tard).
- **Piège scope** : rien ne permet de lire le scope d'une clé (ni `/account`). Une clé `read` échoue à l'init avec `403 insufficient_scope` → il faut un message clair à ce moment-là.

## 2. Décisions structurantes

### a) La clé vit côté API, par utilisateur, chiffrée
Table `user_gma_links` (1 par user). La clé est chiffrée **AES-256-GCM** (clé dérivée scrypt de `GMA_SECRET`, à défaut de `JWT_SECRET` + sel fixe documenté) — colonne blob `iv+tag+ciphertext`. Jamais renvoyée au web : `GET /api/gma/status` neExpose que l'email **masqué** (`mi***@…`), le scope supposé et l'horodatage de validation. Rotation de secret = clés illisibles → état « clé à ressaisir », affiché proprement.

*Pourquoi pas plaintext :* le fichier SQLite circule (backups, volumes Docker) ; nous y stockons aujourd'hui uniquement des bcrypt. *Pourquoi pas par groupe :* un MD a plusieurs groupes — une seule saisie de clé, N liaisons.

### b) Liaison 1:1 groupe ↔ campagne
Table `party_gma_links` : `party_id` PK, `gma_campaign_id` **UNIQUE**, `campaign_title` (cache display), `linked_by_user_id` (la clé de CET user sert aux appels), horodatages. Le UNIQUE interdit de lier la même campagne GMA à deux groupes (mental model simple, pas de fan-out de cache ambigu).

### c) Cache SQLite des séances + résumés — les joueurs ne touchent jamais GMA
Tout ce que lit un joueur passe par notre API, servie depuis `gma_sessions` / `gma_recaps` (rangées par `party_id`). Rafraîchissement : TTL (`GMA_CACHE_TTL_MS`, def. 5 min) au premier lecteur, bouton ↺ côté MD (`?refresh=1`, GM seulement), et event WS `gma:change` après sync pour invalider les pages ouvertes. **Stale-on-error** : si GMA est injoignable/clé morte, on sert le cache périmé avec un drapeau `stale` (200) au lieu d'un 5xx.

*Pourquoi :* (1) fiabilité en séance — le Wi-Fi de la table est médiocre, GMA peut être lent ; (2) les limites de taux GMA (`429`) ; (3) **notre propre rate-limiter compte les réponses ≥ 400 par IP** — un proxy qui échoue en boucle pour 6 joueurs tripperait le coupe-circuit de toute la table. Cache-first = zéro erreur coté joueur.

### d) Client GMA dédié, injectable pour les tests
`apps/api/src/gma/client.ts` : `fetch` natif (Node 20), timeout (`GMA_TIMEOUT_MS`, def. 8 s), URL de base `GMA_BASE_URL` (def. `https://backend.gmassistant.app/v1`) — **les tests pointeront vers un mock local**, aucune clé réelle en CI. Normalisation des erreurs vers un type `GmaError {status, code, message}` + traduction française centralisée (table §4). Helper de pagination qui suit les curseurs (plafond 10 pages). Pas de dépendance nouvelle.

### e) Resynchronisation des PJ : lot déclenché par le MD, upsert, suppression jamais implicite
L'init n'est pas figé : un nouveau joueur rejoint le groupe, un perso est renommé, un propriétaire change. La resync est un **lot explicite** (bouton MD), jamais automatique — une mutation de fiche en pleine séance ne doit déclencher aucun appel sortant (latence, limites de taux, Wi-Fi médiocre). Le mapping fiche locale ↔ PJ GMA vit dans `gma_pc_links` (§3) ; la politique de diff et les payloads sont détaillés en §5. Points non négociables :
- **upsert seulement** dans le lot (créer / mettre à jour) ; la suppression chez GMA est un **geste dédié, confirmé** (PJ orphelin) ;
- pas de sync **inverse** (un PJ créé directement chez GMA ne devient pas une fiche locale) ;
- pas de resync des **métadonnées de campagne** (titre, système… se règlent chez GMA) ;
- un échec d'item n'interrompt pas le lot — même reporting par item que l'init.

## 3. Données — migration drizzle `0010`

```
user_gma_links   (user_id PK→users, api_key_enc BLOB, gma_account_id TEXT, gma_email TEXT,
                  scope TEXT NULL ('read'|'full_access'|NULL=inconnu), validated_at TEXT)
party_gma_links  (party_id PK→parties, gma_campaign_id TEXT UNIQUE, campaign_title TEXT,
                  linked_by_user_id→users, created_at, updated_at)
gma_sessions     (party_id→parties, session_id TEXT, title, played_at TEXT NULL, sort_order INT,
                  fetched_at TEXT, PK(party_id, session_id))
gma_recaps       (party_id, session_id, style TEXT, text TEXT, updated_at TEXT,
                  PK(party_id, session_id, style))
gma_pc_links     (id PK, party_id→parties, character_id→characters NULL ON DELETE SET NULL,
                  gma_pc_id TEXT UNIQUE, name_at_sync TEXT, created_at, updated_at,
                  UNIQUE(party_id, character_id))
```

`gma_pc_links.character_id` en `ON DELETE SET NULL` : une fiche locale supprimée laisse un **lien orphelin** (reconnaissable par `name_at_sync`, le nom au dernier sync) — candidat à la suppression explicite du PJ chez GMA, jamais supprimé automatiquement.

Workflow habituel : éditer `schema.ts` → `npm -w api run db:generate` → committer le `0010_*.sql`.

## 4. Architecture des routes — module `apps/api/src/routes/gma.ts`

Enregistré dans `server.ts` avec les autres (`prefix '/api'`, JWT global déjà actif). Toutes les réponses d'erreur aux UI sont **en français** ; les `GmaError` sont traduites via une table unique :

| GMA | Notre réponse | Message FR |
|---|---|---|
| 401 `unauthorized` | 401 | « Clé GM Assistant invalide ou révoquée — ressaisis-la dans la Table du MD. » |
| 403 `insufficient_scope` | 403 | « Cette clé est en lecture seule. Crée une clé "full access" sur gmassistant.app pour créer la campagne ou resynchroniser les personnages. » |
| 429 `rate_limited` | 503 + Retry-After | « GM Assistant limite les appels pour l'instant — réessaie dans un instant. » |
| réseau / timeout | 502 | « GM Assistant est injoignable. » (joueur : cache périmé servi avant d'en arriver là) |

### Compte (MD, n'importe où)
| Route | Porte | Rôle |
|---|---|---|
| `GET /api/gma/status` | user connecté | lien du compte : email masqué, scope, validé |
| `PUT /api/gma/key {apiKey}` | user connecté | **valide puis enregistre** : `GET /v1/account` → 401 = rejet propre, rien n'est stocké |
| `DELETE /api/gma/key` | user connecté | efface la clé (les liaisons restent, passent en « clé expirée ») |

### Groupe
| Route | Porte | Rôle |
|---|---|---|
| `GET /api/parties/:id/gma/link` | membre | `{linked, campaign:{title}, accountOk}` — sert l'annexe « Chronique » |
| `GET /api/parties/:id/gma/campaigns` | **GM** | picker : campagnes GMA du MD (id, title), proxy direct |
| `POST /api/parties/:id/gma/link {campaignId}` | **GM** | valide `GET /campaigns/{id}` puis lie (409 si déjà lié) |
| `POST /api/parties/:id/gma/init {characterIds[]}` | **GM** | **écriture n° 1** — voir §5 |
| `POST /api/parties/:id/gma/characters/sync {createCharacterIds[], dryRun?}` | **GM** | **écriture n° 2** : diff + resync des PJ (§5) ; `dryRun` renvoie le plan sans écrire |
| `DELETE /api/parties/:id/gma/characters/:gmaPcId` | **GM** | suppression explicite chez GMA d'un PJ lié devenu orphelin |
| `DELETE /api/parties/:id/gma/link` | **GM** | délie le groupe (ne touche rien chez GMA) |
| `GET /api/parties/:id/gma/sessions[?refresh=1]` | membre (refresh : GM) | liste séances cache-first |
| `GET /api/parties/:id/gma/sessions/:sid/recap` | membre | résumés de la séance (tous styles, `default` premier) |

Après toute sync qui change les données : `bus.emitChange({ type:'gma:change', partyId })` (type ajouté à `SyncEvent` dans `bus.ts` **et** dans la copie web `sync.tsx` — elle est dupliquée à la main, piège connu). Aucune clé GMA ne franchit ces routes ; les payloads web sont typés dans `packages/shared` (section « GM Assistant » : `GmaAccountStatus`, `GmaCampaignSummary`, `GmaSession`, `GmaRecapEntry`, `GmaLinkStatus`, `GmaCharacterDiff` (plan de resync : créations / mises à jour / orphelins / GMA-seuls), payloads).

## 5. Écritures GMA — init, puis resynchronisation des PJ

`POST /api/parties/:id/gma/init` (GM, groupe non lié, clé présente) :
1. `POST /v1/campaigns` — `{title: nom du groupe, ttrpg_system: 'dungeons and dragons', ttrpg_system_edition: '5e'}` (setting/genre : null, le MD les règle chez GMA s'il veut).
2. Pour chaque perso sélectionné : `POST /v1/campaigns/{id}/player-characters` — `{name: nom du perso, played_by: displayName du propriétaire, description}`. GMA n'expose qu'une `description` (6 000 car. max) : elle compose la fiche d'identité complète — titre « Classe n X · Alignement », bloc **Apparence** (champs rapides sexe/âge/taille/poids/peau/yeux/cheveux + texte libre), quartet **Personnalité** (traits, idéaux, liens, défauts), **Histoire** (backstory, tronquée avec « … » si le tout dépasse la limite) ; l'id GMA renvoyé est enregistré dans `gma_pc_links`.
3. Liaison locale du groupe vers la campagne créée.

**Pas de rollback** : nous n'avons pas le droit morale de `DELETE` chez GMA. Si un PJ échoue (validation…), la campagne existe et reste liée ; la réponse renvoie `{created:{campaign, playerCharacters[]}, failed:[{name, reason}]}` et l'UI affiche les échecs avec un lien vers GMA pour compléter à la main. La création est proposée **une seule fois** par groupe (liaison = garde 409).

L'UI d'init matérialise l'exception : avec la resync, ce sont les **deux seuls écrans** de l'app où un bouton écrit chez un tiers — d'où une **modale de confirmation listant exactement** ce qui sera créé (nom de campagne, chaque PJ + joué par).

### Resynchronisation — `POST /api/parties/:id/gma/characters/sync`
Le complément naturel de l'init : un nouveau joueur rejoint le groupe, un perso est renommé, un propriétaire change. **Lot explicite du MD, jamais automatique** — une mutation de fiche en pleine séance ne déclenche aucun appel sortant (latence, limites de taux, Wi-Fi de la table).
1. Lecture croisée : `GET /v1/campaigns/{id}/player-characters` (pagination suivie) + fiches locales du groupe + `gma_pc_links`.
2. **Plan de diff** (retourné tel quel par `dryRun`, ou avant application) :
   - `toCreate` — persos du groupe **sans lien**, filtrés par `createCharacterIds[]` (cases cochées, même grammaire que l'init ; défaut : tout coché) ;
   - `toUpdate` — PJ **liés divergents** (nom, `played_by` = displayName du propriétaire courant, description = fiche d'identité composée §init) : **toujours appliqués**, la sélection ne porte que les créations ;
   - `orphans` — lien dont la fiche locale a disparu (`character_id` NULL) : affichés, jamais touchés par le lot ;
   - `gmaOnly` — PJ présents chez GMA sans lien (créés dans leur app) : information seule ;
   - `upToDate` — compteur de conformité.
3. Application séquentielle : `POST` par création (lien enregistré sur l'id GMA renvoyé), `PATCH` merge-patch par divergence, **jamais de suppression dans le lot**.
4. Reporting par item (un échec n'interrompt pas), bus `gma:change`, retour du plan appliqué.

La suppression chez GMA reste un geste dédié : `DELETE /api/parties/:id/gma/characters/:gmaPcId`, réservé aux liens orphelins, `ConfirmButton` dans l'UI. Pas de sync inverse (un PJ créé chez GMA ne devient pas une fiche locale) ni de resync des métadonnées de campagne (titre, système… se règlent chez GMA).

## 6. UI web (monde parchemin/encre, mode Operate)

### MD — nouvel onglet « GM Assistant » dans `GmDashboardPage`
Même mécanique que les onglets existants (`characters/transactions/custom/members`), un 5ᵉ `TabButton` `assistant`. Contenu en `.card` (motif CustomItemsTab) :
- **Pas de clé** : explicateur court (ce que fait la liaison, lien vers gmassistant.app → Developer) + champ clé (`type=password`, `label`/`htmlFor`), bouton « Connecter » → erreurs traduites inline.
- **Clé validée, groupe non lié** : deux chemins — « Lier une campagne existante » (picker `GET …/gma/campaigns`) et « Créer depuis ce groupe » (multi-sélection des personnages du groupe avec aperçu `joué par`, reprise du motif « Tout sélectionner » de `AddPlayerModal`, modale de confirmation §5).
- **Lié** : carte campagne (titre, Lien externe vers gmassistant.app ↗), état de la clé, « ↺ Rafraîchir les séances », « ⇄ Resynchroniser les personnages » (modale du plan de diff §5 : créations cochables, mises à jour listées avec l'ancien → le nouveau, orphelins avec `ConfirmButton` « Supprimer chez GM Assistant », PJ gérés sur GM Assistant en info ; Appliquer → reporting par item), déliaison par `ConfirmButton` (la signature maison — texte : ne supprime rien chez GMA). Un badge discret « N perso(s) à resynchroniser » apparaît quand le diff `dryRun` (au chargement de l'onglet) n'est pas vide.

### Joueurs + MD — l'annexe « Chronique »
`PartyPage` section III gagne une ligne `TocLink` `📜 Chronique` (visible seulement si `GET …/gma/link` dit `linked`) → nouvelle route `/party/:partyId/chronique` (lazy, `ProtectedRoute`). Deux états, grammaire du registre réglé (DESIGN.md) :
- **Liste** : les séances en entrées réglées, **ordinaux romains = numéros de séance** (I, II, III…), la plus récente en entrée courante (`blood-500`, titre `text-2xl`, méta date fr + « N styles de résumé »), les anciennes compactes. Tête de page « Chronique » + double règle, `.register-rise` à l'arrivée. Vide : « Aucune séance pour l'instant — les résumés du MD apparaîtront ici. »
- **Lecture d'une séance** : article mesuré (`max-w-3xl`), texte du style `default` en `Iowan Old Style`, **chips de styles** (`Chip` tons existants — `default`, `short_summary`, `classic_summary`…) si la séance en a d'autres, méta `played_at` + « synchronisé à HH:MM » (badge « périmé » si stale), retour par `useHeaderOverride`. La porte sang de la page = l'ordinal de la séance la plus récente ; tout le reste reste encre.

## 7. Sécurité & garde-fous

- Clé : chiffrement au repos, jamais dans un payload, jamais en log (`DB_SQL_TRACE` ne la voit que chiffrée — les appels sortants passent par le client, pas par SQLite).
- Portes : `requireUser` + `isPartyMember` / `isPartyGM` partout ; `campaignId` validé (UUID) avant tout appel sortant ; `characterIds` filtrés sur les personnages **du groupe**.
- Rate limit (le nôtre, erreur-seule) : les routes GMA peuvent échouer → elles restent sous le quota 40/min ; le cache-first + stale-on-error fait que le joueur normal n'en produit aucune.
- Dégradation : clé supprimée/révoquée → liens en « clé expirée », la chronique sert le dernier cache avec avertissement, seul le MD voit l'action de réparation.

## 8. Tests

- **`scripts/api-tests/mod-gma.ts`** (ajouté à `test-api.ts`) : le harness démarre un **mini-serveur mock GMA** (http node, port libre) et passe `GMA_BASE_URL` au boot : `/account` (401 sauf clé test), `/campaigns` (liste + POST), `/player-characters` (GET/POST/PATCH/DELETE), `/sessions`, `/sessions/:id/recaps` (2 styles). Scénarios : save/valide/rejet de clé ; portes (joueur ≠ GM ≠ non-membre) ; liaison + 409 ; init (payloads exacts, échec partiel PJ sans rollback) ; resync (`dryRun` du diff, `PATCH` exact sur renommé/changement de propriétaire, `POST` + lien sur nouveau, suppression orphelin explicite, échec d'un item sans interruption) ; sessions cache + TTL + `refresh` ; stale-on-error (mock coupé) ; event WS.
- E2E Playwright : plus tard (J5) — la vue chronique joueur avec cache seedé.

## 9. Jalons

1. **API socle** : migration 0010, `gma/client.ts`, routes compte (status/key), mock + `mod-gma` partiel.
2. **API liaison & données** : link/campaigns/init/characters-sync/sessions/recaps, cache + stale, event `gma:change`, tests complets.
3. **UI MD** : onglet GM Assistant (clé, liaison, init, resync des PJ, rafraîchir/délier).
4. **UI chronique** : annexe PartyPage + page registre/lecture + refetch WS.
5. **Poli** : états d'erreur/vide, e2e, README/docs, `npm run lint` + suites.

## 10. Hors périmètre (réservé au futur, l'architecture le permet déjà)

Moments mémorables & scènes en lecture ; entités de campagne (PNJ/lieux GMA) en lecture ; publication publique GMA (`is_public`) avec lien de partage ; déclenchement d'analyses (coûte des crédits — jamais sans garde-fou explicite) ; ETag/`If-None-Match` pour ne re-payer que le nécessaire.

## 11. Hypothèses à valider (marquées, non bloquantes)

- Le scope d'une clé est indétectable en lecture → l'échec `403` à l'init porte seul le message « passe en full access ». *(Alternative rejetée : demander au MD de déclarer le scope à la saisie — une déclaration fausse est pire qu'une erreur claire.)*
- « Chronique » comme nom joueur (annexe + page) ; l'onglet MD garde la marque « GM Assistant ».
- Styles secondaires affichés en chips sur la vue séance (et non filtrés au cache — on stocke tout, ≤ 21 styles).
- La resync est **déclenchée par le MD** (bouton, lot), jamais automatique sur mutation d'une fiche — un automatisme temps réel pourrait s'ajouter plus tard par-dessus le même endpoint si le besoin se fait sentir.
