---
name: Table Sync
description: Le grimoire clair de la table — fiches, inventaire et traqueur de combat D&D 5e en français
colors:
  parchment: "#fdfaf3"
  parchment-raised: "#f7f0e1"
  parchment-line: "#ece0c4"
  parchment-deep: "#ddcb9e"
  ink: "#2a1f14"
  ink-strong: "#3a2b1c"
  ink-mid: "#5b4733"
  ink-soft: "#6b5640"
  ink-muted: "#7d6850"
  ink-faint: "#a8926f"
  blood: "#7a1f1f"
  blood-hover: "#651515"
  blood-mark: "#8b1a1a"
  blood-ring: "#c05151"
  gold: "#d4af37"
  gold-soft: "#e3c766"
  rule-good: "#22c55e"
  rule-mid: "#eab308"
  rule-low: "#ef4444"
  rule-critical: "#b91c1c"
typography:
  display:
    fontFamily: "Cinzel, Georgia, serif"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Iowan Old Style, Palatino, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
rounded:
  control: "12px"
  card: "16px"
  pill: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.blood}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.parchment-line}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-ghost:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.parchment-raised}"
  card:
    backgroundColor: "rgba(255, 255, 255, 0.85)"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System — Table Sync (apps/web)

## Overview

**Creative North Star: « Le grimoire clair »**

Le monde visuel de l'app : **parchemin, encre, sang, or** — un grimoire clair
(light-only, pas de dark mode), mobile-first, en français. Une page de
grimoire posée sur une table éclairée : le parchemin porte tout, l'encre
imprime le registre, et le sang — rare — marque l'instant qui se joue
maintenant. La lisibilité prime à chaque taille d'écran, du laptop du MD en
pièce tamisée au téléphone tenu à une main.

Les couleurs de règles (vert/jaune/orange/rouge des paliers d'encombrance et
des PV) enseignent l'état du personnage ; les teintes parchemin/encre portent
le registre. Une seule famille d'icônes : les glyphes emoji existants
(🛡 ❤ ⚔ 🎯), utilisés avec constance. Deux familles de surfaces : la carte
levée (`.card`) pour les panneaux de travail, et la surface réglée — entrées
posées à même le parchemin, séparées par des filets — pour les pages-listes
pleine largeur.

**Key Characteristics:**

- Mobile-first, tout en français, vocabulaire D&D 5e (FOR/DEX/CON, DD/CA/PV).
- Le sang porte « maintenant + action primaire » ; tout le reste est encre.
- Deux familles de surfaces seulement : carte levée ou surface réglée.
- Le mono est réservé aux valeurs mesurées ; le display Cinzel aux titres.
- Un moment signé de motion par surface, coupé sous `prefers-reduced-motion`.

## Colors

Quatre rampes sémantiques définies dans `src/index.css` (`@theme`) — le
parchemin porte les fonds, l'encre le texte, le sang l'action, l'or
l'accent. **Règle : n'utiliser une nuance (`ink-600`, `blood-50`…) que si
elle est définie dans `@theme`** — Tailwind v4 ne génère rien pour une
classe inconnue, l'erreur serait silencieuse.

### Primary

