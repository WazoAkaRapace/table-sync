# Architecture — apps/web

Carte de maintenance du frontend « Table Sync » (React 19 + Vite +
Tailwind v4, mobile-first, français). Ce document décrit **où vit quoi et
pourquoi** ; les règles visuelles (tokens, surfaces, motion) vivent dans
[`DESIGN.md`](./DESIGN.md) — jamais dupliquées ici.

## Vue de l'ensemble

```
apps/web/
├── index.html          Shell HTML : splash « encre vivante », méta PWA, garde navigateur
├── src/
│   ├── main.tsx        Providers (QueryClient, Auth, Sync), SW push, retrait du splash
│   ├── App.tsx         Routes lazy + Nav + bannières globales (offline, update, messages)
│   ├── index.css       @theme Tailwind v4 (tokens) + classes du système (.card, .btn-*)
│   ├── api.ts          Axios : baseURL, JWT, timeout 15 s, Accept-Language
│   ├── auth.tsx        AuthContext : login/register/logout, token localStorage
│   ├── sync.tsx        SyncProvider : WebSocket, invalidation react-query, useSyncEvent
│   ├── headerContext.tsx  Titre/bouton retour de l'en-tête (useHeaderOverride)
│   ├── i18n/           i18next : index (init), labels (helpers), locales/{fr,en}.json
│   ├── lazyDetails.ts  Prose paresseuse (objets/sorts) — détail chargé une fois par id
│   ├── combatLive.ts   Rencontres actives : liste + détails EN PARALLÈLE
│   ├── push.ts         Web Push : SW (sw.js), abonnement par appareil
│   ├── tutorial/       Visite guidée (react-joyride) : scripts, cible data-tuto
│   ├── usePartyRole.ts    Rôle du membre courant — forme canonique du cache ['party-role']
│   ├── useMessagesUnread  Pastilles de non-lus — source unique (hub, onglets, annexes)
│   ├── utils.ts        toRoman, formatCreated, parseSqliteDate (toujours pour les dates !)
│   ├── pages/          Une page par route (toutes lazy dans App.tsx)
│   │   └── character/  Sous-composants de l'onglet Inventaire (lignes, bourse, transfert…)
│   └── components/     Composants partagés (ui.tsx = le kit)
└── public/             manifest.json, sw.js, icônes, polices (assets/fonts/cinzel-var.woff2)
```

## pages/ vs components/

