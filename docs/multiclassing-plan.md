# Multiclassage — audit des règles et plan d'implémentation (SRD 5.1)

> Statut : **implémenté** (2026-08-21) — moteur, migration `0002_groovy_rhino`,
> routes, UI (feuille guidée, deux pools, préparation par classe), suites de règles,
> module API « multiclassage », spec E2E `e2e/multiclass.spec.ts`, capture
> `docs/screenshots/14-multiclasse.png`. Écarts assumés par rapport au plan :
> unicité (personnage, sort) CONSERVÉE sur `character_spells` (un sort = une
> classe d'origine commutable, pas de double comptage) ; regain de dés au repos
> long = FIFO par défaut (pas de mini-feuille de répartition) ; un `level` plat
> PATCHé sur une fiche multiclassée reporte son delta sur la DERNIÈRE ligne.
> Direction UI de la phase web arrêtée le même jour via le skill impeccable (shape, § 4.5) ;
> décisions D4 (⚠ UI seulement) et D7 (feuille guidée) confirmées par l'utilisateur.

## 0. Sources

| Règle | Source |
|---|---|
| Multiclassage (prérequis, PV/dés de vie, maîtrises acquises, aptitudes, incantation, table de l'incantateur multiclassé) | SRD 5.1 § « Multiclassing » — version FR : « Multiclassage », 5e-drs 2014, page [Options de personnalisation](https://2014.5e-drs.fr/options-de-personnalisation/) (miroir EN : 5thsrd.org/rules/multiclassing) |
| Dés de vie / repos (dépense au repos court, récupération d'« au plus la moitié du total, minimum 1 dé » au repos long) | SRD 5.1 § « Resting » |
| Incantateurs **tiers** (Chevalier occultique / Escamoteur occultique : ⅓ des niveaux, arrondi à l'inférieur) | PHB 2014 p. 164 (§ multiclassage) — **hors SRD 5.1** (sous-classes absentes du SRD), mais l'app inclut déjà ces sous-classes au catalogue (`chevalier-occulte`, `escroc-arcanique`) : même statut « extension PHB » que le reste du catalogue |
| **Artificier** multiclassé (prérequis INT 13 ; niveaux comptés **demi, arrondis au supérieur** ; maîtrises acquises) | Tasha's Cauldron of Everything (classe hors SRD 5.1, déjà intégrée à l'app : table `SPELL_SLOTS_ARTIFICIER`, 3 spécialistes au catalogue) |
| Effets de jeu de même nom non cumulables (styles de combat identiques, expertise ×4 impossible) | Sage Advice Compendium « Combining Game Effects » — le SRD est silencieux ; signalé comme arbitrage |

Terminologie FR : la traduction 5e-drs 2014 nomme l'Occultiste « sorcier » et l'Ensorceleur « ensorceleur » ; l'app suit AideDD (**Occultiste**). Les citations FR ci-dessous viennent de 5e-drs.

## 1. Les règles, point par point → conséquence applicative

### 1.1 Prérequis (SRD 5.1, table « Prérequis »)

> « Pour vous qualifier pour une nouvelle classe, vous devez satisfaire aux prérequis de caractéristiques de votre classe actuelle **et** de votre nouvelle classe. »

| Classe | Prérequis |
|---|---|
| Barbare | FOR 13 |
| Barde | CHA 13 |
| Clerc | SAG 13 |
| Druide | SAG 13 |
| Ensorceleur | CHA 13 |
| Guerrier | FOR 13 **ou** DEX 13 |
| Magicien | INT 13 |
| Moine | DEX 13 **et** SAG 13 |
| Occultiste (Sorcier) | CHA 13 |
| Paladin | FOR 13 **et** CHA 13 |
| Rôdeur | DEX 13 **et** SAG 13 |
| Roublard | DEX 13 |
| Artificier *(TCE)* | INT 13 |

**Applicatif** : nouvelle constante `MULTICLASS_PREREQUISITES: Record<ClassName, AbilityReq[]>` dans
`shared/index.ts` (à côté de `DND_CLASSES`) + fonction pure `multiclassPrereqIssues(character, classes)`.
Conformément à la philosophie « helper, pas automation » de l'app (cf. expertise : contrôle côté UI,
l'API stocke), la violation produit un **⚠ dans l'UI** (puces sous la classe), pas un blocage API.
Voir décision D5.

### 1.2 Niveau total et XP (SRD 5.1)

> « Votre niveau de personnage est la somme de vos niveaux dans chaque classe. » Les PX nécessaires
> pour passer un niveau « sont toujours basés sur votre niveau de personnage total ».

**Applicatif** : l'app ne suit pas les PX (le niveau est libre). Le `characters.level` existant devient
le **niveau total dénormalisé = somme des niveaux de classes** — la contrainte SQL
`level BETWEEN 1 AND 20` (`schema.ts:189`) reste donc valide et borne le total. Aucun suivi PX à ajouter.

### 1.3 PV et dés de vie (SRD 5.1)

> Les PV maximaux du 1er niveau (dé de vie max + CON) ne s'appliquent qu'à la **classe de départ** ;
> chaque niveau pris dans une autre classe ajoute le dé de vie (ou la moyenne) de **cette** classe.
> Les dés de vie « se regroupent » en gardant leur type : paladin 5/clerc 5 = 5d10 + 5d8.

**Applicatif** :
- `averageMaxHp(level, hitDie, con)` (`index.ts:1132`) : ajouter une variante multiclassée
  `averageMaxHpMulti(primary, others, con)` = max(dé classe 1) + Σ(moyenne par niveau des autres).
  Utilisée par la création/suggestion de PV uniquement (le `max_hp` stocké est manuel — aucun
  recalcul forcé).
- **Dés de vie par classe** : `characters.hit_dice_used` (entier unique, `schema.ts:175`) ne suffit
  plus dès que les types de dés diffèrent. Suivi **par ligne de classe** (voir 4.1) : chaque ligne
  porte `hit_dice_used` ; le total affiché « 3d10 + 2d8 · restants N/5 ».
- `applyRest` (`index.ts:3425`) :
  - dépense au repos court : budget = Σ dés non dépensés (tous types) ; le joueur choisit **quels**
    dés lancer (le SRD ne dit rien : les dés ne sont fongibles qu'en nombre) ;
  - récupération au repos long : « jusqu'à la moitié du **total** des dés, minimum 1 » (SRD Resting ;
    arrondi à l'inférieur par convention 5e — le code actuel `Math.max(1, Math.floor(level / 2))`
    (`index.ts:3493`) est déjà RAW) ; avec des dés mixtes, **choix** des dés récupérés dans la limite
    du budget (UI), au lieu de la soustraction FIFO actuelle.

### 1.4 Bonus de maîtrise (SRD 5.1)

> Basé sur le **niveau total** du personnage (guerrier 3/roublard 2 → bonus de niveau 5).

**Applicatif** : `proficiencyBonus(level)` (`index.ts:522`) prend déjà le niveau total — aucun
changement moteur ; s'assurer que tous les appelants passent bien le **total** (c'est déjà
`character.level`, qui reste le total). Aucun calcul au niveau de classe ici.

### 1.5 Maîtrises acquises (SRD 5.1, table « Multiclassing Proficiencies »)

Ce que donne le **premier niveau** d'une nouvelle classe (la classe de départ donne sa liste complète) :

| Classe | Maîtrises acquises |
|---|---|
| Barbare | boucliers, armes simples, armes de guerre |
| Barde | armures légères, 1 compétence au choix, 1 instrument de musique |
| Clerc | armures légères et intermédiaires, boucliers |
| Druide | armures légères et intermédiaires, boucliers (pas de métal) |
| Guerrier | armures légères/intermédiaires, boucliers, armes simples et de guerre |
| Moine | armes simples, épée courte |
| Occultiste | armures légères, armes simples |
| Paladin | armures légères/intermédiaires, boucliers, armes simples et de guerre |
| Rôdeur | armures légères/intermédiaires, boucliers, armes simples et de guerre, 1 compétence de sa liste |
| Roublard | armures légères, 1 compétence de sa liste, outils de voleur |
| Ensorceleur | — |
| Magicien | — |
| Artificier *(TCE)* | armures légères/intermédiaires, boucliers, outils de voleur |

**Applicatif** :
- Nouvelle constante `MULTICLASS_PROFICIENCIES_GAINED` (libellés FR) : sert (a) d'**information**
  dans le flux « ajouter une classe » (carte « Vous gagnerez : … »), (b) au calcul des défauts
  d'`effectiveWeaponProficiencies` / `effectiveArmorProficiencies` : quand
  `weapon_proficiencies`/`armor_proficiencies` est NULL (défaut de classe), le défaut devient
  l'**union** : liste complète de la classe de départ + lignes « maîtrises acquises » des autres
  classes (`index.ts:1843-2002`).
- Compétences/outils/instrument gagnés : **choix du joueur** → il les saisit déjà librement dans
  l'onglet Compétences (modèle stocké, pas dérivé) ; l'UI d'ajout de classe le rappelle (hint).
- Jets de sauvegarde : **jamais gagnés** par le multiclassage (absents de la table) — le modèle
  stocké `saving_throw_proficiencies` reste tel quel (défaut = classe de départ à la création).

### 1.6 Aptitudes de classe (SRD 5.1)

> **Canalisation divine** : « Si une aptitude vous l'accorde déjà, en gagner une seconde ne vous
> accorde pas d'utilisations supplémentaires. Vous ne gagnez des utilisations supplémentaires que
> lorsqu'un niveau de classe vous les accorde explicitement. »
> **Attaque supplémentaire** : « Si vous gagnez l'aptitude attaque supplémentaire dans plus d'une
> classe, son effet n'est pas cumulatif. »
> **Défense sans armure** : « Si vous avez déjà l'aptitude défense sans armure, vous ne pouvez pas
> en bénéficier de nouveau par le biais d'une autre classe. »

**Applicatif** :
- **Attaque supplémentaire** : `extraAttacks(characterClass, level)` (`index.ts:2876`) devient
  `extraAttacksMulti(classes)` = **max** sur les classes (Guerrier 2/3/4 aux niveaux de **classe**
  5/11/20 ; Barbare/Paladin/Rôdeur/Moine 2 au niveau de classe 5). Ex. Guerrier 11/Barbare 5 → 3
  attaques, pas 4.
- **Défense sans armure** : `computeAC` (`index.ts:1323`) applique aujourd'hui celle de l'unique
  classe. En multiclassage : le personnage **choisit laquelle** est active (Barbare 10+DEX+CON avec
  bouclier / Moine 10+DEX+SAG sans bouclier / Ensorceleur draconique 13+DEX). Le moteur expose les
  candidates + leur CA calculée ; l'UI (carte CA de l'onglet Caractéristiques, à côté de l'override
  Manuel/↺ Auto existant) propose le choix ; défaut = la meilleure CA. Aucune combinaison
  (FOR/CON d'une classe + SAG d'une autre interdite par la citation).
- **Canalisation divine** (Clerc + Paladin) : compteur **combiné** — la première acquisition ne
  double pas, seuls les paliers explicites par niveau de classe rajoutent (Clerc 2/6/18 → 1/2/3,
  Paladin 3/18 → 1/2). `classFeatureResourceMax` doit évaluer la formule au **niveau de la classe
  de la capacité** (voir 1.9) ; la carte ressource n'affiche qu'**un** compteur CD (somme des
  utilités explicites, pas un compteur par ligne).
- **Toutes les autres capacités** s'acquièrent au **niveau de leur classe** (ki, points de
  sorcellerie, inspiration bardique, Second souffle, Métamagie, aura paladin niveau 6, chCrit
  Champion 3/15, dés d'arts martiaux du Moine, forme sauvage…) — c'est la règle générale « vous
  gagnez les aptitudes de la nouvelle classe au niveau approprié ». Le catalogue
  (`classFeatures.ts`) est déjà indexé par classe + niveau d'acquisition : il suffit de l'interroger
  avec le **niveau de classe** et non le niveau total.

### 1.7 Incantation (SRD 5.1) — le gros morceau

Règles citées (FR 5e-drs) :
> « Vous déterminez les sorts que vous connaissez et pouvez préparer pour **chaque classe
> individuellement**, comme si vous étiez un personnage mono-classe de cette classe. »
> « Additionnez tous vos niveaux dans les classes barde, clerc, druide, ensorceleur et magicien, et
> la moitié de vos niveaux de paladin et de rôdeur (arrondie à l'inférieur) » → consultez la table
> de l'**incantateur multiclassé**.
> « Vous pouvez utiliser les emplacements de sorts que vous obtenez grâce à l'aptitude magie de
> pacte pour lancer des sorts » des classes à incantation, et réciproquement.

**a) Niveau d'incantateur et emplacements** :
- Formule : Σ niveaux complets (Barde, Clerc, Druide, Ensorceleur, Magicien) + ⌊n/2⌋ Paladin/Rôdeur
  + ⌈n/2⌉ Artificier *(TCE)* + ⌊n/3⌋ Guerrier *Chevalier occultique* / Roublard *Escamoteur
  occultique* *(PHB)*. Plafonné à 20.
- La table de l'incantateur multiclassé est **identique** à `SPELL_SLOTS_FULL` (vérifié ligne à
  ligne contre le SRD : les 20 rangées coïncident) → le moteur réutilise `SPELL_SLOTS_FULL[casterLvl-1]`
  + un test verrouille l'identité (données SRD dupliquées dans le test comme oracle).
