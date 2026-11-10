# Plan architecture & backend — Contenus personnalisés (armures, monstres, sorts)

> Suite directe de `docs/plan-custom-content-product.md` (la spec fonctionnelle fait foi pour
> le périmètre, les personas et les décisions Q1-Q11 — **les recommandations de la spec sont
> reprises ici sauf mention explicite**). Ce document traduit la spec en arbitrages de modèle
> de données, contrat API, événements WS, migrations, tests et phasage en PRs. Aucun code
> d'implémentation ; les noms de colonnes/fichiers sont exacts et vérifiés dans le code
> (schema.ts, routes/, shared/index.ts) et dans la DB de dev (`data/db/inventory.sqlite`).
>
> Rappel des règles non négociables (spec §0) : SRD 5.1 seul, « helper not automation »,
> sorts/monstres MD-only, armures pattern armes (toggle `players_create_items`), tout en
> français, temps réel par **valeurs d'action** WS (jamais de nouveau type d'événement).

## 0. Synthèse des arbitrages

| Arbitrage | Décision | Motif en une ligne |
|---|---|---|
| Sorts custom | **table `spells` existante** + 3 colonnes, `srd_index` synthétique | le JOIN `character_spells × spells`, l'upcast (`damage_json`), `/spells/light`, `SpellProse` et l'apprentissage marchent **par construction** ; une table séparée casserait la FK et doublerait tous les chemins de lecture |
| Monstres custom | **table `monsters` existante** + 3 colonnes, slug préfixé | `combatants.ts` résout par slug et snapshot CA/PV à l'ajout : zéro route combat à modifier ; `MonsterStatBlock` sert le bloc tel quel |
| Armures custom | **table `items` existante** (colonnes déjà là : `base_armor`, `armor_family`, `ac_base`, `str_min`, `stealth_disadvantage`, `magic_bonus`) | pattern armes 2026-11 à l'identique : `validateArmorFields` côté API, `computeAC` lit le type **explicite** |
| Provenance monstres | **nouvelle colonne `origin`** (pas `source`) | `monsters.source` existe déjà et porte la provenance ÉDITORIALE du seed (« Livre des monstres », « AideDD », … — vérifié en base) : la réutiliser avec un CHECK `IN ('srd','custom')` est impossible |
| Règles partagées | `computeAC` lit `armorFamily` explicite **avant** l'heuristique + applique `magicBonus` explicite même avec `ac_base` rempli | les 42 armures seedées portant `armor_family` coincident toutes avec le résultat heuristique (vérifié en base) : changement rétro-compatible, protégé par `test-armor-stats` |
| Événements WS | `party:change` avec actions `'custom-spell'` / `'custom-monster'` (typage `bus.ts` étendu, pas de nouveau type) | vocabulaire v2 : granularité par valeur d'action |
| Caches catalogue | requête avec `partyId` ⇒ **ETag seul** (plus de `maxAge`) ; sans `partyId` (SRD pur) ⇒ `maxAge` conservé | affinement Q11(a) : la revalidation conditionnelle est bon marché, et le SRD pur garde sa fenêtre |

---

## 1. Modèle de données — arbitrage table par table

### 1.1 `items` (armures custom) — **aucune migration**

