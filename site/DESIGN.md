# Design System — site (marketing)

<!-- impeccable:design-doc -->

Le monde visuel de l'app, **hérité tel quel** : parchemin, encre, sang, or.
Cette surface est la vitrine du produit — une page statique, française, sans
build, servie par GitHub Pages — et son parti pris structurel est le produit
lui-même : **la landing EST une fiche de personnage D&D 5e** (graine 28d9a99e,
candidat 5/7). L'en-tête de fiche (sceau, champs, portrait) sert de hero, les
six caractéristiques FOR→CHA portent les preuves, les capacités défilent en
registre à ordinaux romains I–V, et le « Repos long » est l'auto-hébergement.
Refusé : l'agencement hero→fonctionnalités→CTA du SaaS. Deux familles de
surfaces, comme dans l'app : la carte blanche levée (`.panel`) pour le hero,
la démo et le déploiement ; la surface réglée — entrées à même le parchemin,
séparées par des filets — pour le registre des capacités.

## Tokens — `site/styles.css` `:root`

Copie **exacte et manuelle** de `apps/web/src/index.css` `@theme` (préfixe
`--color-` retiré). Il n'y a aucun lien de build : toute nuance changée d'un
côté doit l'être de l'autre.

| Rampe | Rôle | Valeurs |
|---|---|---|
| `--parchment-*` | fonds, surfaces, bordures | 50 `#fdfaf3`, 100 `#f7f0e1`, 200 `#ece0c4`, 300 `#ddcb9e`, 400 `#c9b074`, 500 `#b8975a` |
| `--ink-*` | texte (brun d'encre) | 100 `#e9e1d4`, 300 `#a8926f`, 400 `#7d6850`, 500 `#6b5640`, 600 `#5b4733`, 700 `#4a3825`, 800 `#3a2b1c`, 900 `#2a1f14` |
| `--blood-*` | CTA, tuile courante, dégâts | 50 `#faf0f0`, 100 `#f0d4d4`, 200 `#dda3a3`, 300 `#c05151`, 400 `#a92424`, 500 `#8b1a1a`, 600 `#7a1f1f`, 700 `#651515` |
| `--gold-*` | magie, terminal, sélection | 100 `#f6ecd2`, 300 `#e3c766`, 400 `#d4af37`, 500 `#b8975a`, 700 `#7e6439` |
| `--rule-*` | sens de règle uniquement (démo PV) | green `#22c55e`, yellow `#eab308`, red `#ef4444` |

Typographie : `--font-display` (Cinzel — titres, ordinaux, libellés de
fiche), `--font-body` (Iowan Old Style, Palatino, Georgia — corps),
`--font-mono` (pile système — valeurs mesurées uniquement : compteurs, PV,
commandes, DD). Cinzel vient de Google Fonts (400/600/700, preconnect) ;
Iowan Old Style est une police système, sans webfont — Palatino/Georgia
portent le elsewhere. `--font-sans` (Inter) n'est **pas** emporté.

Motion et ombres : une seule courbe `--ease: cubic-bezier(0.16, 1, 0.3, 1)` ;
`--shadow-card` (0 1px 2px + 0 4px 12px, encre 4 %/3 %) et `--shadow-raised`
(0 4px 8px + 0 14px 32px, 8 %/14 %) — teintées `ink-900`, jamais de noir pur.

## Base

Corps 17 px (1.0625rem)/1.65 sur `parchment-50`, avec deux voiles radiaux
**fixes** : or à 6 % en haut-gauche, sang à 4 % en bas-droite — la page
entière est un parchemin éclairé, pas un fond plat. Mesure unique `.wrap`
(max-width 68rem, padding 1.25rem → 2.5rem à 768px). Liens `blood-600` →
`blood-500` au survol ; `:focus-visible` = contour 2 px `blood-500` offset 2 ;
sélection `gold-100`. Titres h1–h3 en Cinzel 600, `text-wrap: balance`.

## La fiche comme landing — structure

| Dispositif | Recette |
|---|---|
| Carte hero (`.panel`) | blanc 85 %, bordure `parchment-200`, rayon 16 px, `shadow-card` ; padding `clamp(1.5rem, 4vw, 3rem)` |
| Sceau | logo rond 5.5rem, anneau 2 px `parchment-300`, `shadow-card` — le cachet de la maison |
| Nom / offre | h1 `clamp(2.1rem, 5.5vw, 3.4rem)` resserré (−0.02em) ; offre 1.15rem `ink-700`, plafonnée 34rem |
| Champs de fiche (`sheet-fields`) | CLASSE / HISTORIQUE / TAILLE / LANGUE : dt Cinzel 0.7rem espacé 0.14em `ink-500`, dd 0.95rem `ink-700`, posés sous un filet `parchment-200` |
| Portrait | la capture réelle `01-parties.png` (390×844) dans un cadre : rayon 20 px, bordure `parchment-300`, matelas 8 px sur `parchment-100` — le « portrait de fiche » EST l'app |
| CTA | deux boutons 44 px : « Code source sur GitHub » (primaire `blood-600`) + « Auto-héberger en 3 commandes » (secondaire `parchment-200`, ancre interne) |
| Six tuiles (`abilities`) | FOR→CHA, grille 2→3→6 colonnes (640/1024px) ; tuile blanche 60 % bordée `parchment-200`, rayon 12 ; libellé Cinzel 0.72rem espacé 0.18em, **score Cinzel 2.2rem `ink-800`**, fait 0.82rem `ink-500` |
| Tuile courante | DEX (le temps réel, la différenciatrice) porte `.is-lead` : score `blood-600`. Une seule tuile sang — l'équivalent de l'entrée courante du registre |
| Personnalité | les quatre quadrants de fiche 5e (TRAITS / IDÉAUX / LIENS / DÉFAUTS), cartes blanches 60 % 2 colonnes — sans ordinal, hors sommaire |
| Pied | double règle de tête, 3 colonnes (L'OUTIL / DONNÉES & RÈGLES / LE DÉPÔT), rangée sceau 36 px « fait pour la table » |

## La grammaire du registre sur cette page

Le dialecte réglé de l'app, transplanté : pas de fond, pas de grille de
cartes — les entrées sont posées à même le parchemin et séparées par des
filets.

| Dispositif | Recette |
|---|---|
| Ordinaux romains I–V | colonne Cinzel `min-width: 2.5rem` alignée à droite, `aria-hidden` ; `ink-300` 1.25rem au repos |
| Entrée courante (`.is-lead`, entrée I « La table en temps réel ») | ordinal `blood-500` 1.6rem — le sang marque « maintenant », une seule entrée |
| Tête d'entrée | ordinal + h2 `clamp(1.35rem, 3vw, 1.75rem)` sur filet `parchment-200` (pb 0.9rem, mb 2rem) |
| Tête compacte (`.entry-head-compact`, Repos long) | même recette resserrée dans le panneau : pb 0.7rem, mb 1.2rem |
| Sommaire (`toc`) | liens `ink-700` soulignés `parchment-300`, joints par « · » `ink-300` ; survol `blood-600` + trait `blood-300` |
| Corps d'entrée | à 1024px : colonnes `minmax(0,1fr) 380px` (copie \| visuels) ; copie plafonnée 62ch |
| Sous-entrées réglées | `h3` 1.1rem + paragraphe `ink-700`, chaque `li` refermé par un filet `parchment-200` — jamais de carte |
| Preuves mesurées (tampon) | `.proof li` : mono 0.78rem espacé 0.05em, `ink-700` sur `parchment-100` bordé `parchment-200`, rayon 8 — pour les valeurs comptables (646 objets, 490 sorts, 964 monstres, 16 états, kg, cache 5 min) |
| Preuves en phrases | `.proof li.phrase` : la phrase quitte le tampon — italique corps 0.9rem, sans fond ni bordure, tokens joints par « · » `ink-300`. **Le tampon mono est réservé au mesurable ; une phrase ne se met jamais en tampon** |

## La démo temps réel (entrée I)

Le dispositif signé de la page : deux panneaux et un fil.

| Dispositif | Recette |
|---|---|
| Panneaux | TRAQUEUR (« Embuscade gobeline · écran du MD ») et FICHE (« Lyra · téléphone du joueur ») : blanc 65 % bordé `parchment-200`, rayon 12 ; titre Cinzel 0.72rem espacé 0.16em + qui/quoi en corps 1rem `ink-800` |
| Le fil | `.wire` : trait pointillé `parchment-400`, étiqueté « temps réel » en italique 0.72rem sur pastille `parchment-50`, `aria-hidden` — le WebSocket, littéralisé. Placement explicite par `grid-area` (`demo-tracker` 1/1, `demo-sheet` 1/2, fil 2/1/-1, note 3/1/-1 à ≥640px) : un fil `1/-1` dans l'ordre du DOM empilerait les panneaux même en deux colonnes ; sous 640px, flux naturel empilé avec le fil entre les panneaux. L'entrée I (`with-demo`) reçoit deux colonnes égales à ≥1024px — la démo a la largeur d'une scène, la capture sous la démo reste plafonnée à 380px |
| Barre de PV | piste 10 px pilule `parchment-200`, remplissage `--rule-green` ; paliers HpBar : jaune ≤ 50 %, rouge ≤ 25 % (seuils `ceil`, 0.6s `--ease`) ; lecture mono « Lyra · 24/31 PV » côté MD, « 24/31 PV » côté joueur |
| Verbe du MD | `⚔ Infliger 9 dégâts` : bouton **sang doux** (fond `blood-50`, bordure `blood-200`, texte `blood-700`, survol `blood-100`), 44 px — le sang plein reste réservé aux CTA ; c'est un membre secondaire du système de boutons |
| Puce de dégâts | pilule mono 0.8rem blanc sur `blood-600` : « ⚔ 9 dégâts → fiche de Lyra », monte de 4 px |
| Alerte concentration | 🌀 sur `gold-100` bordé `gold-300` : « jet de CON `DD 10` » (DD en mono), monte de 6 px |

Comportement (`main.js`) : une frappe à la fois (garde `strikeTimer`) ; la
puce paraît, 450 ms plus tard les DEUX barres tombent et l'alerte monte ; à
3,4 s tout se réarme (Lyra se soigne). Première frappe offerte quand la démo
entre à l'écran (IntersectionObserver, seuil 0.6, +700 ms, une seule fois).
Sous `prefers-reduced-motion` : **état final statique** — 22/31, puce et
alerte visibles, tout lu sans animation. Sans IntersectionObserver la démo
reste tapable.

## Captures en cadre téléphone

Toutes les images de l'app sont traitées comme des téléphones posés sur le
parchemin : cadre rayon 30 px, bordure `parchment-300`, matelas 9 px sur
`parchment-100`, `shadow-card` ; écran interne rayon 21 px ; légende 0.8rem
`ink-500` centrée. Au survol le cadre se soulève (`shadow-raised` +
translateY(−3px), 0.3s `--ease` ; aucun soulèvement en mouvement réduit).
Le portrait du hero est la variante calme : rayons 20/13 px, matelas 8 px,
pas de survol. Attributs `width`/`height` (390×844) partout — zéro décalage
de mise en page.

**Une série, c'est deux cadres maximum en pile** (`.shots` en pile centrée,
`.shots-duo` en 2 colonnes plafonnées 26rem, `loading="lazy"`). Au-delà de
deux vues, la série devient un **poste de consultation** (`.phonepost`) : un
seul téléphone vivant, jamais une chaîne de cadres identiques.

## Le poste de consultation (série de l'entrée II)

| Dispositif | Recette |
|---|---|
| L'écran | `.phonepost-screen` : un cadre `.shot-frame` en `display: grid` ; les vues `.phonepost-view` superposées en `grid-area: 1/1`, fondu 0.25s `--ease` + montée 6 px — une seule `.is-active` |
| Le dock | `.phonepost-dock` sous le cadre — le vocabulaire du dock de l'app : pilules rayon 999, 44 px, bordées `parchment-300` sur blanc 65 % ; active = `ink-800` plein, texte `parchment-50` (le sang reste réservé aux CTA et à la démo) ; `aria-pressed` par pilule |
| La légende | `.phonepost-caption` : italique corps 0.85rem `ink-500` centrée, `aria-live="polite"`, hauteur réservée 2.6em — le texte suit la vue active, le dock ne saute jamais |
| Comportement (`main.js`) | un pilier par vue : bascule `.is-active` sur vue + pilule, `aria-pressed`, légende depuis `data-caption` |

Règle : les vues d'un poste se chargent toutes (pas de `lazy` — l'échange ne
 doit jamais afficher un écran vide) ; en mouvement réduit, l'échange est
 instantané (fondu et montée coupés).

