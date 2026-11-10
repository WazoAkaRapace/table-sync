# Contenus personnalisés — Synthèse & plan maître

> **Date :** 2026-11-10 · **Statut : PLANIFIÉ, pas implémenté.** Décisions produit tranchées par Mika le même jour.

**Objectif :** étendre la création de contenus personnalisés (aujourd'hui objets + armes) aux **armures** (joueurs si toggle MD, pattern armes), **monstres** (MD seul) et **sorts** (MD seul, apprenables par les joueurs via le grimoire filtré par classes).

## Les 4 documents (à lire dans l'ordre)

| # | Document | Contenu |
|---|---|---|
| 1 | `plan-custom-content-product.md` | Spec fonctionnelle ancrée dans le code : état des lieux, user stories, champs, permissions, cas limites, MVP. **§8 = décisions tranchées (arbitrage Mika 2026-11-10)**. |
| 2 | `plan-custom-content-architecture.md` | Modèle de données (arbitrages table par table), contrat API complet (TypeBox, permissions, erreurs FR), shared/computeAC, événements WS v2, plan de tests, **3 PRs disjointes**, risques. §8 = 8 positions d'implémentation. |
| 3 | `plan-custom-content-frontend.md` | Brief impeccable shape (sans code) : 6 surfaces S1–S6, topologie des formulaires, composants réutilisés/à créer (~50 clés i18n fr+en), a11y/mobile. §6 = 6 micro-décisions UX (reco par défaut). |
| 4 | `plan-custom-content-marketing.md` | Section « Votre monde, vos règles » (#vos-regles) du site statique, 7 captures 34–40 en deux tranches, impact fichiers, 7 décisions tranchées. |

## Décisions tranchées (arbitrage Mika, 2026-11-10)

- **Tout le bloc de recommandations produit (Q1–Q11) et marketing (Q1–Q7) est approuvé.**
- Précisions : sorts custom **apprenables librement, filtrés par la liste de classes déclarée** ; créations = **onglets dédiés du pupitre du MD** (pas de création au fil de l'eau grimoire/bestiaire).
- Piliers : scoping **par groupe** ; sorts dans la table `spells` (+`source/party_id/created_by`, `srd_index` synthétique) ; monstres dans `monsters` (+colonne `origin` — `source` éditorial déjà pris, découvert en base) ; **armures sans migration** (colonnes `items` déjà là) avec `armor_family` explicite lu par `computeAC` (repli heuristique, rétro-compat vérifiée : 0 divergence sur les 42 armures seedées).

## Reste à confirmer (non bloquant pour démarrer, à trancher AVANT la PR concernée)

1. **8 positions d'architecture** (plan archi §8) — notamment : DELETE 409+`?force=1` pour les sorts, ETag déclenché par `partyId`, garde 403 inter-groupes sur l'apprentissage, `magicBonus` appliqué avec `ac_base` explicite. Recommandées telles quelles ; les positions 3, 4, 8 changent le contrat HTTP au-delà de la lettre de la spec.
2. **6 micro-décisions UX** (plan frontend §6) — reco à appliquer par défaut au premier rendu réel.

## Roadmap d'exécution (3 PRs backend→UI + 1 marketing)

1. **PR Armures** (sans migration) : `validateArmorFields`, `computeAC` armorFamily + magicBonus, panneau Armure pupitre + création joueur, e2e sur gabarit `custom-weapon.spec.ts`.
2. **PR Monstres** (migration `origin`) : CRUD MD-only, slug serveur, garde-fou suppression (rencontres vivantes), bestiaire/rencontres, évt `custom-monster`.
3. **PR Sorts** (migration `source/party_id/created_by`) : CRUD MD-only, fusion grimoire + badge or « sort de la table », upcast/damage_json, évt `custom-spell`, garde inter-groupes.
4. **Marketing tranche A** (après PR Armures : captures 34–36 + section) puis **tranche B** (captures 37–40, puces « demain » activées au fil des PR).

**Garde-fous d'implémentation** : un worktree git PAR agent parallèle (jamais le checkout partagé), gates lint / `tsc -b apps/web` / `typecheck:api` / `test-api` / `test:e2e`, TypeBox + ratchet `check:validation`, zéro SQL brut, clés i18n fr+en en paires, `CHANGELOG.json` obligatoire.
