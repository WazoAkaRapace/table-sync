# Design System — site (marketing)

<!-- impeccable:design-doc -->

Le monde visuel de l'app, **hérité tel quel** (parchemin, encre, sang, or —
tokens exacts de `apps/web/src/index.css` `@theme`), joué cette fois sur ses
surfaces sombres : **« la table, la nuit »**. La page est la séance au coin
de la lampe — fond d'encre `ink-900` vouté de lumière, panneaux parchemin
devenant des écrans luisants, or portant le fil temps réel, sang gardant le
verbe et le tour courant. Parti pris structurel : **le tour de table**
(graine 27bfed1c, candidat 3/7) — la landing JOUE un round de combat. La
lecture descend l'ordre d'initiative : pastille de rencontre dans le hero
(« Embuscade gobeline · round 2 »), mesures monumentales du SRD, registre à
ordinaux I–XI dont l'entrée I (le temps réel) porte le sang, la création de
contenus (« Votre monde, vos règles », V), correspondance,
chronique, puis le « Repos long » de l'auto-hébergement et « La table
t'attend. » en clôture. Refusé : l'agencement hero→fonctionnalités→CTA du
SaaS, et le parchemin diurne posé à plat de la version précédente. La page
est statique (HTML + CSS + un IIFE), française par défaut, bilingue FR|EN au
choix, servie par GitHub Pages sans build.

## Tokens — `site/styles.css` `:root`

Copie **exacte et manuelle** de `apps/web/src/index.css` `@theme` (préfixe
`--color-` retiré). Aucun lien de build : toute nuance changée d'un côté doit
l'être de l'autre.

| Rampe | Rôle | Valeurs |
|---|---|---|
| `--parchment-*` | texte de nuit, écrans luisants, panneaux lamplits | 50 `#fdfaf3`, 100 `#f7f0e1`, 200 `#ece0c4`, 300 `#ddcb9e`, 400 `#c9b074`, 500 `#b8975a` |
| `--ink-*` | la nuit elle-même, texte sur parchemin | 100 `#e9e1d4`, 300 `#a8926f`, 400 `#7d6850`, 500 `#6b5640`, 600 `#5b4733`, 700 `#4a3825`, 800 `#3a2b1c`, 900 `#2a1f14` |
| `--blood-*` | CTA, tour courant, tuile et ordinal de l'entrée I | 50 `#faf0f0`, 100 `#f0d4d4`, 200 `#dda3a3`, 300 `#c05151`, 400 `#a92424`, 500 `#8b1a1a`, 600 `#7a1f1f`, 700 `#651515` |
| `--gold-*` | fil temps réel, magie, mesures, terminal, sélection | 100 `#f6ecd2`, 300 `#e3c766`, 400 `#d4af37`, 500 `#b8975a`, 700 `#7e6439` |
| `--rule-*` | sens de règle uniquement (paliers PV de la démo) | green `#22c55e`, yellow `#eab308`, red `#ef4444` |
| `--line-night` / `--line-night-soft` | hairlines d'encre claire sur la nuit | `rgba(233,225,212,0.14)` / `0.09` |

Typographie : `--font-display` (Cinzel — titres, ordinaux, libellés, mesures),
`--font-body` (Iowan Old Style, Palatino, Georgia — corps), `--font-mono`
(pile système — **valeurs mesurées uniquement** : compteurs, PV, pastille de
rencontre, adresse du deskframe, commandes, DD). Cinzel vient de Google Fonts
(400/600/700, preconnect) ; Iowan Old Style est une police système. Inter
n'est pas emportée.

Motion et ombres : une seule courbe `--ease: cubic-bezier(0.16, 1, 0.3, 1)`.
Ombres **chaudes et profondes, jamais de noir pur** (base `rgba(16,11,6,…)`) :
`--shadow-card`, `--shadow-raised`, et `--shadow-lamp` (la plus large —
réservée aux panneaux parchemin luisants). `color-scheme: dark` sur `:root`,
`theme-color` `#2a1f14` : le monde est sombre, jamais de bascule claire.

## Base : la nuit, éclairée de la table

Corps 17 px (1.0625rem)/1.65, texte `parchment-200` sur `ink-900`, avec deux
voiles radiaux **fixes** (or 11 % en haut-gauche, sang 12 % en bas-droite) —
et le **vignettage de la lampe** : `body::after` fixe, radial
`120% 90% at 50% 34%` transparent jusqu'à 46 % puis `rgba(16,11,6,0.5)` —
la lumière tombe sur la table, les bords reculent dans la pièce. Titres
h1–h3 en Cinzel 600 `parchment-50`, `text-wrap: balance`. Liens `blood-200`
→ `blood-100` au survol (épaisseur 1 px, offset 3) ; `:focus-visible` =
contour 2 px `gold-400` offset 2 ; sélection `gold-700` sur `parchment-50`.
Mesure unique `.wrap` (max-width 68rem, padding 1.25rem → 2.5rem à 768px).
`.mono` (0.85em, espacé 0.02em) marque les valeurs mesurées dans le corps.

## Le dé — le glyphe polyédrique

Le hasard parle en dés partout où il parle : `.die` est une face découpée au
`clip-path` (d20 = hexagone `polygon(50% 0, 100% 25%, …)`), point central par
`radial-gradient` (pip `ink-900` sur face or). Déclinaisons : 12 px par
défaut, **15 px dans la pastille de rencontre** (le d20 s'y lit comme un
dé, pas comme une tache), 17 px dans le signal de descente, 13 px pour les
jalons de la marge du registre (`.toc-tick`), 15 px pour la plume voyageuse
(`.toc-nib`). La classe `.die-roll` fait rouler le dé sur lui-même (9 s
linéaire, coupée en mouvement réduit) — seul le dé du signal de descente
roule seul.

## Le hero : la séance vient de commencer

Le premier écran tient la scène entière : pastille, nom, slogan, offre,
verbes, téléphones — et la BANDE DES MESURES qui affleure le bord (2026-09,
retour utilisateur : les quatre chiffres du SRD ont remplacé les tuiles
FOR→CHA — la preuve plutôt que la mimique ; mesuré : bande 702–835 px,
cue 867 px dans un viewport 1440×900).

