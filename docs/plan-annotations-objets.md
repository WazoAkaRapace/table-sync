# Plan — Annotations sur objets-illustrations (dessin + notes, par exemplaire)

**PR #76 (suite)** · Objectif : le joueur qui porte un objet illustré peut dessiner/écrire sur l'image, dans la visionneuse, via une petite barre d'outils. L'annoté devient **la copie propre à cet exemplaire** : l'image de l'objet de base n'est jamais touchée, et l'annoté **survit aux échanges d'inventaire** (transfert entre personnages).

## 1. Décision structurante : l'exemplaire annoté devient un objet dérivé

**Modèle retenu : « derived item »** — au premier enregistrement d'une annotation, la ligne d'inventaire se détache de l'objet de base et pointe vers une **copie dérivée** de l'objet (nouvelle ligne `items`, même nom/poids/description, `derived_from_item_id` = base, image = JPEG annoté).

Pourquoi pas les alternatives :
- **Clé `(character_id, item_id)`** (table d'annotations) : détruite par le transfert (la route supprime la ligne source) et ambiguë quand deux piles fusionnent (`onConflictDoUpdate`) — deux lettres annotées différemment ne peuvent pas fusionner physiquement.
- **Clé `inventory.id`** : la ligne est supprimée au transfert → ne survit pas, exigence non tenue.

Ce que le modèle dérivé obtient **gratuitement** (machinerie existante, zéro changement) :
- **Transfert** : la ligne dérivée est un objet comme un autre → échange, fractionnement, fusion tous intacts. L'annoté suit l'objet, de joueur en joueur.
- **Granularité par exemplaire** : pile de 3 lettres, une annotée → split automatique (2 base + 1 annotée), exactement comme le réel — deux joueurs annotant chacun leur copie produisent deux dérivés indépendants.
- **`hasImage`** : le dérivé porte son image → glyphe 🗺, vignette et visionneuse continuent de marcher sans toucher la ligne d'inventaire.
- **L'objet de base n'est jamais modifié** : son `image_url` reste l'original (exigence 1 trivialement tenue).

## 2. Données & API

### Migration `0008` (drizzle, workflow habituel)
`items.derived_from_item_id INTEGER NULL REFERENCES items(id) ON DELETE SET NULL`
- SET NULL : si le MD supprime l'objet de base, l'exemplaire annoté vit sa vie (ligne d'inventaire intacte — elle référence le dérivé, pas la base).

### Nouvelle route `POST /api/inventory/:id/annotation` (multipart `image`)
1. Portes : propriétaire de la fiche ou MD (`isOwnerOrGM`), objet `hasImage`.
2. Transaction (motif existant de `/transfer`) :
   - crée le dérivé : copie des colonnes de l'objet de base ; **`party_id` = celle du personnage** (piège SRD : base globale `party_id NULL` → le dérivé doit rester dans le groupe, sinon visible partout) ; `source='custom'`, `derived_from_item_id` = base ; `image_url` = fichier annoté ;
   - si `qty > 1` : décrémente la ligne existante, insère une ligne qty 1 pointant le dérivé (split, comme un transfert partiel) ; sinon `UPDATE inventory SET item_id = dérivé` ;
   - écrit le JPEG dans `data/images/items/<dérivé>.jpg` (plafond 2 Mo, sniff magic-bytes — mêmes gardes que le PUT image) ;
   - bus `inventory:change` + `custom-item`.
3. Retour : l'entrée d'inventaire mise à jour.

### `POST /api/inventory/:id/annotation/reset`
Remet l'exemplaire sur l'objet de base : upsert-fusion de la quantité vers la base (motif `/transfer`), suppression du dérivé + de son fichier, bus events. (L'original de la base réapparaît ; les annotations partent.)

### Recherche & catalogues : exclure les dérivés
`GET /items` (recherche joueur + MD) et l'onglet Objets custom du MD filtrent `derived_from_item_id IS NULL` — les copies annotées ne polluent ni la recherche ni le catalogue (sinon chaque annotation deviendrait un objet « ajoutable »).

### Contrat réactivité — inchangé
Toujours zéro octet dans les payloads JSON ; l'upload n'a lieu qu'au clic Enregistrer (un JPEG ≤ 2 Mo composite côté client) ; le GET image dérivé est cache-immutable comme l'original.

## 3. Visionneuse — barre d'outils (mobile-first, une main)

`ItemImageViewer` gagne un mode édition quand il est ouvert **depuis une ligne d'inventaire** (lui passer le contexte `entryId` éditable ; l'ouverture depuis le dashboard MD reste lecture seule).

**Barre flottante basse** (au-dessus de la ligne d'indice gestuelle, `env(safe-area-inset-bottom)`), pastilles 44px, fond `bg-ink-900/70` sur le noir 85 % :

| Outil | Recette |
|---|---|
| 🖐 Naviguer | mode par défaut — pan/zoom existant (double-tape 2,5×) |
| ✏️ Dessiner | doigt = trait ; palette 4 pastilles : `blood-600`, `ink-900`, `gold-500`, `parchment-50` (blanc pour les zones sombres) ; 2 épaisseurs ; retour au navigateur par re-tape |
| **T** Écrire | tape = pose un point d'insertion → champ de saisie flottant au-dessus du clavier → Entrée valide, le texte se rend au point tapé (police italique existante — pas de police nouvelle) |
| ↩︎ | annule le dernier trait/texte (pile mémoire de session) |
| 🗑 | tout effacer — ConfirmButton, la signature maison |
| Enregistrer | composite base + annotations → `downscaleImage` (max 1280, JPEG 0.85) → `POST …/annotation` ; état « Enregistrement… » ; toast d'erreur ciblé + l'annoté reste en session (jamais de perte silencieuse) |

**Détails canvas** : un `<canvas>` en overlay dans le wrapper transformé existant (le zoom/pan s'applique aux deux) ; traits et textes stockés en coordonnées normalisées [0..1] (indépendants du zoom, rejouables) ; le composite se fait à la résolution naturelle de l'image de base ; dessiner pendant le zoom mappe les coordonnées pointeur via le rect de l'`<img>`. `prefers-reduced-motion` respecté ; interdiction de fermer avec des annotations non enregistrées sans confirmation (ConfirmButton).

**Après enregistrement** : invalidation react-query (inventaire + items) → la vignette et la ligne re-render sur le dérivé (même libellé, glyphe intact) ; l'utilisateur ne voit pas de changement d'identité — sauf la pile éventuellement splittée en deux lignes (réel : la lettre annotée est un objet distinct).

## 4. États & cas limites

| Cas | Comportement |
|---|---|
| Pile qty > 1 annotée | split : qty−1 sur la base + 1 ligne dérivée (motif transfert partiel) |
| Deux joueurs annotent chacun leur copie | deux dérivés indépendants — correct par construction |
| Transfert de l'exemplaire annoté | inchangé — la ligne dérivée voyage telle quelle (c'est LE gain du modèle) |
| Le MD supprime l'objet de base | dérivé orphelin (`SET NULL`) mais vivant ; la ligne d'inventaire et l'image restent |
| Reset | re-fusion sur la base, dérivé + fichier supprimés |
| Le MD édite la base ensuite | le dérivé diverge (copie figée) — acceptable : l'objet est parti du catalogue |
| Équipé / notes sur la ligne au split | la pile d'origine conserve son état ; la ligne dérivée naît neutre (qty 1, non équipée) |
| Fermer sans enregistrer | confirmation deux temps si traits/textes en session |
| Échec d'upload | toast ciblé, annotations conservées en session, Réessayer |

## 5. Anti-buts (v1)
- Pas de calques vectoriels persistés (les annotations sont aplaties en JPEG à l'enregistrement ; l'éditabilité post-save = v2 éventuelle via stockage des traits).
- Pas de multi-page, pas de formes (rectangle/flèche), pas de gomme pixel — stylo, texte, annuler, effacer.
- Le dashboard MD reste en lecture seule (annoter = le joueur sur SA fiche, ou v2 MD).

## 6. Tests

**API (`mod-item-annotations.ts`)** : portes (propriétaire ✓, MD ✓, autre joueur 403, hors-groupe 403) ; split qty>1 correct ; qty=1 swap item_id ; dérivé caché de la recherche ; reset re-fusionne et supprime le fichier ; transfert d'un dérivé (l'annoté survit — assert image octet-identique après transfert) ; suppression de la base → dérivé vivant.

**E2E (`e2e/item-annotations.spec.ts`)** : ouvrir la visionneuse depuis la ligne → ✏️ → tracer un trait (mouse events) → Écrire → saisir « Ici ! » → Enregistrer → la vignette re-render (assert visuel + API : la ligne pointe un dérivé) ; transférer l'exemplaire au clerc → l'image annotée toujours là (GET dérivé 200) ; l'image de base jamais modifiée (octets identiques avant/après).

## 7. Ordre d'implémentation
1. Migration `0008` + colonne schéma + exclusion recherche/catalogues
2. Routes annotation + reset (+ fixtures api-tests)
3. Viewer : barre d'outils, canvas overlay, traits/textes normalisés, composite + save
4. Intégration InventoryRow (contexte éditable) + invalidations
5. Tests API puis E2E, gates complets (`lint`, `tsc -b`, `test-api`, `test:e2e`), push sur `feat/item-images`