- **`pages/`** = un fichier par route (le default export est chargé par un
  `lazy()` dans `App.tsx` — les chemins d'import dynamiques doivent rester
  stables, c'est le contrat de code-splitting). Les pages-outil du MD
  (`GmDashboardPage`, `DmNotebookPage`, `NpcPage`) gèrent leurs onglets
  internes via `?tab=` + `TabButton`.
- **`components/`** = réutilisable par au moins deux pages, ou gros
  domaine isolé (`ItemImageViewer`, `MonsterStatBlock`, `MessageThread`…).
  Une page ne s'importe jamais entre elles ; tout partage passe par
  `components/` ou remonte dans `@table-sync/shared`.
- **`pages/character/`** = sous-composants de la fiche (Inventaire) —
  trop volumineux pour rester dans le fichier page, trop lié à l'onglet
  pour être « partagé ».

## Le kit partagé — `components/ui.tsx`

Tout contrôle générique vit ici ; une page ne redéploie pas une variante
locale avant d'avoir vérifié que le kit ne la couvre pas.

| Export | Rôle |
|---|---|
| `Modal` | dialogue centré/feuille, focus trap + Échap + restore focus |
| `BottomSheet` | feuille mobile portaled (`size`, `mobileOnly`, `footer`) |
| `Fab` | bouton d'action flottant `+` (`raised`, `dataTuto`) |
| `HpBar` | barre de PV unifiée (paliers, PV temporaires, `size`, `showText`) |
| `Chip` | pastille de stat teintée (`tone`, `soft`, `title`) |
| `EncumbranceBar` | jauge d'encombrement + conséquences de règle (`compact`) |
| `NumberField` | LE champ numérique (draft libre, clamp [min,max], `emptyAsZero`) |
| `RarityBadge` / `CategoryBadge` / `WeightBadge` / `CostBadge` | métadonnées d'objet |
| `LoadingSpinner` / `EmptyState` / `ErrorMsg` | états simples (micro-chargements, vide, erreur) |
| `SkeletonRegion` / `SkeletonRegister` / `SkeletonCard` / `SkeletonRow` / `SkeletonBlock` | squelettes de chargement (délai 500 ms, pouls par région) |
| `TabButton` | onglet interne souligné sang |
| `ConfirmButton` | suppression en deux temps (armé 4 s, `pulse-warn`) |
| `Toast` / `ToastStack` | retours d'action `aria-live` |

Les composants « de bande » (`CharacterStateBand`, `CombatWidget`) vivent
dans leurs propres fichiers : gros, à un seul site d'usage chacun.

## État & flux de données

1. **Serveur → cache** : tout passe par **react-query** (client unique
   dans `main.tsx` : `staleTime 30 s`, pas de refetch au focus, `retry: 1`
   — la fraîcheur est pilotée par le WS, pas par le cycle de l'onglet).
2. **Temps réel** : `sync.tsx` ouvre le WebSocket (token en
   sous-protocole), mappe chaque événement (`character:change`,
   `inventory:change`, `combat:change`…) en **invalidations
   chirurgicales** de react-query. Une page à état local rattrape les
   trous via `useResyncOnReconnect(load)` ; un crochet d'événement
   précis existe : `useSyncEvent(handler, deps)`.
3. **Auth** : `AuthContext` (`auth.tsx`) détient token + utilisateur
   (`localStorage` `dnd-inv-token`) ; `ProtectedRoute` garde les routes.
4. **HTTP** : `api.ts` attache le JWT et l'`Accept-Language` ; les
   erreurs API (chaînes anglaises) sont retraduites par statut HTTP à
   l'affichage.
5. **Types & règles** : TOUT ce qui est règle D&D (CA, encombrement,
   sorts, repos…) vient de `@table-sync/shared` — jamais dupliqué dans le
   web ni l'API.

Conventions associées : `usePartyRole` impose LA forme canonique de
l'entrée `['party-role']` (une clé partagée ne tolère pas deux formes) ;
`lazyDetails` charge la prose SRD une fois par id (les listes API sont en
mode résumé).

## i18n

- i18next + react-i18next ; **défaut `fr` sans détection navigateur**
  (les e2e tournent sous locale en-US), bascule explicite via l'en-tête.
  FR liée statiquement (chemin critique), EN en chunk dynamique.
- Tout texte visible passe par `t('cle')` dans `locales/{fr,en}.json` ;
  les libellés de règle (rareté, catégories, paliers) par
  `i18n/labels.ts`. Ne jamais durcoder une chaîne dans un composant.
- Les payloads API sont mono-locale (l'API localise) — jamais les deux
  langues dans un même payload.

## Thème

Tokens = le bloc `@theme` de `src/index.css` (Tailwind v4, pas de
config) : rampes `parchment/ink/blood/gold` + `--font-display/body/sans`.
Les classes du système (`.card`, `.btn-*`, `.input`, `.section-title`,
`.rarity-*`, keyframes) vivent dans le même fichier. **Toute décision
visuelle (nuance, ombre, motion) est documentée dans
[`DESIGN.md`](./DESIGN.md)** — ajouter une nuance = l'ajouter à `@theme`
ET au frontmatter de DESIGN.md. Cinzel est auto-hébergé
(`assets/fonts/`, subset 26 KB).

## Tests

| Étage | Commande | Ce que ça couvre |
|---|---|---|
| Règles (shared) | `npm run test-weapon-stats` (+ armor/class/multiclass/coin) | moteur D&D 5e, pur TS |
| API | `npm run test-api` | intégration + gate zéro-SQL-brut (serveur jetable) |
| E2E | `npm run test:e2e` | Playwright : stack jetable (API 4740 + vite 5175, `e2e.sqlite` frais), chromium complet + webkit `@smoke` |
| Lint | `npm run lint` | Biome 2.5 (gate CI) — 2 espaces, quotes simples, imports triés |
| Screenshots | `npm run screenshots` | régénère `docs/screenshots/*.png` du README |

## Recette — ajouter une page (ou un onglet)

1. **Créer** `src/pages/MaPage.tsx` (default export). Choisir sa surface
   dans DESIGN.md : page réglée (registre) ou cartes `.card`.
2. **Router** : `lazy(() => import('./pages/MaPage'))` en haut de
   `App.tsx` + `<Route>` (et une entrée titre dans `useRouteTitle` si
   elle doit titrer l'en-tête).
3. **Charger** : react-query (`useQuery`) pour les données ; état
   chargement = `SkeletonRegister`/`SkeletonCard` selon la surface (pas
   de spinner plein écran) ; erreur = `ErrorMsg` + Réessayer.
4. **Vivre** : si la page doit réagir au WS, `useSyncEvent` + clés de
   cache cohérentes ; si elle recharge à la reconnexion,
   `useResyncOnReconnect(load)`.
5. **Textes** : clés dans `locales/fr.json` ET `en.json` ; aria-labels
   français nommant l'action.
6. **Onglet interne** (page-outil) : `?tab=` + `TabButton`, panneau
   remonté par `.sheet-tab-swap` avec clé React sur l'onglet actif.
7. **Vérifier** : `npm run lint` + `npm -w web exec tsc -b` (gate CI) ;
   une spec e2e si le flux est critique.