| Dispositif | Recette |
|---|---|
| Pastille de rencontre | `aria-hidden` (saveur, pas information) : d20 or 15 px + mono `gold-300` 0.75rem espacé 0.06em sur pilule bordée or 32 %, fond or 7 % — l'affichage du traqueur, littéral |
| Wordmark | h1 Cinzel 700 `clamp(2.7rem, 7vw, 4.4rem)` resserré (−0.02em), lh 1.04 — **le plus grand type de la page** (voir la règle de la couronne, bande des mesures) |
| Slogan | une ligne d'italique `gold-100` `clamp(1.05rem, 2vw, 1.25rem)` entre le nom et l'offre |
| Offre | `parchment-200` `clamp(1rem, 1.5vw, 1.12rem)`, plafonnée 32rem |
| CTA | deux boutons **48 px** : « Code source sur GitHub » (primaire `blood-600` → `blood-500` au survol, ombre de soulèvement double — le verbe sang se lève de la nuit, porté par sa propre lueur ; `scale(0.98)` à l'appui) + « Auto-héberger en 3 commandes » (secondaire : verre de nuit `parchment-200` à 7 % bordé `--line-night`). Sous 640px, les deux verbes se posent en barres pleine largeur |
| La paire portrait | **deux téléphones posés sur la table, écrans allumés** : le traqueur du MD (`12-traqueur.png`) incliné −8° derrière (62 % de large, z-1), le registre du joueur (`01-parties.png`) droit devant (78 %, z-2) ; lueur d'écran `::before` radial or 16 % débordant la paire (inset −12 % −16 %) ; entrées posées 0.55 s / 0.5 s décalées de 100 ms (`pair-in`, coupées en mouvement réduit). Cadres `.portrait-frame` rayons 20/13 px, matelas 8 px, bordure d'encre claire 16 %, `shadow-raised`. <768px la paire se replie — le registre reste seul ; ≥1024px la fiche s'ouvre en deux colonnes (`minmax(0,1fr)` \| `minmax(0,20rem)`, écart 3.2rem), la paire occupant
la colonne 2 sur 6 rangées |
| Bande des mesures | `.hero .statband` sur filet `--line-night` (la section plein écran a été repliée DANS le hero) : quatre comptes Cinzel 700 `gold-300` en 2×2 (mobile) puis 4 colonnes (≥900px), hairlines verticales — les chiffres MONTENT dès l'arrivée (count-up, stagger 90 ms). La bande porte le titre nulle part : les labels suffisent, l'offre du hero tient le reste |
| Signal de descente | lien `#table` : d20 17 px roulant (9 s) + libellé Cinzel 0.68rem espacé 0.2em majuscules — « Le tour de table commence » |

## La bande des mesures (SRD monumental) — dans le hero

Les quatre comptes en Cinzel 700 `gold-300` `clamp(2.3rem, 5vw, 3.6rem)`
— 646 objets / 490 sorts / 964 monstres / 16 états — séparés par des
hairlines verticales (≥900px, 2→4 colonnes ; sous 900px les lignes 3+
prennent un filet haut).
Les chiffres **montent de 0 à leur valeur** à la première révélation
(`countUp` : 950 ms, ease-out cubique, stagger 90 ms, IntersectionObserver
seuil 0.35, une seule fois) ; la valeur finale vit déjà dans le HTML — sans
JS ou en mouvement réduit, rien ne manque.

**Règle de la couronne.** Le wordmark du hero (4.4rem max) reste le plus
grand type de la page. Toute mesure monumentale plafonne SOUS lui — le
`clamp` des comptes fut abaissé à 3.6rem max exprès ; une nouvelle figure
qui dépasserait le nom briserait la hiérarchie de la séance.

## La grammaire du registre (les entrées = les tours)

Le dialecte réglé de l'app, transplanté sur la nuit : pas de fond, pas de
grille de cartes — les entrées sont posées à même l'obscurité et séparées
par des hairlines d'encre claire. Onze entrées I–XI (`#table`, `#fiche`,
`#inventaire`, `#md`, `#vos-regles`, `#correspondance`, `#chronique`,
`#deux-lumieres`, `#personnalite`, `#tutoriel`, `#repos-long`) ; la marge du
registre et la bande du tour (accès bas) les accueillent seules dès qu'elles
portent un `id`.

**Votre monde, vos règles (entrée V, 2026-11)** — la vitrine des contenus
personnalisés (objets, armes, sorts, monstres, armures — PR #304/#305/#306) :
grammaire standard `subentries + phonepost story --views:6` (la puce « L'arme
de légende » couvre deux vues, création MD puis lame calculée sur la fiche)
fermée par une fenêtre bureau `entry-wide` (39 — le monstre custom en pleine
rencontre). Un paragraphe d'ouverture précède les sous-entrées (première
entrée à le faire) ; aucune règle CSS nouvelle — idiomes existants seuls.

| Dispositif | Recette |
|---|---|
| Ordinaux romains | colonne Cinzel `min-width: 2.7rem` alignée à droite, `aria-hidden` ; `gold-300` 1.5rem au repos |
| Entrée courante | l'entrée I seule porte `.is-lead` : ordinal `blood-300` 1.9rem — le sang marque « maintenant », une seule entrée |
| Tête d'entrée | ordinal + h2 `clamp(1.9rem, 4vw, 2.7rem)` resserré (−0.015em), posés sur un filet EXPLICITE `.entry-head::after` (`--line-night`) — trait animable, pas une border ; pb 0.9rem, mb 1.7rem |
| Tête compacte | `.entry-head-compact` (Repos long, dans le panneau) : pb 0.7rem, mb 1.2rem |
| Copie en feuille | `.entry-copy--folio` : les sous-entrées s'étalent en **deux colonnes de feuille** ≥900px (`columns: 2`, écart 3.5rem, `break-inside: avoid` par `li`) — dense, réglée. La copie simple reste plafonnée 62ch. Au bureau (≥1024), la feuille vit AU CHEVET DE L'ÉCRAN : `[folio + histoire téléphone]` enveloppés dans `.entry-body.has-folio` (grille 1fr/400px), la colonne copie `position: sticky; top: 1.25rem; max-height: calc(100dvh - 2.5rem); overflow-y: auto` — elle épingle AVEC le téléphone, le texte vit une fois, à côté de la capture qu'il commente ; la légende repasse en étiquette SOUS le téléphone (`flex-direction: column`, réserve d'écran 14.5rem). Au mobile la feuille reste en flux au-dessus, intacte |
| Sous-entrées réglées | `h3` 1.2rem + paragraphe `parchment-200` 1rem, chaque `li` refermé par un filet `--line-night-soft` — jamais de carte |
| Personnalité (VII) | les quatre quadrants de fiche 5e (TRAITS / IDÉAUX / LIENS / DÉFAUTS), cartes verre de nuit 1→2 colonnes (≥640px), titres Cinzel 0.72rem espacé 0.16em `gold-300` |

