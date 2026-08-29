# Plan — Traduction anglaise via 2014.5e.tools

*Plan rédigé le 2026-08-28 dans le worktree `i18n/english`. Suites et s'appuie sur `docs/i18n-audit.md` (audit de préparabilité i18n). Tous les chiffres de couverture ci-dessous sont **mesurés** par sonde (`scripts/i18n/probe-5etools.py`) contre nos seeds réels.*

## Décisions actées (revue utilisateur) et exécution

1. **Sorts** : gardés tels quels, corrections appliquées. La correction s'est avérée plus large que prévu : non pas 6 mais **154 entrées** du lot XGE/TCE/FTD avaient du texte français dans le champ `description` EN, plus 17 noms à apostrophes écrasées (« Tasha s caustic brew »). ✅ Exécuté : `scripts/i18n/fill-spells-en.py` a réécrit le seed (descriptions EN + higherLevel EN copiés de 5e.tools, noms canoniques restaurés, `descriptionFr` intact). Les 3 sorts AideDD absents de 5e.tools ('Projectile élémentaire', 'Vents contraires', 'Invocation d ombres') sont traduits à la main dans le script. Les 3 noms SRD (Arcane Hand, Arcane Sword, Arcanist's Magic Aura) restent inchangés — texte SRD déjà correct.
2. **Texte direct 5e.tools, pas de traduction LLM** : ✅ appliqué partout où 5e.tools a la donnée. Features de classe : `scripts/i18n/build-class-features-en.py` génère `packages/shared/src/classFeatures.en.ts` — **307/307 features** (noms + prose EN complète) via un dictionnaire FR→EN vérifié : chaque entrée DOIT exister sur 5e.tools à la bonne classe/sous-classe et au bon niveau, sinon le script échoue. Monstres : texte EN copié tel quel pour les 568 appariés.
3. **Recherche exhaustive des monstres puis traduction des absents** : ✅ recherche menée sur la liste COMPLÈTE du miroir (96 fichiers bestiaire, 3 809 monstres — vérifié par `git ls-tree`), en 5 passes (slug, empreinte numérique stricte, dictionnaire de noms vérifié CR+type, flou désambiguïsé par nom + PV, nom unique). Résultat : **568/964 appariés (59 %)** + **35 traduits à la main** = 603 couverts. Le résiduel restant (361) est identifié : c'est la traduction française du **Tome of Beasts (Kobold Press)** taguée « Livre des monstres » par 5e-drs — du tiers-éditeur que 2014.5e.tools n'héberge pas. Traduction manuelle en cours par lots : chaque lot est ajouté à `data/monsters-en-manual.json` (l'overlay manuel prime sur tout) puis `python3 scripts/i18n/match-monsters-v2.py` regénère `data/monsters-en.json` + le rapport. Continuer l'alphabet (prochain : arbeyach).

### Artefacts produits (worktree `i18n/english`)

| Fichier | Contenu |
|---|---|
| `data/spells-seed.json` | seed réécrit : EN complet (noms + descriptions + higherLevel) |
| `packages/shared/src/classFeatures.en.ts` | 307 features EN + `CLASS_NAMES_EN` + `SUBCLASS_SHORTNAMES_EN` |
| `data/monsters-en.json` | overlay EN des 568 monstres appariés (nom, traits, actions, réactions, légendaires, sens, langues, vitesse) |
| `data/monsters-en-manual.json` | 35 traductions manuelles (17 écarts WotC + 18 Tome of Beasts : Akyishigal→Apau Perape + les 6 araignées) |
| `scripts/i18n/*.py` | `flatten5e.py` (aplatisseur commun), `fill-spells-en.py`, `build-class-features-en.py`, `match-monsters-v2.py`, `probe-5etools.py` |
| `scripts/i18n/monster-match-report.json` | rapport d'appariement (méthodes par monstre + liste du résiduel) |


## Décision structurante

**Le français reste la langue de stockage** (base, seeds, contenu saisi par les joueurs) ; l'anglais est un **calque additionnel** : champs `name_en` / `description_en` etc. partout où une clé stable existe déjà (`srdIndex`, `slug`, `id` de feature). Aucune donnée FR n'est réécrite. Le choix de langue est un réglage client (détection navigateur + préférence utilisateur), jamais une migration du contenu existant.

## Source anglaise : le miroir GitHub de 2014.5e.tools

`https://2014.5e.tools/` lui-même est derrière un challenge Cloudflare (403 sur toute requête non-navigateur — vérifié). On passe par le miroir GitHub actif des fichiers du site :

- **Dépôt** : `github.com/5etools-mirror-3/5etools-2014-src` (branche `main`, dernier push 2026-08-26)
- **Récupération** : clone creux + sparse-checkout de `data/spells/**`, `data/bestiary/**`, `data/class/**`, `data/items.json`, `data/items-base.json`, `data/magicvariants.json`, `data/conditionsdiseases.json`, `data/languages.json` (~37 Mo)
- **Reproductibilité** : le script d'import épingle un commit hash (registre dans le rapport d'import), pas `main` flottant