- **Sang** (#7a1f1f `blood-600`, survol #651515 `blood-700`): LE rouge
  d'action — boutons primaires, pilule « Tour N », ordinal de l'entrée
  courante, halo du tour. Sa rareté est sa force.
- **Marque de sang** (#8b1a1a `blood-500`, anneau #c05151 `blood-300`):
  l'ordinal de l'entrée courante du registre, les anneaux d'accent.

### Secondary

- **Or** (#d4af37 `gold-400`, clair #e3c766 `gold-300`): la magie et
  l'accent doré — chips ✨ d'arme magique, appel d'initiative dû. Jamais
  déco gratuite.

### Neutral

- **Parchemin** (#fdfaf3 `parchment-50`): fond de page, teinté de deux
  halos radiaux (or 6 % en haut, sang 4 % en bas).
- **Parchemin soulevé** (#f7f0e1 `parchment-100`): nappes de survol, fonds
  de pastilles.
- **Filet** (#ece0c4 `parchment-200`): séparateurs d'entrées, bordures de
  cartes et de badges.
- **Filet profond** (#ddcb9e `parchment-300`): bordures actives, règle de
  tête secondaire.
- **Encre** (#2a1f14 `ink-900`, #3a2b1c `ink-800`): texte courant et
  fort ; #5b4733 `ink-600`, #6b5640 `ink-500`, #7d6850 `ink-400`,
  #a8926f `ink-300` déclinent en méta, hint, imprimé discret.

### Rule Colors (hors `@theme`, palette Tailwind standard)

`green/yellow/orange/red` portent les paliers de règle — encombrance,
PV, conditions. Chaque teinte porte un sens de règle : ne pas les
réutiliser comme décoration. Paliers PV : ≤ 0 `red-700`, ≤ 25 %
`red-500`, ≤ 50 % `yellow-500`, sinon `green-500`.

### Named Rules

**La règle du sang.** Le sang porte « maintenant + action primaire »
uniquement — détent courant, pilule Tour, boutons primaires, l'unique porte
sang de chaque page. Tous les autres états sont des marques imprimées
en encre.

**La règle d'une seule porte.** UN seul élément sang par page : l'action
primaire du moment. Les autres portes restent encre (flèche `ink-300` →
`blood-600` au survol au plus).

## Typography

**Display Font:** Cinzel (fallback Georgia, serif) — titres, ordinaux
romains, noms porteurs d'identité.
**Body Font:** Iowan Old Style (fallback Palatino, Georgia, serif) — le
texte.
**Label/System Font:** Inter (fallback system-ui, sans-serif) — filet de
sécurité système.
**Mono:** réservé aux valeurs mesurées.

**Character:** L'estampe d'un grimoire imprimé — la capitale gravure de
Cinzel titre la page, l'Old Style lit comme un livre, et le mono mesure
comme un instrument.

### Hierarchy

- **Display** (Cinzel 700, `text-2xl`/`sm:text-3xl`, `leading-tight`):
  titre de page centré, nom de rencontre, nom du combattant à la scène.
- **Section title** (Cinzel 600, `text-lg` — `.section-title`): LE style
  de titre de section, sur tout `h2` de carte ou de feuille.
- **Titre d'entrée** (Cinzel 600, `text-lg`→`text-2xl` selon le cycle de
  vie): noms du registre.
- **Body** (Iowan 400, 1rem/1.5): le texte ; méta et hints en
  `text-sm text-ink-400/500`.
- **Label** (medium, `text-sm` — `.label`): libellés de champs.
- **Mono** (`font-mono`): PV, CA, initiative, durées, codes d'invitation,
  `J−N` — la mesure, jamais la déco.

### Named Rules

**La règle du mono mesuré.** Le mono est réservé aux valeurs mesurées
(PV, CA, initiative, durées, codes). Un mono décoratif est un faux
instrument.

## Layout

Mobile-first : le dock flottant (Survie · Caract. · hub adaptatif par
classe) porte la navigation fiche ; ≥ `lg` (1024 px) reprend la barre
d'onglets desktop (mesurée, débord replié derrière « ⋯ Plus ») et l'en-tête
sticky `h-14` (`var(--app-header-h)`) avec son slot `#header-combat-slot`.
Cibles tactiles ≥ 44 px partout ; ornements décoratifs `aria-hidden`.

- **Conteneurs** : pages-listes pleine largeur en `max-w-3xl` ; fiche en
  `max-w-6xl` ; le théâtre du combat en grille 3 colonnes
  `lg:grid-cols-[15rem_minmax(0,1fr)_340px]` (échelle | scène | bloc).
- **Sur-tête** : la double règle de tête (`border-t-2 parchment-400` + à
  3 px `border-t parchment-300`) ferme chaque tête de page centrée.
- **Éléments ancrés au bas** (dock, hub, scrim) portent `.vv-anchor` —
  parade iOS standalone au clavier (`--vv-shift`) ; tout nouveau UI mobile
  ancré au bas doit porter la classe.
- **Overlays** : bottom sheets portaled sur `document.body` — le
  `backdrop-blur` de `.card` crée un containing block qui casse
  `position: fixed` dedans.
- **Hooks avant gardes de rendu** : anywhere with early returns, les hooks
  conditionnels comptés par React passent AU-DESSUS des guards.

## Elevation & Depth

Deux profondeurs, jamais trois. La surface réglée est plate — des entrées
posées à même le parchemin, séparées par des filets 1 px. La carte levée
`.card` est l'unique relief : blanc 85 %, bordure `parchment-200`, ombre
réelle douce. PAS de `backdrop-blur` sur `.card` (des dizaines de
backdrop-filter capturaient le scroll sur vieille tablette) — les overlays
(Modal, BottomSheet) gardent le leur.

### Shadow Vocabulary

- **Carte au repos** (`.card`): `0 1px 2px rgba(42,31,20,0.04), 0 4px 12px
  rgba(42,31,20,0.03)` — offset + flou réel, jamais un halo à offset nul.
- **Carte en drag** (`.card-dragging`): `0 4px 8px rgba(42,31,20,0.08),
  0 14px 32px rgba(42,31,20,0.14)` + `scale(1.01)` — le lift EST le
  moment ; rien d'autre ne bouge.
- **Halo du tour** (`.combat-turn-glow`): anneau intérieur + halo
  extérieur sang pulsé 1,8 s — le seul halo coloré du système, réservé à
  « c'est ton tour ».

### Named Rules

**La règle des deux surfaces.** La carte levée pour les panneaux de
travail, la surface réglée pour les registres. Pas de troisième surface,
pas de carte dans la carte.

## Shapes

Le rayon suit le rang : cartes `16px` (`rounded-2xl`), contrôles et
champs `12px` (`rounded-xl`), pilules pleines (`9999px`) pour les petites
pastilles d'état (Tour N, Init, compteurs de conditions). Les bordures
sont des filets `1px parchment-200`, l'accent rarement `parchment-300`.
La géométrie signature : la double règle de tête, le filet qui court
jusqu'au bord, la nappe de survol déborder en négatif (`-mx-3 px-3`) sans
toucher aux filets.

## Components

Les contrôles parlent fort mais court : sang pour l'action primaire, encre
pour le reste, chaque verbe à taille de combat (≥ 44 px). Composants dans
`src/components/ui.tsx`.

| Composant | Usage | Points clés |
|---|---|---|
| `Modal` | dialogues centrés (desktop) | focus trap, Échap, restore le focus |
| `BottomSheet` | feuilles mobiles portaled | `size` (md/lg), `mobileOnly`, `footer`, `bodyClassName` ; Échap + scroll lock |
| `Fab` | bouton d'action flottant `+` | `mobileOnly`, `raised` (au-dessus du dock) |
| `HpBar` | barre de PV partout (fiche, combat, forme animale) | paliers unifiés : ≤0 `red-700`, ≤25 % `red-500`, ≤50 % `yellow-500`, sinon `green-500` ; `temp` = PV temporaires en segment `blue-500` au-delà du remplissage + aria « +N temporaires » ; `size` xs/sm/md, `showText`, `trackClassName` ; `role="progressbar"` |
| `Chip` | pastille de stat (attaque 🎯, dégâts ⚔, DD 🛡, ×N, +magique ✨) | `tone` (orange/red/blood/blue/amber/gold/indigo), `soft`, `title` = info-bulle de décomposition |
| `EncumbranceBar` | portage et paliers | affiche conséquences de règle au moment où elles s'appliquent ; `compact` = variante une-ligne du bandeau |
| `CharacterStateBand` | bandeau d'état de la fiche joueur | rail réglé épinglé + jumeau fixe compact au défilement (`band-drop`) ; le flux ne change jamais de hauteur |
| `CombatWidget` | bande de combat d'en-tête (lg+, fiche du joueur uniquement) | pilule portaled dans `#header-combat-slot` ; `.combat-strip` scope les tailles compactes (les `.btn-*` hors couches écrasent les utilitaires) |
| `ConfirmButton` | suppression en deux temps — LE motif des suppressions de contenu | arme le contrôle **sur place** (rouge + `pulse-warn`), 4 s puis retombe, Échap/blur désarment |
| `TabButton` | onglets internes des pages-outil | souligné sang sur l'actif, encre au repos |
| `ToastStack` / `Toast` | retours d'action | bas d'écran, `aria-live` |
| `RarityBadge` `CategoryBadge` `WeightBadge` `CostBadge` | métadonnées d'objet | rareté teintée (`rarity-*`), jamais grise |
| `EmptyState` `LoadingSpinner` `ErrorMsg` | états de page | libellés français (« Ouverture du registre… ») |

**Échelle de confirmation** — toute suppression se confirme au point de
tap, jamais ailleurs dans la carte : `ConfirmButton` arme le contrôle
lui-même ; les lignes d'inventaire et l'oubli de sort remplacent la ligne
sur place ; le `Modal` avec texte de conséquences est réservé aux entités
entières dont la suppression est en cascade. État armé = rouge +
`pulse-warn`, partout la même signature.

### Buttons

- **Primary** (`btn-primary`): sang plein (#7a1f1f → #651515 au survol),
  blanc, `12px`, `10px 16px`, `active:scale-[0.98]`, désactivé 50 %.
- **Secondary** (`btn-secondary`): `parchment-200` → `parchment-300` au
  survol, encre.
- **Ghost** (`btn-ghost`): transparent, encre douce, nappe
  `parchment-100` au survol — le verbe discret des pieds et têtes de
  registres.
- **Repos** (`btn-rest-short`/`btn-rest-long`): membres teintés du
  système (indigo = court, violet = long), l'exception documentée.

### Inputs

- **Champ** (`.input`): blanc, filet `parchment-300`, `12px`, focus =
  anneau `blood-500/30` + filet sang ; `.input-compact` pour les mesures
  serrées ; champs numériques = `NumberField` (jamais de clamp manuel).
- **Label** (`.label`): `text-sm medium encre-700`, associé par
  `htmlFor`/`id` (exigé par le lint).

## Do's and Don'ts

### Do:

- **Do** ajouter toute nouvelle nuance à la rampe `@theme` correspondante,
  en respectant l'ordre de luminosité.
- **Do** titrer toute nouvelle section avec `.section-title` (+ classes
  utilitaires si besoin).
- **Do** créer toute nouvelle pastille de stat avec `Chip` et un `tone`
  existant ; un nouveau `tone` seulement si le sens est réellement
  distinct.
- **Do** poser tout overlay plein écran via `Modal` ou `BottomSheet`,
  jamais un `fixed inset-0` manuel.
- **Do** construire toute nouvelle page-liste pleine largeur sur la
  surface réglée (double règle de tête + entrées réglées) — `.card`
  reste l'outil des panneaux de travail.
- **Do** donner à tout `<button>` un `type` explicite et à tout label un
  `htmlFor`/`id` (exigé par le lint).
- **Do** couper tout mouvement sous `prefers-reduced-motion`, avec un
  état statique lisible quand le mouvement porte l'information.

### Don't:

- **Don't** créer une nouvelle barre de PV : `HpBar` (`size`,
  `showText`, `trackClassName`) couvre les cas.
- **Don't** inventer un second système d'icônes : les glyphes emoji
  existants (🛡 ❤ ⚔ 🎯), avec constance.
- **Don't** réutiliser les couleurs de règle (vert/jaune/orange/rouge)
  comme décoration — chaque teinte porte un sens.
- **Don't** poser un second élément sang sur une page, ni teinter un
  état statique en sang : le sang est « maintenant + action primaire ».
- **Don't** mettre du mono ailleurs que sur une valeur mesurée.
- **Don't** add dark mode, un second monde visuel, ou un habillage de
  campagne : l'outil D&D est générique, le monde est parchemin/encre/sang/or.

## Surfaces réglées — le registre & la table des matières

Alternative légitime à `.card` sur les pages-liste pleine largeur : pas de
fond, pas d'ombre, pas de grille de cartes — les entrées sont posées à même
le parchemin et séparées par des filets. C'est le dialecte du registre des
groupes (« Mes groupes »).

| Dispositif | Recette |
|---|---|
| Tête de page | titre `font-display` centré (`text-2xl` / `sm:text-3xl`) au-dessus de la double règle |
| Double règle de tête | `border-t-2` `parchment-400`, puis à 3 px d'écart `border-t` `parchment-300` ; divs `aria-hidden` |
| Entrées | `ol list-none`, chaque `li` refermé par `border-b` `parchment-200` |
| Ordinaux romains | colonne `w-10` alignée à droite en `font-display` (Cinzel), `aria-hidden` ; `blood-500` `text-2xl` sur l'entrée courante, `ink-400` `text-lg` sur les compactes |
| Entrée courante (la plus récente) | nom `text-2xl`, méta `MD : X · N joueurs · N personnages · depuis {mois abrégé fr-FR} {année}`, roster des personnages **actifs** rejoint par « · » sous un filet interne `parchment-200` — les cachés (préparation secrète) restent hors registre pour tous : le volume (table des matières) les porte, avec leur pastille |
| Tampon du MD | hors du lien : chip `<code>` mono sur `parchment-100` bordée `parchment-200` (`tracking-[0.2em]`) + bouton copier à retour inline « Copié ✓ » / « Copie impossible » |
| Entrées compactes | ordinaux `ink-400`, `truncate` sur nom et méta, code MD en `code` mono inline |
| Survol | un seul `Link` par entrée (aria-label « Ouvrir le groupe X ») ; nappe `-mx-3 px-3 rounded-lg` en `parchment-100/70` — le débord négatif étend la nappe au-delà de la mesure sans toucher aux filets |

Page vierge : même tête + double règle, deux chemins d'entrée inline séparés
par des filets (`divide-y` / `sm:divide-x` `parchment-300` — aucune carte,
aucun remplissage), règle de clôture `parchment-200`. Dès qu'une entrée
existe, créer/rejoindre passent en actions fantômes au pied du registre
(`btn-ghost` + séparateur « · ») ouvrant le `Modal` standard ; les mêmes
formulaires servent les deux états. Les états parlent français : chargement
« Ouverture du registre… », échec = `ErrorMsg` + « Réessayer », erreurs API
(chaînes machines anglaises) retraduites par statut HTTP.

La table des matières (`PartyPage.tsx`, la page d'un groupe) est la seconde
page réglée — même grammaire, autre page du même monde : le registre énumère
les volumes, la table des matières ouvre le volume choisi. L'ordre de lecture
EST la hiérarchie : I Ton personnage, II La table, III Outils & annexes.

| Dispositif | Recette |
|---|---|
| Tête de volume | nom du groupe `font-display` centré (`text-2xl` / `sm:text-3xl`), méta « N joueurs · N personnages · mode » ; même double règle de tête, mesure unique `max-w-3xl` |
| En-têtes de section | numéral romain Cinzel `ink-300` (`w-8` aligné à droite, aria-hidden) + `.section-title` + filet `parchment-200` courant jusqu'au bord |
| Points de conduite | `DotLeader` : filet pointillé `parchment-300` entre un libellé et sa valeur de queue (outils, code d'invitation) — réservé aux lignes d'annexes, jamais au corps des entrées |
| La porte sang | UN seul élément sang par page : ici « Ouvrir → » `blood-600` + anneau `blood-300` du médaillon sur SES personnages ; les portes du MD vers les autres fiches restent encre (flèche `ink-300` → `blood-600` au survol) ; fiches des autres joueurs SANS lien, 🔒 `ink-300` en queue avec title explicatif |
| Médaillon | portrait rond ou initiale Cinzel sur `parchment-100`, anneau 2 px — `blood-300` = ton siège, `parchment-300` sinon ; 56 px (`h-14`, portes de section I), 40 px (`h-10`, roster de section II) |
| Roster | un membre par ligne : nom + @pseudo + tampon `MD` (`blood-600` blanc) / `Joueur` (`parchment-200` / `ink-700`) ; sous chaque membre, ses personnages en médaillon 40 px + nom sur méta (verrouillé 🔒 pour les joueurs, porte encre pour le MD) ; « sans personnage » en italique `ink-400`. **Actifs d'abord** — un personnage caché (préparation secrète) descend sous les actifs et porte la pastille « Caché » (`bg-ink-100` `text-ink-600`, title explicatif) pour le MD comme pour son propriétaire (sections I et II) |
| Annexes | lignes réglées à glyphe d'outil (🛡 ⚔ 🎭) + libellé `ink-800` + points de conduite + pastille flèche : mini-médaillon `border-parchment-300` 32 px, flèche `ink-500` → `blood-600` au survol — l'affordance existe au repos, pas seulement au survol ; ligne code (MD) : `code` mono `tracking-[0.2em]` + bouton copier en pastille bordée, état « Copié ✓ » passe bord et texte en sang |

Le registre des rencontres (`CombatPage.tsx`, état liste) est la troisième
page réglée — la hiérarchie de cycle de vie remplace la hiérarchie de
fraîcheur du registre des groupes.

| Dispositif | Recette |
|---|---|
| Tête de page | « Rencontres » `font-display` centré + double règle ; méta « N rencontres au registre — N combat(s) en cours » |
| Entrée courante (combat en cours) | `py-6`, ordinal `blood-500` `text-2xl`, nom `text-2xl`, pilier « Tour N » `blood-600` mono, méta « 🔴 En cours · N combattants », roster sous filet interne comme l'entrée courante du registre des groupes |
| Entrées préparées | `py-4`, ordinal `ink-400` `text-lg`, nom `text-lg`, méta « ⚪ Préparation · N combattants », roster inline `truncate` `text-sm` `ink-500` |
| Entrées terminées (compactes) | `py-3`, ordinal `ink-300` `text-base`, nom `text-base`, méta « ⚫ Terminée · tour N · créée {mois année} » (`formatCreated`, jamais « depuis ») ; PAS de roster |
| Roster | payload `EncounterSummary.roster` (API) : personnages d'abord, groupes de monstres agrégés « Nom ×N », joints par « · » |
| Tête (MD) | action fantôme « ＋ Nouvelle rencontre » sous la méta, au-dessus de la double règle — visible au chargement quelle que soit la longueur du registre, l'entrée courante reste la première ligne — ouvrant le `Modal` standard ; page vierge (MD) : chemin de création inline sous la double règle, joueur : `EmptyState` |

## Le théâtre du tour — la page Combat (`CombatPage.tsx`, état rencontre)

La scène et l'échelle : le tour en cours possède le centre, tout le champ
reste visible d'un seul regard. C'est un panneau de travail — `.card` légitime
— mais sa discipline est celle du monde : **le sang porte « maintenant +
action primaire » uniquement** (détent courant, pilier Tour, boutons
primaires) ; tous les autres états sont des marques imprimées.

| Dispositif | Recette |
|---|---|
| L'échelle d'initiative | `nav` « Ordre d'initiative » : un détent par combattant sur DEUX rangées — rangée de nom pleine largeur (numéro d'initiative mono `w-5`, marque de couleur en pastille 8 px, nom, compte de conditions en pastille orange titrée) puis `HpBar` xs dessous sur toute la largeur ; **le nom est la clé du détent, il ne cède qu'en dernier** : mobile = détent à la mesure du nom (`min-w-24 max-w-44`, une ligne, ellipse réservée aux noms de 25+ caractères — le nom entier vit dans l'aria-label et le titre de scène), desktop = colonne pleine (15 rem, ~27 caractères). Bandeau horizontal défilant épinglé `top-2` sur mobile, colonne `sticky top-3` sur desktop ; cibles ≥ 52 px |
| États du détent | courant (le groupe entier) = rempli `blood-600` texte `parchment-50` + `aria-current="true"` ; focalisé hors-tour = bordure `ink-500` sur `parchment-100` ; vaincu = nom barré + 💀 + `opacity-55` ; initiative non lancée = « — » `ink-300` |
| La scène | `article` `.card` : pilier d'état (Tour N `blood-600` mono / ⚪ Préparation / ⚫ Terminée / « Hors tour » `parchment-200`), nom `font-display` `text-2xl/3xl` (porte vers la fiche si PJ), badges Init + 🛡 CA (mono sur `parchment-100` bordé), `HpBar` md `showText` comme plus grande mesure ; monstre vu par un joueur (PV masqués) : **état apparent** — pastille de teinte (vert/jaune/orange/rouge, palier serveur jitteré) + phrase vague choisie par monstre (« En pleine forme », « Blessé », « À l'agonie »…), jamais de jauge ; combatant d'un autre joueur : rien ; conditions en pastilles orange avec durées mono |
| Strip de groupe | les membres d'un groupe en pastilles (nom + PV mono) : tape = met ce membre à la scène ; puce armée = applique les dégâts |
| Masque de nom (MD) | monstre masqué : pastille **dans le titre** `h2` (elle touche ce qu'elle cache) — repos `👁 Masquer` encre discrète (bord `parchment-300`, `text-ink-400`), masqué `🙈 Masqué` en pastille encre (`bg-ink-100` `text-ink-600`, l'idiome « Caché » du registre), tape = bascule (`aria-pressed`), le texte long vit dans title/aria ; emoji 🙈 10 px sur le détent de l'échelle (MD seulement) ; révélation à l'ajout : case « Masquer le nom aux joueurs » du modal (idiome case du modal PJ) ; côté joueur le nom ne quitte JAMAIS le serveur — l'API sert « Créature inconnue » (constant shared) au groupe entier, qui fusionne dans le roster |
| Verbes du MD | grille 2/4 colonnes, py-3 (≥ 44 px) : ⚔ Dégâts (BottomSheet dégâts/résist/soins/PV direct), ✎ Cond. (ConditionsEditor), 📜 Stats (monstre), 🎨 Marque (BottomSheet de pastilles nommées en français) ; Retirer / Retirer le groupe en `ConfirmButton` |
| Pied de scène | ▶ Tour suivant (primaire), ⏹ Fin, + Monstre, + PJ, « Puis : X (×N) » à droite en `ink-400` |
| Banc de préparation | statut setup : barre d'assemblage (pilier ⚪/✅, 🎲 Tout lancer — un lancer par groupe, + Monstre, + PJ, ▶ Démarrer le combat bloqué tant qu'une initiative manque) ; saisie d'initiative sur la scène (MD : n'importe qui ; joueur : la sienne) ; banc vide = la scène porte le nom de la rencontre + pilier + `EmptyState` |
| Puce de dégâts | dock `role="status"` au-dessus de la scène : puce ⚔ N dégâts + source, ½ (aria-pressed), ✕, Échap ; armée → `ring-blood-400` + `combat-target` sur les détent et pastilles ; les lancer de dés du bloc de stats amarré alimentent la puce |
| Bloc de stats | desktop : colonne droite 340 px `sticky` (panneau amarré) ; mobile : modal ; jamais reporté d'une rencontre à l'autre |
| Disposition | desktop `lg:grid-cols-[15rem_minmax(0,1fr)_340px]` (échelle \| scène \| bloc) ; mobile : échelle horizontale puis scène |

## Le carnet du MD — la page du même nom (`DmNotebookPage.tsx`, `/party/:id/carnet`)

La quatrième page réglée, entièrement GM-only : derrière une porte d'annexes
que les joueurs ne voient pas, chaque contenu parle son dialecte natif —
le sang porte « maintenant + action primaire » (le « +1 jour », l'ordinal de
la quête courante), tout le reste est encre.

| Dispositif | Recette |
|---|---|
| La porte | ligne réglée 📓 « Carnet du MD » dans les annexes du groupe, points de conduite + **valeur de queue** « Jour 13 · 1 quête en cours » en mono (`TocLink`'s `queue` — l'idiome du code d'invitation étendu aux valeurs mesurées), rafraîchie en direct sur `campaign:change` ; invisible aux joueurs, qui voient l'état calme « réservé au MD » s'ils forcent l'URL |
| Tête de page | titre `font-display` centré + double règle (grammaire des pages-outil), méta « Jour N · saison — X quête(s) en cours » |
| Onglets internes | barre `TabButton` (souligné sang), dérivée de `?tab=`, comptes entre parenthèses ; le panneau change par `sheet-tab-swap` (clé React sur l'onglet — un mouvement par changement, jamais au rafraîchissement) |
| Onglet Calendrier | carte de travail `.card` : le jour en **grande figure** Cinzel (bouton tapable → édition inline = correction SANS archivage), « Semaine ⌈jour/7⌉ · saison » (select invisible au repos), **« +1 jour » = l'unique porte sang**, optimiste (figure + registre avancent avant le POST) ; météo = texte libre + 5 préréglages emoji (☀️🌧️🌩️❄️🌫️, police emoji forcée `.emoji-glyph`) ; **note du jour** = texte libre sous la météo, figée au registre quand le jour s'achève ; **comptes à rebours = lignes d'annexe à points de conduite** — libellé, filet pointillé, valeur `J−N` en mono (échu = « Dépassé de N j » `ink-400`, aujourd'hui = `ink-900`), ✎ édition inline, ConfirmButton × ; « Jours passés » = registre compact inversé (`Jour 12 · ⛈️ Orage` + journal en seconde ligne), retouchable inline (✎, griller météo et note retire la ligne), seuls les jours AVEC météo ou note y entrent |
| Onglet Quêtes | registre à cycle de vie, **jumelle du registre des rencontres** : en cours = ordinal `blood-500` `text-2xl` + titre `text-2xl` ; préparation = ordinaux `ink-400` ; terminées/échouées = compactes `ink-300` avec méta date (⚫ partagé, le texte distingue) ; entrée dépliable (chevron ▼) → corps markdown + pastilles de statut (chips `aria-pressed`, courante = `bg-ink-800` remplie — l'encre, le sang est pris) + verbes ✎/Confirmer ; page vierge = chemin de création inline sous l'état vide, sinon ghost « ＋ Nouvelle quête » + Modal |
| Onglet Notes | cartes `.card` triables (`SortableGrid`) + modal Édition/Aperçu + recherche — la grammaire des notes de fiche, `renderMarkdown` partagé (`components/markdown.ts`) |
| Onglet PNJ | la page PNJ existante incrustée (`NpcPage embedded`) — les secrets y arrivent au MD (verrou serveur : GM seul lit ET écrit `secret`) |

## La bourse et son changeur (`CoinPurse.tsx` / `CoinTransactionModal.tsx`, onglet Inventaire)

La bourse est une carte repliable de l'inventaire dont la grammaire est celle
des valeurs mesurées : **les figures reposent, les transactions passent par
le changeur**. La carte ne propose plus d'édition inline — le modal est
l'unique surface de gestion, et le moteur de rendu de monnaie vit dans le
partagé (`spendCoins`, casse minimale : pièces exactes d'abord, puis la plus
petite pièce suffisante est cassée en cascade PC→PA→PO→PP, l'électrum hors de
la chaîne décimale).

| Dispositif | Recette |
|---|---|
| En-tête de carte | bouton « Bourse (31 PO 5 PC) » — total PO + reliquat PC, inchangé depuis toujours (e2e y ancre l'attente) |
| Figures au repos | déplié : 5 tuiles `grid-cols-2 sm:grid-cols-5` — pastille de métal colorée (cuivre #b87333, argent #c0c0c0, électrum #a89968, or #d4af37, platine #e5e4e2) + libellé `.label`, valeur en `font-mono text-xl` encre ; spectateur (lecture seule) : figures seules, aucune porte |
| Les portes | deux `btn-secondary` « ＋ Encaisser » / « − Dépenser » — le verbe est présélectionné à l'ouverture du modal |
| Le modal du changeur | `Modal` standard (feuille mobile) : fieldset de 3 chips `aria-pressed` (＋ Encaisser / − Dépenser / ✎ Corriger, active = `bg-ink-800` remplie — l'encre, le sang est pris), 5 lignes pastille + stepper − [`NumberField` mono] + (cibles 44 px) |
| Le grand livre | sous filet `parchment-200`, `aria-live="polite"` : « Bourse » (valeur réelle, encre claire) → « Après » (`font-mono font-semibold`) — **la bourse réelle détenue, jamais une conversion canonique** (32 PO · 5 PA, pas « 3 PP ») ; « Il manque X » (PO→PA→PC, jamais PE/PP) verrouille le CTA sans crier ; « Monnaie rendue — 1 PO cassée en 10 PA » en `text-xs ink-500`, encre imprimée |
| Le CTA | `btn-primary` portant le verbe ET le montant (« Dépenser 5 PA », montant mono dans le libellé) ; « Corriger » édite la bourse telle quelle (draft pré-rempli, l'ancienne édition inline) et **reste verrouillé tant que le draft ne diffère pas de la bourse** — une correction identique n'est pas une opération |
| Persistance | un seul PATCH plein-purse (`action: 'coins'` en WS), toast « Bourse mise à jour » ; l'API clampe les 5 pièces en entiers ≥ 0 (400 sur non-numérique) |

## Motion

Une seule courbe de sortie : `cubic-bezier(0.16, 1, 0.3, 1)`. Entrées courtes
(0.2–0.45 s), un moment signé par surface (dock, sword-cut de tour,
sheet-up, sheet-rise, register-rise, stage-swap). Le registre arrive par `.register-rise` :
montée de 12 px + fondu, 0.35 s, remplissage `backwards`, stagger inline plafonné
(≤ 5 blocs × 60 ms) — les entrées se posent sous la règle de tête l'une après
l'autre, puis plus rien ne bouge. Le théâtre du tour change de combattant par
`.stage-swap` : montée de 8 px + fondu, 0.25 s, clé React sur le combattant
focalisé — un seul moment par tour, rien d'autre ne bouge dans le combat.
La fiche de personnage s'ouvre par `.sheet-rise` : le bandeau d'état monte de
12 px + fondu (0.35 s) et la barre d'onglets desktop se pose 60 ms derrière
lui — l'appareil d'identité d'abord, le contenu ensuite ; changer d'onglet
fait monter le panneau par `.sheet-tab-swap` (8 px, 0.25 s, clé React sur
l'onglet actif — un mouvement par changement, jamais au rafraîchissement des
données).
Sur la fiche, la ligne Agir (ou l'appel
d'initiative) monte par `.band-rise` (6 px + fondu, 0.2 s) à l'instant où le
tour devient tien ; le jumeau épinglé descend par `.band-drop` (−8 px, 0.2 s,
transform seul — jamais de changement de hauteur dans le flux au défilement).
Tout est coupé sous
`prefers-reduced-motion: reduce`, avec un état statique lisible quand le
mouvement porte l'information (anneau « à toi de jouer » sans animation).

## Accessibilité

Cibles tactiles ≥ 44px, focus visible, `aria-label` français nommant l'action
(« Retirer Aldric du combat », pas « supprimer »). Les ornements purement
décoratifs — filets du registre, ordinaux romains — sont `aria-hidden`.
Barres = `progressbar`
avec `aria-valuetext` en français (« 8/20 PV », « 0.0 kg sur 120 kg »).
Dialogues = `role="dialog"` + `aria-modal` + Échap.
