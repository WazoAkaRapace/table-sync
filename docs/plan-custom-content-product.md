# Plan produit — Contenus personnalisés : sorts, monstres, armures

**Découverte produit (spec fonctionnelle)** · Édition D&D 5.1 / SRD 2014 **uniquement** — jamais de contenu 5e2024 ou maison non-SRD déguisé. Document d'arbitrage : les décisions ouvertes (§7) seront soumises à l'utilisateur avant toute implémentation. Aucun code ici, uniquement le périmètre.

## 0. Règles projet non négociables

1. **SRD 5.1 / 2014 seul** — les catalogues seedés (646 objets, 490 sorts, 964 monstres) font foi ; noms français officiels = **AideDD.org / 5e-drs.fr**, jamais inventés pour du contenu SRD. Un contenu *custom* est par définition hors SRD : son nom est libre, mais l'app ne doit jamais laisser croire qu'il est officiel (badge « Custom », pas de `srdIndex` réel).
2. **« Helper, not automation »** — l'app affiche et calcule, elle ne déclenche jamais rien automatiquement. Un sort custom porte une DD de sauvegarde *affichée* ; c'est le joueur qui la rolled à la table. Un monstre custom expose son statblock ; le MD garde la main sur chaque jet du traqueur.
3. **Le MD seul crée sorts et monstres.** Les armures suivent le pattern armes/objets : création joueur possible **si** le MD a ouvert le toggle d'autonomie (kill-switch au tableau MD).
4. **Tout en français** (UI + noms + descriptions). L'anglais est un overlay de lecture, jamais une obligation de saisie (voir Q10).
5. **Temps réel** : toute écriture de contenu custom émet son événement WS dédié ; les écrans ouverts se rafraîchissent sans rechargement (vocabulary v2 : granularité par **valeur d'action**, jamais de nouveau type d'événement).

---

## 1. État des lieux (ancré dans le code)

### 1.1 Objets & armes custom aujourd'hui — le pattern de référence

**Modèle de données** (`apps/api/src/db/schema.ts`, table `items` L280-329) :
- `source TEXT NOT NULL DEFAULT 'srd'` avec CHECK `source IN ('srd','custom')` ;
- `party_id` NULL = global/SRD ; un custom vit **dans son groupe** (`ON DELETE cascade`) ;
- `created_by → users` (SET NULL) — l'auteur est tracé, y compris joueur ;
- champs d'arme (plan armes-custom 2026-11) : `base_weapon`, `damage_dice`, `damage_type`, `two_handed_dice`, `magic_bonus`, `properties_json` ;
- champs d'armure déjà présents en base mais **jamais alimentés par le créateur** : `base_armor`, `armor_family`, `ac_base`, `str_min`, `stealth_disadvantage` (§1.4) ;
- pas d'unicité sur le nom : un custom peut porter le même nom qu'un objet SRD.

**Parcours MD** (`GmDashboardPage.tsx`, onglet « Objets custom » → `CustomItemsTab` L997+) :
- sélecteur de catégorie : `custom` / `weapon` / `armor` / `gear` / `magic` (L1337-1341) ;
- panneau **Arme** (`WeaponFields`) affiché uniquement pour `category === 'weapon'` (L1347) : dés, type SRD, bonus magique 0-3, propriétés (liste blanche `WEAPON_PROPERTY_LABELS_FR`), arme de base, dés 2M si Polyvalente — avec aperçu symbolique (pas de porteur) ;
- illustration (upload plafonné, mêmes gardes que le PUT image), poids, description, rareté, coût ;
- édition et suppression des customs dans le même onglet (le MD est le seul éditeur, y compris des objets créés par les joueurs — `items.ts` L345, L442).

**Parcours joueur** (`CharacterInventoryPage.tsx` L617-621 + `CatalogSearch.tsx`) :
- dans la recherche du catalogue d'inventaire, un CTA « créer “X” » apparaît quand la recherche ne trouve rien (`createCta`, CatalogSearch L85) ;
- `canCreateItem = canEdit && (isGM || party.playersCreateItems)` (L996) — le rôle vient de `usePartyRole` → `GET /api/parties/:id/me` ;
- le créateur joueur partage le panneau Arme ; l'aperçu y est **chiffré** par le moteur sur le personnage réel (`e2e/custom-weapon.spec.ts` : « 4d6+FOR+2 » rend « 4d6+5 »).

**Toggle (kill-switch)** : case `#gm-players-create-items` dans l'onglet Objets custom du tableau MD → `PATCH /api/parties/:id { playersCreateItems }` (GmDashboardPage L1077). Côté API, la porte est double : `isPartyGM` passe toujours ; sinon membre du groupe **et** `parties.players_create_items` à 1 (`items.ts` L256-269). Le seed e2e laisse le toggle FERMÉ et la spec l'ouvre par API au nom du MD — le kill-switch reste au MD.

**API** (`apps/api/src/routes/items.ts`) : `POST /api/parties/:partyId/items` (validation `validateWeaponFields` L70-111, résolution des clés de base `resolveItemBases` — shared L3132 — le moteur ne parse jamais les noms au runtime) ; `PATCH /items/:id` GM seul, re-valide les champs d'arme sur le contexte fusionné ; `DELETE /items/:id` GM seul, purge l'illustration orpheline.