Les tampons « preuves » (`.proof li`, mono sur verre de nuit) ont été
RETIRÉS (2026-09, déduplication) : chaque section répétait ses
sous-entrées en puces — la feuille parle une fois. Les nombres du SRD ne
vivent plus QUE dans la bande du hero ; chaque fait unique retombe dans
la prose (le cache 5 min de la liaison GM Assistant, par exemple).

## Captures en cadre téléphone et vues élargies

Toutes les images de l'app sont des écrans dans la nuit : cadre rayon 30 px,
bordure d'encre claire 16 %, matelas 9 px sur `parchment-100` (l'écran
luisant), écran interne rayon 21 px, `shadow-card` ; légende 0.8rem
`ink-300` centrée. Au survol le cadre se soulève (`shadow-raised` +
translateY(−3px), 0.3s `--ease` ; aucun soulèvement en mouvement réduit).
Attributs `width`/`height` partout (390×844 téléphone, 820×1180 et
1180×820 et 1440×900 vues élargies) — zéro décalage de mise en page.

- **Paire de téléphones** (entrée I, sous la démo) : `.shot-pair` 2 colonnes
  ≥640px ; sous 640px chaque cadre se plafonne à 340px centré — on « casse
  le tunnel de téléphones », la page respire entre deux tours.
- **Paire tablette** (entrée II) : `.tablet-pair` — le portrait
  (`23-fiche-tablette.png`, flex `0 1 19rem`) et le paysage
  (`25-survie-paysage.png`, `0 1 30rem`) côte à côte, `flex-wrap` centré,
  écart 1.6rem ; sous ~50rem d'air la paire se replie empilée.
- **Fenêtre bureau** (entrées I et IV) : `.deskframe` — bordure d'encre,
  matelas 0.45rem sur `parchment-100`, rayon 14 ; barre `aria-hidden` à
  trois pastilles `parchment-400` + adresse en mono 0.72rem sur pilule
  blanche 65 % (`table-sync.local/party/1?combat=init`, puis
  `/party/1/combat`, puis `/party/1`). Deux fenêtres servent l'entrée IV —
  le traqueur trois colonnes (24-traqueur-bureau) puis le pupitre du groupe
  (31-groupe-pupitre, 1440×900 toutes deux : une capture BUREAU ne vit
  JAMAIS dans une vue téléphone de l'histoire, ses attributs
  width/height doivent dire la vérité de ses pixels) ; l'entrée I porte la
  tablette paysage (30-initiative-tablette, 1180×820). Chaque `.shot-desk`
  plafonne à 56rem centrée et se pose **sous l'histoire de son entrée**,
  pleine largeur.

31 des 33 captures de `docs/screenshots/` servent la page (seules
`06-sorts.png` et `10-formes.png` ne sont pas embarquées).

**Les histoires larges** (2026-09, entrées II et IV) : la paire tablette
(23 portrait + 25 paysage) et les deux fenêtres bureau du MD (24 + 31)
vivent la MÊME captivité que les postes téléphone — `.phonepost.story
.story--wide`, même épinglage (100dvh + vues×70vh), même rail, dock,
légende et encre. Le média vit dans un SLOT (`.story-slot-frame`,
pile grid centrée) dont l'empreinte est celle de la PLUS GRANDE vue :
chaque capture s'y centre à son aspect naturel, et quand un portrait se
change en paysage le mobilier (slot, rail, dock, légende) NE BOUGE
PAS — les vues se fondent sous l'encre, tailles différentes comprises ;
le front or chevauche le slot entier (mobilier de scène). Deux règles
tiennent la géométrie : la hauteur du bloc texte est RÉSERVÉE
(`--text-h`, la colonne légende fixe à 3 lignes), et le plafond des
images est CALIBRÉ par main.js (`--img-cap` = hauteur de scène moins
chrome MESURÉ : paddings, écarts, rail, dock, matelas/barre du cadre,
bloc texte, 8px de mou) — recalibré au resize et aux fontes ; la colonne
est ancrée en haut et le slot se centre par `margin-block: auto` (le
recentrage vertical ne peut plus dériver). La correspondance
emphase↔vues de l'histoire large vit dans `data-wide-view` (jamais les
mêmes indices que `data-story-view`), et
une histoire ne joue QUE si sa scène est à l'écran — sans cette garde,
le saut d'entrée réveille l'histoire téléphone déjà passée et lui vole
l'emphase de la copie feuille. L'entrée I garde sa fenêtre bureau
unique (30) en vue élargie classique.

**Les deux lumières (entrée VIII, 2026-09)** — la section du mode bougie
de l'app (PR #132-133) : registre I–XI désormais (Personnalité→IX,
Visite→X, Repos long→XI — l'entrée V « Votre monde, vos règles », 2026-11,
a pris sa place entre l'écran du MD et la correspondance). L'histoire
Parchemin↔Bougie (04-survie clair ↔
32-bougie-fiche, même onglet) joue LA BASCULE DU MODE sur sa propre
scène : `--candle` (main.js, posé sur l'ENTRÉE — la palette `--day/*--night/--mix-*`
vit sur `#deux-lumieres`, tout ce qui en descend suit d'un bloc ; la
feuille au chevet reste de la nuit, lisible comme partout : 0 avant la vue de
bascule, la fraction traverse, 1 après) mène chaque couleur de la valeur
PARCHCEMIN de l'app vers sa valeur BOUGIE (`html.ts-dark` d'apps/web —
les VRAIES ramps : #fdfaf3→#1a1512, #f7f0e1→#262019, #2a1f14→#f3e7d0,
#6b5640→#9a8264, #ddcb9e→#4d3f2b) par `color-mix(in oklab …)` — l'écran
s'encre en bougie PENDANT que la page qui le porte s'assombrit, et un
halo de bougle (radial or, alpha × --candle) monte du bas de la scène.
`data-flip-on-view="1"` sur le poste désigne la vue de bascule. Repli
calme : pas (0/1 par setView — applyCandle attend une progression
EXACTE, la vue atteinte = flipAt + 1, gotcha corrigé) + fondue CSS 0,6s ;
sans JS, la scène reste en plein jour. La fenêtre bureau 33-bougie-
traqueur vit en vue élargie classique dessous ; les captures bougie
existent FR+EN (`npm run screenshots -- --only 32,33 --lang en`).