Toutes les colonnes nécessaires existent déjà (schema.ts L297-307) : `base_armor`, `armor_family`,
`ac_base`, `str_min`, `stealth_disadvantage` (INTEGER 0/1, déjà `NOT NULL DEFAULT 0`),
`magic_bonus`, plus le socle custom `source`/`party_id`/`created_by` (L284-286). Le gap est
purement applicatif : ni la validation POST/PATCH ni le panneau de création n'exposent ces champs
(`items.ts` ne valide aujourd'hui que `validateWeaponFields`).

**Contrat d'écriture des champs d'armure** (miroir du contrat armes) :

- `armorFamily` ∈ `'light' | 'medium' | 'heavy' | 'shield'` — **requis à la création** d'une
  armure sans base (select SRD vrai type) ;
- `acBase` : 8-20 — **requis** si pas de `baseArmor` ; si « Basée sur » est choisie
  (`baseArmor` = clé `nameEn` de `MUNDANE_ARMORS`), l'API copie `acBase`/`armorFamily` de la
  base (le MD peut ensuite surcharger `acBase` — armure exotique « CA 17 lourde à base de 15 ») ;
- `strMin` : entier ou null (lourd : malus vitesse −3 m si non respecté — affichage, jamais appliqué) ;
- `stealthDisadvantage` : booléen ;
- `magicBonus` : 0-3 (mêmes bornes que les armes) — désormais **consommé par `computeAC` même
  quand `ac_base` est explicite** (voir §3) ;
- bouclier : `armorFamily='shield'` ⇒ suivi à part (+2), jamais cumulé comme armure.

Pas d'unicité sur le nom (statu quo objets : un custom peut homonymier un SRD). Pas de CHECK
nouveau sur `items` (les CHECK existants suffisent ; les bornes 8-20 sont validées en route,
messages FR).

### 1.2 `monsters` (monstres custom) — migration unique

Nouvelles colonnes (une seule migration Drizzle, la **0041** — le répertoire
`apps/api/drizzle/` s'arrête à `0040`) :

```sql
-- 0041_*_monsters_custom.sql (généré par npm -w api run db:generate, commité avec schema.ts)
ALTER TABLE "monsters" ADD COLUMN "origin"     TEXT NOT NULL DEFAULT 'srd' CHECK (origin IN ('srd','custom'));
ALTER TABLE "monsters" ADD COLUMN "party_id"   INTEGER REFERENCES parties(id) ON DELETE cascade;
ALTER TABLE "monsters" ADD COLUMN "created_by" INTEGER REFERENCES users(id) ON DELETE set null;
CREATE INDEX "idx_monsters_party" ON "monsters" ("party_id");
```

Points d'attention :

- **`origin`, pas `source`** : `monsters.source` (L678) est déjà peuplé par l'import 5e-drs
  avec la provenance éditoriale (408 « Livre des monstres », 343 « Créatures & Oppositions »,
  …) — vérifié en base. `spells`, elle, n'a PAS de colonne `source` et peut suivre le pattern
  `items` mot pour mot.
- La clé primaire reste `slug` (pas d'`id` autoincrement sur cette table) : le slug custom est
  **généré serveur** (`custom-<slug(nom)>-<suffixe court>`, ex. `custom-zalkir-7f3a`) — unicité
  garantie par retry en transaction (SELECT puis INSERT, jamais `lastInsertRowid` qui n'existe
  même pas ici). Le préfixe `custom-` ne collisionne jamais avec les slugs seedés.
- `search_text` / `name_search` sont **calculés à l'insertion** avec le même `normalizeText`
  que `db/backfill.ts` (qui reste idempotent et les recalcule de toute façon au boot suivant —
  la recherche pertinence nom-d'abord de `GET /monsters` fonctionne sans changement).
- `party_id` NULL = SRD/global ; un custom vit dans son groupe (`ON DELETE cascade`, comme
  `items.party_id`). `created_by → users` `SET NULL` (l'auteur est tracé).
- GOTCHA migration : déclarer le CHECK **au niveau colonne** dans schema.ts ; vérifier que le
  SQL généré reste un `ADD COLUMN` porteur du CHECK (SQLite l'accepte avec default non-null).
  Si drizzle-kit émet un rebuild de table, relire le SQL avant commit — la baseline gelée
  (`schema.sql` + `COLUMN_MIGRATIONS`) ne doit JAMAIS être touchée.

### 1.3 `spells` (sorts custom) — migration unique

```sql
-- 0042_*_spells_custom.sql
ALTER TABLE "spells" ADD COLUMN "source"     TEXT NOT NULL DEFAULT 'srd' CHECK (source IN ('srd','custom'));
ALTER TABLE "spells" ADD COLUMN "party_id"   INTEGER REFERENCES parties(id) ON DELETE cascade;
ALTER TABLE "spells" ADD COLUMN "created_by" INTEGER REFERENCES users(id) ON DELETE set null;
CREATE INDEX "idx_spells_party" ON "spells" ("party_id");
```

- **`srd_index` reste NOT NULL + UNIQUE** : le serveur génère un index synthétique
  `custom-<partyId>-<hex6>` à l'insertion. Rendre la colonne nullable exigerait un REBUILD de
  table SQLite (contrainte NOT NULL non altérable) pour un bénéfice nul ; le préfixe `custom-`
  ne collisionne jamais avec les 490 index seedés (forme `acid-arrow`). Bonus gratuit :
  `spells-en-meta.json` est clé par `srdIndex` → un custom n'y figure jamais →
  `withSpellEnMeta` replie champ par champ sur le FR **déjà codé** (Q10 réglé par construction).
- Le sort custom pilote les colonnes existantes mot pour mot : `level`, `school`, `casting_time`,
  `range_text`, `components` (JSON `['V','S','M']`), `material`, `duration`, `concentration`,
  `ritual`, `description_fr` (saisie FR), `higher_level_fr`, `attack_type`, **`damage_json`**
  (tables `damage_at_slot_level` / `heal_at_slot_level` + drapeau `heal_adds_modifier` — le
  contrat exact que le `CastSpellSheet` lit déjà pour l'aperçu d'upcast), **`dc_json`**
  (caractéristique + type de sauvegarde — affichée, jamais jetée), `classes_json` (noms de
  classes FR — le filtre `LIKE` du grimoire marche sans changement).
- **« Toutes les classes » (Q3a) = liste explicite des classes SRD** dans `classes_json` (pas
  de joker) : le filtre `normalize(classes_json) LIKE '%Classe%'` du grimoire reste le seul
  chemin, aucune route de lecture ne bouge.
- `character_spells` : **aucun changement de schéma**. La FK `spell_id ON DELETE CASCADE`
  implémente Q7a (suppression = CASCADE après avertissement UI listant les porteurs) ; le JOIN
  `LINK_WITH_SPELL` (character-spells.ts) sert les colonnes à la volée ⇒ l'édition MD se
  propage à toutes les fiches au refetch, sans copie figée. Ajouter seulement `s_source` à la
  projection pour le badge « sort de la table ».
- L'unicité `(character, spell)` reste : un custom appris compte une fois, `class_source` et
  `source='invocation'` inchangés.

### 1.4 Ordre des migrations

`0041` (monstres, PR2) puis `0042` (sorts, PR3) — les deux indépendantes l'une de l'autre et
de tout autre changement ; PR1 (armures) n'en pose **aucune**. Chaque migration est générée par
`npm -w api run db:generate` après édition de `schema.ts`, commitée avec schema.ts, appliquée
au boot par `runDrizzleMigrations()` ; la chaîne repart du snapshot `0000_baseline` (no-op
délibéré) — ne jamais y toucher.

---

## 2. Contrat API complet

Conventions générales (motif `items.ts`) : toute route en écriture fournit son **schéma
TypeBox** (`body:` dans les options de route, ratchet `npm run check:validation`, messages FR
via `validationMessage` — pièges ajv : champ resettable ⇒ `Type.Unknown()`, pas de
`Type.Array` là où un singleton arrive) ; **zéro SQL brut** (Drizzle only, gate `test-api`) ;
portes GM via `isPartyGM`, scoping de lecture via `isPartyMember` ; chaque mutation émet son
événement WS avec `actorUserId` ; multi-écritures dans `getDb().transaction(() => …)` (jamais
de `drizzle.transaction()` imbriqué) ; réponses 4xx en `{ error: apiMsg(req, …) }` FR.

### 2.1 Armures custom (extension des routes items — aucune nouvelle route)

| Méthode & chemin | Corps (TypeBox, résumé) | Réponses | Permissions |
|---|---|---|---|
| `POST /api/parties/:partyId/items` (extension) | `name` (requis), `category` (dont `'armor'`), `rarity`, `weightKg`, `costQty/costUnit`, `description`, **+ champs armure** : `armorFamily` enum `light/medium/heavy/shield`, `acBase` int 8-20, `strMin` int nullable, `stealthDisadvantage` bool, `magicBonus` 0-3, `baseArmor` enum `MUNDANE_ARMORS.nameEn` | 201 `{item}` ; 400 « nom requis », « type d'armure invalide », « CA de base invalide », « bonus magique invalide », « armure de base inconnue » ; 403 « seul le MD peut créer des objets » (si joueur + toggle OFF) | MD toujours ; joueur membre si `players_create_items` (kill-switch MD, statu quo) |
| `PATCH /api/items/:id` (extension) | champs armure partiels — re-validés sur le contexte **fusionné** (payload + colonnes existantes), re-résolution `resolveItemBases` si un champ armure/nom/catégorie bouge | 200 `{item}` ; 400 validations idem ; 403 « seuls les objets custom peuvent être modifiés » / « seul le MD peut modifier » ; 404 | GM du groupe propriétaire |
| `DELETE /api/items/:id` | — | 204 ; 403/404 idem statu quo ; purge de l'illustration orpheline | GM seul |

`validateArmorFields(input)` suit exactement le gabarot de `validateWeaponFields`
(items.ts L70-111) : retour `string | ArmorFields`, filtrage des clés inconnues, bornes
vérifiées à la main pour des messages FR précis. L'avertissement « portée par X » avant
suppression relève de l'UI MD (liste des lignes d'inventaire portant l'objet — la cascade FK
fait le reste). Événement inchangé : `party:change action 'custom-item'` (l'armure EST un
objet — même onglet réveillé).

### 2.2 Monstres custom

| Méthode & chemin | Corps (TypeBox, résumé) | Réponses | Permissions |
|---|---|---|---|
| `POST /api/parties/:partyId/monsters` | noyau structuré : `nameFr` (requis, ≤120), `type` (enum types SRD FR), `size` (enum), `alignment` (texte libre court), `armorClass` int 1-30 + `armorDesc`, `hitPoints` int ≥1 + `hitDice` (formule `NdX±m`, validée par le parseur de `rollHitPoints`), `speedJson` (lignes marche/vol/nage/escalade/creusage en m), `abilities` {for,dex,con,int,sag,cha} 1-30, `challengeRating` (enum 0-30 avec fractions), `traits`/`actions` : listes `{name, text}` ; `damageResistances`/`damageImmunities`/`conditionImmunities` (multi-select types SRD) ; `senses`, `languages` texte | 201 `{monster}` ; 400 « nom requis », « formule de dés de vie invalide », « caractéristique hors bornes », « CR invalide » ; 403 « seul le MD peut créer des monstres » | **GM seul** (pas de branche joueur) |
| `PATCH /api/monsters/:slug` | sous-ensemble partiel des champs ci-dessus, re-validé fusionné ; `search_text`/`name_search` recalculés | 200 `{monster}` ; 400 validations ; 403 « seul le MD peut modifier » ; 404 « Monstre introuvable » | GM du groupe propriétaire |
| `DELETE /api/monsters/:slug` | — | 204 ; **409** « encore utilisé par des rencontres » + `{ encounters: [{id, name, status}] }` tant qu'une rencontre `setup/active` référence le slug via `combatants.monster_slug` (Q6a) ; 403 ; 404 | GM du groupe propriétaire |
| `GET /api/monsters` (extension) | query : `search`, `limit` existants **+ `partyId` optionnel** — périmètre SRD + customs du groupe (badge `origin` dans `MonsterSummary`), 403 si non-membre du groupe | 200 `{monsters}` résumés sans prose | membre du groupe pour le scope `partyId` |
| `GET /api/monsters/:slug` (extension) | — | 200 `{monster}` bloc complet ; 403 « pas membre du groupe » si custom d'un autre groupe ; 404 | membre du groupe propriétaire pour un custom |
| `POST /api/encounters/:id/combatants/monster` (**garde ajoutée**) | inchangé (`monsterSlug`, `count`, `name`, `nameHidden`) | inchangé + **404 « Monstre introuvable dans le catalogue »** si le slug est un custom d'UN AUTRE groupe que `enc.party_id` | GM (statu quo) |

Points d'implémentation : le bonus de maîtrise et les PX sont **dérivés serveur du CR**
(constantes SRD dans shared : table CR→XP, table CR→bonus) — jamais saisis ; les bonus
d'attaque/dés/type des actions sont parsés au mieux par `parseMonsterActionCombatInfo` (best
effort, jamais bloquants — Q5a) ; le snapshot combatant (CA/PV roulés/initiative copiés à
l'ajout) garantit qu'**éditer un monstre custom ne touche jamais un combat en cours** ; le
masque `name_hidden` redacte déjà le slug côté non-MD (`encounters.ts` L203-207) — un slug
`custom-zalkir-7f3a` ne fuite rien de plus.

### 2.3 Sorts custom

| Méthode & chemin | Corps (TypeBox, résumé) | Réponses | Permissions |
|---|---|---|---|
| `POST /api/parties/:partyId/spells` | `name` (requis, ≤120), `level` 0-9, `school` (enum 8 écoles), `castingTime`/`rangeText`/`duration` (selects + texte), `components` enum-array `V/S/M` + `material`, `concentration`/`ritual` bool, `classes` (array de classes SRD FR ; « toutes » = liste complète, voir §1.3), `attackType` enum optionnel, `damageDice` (template validé par `parseDamageTemplate`) + `damageType` (enum SRD) + **table d'upcast** `damageAtSlotLevel` (objet {niveau: template} OU raccourci « +Nd6 par cran » développé serveur en table), `healAtSlotLevel` idem + `healAddsModifier` bool, `dc` {ability enum FOR…CHA, success: half/none}, `description`/`higherLevel` texte long | 201 `{spell}` ; 400 « nom requis », « niveau invalide », « école invalide », « template de dégâts invalide », « type de dégâts invalide », « classe inconnue » ; 403 « seul le MD peut créer des sorts » | **GM seul** (pas de branche joueur, pas de toggle — règle 3) |
| `PATCH /api/spells/:id` | sous-ensemble partiel, re-validé fusionné ; `srd_index`/`source`/`party_id`/`created_by` non patchables | 200 `{spell}` ; 400 validations ; 403 « seuls les sorts custom peuvent être modifiés » / « seul le MD peut modifier » ; 404 « sort introuvable » | GM du groupe propriétaire |
| `DELETE /api/spells/:id` | — | **409** « encore connu par des personnages » + `{ knownBy: [{characterId, name, className, level}] }` par défaut ; 204 si `?force=1` (CASCADE `character_spells`, les emplacements dépensés restent) ; 403 ; 404 | GM du groupe propriétaire |
| `GET /api/spells` (extension) | query : `class`, `level`, `school`, `search`, paging existants **+ `partyId` optionnel** — SRD + customs du groupe, badge `source` dans `mapSpell` | 200 résumés sans prose + ETag ; 403 si non-membre | membre du groupe pour le scope `partyId` |
| `GET /api/spells/:id` (extension) | — | 200 prose complète ; 403 si custom hors groupe ; 404 | membre du groupe propriétaire pour un custom |
| `POST /api/characters/:id/spells` (**garde ajoutée**) | inchangé (`spellId`, `prepared`, `classSource`, `source`) | inchangé + **403 « sort hors de portée »** si la cible est un custom d'un groupe autre que celui du personnage | owner-or-GM (statu quo — Q2a : apprentissage joueur libre) |
| `GET /api/spells/light` | — | **inchangé** (SRD seul) | authentifié |

Points d'implémentation : l'homonymie SRD est permise (pas d'unicité de nom) — l'UI MD
avertit « un sort SRD porte déjà ce nom » à la création (recherche exacte côté client) ;
l'appariement par nom de `/spells/light` (sorts de monstres SRD) reste hors périmètre custom
(phase 2, spec §3.4) ; le drapeau `scalesAtHigherLevel` (#171) découle déjà de
`higher_level_fr` pour l'upcast purement textuel.

### 2.4 Caches HTTP (Q11)

`sendCachedJson` (httpCache.ts) sert déjà `ETag + Vary: accept-language` et bascule seule entre
`max-age=N, must-revalidate` et `no-cache` selon la présence de `opts.maxAge`. Décision :
**toute requête portant `partyId` (scope potentiellement custom) est servie ETag seul** — le
serveur omet `maxAge` quand le paramètre est présent, sans même compter les customs du groupe
(condition simpler, coût d'une revalidation 304 minime). Sans `partyId` (catalogue SRD pur),
`maxAge 300` (sorts) / `3600` (monstres) restent. Les écritures custom changent le corps ⇒ l'ETag
change ⇒ le prochain If-None-Match revalide ; le WS réveille les pages à état local entre-temps.

---

## 3. Changements `packages/shared` + rétro-compat SRD

### 3.1 `computeAC` (shared/index.ts L2181-2386) — trois retouches chirurgicales

1. **Type explicite avant heuristique** : dans la branche armure non-magique, l'ordre de
   résolution du type devient (a) bouclier par `armorFamily === 'shield'` (puis nom
   « bouclier/shield » en repli), (b) base résolue (`baseArmor` clé stable →
   `findMundaneArmorByName`), (c) **`armorFamily` explicite de l'item**, (d) heuristique
   actuelle (`strMin ≥ 13` → lourde, `acBase` 13-15 → intermédiaire, sinon légère) — le repli
   garantit qu'aucune armure existante ne change de CA.
   **Rétro-compat vérifiée en base** : les 42 armures seedées portant `armor_family` coincident
   toutes avec le type que la résolution actuelle produit (0 divergence sans base, 5 boucliers).
2. **`magicBonus` explicite avec `ac_base` explicite** : aujourd'hui le bonus magique n'est lu
   que via `resolveMagicArmorBase` quand `ac_base` est null/0 — une armure custom « CA de base
   13, +2 magique » perdrait son bonus. Retouche : la branche non-magique lit
   `entry.item.magicBonus` (déjà dans `ItemBaseKeys`). Aucun item seedé ne porte `magic_bonus`
   avec `ac_base` rempli sans base résolue ⇒ neutre pour le SRD.
3. **Bouclier custom** : `armorFamily 'shield'` rejoint la détection bouclier (+2 suivi à part,
   `shieldMagicBonus` inclut le `magic_bonus` explicite).

Sortie `source` inchangée (libellé « Cuirasse d'écailles · 14 +2 ») — la famille explicite
n'ajoute aucun libellé nouveau.

### 3.2 Auteurs des autres retouches shared

- `CR_XP_TABLE` / `proficiencyBonusByCR` (constantes SRD CR→PX et CR→bonus de maîtrise) si
  elles n'existent pas déjà — le bonus de maîtrise des monstres est **dérivé du CR** (spec §3.3).
- Rien d'autre : les sorts custom sont pilotés par les DONNÉES (`damage_json`, `dc_json`,
  `classes_json`) — zéro changement moteur ; les monstres custom sont résolus par les routes
  existantes (slug, `rollHitPoints`, `abilityModifier`).

### 3.3 Rétro-compat SRD — garde-fous

- `npm run test-armor-stats` doit rester VERT sans retouche de ses fixtures SRD existantes
  (CA/armures magiques/vitesse/forme sauvage/unarmored defense) ; on AJOUTE des cas :
  famille explicite sans base (légère/intermédiaire/lourde), bouclier par famille, bonus
  magique avec CA explicite, repli heuristique (famille absente), armure seedée à famille
  remplie (= heuristique, double assurance).
- La seed e2e et les catalogues JSON (`data/`) ne bougent pas ; le bestiaire SRD garde
  `origin='srd'` par défaut via le `DEFAULT` de la migration.

---

## 4. Événements WebSocket (vocabulaire v2)

**Jamais de nouveau type** — uniquement des valeurs d'action ajoutées à l'union `SyncEvent.action`
(sync/bus.ts L32-75) :

| Événement | Action | Émis par | Payload notable | Pages réveillées |
|---|---|---|---|---|
| `party:change` | `'custom-spell'` (nouveau) | POST/PATCH/DELETE sort custom | `partyId`, `actorUserId` (obligatoire — suppression d'echo) | onglet « Sorts custom » du pupitre MD (écouteur dédié, gabarit GmDashboardPage L1088) ; grimoire joueur (`CharacterSpellsTab`) via l'invalidation react-query de `party:change` ; catalogue d'apprentissage |
| `party:change` | `'custom-monster'` (nouveau) | POST/PATCH/DELETE monstre custom | `partyId`, `actorUserId` | onglet « Monstres custom » du pupitre MD (écouteur dédié) ; recherche bestiaire du traqueur (`AddMonsterModal`/`CombatPage` — état local ⇒ écouteur + `useResyncOnReconnect(load)`) |
| `party:change` | `'custom-item'` (inchangé) | POST/PATCH/DELETE armure custom | idem armes | onglet Objets custom du MD + refetch inventaire/roster du porteur (la CA du porteur se recalcule au refetch — us. 5 armures) |
| `character:change` | `'sheet'` (inchangé) | apprentissage d'un sort custom (`POST /characters/:id/spells`) | idem existant | fiche du personnage (statu quo) |

Règles v2 respectées : les vieilles PWAs n'inspectent pas `action` et se rafraîchissent large ;
les onglets MD ne se réveillent plus l'un l'autre (`custom-spell` ≠ `custom-monster` ≠
`custom-item` ≠ `npcs`). Toute page à état local ajoutée porte `useResyncOnReconnect(load)`.

---

## 5. Plan de tests

### 5.1 Modules `scripts/api-tests/` (convention `run(base, fx, srv)` — les modules partagent UNE DB ; fake `x-real-ip` par requête)

| Fichier | Cas couverts |
|---|---|
| `mod-items.ts` (étendu) | armures custom : création joueur toggle ON/OFF (403), MD toujours ; familles légère/intermédiaire/lourde/bouclier ; CA hors bornes (400) ; `baseArmor` inconnue (400) ; PATCH re-valide sur contexte fusionné (changement de famille + CA) ; suppression GM-seule ; événement `custom-item` émis (déjà couvert par mod-sync-ws, étendre le filtre) ; visibilité : custom d'un autre groupe invisible au catalogue `partyId` |
| `mod-npcs-monsters.ts` (étendu) | création monstre custom GM-seule (joueur 403 même toggle ON) ; noyau validé (dés de vie invalides 400, caracs bornées, CR→XP dérivé) ; slug unique et préfixé ; `search_text` peuplé (recherche par nom accentué) ; édition sans casser les snapshots ; **suppression bloquée 409 tant que setup/active référence le slug, liste des rencontres**, permise après `ended` ; scoping `GET /monsters?partyId=` (403 hors-groupe, badge origin) ; garde `combatants/monster` (custom d'un autre groupe → 404) ; ajout ×3 en rencontre : PV roulés, groupe, masque (statu quo prouvé sur un custom) ; backfill boot idempotent sur un custom |
| `mod-spells.ts` (étendu) | création sort custom GM-seule (403 joueur) ; validations (niveau/école/template/classes) ; table d'upcast développée en `damage_at_slot_level` ; « toutes les classes » = liste complète ; homonymie SRD permise ; `srd_index` synthétique unique (deux créations de même nom) ; scoping `GET /spells?partyId=` + ETag-only (pas de max-age) vs maxAge sans partyId ; apprentissage par un joueur du groupe (201, upsert (character, spell)) ; apprentissage d'un custom d'un AUTRE groupe → 403 ; édition MD se propage au JOIN `GET /characters/:id/spells` (ETag changé) ; **suppression : 409 + liste des porteurs, puis `?force=1` CASCADE** ; overlay EN = repli FR champ par champ |
| `mod-combat.ts` (étendu, léger) | un combatant monstre custom vit après édition/suppression-refusée ; statblock consultable |
| `mod-sync-ws.ts` (étendu) | événements `custom-spell`/`custom-monster` reçus par les membres du groupe, `actorUserId` présent, echo supprimé pour l'acteur |
| `mod-validation.ts` (étendu) | les nouvelles routes dans le ratchet `check:validation` (chaque écriture a son schéma) |

### 5.2 E2E Playwright (`e2e/`, gabarit `custom-weapon.spec.ts` — le seed laisse le toggle FERMÉ, la spec l'ouvre par API au nom du MD)

- `custom-armor.spec.ts` : joueur crée « Cuirasse d'écailles du temple » depuis la recherche
  vide de l'inventaire (toggle ouvert par API) → panneau Armure → équipe → **la CA de la tuile
  affiche `14 +2` (base + DEX capé)** sur le personnage réel ; barbare FOR insuffisante →
  malus −3 m affiché ; MD édite la CA → CA joueur rafraîchie (WS) ; spec jamais `@smoke`
  (mutatrice). Version EN de l'aperçu si base résolue.
- `custom-monster.spec.ts` : MD crée « Zalkir » depuis le pupitre → recherche du traqueur le
  trouve (badge ✦) → ajout ×3 (PV roulés, groupe, masque « Créature inconnue » côté joueur) →
  bloc de stats depuis la carte → édition entre séances → suppression bloquée pendant la
  rencontre, permise après `ended`.
- `custom-spell.spec.ts` : MD crée « Grâce de la Serpente » (concentration, DD CON demi,
  3d6 + 1d6/cran) → joueur Clerc la voit dans le grimoire filtré + l'apprend → CastSpellSheet
  affiche l'aperçu d'upcast recalculé au niveau 3 et le badge 🌀 → MD corrige les dés → la
  fiche joueur suit au prochain rendu (aucune copie figée) → suppression : avertissement
  listant Lyra puis CASCADE.

### 5.3 Suites rules

- `npm run test-armor-stats` : nouveaux cas §3.3 (famille explicite, bouclier-famille, bonus
  magique avec CA explicite, repli heuristique, fixture seedée). C'est la gate de
  rétro-compat du changement `computeAC`.
- Pas de nouvelle suite : `test-weapon-stats`, `test-class-features` etc. intouchés.

### 5.4 Gates communes à chaque PR

`npm run lint` (oxlint+oxfmt, actuellement propre) · `tsc -b apps/web` (baseline 0 erreur,
dur) · `npm run typecheck:api` (baseline 0) · `npm run test-api` (inclut la gate zéro-SQL-brut
et le ratchet validation) · `npm run test:e2e` · `npm run changelog:check` (entrée
CHANGELOG.json obligatoire — chaque PR change ce que voit l'utilisateur).

---

## 6. Phasage en PRs (aligné MVP : armures → monstres → sorts)

Chaque PR = scope fichiers disjoint, livrable seul, testé, changelogé. **Worktree obligatoire
pour toute implémentation parallèle** (checkout partagé — voir §7).

### PR1 — Armures custom (aucune migration)

- `packages/shared/src/index.ts` : `computeAC` (3 retouches §3.1).
- `apps/api/src/routes/items.ts` : `validateArmorFields` + POST/PATCH étendus + schémas TypeBox.
- Web : `ArmorFields` (panneau partagé MD/joueur, gabarit `WeaponFields` de CustomItemsTab) +
  aperçu chiffré joueur / symbolique MD, `CharacterInventoryPage`/`CatalogSearch` (CTA créer,
  catégorie pré-positionnée), i18n `fr.json`+`en.json` **en paire**.
- Tests : `test-armor-stats`, `mod-items.ts`, `custom-armor.spec.ts`, changelog.
- Fichiers touchés par personne d'autre : monsters/spells/combat intacts.

### PR2 — Monstres custom (migration 0041)

- `apps/api/src/db/schema.ts` + `drizzle/0041_*.sql` : `origin`/`party_id`/`created_by` + index.
- `apps/api/src/routes/monsters.ts` : POST/PATCH/DELETE + scoping `partyId` + badge.
- `apps/api/src/routes/combat/combatants.ts` : garde de périmètre à l'ajout (une condition).
- `apps/api/src/sync/bus.ts` : `'custom-monster'` dans l'union action.
- `packages/shared` : tables CR→XP / CR→bonus si manquantes ; type `MonsterSummary.origin`.
- Web : onglet « Monstres custom » du pupitre (Q9a), badge ✦ dans `AddMonsterModal`,
  `MonsterStatBlock` inchangé, i18n en paire.
- Tests : `mod-npcs-monsters.ts`, `mod-combat.ts`, `mod-sync-ws.ts`, `mod-validation.ts`,
  `custom-monster.spec.ts`, changelog.

### PR3 — Sorts custom (migration 0042)

- `apps/api/src/db/schema.ts` + `drizzle/0042_*.sql` : `source`/`party_id`/`created_by` + index.
- `apps/api/src/routes/spells.ts` : POST/PATCH/DELETE + scoping `partyId` + cache ETag-only §2.4.
- `apps/api/src/routes/character-spells.ts` : `s_source` dans `LINK_WITH_SPELL` + garde
  d'apprentissage (custom d'un autre groupe → 403).
- `apps/api/src/routes/lib/mappers.ts` : `mapSpell` expose `source`/badge (sans casser les
  appels existants — champ optionnel).
- `apps/api/src/sync/bus.ts` : `'custom-spell'`.
- Web : onglet « Sorts custom » du pupitre (formulaire + prévisualisation fiche de sort en
  direct), badge ✦ discret dans le grimoire (Q4a), avertissements homonymie/porteurs, i18n en paire.
- Tests : `mod-spells.ts`, `mod-sync-ws.ts`, `mod-validation.ts`, `custom-spell.spec.ts`, changelog.

Découpage plus fin possible (API puis UI par PR) si une PR dépasse ~1 500 lignes de diff —
l'ordre relative des fichiers reste disjoint.

---

## 7. Risques & pièges (reprise des gotchas applicables)

- **Worktree obligatoire** pour l'implémentation parallèle des PRs (checkout partagé, jamais
  de commande git mutante sur le checkout principal) ; le dossier local s'appelle `dnd-inventory`
  alors que le repo GitHub est `table-sync`.
- **`lastInsertRowid` unreliable on conflict** : ré-SELECT par clé naturelle après upsert/insert
  (pattern character-spells.ts L229) ; pour le slug monstre, unicité par boucle
  SELECT-then-INSERT en transaction, pas par rowid.
- **`monsters.source` est pris** (provenance éditoriale du seed) — utiliser `origin`. Piège
  symétrique : ne pas nommer la colonne sorts `origin`, `spells` peut prendre `source` comme items.
- **Catégories de filtre UI qui cachent des données existantes** : les « armures » custom créées
  AVANT la PR1 (objets nommés armure sans champs) restent dans l'onglet Objets custom — le
  sélecteur `armor` doit les lister et permettre de les compléter en édition, pas les filtrer hors vue.
- **Drizzle select-fields non qualifiés** : `${table.col}` rend `"id"` sans préfixe — une
  sous-requête corrélée capture la référence (hand-qualify l'extérieur, AGENTS.md « Queries »).
- **CHECK en `ADD COLUMN`** : vérifier le SQL généré (ADD COLUMN porteur du CHECK, pas un
  rebuild) ; baseline gelée (`schema.sql`/`COLUMN_MIGRATIONS`/`0000_baseline`) jamais touchée.
- **ajv/TypeBox** : routes sans corps → `Type.Unknown()` ; champ resettable (null) →
  `Type.Unknown()` ; pas de `Type.Array` là où un singleton arrive (`coerceTypes: 'array'`).
- **Zéro SQL brut** dans `src/routes/**` + `src/sync/**` (gate scraper whole-file de
  `test-api`) — tout passe par `getDrizzle()`, upserts `onConflictDoUpdate` sur les uniques
  composites.
- **`sendCachedJson`** pose déjà `Vary: accept-language` et l'ETag couvre le corps complet —
  ne pas cacher la réponse d'écriture (201/200 ne passent pas par le cache).
- **WebKit `@smoke`** : ne JAMAIS taguer les nouvelles specs (mutatrices) — elles rejoueraient
  sur la DB déjà mutée par la passe chromium.
- **Rôles i18n** : toute clé ajoutée dans `fr.json` doit exister dans `en.json` (échec
  silencieux sinon) ; le contenu custom saisi FR s'affiche FR en interface EN (Q10a, repli
  déjà codé).
- **Forme sauvage** : la liste des bêtes du Druide (`SurvivalPanel`) doit rester SRD-only —
  filtre `origin='srd'` sur la requête bestiaire qui l'alimente (anti-but MVP).
- **`/spells/light`** : ne PAS y inclure les customs (appariement par nom des sorts de
  monstres — fragile sur du libre, phase 2).
- **E2E avec état → stack isolée** : les specs custom bootent leur propre stack (webServer
  Playwright, `e2e.sqlite` frais) ; le stack principal 8080/4010 reste intouché.
- **Changelog obligatoire** par PR (calver, `sha: null`) + rappel déploiement tablette
  (`pull && up -d`) après merge vers main.
- **Rate limiting** : les suites de test falsifient un `x-real-ip` par requête — les nouveaux
  modules respectent le harness (aucun 429 attendu).

---

## 8. Décisions d'architecture prises par ce plan (positions — à confirmer par l'utilisateur)

Les recommandations Q1-Q11 de la spec sont reprises telles quelles (Q1a scoping par groupe,
Q2a apprentissage libre, Q3a multi-select + toutes, Q4a fusion badge, Q5a hybride, Q6a refus
de suppression, Q7a JOIN+CASCADE, Q8a type explicite + repli, Q9a onglets dédiés, Q10a FR
seul, Q11a ETag conditionnel). Ce plan ajoute les arbitrages d'implémentation suivants :

1. **`srd_index` synthétique** (`custom-<partyId>-<hex6>`) plutôt que nullable — évite un
   rebuild de table SQLite ; l'annexe EN ne matchera jamais ⇒ repli FR gratuit. *(croise Q1/Q10)*
2. **Colonne `origin` sur `monsters`** (clash avec le `source` éditorial du seed) — nommage à
   valider, l'alternative est un CHECK sur `source` avec migration de données des valeurs
   éditoriales (coûteux, zéro gain). *(croise Q1)*
3. **DELETE sort custom = 409 + liste des porteurs, `?force=1` pour CASCADE** — affine Q7a :
   le garde-fou « avertissement » devient serveur (une PWA périmée ne peut pas sauter la liste).
4. **Cache : bascule ETag-only déclenchée par la présence de `partyId`** (pas par un comptage
   des customs du groupe) — affine Q11a : plus simple, déterministe, coût 304 négligeable.
5. **`computeAC` applique `magicBonus` explicite même avec `ac_base` rempli** — extension de
   Q8a nécessaire au champ « bonus magique » du panneau Armure (sinon le bonus est silencieusement
   perdu pour une armure sans base résolue) ; neutre pour le seed (vérifié).
6. **« Toutes les classes » encodée en liste explicite des 13 classes** dans `classes_json` —
   aucune route de lecture ni filtre du grimoire ne change ; l'alternative (joker `*` + OR
   côté requête) toucherait le filtre LIKE du grimoire.
7. **Slug monstre custom `custom-<slug>-<suffixe court>` généré serveur, unicité par retry en
   transaction** — pas d'id autoincrement sur `monsters` ; le préfixe garantit la non-collision
   avec le seed et le masque `name_hidden` couvre déjà la fuite par slug.
8. **Garde d'apprentissage sur `POST /characters/:id/spells`** (custom d'un autre groupe →
   403) — conséquence obligatoire de Q1a/Q2a que la route n'a pas aujourd'hui (catalogue
   global) ; sans elle, un joueur pourrait apprendre le sort maison d'une autre table en devinant l'id.

Les positions 3, 4 et 8 changent le contrat HTTP au-delà de la lettre de la spec ; les autres
sont des choix d'implémentation conformes. Toute contestation se règle AVANT la PR concernée.