**Réactivité & visibilité** : chaque mutation émet `party:change action 'custom-item'` + `actorUserId` (L325) ; l'onglet Objets custom du MD et la page PNJ (`action 'npcs'`) ne se réveillent pas l'un l'autre (vocabulaire v2). Les customs ne sont visibles que des membres du groupe propriétaire (`GET /items?partyId=` filtre, `GET /items/:id` refuse hors-groupe). Les exemplaires annotés (`derived_from_item_id`) sont exclus du catalogue.

**Héritage gratuit pour les nouveaux types** : c'est ce socle (scoping par groupe, `created_by`, portes GM/toggle, événement `party:change` dédié, édition GM-seule) que sorts, monstres et armures custom doivent reproduire — pas réinventer.

### 1.2 Sorts aujourd'hui

- Table `spells` (schema.ts L443-474) : catalogue **global seed-only**, sans `source` ni `party_id` ni `created_by`. **`srd_index` est NOT NULL + UNIQUE** — un sort custom exigera soit un index synthétique, soit une migration.
- Colonnes par sort : niveau, école, temps d'incantation, portée, composantes + matériel, durée, `concentration`, `ritual`, descriptions FR/EN, `higher_level` FR/EN, `attack_type`, **`damage_json`** (tables `damage_at_slot_level` / `heal_at_slot_level`, drapeau `heal_adds_modifier`), **`dc_json`** (caractéristique de sauvegarde), `classes_json` (noms de classes FR).
- Routes (`routes/spells.ts`) : `GET /spells` (filtres classe/niveau/école, résumés **sans prose**, cache ETag + maxAge 300), `GET /spells/light` (id + nom + niveau, sert l'appariement des sorts de monstres, maxAge 3600), `GET /spells/:id` (prose complète). La méta EN vient d'un annexe `data/spells-en-meta.json` **clé par `srdIndex`**, avec repli champ par champ sur le FR.
- Fiche joueur (`CharacterSpellsTab.tsx`) : grimoire filtré par les classes du personnage (`classes_json LIKE`), apprentissage `POST /characters/:id/spells` (propriétaire ou MD — jamais bloqué par classe : helper, pas automation), lignes fusionnées des sorts *always-prepared* (domaines Clerc, cercles Druide, serments Paladin — **listes SRD codées dans shared**, hors de portée d'un custom sans évolution moteur), `CastSpellSheet` avec aperçu d'upcast lu sur les **tables** `damage_at_slot_level`/`heal_at_slot_level` + prose `higher_level` (drapeau `scalesAtHigherLevel` #171), flux concentration 🌀.
- `character_spells` (L478+) : lien (personnage, sort) avec `prepared`, `class_source`, `source` ('invocation'), **FK `spell_id` ON DELETE CASCADE** ; la liste servie est un JOIN résumé — l'édition d'un sort se reflète partout à la volée.

### 1.3 Monstres aujourd'hui

- Table `monsters` (schema.ts L640-685) : **clé primaire `slug`**, `name_fr` seul nom natif (+ overlay EN `overlay_en`), `search_text`/`name_search` **précalculés** au backfill de boot (`db/backfill.ts`) pour la recherche normalisée sans UDF par ligne. Catalogue global, sans `source`/`party_id`/`created_by`.
- Statblock complet : CA + desc, PV + dés de vie, `speed_json`, `abilities_json` (6 caracs), `saving_throws_json`, `skills_json`, sens/télépathie, langues, résistances/immunités (dégâts + conditions), `traits_json`, `actions_json`, `legendary_actions_json`, CR + XP. Les bonus d'attaque/dés/type des actions sont parsés à l'import.
- Routes (`routes/monsters.ts`) : `GET /monsters` (recherche pertinence nom-d'abord, résumés sans prose, maxAge 3600), `GET /monsters/:slug` (bloc complet). Aucune route d'écriture.
- Combat (`routes/combat/combatants.ts` L40-139) : `POST /encounters/:id/combatants/monster` résout le monstre **par slug**, tire mod DEX → `initiative_bonus`, **roule les PV par exemplaire** (`rollHitPoints(hit_dice, hit_points, conMod)`), copie CA/PV/max dans le combatant (le combatant est un *snapshot* chiffré ; seul `monster_slug` relie au statblock), groupe les mêmes slugs (`group_id`, initiative partagée, masque hérité). Le masque `name_hidden` **redacte aussi le slug** côté serveur pour les non-MD (`encounters.ts` L203-207).
- UI : `MonsterStatBlock` (bloc de stats complet) sert le traqueur MD (`CombatPage`) **et** le choix de forme sauvage du Druide (`SurvivalPanel`) ; l'incantation des monstres apparie `/spells/light` par nom.
- Les **PNJ** (`npcs.ts`) sont une autre bête : fiche narrative party-scoped avec secret GM-only — un « monstre custom » n'est pas un PNJ et réciproquement (frontière à garder explicite, cf. Q9).

### 1.4 Armures aujourd'hui (le branchement moteur)

- Le créateur d'objets propose déjà la catégorie `armor`… **sans aucun champ d'armure** : le POST n'accepte ni `acBase`, ni `strMin`, ni `stealthDisadvantage`, ni type — seuls les champs d'arme existent (`items.ts` L276-321). Une « armure » custom créée aujourd'hui n'est qu'un objet nommé armure : sa CA ne se branche que si son nom matche une armure SRD (`resolveItemBases` remplit `base_armor` par parse de nom à la création).
- `computeAC` (shared `index.ts` L2181-2269) : ne considère que `category === 'armor'` équipé ; armure magique (`acBase` null/0) → résolution de base + bonus ; armure avec `acBase` → clé stable `baseArmor` dans `MUNDANE_ARMORS`, sinon `findMundaneArmorByName` ; **à défaut de base, le type est déduit heuristiquement** (`strMin ≥ 13` → lourde, `acBase` 13-15 → intermédiaire, sinon légère — L2257-2263) ; bouclier = `armorType 'shield'` ou nom contenant « bouclier »/« shield » (+2, suivi à part) ; intermédiaire = cap DEX ×2, lourde = STR min sinon −3 m de vitesse, malus discrétion par `stealth_disadvantage`. La colonne `items.armor_family` **existe** mais n'est pas lue par `computeAC` pour un custom sans base résolue.
- En résumé : le moteur est prêt à 90 % (types vrais, caps DEX, STR min, boucliers, bonus magiques, tests `test-armor-stats`) ; ce qui manque est la **saisie explicite** et la **lecture des champs explicites** au lieu de l'heuristique (Q8).

### 1.5 Vue d'ensemble des manques

| | Objets/armes (fait) | Armures | Sorts | Monstres |
|---|---|---|---|---|
| Colonnes `source`/`party_id`/`created_by` | ✓ | ✓ (déjà sur `items`) | ✗ migration | ✗ migration (+ clé : `spells.srd_index` NOT NULL UNIQUE ; `monsters.slug` PK) |
| Routes d'écriture + portes | ✓ | ✓ (étendre POST/PATCH) | ✗ | ✗ |
| Panneau de création structuré | ✓ (arme) | ✗ | ✗ | ✗ |
| Branchement moteur | ✓ `computeWeaponStats` | ◑ heuristique → explicite | ✓ rien à changer (données pilotent tout) | ✓ le combatant snapshot déjà |
| Scoping visibilité groupe | ✓ | ✓ | ✗ (`GET /spells` global + cache maxAge) | ✗ (`GET /monsters` global + cache maxAge 3600) |
| Événement WS dédié | ✓ `custom-item` | ✓ | ✗ (`custom-spell` à créer) | ✗ (`custom-monster` à créer) |
| Toggle joueur | ✓ | ✓ à brancher | — MD seul | — MD seul |

---

## 2. Sorts personnalisés (création MD seule)

### 2.1 Utilisateurs & situations

- **MD (Mika)** : campagne maison avec sorts inventés (relique qui octroie un sort unique, divinité homebrew, pacte occulte). Il prépare en amont de la séance, sur desktop.
- **Joueurs (Léna…)** : leur lanceur reçoit « Grâce de la Serpente » au niveau 5 ; en séance, sur téléphone, ils doivent le lancer **exactement comme un sort SRD** : upcast, concentration, DD — sinon le custom reste « au papier » et l'app a échoué.
- Situation critique : le sort est **appris par un personnage** puis le MD le retouche entre deux séances — la fiche doit suivre sans action du joueur.

### 2.2 User stories

1. *MD* — Je crée « Grâce de la Serpente » (niveau 2, invocation, concentration, sauvegarde CON, dégâts 3d6 poison / +1d6 par cran) dans le pupitre MD, en moins de 3 minutes, sans quitter l'app.
2. *MD* — Je vois mes sorts custom dans une liste du pupitre, je les édite, je les supprime en sachant **qui les connaît**.
3. *Joueur lanceur* — Le sort custom apparaît dans le grimoire filtré par ma classe (ou une entrée « sorts de la table »), je l'apprends comme un sort SRD (bouton Apprendre, préparation, ordre).
4. *Joueur lanceur* — Je le lance : le CastSpellSheet affiche l'aperçu d'upcast au bon niveau (dés recalculés), le badge concentration se pose comme pour un sort SRD, la DD de sauvegarde est affichée.
5. *Joueur non lanceur* — Je ne vois jamais le sort si ma classe n'y a pas accès (filtrage classes_json) — sauf choix « toutes les classes » (Q3).

### 2.3 Périmètre fonctionnel

**Champs proposés** (but : *indistinguable d'un sort SRD dans toute l'app*) :

| Champ | Saisie | Rôle moteur/UI |
|---|---|---|
| Nom (FR) | texte, requis | partout ; pas d'unicité forcée (voir conflits §2.4) |
| Niveau 0-9 | select | grimoire, emplacements, upcast |
| École | select (8 écoles FR SRD) | filtre + badge |
| Temps d'incantation / portée / durée | selects + texte libre | fiche de sort |
| Composantes V/S/M + matériel | cases + texte | fiche de sort |
| Concentration / Rituel | cases | badge 🌀 + flux concentration ; rituel = lance sans emplacement (déjà géré) |
| Classes autorisées | multi-select classes SRD + option « Toutes » (Q3) | filtre du grimoire (`classes_json`) |
| Dégâts à niveau natif | dés + type SRD + capacité d'attaque | chips ⚔ / 🎯 |
| **Table d'upcast** | « +Nd6 par cran » ou table libre par niveau | `damage_at_slot_level` → aperçu upcast CastSpellSheet |
| Soins à niveau natif + par cran | idem | `heal_at_slot_level` (+ case « +mod. d'incantation » = `heal_adds_modifier`) |
| **DD de sauvegarde** | caractéristique (FOR…CHA) + type (annule / demi / aucun) | `dc_json` → affichage « DD CON, demi dégâts » — **affichée, jamais jetée** (helper) |
| Description / Niveaux supérieurs | texte long (markdown de notes) | `SpellProse` à l'ouverture |

**Parcours de création** : pupitre MD → nouvel onglet « Sorts custom » (Q9) → formulaire structuré (prévisualisation type fiche de sort en direct, y compris la ligne de dés au niveau choisi — même composant que le CastSpellSheet en lecture) → `POST /api/parties/:id/spells`. Sortie : le sort rejoint `GET /spells` **scopé au groupe** avec badge « Custom » (Q4).

**Parcours d'usage** : grimoire joueur inchangé — le custom se glisse dans la liste existante (badge discret ✦ ou libellé « sort de la table ») ; apprentissage `POST /characters/:id/spells` identique ; toujours-prepared SRD non concerné (les listes de domaine sont codées shared — hors périmètre, phase ultérieure éventuelle).

**Édition/suppression** : MD seul. L'édition se propage à toutes les fiches **par construction** (le JOIN `character_spells × spells` sert les colonnes à la volée). La suppression suit la FK `ON DELETE CASCADE` **après avertissement listant les personnages concernés** (Q7).

### 2.4 Cas limites

| Cas | Comportement proposé |
|---|---|
| Sort custom appris puis **modifié** par le MD | propagation immédiate via JOIN + WS `character:change action 'sheet'` n'est même pas nécessaire (refetch naturel) ; les lanceurs voient la nouvelle version au prochain rendu — aucune copie figée nulle part |
| Sort custom **supprimé** alors qu'appris | confirmation MD listant « connu par Lyra (Clerc 5), … » → CASCADE retire les lignes ; les emplacements dépensés restent (journal) |
| **Conflit de nom avec le SRD** | autorisé (pas d'unicité, comme les objets) mais avertissement en création « un sort SRD porte déjà ce nom » ; le badge Custom les distingue ; l'appariement `/spells/light` des monstres matche par nom → risque faible, noter dans le doc d'implémentation |
| **Upcast** | la table `damage_at_slot_level` pilotant l'aperçu, un sort custom sans table d'upcast mais avec prose `higher_level` affiche le drapeau `scalesAtHigherLevels` textuel (#171) — même contrat que SRD |
| **i18n FR/EN** | saisie FR seule ; l'overlay EN (`spells-en-meta.json`, clé srdIndex) n'existera pas → repli champ par champ **déjà codé** (`withSpellEnMeta` rend le FR si l'annexe manque) ; interface EN affiche le sort custom en français (Q10) |
| **Hors-ligne / PWA** | le SW n'intercepte jamais `/api` ; les données hors ligne restent un non-but ; en revanche `GET /spells` est servi ETag + maxAge 300 — **toute écriture custom doit invalider ce cache** (Q11 : basculer le catalogue en ETag-seul dès que le groupe a des customs) |
| Cache navigateur d'une vieille PWA | l'événement WS `party:change action 'custom-spell'` réveille les pages à état local (règle useResyncOnReconnect) |

---

## 3. Monstres personnalisés (création MD seule)

### 3.1 Utilisateurs & situations

- **MD** : son BBEG maison, le garde du corps dévoué d'un PNJ, la variante « Gobelin chaman de Chult » — il veut le poser dans une rencontre **aussi vite qu'un monstre SRD** : recherche, ajout ×N, PV roulés, groupe, masque.
- **Joueurs** : ne créent jamais ; voient « Créature inconnue » si masquée, le vrai nom sinon ; le Druide ne devrait **pas** pouvoir prendre une forme sauvage custom dans le MVP (liste des formes = bêtes SRD vues — cf. anti-buts).

### 3.2 User stories

1. *MD* — Je crée « Zalkir, prêtre-serpent » en 5 minutes avec un statblock **utile en combat** : CA, PV/dés, caracs, CR, 3 actions.
2. *MD* — Je le retrouve dans la recherche du bestiaire du traqueur, je l'ajoute ×3, ils partagent initiative/groupe/masque comme des gobelins SRD.
3. *MD* — J'ouvre son bloc de stats depuis la carte du combatant (mobile et desktop).
4. *MD* — J'édite le bloc entre deux séances sans casser les rencontres où il apparaît.

### 3.3 Périmètre fonctionnel

**Statblock MVP « utile en combat »** (structuré là où le moteur en a besoin, texte libre ailleurs — Q5) :

| Champ | Saisie | Rôle moteur |
|---|---|---|
| Nom FR | texte requis | combatant, masque (« Créature inconnue ») |
| Type / taille / alignement | selects SRD (types FR officiels) | recherche + fiche |
| CA + description | nombre + texte | copié dans le combatant |
| PV fixes + dés de vie | nombre + formule `NdX+mod` | `rollHitPoints` par exemplaire |
| Vitesses | lignes marche/vol/nage/escalade/creusement (m) | affichage |
| 6 caractéristiques | nombres 1-30 | mod DEX → initiative, mod CON → PV, affichage |
| Bonus de maîtrise | **dérivé du CR** (table SRD) | affiché ; les bonus de sauvegarde/compétences en texte libre MVP |
| CR + XP | select CR (0 à 30, avec fractions) ; XP dérivé | tri du bestiaire |
| Actions | liste nom + texte libre (+ bonus d'attaque/dés/type parsés si la syntaxe est reconnue) | affichage du bloc |
| Traits / actions légendaires | MVP : légendaires = phase 2 (anti-but ci-dessous) | — |
| Résistances / immunités (dégâts, conditions) | multi-select types SRD | affichage (jamais appliqué automatiquement — helper) |
| Langues / sens | texte | affichage |

**Parcours de création** : pupitre MD → onglet « Monstres custom » (Q9) → formulaire hybride (noyau structuré + listes nom/texte) → `POST /api/parties/:id/monsters` → slug généré (`custom-<slug du nom>-<id>`), `search_text`/`name_search` calculés à l'insertion (le backfill boot les recalcule idempotemment de toute façon).

**Parcours d'usage** : la recherche du traqueur (`GET /monsters?partyId=` scopé, Q1) mélange SRD + customs du groupe (badge ✦) ; `POST /encounters/:id/combatants/monster` **fonctionne sans changement** — il résout par slug, roule les PV, groupe par slug : un custom y est indistinguable. `MonsterStatBlock` sert le bloc tel quel.

**Édition/suppression** : MD seul, même onglet. Le combatant étant un snapshot chiffré (CA/PV/initiative copiés à l'ajout), l'édition du monstre custom ne touche **jamais** un combat en cours — seul le lien slug → statblock consultable bouge (Q6 pour la suppression).

### 3.4 Cas limites

| Cas | Comportement proposé |
|---|---|
| Monstre custom dans une rencontre **active** puis supprimé | les combatants vivent (snapshot CA/PV/nom déjà posés) mais le statblock consultable 404 → **bloquer la suppression tant qu'une rencontre setup/active référence le slug** (Q6), avec liste des rencontres |
| Monstre custom **édité** pendant un combat actif | le snapshot ne bouge pas (voulu : le MD a déjà blessé/renommé) ; le bloc consultable montre la nouvelle version — acceptable, à noter dans l'UI d'édition |
| Conflit de nom SRD | autorisé ; slug custom préfixé garantit l'unicité de clé ; badge ✦ distingue |
| Masque `name_hidden` | inchangé : redaction serveur du nom **et du slug** — un slug `custom-zalkir-42` fuiterait le nom → la redaction existante couvre déjà (elle nullifie `monsterSlug`) |
| Recherche | `search_text` précalculé à l'insertion ; pertinence nom-d'abord inchangée |
| i18n | FR seul (comme le bestiaire SRD qui est `name_fr` only) ; l'overlay EN n'existe pas pour un custom — le bloc s'affiche tel quel en interface EN (Q10) |
| Hors-ligne / cache | `GET /monsters` maxAge 3600 : mêmes garde-fous cache que les sorts (Q11) ; WS `party:change action 'custom-monster'` |
| Druide forme sauvage | la liste des formes reste le bestiaire SRD des bêtes vues — les customs n'y entrent pas (anti-but MVP) |
| Sorts de monstre custom | hors MVP : l'appariement `/spells/light` par nom est fragile sur du libre — phase 2 avec sélection structurée de sorts (SRD **ou customs du groupe**, boucle bonus) |

---

## 4. Armures personnalisées (pattern armes : joueurs avec toggle)

### 4.1 Utilisateurs & situations

- **Joueur** : « Cuirasse d'écailles du temple » lootée en séance, introuvable dans le catalogue SRD ; il la crée depuis la recherche de son inventaire (toggle ouvert) et **l'équipe** — sa CA doit bouger, à la seconde, sur sa fiche et dans le tableau du MD.
- **MD** : crée/supprime/édite toujours (y compris les armures créées par les joueurs) ; garde le kill-switch.

### 4.2 User stories

1. *Joueur* — Recherche « Cuirasse du temple » → rien → CTA créer → panneau Armure : catégorie **légère/intermédiaire/lourde/bouclier**, CA de base, STR min, discrétion, poids, description → enregistrer → l'objet est dans mon inventaire.
2. *Joueur* — Je l'équipe : ma CA affiche `base + DEX (cap ×2)` avec le détail du calcul (tuile CA, tooltip de breakdown existant).
3. *Joueur* — Le barbare de Paul la porte avec FOR insuffisante : la fiche **affiche** le malus de vitesse (−3 m) — sans rien appliquer d'invisible.
4. *MD* — Le toggle fermé, aucun joueur ne peut créer ; je crée pour eux depuis l'onglet Objets custom (panneau Armure, aperçu symbolique).
5. *MD* — J'édite la CA de base de l'armure custom : la CA de Lyra se met à jour (refetch inventaire + roster).

### 4.3 Périmètre fonctionnel

**Champs** (miroir du panneau Arme, `ArmorFields` partagé MD/joueur) :

| Champ | Saisie | Rôle moteur |
|---|---|---|
| Type | **légère / intermédiaire / lourde / bouclier** (SRD vrai type) | `armor_family` → `computeAC` lit le type **explicite** (Q8) ; bouclier = +2 suivi à part |
| CA de base | nombre 8-20 | `ac_base` ; légère = +DEX, intermédiaire = +min(DEX,2), lourde = fixe |
| Bonus magique (optionnel) | 0-3 (comme les armes) | `magic_bonus` → résolution de base magique |
| Basée sur (optionnel) | select `MUNDANE_ARMORS` (clé stable nameEn) | `base_armor` : une variante d'armure SRD hérite de son type natif |
| Force min | nombre ou vide | lourd : malus vitesse −3 m si non respecté (affiché) |
| Malus discrétion | case | `stealth_disadvantage` → indicateur fiche/compétences |
| Poids / prix / rareté / description / illustration | idem objets | inventaire, encombrance, recherche |

**Branchement `computeAC`** : pour un custom avec type explicite, le moteur consomme `armor_family` au lieu de l'heuristique nom/base (la colonne existe déjà sur `items` et dans le type `Item` partagé — `armorFamily: 'light'|'medium'|'heavy'|'shield'|null`) ; STR min, caps DEX, bouclier, malus discrétion et bonus magique suivent les chemins **déjà testés** (`test-armor-stats`). Aperçu du créateur joueur : CA calculée en direct sur le personnage réel (le MD voit l'aperçu symbolique sans porteur — même asymétrie que les armes).

**Parcours** : joueur = recherche inventaire → CTA créer → panneau Armure (catégorie pré-positionnée `armor`) ; MD = onglet Objets custom existant, le sélecteur de catégorie révèle le panneau Armure (le panneau Arme actuel en est le gabarit exact). Toggle = `players_create_items` **réutilisé tel quel** (même kill-switch que les objets/armes — pas de second réglage, Q-règle 3).

**Édition/suppression** : GM seul, onglet Objets custom (statu quo objets). Éditer `ac_base`/`armor_family` d'une armure portée → la CA du porteur se recalcule au refetch (WS `party:change action 'custom-item'` — même action, même onglet réveillé ; l'armure EST un objet).

### 4.4 Cas limites

| Cas | Comportement proposé |
|---|---|
| Armure custom **portée** + computeAC | type explicite → calcul exact ; si le MD laisse le type vide ET qu'aucune base SRD n'est résolue, repli sur l'heuristique actuelle (jamais de CA cassée) |
| **Bouclier custom** | type `shield` → +2 suivi à part, jamais cumulé comme armure ; la détection nom (« bouclier ») reste en repli |
| Armure custom **supprimée** alors que portée | comme tout objet custom : les lignes d'inventaire partent en cascade (FK) — le MD voit l'avertissement « portée par X » avant confirmation |
| Conflit de nom SRD | permis (statu quo objets) ; `base_armor` optionnel distingue « variante de cuir clouté » d'une armure inédite |
| i18n | FR seul en saisie ; `MUNDANE_ARMORS` porte `nameEn` → la base résolue s'affiche EN quand l'interface est EN (nom du custom lui-même FR, Q10) |
| Hors-ligne | rien de nouveau : l'inventaire est déjà en ligne-seulement ; l'armure suit le sortant |
| Mobile une main | panneau Armure = champs courts, selects, une case — pas de tableau 6 caracs (ça reste une armure, pas un monstre) |

---

## 5. Matrice de permissions

| Action | MD | Joueur (toggle OFF) | Joueur (toggle ON) |
|---|---|---|---|
| Créer objet / arme / **armure** custom | ✓ | ✗ 403 | ✓ (dans son groupe) |
| Éditer / supprimer objet / arme / armure custom | ✓ (tous, y compris créés joueur) | ✗ | ✗ (statu quo : création joueur, édition MD) |
| Voir les customs du groupe (catalogue, recherche) | ✓ | ✓ (membre du groupe) | ✓ |
| Voir les customs d'un **autre** groupe | ✗ 403 | ✗ 403 | ✗ 403 |
| Créer **sort** custom | ✓ | ✗ 403 | ✗ 403 (pas de toggle — règle 3) |
| Éditer / supprimer sort custom | ✓ | ✗ | ✗ |
| **Apprendre** un sort custom (custom du groupe) | sur toute fiche du groupe ✓ | sur SA fiche ✓ (reco Q2) | idem |
| Créer **monstre** custom | ✓ | ✗ 403 | ✗ 403 |
| Éditer / supprimer monstre custom | ✓ | ✗ | ✗ |
| Ajouter un monstre custom à une rencontre | ✓ | ✗ | ✗ |
| Voir le nom d'un monstre custom masqué | ✓ | « Créature inconnue » | idem |

Côté serveur, chaque porte suit le motif `items.ts` : `isPartyGM` passe toujours ; sinon 403 (`spells`/`monsters` n'ont même pas de branche joueur). Le scoping de **lecture** (membre du groupe propriétaire) reprend le filtre `partyId` de `GET /items`.

## 6. Découpage MVP vs phases (YAGNI)

**Ordre recommandé** (chacune livrée seule, testée, changelogée) :

1. **Armures custom (MVP)** — le plus petit incrément : panneau `ArmorFields` + validation POST/PATCH + `computeAC` lit le type explicite. Le moteur, le toggle, l'onglet, l'e2e (`custom-weapon.spec.ts` comme gabarit → `custom-armor.spec.ts`) existent déjà. Value immédiate joueur.
2. **Monstres custom (MVP)** — statblock combat : nom, CA, PV/dés, caracs, CR/XP, vitesses, actions nom+texte, résistances. Ajout aux rencontres gratuit (résolution par slug déjà générique). Doc + tests API (`npcs+monsters` module étendu).
3. **Sorts custom (MVP)** — formulaire complet (upcast, DD, concentration, rituel, classes) + scoping/CDN-cache du catalogue sorts + apprentissage joueur. Surface la plus large : dernier.

**Hors MVP (phases ultérieures explicites)** :
- sorts custom *always-prepared* (les listes de domaine sont des constantes shared — évolution moteur à part entière) ;
- actions légendaires / réactions / incantation des monstres custom ;
- formes sauvages custom (Druide) ;
- duplication « partir d'un SRD et modifier » (clone) — simple à ajouter après coup, ne conditionne rien ;
- partage de customs **entre** groupes / bibliothèque globale d'instance ;
- bilingue EN des contenus custom.

## 7. Décisions ouvertes (arbitrage utilisateur requis)

**Q1 — Portée des contenus custom : groupe, utilisateur ou instance ?**
- (a) **Par groupe** (`party_id`, comme les objets custom) — reco : réutilise à l'identique le scoping, la FK cascade et la visibilité déjà prouvés ; une campagne = un groupe dans l'app aujourd'hui ; rien ne fuit entre tables.
- (b) Par créateur (bibliothèque personnelle du MD, réutilisable dans ses autres groupes) — séduisant pour un MD multi-tables, mais double les questions de visibilité/suppression pour un gain actuel nul (une seule campagne live).
- (c) Globale à l'instance — le Docker héberge la campagne de Mika ; exposerait les sorts maison à toute future table du serveur.

**Q2 — Les sorts custom sont-ils apprenables par les joueurs ?**
- (a) **Oui, librement depuis le grimoire** (filtré par classes) — reco : symétrique du grimoire SRD, cohérent « helper not automation » (l'app ne vérifie déjà jamais qu'un sort est *légal* pour la classe) ; le MD garde le contrôle à la source (création/édition/suppression) et peut refuser à la table.
- (b) MD-seul : seul le MD ajoute le sort aux fiches (`POST /characters/:id/spells` le permet déjà) — verrou fort, mais force le MD à faire N manipulations en séance, contre-productif.
- (c) Toggle supplémentaire « les joueurs peuvent apprendre les sorts de la table » — un réglage de plus pour un cas (MD qui publie des sorts « à venir ») mieux servi par un brouillon privé (phase 2).

**Q3 — Champ « classes autorisées » d'un sort custom ?**
- (a) **Multi-select des classes SRD + option « Toutes les classes »** — reco : alimente `classes_json` tel quel (le filtre du grimoire marche sans changement) ; « Toutes » couvre les sorts de pacte/relique hors listes.
- (b) Texte libre — casse le filtre du grimoire (le sort devient introuvable).
- (c) Pas de champ (toujours « toutes ») — MVP plus court, mais le MD perd le seul levier de découverte ; la fiche d'un Guerrier afficherait tous les sorts de la table.

**Q4 — Où les sorts custom apparaissent-ils côté joueurs ?**
- (a) **Fusionnés dans le catalogue `GET /spells` (scopé au groupe), badge « sort de la table »** — reco : zéro UI nouvelle côté joueur, l'apprentissage/upcast/concentration marchent par construction ; le badge préserve la distinction SRD/custom (règle 1).
- (b) Section séparée « Sorts de la table » dans le grimoire — plus lisible pour le lore, mais duplique l'UI d'apprentissage et crée deux chemins pour la même action.

**Q5 — Statblock monstre : formulaire structuré ou champ libre ?**
- (a) **Hybride : noyau combat structuré (CA, PV/dés, caracs, CR, vitesses, résistances) + traits/actions en listes nom + texte libre** — reco : le moteur n'a besoin que du noyau (DEX→initiative, CON→PV, CA, CR) ; le reste est de l'affichage, le imposer structuré coûterait un éditeur de formules pour un gain nul (le MD lit, la table ne calcule pas les actions des monstres).
- (b) Tout structuré (bonus d'attaque/dés par action saisis) — promet des jets de monstres automatisés : hors philosophie helper, gros coût.
- (c) Tout libre (une textarea markdown) — le monstre ne pourrait ni rouler ses PV ni préremplir initiative : rate le but « aussi vite qu'un SRD ».

**Q6 — Supprimer un monstre custom référencé par une rencontre vivante ?**
- (a) **Refuser tant qu'une rencontre setup/active référence le slug** (comptage `combatants`, message listant les rencontres) — reco : garde simple et honnête ; les rencontres *terminées* ne bloquent pas (historique consultable dégradé assumé).
- (b) Toujours permettre, le combatant snapshot survit et le statblock consultable affiche « contenu supprimé » — plus permissif, mais le MD perd le bloc en pleine séance sans avertissement.
- (c) Snapshot du statblock dans chaque combatant — lourd (JSON par combatant) pour un cas rare ; phase 2 si (a) frustre.

**Q7 — Sort custom modifié/supprimé alors que des personnages le connaissent ?**
- (a) **Édition : propagation par JOIN (immédiate, gratuite). Suppression : CASCADE après avertissement listant les porteurs** — reco : c'est le comportement mécanique actuel, il suffit de l'encadrer d'UI ; aucune copie figée ne peut diverger.
- (b) Copies figées par personnage à l'apprentissage — annule la propagation des corrections (le MD corrige une coquille de dés, la moitié de la table garde l'ancienne).
- (c) Interdire la suppression tant qu'appris (forcer le retrait manuel fiches par fiches) — pénalise le MD pour un cas rare.

**Q8 — Branchement armure custom dans computeAC ?**
- (a) **Type explicite saisi et stocké (`armor_family`), lu par le moteur ; heuristique actuelle en repli** — reco : la colonne existe déjà, le créateur devient honnête (« intermédiaire, cap DEX ×2 » s'affiche à la saisie), et le repli garantit qu'aucune armure existante ne change de CA.
- (b) Statu quo (résolution par nom/base SRD uniquement) — une armure réellement inédite est mal classée par l'heuristique (CA 13 = « intermédiaire » par défaut) : précisément le bug que la fonctionnalité doit corriger.
- (c) Forcer toute armure custom à dériver d'une base SRD (champ « basée sur » obligatoire) — simple, mais interdit les armures exotiques (CA 17 lourde à base de 15) que le MD attend d'un custom.

**Q9 — Sous quel onglet les créations vivent-elles (pupitre MD) ?**
- (a) **Onglets dédiés du pupitre : « Objets custom » (existant, + panneau Armure), « Sorts custom », « Monstres custom »** — reco : même page, même réglage toggle au même endroit, événements WS distincts (`custom-item` / `custom-spell` / `custom-monster`) selon le vocabulaire v2 ; chaque onglet ne réveille que les siens.
- (b) Un onglet unifié « Contenus de la table » à 3 sections — moins de pattes d'onglet, mais mélange des événements et des listes de natures différentes (le pupitre a déjà 7 onglets).
- (c) Pages séparées hors pupitre (comme le carnet) — disperse le lieu unique où le MD gère « sa » table ; à réserver si les monstres custom deviennent un bestiaire éditorial lourd (phase 2).

**Q10 — i18n des contenus custom ?**
- (a) **Saisie FR seule ; l'interface EN affiche le contenu FR tel quel** (repli champ par champ déjà codé pour les sorts ; monstres déjà FR-only par nature) — reco : les joueurs de la table sont francophones ; demander une saisie bilingue au MD doublerait le coût de création pour un bénéfice nul aujourd'hui.
- (b) Champs EN optionnels (comme les colonnes `description_en` des objets) — à ajouter plus tard sans migration si un besoin réel apparaît (les colonnes existent sur items/spells).
- (c) Traduction automatique — hors des principes (noms officiels jamais inventés, et une MT traduirait des termes de règle).

**Q11 — Caches HTTP des catalogues porteurs de custom ?**
- (a) **ETag seul (plus de maxAge) sur `GET /spells`/`GET /monsters` dès que le groupe porte des customs ; maxAge conservé pour les catalogues SRD purs** — reco : une revalidation conditionnelle par ouverture de grimoire/bestiaire est bon marché (304) et élimine le risque de sort custom invisible pendant 5 min sur la tablette d'un joueur ; le SRD pur garde sa fenêtre.
- (b) Invalidation à distance impossible (maxAge = navigateur) → garder maxAge et purger côté client à l'événement WS — fragile : une PWA rouverte après 10 min sert le cache sans événement.
- (c) Bannir tout cache sur ces routes — simple mais renonce aux 304 pour 95 % de contenu immuable (le SRD).

---

### Annexe — garde-fous d'implémentation à rappeler au moment du code

- Migrations drizzle (workflow `db:generate` + commit) : `spells` gagne `source/party_id/created_by` et un `srd_index` synthétique nullable-ou-`custom-*` ; `monsters` gagne `source/party_id/created_by` + slug garanti unique ; `items` n'a **rien** à migrer (colonnes armure déjà là).
- Validation TypeBox obligatoire sur toute nouvelle route en écriture (ratchet `check:validation`, messages FR via `validationMessage`).
- Zéro SQL brut dans routes/sync (Drizzle only, gate `test-api`).
- Changelog obligatoire (`CHANGELOG.json`) et e2e par fonctionnalité sur le gabarit de `custom-weapon.spec.ts`.
- Événements : `party:change` avec actions `'custom-spell'`/`'custom-monster'` — jamais de nouveau type ; toujours `actorUserId`.

---

## 8. Décisions tranchées (arbitrage Mika, 2026-11-10)

Toutes les recommandations des §7 et du plan marketing sont **APPROUVÉES**, avec deux précisions :

- **Q2 précisée** : les sorts custom sont apprenables **librement via le grimoire, filtrés par la liste de classes déclarée du sort** (Q3(a) : multi-select classes + option « Toutes les classes »).
- **Q9 confirmée avec précision shape** : les créations vivent dans des **onglets dédiés du pupitre (table) du MD** — « Sorts custom », « Monstres custom », panneau Armure dans l'onglet Objets personnalisés existant ; pas de création au fil de l'eau dans le grimoire/bestiaire.
- Q5(a) statblock hybride, Q8(a) type d'armure explicite + repli heuristique : confirmées telles quelles.
- Marketing : section unique « Votre monde, vos règles », 7 captures (34–40), publication en deux temps, EN par tranche — confirmées.