Fichiers exploités :

| Besoin | Fichier 5e.tools | Contenu |
|---|---|---|
| Sorts EN | `data/spells/spells-{phb,xge,tce,ftd}.json` | `spell[].{name, entries, entriesHigherLevel}` |
| Objets EN | `data/items.json` + `items-base.json` + `magicvariants.json` | `item[]`/`baseitem[]` + variantes magiques templatisées (`+1 Armor`…) |
| Monstres EN | `data/bestiary/bestiary-*.json` (~100 fichiers, tout MM→MCV4) | `monster[].{name, size, type, cr, str..cha, trait, action, legendaryAction}` |
| Features de classe EN | `data/class/class-*.json` | tableaux racine `classFeature` / `subclassFeature` (`{name, className, subclassShortName, level, entries}`) + index `classFeatures` (`"Rage|Barbarian||1"`) |
| Conditions EN | `data/conditionsdiseases.json` | `condition[].name` (les 15 + exhaustion) |
| Langues EN | `data/languages.json` | `language[].name` |

**Note de licence** : le texte SRD 5.1 est OGL (attribuable). Le miroir héberge aussi du contenu non-SRD (XGE/TCE/FTD, bestiaires d'aventures) — même statut que les données FR déjà présentes dans ce dépôt : usage de campagne privée, ne pas exposer au-delà.

## Couverture mesurée (sonde du 2026-08-28)

*(Mesures issues du commit miroir `544b3d2a032189e389e6b64bd94077992a51589f`, journalisé par la sonde.)*

| Corpus | Nous | Auto-match | Stratégie validée | Résiduel |
|---|---|---|---|---|
| **Sorts** | 490 | **484 (98,8 %)** | nom EN normalisé (NFKD, sans ponctuation) ; +14 via alias par suffixe (`Floating Disk` → *Tenser's Floating Disk*) | 6 : 3 noms EN corrompus dans notre seed (`Projectile elementaire`, `Vents contraires`, `Invocation d ombres`) + 3 alias SRD manuels (`Arcane Hand`→*Bigby's Hand*, `Arcane Sword`→*Mordenkainen's Sword`, `Arcanist's Magic Aura`→*Nystul's Magic Aura*) |
| **Objets** | 646 | **477 (73,8 %)** | nom normalisé + **inversion virgule** (`Crossbow, light` → *Light Crossbow*, +29) | 169 : noms « ou » (`Flask or tankard`), parenthèses (`Rope, hempen (50 feet)`), `Barding: X` non-templatisé, variantes magiques (`Armor, +1` via `magicvariants.json`) → 2ᵉ passe alias + ~30 manuels |
| **Monstres** | 964 | **480 (50 %)** — 560 (58 %) avec flou | union : slug EN (124) ∪ **empreinte numérique** (taille+type+CR+6 caractéristiques — indépendant de la langue) ; +80 en flou unique (≤2 caracs à ±2) | 168 ambigus en flou (désambiguïsation semi-manuelle par indice de nom) + ~236 sans candidat (créatures absentes de 5e.tools : versions 5e-drs propres, ToA FR, `Tome of Heroes` tiers) → dictionnaire FR→EN manuel |

Détails de l'empreinte monstre (validés par la sonde) : tailles FR→EN `{M→M, G→L, P→S, TG→H, TP→T, Gig→G}` ; types FR→EN (14 racines + nettoyage de la prose OCR : parenthèses, « de Grande taille »…) ; caracs `for/dex/con/int/sag/cha`. Corroboration secondaire : concordance des PV à ±2 dans **151/154** cas testés — à utiliser comme garde-fou anti-faux-positifs.

**État des champs EN déjà présents** : les sorts ont DÉJÀ `description` EN + `descriptionFr` (le pipeline sorts ne fait que vérifier + corriger) ; les objets ont `name` EN mais descriptions FR uniquement (518) ; les monstres n'ont rien d'EN. Les features de classe (307) sont FR uniquement — et leurs descriptions sont nos **résumés templatisés courts** (`{{save_dc}}`…), pas la prose SRD complète : le texte 5e.tools fournit le **nom** EN fiable, mais la traduction des résumés reste un travail de traduction à part (assistable par LLM).

## Pipelines (`scripts/i18n/`)

```
scripts/i18n/
  fetch-5etools.sh            # sparse clone épinglé à un commit (hash journalisé)
  probe-5etools.py            # LA sonde utilisée pour ce plan (déjà écrite, rejouable)
  match-spells.ts             # normalisation + alias suffixe + tables d'alias manuelles
  match-items.ts              # normalisation + inversion virgule + magicvariants + alias manuels
  match-monsters.ts           # slug ∪ empreinte ∪ flou-unique ; écrit monster-match-report.json
  review-monsters.ts          # revue interactive des 168 ambigus (candidats + score de nom) → manual-monster-map.json
  manual-monster-map.json     # dictionnaire FR→EN validé à la main (versionné)
  seed-en.ts                  # écrit les champs *_en dans data/*-seed.json depuis les matchs
```

Chaque `match-*` produit un rapport JSON (`matched` / `missed` / `ambiguous` + hash du commit 5e.tools) — le seuil de couverture devient vérifiable en CI. Toute correspondance par empreinte floue exige la corroboration PV pour être acceptée sans revue.

Priorité du manuel monstres : d'abord les 60 de *Tombe de l'Annihilation* (la campagne en cours), puis le *Livre des monstres*, puis le reste.

## Modèle de données & moteur partagé

1. **Seeds** : champs `nameEn` (+ `descriptionEn`, `higherLevelEn`) ajoutés côte à côte des champs FR existants ; `seed-en.ts` les remplit ; l'importeur de boot les pousse en base.
2. **Base (Drizzle)** : colonnes nullables `name_en`, `description_en` sur `items`, `spells`, `monsters` (migration versionnée `db:generate` classique). Nullables = « pas encore traduit », l'UI retombe sur le FR. La recherche `normalize()` est déjà indifférente aux accents ; chercher sur `name_en` en locale EN suffit (pas d'`aliases_en` en v1).
3. **Moteur (`packages/shared`)** : les 20 maps `*_FR` deviennent `LABELS.fr` / `LABELS.en` avec un `labelFor(key, locale)`. **Prérequis bloquant hérité de l'audit** : conditionner par des clés stables `DND_CONDITIONS_FR` (16) et `DND_LANGUAGES` (18) — migration des valeurs stockées + remplacement des comparaisons `name === 'Artificier'` par `classKey`.
4. **Features de classe** : table `CLASS_FEATURES_EN` indexée par les mêmes `id` (le match 5e.tools donne les noms EN par `className`+`level` ; les 39 sous-classes passent par une table de correspondance libellé FR↔EN à constituer une fois). Les 307 descriptions templatisées sont traduites depuis nos résumés FR (passe LLM + relecture humaine), pas copiées de 5e.tools.

## UI, API, tests

- **UI** : `react-i18next` + catalogues `fr.json`/`en.json` (~900–1 200 clés, extraction mécanique — périmètre détaillé dans l'audit) ; locale par détection navigateur, préférence utilisateur dans l'app, `document.documentElement.lang` dynamique ; les 9 sites `Intl('fr-FR')` passent par la locale active ; pluriels ICU (remplace les ~8 `${n>1?'s':''}`).
- **API** : les contenus exposent les deux noms (ou filtrés par `Accept-Language`/`?lang=`) ; les ~330 messages d'erreur deviennent des codes stables traduits côté client (recommandation de l'audit).
- **E2E** : migrer les ~287 assertions texte vers `data-testid` **avant** l'extraction des chaînes, puis un spec « smoke » en locale EN.
- **Hors périmètre** : contenu saisi par les joueurs (notes, backstory, chronique), manifeste PWA (nom de marque), site marketing (chantier séparé si un jour voulu).

## Phases

| # | Contenu | Charge |
|---|---|---|
| P0 | Fondations : locale + provider, clés conditions/langues (migration), `classKey` partout | 2–3 j |
| P1 | Sorts : vérification + correctifs des 6 entrées | 0,5 j |
| P2 | Objets : pipeline + descriptions EN (518) via 477 matchs + passe alias | 1–1,5 j |
| P3 | Monstres : auto 480 + flou 80 revu + dictionnaire ~350 (ToA d'abord) | 2–3 j |
| P4 | Shared : features 307 (noms par match, traduction des résumés) + 20 maps labels | 2–3 j |
| P5 | UI : extraction catalogues + switcher + Intl + e2e testids | 4–6 j |
| P6 | API : codes d'erreur + négociation de langue | 1–2 j |

**Total ~2–3 semaines** , dont le manuel monstres et l'extraction UI dominent. P1–P3 ne dépendent pas de P0 (travail de données pur) et peuvent démarrer en parallèle.