## Le terminal (entrée V)

L'écran du bricoleur, dans le monde : fond `ink-900`, texte `ink-100`, rayon
12, bordure `parchment-300`. Barre de titre « TERMINAL » en Cinzel 0.78rem
espacé 0.1em `gold-300` sur filet `ink-100` à 12 % ; invites `$ ` en
`gold-400` (non sélectionnables), commentaires en `ink-300`, corps mono
0.8rem/1.8. Bouton « Copier » : 44 px, transparent, bordure `ink-100` à
25 % → or au survol ; copie le code sans les invites. États de retour
honnêtes, comme le tampon copier de l'app : **« Copié ✓ » / « Copie
impossible »** pendant 2 s — jamais de succès annoncé sans preuve.

## Motion

Une seule courbe : `--ease` `cubic-bezier(0.16, 1, 0.3, 1)`. La pose du
registre est **armée par JS uniquement** : `main.js` ajoute `.js` sur
`<html>` en premier geste, et seuls `.js .rise` commencent invisibles —
sans JS, le contenu est intégralement visible. `register-rise` : montée de
12 px + fondu, 0.35s, déclenchée par IntersectionObserver (seuil 0.25, une
fois par bloc). Sur cette page le dispositif n'arme qu'**un** bloc `.rise`
(la copie de l'entrée courante) — l'entrée de tête se pose, puis plus rien
ne bouge hors interactions (chips, barres, soulèvements de cadres).
`prefers-reduced-motion: reduce` coupe tout : `.rise` visible sans
animation (`none !important`), défilement `auto`, cadres sans soulèvement,
barres et puces sans transition — avec états finaux lisibles. `html` a
`scroll-behavior: smooth` pour les ancres du sommaire (auto en mouvement
réduit).

## Accessibilité

Cibles tactiles ≥ 44 px sur les trois contrôles (`.btn`, `⚔ Infliger`,
« Copier »). Barres de PV : `role="progressbar"` avec `aria-valuenow` et
`aria-valuetext` français mis à jour en direct (« 22 sur 31 points de
vie »). Ornements décoratifs `aria-hidden` (ordinaux, fil, double règle) ;
sceaux en `alt=""`. Focus visible sang (2 px, offset 2). Images avec `alt`
français décrivant le contenu réel. `lang="fr"`, `scroll-behavior` réduit.

## Assets & déploiement

- `site/assets/` est **gitignoré** — `docs/` reste l'unique source de
  vérité des images. Deux chemins d'assemblage font la même copie :
  `scripts/serve-site.mjs` (`npm run site`, port 4188, `cache-control:
  no-cache` — sans validateurs, Chromium photographierait un rendu périmé)
  et le workflow `.github/workflows/site.yml` (publish = `site/` + logo +
  captures de `docs/`, zéro build, déploiement GitHub Pages).
- Page 100 % statique : HTML + CSS + un IIFE JS, aucune dépendance ;
  lisible sans JS (voir Motion). Canonical et OG pointent vers
  `wazoakarapace.github.io/dnd-inventory/`, image OG = la première capture.

## Étendre le système

1. Nouvelle nuance → la définir dans `:root` **et** dans `@theme` de l'app —
   la copie est manuelle, c'est le seul endroit où le monde peut diverger.
2. Nouvelle entrée du registre → ordinal romain suivant en Cinzel
   `aria-hidden`, tête sur filet, sous-entrées réglées ; une seule entrée
   peut être `.is-lead` (sang).
3. Nouvelle preuve → tampon mono si c'est un nombre mesurable, `.phrase`
   italique jointe par «·» sinon ; jamais l'inverse.
4. Nouvelle section interactive → contenu visible sans JS, animations
   armées par la classe `.js`, état final statique lisible en mouvement
   réduit.
5. Nouvelle image → partir de `docs/screenshots/` (jamais committer dans
   `site/assets/`), cadre téléphone + `width`/`height`.