**Les grandes vues s'écrivent aussi** (styles.css, « Les grandes vues
s'écrivent aussi ») : chaque vue élargie qui entre à l'écran joue la même
plume que les histoires — la capture S'ÉCRIT sous le balayage d'encre
diagonal (`wide-ink`, 0,6s — plus longue que les 0,5s des écrans téléphone,
la surface est plus vaste), le front or chevauchant le bord (`ink-edge`
reprise telle quelle). Le CADRE reste posé (matelas, barre de fenêtre) :
seul l'ÉCRAN s'encre, comme au poste de consultation. Déclenché UNE fois
par figure via `.reveal.is-risen` (l'encre sèche, remonter ne réécrit pas).
Les `img` des `.deskframe` vivent dans un fourreau `.deskframe-screen`
(position relative) : le pseudo `::after` du front doit partager la boîte
EXACTE de l'image — posé sur le deskframe entier, il couvrirait la barre de
fenêtre et désynchroniserait le front du masque. GOTCHA mouvement réduit :
les sélecteurs miroirs du bloc `reduce` doivent égaler la SPÉCIFICITÉ des
sélecteurs `.is-risen` (sinon le masque y survit — constaté et corrigé).

## Les histoires épinglées (les six postes multi-captures)

Les séries de captures (fiche II · sac et bourse III · écran du MD IV ·
correspondance V · chronique VI · visite VIII) ne sont plus des postes à
pilules : chacune vit en **histoire épinglée** — le téléphone prend la
hauteur de l'écran et le DÉFILEMENT avance les vues une à une, la page reste
captive jusqu'à la dernière vue. Exigence utilisateur 2026-09 : coller au
geste des stories.

| Dispositif | Recette |
|---|---|
| Le fourreau | `.js .story` : hauteur `calc(100dvh + var(--views) × 70vh)` (ligne `vh` de repli AVANT la ligne `dvh` — la barre d'adresse iOS ne mange plus le bas) ; `--views` posé inline (5, 5, 4, 3, 3, 2) |
| La scène | `.story-stage` `position: sticky; top: 0; height: 100dvh` — le défilement y reste captif |
| Le téléphone plein écran | `.shot-frame` en `min(24rem, 100%, calc((100dvh − 13rem) × 0.4621))` — le cadre vise la hauteur du viewport, amputée du dock, du rail et de la légende |
| La progression | `progress = clamp((scrollY − top) / span)` sur la hauteur du fourreau ; `index = floor(progress × n)` change la vue, la fraction remplit le segment courant |
| Le rail | `.story-track` (même largeur que le téléphone) : un segment de 3 px `ink-700` par vue, remplissage `gold-400` au doigt — la grammaire des stories, au fil de la plume |
| Les pilules | le dock `.phonepost-dock` pilote par le DÉFILEMENT : un clic mène à `top + (i/n) × span + 1` (atterrir au début de la vue). Pilules 44 px sur verre de nuit, active = `parchment-100` plein, texte `ink-900`, `aria-pressed` |
| La légende | `.phonepost-caption` italique 0.85rem `ink-300`, **hauteur FIXE 3lh** (fallback 4.95em ; mesurée sur la pire légende FR+EN, 3 lignes/67px — la pile centrée ne se recentre JAMAIS quand le texte change, l'écran ne bouge pas d'un pixel), max 34ch. ≥1024px elle devient NARRATION : bloc `max-width: 21rem` pleine largeur (le plafond 34ch y est levé), aligné à droite, à GAUCHE du téléphone ; en dessous, l'empilement colonne la pose SOUS le téléphone (`order: 2`, juste après le dock) |
| La bande du tour | `.story-stage` prend `padding-bottom: 4.5rem` sous 1360px — le centre de gravité remonte d'un souffle pour laisser la place à la pastille fixe du bas |
| Calme (repli) | mouvement réduit OU moteur sans IntersectionObserver → `.is-calm` : fourreau et scène redeviennent statiques, le rail disparaît, les pilules basculent les vues directement ; la légende reste `aria-live="polite"` (c'est un clic qui la change) |
| Silence de lecture | en histoire épinglée, la légende passe `aria-live="off"` : l'avance au scroll annoncerait chaque vue (≈19 fois la page) — elle reste visible, muette pour le lecteur d'écran |
| **La feuille suit l'écran** | le texte de la section ne se répète JAMAIS (retour utilisateur 2026-09 : le clone `.story-voice` — la sous-entrée réimprimée à côté de l'écran — a été RETIRÉ ; puis la feuille elle-même a pris sa place au bureau : colonne `sticky` dans `.entry-body.has-folio`, voir « Copie en feuille »). Ce qui accompagne une vue : la légende qui DÉCRIT l'écran + les pilules. Seule l'EMPHASE voyage — et elle voyage LISIBLEMENT (retour utilisateur 2026-09 : « pas assez visible, trop rapide ») : la sous-entrée qui prend le tour est RÉÉCRITE d'un balayage d'encre (`voice-ink` 0.7s, même angle de plume 104° que la légende, masque sur le `li`), l'encre COULE (`transition color` 0.75s sur les `h3`/`p`, l'entrée courante prend sa pleine encre pendant que la précédente la rend) et le dé or `h3::before` se POSE en tampon ample (`voice-stamp` 0.55s, scale 1.9→1 + tiers de tour + flou→net ; la classe voyageant d'un `li` à l'autre, chaque prise de tour rejoue le geste, un même `li` couvrant plusieurs vues ne rejoue rien ; mouvement réduit = pose statique, ni balayage ni tampon). La sous-entrée courante porte `.is-current` (encre pleine + dé or, la grammaire du tour) et les autres `.is-sync-dim` (ink-300, ≈5,5:1 — le plancher de contraste tient). La correspondance vit dans `data-story-view` sur chaque `li` (une sous-entrée peut posséder PLUSIEURS vues : « Survie & forme sauvage » couvre les écrans Survie ET Forme sauvage ; vue sans correspondance → l'emphase reste sur la précédente). La colonne légende s'encre avec la vue (`caption-ink` porte `.story-side`) |
| Sans JS | `html:not(.js)` : l'écran devient un bandeau vertical de TOUTES les vues (position static, opacité 1), le dock inerte disparaît — rien de la série ne manque au visiteur |

Règles : les vues d'un poste se chargent toutes (pas de `loading="lazy"` —
l'échange de langue ne doit jamais montrer un écran vide ; seules les
captures hors poste, elles, sont `lazy`) ; `.phonepost-view:not(.is-active)`
n'écoute pas (`pointer-events: none`) — le clic sur l'écran ouvre TOUJOURS
la vue active ; l'échange de vue est LE geste signé du poste — **l'encre
tourne la page** (styles.css, « L'encre tourne la page ») : la vue
entrante s'écrit sous un balayage d'encre diagonal masqué (`@property
--story-ink`, `mask-image` à trois arrêts — le bord est une plume
empanachée, pas une fente), un front OR court au bord de l'écran en rythme
(`--story-edge` sur `.phonepost-screen::after`, la comète de braise du
splash). **Géométrie IMMOBILE** : les vues ne bougent pas d'un pixel au
changement — ni échelle, ni glissement, ni flou, la sortante s'efface en
fondu 0,3s SOUS l'encre entrante (0,5s) ; deux captures consécutives de
l'app partagent leur chrome, le moindre mouvement se lirait en tremblement.
La légende SUIT LA PLUME : même balayage diagonal, même angle et même
rythme que l'écran (`--story-cap`, plume plus large — 40 % — un bord dur
découperait les glyphes) ; au mobile elle vit SOUS le téléphone (order 2,
juste après le dock), au bureau elle est la narration à gauche.
`main.js` repose `.is-inking` sur le poste à CHAQUE changement de vue (le
reflow explicite réarme l'animation du pseudo-élément, qui sans lui
resterait à son état final) ; les keyframes finissent à 150 % — la boîte
(diagonale ≈ 100 %) reste entièrement dans la zone opaque, jamais de
plume résiduelle au coin. Tout ne vit que sous `.js` ; mouvement réduit =
vue posée sèche (masques, front et légende coupés, pas de classe posée).

## La démo temps réel (entrée I) : la frappe rayonne

L'entrée I garde SA scène : corps en deux colonnes égales (`with-demo`,
≥1024px — la démo a la largeur d'une scène), démo puis paire de captures
(05 + 29) dans la colonne visuelle, fenêtre bureau (30) pleine largeur
dessous.

| Dispositif | Recette |
|---|---|
| Le panneau lamplit | `.panel.demo` : `parchment-100` bordé `parchment-300`, rayon 16, `shadow-lamp` — l'écran luisant sur la table ; typographie encre (`ink-900`) DANS le panneau |
| Les deux écrans | TRAQUEUR (« Embuscade gobeline · écran du MD ») et FICHE (« Lyra · téléphone du joueur ») : blanc 60 % bordé `parchment-200`, rayon 12 ; titre Cinzel 0.72rem espacé 0.16em + qui/quoi en corps 1rem `ink-800`. Placement explicite par `grid-area` (tracker 1/1, sheet 1/2, fil 2/1/-1, note 3/1/-1 à ≥640px) : un fil `1/-1` dans l'ordre du DOM empilerait les panneaux même en deux colonnes ; sous 640px, flux naturel empilé avec le fil entre les panneaux |
| Le fil | `.wire` : trait pointillé OR (`gold-400` à 55 %), étiqueté « temps réel » en italique 0.7rem `gold-300` sur pastille `ink-800` bordée or — le WebSocket, littéralisé ; `aria-hidden`. L'étiquette suit la langue par `content` CSS (« real time ») |
| L'étincelle | `.spark` : 9 px `gold-400` à halo, part du traqueur et court jusqu'à la fiche (0.42s `--ease`) — la distance exacte du fil est mesurée AU COUP (`--travel` = largeur du fil − 9 px, responsive) |
| Barres de PV | piste 10 px pilule `parchment-200`, remplissage `--rule-green` ; paliers HpBar : jaune ≤ 50 %, rouge ≤ 25 % (seuils `ceil`, 0.6s `--ease`) ; lecture mono « Lyra · 24/31 PV » côté MD, « 24/31 PV » côté joueur ; `role="progressbar"` + `aria-valuetext` français mis à jour en direct |
| Verbe du MD | `⚔ Infliger 9 dégâts` : bouton **sang doux** (fond `blood-50`, bordure `blood-200`, texte `blood-700`, survol `blood-100`), 44 px — le sang plein reste réservé aux CTA |
| Puce de dégâts | pilule mono 0.8rem blanc sur `blood-600` : « ⚔ 9 dégâts → fiche de Lyra », monte de 4 px |
| Alerte concentration | 🌀 sur `gold-100` bordé `gold-300` : « jet de CON `DD 10` » (DD en mono), monte de 6 px |

Comportement (`main.js`) : une frappe à la fois (garde `strikeTimer`) ; la
puce paraît et l'étincelle court, 450 ms plus tard les DEUX barres tombent et
l'alerte monte ; à 3,4 s tout se réarme (Lyra se soigne). Première frappe
offerte quand la démo entre à l'écran (IntersectionObserver, seuil 0.6,
+700 ms, une seule fois). Sous `prefers-reduced-motion` : **état final
statique** — 22/31, puce et alerte visibles, étincelle supprimée, tout lu
sans animation. La bascule de langue retraduit l'état SANS rejouer la
séquence (relu depuis `aria-valuenow`).

