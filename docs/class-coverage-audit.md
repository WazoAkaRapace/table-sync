# Audit SRD 5e — couverture des classes (août 2026)

Audit complet des capacités de classe du SRD 5.1 face au moteur de règles
(`packages/shared`), à la fiche et au traqueur de combat. Ce document fait foi
pour la roadmap : ce qui est coché ✅ est calculé/appliqué nativement, 🟡 est
affiché sans application mécanique, ❌ est absent (candidat roadmap).

## Synthèse des chantiers livrés (cette itération)

1. **Catalogue de capacités** (`packages/shared/src/classFeatures.ts`, réexporté
   par `index.ts`) — 312 capacités FR (13 classes de base + 41 sous-classes, dont
   les 7 domaines du Clerc, les 3 serments du Paladin et les 3 spécialistes
   de l’Artificier),
   niveau d'acquisition, description courte avec variables de modèle,
   ressource optionnelle (formule de taille + recharge repos court/long).
   Onglet Traits → « Catalogue de classe » : ajout en 1 clic, compteur déduit de
   la formule au niveau du perso (`character_features.catalog_id`).
   **Passe de vérification AideDD (13 agents, 1 par classe)** : noms alignés sur
   la traduction officielle AideDD.org (Fougue, Inflexible, Conduit divin,
   Touche-à-tout, Esquive totale…), et corrections RAW — table de rage
   (5@12, 6@17), manifestations occultes (2@2…8@18), Imposition des mains @1,
   Sens divin = 1+CHA, Résistance aux sorts @14, Utilisation d'objets magiques
   déplacée en Voleur @13, « Esquive remarquable » du Voleur supprimée
   (inventée), Troisième œil remplace « Visions du passé » (Divination @10).
2. **Repos court / long** — `POST /api/characters/:id/rest` +
   `applyRest()` (shared, pur). Court : pacte, forme sauvage, ressources
   « court », dés de vie **lancés par le joueur à la table** — l'app compte les
   dés dépensés et applique le soin annoncé (capé aux PV max, sauvegardes de
   mort réinitialisées ; aucun lancer côté serveur). Long : PV max, temp 0,
   tous emplacements, ½ niveau en dés (min 1), épuisement −1, concentration,
   toutes ressources (max recalculé). Boutons dans l'onglet Survie + sheets de
   confirmation.
3. **Ressources de classe** — carte « ⚡ Ressources » dans Survie pour
   tout trait du catalogue possédant un compteur (rage, ki, canalisation,
   second souffle, sursaut d'activité, indomptable, points de sorcellerie,
   inspiration bardique, imposition des mains, arcanum…).
4. **Sous-classes** — colonne générique `characters.subclass` + sélecteur dans
   Caractéristiques pour Barbare, Barde, Ensorceleur, Guerrier, Magicien, Moine,
   Occultiste, Rôdeur, Roublard (Clerc/Druide/Paladin gardent leurs colonnes
   dédiées). Tous les sélecteurs (générique comme dédiés : cercle @2, terrain
   @2, serment @3, écoles de magie @2…) sont verrouillés jusqu'au niveau RAW
   d'acquisition — le Domaine divin du Clerc reste @1. Mécaniques clés :
   Résilience draconique (CA 13+DEX, bouclier ok),
   Critique amélioré/supérieur (chip « crit 19-20 » sur les armes), Aura de
   protection (+CHA min 1 inclus dans les sauvegardes), Châtiment divin
   (consomme un emplacement, sheet dédiée sur les armes de mêlée du Paladin).
5. **Corrections RAW** — table de magie de pacte conforme (1×L1@1, 2×L2@3,
   2×L5@9, 3@11, 4@17 — l'ancienne table donnait 2×L6 en 17-20 et 2 slots dès
   le niv 1) ; Attaque supplémentaire du Moine @5 ; Arcanum mystique 6-9 comme
   capacités 1/repos long ; Archidruide (forme sauvage illimitée @20).

## Matrice par classe

