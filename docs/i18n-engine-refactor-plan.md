# Plan de refactor — Découpler le moteur de règles des noms français

*LIVRÉ le 2026-08-28 (PR A+B+C d'un tenant, worktree `i18n/english`) : migration
`0013` (5 colonnes), `resolveItemBases` + backfill boot (`db/backfill.ts`, 104/109
lignes historiques résolues — le reste = focus non résolvables), création d'objets
personnalisés cléée, moteur double-chemin (clé d'abord, parse en repli — tests
« clés seules » dans test-weapon-stats / test-armor-stats), `descriptionEn` rempli
pour 350/518 objets (68 %, repli FR par champ), `mapItem`/inventaire localisés,
`Item.nameFr` retiré du payload. Gates : biome ✓, tsc web ✓, test-api 14/14 ✓.*

*Suite de `docs/i18n-audit.md` (§ blocants) et de `docs/i18n-english-plan.md`. Rédigé
2026-08-28 après l'instrumentation i18n : sorts, monstres et features de classe sont
désormais servis en payload mono-locale, mais les OBJETS ne le peuvent pas — ce plan
lève ce verrou.*

## Le problème, précisément

Le moteur partagé (`packages/shared/src/index.ts`) résout **l'identité d'un objet en
analysant ses noms/descriptions français au moment du calcul** :

| Site | Ce qu'il parse | Conséquence |
|---|---|---|
| `resolveMagicWeaponBase(item)` | préfixes magiques (« +1 … ») + rapprochement catalogue `MUNDANE_WEAPONS` par `nameEn`/`nameFr` | exige `name` (EN) + `nameFr` (FR) dans le payload |
| `resolveMagicArmorBase(item)` | en-tête de description « Armure (légère…) », familles `légère/intermédiaire/lourde`, mots-clés `bouclier`/`shield` | **exige la description française** dans le payload |
| `isProficientWithWeapon` / `isProficientWithArmor` | `Pick<Item, 'name' \| 'nameFr' \| 'description' …>` → mêmes résolutions | idem |
| `findMundaneByName(nameEn, nameFr)` | rapprochement par noms sur les catalogues d'armes/armures | idem |

Tant que ces fonctions lisent des textes FR, la route `/items` ne peut pas localiser
ses payloads : sous `lang=en`, `description` serait anglais et la résolution des
familles d'armures échouerait silencieusement (l'⚠ « non qualifié » disparaîtrait ou
apparaîtrait à tort). C'est pourquoi l'instrumentation a **laissé les objets FR-servis**
(`mapItem` retourne `name` + `nameFr` tels quels) — comportement inchangé, moteur intact.

## Décision de conception : des clés de base stables, calculées à l'import

Le parsing des noms n'est pas un mauvais outil — c'est un **mauvais moment** pour
l'exécuter. Il devient un outil d'IMPORT (une fois, au seeding/création), qui produit
des colonnes stables ; le moteur runtime ne lit plus que des clés.

### 1. Schéma (migration Drizzle `0013_…`)

```
items.base_weapon   TEXT NULL   -- clé de MUNDANE_WEAPONS ('longsword', 'club'…) pour toute arme (magique incluse)
items.base_armor    TEXT NULL   -- clé de MUNDANE_ARMOR ('chain-mail'…) pour toute armure (magique incluse)
items.armor_family  TEXT NULL   -- 'light' | 'medium' | 'heavy' | 'shield' (armures de famille « +1 armure (légère) »)
items.magic_bonus   INTEGER NULL -- +1/+2/+3 quand détectable
```

Nullables : un objet non résolvable reste null → le moteur retombe sur son
comportement actuel « ne pas avertir » (déjà la règle pour les bases inconnues).

### 2. Backfill

- **SRD (seed)** : `db/seed.ts` exécute les résolveurs existants sur chaque objet au
  moment de l'insertion et stocke les clés. Le code de parsing est RÉUTILISÉ tel quel
  — déplacé dans un module `resolveItemBases(item)` partagé seed/API.
- **Objets personnalisés** : `POST/PATCH /items` appelle le même résolveur serveur et
  persiste les clés (les objets créés par les joueurs portent des noms libres FR — le
  parse y est déjà tolérant à l'échec).
- **Base existante (Docker/dev)** : la migration SQL est purement additive ; le
  backfill des lignes déjà présentes se fait au boot suivant via le même seed
  idempotent (`ON CONFLICT DO UPDATE` étendu aux 4 colonnes).

### 3. Moteur — double chemin, puis clé seule

1. `resolveMagicWeaponBase(item)` : lit `item.baseWeapon`/`magicBonus` en priorité ;
   à défaut, chemin legacy par parsing (inchangé). Même chose côté armures avec
   `baseArmor`/`armorFamily`. Les signatures `Pick<Item,…>` gagnent les 4 champs.
2. `isProficientWith*` : ne changent pas de signature (ils passent par les
   résolveurs) — le gain est automatique.
3. Après un cycle complet (toutes les bases backfillées, vérifié par une requête de
   comptage des nulls par catégorie dans `test-api`), **suppression du chemin
   legacy** : le parsing vit uniquement dans `resolveItemBases` (import).

### 4. Bascule des payloads objets (la récompense)

- `mapItem(row, lang)` localise enfin `name`/`description` comme `mapSpell`
  (`pickLocalized`) ; `Item.nameFr` disparaît du type servi, `description` devient
  le texte de la langue demandée.
- **Prérequis contenu** : descriptions EN des objets (~518) par le pipeline
  5e.tools du plan i18n (phase P2 : `match-items.ts` + `fill-items-en.py`,
  même mécanique que les sorts). Sans elles, l'EN afficherait des noms anglais sur
  des descriptions françaises — incohérent.
- Le web ne change pas (il consomme `Item` tel quel) ; les vérifs ⚠ de maîtrise
  continuent de fonctionner car le moteur lit les clés, plus les textes.

### 5. Tests

- `test-weapon-stats` / `test-armor-stats` : ajouter des fixtures « clés only »
  (sans noms résolvables) pour prouver que le moteur ne dépend plus des textes ;
  garder les cas legacy pendant le double chemin.
- `test-api` (module items) : assertion du backfill (armes SRD ⇒ `base_weapon` non
  null à ~100 %, armures ⇒ `base_armor`/`armor_family` non null) + payload
  `Accept-Language: en` sur `/items/:id`.
- e2e : rien (défaut fr inchangé).

### 6. Découpage en PR

| PR | Contenu | Charge |
|---|---|---|
| A | Colonnes + `resolveItemBases` + backfill seed/API + moteur double chemin + tests | 1,5–2 j |
| B | Contenu : descriptions EN des objets (pipeline 5e.tools) | 0,5–1 j |
| C | Bascule `mapItem` localisé, retrait `nameFr` du type, suppression chemin legacy | 0,5 j |

**Total ≈ 3 jours.** A est indépendant de B ; C exige A + B.

## Hors périmètre (autres blocants de l'audit, chantiers séparés)

- Valeurs stockées FR : conditions (`DND_CONDITIONS_FR`) et langues — clés stables +
  migration des valeurs.
- Comparaisons `findClass(…)?.name === 'Artificier'` → `classKey`.
- Codes d'erreur API stables + traduction client (~330 messages).
- Extraction complète des ~900–1 200 chaînes UI vers les catalogues i18next
  (l'instrumentation est en place : `apps/web/src/i18n/` + `react-i18next`).