## Le fil de lecture : la marge (≥1360px) et la bande du tour (<1360px)

Deux dispositifs jumeaux suivent la ligne de lecture, bâties par `main.js`
(rien sans JS) — l'un en marge sur grand écran, l'autre en pastille fixe en
bas sur le reste.

**La marge du registre** (`nav.margin-toc`, `left: calc(50% - 36.4rem)`,
affichée ≥1360px seulement) :

| Dispositif | Recette |
|---|---|
| La règle | `.toc-line` : piste 2 px `ink-700` (lisible sur la nuit), remplissage `.toc-fill` `gold-700` en `scaleY` — la hauteur suit la ligne de lecture (milieu du viewport, ramenée dans le repère de `main` : le hero précède) |
| La plume voyageuse | `.toc-nib` : losange `gold-400` 15 px chevauchant la pointe du remplissage ; NUE au-dessus de l'entrée I, elle PREND LA FORME DU DERNIER DÉ franchi (`.is-die` + `is-d4`…`is-d20`, clip-paths et pip) — le registre se joue |
| Les jalons-dés | un dé **par entrée**, UN TYPE PAR ENTRÉE : la série monte d4→d20 puis recommence (`DIE_TYPES[i % 6]`). Dé 13 px SUR la règle : face `ink-600` à venir, `parchment-300` passé (pip sombre), `blood-400` pour l'entrée I passée, `gold-400` agrandi ×1.3 pour la courante. Le dé ROULE au fil du défilement : `tick-roll` 0→2880° (**huit tours** sur la page) sur `animation-timeline: scroll(root block)` — descendre le fait rouler, remonter le rembobine |
| Les ordinaux | Cinzel **0.95rem/700** espacé 0.06em à gauche de la règle, cible = l'ancre entière (~44 px de padding) ; `ink-300` à venir, `parchment-200` passé, `blood-300` pour l'entrée I passée, la courante grossit à 1.1rem `parchment-50`. `aria-label` « I — La table en temps réel » |
| Le titre au survol | l'ordinal seul est une énigme : le nom complet se dévoile en chip sombre DROITE de la règle (`attr(data-toc-title)`, 0.85rem, chevauche le bord de colonne — c'est un survol), bilingue par `data-toc-title-fr/-en` |

