# Plan — Marketing « Contenus personnalisés » (site + captures)

**Livrable** : mettre en avant la création de contenus personnalisés — **aujourd'hui objets + armes personnalisés (déjà en prod, jamais mis en avant)**, **demain en plus sorts personnalisés (MD), monstres personnalisés (MD), armures personnalisées (joueurs si le MD ouvre le toggle d'autonomie)**. Deux supports : une nouvelle section du site statique (`site/`) et de nouvelles captures de démonstration (`docs/screenshots/`, convention `NN-slug.png`, suite à partir de **34**).

Angle arbitré : **« votre monde, vos règles — le MD crée sorts et monstres, la table crée ses objets »**. Ton : « la fiche de personnage du produit », tout en français, même monde parchemin/encre/sang/or.

---

## 1. Inventaire de l'existant (lu dans le code)

### 1.1 Le produit — ce qui existe vraiment

| Contenu | État | Points d'appui vérifiés dans le code |
|---|---|---|
| **Objets personnalisés** | ✅ en prod | `POST /api/parties/:partyId/items` (`routes/items.ts`) : MD toujours ; joueurs si `parties.players_create_items` (défaut **1**, kill switch MD — libellé « Les joueurs peuvent créer des objets »). Objets scopés au groupe (`source:'custom'`, `party_id`), avec poids/prix/rareté/description + **illustrations** (`routes/item-images.ts`, même porte que la création). UI joueur : « Créer un objet » dans le catalogue (`inv.creer.un.objet`, `CatalogSearch.tsx`) ; UI MD : onglet **« Objets personnalisés »** du tableau MD (`GmDashboardPage.tsx` → `CustomItemsTab`). |
| **Armes personnalisées** | ✅ en prod | Même route, `category:'weapon'` : champs validés par `validateWeaponFields` — **« Basée sur »** (arme de base SRD), **« Dégâts »** modèle libre (`2d6+FOR+DEX+magie`), **« Type de dégâts »**, **« Propriétés »**, dés 2M, bonus magique. Le moteur partagé calcule ensuite les puces 🎯 ⚔ ✨ ⚠ exactement comme pour le SRD (`computeWeaponStats`). |
| Sorts personnalisés (MD) | ❌ à venir | N'existe pas encore (aucune trace dans `routes/` ni l'i18n). Pré-requis : PR produit en amont. |
| Monstres personnalisés (MD) | ❌ à venir | Idem — le bestiaire ne sert aujourd'hui que le seed 5e-drs (964 monstres). |
| Armures personnalisées (joueurs si toggle) | ❌ à venir | Idem — `resolveItemBases` sait déjà lire les en-têtes « Armure (…) » côté moteur, mais aucune route de création d'armure custom n'existe. |

**Conséquence marketing** : les objets et armes personnalisés sont **déjà en prod et invisibles sur le site** (zéro occurrence de « custom »/« personnalisé » dans `site/` — vérifié) et absents du README. La section peut vivre en deux temps : tranche A (objets + armes) tout de suite, tranche B (sorts, monstres, armures) quand les PR produit arrivent.

### 1.2 Le site — sections actuelles et grammaire

`site/index.html` (1 647 lignes) déroule **le tour de table** — dix sections à ordinaux romains **codés en dur** dans le HTML :

| # | id | Titre FR | Idiome média |
|---|---|---|---|
| I | `table` | La table en temps réel (`is-lead`) | panel `demo` interactif + `shot-pair` + `entry-wide` deskframe |
| II | `fiche` | La fiche du joueur | `phonepost story --views:5` + `story--wide` (2 vues tablette) |
| III | `inventaire` | Le sac et la bourse | `phonepost story --views:5` |
| IV | `md` | L'écran du MD | `phonepost story --views:3` + `story--wide` (2 deskframes bureau) |
| V | `correspondance` | La correspondance secrète | `phonepost story --views:3` |
| VI | `chronique` | La chronique | `phonepost story --views:3` |
| VII | `deux-lumieres` | Les deux lumières | `story--lights` (2 vues) + `entry-wide` deskframe |
| VIII | `personnalite` | Personnalité | grille `personality` (4 cartes, pas de capture) |
| IX | `tutoriel` | La visite guidée | `phonepost story --views:2` |
| X | `repos-long` | Repos long : auto-hébergement | panel `deploy` + terminal |