- **Piège RAW** : la formule multiclassée ne s'applique que si le personnage a **plusieurs**
  classes. Un Paladin 5 mono-classe garde sa table dédiée `[4,2,0…]` (`SPELL_SLOTS_HALF`) ; un
  Paladin 2/Ensorceleur 3 passe par la formule (1+3=4 → `[4,3,0…]`). L'Artificier mono-classe, lui,
  coïncide toujours avec la formule (⌈n/2⌉) — test de non-régression pour les deux branches.
- Emplacements d'un niveau **supérieur** au plus haut sort connu/préparable d'une classe : utilisables
  uniquement pour lancer des sorts de niveau inférieur (upcast) — l'UI doit le dire (puce
  « niveau X : upcast uniquement ») sans interdire le suivi.

**b) Magie de pacte (Occultiste)** : les emplacements de pacte (1-4 emplacements, niveau d'emplacement
1→5 par palier, **recharge au repos court**) ne fusionnent **jamais** avec la table multiclassée ;
ils coexistent. Réciproquement autorisé : lancer un sort d'Incantation avec un emplacement de pacte
et un sort d'Occultiste avec un emplacement d'Incantation.
- **Problème de stockage** : `characters.spell_slots_used` (tableau de 9, `schema.ts:137`) indexe
  « niveau d'emplacement → consommés ». Un Occultiste 5 (2 emplacements de niv. 3 → `[0,0,2,…]`)
  multiclassé Magicien 5 (4/3/2 → `[4,3,2,…]`) aurait **deux pools qui s'écrasent au même indice**.
  → nouvelle colonne `pact_slots_used` (voir 4.1) ; le pool pacte devient toujours séparé, y compris
  pour un Occultiste mono-classe (invariant plus simple).
