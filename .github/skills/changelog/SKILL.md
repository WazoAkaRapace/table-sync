---
name: changelog
description: Use when committing or opening a PR on table-sync. Every user-facing change requires a CHANGELOG.json entry — the CI gate fails without it.
---

# Journal des modifications (CHANGELOG.json)

Chaque commit/PR qui change ce que voit un utilisateur (UI, règles, données,
corrections) DOIT ajouter une entrée dans `CHANGELOG.json` à la racine du
repo, **avant le commit**. La CI du workflow `validate` rejette la PR sans
elle. Les déploiements la servent aux joueurs : popup de diff au chargement
et « Journal » dans Mon compte.

## Format

`CHANGELOG.json` = tableau JSON, ordre **antichronologique** (nouveau en tête) :

```json
[
  {
    "sha": "a1b2c3d",
    "date": "2026-10-15",
    "title": "pastilles lisibles",
    "items": [
      "Les pastilles de couleur des monstres sont lisibles sur le parchemin.",
      "Les couleurs se distinguent les unes des autres."
    ]
  }
]
```

### Règles de rédaction

- `sha` : SHA **court** (7 caractères) du commit. Sur une PR avant merge,
  mets le SHA du HEAD de ta branche — le job CI `changelog-stamp` le
  réécrira vers le SHA squash réel après le merge.
- `date` : ISO `YYYY-MM-DD` (jour du commit).
- `title` : 2-5 mots, minuscules, sans verbe — une étiquette
  (« pastilles lisibles », « rail d'initiative »).
- `items` : **une phrase simple par puce**, en français :
  - sujet + verbe + point final. « L'ordre du combat s'affiche sur la fiche. »
  - UNE idée par puce. Deux idées = deux puces.
  - présent de l'indicatif, tutoiement implicite (pas de « vous »).
  - **pas de jargon** : jamais « refactor », « API », « token », « state »,
    « migration » — le lecteur est un joueur à table. Décris l'EFFET :
    « L'application démarre plus vite. » et non « Le bundle est splité ».
  - les changements purement techniques invisibles (CI, lint, build) ne
    méritent PAS de puces — mais s'ils sont seuls dans le commit, ajoute
    quand même l'entrée avec une puce simple si le gate l'exige
    (exception : voir ci-dessous).

### Exceptions (gate toléré sans entrée)

- commits de merge/squash générés par GitHub
- `chore:` touchant SEULEMENT : `.github/`, `scripts/` hors `apps/`,
  `docs/` hors captures, `site/`, le stamp changelog lui-même
- corrections du changelog (`CHANGELOG.json` seul dans le diff)

## Commandes

```bash
# valider le format + l'ordre (toujours avant de pousser)
npm run changelog:check -- --check-format

# valider qu'un SHA précis a son entrée (mode CI)
npm run changelog:check -- --check-sha <sha>

# auto-test interne (fixtures)
npm run changelog:check -- --selftest
```

## Workflow d'une PR

1. Code + tests.
2. Ajoute l'entrée en TÊTE de `CHANGELOG.json` (sha = `git rev-parse --short HEAD`
   du dernier commit de ta branche — si tu ajoutes d'autres commits après,
   mets le sha à jour ou fais un commit vide `changelog: sha` final).
3. `npm run changelog:check -- --check-format` → vert.
4. Pousse. La CI vérifie `--check-sha` contre le head de la PR.
5. Après le squash-merge, `changelog-stamp` (ci.yml) réécrit le sha vers le
   SHA réel du commit main et pousse `[skip ci]`.
