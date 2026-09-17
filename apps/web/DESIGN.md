---
name: Table Sync
description: Le grimoire clair de la table — fiches, inventaire et traqueur de combat D&D 5e en français
colors:
  parchment: "#fdfaf3"
  parchment-raised: "#f7f0e1"
  parchment-line: "#ece0c4"
  parchment-deep: "#ddcb9e"
  parchment-400: "#c9b074"
  ink: "#2a1f14"
  ink-strong: "#3a2b1c"
  ink-700: "#4a3825"
  ink-mid: "#5b4733"
  ink-soft: "#6b5640"
  ink-muted: "#7d6850"
  ink-faint: "#a8926f"
  ink-100: "#e9e1d4"
  blood: "#7a1f1f"
  blood-hover: "#651515"
  blood-mark: "#8b1a1a"
  blood-ring: "#c05151"
  blood-50: "#faf0f0"
  blood-100: "#f0d4d4"
  blood-200: "#dda3a3"
  blood-400: "#a92424"
  blood-800: "#541212"
  blood-900: "#470d0d"
  gold: "#d4af37"
  gold-soft: "#e3c766"
  gold-100: "#f6ecd2"
  gold-500: "#b8975a"
  gold-600: "#9a7c48"
  gold-700: "#7e6439"
  rule-good: "#22c55e"
  rule-mid: "#eab308"
  rule-low: "#ef4444"
  rule-critical: "#b91c1c"