- `applyRest` (`index.ts:3476`) : repos court → reset du pool pacte uniquement ; repos long → les
  deux pools (déjà le cas pour le mono-classe).

**c) Sorts connus et préparés — par classe** :
- `computePreparedSpellsLimit(classInfo, level, score)` (`index.ts:1147`) est déjà paramétré par
  classe : en multiclassage, appelé **une fois par classe préparant** (Clerc SAG+niv. Clerc ;
- Magicien INT+niv. Magicien ; Paladin/Rôdeur/Artificier mod + ⌊niv/2⌋… artificier : mod + niv.
  complet — déjà le cas via `spellcasting === 'artificier'`).
- Nécessite de savoir **de quelle classe vient chaque sort** : aujourd'hui `character_spells` n'a
  aucune attribution (uniquement `prepared`, unicité (personnage, sort) — `schema.ts:378`). →
  colonne `class_source` + relâchement de l'unicité (le même sort peut être connu via deux listes
  de classe — SRD : listes indépendantes).
- Sorts toujours préparés (domaine clerc / cercle Terre druide / serment paladin) : `domain-spells.ts:33-41`
  les dérive des colonnes dédiées au `char.level` → itérer sur **toutes** les classes avec leur
  niveau de classe ; ils ne comptent pas dans les limites (déjà le cas, `CharacterSpellsTab.tsx:153-158`).