**La bande du tour** (`.turnband`, <1360px) : pilule fixe `bottom: 1rem`
centrée, `min-height: 44px`, fond nuit 92 % bordé `--line-night` — l'ordinal
du tour courant en Cinzel `gold-300` (sang sur l'entrée I), le titre en
corps 0.85rem ellipsé, et le verbe « Tour suivant » (`blood-600`, membre
compact 36 px dans la pilule) qui fait défiler à l'entrée suivante — le
dernier tour BOUCLE vers le premier, la séance est un cercle. Cachée au hero
et près du pied (deux IntersectionObserver), cachée ≥1360px où la marge
prend le relais, localisée à la bascule FR|EN (le titre courant change de
langue sans attendre la ligne).

Les deux ne s'animent JAMAIS d'elles-mêmes : chaque état ne fait que suivre
le doigt. Cadence : un rAF par défilement AVEC filet de secours
(`frameGuarded` — dans un onglet étranglé, un verrou booléen gèlerait le
dispositif pour de bon ; le minuteur à 160 ms reprend la main).

## Repos long (XI) et pied de page

- **Le panneau lamplit** : `.panel.deploy` est le seul grand îlot de parchemin
  après le hero — le repas de fin de séance, près de la lampe. La
  typographie y redevient encre sur parchemin (titre `ink-900`, ordinal
  `gold-700`, filet `parchment-300`, corps `ink-700`) ; le verbe secondaire y
  redevient parchemin (`parchment-200` → `parchment-300`, texte `ink-900`).
  Grille `minmax(0,1fr)` au mobile, `minmax(0,1fr) minmax(0,1.35fr)` à
  ≥1024px (copie \| terminal).
- **Le terminal** y creuse sa fenêtre sombre : fond `ink-900`, texte
  `ink-100`, rayon 12, bordure `ink-700` ; barre « TERMINAL » en Cinzel
  0.78rem espacé 0.1em `gold-300` ; invites `$ ` en `gold-400` (non
  sélectionnables), commentaires `ink-300`, corps mono 0.8rem/1.8.
  Bouton « Copier » 44 px (bordé `ink-100` à 25 % → or au survol), copie le
  code sans les invites ; états de retour honnêtes : **« Copié ✓ » /
  « Copie impossible »** pendant 2 s — jamais de succès annoncé sans preuve.
- **Le pied** : double règle de tête dorée (`gold-700` 2 px + hairline),
  clôture Cinzel 600 `clamp(1.8rem, 4vw, 2.6rem)` — « La table t'attend. » —
  puis 3 colonnes (L'OUTIL / DONNÉES & RÈGLES / LE DÉPÔT, titres Cinzel
  0.72rem espacé 0.16em `gold-300`) et la rangée sceau 36 px « fait pour la
  table ».

## Bilingue FR|EN

Mécanisme : le HTML porte des PAIRES `[lang="fr"]`/`[lang="en"]`, la langue
inactive est masquée par CSS selon `<html lang>` — la page reste
intégralement lisible en français sans JS, et les lecteurs d'écran
prononcent l'anglais avec la bonne voix. La langue est posée AVANT le premier
rendu par un script inline de `<head>` (localStorage `site-lang`, clé
distincte de l'app, ou `?lang=en` partageable — l'URL persiste la
préférence). `main.js` porte le reste : bascule FR|EN (pilule fixe
haut-droite, cachée sans JS), `<title>` + meta description, attributs
`alt`/`aria-label` (via `data-en-*`, l'original recopié en `data-fr-*` pour
revenir sans dérive), src des captures `assets/screenshots/` ↔
`assets/screenshots-en/` (un seul `<img>` par vue, le src est échangé —
cadres téléphone, portrait et deskframe, visionneuse comprise), légendes des
postes (`data-caption`/`data-en-caption`), chaînes pilotées par JS (démo PV,
bouton copier, marge, bande du tour), et l'étiquette du fil par `content`
CSS.

## Motion — la plume inscrit la page

Une seule courbe : `--ease`. Le geste est **armé par JS uniquement**
(`main.js` pose `.js` sur `<html>` en premier geste) ; seuls `.js .reveal`
commencent invisibles — sans JS, la page est intégralement visible. La
thèse : la page S'ÉCRIT en défilant, le geste du registre de l'app étendu au
scroll — transform et opacité uniquement, une fois par entrée.

| Dispositif | Recette |
|---|---|
| Le filet de tête | `.entry-head::after` : `rule-draw` 0.45s origine gauche — la plume trace la règle |
| Les entrées réglées | chaque `li` de `.subentries` se pose en stagger ×70 ms (`register-rise`, montée 12 px + fondu 0.35s), plafonné à 6 |
| La colonne visuelle | histoire/démo arrive en fin de séquence (`max(delay, 180ms)`), les vues élargies suivent en stagger ×70 ms |
| Le hero | la séance s'ouvre d'elle-même : pastille → nom → slogan → offre → verbes (×70 ms), puis les six tuiles (×60 ms) et le signal ; la paire de téléphones vit sa propre entrée (pair-in) |
| Repos long | les enfants du panneau se posent (×70 ms), le terminal clôt (+40 ms) |
| Les tampons d'ordinaux | l'ordinal frappe la page et s'y pose (`ordinal-stamp` 0.38s, scale 1.7→1, flou 3px→0) quand il franchit la ligne des **42 % du viewport** — APRÈS l'encre du titre. Un observateur manquerait les sauts (ancre, fil de lecture, molette vive) : la LIGNE rattrape tout ce qui la dépasse (`scroll` + `resize`, cadencés `frameGuarded`). Déclenché une fois : l'encre sèche, remonter ne l'efface pas |

Révélations par IntersectionObserver (seuil 0.12, `rootMargin -6%`, unobserve)
; le hero se lève dès l'arrivée, le pied a son observateur propre (×80 ms
par colonne, quadrants de personnalité ×90 ms).