**Mécanique d'ajout d'une section (zéro-build, vérifiée dans `main.js`)** :
- une `<section class="entry wrap" id="…">` est **armée automatiquement** : fil de lecture / TOC de marge (construit depuis `main .entry[id]`), tampon de l'ordinal au scroll, stories (`data-story-view` ↔ boutons du dock), visionneuse plein écran des images. **Rien à écrire côté JS**.
- grammaire d'une section média : `entry-head` (ordinal + `entry-title` bilingue) → `entry-body has-folio` → `entry-copy--folio > ul.subentries > li[data-story-view]` (titre h3 + paragraphe) face à un `figure.phonepost.story style="--views:N"` (`story-stage`/`story-side`/`figcaption` + `phonepost-view` img + `phonepost-dock` boutons `data-view`/`data-caption`/`data-en-caption`). Vue large : `figure.shot.entry-wide` + `deskframe` (barre URL + points).
- **bilingue obligatoire** : chaque texte existe en paire `<span lang="fr">…</span><span lang="en">…</span>`, images avec `alt` + `data-en-alt`. Le site n'a pas de mode « FR seul ».
- **assets** : les images pointent `assets/screenshots/NN-*..png`, **copies de `docs/screenshots/` au moment du preview/déploy** (`npm run site` :4188 ; workflow `site.yml` déclenche sur `site/**` + `docs/screenshots/**`). `site/assets/` est gitignoré — **ne jamais le committer**. Le site sert les captures FR pour les deux langues (seules légendes/alt sont traduits) : la sortie `--lang en` ne conditionne pas le site.
- **piège** : les ordinaux sont du texte HTML — insérer une section en position V décale V→X en VI→XI (6 retouches).

### 1.3 Le générateur de captures (`scripts/generate-screenshots.ts`, 1 990 lignes)