- Tours de magie : progressent au **niveau de personnage** (les descriptions SRD « augmente au
  niveau 5/11/17 » + § 1.2 « niveau total » ; le SRD n'a pas de phrase dédiée multiclassage —
  `spellDamageAtLevel`/`spellHealingAtLevel` utilisent déjà `charLevel` (`index.ts:2475/2516`) :
  **rien à changer**, juste un test qui verrouille (Magicien 1/Ensorceleur 10 → cantrip de palier 11).

**d) Caractéristique d'incantation — par sort** :
> Chaque sort est associé à une de vos classes ; DD et bonus d'attaque utilisent la caractéristique
> (et le focus) de cette classe.

- `CharacterSpellsTab.tsx:131-149` calcule UN modificateur/UNE DD depuis la classe unique →
  par sort : `spellcastingAbility(classSource)` ; l'onglet affiche une DD par classe incantatrice
  (puces sur la carte Sorts + dans la fiche d'incantation), idem `CharacterStateBand`.
- Le sélecteur « ajouter un sort » filtre par classe (`spells.ts:34-39`, LIKE sur `classes_json`) →
  accepter la liste des classes du personnage (UNION des listes).

**e) Concentration** : une seule, quelle que soit la combinaison — inchangé.

### 1.8 Règles adjacentes impactées (niveau de classe, pas niveau total)