### Le registre s'écrit sous la main (scroll-driven)

Là où `animation-timeline` vit (Chromium, Safari 18.2+ ; Firefox derrière
drapeau), la plume devient **scrubbée** — le bloc vit dans
`@supports (animation-timeline: view())` sous `no-preference`, et le
déclenchement une-fois-par-entrée reste le repli complet.

| Dispositif | Recette |
|---|---|
| Le filet scrubbé | `rule-scrub` (scaleX 0→1) sur `view()`, range `6%→50%` — réversible : remonter l'efface, descendre le réécrit |
| Le titre s'encre | `title-ink` anime `--ink-x` (`@property` en pourcentage) à travers un `mask-image` en dégradé — le balayage d'encre du wordmark du splash de l'app ; range `5%→48%`, la lettre est sèche avant la ligne de lecture |
| La tête ne se lève plus | dans la couche scrubbée, `.entry-head` garde `opacity: 1` : elle S'ÉCRIT (règle + encre + tampon) au lieu de se poser |
| La paire s'enfuit | `pair-back-settle`/`pair-front-settle` (translate composé avec le `rotate` statique) sur `view()` range `exit 0%→90%` — en tournant la page, le téléphone du MD glisse plus loin que celui du joueur : la profondeur de la table |
| Les vues élargies dérivent | `wide-drift` ±10px sur la traversée entière (`entry 0%→exit 100%`) — la parallaxe de la table |

L'ordre d'écriture d'une tête, en descendant : l'encre du titre mène
(achevée ~48 %), le filet suit (~50 %), le sceau tamponne (ligne 42 %
franchie après les deux). En remontant : l'écriture s'efface, le tampon
reste.

`prefers-reduced-motion: reduce` : tout visible, toute animation coupée
(`none !important` sur `.reveal`), filets tracés d'office, ordinaux posés
secs, pas de soulèvement au survol, pas d'étincelle, dé roué ni transition
de marge/bande, défilement `auto`, histoires en repli calme, compteurs
statiques — la page entière se lit, immobile et complète.

## La visionneuse plein écran

Chaque écran (paire du hero, vues d'histoire, cadres et fenêtres bureau)
s'ouvre en plein écran au clic — la visionneuse de l'app, portée telle
quelle, sur rideau de NUIT (`rgba(16,11,6,0.92)`, fondu 0.2s). Même matelas
parchemin que les cadres (9 px, rayons 30/21) ; l'image se pose depuis 0.96
(0.25s `--ease`) — le zoom lui-même ne s'anime jamais, outil de lecture.
`role="dialog"` + `aria-modal`, focus au ✕ 44 px (bordé `ink-100` à 35 %,
or au survol), piège de tabulation à un seul focusable, Échap, clic sur le
rideau, verrou du défilement du corps, rendu du focus au déclencheur.
Légende = l'`alt` de l'image, en italique `ink-100` — jamais réécrite à la
main. L'image naît à la première ouverture (jamais de `<img>` vide), et son
src suit la langue active.

## Accessibilité

Focus visible or (2 px, offset 2). Cibles tactiles : CTA 48 px ; bascule de
langue, pilules de dock, « Copier », verbe de la démo et ✕ de visionneuse
44 px ; ancres de la marge ~44 px (padding 0.9rem) ; liens du texte
rembourrés à ~44 px sans bouger la mise en page (padding 0.75em / marge
−0.75em). Barres de PV : `role="progressbar"` avec `aria-valuetext` français
en direct. Ornements décoratifs `aria-hidden` (ordinaux, fil, pastille de
rencontre, barre du deskframe, dés) ; sceaux en `alt=""`. Légendes d'histoire
`aria-live="polite"` au repos calme, coupées en mode épinglé (voir plus
haut). `color-scheme: dark`, `theme-color` `#2a1f14`, `lang` cohérent,
`scroll-behavior` réduit en mouvement réduit.

## Assets & déploiement

- `site/assets/` est **gitignoré** — `docs/` reste l'unique source de vérité
  des images. Deux chemins d'assemblage font la même copie :
  `scripts/serve-site.mjs` (`npm run site`, port 4188, `cache-control:
  no-cache` — sans validateurs, Chromium photographierait un rendu périmé)
  et le workflow `.github/workflows/site.yml` (publish = `site/` + logo +
  captures FR **et EN** de `docs/`, zéro build, GitHub Pages).
- **Le chrome de combat se pilote par l'état des rencontres, pas par
  l'app** (2026-09, retour utilisateur : JAMAIS de modification du
  produit pour la capture) : la démo garde « Embuscade gobeline »
  ouverte pour les captures de combat, donc TOUT onglet de fiche
  traînait la carte dockée. Le générateur agit par API seule :
  `endFights(c)` clos toutes les rencontres non terminées (PATCH
  `status: ended`), `ensureAmbushMidFight(c)` recrée si besoin
  l'embuscade en plein combat (idempotente par nom+statut, via
  `stageAmbushMidFight`, et rafraîchit `refs.encounterId` — les
  captures traqueur ouvrent `/combat?enc=` sur ce nouvel id). Les
  captures d'onglet (19 tirs : 02–04, 06–10, 14, 18, 19, 21–23, 25–28,
  32) appellent `endFights` avant d'ouvrir la page : plus de rencontre,
  plus de chrome — c'est le comportement du produit, pas un cache.
  Gardent un combat VIVANT : 05 (widget « À toi »), 12 (traqueur),
  24/31 (pupitre/TOC — le sang « en cours »), 33 (bougie traqueur) ;
  29/30 gardent leur `ensureInitiativeEncounter` propre. La 32 (bougie
  fiche) appelle `endFights` : l'étendard y aurait mangé le propos, et
  l'alt du site ne mentionne plus le bandeau.
