# Design System — apps/web

<!-- impeccable:design-doc -->

Le monde visuel de l'app : **parchemin, encre, sang, or** — un grimoire clair
(light-only, pas de dark mode), mobile-first, en français. Les couleurs de
règles (vert/jaune/orange/rouge des paliers d'encombrance et des PV)
enseignent l'état du personnage ; les teintes parchemin/encre portent le
registre. Une seule famille d'icônes : les glyphes emoji existants
(🛡 ❤ ⚔ 🎯), utilisés avec constance. Deux familles de surfaces : la carte
levée (`.card`) pour les panneaux de travail, et la surface réglée — entrées
posées à même le parchemin, séparées par des filets — pour les pages-liste
pleine largeur.

## Tokens — `src/index.css` `@theme`

Quatre rampes sémantiques. **Règle : n'utiliser une nuance (`ink-600`,
`blood-50`…) que si elle est définie dans `@theme`** — Tailwind v4 ne génère
rien pour une classe inconnue, l'erreur serait silencieuse.

| Rampe | Rôle | Nuances |
|---|---|---|
| `parchment-*` | fonds, surfaces, bordures neutres | 50–500 |
| `ink-*` | texte et icônes (brun d'encre) | 100, 300–900 |
| `blood-*` | actions primaires, dégâts, danger | 50–900 |
| `gold-*` | magie, accents dorés | 100, 300–700 |

Typographie : `--font-display` (Cinzel — titres et ordinaux romains),
`--font-body` (Iowan Old Style — texte), `--font-sans` (Inter — fallback
système). Le mono (`font-mono`) est réservé aux valeurs mesurées : PV, CA,
initiative, durées, codes d'invitation.

Couleurs de règles (palette Tailwind standard, hors `@theme`) :
`green/yellow/orange/red` pour les paliers d'encombrance, les PV, les
conditions. Chaque teinte porte un sens de règle — ne pas les réutiliser
comme décoration.

## Classes CSS — `src/index.css`

- `.card` — surface de base : blanc 85 %, flou léger, bordure
  `parchment-200`, ombre réelle (offset + flou), rayon 16px.
- `.btn-primary` / `.btn-secondary` / `.btn-ghost` — les trois boutons.
  Primaire = `blood-600` plein.
- `.btn-rest-short` / `.btn-rest-long` — les actions de repos (Onglet Survie),
  membres teintés du système de boutons (indigo = court, violet = long).
- `.input`, `.label`, `.input-compact` — champs de formulaire.
- `.section-title` — LE style de titre de section : `font-display text-lg
  font-semibold`. Tout `h2` de carte ou de feuille l'utilise.
- `.rarity-*` — badges de rareté (teinte par rareté, jamais gris).
- `.bar-*` — remplissage des barres d'encombrance.

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
| Pied (MD) | action fantôme « ＋ Nouvelle rencontre » ouvrant le `Modal` standard ; page vierge (MD) : chemin de création inline sous la double règle, joueur : `EmptyState` |

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


## Composants — `src/components/ui.tsx`

| Composant | Usage | Points clés |
|---|---|---|
| `Modal` | dialogues centrés (desktop) | focus trap, Échap, restore le focus |
| `BottomSheet` | feuilles mobiles portaled | `size` (md/lg), `mobileOnly`, `footer`, `bodyClassName` ; Échap + scroll lock |
| `Fab` | bouton d'action flottant `+` | `mobileOnly`, `raised` (au-dessus du dock) |
| `HpBar` | barre de PV partout (fiche, combat, forme animale) | paliers unifiés : ≤0 `red-700`, ≤25 % `red-500`, ≤50 % `yellow-500`, sinon `green-500` ; `temp` = PV temporaires en segment `blue-500` au-delà du remplissage (à PV pleins, il coiffe la fin) + aria « +N temporaires » ; `size` xs/sm/md, `showText`, `trackClassName` ; `role="progressbar"` |
| `Chip` | pastille de stat (attaque 🎯, dégâts ⚔, DD 🛡, ×N, +magique ✨) | `tone` (orange/red/blood/blue/amber/gold/indigo), `soft`, `title` = info-bulle de décomposition |
| `EncumbranceBar` | portage et paliers | affiche conséquences de règle au moment où elles s'appliquent ; `compact` = variante une-ligne du bandeau (barre fine + lecture mono + palier, conséquence conservée) |
| `CharacterStateBand` | bandeau d'état de la fiche joueur (`components/CharacterStateBand.tsx`) | rail réglé épinglé sous l'en-tête : identité (renomme inline) + phrase d'état (PV avec segment temp bleu + puce `+N`, CA, sorts, états) + ligne de combat (`CombatLine` : appel d'initiative / Agir / tour quiet, `aria-live` sur la copie statique) + encombrance compact ; panneau dépliable (états, emplacements par niveau, PV ±1/±5 — **les dégâts absorbent les PV temp d'abord**, debouncés 700 ms en UN patch portant les deux champs, pour le jet de concentration sur le total) ; jumeau fixe compact au défilement (`band-drop`, IntersectionObserver — le flux ne change jamais de hauteur) ; le multiplicateur de portage vit dans l'onglet Caractéristiques (tuile « Portage max » des Statistiques dérivées) |
| `ConfirmButton` | suppression en deux temps — LE motif des suppressions de contenu | arme le contrôle **sur place** (rouge + `pulse-warn` : « Supprimer ? » en pilule sur les ×, « Confirmer ? » sur les liens verbes), 4 s puis retombe, Échap/blur désarment ; 2ᵉ tap confirme ; n'bulle pas au parent |
| `TabButton` | onglets internes des pages-outil (Table du MD, Carnet) | souligné sang sur l'actif, encre au repos ; le conteneur porte `overflow-x-auto no-scrollbar` |
| `ToastStack` / `Toast` | retours d'action | bas d'écran, `aria-live` |
| `RarityBadge` `CategoryBadge` `WeightBadge` `CostBadge` | métadonnées d'objet | |
| `EmptyState` `LoadingSpinner` `ErrorMsg` | états de page | |

**Échelle de confirmation** — toute suppression se confirme au point de tap,
jamais ailleurs dans la carte : `ConfirmButton` arme le contrôle lui-même
(× des cartes traits/notes/objets personnalisés, lien portrait, verbes du
combat, pastille transport) ; les lignes d'inventaire et l'oubli de sort
remplacent la ligne sur place ; le `Modal` avec texte de conséquences est
réservé aux entités entières (personnage, PNJ) dont la suppression est en
cascade. État armé = rouge + `pulse-warn`, partout la même signature.

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

## Étendre le système

1. Nouvelle nuance → l'ajouter à la rampe `@theme` correspondante, en
   respectant l'ordre de luminosité.
2. Nouveau titre → `.section-title` (+ classes utilitaires si besoin), pas
   de style ad hoc.
3. Nouvelle pastille de stat → `Chip` avec un `tone` existant ; nouveau
   `tone` seulement si le sens est réellement distinct.
4. Nouvelle barre de PV → **jamais** : `HpBar` (`size`, `showText`,
   `trackClassName` couvrent les cas).
5. Overlay plein écran → `Modal` ou `BottomSheet` avant tout markup
   `fixed inset-0` manuel.
6. Nouvelle page-liste pleine largeur → la surface réglée du registre
   (double règle de tête + entrées réglées), pas une grille de cartes ;
   `.card` reste l'outil des panneaux de travail.