| Fonction (`packages/shared/src/index.ts`) | Ligne | Changement |
|---|---|---|
| `extraAttacks` | 2876 | max par classe, niveau de **classe** (§ 1.6) |
| `criticalRange` (Champion 19/18) | 2897 | niveau de **classe Guerrier** |
| `auraOfProtectionBonus` / `auraRadiusMeters` (Paladin 6/18) | 2910/2921 | niveau de **classe Paladin** |
| `martialArtsDie` + `computeWeaponStats` (dés d'arts martiaux) | 2928/2236 | niveau de **classe Moine** |
| `unarmoredMovementBonus` + `computeSpeed` (Moine / Déplacement rapide Barbare 5) | 2314/2337 | niveau de **classe** ; les deux bonus **coexistent** (noms différents → cumulables, SAC) — aujourd'hui le `else if` (`index.ts:2406`) n'applique qu'une classe |
| `sneakAttackDice` (Roublard) | 2868 | niveau de **classe Roublard** |
| `wildShapeMaxCR`/`wildShapeCanSwim/Fly`/Archidruide (Druide 20 illimité) | 2802+, `wildshape.ts:102-210` | niveau de **classe Druide** (`char.level >= 20` → `druidLevel >= 20`) |
| `expertiseSlots` (Roublard 2/4, Barde 2@3/4@10, Clerc Savoir 2) | 604 | **somme** des pools par classe (chacun évalué à son niveau de classe) ; `ProficiencyLevel = 0|1|2` (`index.ts:580`) interdit structurellement l'expertise ×4 — parfait |
| Styles de combat (`fightingStyle`, `FIGHTING_STYLE_CLASSES` Guerrier/Paladin/Rôdeur) | 1460-1478, `schema.ts:170` | **un style par classe** (chacun au niveau d'acquisition de sa classe : Guerrier 1, Paladin 2, Rôdeur 2) ; le même style deux fois ne cumule pas (SAC) → stockage par classe, ensemble dédupé côté moteur (`Défense` +1, `Archérie` +2, `Duel` +2 dans `computeAC`/`computeWeaponStats`) |
| `computeAC` (Défense sans armure) | 1323 | choix de la défense active (§ 1.6) |
| `computePreparedSpellsLimit` | 1147 | appel par classe (§ 1.7c) |
| `bonusPreparedSpells`/`domainSpellsFor` | 2771/2613 | itération sur toutes les classes + niveau de classe |
| `applyRest` | 3425 | dés de vie par type (§ 1.3), pool pacte séparé (§ 1.7b), `wildShapeUses` au niveau Druide, compteurs au niveau de classe |
| `classFeatureResourceMax` / `effectiveFeatureReset` (`classFeatures.ts:2702/2719`) | — | **niveau de la classe de la capacité** (aujourd'hui `character.level` : le bug multiclassage classique — Rage, Second souffle, ki, points de sorcellerie, Inspiration bardique et sa bascule court@5 seraient évalués au niveau total) |
| `featuresForCharacter` / `nextClassFeatureGain` (`classFeatures.ts:2647/2684`) | — | itérer sur toutes les classes ; acquisition filtrée au niveau de classe ; « prochaine acquisition » par classe |
| Cantrips (`spellDamageAtLevel`/`spellHealingAtLevel`) | 2452/2493 | **aucun changement** (niveau de personnage, déjà implémenté) ; test de verrouillage |
| `proficiencyBonus` | 522 | aucun changement (niveau total) |

### 1.9 Règles **non** impactées

- Encumbrance/portage, conditions, sauvegardes contre la mort, inspiration, nourriture/eau,
  épuisement : indépendants des classes.
- Jets de sauvegarde (déjà stockés, jamais gagnés en multiclassage).
- XP (non suivis), équipement de départ (hors périmètre — le SRD précise qu'on ne le reçoit pas ;
  l'inventaire est déjà manuel).
- ASI (« Amélioration de caractéristiques ») : chaque classe accorde les siennes aux niveaux de
  classe 4/8/12/16/19 (+6/14 Guerrier, +10 Roublard) → un multiclassé en a **moins**. Les scores
  sont libres dans l'app (aucun suivi) : **aucun changement obligatoire** ; option : puce
  informative « ASI disponibles : N » calculée par classe (valeur = count des paliers atteints).

## 2. État des lieux — où le mono-classe est câblé

| Endroit | Détail |
|---|---|
| `apps/api/src/db/schema.ts` | `characters.level` (total, CHECK 1-20), `character_class`, `subclass` générique + 4 colonnes dédiées (`druid_circle`, `divine_domain`, `land_circle`, `sacred_oath`), `fighting_style` unique, `hit_dice_used` entier, `spell_slots_used` (9), `weapon/armor_proficiencies` (NULL = défaut classe unique) |
| `character_spells` | aucune colonne de classe ; unicité (personnage, sort) (`schema.ts:378`) |
| `character_features` | `catalog_id` sans colonne de classe (le préfixe de l'id encode la classe : `occultiste-…`, `chevalier-occulte-…`) |
| `packages/shared/src/index.ts` | toutes les fonctions du tableau § 1.8 prennent `characterClass: string` + `level` unique |
| `classFeatures.ts` | `CLASS_FEATURES`/`CLASS_SUBCLASSES` déjà par classe + niveau ; `classFeatureResourceMax` évalue à `character.level` (total) |
| `apps/api/src/routes/` | `characters.ts` (création/patch mono-classe), `character-spells.ts` (pas de classe), `domain-spells.ts` (colonnes dédiées, `char.level`), `rest.ts` (applyRest), `wildshape.ts` (`char.level`), `spells.ts` (filtre classe unique), `combat.ts` (affichage seul, `combat.ts:592`) |
| Web | `CharacterDescriptionTab` (brouillards classe+niveau uniques, lignes de sous-classe depuis 4 colonnes), `CharacterStatsTab` (CA/DD/dé de vie `d{hitDie} · N/total`), `CharacterSpellsTab` (un `castingType`, une limite de préparation, une DD), `CharacterSkillsTab` (`expertiseSlots` unique, aura), `CharacterFeaturesTab` (catalogue mono-classe), `SurvivalPanel` (dés de vie uniques, attaque sournoise/×N au niveau total, forme sauvage si « Druide »), `CharacterStateBand` (slots mono-classe), `CharacterCreatePage` (PV moyens mono-classe, création mono-classe = RAW) |

## 3. Décisions de conception (recommandations)

- **D1 — Représentation des classes** : table **`character_classes`** (`character_id, class_key, level, subclass_key, hit_dice_used, fighting_style, position`) plutôt qu'une colonne JSON : requêtable, indexable, une ligne par classe = jointure naturelle pour dés de vie/style/sous-classe. *Recommandé : table.*
- **D2 — Colonnes legacy** : garder `characters.character_class` (classe de départ) + `characters.level` (somme) **dénormalisés et synchronisés** : la contrainte CHECK 1-20 reste le garde-fou du total, et tous les affichages « classe · niv. » continuent de marcher pendant la migration progressive des lecteurs. Les 4 colonnes de sous-classe dédiées + `subclass` sont recopiées dans les lignes de classe puis ne servent plus qu'au backfill. *Recommandé : garder en dénormalisé, sans date de suppression (coût nul, lecteurs nombreux).*
- **D3 — Pool pacte** : colonne dédiée `pact_slots_used` (9) ; le pool Incantation reste `spell_slots_used` (table multiclassée). *Recommandé : oui* (§ 1.7b — collision d'index inévitable sinon).
- **D4 — Prérequis** : validation **partagée** (`multiclassPrereqIssues`) affichée en ⚠ UI ; l'API ne bloque pas (précédent : expertise appliquée côté UI, `AGENTS.md`). *✅ Confirmé 2026-08-21 : ⚠ UI seulement, l'API stocke.*
- **D5 — `character_spells`** : colonne `class_source` (clé de classe, NULL = héritage mono-classe au backfill) + **remplacement de l'unicité** (personnage, sort) → (personnage, sort, classe). *Recommandé : oui, avec réécriture de l'UPSERT (`character-spells.ts:141`).*
- **D6 — Portée de la sous-classe** : la sous-classe passe sur la **ligne de classe** (`subclass_key`, y compris les valeurs aujourd'hui éparpillées dans `druid_circle`/`divine_domain`/`land_circle`/`sacred_oath`) ; `featuresForCharacter` et l'éditeur de l'onglet Description lisent la ligne. Le verrou « sous-classe disponible à partir du niveau RAW » (déjà dans `SubclassDef.level`) s'évalue au **niveau de classe**.
- **D7 — Parcours d'ajout de classe** : « ＋ Ajouter une classe » ouvre une **feuille mobile guidée** (choix → prérequis → maîtrises acquises → sous-classe → niveau de départ), puis les niveaux s'ajustent en steppers inline. *✅ Confirmé 2026-08-21 (cf. § 4.5).*

## 4. Changements par couche

### 4.1 Modèle de données (Drizzle, migration `00NN_multiclass.sql`)

1. **`character_classes`** : `id`, `character_id` FK CASCADE, `class_key` TEXT (nom FR `DND_CLASSES`),
   `level` INTEGER 1-20 (CHECK), `subclass_key` TEXT NULL, `hit_dice_used` INTEGER 0,
   `fighting_style` TEXT NULL, `position` INTEGER (0 = classe de départ), UNIQUE(character_id, class_key).
2. `characters` : + `pact_slots_used` TEXT JSON `[0×9]` (DEFAULT).
3. `character_spells` : + `class_source` TEXT NULL ; DROP UNIQUE(character_id, spell_id) →
   UNIQUE(character_id, spell_id, class_source). ⚠ SQLite : recréation de table (migration Drizzle
   gère ; vérifier l'ordre avec la contrainte existante).
4. `character_features` : + `class_key` TEXT NULL (redondant avec le préfixe du `catalog_id`, mais
   explicite — sert à `applyRest` pour retrouver le **niveau de classe** ; backfill depuis le préfixe).
5. **Backfill** (dans la migration, SQL pur) : pour chaque personnage, INSERT la ligne
   (classe, level, sous-classe = colonne dédiée ou `subclass` selon la classe, hit_dice_used =
   `characters.hit_dice_used`, fighting_style = `characters.fighting_style`) ; si classe =
   Occultiste → `pact_slots_used = spell_slots_used` et `spell_slots_used = [0×9]` ;
   `character_spells.class_source = character_class` ; `character_features.class_key` depuis le
   préfixe du catalog_id.
6. Écritures **synchronisent** les dénormalisés : `character_class` = ligne position 0,
   `level` = Σ, colonnes dédiées/sous-classe/fighting_style/hit_dice_used = reflets de la ligne 0
   (rétrocompatibilité affichage pendant la migration des lecteurs).

### 4.2 Moteur partagé (`packages/shared/src/index.ts`)

Nouveautés :
- `MULTICLASS_PREREQUISITES`, `MULTICLASS_PROFICIENCIES_GAINED` (FR), `multiclassPrereqIssues()`.
- `CharacterClassEntry` (type exposé dans `CharacterSummary.classes`) + helpers
  `totalLevel(classes)`, `classLevel(classes, name)`.
- `multiclassCasterLevel(classes)` : § 1.7a (complets + ⌊pal/rôdeur ÷2⌋ + ⌈artificier ÷2⌉ +
  ⌊guerrier-CO / roublard-EA ÷3⌋, plafonné 20). Détection des tiers par `subclass_key`.
- `computeSpellSlotsMulti(classes)` → `{ spellcasting: number[9], pact: number[9] }` :
  mono-classe → tables dédiées existantes (`maxSpellSlots`) ; multi-classe →
  `SPELL_SLOTS_FULL[casterLevel-1]` (identité table SRD, test verrouillé) + `SPELL_SLOTS_PACT[nivOccultiste-1]`.
- `computeUnarmoredDefenses(classes, scores, hasShield)` → candidates [{classe, formule, ac}] pour
  le sélecteur de CA ; `computeAC` prend les classes + la défense choisie.
- `averageMaxHpMulti()` (§ 1.3).

Adaptations (signatures « character mono-classe » → « classes[] » — garder les anciennes en
 wrappers mono-classe quand c'est gratuit) : tout le tableau § 1.8. Points sensibles :
- `applyRest` : signature `features` gagne le niveau de classe (via `class_key`), options de dés de
  vie deviennent `Array<{classKey, count}>`, retour de la dépense par type de dé ; regain long =
  budget (⌊total/2⌋ min 1) **à répartir** par le joueur (payload `regain: Array<{classKey, count}>`).
- `effectiveWeaponProficiencies`/`effectiveArmorProficiencies` : défaut = union (§ 1.5).

### 4.3 Catalogue (`classFeatures.ts`)

- `featuresForCharacter(classes)` : concatène base+sous-classe de **chaque** classe, filtré au
  niveau de classe, tri par (classe, niveau).
- `classFeatureResourceMax(def, character)` → prend `classes` et évalue `resource.max(levelDeSaClasse, mods)`.
- `effectiveFeatureReset` : `shortFromLevel` comparé au niveau de **classe**.
- `nextClassFeatureGain(classes)` → par classe (« Prochain palier : Guerrier 6 → … ; Magicien 4 → … »).
- Canalisation divine : contrechamp combiné (§ 1.6) — calcul dédié `channelDivinityUses(classes)`.

### 4.4 API (`apps/api/src/routes/`)

- `characters.ts` : `CreateCharacterPayload.classes?` (création RAW mono-classe par défaut,
  accepte une liste pour les campagnes démarrant à haut niveau) ; `PatchCharacterPayload.classes`
  (remplacement atomique de l'ensemble des lignes en transaction + resynchronisation des
  dénormalisés). Validation structurelle uniquement : clés connues, niveaux 1-20, somme ≤ 20,
  sous-classes ∈ `CLASS_SUBCLASSES[classe]` et niveau ≥ `SubclassDef.level`. `mapCharacterSummary`
  (`helpers.ts`) sérialise `classes[]` + `pactSlotsUsed`.
- `character-spells.ts` : `classSource` à l'ajout (choice UI), UPSERT sur la nouvelle clé, PATCH/DELETE inchangés.
- `spells.ts` : filtre `class` accepte une liste (OR sur `classes_json`).
- `domain-spells.ts` : itère toutes les sources divines avec leur niveau de classe.
- `rest.ts` : payload dés de vie par classe + regain ; réponse par type de dé.
- `wildshape.ts` : niveau de **classe Druide** partout (`:102-210`).
- `character-features.ts` : `class_key` stocké à l'ajout depuis le catalogue.
- Couverture requêtes : les nouveaux `.prepare(` doivent s'exécuter dans `npm run test-api`
  (portail 100 % — AGENTS.md).

### 4.5 Web (`apps/web/src`) — direction design arrêtée (impeccable · shape)

Direction établie avec le skill impeccable (PRODUCT.md + DESIGN.md + briefs de surface existants
« Sorts » et « Fiche/bandeau d'état » chargés via `context.mjs`). Mode visiteur : **Operate** —
joueur sur téléphone à une main, en séance, la table d'abord.

**Principes directeurs** (découlent du DESIGN.md et des principes produit) :

1. **Raffinement, pas refonte** : une fiche mono-classe reste identique au pixel près (dock,
   bandeau, théâtre du tour intouchables). Chaque affordance multiclassée n'apparaît que si l'état
   l'exige : ≥ 2 classes, Occultiste présent, ≥ 2 défenses sans armure candidates, dés de vie mixtes.
2. **La règle s'enseigne au moment où elle s'applique** (principe produit #2) : prérequis, maîtrises
   acquises, plafond de préparation par classe, pools pacte/incantation distincts — chaque contrainte
   SRD s'affiche là où elle mord, jamais dans un panneau « règles » déconnecté.
3. **Discipline du sang** : le sang porte « maintenant + action primaire » uniquement. Les
   avertissements (prérequis non satisfait, dépassement de préparation, somme > 20) reprennent la
   couleur de règle **orange** existante — jamais de sang décoratif.
4. **Valeurs mesurées en mono** (niveaux, dés de vie, DD, compteurs d'emplacements) ; `Chip` et tons
   existants ; **or = magie** (accent du pool pacte). Aucune nouvelle famille visuelle, aucun
   nouveau moment d'animation — les états multiclassés sont des états, pas des arrivées ; les
   incumbents (perles, row-flash, sheet-tab-swap) suffisent.

**Spécifications par surface** :

| Surface | Direction |
|---|---|
| **Description — carte Classe** | Le résumé devient « Guerrier 5 / Magicien 3 » (niveaux en mono). Niveaux ajustés par steppers inline ≥ 44 px (aria « Ajouter un niveau de Magicien »), sous-classe par classe avec son verrou RAW, somme plafonnée à 20 (erreur inline orange). La carte reste le panneau `.card` actuel. |
| **Description — feuille guidée « ＋ Ajouter une classe »** (D7) | `BottomSheet` portaled (`size="lg"`, footer d'action), 4 temps en défilement : (1) choix de la classe (liste réglée : nom, dé de vie mono, registre d'incantation) ; (2) carte **prérequis** — chaque caractéristique exigée avec son score actuel, ✓ encre / ⚠ orange, jamais bloquant (D4) ; (3) carte **maîtrises acquises** (table SRD § 1.5) avec la note « votre classe de départ garde ses maîtrises complètes » ; (4) sous-classe si le niveau l'autorise, sinon « à choisir au niveau X » + niveau de départ (stepper, défaut 1). Action finale : primaire sang « Ajouter » — l'action primaire de la feuille. |
| **Sorts — rails d'emplacements** | Le rail en perles actuel devient **deux rails étiquetés** quand les deux pools existent : « Incantation » (perles actuelles) et « Magie de pacte » (perles cerclées **or**, note « recharge au repos court »). Mono-classe : rendu actuel inchangé (un Occultiste seul garde son rail unique sans étiquette). Les perles d'un niveau « upcast uniquement » gardent chiffres `ink-300` + title explicatif (§ 1.7a). |
| **Sorts — préparation par classe** | Le filtre segmenté `[Tous \| Préparés n/limit]` devient multi-segments (un par classe préparant, compteur mono, dépassement en rouge comme aujourd'hui) ; sorts toujours préparés (domaine/serment/cercle des deux classes) fusionnés avec leur ◆. Chaque rangée gagne une puce de classe d'origine discrète (ton encre, masquée en mono-classe) ; la feuille d'incantation affiche la DD/attaque **du sort** (classe d'origine) ; le bandeau de lanceur liste une mini-colonne par classe incantatrice. Ajout de sort : choix de la classe (listes union). |
| **Caractéristiques — CA** | Sélecteur de Défense sans armure uniquement si ≥ 2 candidates : segmented control à côté de l'override Manuel/↺ Auto existant, chaque option avec sa CA calculée (mono) et sa formule (« 10 + DEX + CON — Barbare ») ; défaut = meilleure CA ; bouclier noté pour la contrainte Moine. |
| **Caractéristiques — dérivées** | DD de sort par classe incantatrice (une ligne par classe), dés de vie « 3d10 + 2d8 » (mono) dans la tuile dé de vie, PV conseillés multiclassés. |
| **Survie — dés de vie** | Compteur par type : « d10 3/5 · d8 2/2 » (mono, steppers ≥ 44 px). Dépense au repos court : stepper par type dans la feuille de repos existante. Regain au repos long : mini-feuille de répartition dans le budget (⌊total/2⌋ min 1), défaut FIFO sur la classe de départ. |
| **Compétences** | Pool d'expertise sommé avec détail en méta (« Roublard 4 + Barde 2 ») ; cartes maîtrises d'armes/armures = union. |
| **Traits** | Sélecteur de classe au-dessus du catalogue (une par classe au niveau atteint) ; « prochaine acquisition » par classe. |
| **Bandeau, modales, dashboards** | `CharacterStateBand` : phrase d'état mono-ligne, pools concaténés compacts (« 4/3/2 · ☾ 2/2 »), détails dans le panneau dépliable ; `AddPlayerModal`/GmDashboard/PartyPage : « Classe A n / Classe B n ». Rien ne bouge pour un mono-classe. |

**Contraintes transverses** : cibles ≥ 44 px, focus visible, aria-labels français nommant la classe ;
hooks avant gardes de rendu dans `CharacterInventoryPage` (règle #310 AGENTS) ; bottom sheets
portaled (bloc conteneur de `.card`) ; français intégral, vocabulaire AideDD.

**Processus impeccable pour la phase web** :

1. Étendre les briefs de surface existants (« Sorts », « Fiche/bandeau ») et en écrire pour les
   surfaces touchées dépourvues de brief (Description, Caractéristiques, Survie) **avant** d'éditer.
2. Charger `reference/craft-floor.md` (skill impeccable) immédiatement avant la première édition
   d'UI — plancher qualité + interdits.
3. Vérifier en passes **bornées** : une passe groupée de captures (desktop + mobile 390×844 via
   browser-use → `gui-test-screenshots/`), corriger tout ce qu'elle révèle en un lot, au plus une
   passe de confirmation, puis s'arrêter — pas de QA ouvert.
4. Mono-classe = oracle de non-régression visuelle (captures avant/après identiques).
5. Fin de phase : `npm run screenshots` (README) + mise à jour de ce document.

### 4.6 Tests

- **Règles (tsx, CI)** — étendre `scripts/test-class-features.ts` ou créer `scripts/test-multiclass-rules.ts` branché au workflow :
  - identité table multiclassée = `SPELL_SLOTS_FULL` (oracle = 20 rangées SRD dupliquées dans le test) ;
  - formule : Ens 3/Mag 2 → incantateur 5 ; Pal 2/Ens 3 → 4 ; Pal 5 **mono** ≠ Pal 5 multi
    (piège table dédiée) ; Artificier 1 seul = 2 emplacements (⌈½⌉) ; CO 8 (=⌊8/3⌋ 2) ;
  - Occultiste 5/Magicien 5 : pacte `[0,0,2,…]` **et** incantation `[4,3,2,…]` simultanés ;
  - attaque supplémentaire : Guerrier 11/Barb 5 → 3 ; Guerrier 5/Moine 5 → 2 ;
  - défense sans armure : Barb/Moine → choix, pas de combinaison ;
  - vitesse : Moine 6/Barb 5 sans armure → +4,5 ET +3 ;
  - prérequis (table § 1.1, cas OU/ET) ; expertise Barb 10/Roub 6 → 4+4 ;
  - cantrips au niveau total (Mag 1/Ens 10) ; chCrit Champion au niveau de classe Guerrier ;
  - dés de vie : budget long ⌊5/2⌋=2, min 1 ; `averageMaxHpMulti` ;
  - forme sauvage CR au niveau Druide (Druide 3/Barb 2 → CR 1).
- **API** (`scripts/api-tests/`) : création/patch multiclassé + dénormalisés, sorts avec
  `classSource` (double liste), domain-spells bicolasse, repos avec dés mixtes + reset pacte,
  backfill mono-classe (parité avant/après), portail de couverture pour les nouveaux sites SQL.
- **E2E** (`e2e/`) : feuille multiclassée au seed (p. ex. Clerc 5/Magicien 3 + Occultiste ?) ;
  spec : deux pools de sorts, compteurs de préparation par classe, dés de vie mixtes, repos long.

### 4.7 Migration & compat

- Drizzle : `npm -w api run db:generate` → `00NN_multiclass.sql` (table + colonnes + recréation
  `character_spells` + backfill SQL) ; appliquée automatiquement au boot (prod : rappeler
  `docker compose pull && up -d`).
- Mono-classe = cas particulier (1 ligne) : **parité comportementale** exigée — la suite API
  actuelle doit passer sans modification d'assertions (garde-fou principal).
- WS : `character:change` déjà générique ; aucun événement nouveau requis.

### 4.8 Docs

- `AGENTS.md` (conventions moteur multiclassé), `README` (fonctionnalité + capture),
  `docs/class-coverage-audit.md` (lien), ce document mis à jour au fil des arbitrages.

## 5. Phasage proposé

1. **Moteur + tests** (pur, sans dépendance) : constantes, formules, refactors de signature avec
   wrappers mono-classe, suites de règles. *La partie la plus grosse ; à faire d'abord car tout en dépend.*
2. **Schéma + API** : migration + backfill, routes, tests API (parité mono-classe + nouveaux cas).
3. **Web** (processus impeccable § 4.5) : briefs de surface → Description (feuille guidée +
   steppers) → Sorts (rails/pools/préparation par classe) → Caractéristiques/Survie/Compétences/
   Traits → bandes/modales. `craft-floor.md` avant la première édition ; vérification en passes
   bornées de captures ; mono-classe = oracle visuel.
4. **E2E, captures, docs, CI.**

Risques : (a) `applyRest` change de contrat (dés par type) — toucher UI+API ensemble ;
(b) recréation de table `character_spells` sous SQLite — tester la migration sur une copie de la
DB Docker avant déploiement ; (c) `classFeatureResourceMax` au niveau de classe est le bug le plus
facile à rater (symptôme silencieux : compteurs trop grands) — le couvrir par tests par classe ;
(d) mono-classe doit rester bit-identique (table dédiée demi-incantateur ≠ formule).

## 6. Hors périmité / arbitrages explicites

- Pas de suivi PX ni d'équipement de départ (déjà absents).
- ASI : pas de suivi (scores libres) ; puce informative optionnelle.
- Choix des dés regagnés au repos long : le SRD ne dit rien (les dés ne sont échangeables qu'en
  nombre) → UI de répartition, défaut FIFO sur les dés de la classe de départ.
- Styles de combat identiques, expertise ×4 : interdits côté moteur (SAC « Combining Game Effects »).
- Canalisation divine combinée : implémentée selon la citation SRD (première acquisition non
  cumulative, paliers explicites additifs) — `channelDivinityUses(classes)` documenté.