- **La voix EN ne parle pas de traduction française** (2026, retour
  utilisateur : le visiteur anglophone n'en a rien à faire) : les spans
  [lang="en"] ne mentionnent jamais « in French » — l'offre, les sorts,
  le kg, les LIENS et le pied EN sont débarassés de l'angle ; la
  revendication « en français » ne vit QUE dans la voix FR (offre hero,
  « Le SRD 5.1 entier » était la bande, disparue avec sa fusion hero).
- **Le relevé des entrées ne JUGE PAS en ratio** (2026-09, « section II
  muette ») : une entrée à deux histoires mesure ~7000px — un seuil
  IntersectionObserver à 0,12 exige ~840px visibles, et l'arrivée par
  ancre (#fiche) calculait 0,1179 : JAMAIS franchi, `.reveal` à opacité 0,
  section invisible sans aucune erreur. Le déclencheur est GÉOMÉTRIQUE :
  `threshold: 0` + `rootMargin: '0px 0px -60% 0px'` — le haut de
  l'entrée atteint la moitié haute de l'écran, quelle que soit sa taille.
- Page 100 % statique : HTML + CSS + un IIFE, aucune dépendance ; lisible
  sans JS (voir Motion et Histoires). Canonical, OG et hreflang pointent
  vers `wazoakarapace.github.io/table-sync/` (`fr`, `?lang=en`,
  `x-default`) ; image OG = la première capture.

## Pièges vérifiés (à ne pas réapprendre)

1. **La piste auto du panneau deploy** : `.deploy` exige
   `grid-template-columns: minmax(0,1fr)` dès le mobile — une piste `auto`
   implicite s'étire à la ligne mono la plus longue du terminal et fait
   sortir la page (scrollWidth fantôme, sans vrai défilement visible). Le
   terminal porte aussi `min-width: 0` comme item de grille, même cause.
2. **Toute capture doit exister des DEUX côtés** : la bascule EN échange le
   `src` de chaque image vers `assets/screenshots-en/<même nom>`. Une
   capture absente de `docs/screenshots-en/` y devient une image cassée —
   `31-groupe-pupitre.png` a dû être générée après coup
   (`npm run screenshots -- --only 31 --lang en`).
3. **Le serveur de prévisualisation assemble `site/assets` AU BOOT** :
   redémarrer `npm run site` après avoir régénéré des captures.
4. **Captures plein écran / e2e** : l'épinglage des histoires fait qu'une
   capture pleine page ne montre QU'UN téléphone par zone d'histoire — pour
   shooter un état précis, défiler à `story.top + n × 70vh`.
5. **Ranges de scrub** : le range nommé `entry` ne couvre qu'UNE HAUTEUR
   D'ÉLÉMENT de défilement — les scrubs larges de la page s'écrivent tous en
   pourcentages de la traversée entière (`6% 50%`, `exit 0% exit 90%`…).
6. **Le fil de la démo** : un item `1/-1` placé dans l'ordre du DOM entre
   les deux panneaux les empilerait même en grille deux colonnes — les
   `grid-area` explicites ne sont pas négociables.

## Étendre le système

1. Nouvelle nuance → la définir dans `:root` **et** dans `@theme` de l'app —
   la copie est manuelle, c'est le seul endroit où le monde peut diverger.
2. Nouvelle entrée du registre → ordinal romain suivant en Cinzel
   `aria-hidden`, tête sur filet, copie en feuille (`.entry-copy--folio`,
   deux colonnes ≥900px) ; une seule entrée peut
   être `.is-lead` (sang). Si elle porte un `id`, la marge du registre ET la
   bande du tour l'accueillent toutes seules — rien à câbler. Une seule
   figure par page peut rester la plus grande : le wordmark (règle de la
   couronne). Ne JAMAIS répéter la sous-entrée en puces de synthèse :
   chaque idée vit une fois, dans la feuille.
3. Nouvelle série de captures → `.phonepost.story` avec `--views` inline,
   vues superposées `grid-area: 1/1` SANS `loading="lazy"`, pilules
   `data-view` + `data-caption`/`data-en-caption`, légende initiale dans le
   HTML ; l'épinglage, le rail et les replis calmes se câblent seuls. La
   légende DÉCRIT l'écran (ce qu'on voit), la sous-entrée FAIT la
   promesse (pourquoi ça compte) — jamais la même phrase des deux côtés.
   L'ORDRE DES VUES SUIT L'ORDRE DE LECTURE de la feuille (2026-09,
   retour utilisateur) : le mapping vue→sous-entrée est MONOTONE — en
   faisant défiler l'histoire, l'emphase ne remonte JAMAIS la liste
   (réordonner les vues ou les sous-entrées, jamais les deux en sens
   contraires ; les entrées à deux histoires partagent la feuille —
   chaque histoire doit être monotone de son côté).
   Toute capture utilisée doit exister dans `docs/screenshots/` ET
   `docs/screenshots-en/`.
4. Nouvelle section interactive → contenu visible sans JS, animations armées
   par la classe `.js`, état final statique lisible en mouvement réduit,
   repli calme sans IntersectionObserver — et `aria-live` coupé sur tout ce
   qui avance au scroll.
5. Nouvelle image → partir de `docs/screenshots/` (jamais committer dans
   `site/assets/`), cadre téléphone + `width`/`height`, puis redémarrer
   `npm run site`.
