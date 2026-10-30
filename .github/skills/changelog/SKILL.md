---
name: changelog
description: Use when committing or opening a PR on table-sync. Every user-facing change requires a CHANGELOG.json entry — version stays null; the release tag assigns it.
---

# Journal des modifications (CHANGELOG.json)

Chaque PR qui change ce que voit un utilisateur (UI, règles, données,
corrections) DOIT ajouter une entrée dans `CHANGELOG.json` à la racine du
repo, **avant d'ouvrir la PR**. La CI du workflow `validate` rejette la PR
sans elle.

**La version n'est plus choisie par l'auteur** : pose `"version": null`.
Les releases sont pilotées par TAG — quand on veut sortir, on pousse
`git tag vYYYY.MM.DD && git push origin vYYYY.MM.DD` : le workflow
`Release (tag)` versionne TOUTES les entrées en attente (suffixes -2, -3…
automatiques si besoin), les stamp du sha, crée la release GitHub et
dispatche le build des images. Merger une PR ne release RIEN ; tagger
release tout ce qui a été mergé.

## Format

`CHANGELOG.json` = tableau JSON, ordre **antichronologique** (nouveau en tête) :

```json
[
  {
    "version": null,
    "sha": null,
    "date": "2026-10-30",
    "title": "journal des modifications",
    "items": [
      "L'application affiche les nouveautés après chaque mise à jour.",
      "Le journal complet est disponible dans Mon compte."
    ]
  }
]
```

### Règles de rédaction

- `version` : **`null`** — le workflow release du tag pose le calver
  `YYYY.MM.DD` (+ suffixes automatiques si plusieurs entrées le même jour).
- `sha` : `null` toujours — le workflow release le pose au tag.
- `date` : ISO `YYYY-MM-DD` (jour de l'entrée).
- `title` : 2-5 mots, minuscules, sans verbe — une étiquette
  (« pastilles lisibles », « rail d'initiative »).
- `items` : **une puce courte par fonctionnalité**, en français :
  - UNE fonctionnalité = UNE puce — jamais plusieurs puces pour décrire le
    même changement, et la puce reste COURTE (une ligne, ~12 mots) :
    « L'animation de l'ordre d'initiative à la fin du tour est corrigée. »
  - décris CE QUI A ÉTÉ FAIT, jamais COMMENT c'est fait : une correction
    se formule « <la chose cassée> est corrigée », une nouveauté
    « <la chose nouvelle> arrive » — pas le détail du comportement ni le
    mécanisme (« est corrigée », pas « s'anime en trois temps qui… »).
  - CENTRÉE JOUEUR : la chose décrite est celle que la personne à table
    voit ou obtient (« l'ordre d'initiative », pas « le FLIP du rail »).
  - sujet + verbe + point final. « L'ordre du combat s'affiche sur la fiche. »
  - présent de l'indicatif, tutoiement implicite (pas de « vous »).
  - **sans jargon technique** : jamais « refactor », « API », « token »,
    « state », « composant », « migration » — le lecteur est un joueur à
    table, pas un développeur. Décris l'EFFET : « L'application démarre
    plus vite. » et non « Le bundle est splité ».

### Exceptions (gate toléré sans entrée)

- commits de merge/squash générés par GitHub
- les commits du bot (`changelog:`, `changelog-release:`, `[skip ci]` —
  versionnement par tag, création de release)
- `chore:` touchant SEULEMENT : `.github/`, `scripts/` hors `apps/`,
  `docs/` hors captures, `site/`, le changelog lui-même

## Commandes

```bash
# valider le format + l'ordre (toujours avant de pousser)
npm run changelog:check -- --check-format

# valider qu'une entrée en attente existe (mode CI, PR)
npm run changelog:check -- --check-pending

# auto-test interne (fixtures)
npm run changelog:check -- --selftest
```

## Workflow d'une PR

1. Code + tests.
2. Ajoute l'entrée en TÊTE de `CHANGELOG.json` : `version: null`,
   `sha: null`, la date du jour.
3. `npm run changelog:check -- --check-format` → vert.
4. Pousse, ouvre la PR. La CI vérifie la présence d'une entrée en attente.
5. Au merge : RIEN ne sort — le code s'accumule sur main.

## Workflow d'une release

```
git tag v2026.11.01 && git push origin v2026.11.01
```

Le workflow `Release (tag)` fait tout : versionne le lot d'entrées en
attente (calver de la date du TAG ; si le jour a déjà des versions, le lot
démarre au premier suffixe libre), stamp les sha, committe et pousse main,
crée la release GitHub (notes = une section par entrée), dispatche le build
d'images avec `APP_VERSION=<calver>`. Les joueurs voient la version lisible
dans « Mon compte » et le popup de nouveautés au chargement suivant.
Ensuite : redeploiement Arcane (skill docker-management-arcane) puis
`version.json` en prod comme preuve.

Si le tag part avant que la CI des PR mergées soit verte, la release embarque
quand même — on tague donc sur un main validé.
