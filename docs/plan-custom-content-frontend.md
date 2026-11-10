# Plan frontend — Contenus personnalisés : onglets pupitre MD, grimoire, bestiaire, armures

**Brief UX/UI (impeccable, mode `shape`) — SANS code.** S'appuie sur `docs/plan-custom-content-product.md` (spec fonctionnelle, §8 décisions tranchées) et `docs/plan-custom-content-marketing.md`. Le plan architecture/backend (`docs/plan-custom-content-architecture.md`) est rédigé en parallèle ; ce document ne préjuge que des **surfaces client** et nomme les contrats qu'il attend de l'API (routes, événements WS, payload) sans les spécifier.

Mode visiteur : **Operate** partout — le MD et les joueurs complètent une tâche, en séance ou en préparation. Raffinement, PAS refonte : **tout ce qui n'est pas dans le périmètre de la feature reste pixel-identique**.

---

## 1. Brief shape validé

### 1.1 Job & audience par surface

| Surface | Qui arrive, dans quel état | Besoin |
|---|---|---|
| **S1 — Pupitre MD, onglet « Sorts custom »** | Mika, desktop ≥1024 px, en **préparation de séance** (pas en plein combat) — calme, clavier disponible | Inscrire un sort maison en < 3 min, le retrouver, le corriger entre deux séances, le supprimer en sachant qui le connaît |
| **S2 — Pupitre MD, onglet « Monstres custom »** | Mika, desktop, préparation (parfois tablette/iPad tactile) | Dresser un statblock **utile en combat** en < 5 min ; le poser ensuite dans une rencontre aussi vite qu'un SRD |
| **S3 — Pupitre MD, panneau Armure** (onglet « Objets personnalisés » existant) | Mika, desktop, préparation | Créer/éditer une armure avec un **type explicite** — le panneau Arme actuel est le gabarit exact |
| **S4 — Grimoire joueur** (`CharacterSpellsTab.tsx`) | Léna, **téléphone, une main, en séance**, pressée | Voir « Grâce de la Serpente » **exactement comme un sort SRD** : l'apprendre, le préparer, le lancer (upcast, concentration, DD) sans aucun chemin nouveau |
| **S5 — Bestiaire & rencontres MD** (`AddMonsterModal.tsx`, `MonsterStatBlock.tsx`, `CombatPage.tsx`) | Mika, **en séance, au combat** — souris/tactile, zéro frappe superflue | Retrouver « Zalkir, prêtre-serpent » dans la recherche du bestiaire, l'ajouter ×3, masquer le nom, ouvrir son bloc — gestes identiques aux SRD |
| **S6 — Joueur, création d'armure** (`CatalogSearch.tsx` + modal de `CharacterInventoryPage.tsx`) | Paul, téléphone, en séance, le MD vient d'annoncer le loot | « Cuirasse d'écailles du temple » introuvable → CTA créer → panneau Armure → enregistrer → équipe → **sa CA bouge à la seconde** |

### 1.2 Outcome & preuve

