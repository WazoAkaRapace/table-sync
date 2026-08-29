# Audit i18n — rendre Table Sync entièrement traduisible

*Audit réalisé le 2026-08-28. Constat global : l'application est codée en dur en français de bout en bout, sans aucun échafaudage i18n. La bonne nouvelle : l'essentiel du contenu de jeu est piloté par des données, et une grande partie est déjà bilingue dans les seeds. Le gros du travail est du contenu (monstres), pas du code.*

## Vue d'ensemble

| Couche | État | Volume de chaînes | Difficulté |
|---|---|---|---|
| Web UI (`apps/web/src`) | Inline, aucun catalogue | ~900–1 200 sites | Moyenne — extraction mécanique |
| Moteur de règles (`packages/shared`) | Data-driven, clés partiels | ~300–500 (labels + 307 descriptions) | Moyenne |
| API (`apps/api/src`) | ~330 messages d'erreur inline | ~330 | Facile — mais nécessite une couche de clés + Accept-Language |
| Seeds (`data/*.json`) | Sorts & objets bilingues ✓, monstres FR seul ✗ | ~2 100 proses de contenu | **Dominant** |
| Site marketing (`site/`) | HTML/CSS inline | ~117 lignes + 8 `content:` CSS | Facile |
| E2E (`e2e/`) | ~287 lignes sélecteurs/textes FR | — | Cassera à la première traduction UI |

## 1. Frontend web (~900–1 200 sites)

Aucune dépendance i18n, zéro centralisation : tout est inline dans le JSX.

**Répartition estimée** (comptage par accents ×1,5–2, beaucoup de français sans accent) :
- `pages/` (24 fichiers) : ~450–550 — pires fichiers : `SurvivalPanel.tsx` (~65), `CharacterSpellsTab`, `CombatPage`, `CharacterInventoryPage`, `GmDashboardPage`
- `pages/character/` (12 fichiers) : ~180
- `components/` (17 fichiers) : ~120
- `App.tsx` (~15 : nav, statut sync, Déconnexion), `auth.tsx` (1 toast), `utils.ts` (`plural()`)