| Classe | Couvert nativement | Ajouts cette itération | Restant (roadmap) |
|---|---|---|---|
| Artificier | Outils (39), expertise auto @6, slots, préparation | Objets infusés (pool), Génie éclair, Objet réceptacle | Sous-classes (Alchimiste/Artilleur), sorts d'infusion détaillés |
| Barbare | CA sans armure, Déplacement rapide, Attaque supp. | Rage (compteur 2→∞, repos long), Attaque imprudente, Sens du danger, Instinct féroce, Critical brutal, Rage implacable, Persistance, Berserker/Totem | Effets de rage pas appliqués au traqueur (avantage/résistance) ; Totem : options détaillées |
| Barde | Sorts complets, Expertise | Inspiration bardique (CHA, d6→d12, court dès 5), Don des multiples, Chant de repos, Contre-charme, Secrets magiques, Collège du Savoir | Don des multiples pas appliqué aux tests ; Mot coupants (réaction) non suivi |
| Clerc | 7 domaines + sorts toujours prêts, sorts complets | Canalisation (1/2/3, court), Destruction des morts-vivants (CR par niveau), Intervention divine | Options de Canalisation par domaine (Repousser…), Frappe divine @8 par domaine |
| Druide | Forme sauvage complète (Lune/élémentaires/vu/carry-over), cercles+terrains, sorts | Corps immortel, Forme animale, Archidruide (∞ @20), Récupération naturelle (Terre), Foulée de la terre, Sanctuaire, Forme combative/Lune | Récupération naturelle ne restaure pas les emplacements automatiquement (manuel) |
| Ensorceleur | Sorts complets | Points de sorcellerie (pool = niveau, court @20 via description), Métamagie, Lignée draconique (CA 13+DEX ✅ natif), Magie sauvage (Marées, Surge) | Conversion points↔emplacements automatisée ; tables de magie sauvage |
| Guerrier | Attaques ×2/3/4, 3 styles, styles de combat | Second souffle, Sursaut d'activité 1→2@17, Indomptable 1/2/3, Champion (crit 19-20/18-20 natif sur les armes, Survivant) | Autres archétypes non-SRD (Bretteur etc.) ; Second souffle ne soigne pas auto |
| Magicien | Sorts complets, préparation, écoles (sélecteur) | Récupération arcanique (compteur), Maîtrise de la magie, Sorts signature, 8 écoles avec capacités notables (Garde mystique, Sculpture des sorts, Presage…) | Récupération arcanique ne restaure pas les emplacements auto ; Presage (d20 par repos) non suivi |
| Moine | Arts martiaux d4→d10, armes de moine, déplacement sans armure, CA | Points de ki (= niveau, court) + Frappe étourdissante/Déluge/Défense patiente/Pas du vent, Déviation des projectiles, Chute lente, Évasion, Âme de diamant, Main ouverte, Ombre (Arts des ombres @3 : Ténèbres/Vision dans le noir/Passage sans trace/Silence à 2 ki, Foulée d'ombre @6, Linceul d'ombre @11, Opportuniste @17), Quatre éléments (Disciple des éléments @3 : disciplines listées avec leurs coûts ki) | Dépense de ki par frappe non automatisée ; PHB 2014 couvert (3 voies) |
| Occultiste | Magie de pacte (table RAW corrigée) | Invocations : catalogue complet des 32 manifestations PHB + sélecteur borné dans le catalogue de classe (compteur n/max au niveau d'occultiste, prérequis niveau/faveur grisés, mutex des 3 faveurs de pacte) ; Arcanum mystique 6-9 intégré au lanceur (option « sans emplacement » qui décrémente le compteur du trait, retour au repos long) ; sorts à volonté et 1/RL des manifestations dans la feuille d'incantation (or, sans perle) ; Décharge déchirante (+CHA/rayon) et Lance occulte (45 m) dans l'aperçu ; Maître occulte, 3 patrons (Archifée/Fiélon/Grand Ancien) | Lame de pacte (arme magique, Lame assoiffée, Buveuse de vie) — Phase C |
| Paladin | 3 serments + sorts de serment, styles, Attaque supp. | Sens divins, Imposition des mains (pool 5×niv), Châtiment divin (flux + sheet), Canalisation, Aura de protection (+CHA sauvegardes ✅), Aura de courage, Châtiment amélioré, Toucher purificateur | Aura pas appliquée aux alliés dans le traqueur ; options CD par serment |
| Rôdeur | Sorts demi, styles, Attaque supp. | Ennemi favori, Explorateur naturel, Conscience primordiale, Foulée de la terre, Dissimulation naturelle, Sens féroce, Fléau, Chasseur | Ennemi favori sans effet sur les jets ; autres archéotypes |
| Roublard | Attaque sournoise (chip), Expertise, Argot | Action rusée, Esquive extraordinaire, Évasion, Talent fiable, Utilisation d'objets magiques, Esprit glissant, Coup de chance, Voleur/Assassin | Esprit glissant n'ajoute pas auto la maîtrise SAG ; conditions d'avantage non détectées |

## Roadmap non implémentée (par ordre de valeur en table)

1. **Évasion / Esquive extraordinaire** : rappels contextuels sur les dégâts de
   zone (DD auto-réussi) — nécessite une notion de type de dégât sur les coups.
2. **Aura de protection côté traqueur** : application aux sauvegardes des
   alliés dans le rayon (combat tracker aware).
3. **Récupération arcanique/naturelle** : restauration assistée d'emplacements
   (choix des niveaux) lors d'un repos court.
4. **Styles GWF/2WF** : étiquettes sans effet mécanique (reroll 1-2, +CA
   dual-wield) — nécessite un lanceur de dés d'attaque.
5. **Multiclassage** (tables 1/3 casters EK/Arcane-trickster) — hors scope.
6. **Don des multiples** (½ maîtrise sur checks non maîtrisés) dans
   `skillModifier`.
7. **Presage** (Magicien divination) : 2 d20 stockés par repos long.
8. **Rage** : application des effets (avantage FOR, résistance dégâts) sur les
   cartes d'attaque du traqueur tant active.

## Conventions techniques établies

- `character_features.catalog_id` relie un trait au catalogue
  (`CLASS_FEATURES`/`CLASS_SUBCLASSES`) : recharge par type de repos et
  recalcul du maximum au niveau courant lors d'un repos.
- `characters.subclass` : clé de `CLASS_SUBCLASSES` pour les 9 classes
  génériques ; Clerc/Druide/Paladin conservent `divine_domain`/`druid_circle`+
  `land_circle`/`sacred_oath`.
- `applyRest(character, features, { type, hitDiceSpent })` (shared, pur) —
  l'API persiste et reflète les PV sur les combatants actifs.
- Variables de modèle ajoutées : `{{bardic_die}}` `{{song_die}}`
  `{{invocations}}` `{{lay_on_hands}}` `{{sneak_dice}}`.
- Noms français : AideDD.org (traduction officielle du PHB 2014, pages
  /regles/classes/…) en priorité, 5e-drs en repli ; les noms peu
  courants portent l'anglais entre parenthèses.