typography:
  sans:
    fontFamily: "Inter, system-ui, sans-serif"
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
- **Or pâle** (#c9b074 `parchment-400`): le trait fort de la double règle
  de tête et du liseré du splash.
- **Encre** (#2a1f14 `ink-900`, #3a2b1c `ink-800`): texte courant et
  fort ; #4a3825 `ink-700` (libellés `.label`, idiomme « Joueur »),
  #5b4733 `ink-600`, #6b5640 `ink-500`, #7d6850 `ink-400`,
  #a8926f `ink-300` déclinent en méta, hint, imprimé discret ; le lavis
  clair #e9e1d4 `ink-100` porte les pastilles « Caché / Masqué » et les
  chips armées (l'encre, quand le sang est pris).

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
- **Micro-étiquette** (`text-[10px]`/`text-[11px]`, souvent semibold
  `uppercase tracking-wide`, encre 300–500): surets, overlines et
  métadonnées serrées — crochets de sorts, « À terre », horodatages de
  chronique, queues de registres. Plus petit que le texte jamais lu en
  continu ; ~75 usages, volontairement hors classes utilitaires nommées.
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
  extérieur sang au battement d'un cœur (lub-dub, 1,5 s — l'OPACITÉ seule
  s'anime, le box-shadow est statique) — le seul halo coloré du système,
  réservé à « c'est ton tour ».

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
| `Fab` | bouton d'action flottant `+` | `mobileOnly`, `raised` (au-dessus du dock), `dataTuto` (cible de la visite guidée) |
| `HpBar` | barre de PV partout (fiche, combat, forme animale) | paliers unifiés : ≤0 `red-700`, ≤25 % `red-500`, ≤50 % `yellow-500`, sinon `green-500` ; `temp` = PV temporaires en segment `blue-500` au-delà du remplissage + aria « +N temporaires » ; `size` xs/sm/md, `showText`, `trackClassName` ; `role="progressbar"` |
| `Chip` | pastille de stat (attaque 🎯, dégâts ⚔, DD 🛡, ×N, +magique ✨) | `tone` (orange/red/blood/green/blue/amber/gold/indigo), `soft`, `title` = info-bulle de décomposition |
| `EncumbranceBar` | portage et paliers | affiche conséquences de règle au moment où elles s'appliquent ; `compact` = variante une-ligne du bandeau |
| `CharacterStateBand` | bandeau d'état de la fiche joueur | rail réglé épinglé + jumeau fixe compact au défilement (`band-drop`) ; le flux ne change jamais de hauteur |
| `CombatWidget` | bande de combat d'en-tête (lg+, fiche du joueur uniquement) | pilule portaled dans `#header-combat-slot` ; `.combat-strip` scope les tailles compactes (les `.btn-*` hors couches écrasent les utilitaires) |
| `ConfirmButton` | suppression en deux temps — LE motif des suppressions de contenu | arme le contrôle **sur place** (rouge + `pulse-warn`), 4 s puis retombe, Échap/blur désarment |
| `TabButton` | onglets internes des pages-outil | souligné sang sur l'actif, encre au repos |
| `ToastStack` / `Toast` | retours d'action | bas d'écran, `aria-live` |
| `RarityBadge` `CategoryBadge` `WeightBadge` `CostBadge` | métadonnées d'objet | rareté teintée (`rarity-*`), jamais grise |
| `EmptyState` `LoadingSpinner` `ErrorMsg` | états de page | libellés français (« Ouverture du registre… ») |
| `SkeletonRegion` `SkeletonRegister` `SkeletonCard` `SkeletonRow` `SkeletonBlock` | squelettes de chargement | le dialecte fantôme — voir « Squelettes de chargement » ci-dessous |
| `RegisterHead` | tête réglée des registres et pages-outil | titre display centré + méta + double règle de tête ; `rise` (défaut — la page vierge porte déjà `register-rise`), `tight` (vue lecture), `announce` (méta en région vivante), `overline` (« Séance N »), `metaClassName` (variante flex à pastilles), `children` (porte de création) |
| `Panel` | carte de travail des onglets de la fiche | `card p-4 sm:p-5 space-y-3` canonique ; `title` rend le `section-title`, `tuto` = ancre `data-tuto` |
| `StepButton` | compteur −/+ parchemin (quantités, dés de vie, ressources) | 44 px mobile / 36 px desktop (idiome bourse), `label` a11y obligatoire, `title` optionnel |
| `VitalButton` | carré PV blesser/soigner (fiche, forme animale, bandeau) | `verb` harm/heal, `temp` (PV temporaires, bleu), `fold` hide/swap — repli ±5/±1 sous 380 px |
| `AuthCard` | carte-sceau des 5 portes (login, inscription, vérification, oubli, réinitialisation) | sceau + titre display sang + sous-titre ; wrapper `min-h-dvh` unifié |
| `AccentLink` | lien sang dans le texte | le verbe d'accent des phrases grises |
| `StatTile` | tuile parchemin des stats | `bg-parchment-100 rounded-xl p-3` + étiquette xs ; `tuto` = ancre |

**Squelettes de chargement** — le comportement normal de l'app face à un
chargement de SURFACE pleine (page, registre, panneau, onglet) : ce qui est
statique (filtres, têtes, barres d'onglets) se pose immédiatement, des blocs
`parchment-200` gardent la place du contenu — mais seulement si l'attente
SE VOIT : les blocs attendent 500 ms avant d'apparaître, un chargement
rapide ne montre jamais de fantôme (anti-scintillement ; le statut a11y,
lui, existe dès le montage). Trois règles du système :
(1) **un seul pouls par région** — `SkeletonRegion` porte `role="status"`
+ libellé français (lu une fois) et l'animation ; ses enfants ne pulsent pas
chacun (une couche animée, pas trente — vieille tablette), et `.skeleton`
(index.css) coupe le pouls sous `prefers-reduced-motion` : la structure porte
l'information, les blocs restent lisibles ; (2) **le fantôme parle le
dialecte de sa surface** — `SkeletonRegister` (tête + double règle + une
entrée courante + compactes ; groupes, table des matières, rencontres,
chronique, courrier) pour les pages réglées, `SkeletonCard` (`lines`
suivant le corps réel — PNJ : 4 lignes, tableau MD : 3, bourse : 2) pour
les grilles de cartes, `SkeletonRow`
(`lg`/`md`/`sm`, calibrées sur les cycles de vie des registres) pour les
entrées et listes, `SkeletonBlock` la brique ; (3) **micro-chargements
exceptés** — les chargements inline dans un conteneur déjà occupé (recherche
du catalogue, transfert en modal, sondes de rôle) gardent le texte
`animate-pulse` : un squelette n'ouvre pas une page, il tient une surface.
`LoadingSpinner` reste pour ces cas-là. Corollaire : les états de
chargement intermédiaires (`ProtectedRoute` pendant `/me`, `RouteFallback`
pour les chunks lazy) rendent RIEN — chaque page porte sa propre animation
d'entrée, c'est elle qui fait la transition depuis le parchemin vide.

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
| Le pupitre (MD) | la section III cesse d'être une liste pour le MD — il y TRAVAILLE : un panneau `.card` (le monde légitime la carte au travail, cf. la scène de combat) porte les quatre instruments en grille 2×2 à filets INTERNES `parchment-200` (`overflow-hidden` sur le panneau ferme les coins) — pas des boîtes dans la boîte. Chaque tuile entière est la porte (`Instrument` : glyphe `text-2xl`, nom `font-display` semibold `ink-900`, valeur `text-xs` `ink-400` talonnée `mt-auto` — les mesures s'alignent en pied d'instrument, les tuiles d'une rangée sont de même hauteur par la grille) ; ordre = cycle de vie : 🛡 Table du MD (« Fiches · bourse · réglages »), ⚔ Combat (état vif « N rencontres · M en cours », le « M en cours » en `blood-600` — le sang ne porte que le vivant ; « Aucune rencontre » sinon ; `GET /encounters` ETag-cachée, rafraîchie par `combat:change` débouncé + resync de reconnexion), 📓 Carnet (horloge « Jour N · X quêtes »), 🎭 PNJ (« Partagées & secrètes »). Mobile 390 : la valeur se replie à deux lignes sans casser, noms sur une ligne |
| Annexes | sous le pupitre, lignes réglées compactes : Chronique (si GMA lié), Correspondance (pastille non-lus `blood-600`). Joueur : PAS de pupitre — sa fiche est l'entrée I — Combat (queue « N en cours » si son combat tourne), Chronique, PNJ en lignes calmes |
| Ligne de pied (MD) | le code d'invitation n'est ni outil ni annexe : libellé `text-xs` `ink-400` + points de conduite + `code` mono `tracking-[0.2em]` poids normal + bouton copier en pastille bordée `min-h-11` (état « Copié ✓ » passe bord et texte en sang), détachée des annexes par `pt-4` — lisible à voix haute à l'arrivée d'un joueur sans peser sur les portes de travail |

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
| Figures au repos | déplié : 5 tuiles — pastille de métal colorée (cuivre #b87333, argent #c0c0c0, électrum #a89968, or #d4af37, platine #e5e4e2) + libellé `.label`, valeur en `font-mono text-xl` encre ; spectateur (lecture seule) : figures seules, `grid-cols-2 sm:grid-cols-5`, aucune porte ni stepper |
| Les steppers rapides | − à gauche, + à droite de chaque figure (#105) — le stepper du modal posé au repos : `rounded-lg bg-parchment-200`, glyphe `text-lg`, `w-11 h-11` au pouce sur la grille 2 colonnes (`grid-cols-2 md:grid-cols-5`), `md:w-9 md:h-9` dès la rangée de 5 (la figure garde sa place) ; `active:scale-95` comme `btn-secondary`, le − se verrouille à zéro (`disabled:opacity-50`) ; tap = ±1 pièce, chiffre optimiste puis le même PATCH plein-purse que le modal ; chiffre ≥ 1000 en `text-lg` pour garder son air entre les steppers |
| Les portes | deux `btn-secondary` « ＋ Encaisser » / « − Dépenser » — le verbe est présélectionné à l'ouverture du modal |
| Le modal du changeur | `Modal` standard (feuille mobile) : fieldset de 3 chips `aria-pressed` (＋ Encaisser / − Dépenser / ✎ Corriger, active = `bg-ink-800` remplie — l'encre, le sang est pris), 5 lignes pastille + stepper − [`NumberField` mono] + (cibles 44 px) ; chaque champ porte `emptyAsZero` — **vider une dénomination la compte à 0** (le grand livre et le CTA suivent à la frappe), le « rollback au blur » du `NumberField` est faite pour les champs auto-sauvegardés, pas pour des deltas |
| Le grand livre | sous filet `parchment-200`, `aria-live="polite"` : « Bourse » (valeur réelle, encre claire) → « Après » (`font-mono font-semibold`) — **la bourse réelle détenue, jamais une conversion canonique** (32 PO · 5 PA, pas « 3 PP ») ; « Il manque X » (PO→PA→PC, jamais PE/PP) verrouille le CTA sans crier ; « Monnaie rendue — 1 PO cassée en 10 PA » en `text-xs ink-500`, encre imprimée |
| Le CTA | `btn-primary` portant le verbe ET le montant (« Dépenser 5 PA », montant mono dans le libellé) ; « Corriger » édite la bourse telle quelle (draft pré-rempli, l'ancienne édition inline) et **reste verrouillé tant que le draft ne diffère pas de la bourse** — une correction identique n'est pas une opération |
| Persistance | un seul PATCH plein-purse (`action: 'coins'` en WS), toast « Bourse mise à jour » ; l'API clampe les 5 pièces en entiers ≥ 0 (400 sur non-numérique) |

## Deux pages réglées de plus — la chronique et le courrier

Le registre des groupes, la table des matières et le registre des
rencontres ne sont plus seuls : la **chronique** (`ChroniclePage.tsx`) et
la **boîte de réception** (`MessagesInboxPage.tsx`) parlent la même
grammaire — tête centrée + double règle (`SkeletonRegister` à
l'ouverture, `register-rise` à l'arrivée), entrées `border-b
parchment-200` refermées par filet.

- **Chronique** : liste des séances (grille de cartes par style de
  résumé), vue de lecture pleine largeur `max-w-3xl` (sur-titre
  « Séance » en capitales `ink-300` + titre Cinzel), chip ambre «
  possiblement obsolète » (`soft`) quand la source l'est.
- **Courrier** : une entrée par correspondance — pastille de non-lus
  (source unique `useMessagesUnread`), dernier message en méta, « sans
  objet » en italique `ink-400` ; le fil (`MessageThread`) charge en
  `SkeletonRegion` + `SkeletonRow sm` — le dialecte fantôme d'une carte
  de fil.

## Le splash « encre vivante » (`index.html`, premier lancement)

La première peinture de l'app est un document, pas un écran de
chargement : parchemin + halos de body, sceau officiel (jumeau inline
d'`icon-seal.svg`), wordmark « TABLE SYNC » en Cinzel révélé par balayage
d'encre, double règle, poussières d'or. Le splash vit entièrement dans
`index.html` — zéro dépendance au bundle (styles inline, peints avant le
téléchargement du module) ; `main.tsx` le retire après le premier rendu
React (fondu `ts-splash--out`, plancher 1 750 ms).

Ses règles, à réutiliser pour toute animation hors React :

- **Convention d'états** : chaque propriété vit à sa valeur FINALE par
  défaut et les keyframes n'entrent DEPUIS l'invisible que sous
  `prefers-reduced-motion: no-preference` — reduced (ou un moteur sans
  animation) pose la page gravée, immobile, sans cas spécifique.
- **Compositor seul** : seules des propriétés transform/opacity bougent
  (vieille tablette oblige).
- **Une seule chorégraphie par session** : un script inline pose
  `html.ts-calm` quand `sessionStorage['ts-splash-played']` existe — un
  rafraîchissement saute le splash ENTIEREMENT, l'app peint directement
  (une PWA relancée ouvre une nouvelle session → la gravure rejoue).

## Motion

Une seule courbe de sortie : `cubic-bezier(0.16, 1, 0.3, 1)`. Entrées courtes
(0.2–0.45 s), un moment signé par surface (dock, étendard de tour,
sheet-up, sheet-rise, register-rise, stage-swap). L'état « À toi de jouer »
parle en deux temps : L'ÉTENDARD — la carte sang se déroule en montant
depuis le dock (`.combat-turn-banner`, clip-path ancré au bord inférieur,
0,45 s), le titre se tamponne derrière (`.combat-turn-stamp`, échelle
1,35→0,97→1) comme un sceau qui frappe la bannière ; LA BANDE desktop,
persistante, prend une pose de frappe (`turn-strike`) — puis LE BATTEMENT :
le porteur vivant (carte mobile, bande desktop) porte LE GLOW DU HUB EN
PERMANENCE (valeurs exactes du bouton central du dock, anneau statique) et
chaque temps du cœur EMBRASE cette même empreinte (pseudo-élément dédié,
même géométrie, plus dense — jamais plus grand que le hub), lub-dub 1,5 s.
Le bouton « J'ai fini mon tour » reçoit de temps en temps un balayage de
lumière parchemin (`.btn-sheen`, cycle 7,5 s). Le dock ne bat pas (boutons
sous le pouce) — halo pulsé classique seul. Vibration cardiaque
`[70, 100, 160]` à l'instant du changement de tour. Tout est
transform/opacity (le clip-path du déroulé est un one-shot court sur un
petit élément), tout est coupé sous prefers-reduced-motion. Le
registre arrive par `.register-rise` :
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
La visionneuse d'illustrations (`ItemImageViewer`) a son unique moment :
fondu du fond + l'image qui se pose de 0.96 à 1 (`.viewer-enter` /
`.viewer-image-enter`) — le zoom, lui, n'anime JAMAIS (outil de lecture).
Le PNJ et les grilles de cartes arrivent par UN `register-rise` sur le
conteneur (le montage ne joue qu'une fois), pas un par carte.
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