**Aussi en jeu** : 168 `aria-label`, 51 `placeholder`, toasts, attributs `title` — tous doivent passer au catalogue (sinon les lecteurs d'écran restent FR).

**Points délicats** :
- Pluriels manuels `${n > 1 ? 's' : ''}` sur ~8 sites (`utils.ts` `plural()`, `AddPlayerModal`, `CharacterStateBand` ×2, `GmaAssistantTab`, `AddMonsterModal`, `AddClassSheet`) → à remplacer par des messages ICU pluriels.
- ~28 template literals construisant des phrases (maths de PV, durées, comptages).
- Prose SRD longue : `EXHAUSTION_EFFECTS_FR` + `CONDITION_HINTS_FR` (`SurvivalPanel.tsx`), labels de bloc de stats (`MonsterStatBlock.tsx`), prompts GMA (`GmaAssistantTab.tsx`) — le plus lourd à traduire côté UI.
- Formatting local en dur : 9 sites `toLocale*('fr-FR')` — `utils.ts:31,40`, `GmDashboardPage.tsx:567,809`, `ChroniclePage.tsx:23,30`, `CharacterNotesTab.tsx:281`, `MonsterStatBlock.tsx:309`. Aucun nom de mois/jour codé en dur (Intl s'en charge), pas de NNBSP/guillemets problématiques dans le source.
- Pas de détection de locale navigateur, `lang="fr"` statique, pas de `document.title` dynamique. `api.ts` est propre (zéro chaîne UI) — les erreurs sont affichées par les appelants, bonne couture.

## 2. Moteur de règles (`packages/shared`)

**Le moteur n'émet aucune phrase** : `applyRest` renvoie un patch de données, aucun `throw` avec texte, pas de tooltips. Toute la prose est du contenu de catalogue. Verdict : traduction = échange de tables, pas d'extraction chaîne par chaîne dans la logique.

**Déjà key-based (traduisible en échangeant la table)** : 20 maps `*_LABELS_FR` (`ABILITY_LABELS_FR`, `SPELL_SCHOOL_LABELS_FR`, `RARITY_LABELS_FR`, `WEAPON_PROPERTY_LABELS_FR`, `NPC_*`, `GMA_*`…), `DND_ABILITIES`, `DND_TOOLS` (39), subclasses (`CLASS_SUBCLASSES`, 39 avec `key`/`label`).

**À extraire en tables par locale** : 307 noms + descriptions de features de classe (`classFeatures.ts`, placeholders `{{save_dc}}`, `{{level}}`, `{{prof}}`… déjà présents — 98 occurrences, prêtes pour ICU) + ~13 descriptions de classe (`DND_CLASSES`).

**⚠ Blocants — chaînes FR utilisées comme valeurs stockées / dans la logique** :
- `DND_CONDITIONS_FR` (16) : les libellés français SONT les valeurs stockées en base ; `CONCENTRATION_BREAKING_CONDITIONS_FR` matche dessus. → introduire des clés stables avant toute table de locale.
- `DND_LANGUAGES` (18) : chaînes FR nues stockées en base, sans clé.
- Logique dépendante du nom français : `findClass(c.classKey)?.name === 'Artificier'` / `'Occultiste'` / `'Druide'` dans `applyRest` / `hasAutomaticToolExpertise` → comparer sur `classKey`, jamais sur `name`.
- Sorts toujours préparés : listes inlinées dans la prose française des descriptions (pas de table structurée).

## 3. API (~330 messages inline)

- Messages `error: '...'` en français dans toutes les routes (combat 38, gma 33, item-images 25, inventory 25, parties 23, …). Aucune couche de clés, aucun `Accept-Language` (zéro occurrence).
- WebSocket : types d'événements neutres (`inventory:change`…), le texte affiché vient des clients — rien à faire côté sync.
- `normalize()` (recherche sans accents) est language-agnostic — OK.
- `db/seed.ts` : alias FR en dur (`'kit de déguisement'`).
- Schéma : colonnes de contenu stockent des valeurs FR (`monsters.name_fr` NOT NULL, `items.aliases` FR). Les colonnes libres utilisateur (notes, backstory) sont neutres.

**Approche recommandée** : catalogue de messages côté serveur (clé → {fr, en}), négociation via `Accept-Language` ou paramètre par utilisateur/partie. Les messages d'erreur API doivent idéalement devenir des **codes stables** (`'NOT_FOUND'`, `'GM_ONLY'`) que le client traduit — plus robuste que traduire côté serveur.

## 4. Contenu de jeu (le coût dominant)

| Fichier | Entrées | Clé stable | Nom EN | Nom FR | Descriptions |
|---|---|---|---|---|---|
| `spells-seed.json` | 490 | `srdIndex` ✓ | ✓ | ✓ | **EN + FR toutes les deux** ✓ (`descriptionFr`, `higherLevelFr`) |
| `items-seed.json` | 646 | `srdIndex` ✓ | ✓ | ✓ | FR seul (518 desc., ~512 car.) |
| `monsters-seed.json` | 964 | `slug` ✓ | **✗** | ✓ | FR seul, ~872 blocs de traits/actions (~1,1 KB chacun), `senses`/`languages` FR |

- **Sorts : quasi prêts** pour le bilingue — champs parallèles déjà là.
- **Objets : il manque les descriptions EN** (traduction de ~646 proses).
- **Monstres : le vrai chantier** — pas de nom anglais du tout, ~900 statblocks de prose FR à (re)traduire. C'est un travail de localisation de contenu, pas de code.

## 5. Site marketing & infra

- `site/index.html` : ~117 lignes de copie FR inline, `lang="fr"` ; `site/styles.css` : 8 `content:` FR ; `site/main.js` : minime. Traduction = dupliquer la page ou bascule JS simple.
- `apps/web/index.html` + `public/manifest.json` : `lang="fr"` + description FR (1 chaîne chacun) ; name/short_name = marque, inchangés.
- `scripts/generate-screenshots.ts` : seed démo FR (les captures resteront dans la langue de démo — OK, paramétrer si besoin).
- **E2E : point de rupture immédiat** — ~287 lignes de textes FR en sélecteurs (`getByRole('button', { name: 'Déconnexion' })`, `'Alliés et organisations'`…). Toute traduction UI casse la suite. → migrer les assertions vers `data-testid` (ou i18n test keys) **avant** d'extraire les chaînes. (`auth.spec.ts:19` a déjà un fallback bilingue.)

## Plan d'attaque recommandé (ordre)

1. **Fondations** : ajouter `i18next` + `react-i18next` (ou équivalent léger), provider de locale (détectée du navigateur, overridable par utilisateur), `document.documentElement.lang` dynamique, paramétrer les 9 sites `Intl('fr-FR')`.
2. **Dé-keysifier les valeurs stockées** (prérequis bloquant) : conditions et langues → clés stables + tables de libellés ; remplacer les comparaisons `name === 'Artificier'` par `classKey` (migration DB pour les valeurs existantes).
3. **Extraire la web UI** (~900–1 200 sites, 3–5 j) puis les maps shared (~1–2 j). Pluriels ICU, phrases interpolées en MessageFormat.
4. **API** : codes d'erreur stables renvoyés au client, traduction côté client.
5. **Migrer les sélecteurs e2e vers `data-testid`** (à faire en même temps que l'étape 3, fichier par fichier).
6. **Contenu** : activer `descriptionFr`/`description` EN des sorts ; traduire les descriptions d'objets ; grosses traductions de statblocks de monstres (peut être partiel : noms EN d'abord, prose ensuite).

**Estimation totale pour une 2ᵉ langue complète : ~1–2 semaines**, dont la majorité est la traduction du contenu D&D (monstres surtout) ; le refactoring de code est la moindre part.