- Stack jetable (API tsx + SQLite neuf `screenshots-demo.sqlite` + vite proxy), seed REST de la campagne **« Les Héros de Chult »** (MD `mdj`, joueurs `aurore`/`bastien` ; PJ Lyra Druide Lune, Kael Guerrier, Mira Clerc), puis 33 entrées dans `SHOTS` (`01-…` à `33-…`).
- **Phases dans `main()`** : captures joueur (tour de Lyra) → `advanceTurn()` → captures `GM_SHOTS` (état « combat en cours ») → `INIT_SHOTS` (29–30, clorent l'embuscade et dressent « Embuscade batiri »). `--only 03,07` accepte numéros ou noms (préfixe), `--lang en` → `docs/screenshots-en/`.
- Sessions par cookie `ts_access` (`newSession()`), clés tutoriel posées, mode bougie via `ts-theme`. **Gotchas** : `settle()` attend le point de synchro « Synchronisé » + marge — le splash encre (plancher 1 750 ms) est absorbé par les attentes, toute nouvelle capture doit laisser ce temps ; les groupes de catégories d'inventaire sont repliés (helper `expandInventoryCategories`) ; `animations: 'allow'` obligatoire là où une transition porte l'état (le `expand-grid` annulé par `animations:'disabled'` peint l'état replié) ; les helpers d'état (`ensureInitiativeEncounter`, `ensureAmbushMidFight`, `endFights`) sont **idempotents** pour que chaque capture tourne seule sous `--only`.
- Le README embarque aujourd'hui 3 captures (23, 32, 33) et un bloc « Fonctionnalités » en puces — aucune mention du contenu personnalisé.

---

## 2. Nouvelle section marketing

### 2.1 Placement

**Entre IV « L'écran du MD » et V « La correspondance secrète »** — elle devient l'entrée **V**, et les sections V–X deviennent VI–XI (6 retouches d'ordinal dans le HTML).

Pourquoi là : la lecture vient de voir le bestiaire et le traqueur (IV) — tout le contenu SRD, « officiel ». La section suivante répond naturellement « et quand le monde officiel ne suffit pas » : le MD prolonge son écran (sorts, monstres), la table prolonge son sac (objets, armes, armures). La placer après III (« Le sac et la bourse ») ferait passer les créations du MD pour une fioriture d'inventaire ; la narration gagne à rester côté MD d'abord, table ensuite. La correspondance (actuellement V) ouvre ensuite la partie « vie de la table » — la couture reste propre.

### 2.2 Titre, id, structure

- **id** : `vos-regles` (ancre stable, même famille que `correspondance`, `chronique`).
- **Titre** : « Votre monde, vos règles » / EN : *Your world, your rules*.
- **Structure** : la grammaire standard `entry → subentries + phonepost story --views:5` (comme II et III), plus **une** vue large `entry-wide` deskframe en clôture de section (comme I et VII). Pas de nouveau composant, pas de nouveau token — le monde visuel existant suffit.

### 2.3 Copy FR proposée (accroche + puces)

**Lead (paragraphe d'ouverture, en tête de `entry-copy`)** :

> Six cent quarante-six objets, quatre cent quatre-vingt-dix sorts, neuf cent soixante-quatre monstres — et le jour où Chult demande autre chose, la table invente. Le MD écrit ses sorts et dresse ses monstres ; les joueurs créent leurs objets, leurs armes, leurs armures. Tout vit dans le grimoire du groupe, à côté du SRD.

**Puces (subentries, dans l'ordre des vues du story)** :

1. **Les trésors de la table** *(vue 0 — aujourd'hui)*
   > Un objet que le SRD n'a jamais connu : nom, poids en kilogrammes, prix, rareté, description — et une illustration si la table en a une. Le joueur le crée depuis le catalogue en un geste si le MD ouvre l'autonomie ; le MD, toujours. L'objet rejoint le catalogue du groupe et se prête, se transfère, se pèse comme n'importe quel objet du SRD.
2. **L'arme de légende** *(vue 1 — aujourd'hui)*
   > Une lame qui n'existe nulle part ailleurs : « Basée sur » une arme du SRD ou entièrement libre, modèle de dégâts à la main — 2d6+FOR+2 —, type, propriétés, dés à deux mains, bonus magique. Le moteur de règles calcule attaque 🎯, dégâts ⚔ et magie ✨ exactement comme pour l'officiel : la fiche ne fait pas la différence.
3. **Les sorts du grimoire du MD** *(vue 2 — demain)*
   > Le MD inscrit ses propres sorts : nom, école, niveau, table d'incantation supérieure comprise. Le sort rejoint le grimoire du groupe, se prépare et se lance comme un sort du SRD — emplacements, concentration 🌀, dégâts mis à l'échelle. Réservé au MD : le grimoire s'ouvre derrière l'écran.
4. **Le bestiaire s'agrandit** *(vue 3 — demain)*
   > Un monstre que seul ce monde connaît : bloc de stats complet, CA, PV, actions, dés cliquables. Il vit dans le bestiaire du MD et se dresse dans une rencontre en deux gestes — initiative, tours, frappes : le traqueur ne fait pas la différence non plus.
5. **Armures sur mesure** *(vue 4 — demain)*
   > La table façonne aussi ses armures — le MD garde le kill switch, comme pour les objets : l'autonomie s'ouvre depuis son tableau. Base, type, malus, requis : la fiche recalcule la classe d'armure sur-le-champ, miroir du moteur SRD.

*(Chaque puce « demain » n'est publiée que when la feature l'est — voir Q4. La puce 1 porte l'accroche « votre monde, vos règles » : le MD crée sorts et monstres, la table crée ses objets.)*

**Vue large deskframe (clôture de section)** : le traqueur du MD derrière un grand écran avec **le monstre custom en pleine rencontre** — légende : « Le monstre de votre invention, en plein round — même traqueur, mêmes dés. »

**Micro-retouche hors section** : dans III « Le sac et la bourse », la puce « Pesé au kilogramme » gagne une demi-phrase : « — du SRD comme de votre cru. » (lien d'amorce vers `#vos-regles`). Rien d'autre ne bouleversé.

### 2.4 Idiomes réutilisés tels quels

`entry`/`entry-head`/`entry-ordinal`/`entry-title`, `has-folio`/`entry-copy--folio`/`subentries`, `phonepost story` + `phonepost-dock` + `data-story-view`, `shot entry-wide` + `deskframe`/`deskframe-bar`/`deskframe-url`, paires `lang="fr|en"` et `data-en-*`. **Aucune nouvelle règle CSS n'est requise** ; si un décalage survenait, un à deux réglages dans `styles.css` existants (espacements) suffiraient. `main.js` n'est pas touché.

---

## 3. Nouvelles captures (numéros 34+, convention existante)

Sept captures, en **deux tranches** : A = fonctionnalités déjà en prod (34–36), B = gated sur les PR produit (37–40). Chaque entrée `SHOTS` suit les helpers existants (`openSheet`, `openTab`, `settle`, `shoot`) ; l'état custom passe par un **helper idempotent** `ensureCustomContent(c)` (motif `ensureInitiativeEncounter`) pour que `--only 34` tourne seul.

| # | Fichier | Quoi montrer | Qui agit | Viewport | Seed nécessaire | Neutralisations | Apparaît dans |
|---|---|---|---|---|---|---|---|
| **34** | `34-objet-personnalise.png` | La feuille **« Créer un objet »** du catalogue joueur, remplie (nom « Idole de jade batiri », poids, prix, rareté, description) — le bouton `inv.creer.et.ajouter` visible | **Joueur** (Aurore/Lyra) | mobile 390×844 | rien de neuf : `players_create_items` est à 1 par défaut (vérifié en seed) — ouvrir la feuille du bas du catalogue (FAB) puis « Créer un objet » | `settle()` ≥ 1,75 s (splash) ; attente `networkidle` après saisie | Site (vue 0 du story) |
| **35** | `35-arme-personnalisee.png` | Le **formulaire d'arme** du MD : onglet « Objets personnalisés » du tableau MD, « Nouvel objet personnalisé » catégorie Arme — « Basée sur », « Dégâts » `1d8+FOR+2`, type, propriétés cochées, bonus magique | **MD** (`mdj`) | mobile 390×844 | rien : le formulaire est une création pure (pas de POST avant la capture) | idem 34 ; modal → focus champ, attendre le rendu | Site (vue 1) |
| **36** | `36-arme-custom-fiche.png` | **L'arme custom sur la fiche de Kael** : ligne d'inventaire + carte dépliée avec les puces calculées 🎯 ⚔ ✨ (le moteur traite la lame inventée comme une lame du SRD) | Joueur (Bastien/Kael) | mobile 390×844 | `ensureCustomContent` : POST MD de l'arme (ex. « Croc de mégalodon », `category:'weapon'`, `damageDice:'1d8+FOR'`, `magicBonus:2`, basée sur Épée longue) + ajout à l'inventaire de Kael | `expandInventoryCategories` (groupes repliés) ; `animations:'allow'` si une transition porte l'état déplié | Site (vue 1, variante) + **README** (candidate à l'embarquement, voir Q6) |
| **37** | `37-sort-personnalise.png` | **Création d'un sort custom par le MD avec upcast** : formulaire/nouvelle UI sorts du MD, nom (« Chant des neuvièmes vagues »), niveau, table `damage_at_slot_level` visible — l'aperçu d'incantation supérieure à l'échelle | **MD** | mobile 390×844 | ⛔ tranche B : la route/UI sorts custom doit exister ; seed du sort via la future route MD | idem 34 | Site (vue 2) |
| **38** | `38-monstre-personnalise.png` | **Statblock d'un monstre custom dans le bestiaire MD** : CA, PV, actions, dés cliquables — « Rôdeur batiri à plumes » côtoie les 964 du SRD | **MD** | mobile 390×844 | ⛔ tranche B : future route monstres custom + seed du monstre ; si la fiche bestiaire a un état replié, le déplier explicitement | idem 34 | Site (vue 3) |
| **39** | `39-monstre-custom-rencontre.png` | **Le monstre custom dans une rencontre**, vue trois colonnes du traqueur bureau (rail d'initiative, scène du tour, bloc de stats amarré — miroir de la 24 avec la créature inventée) | **MD** | **bureau 1440×900** (`newSession desktop`) | ⛔ tranche B : monstre seedé + rencontre active en plein tour (étager sur `ensureAmbushMidFight` ou une rencontre dédiée idempotente) | **à ajouter dans `GM_SHOTS`** (état mi-combat) ; `settle()` long | Site (`entry-wide` deskframe) |
| **40** | `40-armure-personnalisee.png` | **Joueur créant une armure custom, CA recalculée** : le formulaire d'armure (autonomie ouverte par le MD) puis la tuile Caractéristiques où la CA bascule — avant/après visible | **Joueur** (Bastien/Kael) | mobile 390×844 | ⛔ tranche B : future feature + le MD a ouvert le toggle d'autonomie armures (s'il suit le modèle `players_create_items`, l'activer dans le seed ou via le dashboard) | idem 34 ; deux états si avant/après | Site (vue 4) |

**Rangement dans les phases** : 34–36, 40 = captures joueur ; 37–38 = pages MD sans état de combat → phase joueur avec le contexte `md` (comme 15/16 aujourd'hui) ; **39 rejoint `GM_SHOTS`** (mi-combat). Aucune n'est `INIT_SHOTS`. Les fichiers atterrissent dans `docs/screenshots/` — le workflow `site.yml` déploie le site automatiquement (déclencheur `docs/screenshots/**`), et `npm run site` copie vers `site/assets/` au preview. **Ne jamais committer `site/assets/`.**

**Version EN** : `npm run screenshots -- --lang en` régénère `docs/screenshots-en/` — les chaînes attendues des captures A existent déjà dans `en.json` ; les chaînes B suivront les PR produit. Le site, lui, n'utilise que les captures FR (convention en place).

---

## 4. Estimation d'impact

### Fichiers touchés

| Fichier | Nature du changement |
|---|---|
| `site/index.html` | Nouvelle section `#vos-regles` (subentries bilingues + story 5 vues + 1 deskframe) ; **renumérotation des ordinaux V–X → VI–XI** (6 retouches) ; demi-phrase d'amorce dans la puce « Pesé au kilogramme » (III) |
| `site/styles.css` | *Aucun changement attendu* (idiomes existants) — au pire 1–2 ajustements d'espacement |
| `scripts/generate-screenshots.ts` | Helper idempotent `ensureCustomContent` + 7 entrées `SHOTS` (34–40) + `39…` ajoutée à `GM_SHOTS` ; seeds tranche B quand les routes existent |
| `docs/screenshots/34…40-*.png` | 7 fichiers générés (jamais édités à la main) |
| `README.md` | 1 puce « Contenus personnalisés » dans Fonctionnalités (+ éventuellement la capture 36, voir Q6) |
| `docs/plan-custom-content-marketing.md` | Ce plan |
| `CHANGELOG.json` | Entrée obligatoire à la PR (règle repo) |
| `site/DESIGN.md` | Mise à jour du descriptif du tour de table (le doc dit encore « I–IX », déjà en retard sur X → XI) — cosmétique, recommandée |

### Ce qui ne change pas

- **Aucun code produit** : `apps/**`, `packages/**`, `data/**` intacts — ce plan suppose les features B livrées par leurs propres PR.
- `site/main.js` (armement générique), `.github/workflows/site.yml` (déclencheurs déjà couverts), `site/assets/` (jamais committé), le seed existant de la campagne démo, la numérotation 01–33 (append-only), les sections et stories existantes du site.
- Les gates CI (lint/typecheck/test-api/test:e2e) — rien de ce périmètre ne les touche, hormis la PR qui porte le tout (`changelog:check` inclus).

---

## 5. Décisions ouvertes

**Q1 — Section unique « contenus personnalisés » vs dispersion dans les sections existantes ?**
Reco : **section unique** (V « Votre monde, vos règles »). La dispersion noierait le message (un demi-mot dans III, un autre dans IV) et casserait le tour de table ; la grammaire du site est justement « une entrée = un chapitre du produit ». La demi-phrase d'amorce dans III suffit à faire le pont.

**Q2 — Combien de nouvelles captures ?**
Reco : **7 (34–40)** — 3 pour la tranche A (création objet joueur, formulaire arme MD, arme custom calculée sur fiche : les trois moments « je crée → le moteur prend le relais »), 4 pour la tranche B (sort upcast, statblock monstre, monstre en rencontre au bureau, armure + CA). C'est le format des sections existantes (story ≤ 5 vues + 1 deskframe) ; en dessous (5), la tranche B n'aurait qu'une capture par feature et la promesse « sorts ET monstres ET armures » paraîtrait creuse ; au-dessus (9+), la section deviendrait la plus lourde de la page pour un sujet secondaire face au temps réel.

**Q3 — Version EN (`--lang en`) tout de suite ?**
Reco : **oui pour la tranche A** (chaînes EN déjà dans `en.json`, coût d'un run), **à la livraison de chaque feature pour la tranche B** — jamais en avance sur des libellés qui n'existent pas (règle du script : « les chaînes EXACTES du catalogue EN — ne pas inventer »). Le site reste servi en captures FR pour les deux langues : rien à faire côté site.

**Q4 — Publier la section en deux temps ou tout d'un bloc ?**
Reco : **deux temps**. Tranche A immédiate (objets + armes sont en prod et invendues — c'est du gâchis marketing), avec les puces 1–2 et un story à 2 vues + annonce « sorts, monstres et armures arrivent » dans le lead. Tranche B : chaque puce/capture s'ajoute à la livraison de sa feature, sans renuméroter quoi que ce soit (append-only). Le bloc unique ferait taire des features live pendant des semaines.

**Q5 — Le bandeau de mesures du hero (646/490/964/16) évolue-t-il ?**
Reco : **non**. Les compteurs disent « ce qui est déjà dans la boîte » (catalogue seedé) ; le contenu personnalisé est par-groupe et non dénombrable. L'accroche « et le jour où Chult demande autre chose, la table invente » dans le lead de la section porte l'idée mieux qu'un « ∞ » qui casserait le registre des valeurs mesurées (mono, chiffres SRD).

**Q6 — Le README embarque-t-il une capture ?**
Reco : **puce seule** dans Fonctionnalités (« **Contenus personnalisés** — objets et armes créés par la table (dégâts et attaque calculés par le moteur) ; sorts et monstres du MD, armures des joueurs — à terme »), sans image : le README reste sobre (3 captures aujourd'hui) et renvoie déjà vers le site « chaque fonctionnalité présentée en détail, avec captures ». Si l'on veut une image, la 36 (arme custom avec puces 🎯 ⚔ ✨) est la seule qui se comprend sans contexte — à décider au moment de la PR.

**Q7 — Renumérotation des ordinaux V–X → VI–XI : sûr ?**
Reco : **oui, assumer le décalage**. Les ancres (`id`) et l'ordre ne changent jamais ; seuls les glyphes d'ordinal bougent (6 retouches de texte). Une numérotation sautée (I–IV puis VI…) pour « réserver » le V serait une rustine invisible du visiteur et un piège pour les futurs mainteneurs. Profiter de la PR pour corriger le « I–IX » périmé de `DESIGN.md`.