- **Sort** : un sort custom est **indistinguable d'un SRD** dans le grimoire, la feuille d'incantation (`CastSpellSheet` — aperçu d'upcast lu sur la table `damage_at_slot_level`, badge concentration 🌀, DD affichée) et la prose (`SpellProse`) — seule différence : le badge or « sort de la table ». Preuve e2e : apprendre le custom, l'upcaster d'un cran, vérifier les dés recalculés (gabarit `custom-weapon.spec.ts`).
- **Monstre** : ajout en rencontre ×N, PV roulés par exemplaire, initiative, groupe, masque — la recherche du bestiaire mêle SRD + customs du groupe sans second chemin. Preuve : le monstre custom vit dans une rencontre active, snapshot chiffré, bloc consultable.
- **Armure** : CA recalculée par `computeAC` lisant le **type explicite** (`armorFamily`), détail du calcul visible (tuile CA + breakdown existant), malus vitesse FOR min **affichés** jamais appliqués en silence. Preuve e2e : équiper l'armure custom → la tuile CA passe de X à `base + DEX (cap ×2)`.
- **Garantie de stabilité** : propagation MD→joueurs par JOIN + WS (le sort retouché entre deux séances se corrige tout seul au prochain rendu), suppression encadrée par des garde-fous qui **listent les conséquences avant d'agir**.

### 1.3 Direction retenue

1. **Héritage du pattern objets/armes, à la lettre.** Les trois créations reproduisent le socle prouvé de `CustomItemsTab` : onglet du pupitre = liste cartes + Modal de création/édition + `ConfirmButton` de suppression ; le panneau structuré vit dans un composant dédié (`WeaponFields` est le gabarit de `ArmorFields`, `SpellFields`, `MonsterFields`). Aucune nouvelle famille visuelle, aucun moment d'animation nouveau — les formulaires arrivent par le `Modal` standard, l'état armé de suppression garde la signature rouge + `pulse-warn`.
2. **Or = « le contenu de la table ».** Le badge « sort de la table » / « monstre de la table » vit dans la famille or (glyphe `spark`/✦, `Chip tone="gold"` ou pilule `gold-100`/`gold-700`), prolongeant la règle « or = magie/accent » : le contenu inventé par la table est l'or du grimoire. Jamais de sang (réservé à « maintenant + action primaire »), jamais de nouvelle couleur de règle.
3. **Le joueur ne voit rien de nouveau.** S4 et S6 n'ajoutent **aucun écran** : le custom fusionne dans les listes existantes (badge discret en suffixe), la création d'armure emprunte le CTA « Créer “X” » déjà en prod. Toute la surface nouvelle vit côté MD.
4. **Les formulaires enseignent la règle à la saisie.** Chips informatives recalculées en direct : « intermédiaire · cap DEX ×2 », « lourde · FOR min 13 · malus discrétion », « DD CON · demi dégâts », « +1d6 par cran ». Le moteur (`computeAC`, `parseDamageTemplate`, tables d'upcast) rend l'aperçu ; l'UI l'imprime — helper, pas automation.

### 1.4 Périmètre & anti-goals

**Dans le périmètre** : les 6 surfaces du tableau §1.1 + les clés i18n FR/EN + les états vides/erreur/hors-ligne des nouveaux onglets.

**Anti-goals (pixel-identique ou hors périmètre)** :
- Le grimoire SRD, la feuille d'incantation, la prose de sort, le traqueur, le bloc de stats, le pupitre existant (roster, journal, réglages) : **rien ne bouge** hors de l'insertion du badge et du panneau/onglets prévus.
- **Pas de création au fil de l'eau** côté joueur pour les sorts/monstres (Q9 tranché) ; pas de section « Sorts de la table » séparée dans le grimoire (Q4(a) tranché : fusion).
- Pas de second toggle : l'armure suit `playersCreateItems` tel quel.
- Hors MVP explicitement (plan produit §6) : sorts always-prepared custom, actions légendaires, formes sauvages custom, clone « partir d'un SRD », saisie bilingue des contenus.
- **Pas de nouvelle animation, pas de nouveau monde visuel, pas de CSS structurel neuf** : uniquement les idiomes existants (Modal, Chip, pastilles, filets, `EmptyState`).
- Aucune automatisation de jets : DD et malus **affichés**, jamais déclenchés.

### 1.5 États & plages réalistes

- **Volumétrie** : 0–30 sorts custom par groupe (typique : 3–8), 0–50 monstres (typique : 5–15), 0–40 objets/armures. Niveau de sort 0–9 ; CR 0–30 avec fractions ; 6 caracs 1–30 ; 0–6 actions par monstre (typique 2–4). Description : de la ligne (armure) au pavé markdown (sort).
- **États à couvrir par surface** : chargement (fantômes `SkeletonRow`/`SkeletonCard` dans les onglets), vide premier accès (`EmptyState` + chemin de création inline, idiome du pupitre), erreur API (`ErrorMsg` + Réessayer ; messages 403 « réservé au MD » calmes), validation inline orange par champ, conflit de nom SRD (avertissement informatif, jamais bloquant), hors-ligne (les onglets du pupitre sont en ligne-seulement : bandeau existant + `useResyncOnReconnect`), suppression armée (ConfirmButton 4 s auto-revert) et suppression en cascade (Modal de conséquences).
- **Événements WS** (contrat attendu de l'API, vocabulaire v2) : `party:change action 'custom-spell'` / `'custom-monster'` réveillent UNIQUEMENT leur onglet du pupitre + le grimoire/bestiaire ouverts ; `'custom-item'` couvre le panneau Armure (l'armure EST un objet). Rattrapage reconnexion par `useResyncOnReconnect` sur chaque nouvel onglet à état local.

### 1.6 Interaction & layout — intentions (PAS de CSS)

- **Pupitre** : la barre d'onglets passe de 6 à 8 pattes — déjà `overflow-x-auto no-scrollbar`, le scroll horizontal absorbe ; les deux nouveaux onglets se **groupent avec « Objets personnalisés »** (ordre recommandé : Personnages · Journal · Objets personnalisés · **Sorts custom** · **Monstres custom** · Joueurs · GM Assistant · Réglages). Comptes entre parenthèses comme les onglets existants.
- **Formulaires MD** : un `Modal` par création/édition (focus sur le premier champ — dérogation `no-autofocus` documentée), sections séparées par des titres `.section-title` quand le formulaire est long (sort, monstre) ; les champs d'une même règle se lisent en ligne sur desktop (grille 2 colonnes) et restent empilés sur mobile. Le panneau structuré apparaît **sous le sélecteur de catégorie** (idiome du panneau Arme).
- **Aperçus** : un état, pas une animation — chips recalculées à la frappe ; joueur = rendu chiffré sur le personnage réel, MD = rendu symbolique (même asymétrie que les armes).
- **Suppression** : échelle de confirmation du système — `ConfirmButton` au point de tap pour le monstre sans référence ; `Modal` de conséquences (liste des porteurs / rencontres) pour les cascades sorts/monstres référencés.
- **Mémorisation des vues** : tout filtre/onglet à état persiste par clé `dnd-inv-*` (motif #187), validé au contexte, dégradation propre en mode privé.

### 1.7 Contraintes (non négociables, déjà établies)

Cibles interactives ≥ 44 px ; aria-labels français nommant l'action (« Supprimer le sort X », jamais « supprimer ») ; boutons `type="button"` explicites (le submit du formulaire joueur reste `type="submit"`) ; labels `htmlFor`/`id` ; bottom sheets portaled via `BottomSheet`/`Modal` (jamais de `fixed inset-0` manuel — le `backdrop-blur` de `.card` casse `position: fixed`) ; hooks avant gardes de rendu ; noms de classes limités aux nuances `@theme` existantes ; pas de mono hors valeur mesurée ; saisie FR seule (Q10), l'interface EN affiche le contenu FR telquel ; texte UI toujours via i18n (paires fr+en obligatoires).

---

## 2. Décomposition par surface

### S1 — Pupitre MD : onglet « Sorts custom »

**Hiérarchie.** Nouvel onglet `CustomSpellsTab` (composant extrait, même topologie que `CustomItemsTab`) :
1. Titre de section + compteur ( `sorts.custom.n` ) + bouton « ＋ Ajouter » (`btn-primary`, la seule porte sang de l'onglet).
2. **Liste des sorts créés** : cartes `li.card p-3` — nom, chips descriptives (niveau · école · 🌀 concentration · rituel), badge « connu par N personnages » (encre, méta), attribution « par Mika » (idiome `md.par`), verbes ✎ Modifier / ConfirmButton ×.
3. État vide : `EmptyState` (glyphe `spark`) + hint « Les sorts de la table rejoignent le grimoire des classes autorisées » + chemin de création inline.

**Topologie du formulaire** (`SpellFields`, dans un `Modal` scrollable, sections titrées — l'ordre suit la fiche de sort SRD) :

1. **Identité** : Nom (requis, autofocus) · Niveau 0–9 (select) · École (8 écoles FR). *Avertissement inline non bloquant si un sort SRD porte déjà ce nom* (« Un sort du SRD porte déjà ce nom — le badge de la table les distingue »), encre/orange doux.
2. **Incantation** : Temps d'incantation (select + texte libre) · Portée · Durée · Composantes V/S/M (chips `aria-pressed`, idiome du bonus magique arme) + matériel (texte si M) · Concentration 🌀 · Rituel (cases).
3. **Classes autorisées** : multi-select chips des classes SRD + option « Toutes les classes » (chip pleine quand active). Chip informative de synthèse : « Barde · Magicien » ou « Toutes les classes ».
4. **Effet** : Dégâts à niveau natif (dés `NdX` + type SRD + capacité d'attaque) — validation inline orange « modèle de dés invalide » tant que `parseDamageTemplate` échoue (double barrière API) ; **Soins** (dés + case « + mod. d'incantation ») ; **DD de sauvegarde** (caractéristique FOR…CHA + effet annule/demi/aucun) avec chip informative « DD CON · demi dégâts » — *affichée, jamais jetée*.
5. **Incantation supérieure** : table `damage_at_slot_level` saisie en « +NdX par cran » OU ligne par niveau ; chip d'aperçu « Niveau 5 : 5d6 » recalculée en direct (même lecture que `CastSpellSheet` : les TABLES font foi).
6. **Texte** : Description (textarea, markdown des notes) · Niveaux supérieurs (si non couvert par la table).
7. **Aperçu** : fiche de sort en lecture, composants de rendu partagés avec la ligne de grimoire (badges DD/attaque/dégâts, `SpellProse` à l'ouverture) — le MD voit ce que le joueur verra.

**Flux de suppression (garde-fou Q7).** Le × arme le `ConfirmButton` ; si le sort est connu d'au moins un personnage, la confirmation passe au **`Modal` de conséquences** : titre « Supprimer “Grâce de la Serpente” ? », corps listant « Connu par : Lyra (Clerc 5) · Kael (Guerrier 2) », phrase « Les fiches concernées perdront ce sort » (la CASCADE), Annuler / Supprimer (rouge). Si personne ne le connaît : confirmation au point de tap seule.

**États.** Chargement `SkeletonCard lines={3}` ×3 ; erreur `ErrorMsg` + Réessayer ; hors-ligne : données déjà rendues conservées, bandeau existant, `useResyncOnReconnect`.

### S2 — Pupitre MD : onglet « Monstres custom »

**Hiérarchie.** `CustomMonstersTab`, même topologie : titre + compteur + Ajouter ; liste des cartes — nom, méta « humanoid · taille M · CR 3 (700 PX) », chips 🛡 CA · ❤ PV/dés, badge « dans N rencontre(s) » si référencé, verbes ✎/× ; état vide + création inline.

**Topologie du formulaire** (`MonsterFields`, `Modal` scrollable, statblock hybride Q5(a) — noyau structuré, listes nom+texte libres) :

1. **Identité** : Nom (requis) · Type (selects SRD FR) · Taille · Alignement.
2. **Noyau combat** (ce que le moteur consomme) : CA + description · PV fixes + dés de vie `NdX+mod` (chip « PV moyens : N » dérivée, mono) · 6 caractéristiques 1–30 (grille compacte, modificateurs dérivés affichés en mono sous chaque score) · CR (select 0–30 avec fractions) avec **XP et bonus de maîtrise dérivés** en chips mono.
3. **Vitesse & perception** : vitesses par mode (marche/vol/nage/escalade/creuser, en mètres) · Sens · Langues (texte).
4. **Défenses** : Résistances / immunités dégâts et conditions (multi-select chips types SRD) — affichage seul, jamais appliqué automatiquement.
5. **Traits & Actions** : listes répétables nom + texte libre (add/remove, réordonnables — motif des lignes de classe de l'éditeur Description), boutons « ＋ Trait » / « ＋ Action ». Les bonus d'attaque/dés parsés si la syntaxe est reconnue (même parseur que l'import SRD).
6. **Aperçu** : le `MonsterStatBlock` rendu en lecture dans le modal — le MD voit la fiche que le traqueur ouvrira.

**Flux de suppression (garde-fou Q6).** DELETE refusé tant qu'une rencontre setup/active référence le slug. UX : au tap du ×, si l'API répond 409 avec les rencontres, le **Modal de conséquences** liste « Utilisé par : Embuscade batiri (préparation) · Grotte (en cours) » et propose « Retirer d'abord les monstres de ces rencontres » — le bouton Supprimer reste désactivé tant que la référence vive existe (les rencontres terminées ne bloquent pas, affichées en méta grise). Monstre sans référence : `ConfirmButton` au point de tap.

**Note d'édition en combat** : une ligne d'aide dans le modal d'édition — « Un combat en cours garde les PV/CA déjà posés (snapshot) ; seul le bloc consultable change » (cas limites §3.4).

**États.** Idem S1 ; l'aperçu du statblock est un état, pas une animation.

### S3 — Pupitre MD : panneau Armure (onglet « Objets personnalisés »)

**Insertion** : dans le `Modal` existant de `CustomItemsTab`, le panneau `ArmorFields` s'affiche pour `category === 'armor'` — **gabarit exact du panneau Arme**, même emplacement (sous le sélecteur de catégorie), mêmes poids/description/illustration autour. Zéro changement de la liste, du toggle et des verbes.

**Topologie du panneau** (`ArmorFields`, partagé MD/joueur) :
1. **Type** : 4 chips `aria-pressed` plein largeur — Légère / Intermédiaire / Lourde / Bouclier (idiome du bonus magique arme : grille 4, min-h-11, sélection = `gold-100`/`gold-700`… non : la sélection reste l'idiome pastille armée encre — seuls les **aperçus** sont or). La sélection de type pilote les chips informatives recalculées : « + DEX (sans cap) » / « + DEX (cap ×2) » / « fixe · FOR min conseillée » / « +2 · suivi à part, jamais cumulé ».
2. **CA de base** : nombre 8–20 (`NumberField`) — la CA finale prévisualisée en chip mono.
3. **Bonus magique 0–3** : grille 4 boutons, sélection = or (idiome arme exact).
4. **Basée sur** (optionnel) : select `MUNDANE_ARMORS` (« — Libre — » par défaut) ; la sélection pré-remplit type/CA/FOR min/malus (tout surchargeable), idiome D2 du panneau Arme.
5. **Force min** : nombre ou vide + case **Malus de discrétion**.
6. **Aperçu** : chips — « 🛡 15 + DEX (cap ×2) » (symbolique côté MD : « + DEX » reste en lettres), `+2 ✨` si magique, « discrétion ⚠ » si coché. Côté joueur : rendu **chiffré** sur le personnage réel via `computeAC` (l'asymétrie armes reproduite).

**Suppression** : statu quo objets — le garde-fou « portée par X » complète le ConfirmButton existant quand l'armure est équipée (liste des porteurs, Modal de conséquences).

### S4 — Grimoire joueur : fusion des sorts custom

**Ce qui change (et rien d'autre)** :
- La requête catalogue de l'onglet Sorts passe `partyId` : les customs du groupe fusionnent dans `GET /spells` — **mêmes lignes, mêmes groupes de niveau, même filtre classes/école/niveau, même pagination**. Le filtrage par classes déclarées est celui du filtre existant (`classes_json`) ; « Toutes les classes » apparaît à toute fiche.
- **Badge « sort de la table »** : pilule or discrète en suffixe du nom (famille or, glyphe `spark`/✦ + libellé court) sur la ligne du grimoire ET la rangée du catalogue ; absent de la feuille d'incantation et de la prose (le lancé ne distingue pas).
- **Apprentissage, préparation, ordre, oubli** : boutons et gestes existants, zéro branchement nouveau (`POST /characters/:id/spells` identique). Les domaines always-prepared SRD ne concernent pas les customs (anti-but).
- **CastSpellSheet / upcast / concentration** : identiques — la table `damage_at_slot_level` du custom pilote l'aperçu d'upcast ; sans table mais avec prose `higher_level`, le drapeau textuel `scalesAtHigherLevel` s'affiche (contrat SRD #171).
- **Propagation** : sort retouché par le MD → la ligne suivante au prochain rendu (JOIN) ; l'événement `custom-spell` réveille l'onglet ouvert, `useResyncOnReconnect` rattrape le trou.
- **Interface EN** : le contenu FR s'affiche tel quel (repli champ par champ déjà codé).

**Anti-goal** : aucune section séparée, aucun tri spécial « customs d'abord » — l'ordre alphabétique/niveau existant les mélange.

### S5 — Bestiaire & rencontres MD

- **Recherche** (`AddMonsterModal`) : `GET /monsters?partyId=` mêle SRD + customs ; le custom porte la même pilule or ✦ « monstre de la table » dans la liste de résultats (suffixe du nom, discret). La mini-fiche de sélection (type · taille · CR) est inchangée — un custom s'y lit comme un SRD.
- **Ajout en rencontre** : flux IDENTIQUE — sélection, quantité ×N, case « Masquer le nom aux joueurs », groupe/initiative/PV roulés par la route existante (résolution par slug déjà générique). Aucun nouveau contrôle.
- **Bloc de stats** : `MonsterStatBlock` sert le custom tel quel (desktop colonne 340 px, mobile modal). Le titre du bloc porte la même pilule or (suffixe).
- **Masque** : inchangé — redaction serveur du nom ET du slug ; « Créature inconnue » côté joueurs, 🙈 sur le dénent MD.
- **Noms masqués / roster de rencontre** : fusion sans changement.

### S6 — Joueur : création d'armure & CA calculée

- **Déclencheur** : le CTA « Créer “Cuirasse du temple” » existant de `CatalogSearch` (déjà gated `canCreateItem = canEdit && (isGM || playersCreateItems)`) ouvre le modal de création ; la catégorie est pré-positionnée sur `armor` quand le joueur vient d'une recherche d'armure (le sélecteur reste libre). Le panneau `ArmorFields` s'insère à l'emplacement du panneau Arme, `previewCharacter={character}` — **aperçu chiffré**.
- **Après enregistrement** : l'objet atterrit dans le sac (toast + ajout direct, comportement armes), le catalogue s'invalide, le MD le voit apparaître dans l'onglet Objets personnalisés (`custom-item`).
- **Équipement** : la carte d'inventaire existante (chips calculées) montre la CA recalculée par `computeAC` lisant `armorFamily` explicite ; le breakdown de la tuile CA (Caractéristiques) affiche `base + DEX (cap ×2)` ; FOR min non respectée → **malus vitesse −3 m affiché** (orange, famille violation de règle), jamais appliqué en silence ; malus discrétion → indicateur existant de la fiche/compétences.
- **Toggle fermé** : le CTA n'apparaît pas (statu quo objets) — le joueur ne découvre jamais une porte close.

---

## 3. Inventaire des composants

### À réutiliser tels quels (fichiers réels)

| Composant | Fichier | Rôle dans la feature |
|---|---|---|
| `Modal`, `BottomSheet`, `Fab`, `ToastStack` | `components/ui.tsx` | formulaires MD/joueur, FAB listes non vides, toasts ciblés |
| `ConfirmButton`, `EmptyState`, `ErrorMsg`, `LoadingSpinner` | `components/ui.tsx` | suppression au point de tap, vides, erreurs |
| `Chip` (`tone` gold/orange…), `CategoryBadge`, `RarityBadge`, `WeightBadge`, `CostBadge` | `components/ui.tsx` | badges « de la table » (or), chips d'aperçu, pastilles de liste |
| `NumberField`, `TabButton`, `SkeletonCard`/`SkeletonRow`/`SkeletonRegion` | `components/ui.tsx` | mesures (CA, PV, caracs), onglets du pupitre, fantômes |
| `WeaponFields` (+ `EMPTY_*_DRAFT`, `*FromItem`, `*Payload`) | `components/WeaponFields.tsx` | **gabarit** des trois panneaux : draft dans le state hôte, payload conditionnelle, aperçu live symbolique/chiffré, validation orange double barrière |
| `MonsterStatBlock` | `components/MonsterStatBlock.tsx` | aperçu du formulaire MD + bloc du traqueur, sans retouche (hors pilule or du titre) |
| `AddMonsterModal` | `components/AddMonsterModal.tsx` | recherche bestiaire : ajouter `partyId` + pilule or |
| `CastSpellSheet`, `SpellProse`, `SpellDetailSheet` | `components/*.tsx` | lancé/upcast/concentration des customs — zéro retouche |
| `CatalogSearch` | `pages/character/CatalogSearch.tsx` | CTA création (déjà générique) — pré-sélection catégorie |
| `ItemImageField`, `ItemImageViewer` | `components/*.tsx` | illustration de l'armure (même séquencement upload) |
| `Glyph` | `components/Glyph.tsx` | `spark` (badge or), `shield`, `heart`, `edit`, `trash`, `concentration`… — AUCUN glyphe nouveau |
| `useSyncEvent`, `useResyncOnReconnect` | `sync.tsx` | réveils `custom-spell`/`custom-monster`, rattrapage |
| Motif localStorage #187 (`dnd-inv-spells-filter`) | `CharacterSpellsTab.tsx` | mémorisation des filtres des nouveaux onglets |

### À créer (nouveaux fichiers, tous calqués sur `WeaponFields.tsx`)

| Composant | Contenu |
|---|---|
| `components/ArmorFields.tsx` | panneau type/CA/base/bonus/FOR min/malus + aperçu (`ArmorDraft`, `EMPTY_ARMOR_DRAFT`, `armorDraftFromItem`, `armorDraftPayload` — miroir exact de l'API arme) |
| `components/SpellFields.tsx` | formulaire de sort structuré + aperçu fiche de sort |
| `components/MonsterFields.tsx` | statblock hybride + aperçu `MonsterStatBlock` |
| `pages/GmDashboardPage` extraits `CustomSpellsTab` / `CustomMonstersTab` | (ou fichiers frères `GmDashboardPage-spells.tsx`) topologie `CustomItemsTab` : liste, toggle absent (MD seul), verbes, garde-fous |
| Pilule or « de la table » (petit composant local ou variante de `Chip`) | badge partagé grimoire/bestiaire/bloc |

**Contrat attendu de l'API** (spécifié par le plan architecture) : `POST/PATCH/DELETE /api/parties/:id/spells` et `/monsters` (GM seul, TypeBox, messages FR), `GET /spells|/monsters` scopés par `partyId`, DELETE monstre 409 listant les rencontres vivantes, événements `party:change` `'custom-spell'`/`'custom-monster'` avec `actorUserId`, ETag seul sur les catalogues porteurs de customs (Q11).

---

## 4. Clés i18n nouvelles (paires obligatoires fr + en)

Préfixes existants prolongés : `md.*` (pupitre), `armure.*` (miroir de `arme.*`), `sortcustom.*`, `monstrecustom.*`, `sorts.*`/`bestiaire.*` (badges). Sélection structurante (les libellés d'aide suivent la même grille) :

| Clé | FR | EN |
|---|---|---|
| `md.sorts.custom` | Sorts custom | Custom spells |
| `md.monstres.custom` | Monstres custom | Custom monsters |
| `md.sorts.custom.n` | {count, plural, =0 {Sorts custom} one {Sorts custom (1)} other {Sorts custom (#)}} | … |
| `md.aucun.sort.custom` | Aucun sort personnalisé | No custom spells yet |
| `md.cree.des.sorts.non.srd` | Inscris les sorts de ta table — ils rejoignent le grimoire des classes autorisées | Write your table's spells — they join the spellbook of allowed classes |
| `md.connu.par.n` | Connu par {count, plural, one {# personnage} other {# personnages}} | Known by {count, plural, one {# character} other {# characters}} |
| `md.supprimer.sort.name` | Supprimer « {name} » ? | Delete “{name}”? |
| `md.sort.supprime.fiches` | Les fiches qui le connaissent perdront ce sort | Sheets knowing it will lose this spell |
| `md.aucun.monstre.custom` | Aucun monstre personnalisé | No custom monsters yet |
| `md.dresse.tes.monstres` | Dresse tes créatures — elles vivent dans le bestiaire du groupe | Stat out your creatures — they live in the party bestiary |
| `md.dans.rencontres.n` | Dans {count, plural, one {# rencontre} other {# rencontres}} | In {count} encounter(s) |
| `md.monstre.utilise.par` | Utilisé par : {encounters} | Used by: {encounters} |
| `md.monstre.suppression.bloquee` | Retire d'abord ce monstre des rencontres actives | Remove this monster from active encounters first |
| `md.edition.snapshot.aide` | Un combat en cours garde les PV et la CA déjà posés ; seul le bloc consultable change | An ongoing fight keeps the copied HP and AC; only the stat block changes |
| `armure.type` | Type d'armure | Armor type |
| `armure.type.light` / `.medium` / `.heavy` / `.shield` | Légère / Intermédiaire / Lourde / Bouclier | Light / Medium / Heavy / Shield |
| `armure.type.aide` | {type, select, light {Ajoute DEX sans cap} medium {Ajoute DEX, cap ×2} heavy {CA fixe · force min conseillée} shield {+2 · suivi à part, jamais cumulé}} | … |
| `armure.ca.base` | CA de base | Base AC |
| `armure.force.min` | Force minimale | Minimum Strength |
| `armure.malus.discretion` | Malus de discrétion | Stealth disadvantage |
| `armure.basee.sur` / `armure.basee.libre` | Basée sur / — Libre — | Based on / — Custom — |
| `armure.bonus.magique` | Bonus magique | Magic bonus |
| `armure.apercu` / `armure.apercu.vide` | Aperçu / Renseigne le type et la CA | Preview / Set type and AC first |
| `sortcustom.nouveau` | Nouveau sort personnalisé | New custom spell |
| `sortcustom.niveau` / `sortcustom.ecole` | Niveau / École | Level / School |
| `sortcustom.incantation` / `sortcustom.portee` / `sortcustom.duree` | Temps d'incantation / Portée / Durée | Casting time / Range / Duration |
| `sortcustom.composantes` / `sortcustom.materiel` | Composantes / Matériel | Components / Material |
| `sortcustom.concentration` / `sortcustom.rituel` | Concentration / Rituel | Concentration / Ritual |
| `sortcustom.classes` / `sortcustom.classes.toutes` | Classes autorisées / Toutes les classes | Allowed classes / All classes |
| `sortcustom.degats` / `sortcustom.degats.invalide` | Dégâts / Modèle de dés invalide | Damage / Invalid dice formula |
| `sortcustom.soins` / `sortcustom.soins.mod` | Soins / + mod. d'incantation | Healing / + casting mod |
| `sortcustom.dd` / `sortcustom.dd.effet` | Sauvegarde / Effet en cas de réussite | Save / Effect on success |
| `sortcustom.upcast` / `sortcustom.upcast.par.cran` | Incantation supérieure / +{dice} par cran | Upcast / +{dice} per level |
| `sortcustom.niveaux.superieurs` | Niveaux supérieurs | At higher levels |
| `sortcustom.conflit.srd` | Un sort du SRD porte déjà ce nom — le badge de la table les distingue | An SRD spell already has this name — the table badge tells them apart |
| `monstrecustom.nouveau` | Nouveau monstre personnalisé | New custom monster |
| `monstrecustom.ca` / `monstrecustom.pv` / `monstrecustom.des.de.vie` | CA / PV / Dés de vie | AC / HP / Hit dice |
| `monstrecustom.caracteristiques` | Caractéristiques | Ability scores |
| `monstrecustom.cr` / `monstrecustom.xp.derive` / `monstrecustom.bonus.derive` | Facteur de puissance / {xp} PX / bonus +{n} | Challenge rating / … |
| `monstrecustom.vitesses` / `monstrecustom.sens` / `monstrecustom.langues` | Vitesses / Sens / Langues | Speeds / Senses / Languages |
| `monstrecustom.resistances` / `monstrecustom.immunites` | Résistances / Immunités | Resistances / Immunities |
| `monstrecustom.trait.ajouter` / `monstrecustom.action.ajouter` | ＋ Trait / ＋ Action | + Trait / + Action |
| `sorts.de.la.table` | Sort de la table | Table spell |
| `bestiaire.monstre.de.la.table` | Monstre de la table | Table monster |
| `inv.armure.apercu.chiffre` | CA calculée : {ac} | Computed AC: {ac} |

---

## 5. Points d'attention a11y / mobile / iPad

- **44 px** : toutes les chips cliquables (types d'armure, propriétés, bonus, composantes, classes) en `min-h-11` comme les idiomes armes ; add/remove des lignes traits/actions ≥ 44 px ; verbes ✎/× des listes du pupitre déjà `min-w-11 min-h-11`.
- **Focus** : modales autofocus premier champ (dérogation lint documentée), focus trap + Échap + restore du `Modal` ; ordre de tabulation = ordre de lecture du formulaire.
- **aria** : labels `htmlFor`/`id` sur chaque champ (le lint l'exige) ; chips `aria-pressed` ; `aria-invalid` + `aria-describedby` vers le message d'erreur orange ; aria-labels français nommant l'action (« Supprimer le sort “X” », « Ajouter un trait », « Agrandir… ») ; pastilles or décoratives `aria-hidden` avec libellé complet en `title`/aria sur la ligne.
- **Confirmations** : toasts et annonces de succès en `aria-live="polite"` (idiome du grand livre de la bourse) ; l'état armé ConfirmButton reste rouge + `pulse-warn`.
- **iPad/tactile** : formulaires MD utilisables au doigt (cibles chips, pas de drag seul — réordonnancement des actions par boutons ↑/↓ si `SortableGrid` n'est pas adapté aux listes courtes) ; bottom sheets portaled ; pas d'hover-only (les info-bulles de chips existantes portent leur texte en `title`).
- **Clavier mobile (Android/iOS)** : le `Modal` du créateur redocke sous le clavier (`interactive-widget=resizes-content`) ; champs numériques en `inputMode` adapté via `NumberField`.
- **Reduced motion** : aucun mouvement nouveau — les entrées de liste suivent le rendu statique existant.

---

## 6. Décisions ouvertes restantes (avec reco)

Tout ce qui suit est un choix de **détail UX** laissé au brief d'implémentation — les décisions produit (Q1–Q11 du plan produit) sont tranchées.

- **Q1 — Ordre exact des champs du formulaire de sort.** Reco : l'ordre « fiche de sort SRD » retenu en §S1 (identité → incantation → classes → effet → upcast → texte) ; alternative : classes juste sous l'identité (le MD déclare d'abord « pour qui »). Trancher au moment du composant, sans effet sur l'API.
- **Q2 — Placement exact du badge « sort de la table ».** Reco : pilule or suffixe du nom sur la ligne de grimoire et la rangée catalogue, absente du CastSpellSheet ; alternative : badge devant le nom (plus visible, mais décale la lecture des noms alignés). Même question, même reco pour le monstre (bestiaire + titre du bloc).
- **Q3 — Saisie des 6 caractéristiques du monstre sur mobile.** Reco : grille 2×3 compacte de `NumberField` avec modificateur dérivé en mono sous chaque score ; alternative : 3×2 sur tablette uniquement. À trancher au premier rendu réel 390 px.
- **Q4 — Aperçu du sort/monstre dans le formulaire MD.** Reco : section Aperçu embarquée en pied de modal (fiche de sort / statblock en lecture) ; alternative : bascule Édition/Aperçu (idiome des notes du carnet) si le modal devient trop long sur mobile.
- **Q5 — Position des deux nouveaux onglets du pupitre.** Reco : grouper avec « Objets personnalisés » (… Objets · Sorts · Monstres · Joueurs …) ; le point d'insertion exact (avant ou après « Journal ») se juge à la mesure réelle de la barre sur 1024 px (8 pattes scrollables).
- **Q6 — Compteur d'usage dans les listes du pupitre.** Reco : « Connu par N » / « Dans N rencontre(s) » en méta d'encre sur chaque carte (chargé avec la liste) ; alternative : ne le révéler qu'au moment de la suppression (une requête de moins, mais le MD perd l'information en continu).

---

*Document de brief — aucune implémentation ici. Les gardes-fous d'implémentation (TypeBox, Drizzle, zéro SQL brut, changelog, e2e sur gabarit `custom-weapon.spec.ts`) vivent dans le plan produit §annexe et le plan architecture.*
