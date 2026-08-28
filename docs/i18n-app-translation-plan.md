# Plan — Traduire l'application elle-même (UI complète)

*Suite directe de la PR #93 : le contenu (sorts, objets, monstres, features) et
l'instrumentation (i18next, payloads mono-locale, sélecteur d'en-tête) sont en
place. Reste la couche UI : les ~1 400–1 900 chaînes françaises codées en dur
dans 47 fichiers, les libellés calculés du moteur, et les messages d'erreur API.*
*Chiffres mesurés le 2026-08-28 sur le worktree `i18n/english`.**

## 1. Périmètre mesuré

### Web — 1 362 sites accentués dans 47 fichiers (~1 850 en comptant le FR sans accents)

| Zone | Fichiers | Sites | Particularités |
|---|---|---|---|
| Feuille de perso (9 onglets + panneaux) | 15 | ~800 | pire fichier : `SurvivalPanel.tsx` (179) ; prose SRD longue (`EXHAUSTION_EFFECTS_FR`, `CONDITION_HINTS_FR`), compteurs de ressources, boutons repos |
| MD (combat, tableau de bord, chronique, PNJ) | 5 | ~300 | `CombatPage` 80, `GmDashboardPage` 77, `ChroniclePage` 33 ; `GmaAssistantTab` 77 dont les **prompts LLM** |
| Modals/composants | 12 | ~330 | `ItemImageViewer` 80 (annotations), `MonsterStatBlock` 33, `AddClassSheet`, `CastSpellSheet`, `ConditionsEditor`… |
| Auth/compte/groupes | 5 | ~90 | `CharacterCreatePage` 76 (le plus gros hors feuille), `PartiesPage`, `AccountPage`, `Register/Login` |
| Shell + utilitaires | 5 | ~30 | déjà partiellement i18n (App.tsx) ; `plural()` dans `utils.ts` |
| Attributs localisables | tous | dont ~50 aria-label + ~15 title + ~10 placeholder | obligatoires : sinon les lecteurs d'écran restent FR |

### Libellés du moteur (shared) — consommation centralisée, conversion bon marché

Chaque map `*_FR` n'est lue que dans 1–5 fichiers web (mesuré) : `CATEGORY_LABELS_FR`
(5 fichiers, via `ui.tsx`), `ABILITY_SHORT_FR` (4), le reste 1–2. Les miroirs EN
existent déjà (`labels.en.ts` + `labelTable()`), il reste à convertir les ~25 sites
d'appel. Non consommés côté web : `DAMAGE_TYPE_LABELS_FR`, `NPC_*`, `GMA_*` (API
seule ou usage nul).

### Valeurs-domaine stockées en FR (affichage à traduire sans toucher la base)

- **Conditions** (16) : `DND_CONDITIONS_FR` est la valeur STOCKÉE (sheet ↔ tracker).
  Affichage : index parallèle avec `DND_CONDITIONS_EN` (même ordre — déjà aligné).
  La migration vers des clés stables reste le chantier structurel (audit P0).
- **Langues** (`DND_LANGUAGES`) et **classes des sorts** (`classes: string[]`, noms
  FR utilisés par la logique via `findClass`) : mapping d'affichage FR→EN, la
  logique continue de lire le FR.
- **Type/taille des monstres** : la prose FR de 5e-drs (« Créature monstrueuse de
  Grande taille ») → nettoyage + map EN (déjà écrite dans le matcher, à déplacer
  dans `labels.en.ts`).

### API — messages en réalité MIXTES

52 messages accentués seulement : une grosse partie des ~330 messages est déjà en
anglais (« item not found », « not a member »). Il faut unifier : **codes stables**
(`NOT_FOUND`, `GM_ONLY`…) traduits côté client, la langue FR restant la valeur de
 repli. Phasé : d'abord homogénéiser FR (les ~ anglais passent FR), puis codes.

## 2. Contrat d'extraction (à respecter sur chaque lot)

1. **`fr.json` reprend le français ACTUEL au mot près** — le rendu FR ne doit pas
   changer. C'est ce qui garantit que la suite e2e (43 specs FR) reste verte sans
   toucher aux sélecteurs.
