---
name: changelog
description: Use when committing or opening a PR on table-sync. Every user-facing change requires a CHANGELOG.json entry carrying the release version — the CI gate fails without it.
---

# Journal des modifications (CHANGELOG.json)

Chaque PR qui change ce que voit un utilisateur (UI, règles, données,
corrections) DOIT ajouter une entrée dans `CHANGELOG.json` à la racine du
repo, **avant d'ouvrir la PR**. La CI du workflow `validate` rejette la PR
sans elle. Au merge, la CI pose le SHA réel, crée la **release GitHub**
`<version>` (notes = tes puces) et déploie les images depuis cette release —
la version est donc déclarée PAR TOI, une seule fois, sans course au SHA.

## Format

`CHANGELOG.json` = tableau JSON, ordre **antichronologique** (nouveau en tête) :

```json
[
  {
    "version": "2026.10.15",
    "sha": null,
    "date": "2026-10-15",
    "title": "journal des modifications",
    "items": [
      "L'application affiche les nouveautés après chaque mise à jour.",
      "Le journal complet est disponible dans Mon compte."
    ]
  }
]
```

### Règles de rédaction

- `version` : **calver `YYYY.MM.DD`** (la date du jour). Plusieurs versions
  le même jour → suffixe `-2`, `-3`… Le tag de la release GitHub porte
  EXACTEMENT cette valeur — pas de `v` préfixe.
- `sha` : laisse `null` — le job `changelog-release` pose le SHA squash
  après le merge. Ne mets jamais un SHA à la main.
- `date` : ISO `YYYY-MM-DD` (jour de l'entrée).
- `title` : 2-5 mots, minuscules, sans verbe — une étiquette
  (« pastilles lisibles », « rail d'initiative »).
- `items` : **une phrase simple par puce**, en français :
  - sujet + verbe + point final. « L'ordre du combat s'affiche sur la fiche. »
  - UNE idée par puce. Deux idées = deux puces.
  - présent de l'indicatif, tutoiement implicite (pas de « vous »).
  - **pas de jargon** : jamais « refactor », « API », « token », « state »,
    « migration » — le lecteur est un joueur à table. Décris l'EFFET :
    « L'application démarre plus vite. » et non « Le bundle est splité ».

### Exceptions (gate toléré sans entrée)

- commits de merge/squash générés par GitHub
- les commits du bot (`changelog:`, `changelog-release:`, `[skip ci]` —
  stamp de SHA, création de release)
- `chore:` touchant SEULEMENT : `.github/`, `scripts/` hors `apps/`,
  `docs/` hors captures, `site/`, le changelog lui-même

## Commandes

```bash
# valider le format + l'ordre (toujours avant de pousser)
npm run changelog:check -- --check-format

# valider qu'une version précise a son entrée (mode CI)
npm run changelog:check -- --check-version 2026.10.15

# auto-test interne (fixtures)
npm run changelog:check -- --selftest
```

## Workflow d'une PR

1. Code + tests.
2. Ajoute l'entrée en TÊTE de `CHANGELOG.json` : `version` = calver du jour
   (suffixe `-2` si une version est déjà sortie aujourd'hui), `sha: null`.
3. `npm run changelog:check -- --check-format` → vert.
4. Pousse, ouvre la PR. La CI vérifie la version de ta première entrée.
5. Après le squash-merge : `changelog-release` (ci.yml) pose le SHA réel,
   crée la release `<version>` avec tes puces en notes, et le build de
   déploiement (release: published) construit les images avec
   `APP_VERSION=<version>` — les joueurs voient la version lisible dans
   « Mon compte » et le popup de nouveautés au chargement suivant.