2. Clés hiérarchiques par écran : `survie.repos.court`, `combat.tour.suivant`,
   ` Creation.classe`… Interpolation `{{n}}`, pluriels i18next (`_one`/`_other`)
   qui remplacent les ~8 `${n>1?'s':''}` et `plural()`.
3. `useTranslation()` par composant ; **jamais de texte par défaut inline** :
   `t('x.y')` sans `defaultValue` français — un texte absent doit sauter aux yeux.
4. `aria-label`, `title`, `placeholder`, `alt` extraits comme les textes visibles.
5. Les blocs-prose (épuisement, indices de conditions, dés de règles) deviennent
   des entrées de catalogue (`survie.etats.fatigue.1`…), pas des constantes TS.
6. Prompts de l'assistant MD : textes dans le catalogue ; le prompt suit la langue
   d'affichage — l'assistant répond alors en anglais (comportement voulu, à noter
   dans l'UI).
7. Commit par lot + gates : `lint` · `tsc -b` web · `test-api` · `test:e2e` (43/43)
   · growing smoke EN (voir §5).

## 3. Découpage en lots (ordre = flux utilisateurs)

| # | Lot | Fichiers | Sites | Jours |
|---|---|---|---|---|
| L0 | Libellés moteur : conversion des ~25 sites `labelTable()` + maps d'affichage conditions/langues/classes/tailles-types monstres | 15 | — | 0,5 |
| L1 | Auth + groupes + compte + création de perso | Login, Register, Parties, Party, Account, CharacterCreate | ~250 | 1 |
| L2 | Feuille — Survie + Caractéristiques + Compétences | SurvivalPanel, CharacterStatsTab, CharacterSkillsTab, ConditionsEditor, CharacterStateBand | ~330 | 1,5 |
| L3 | Feuille — Sorts + Traits + Description + PNJ + Notes | SpellsTab, FeaturesTab, DescriptionTab, CastSpellSheet, SpellDetailSheet, AddClassSheet, NpcPage, NotesTab | ~330 | 1,5 |
| L4 | Inventaire | InventoryPage, InventoryRow, CatalogSearch, ItemImageViewer, ItemImageField, NewLocationModal, TransferModal | ~230 | 1 |
| L5 | MD — combat | CombatPage, MonsterStatBlock, AddMonsterModal, AddPlayerModal, CombatWidget, TurnSlash | ~180 | 1 |
| L6 | MD — reste + assistant | GmDashboardPage, ChroniclePage, NpcPage(reste), GmaAssistantTab (UI + prompts) | ~200 | 1 |
| L7 | API : unification FR puis codes stables + traduction client ; chrome (meta index.html, manifeste, ErrorBoundary) | routes/**, web | ~330 | 1–1,5 |

**Total ≈ 8–9 jours** de dev+migration, répartissables ; chaque lot est
indépendant et livrable seul (le FR ne change jamais, l'EN s'enrichit).

## 4. Garde anti-régression

`scripts/i18n/check-ui-strings.ts` (à créer, branché dans le job `validate`) :
scanne `apps/web/src` hors `i18n/` à la recherche de littéraux accentués dans
JSX/attributs/chaînes + liste blanche documentée (ex. regex de validation FR,
adresses). Seuil « ratchet » : échoue si le compte REMONTE au-dessus de l'inventaire
du lot en cours — les lots font descendre la jauge vers 0. C'est la garantie
« toute nouvelle chaîne passe par le catalogue ».

## 5. Validation fonctionnelle

- Smoke e2e EN croissant : `e2e/locale-en.spec.ts` — bascule
  `localStorage['dnd-inv-lang']='en'` avant chargement, puis assert par lot
  (« Ma fiche »→“My sheet”, « Repos court »→“Short rest”, nom de monstre EN…).
- Définition of done du chantier : bascule EN → aucun français visible dans les
  flux couverts (checker §4 à zéro hors liste blanche) + e2e FR 43/43 + e2e EN vert.

## 6. Hors périmètre (suivis déjà tracés)

- Clés stables en base pour conditions/langues (audit P0) — l'affichage par map
  parallèle de L0 rend ce chantier non bloquant mais il reste souhaitable.
- ~361 monstres Tome of Beasts à traduire (file `monsters-en-manual.json`).
- Site marketing (`site/`) — statique FR, chantier séparé si un jour demandé.
