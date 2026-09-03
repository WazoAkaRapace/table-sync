# Script du tutoriel — visite guidée de la fiche joueur

> Statut : **implémenté** (2026-08-31) — react-joyride v3 (`apps/web/src/tutorial/`), sélecteurs `data-tuto` posés, clés `tuto.*` dans les deux locales, e2e `e2e/tutorial.spec.ts`. Ce document reste la référence du contenu : toute retouche de texte se fait ici PUIS se recopie dans `fr.json`/`en.json`.

## 1. Décisions

| # | Décision |
|---|---|
| D1 | **Périmètre v1 = fiche joueur** : les 9 onglets + l'habillage partagé (bandeau d'état, dock mobile/hub, barre d'onglets desktop). Les surfaces du MD (table, traqueur) feront l'objet d'un script ultérieur. |
| D2 | **Forme = un script par onglet + une visite « Bienvenue »** (5 étapes). La chaîne *Bienvenue → Survie* se joue quand le drapeau `dnd-inv-tour-seen` est absent (première visite) ou après une réinitialisation. |
| D3 | **Déclenchement/rejeu = « Réinitialiser le tutoriel » dans « Mon compte »** (§16). Pas de bouton ❓ dans la fiche. Le tutoriel absorbe l'ancienne carte « Bienvenue ! » de l'inventaire et **réutilise la clé `dnd-inv-tour-seen`** — les fixtures e2e existantes continuent de le supprimer sans changement. |
| D4 | **Mobile d'abord, desktop s'adapte** : scripts partagés, étapes marquées `mobile` / `desktop` / `les deux`, cibles alternatives (dock vs barre d'onglets) résolues au moment de la construction. |
| D5 | **Moteur = react-joyride v3** (`react-joyride@^3.2` + `@floating-ui/react-dom`). React 19 compatible depuis v3 (mars 2026) ; les crochets `before` par étape portent notre orchestration de changement d'onglet, le polling de cible absorbe le remontage des panneaux (`key={activeTab}`), le rendu est portaled (règle AGENTS.md). Sans balise (déclenchement par drapeau), clics sur l'overlay bloqués, Échap quitte. Bulle maison : `.card` + boutons de la maison (§4). |

## 2. Contrat d'une étape

### 2.1 Champs

| Champ | Type | Rôle |
|---|---|---|
| `id` | `string` | Identifiant unique dans le script ; suffixe des clés i18n. |
| `target` | `string \| { mobile, desktop }` | Sélecteur `data-tuto` de l'élément à mettre en lumière. Absent = carte centrée (étape d'ouverture/fermeture). |
| `tab` | `CharacterTab?` | Onglet à activer avant l'étape (crochet `before` : navigation + attente de remontage). |
| `viewport` | `'mobile' \| 'desktop' \| 'both'` | Étape filtrée par media query `lg`. Défaut : `both`. |
| `when` | `(ctx) => boolean` | Prédicat de personnage (druide, possède des tours de magie…). Faux ⇒ étape sautée sans erreur. |

### 2.2 Règle de ciblage

Les cibles sont **des conteneurs de section stables et toujours présents** (titres `section-title`, blocs de l'onglet) — jamais une ligne individuelle (sort, objet, trait), qui dépendrait du personnage. Quand l'interaction porte sur une ligne (lancer un sort, transférer un objet), la lumière reste sur la section et le texte nomme le geste.

### 2.3 Contexte `ctx`

`{ isCaster, hasSpells, hasCantrips, hasDomainSpells, isDruid, canEdit }` — calculé une fois au lancement depuis la fiche chargée (`classesOf`, grimoire, colonnes de classe).

### 2.4 Clés i18n

`tuto.<script>.<id>.titre` et `tuto.<script>.<id>.texte` ; habillage commun sous `tuto.*` (§4). Interpolation autorisée (`{{name}}`).

## 3. Registre des sélecteurs `data-tuto`

| `data-tuto` | Élément | Fichier | Vue |
|---|---|---|---|
| `band` | Section « État du personnage » (bandeau PV/CA/emplacements) | `apps/web/src/components/CharacterStateBand.tsx` | les deux |
| `dock` | Barre d'onglets flottante (conteneur du dock) | `apps/web/src/pages/CharacterInventoryPage.tsx` | mobile |
| `dock-hub` | Bouton central du dock (hub) | `apps/web/src/pages/CharacterInventoryPage.tsx` | mobile |
| `tabbar` | Barre d'onglets en haut de fiche | `apps/web/src/pages/CharacterInventoryPage.tsx` | desktop |
| `survie-vitalite` | Bloc « ❤️ Vitalité » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux |
| `survie-attaques` | Bloc « ⚔ Attaques » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux |
| `survie-des-vie` | Bloc « 🎲 Dés de vie » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux |
| `survie-etats` | Bloc « 🎭 États » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux |
| `survie-ressources` | Bloc « ⚡ Ressources de classe » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux |
| `survie-repos` | Bloc « 🎲 Repos » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux |
| `survie-forme` | Bloc « 🐾 Forme sauvage » | `apps/web/src/pages/character/SurvivalPanel.tsx` | les deux · `when` druide |
| `stats-caracts` | Section « Caractéristiques » | `apps/web/src/pages/CharacterStatsTab.tsx` | les deux |
| `stats-derivees` | Section « Statistiques dérivées » | `apps/web/src/pages/CharacterStatsTab.tsx` | les deux |
| `stats-ca` | Tuile Classe d'armure | `apps/web/src/pages/CharacterStatsTab.tsx` | les deux |
| `stats-portage` | Ligne Portage max | `apps/web/src/pages/CharacterStatsTab.tsx` | les deux |
| `skills-sauvegardes` | Section « Jets de sauvegarde » | `apps/web/src/pages/CharacterSkillsTab.tsx` | les deux |
| `skills-competences` | Section « Compétences » | `apps/web/src/pages/CharacterSkillsTab.tsx` | les deux |
| `skills-outils-langues` | Sections « Outils » + « Langues » (enveloppe commune) | `apps/web/src/pages/CharacterSkillsTab.tsx` | les deux |
| `skills-maitrises` | Section « Maîtrise d'armes » | `apps/web/src/pages/CharacterSkillsTab.tsx` | les deux |
| `sorts-emplacements` | Section « Emplacements de sort » | `apps/web/src/pages/CharacterSpellsTab.tsx` | les deux |
| `sorts-connus` | Section « Sorts connus » (liste, étoile ★ de préparation) | `apps/web/src/pages/CharacterSpellsTab.tsx` | les deux |
| `sorts-cantrips` | Groupe « Tours de magie » (niveau 0) | `apps/web/src/pages/CharacterSpellsTab.tsx` | les deux · `when` tours |
| `inv-rangs` | Rangée des pastilles de rangement (+ barre de poids) | `apps/web/src/pages/CharacterInventoryPage.tsx` | les deux |
| `inv-sac` | Grille « Sac à dos » | `apps/web/src/pages/CharacterInventoryPage.tsx` | les deux |
| `inv-catalogue` | Colonne « Catalogue » | `apps/web/src/pages/CharacterInventoryPage.tsx` | desktop |
| `inv-fab` | Bouton flottant ✚ (catalogue en feuille mobile) | `apps/web/src/pages/CharacterInventoryPage.tsx` | mobile · `when` canEdit |
| `inv-bourse` | Section « Bourse » | `apps/web/src/pages/character/CoinPurse.tsx` | les deux |
| `traits-catalogue` | Carte « Catalogue de classe » | `apps/web/src/pages/CharacterFeaturesTab.tsx` | les deux |
| `traits-liste` | En-tête « Traits (n) » | `apps/web/src/pages/CharacterFeaturesTab.tsx` | les deux |
| `desc-identite` | Section « Identité & classe » | `apps/web/src/pages/CharacterDescriptionTab.tsx` | les deux |
| `desc-apparence` | Section « Apparence » (repère du bas de page : apparence → visibilité) | `apps/web/src/pages/CharacterDescriptionTab.tsx` | les deux |
| `pnj-liste` | En-tête + grille PNJ | `apps/web/src/pages/NpcPage.tsx` | les deux |
| `notes-liste` | En-tête « Notes (n) » | `apps/web/src/pages/CharacterNotesTab.tsx` | les deux |
| `messages-fil` | Carte « Correspondance » (fil + composeur) | `apps/web/src/components/MessageThread.tsx` | les deux |

## 4. Habillage commun (bulle)

Carte maison `.card`, titre en `.section-title`, corps `text-sm`, compteur « 2 / 6 », boutons `Passer` (fantôme) · `← Retour` (secondaire, masqué à la première étape) · `Suivant` → `Terminer` (primaire). `role="dialog"` + `aria-modal` ; Échap quitte ; `prefers-reduced-motion` = aucune transition.

| Clé | FR | EN |
|---|---|---|
| `tuto.passer` | Passer | Skip |
| `tuto.retour` | ← Retour | ← Back |
| `tuto.suivant` | Suivant | Next |
| `tuto.terminer` | Terminer | Finish |
| `tuto.compteur` | {{current}} / {{total}} | {{current}} / {{total}} |

## 5. Script « Bienvenue » (shell — 5 étapes)

Se joue à l'arrivée sur la fiche (drapeau absent ou réinitialisé), quel que soit l'onglet. L'étape 5 enchaîne sur le script Survie.

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `bienvenue` | — (carte centrée) | les deux | **Bienvenue sur ta fiche !** Table Sync suit ton personnage pendant la partie : PV, sorts, inventaire… tout se met à jour en direct, pour toi comme pour ton MD. Quelques secondes de visite ? | **Welcome to your sheet!** Table Sync tracks your character during the game: HP, spells, inventory… everything updates live, for you and your GM. A quick tour? |
| 2 | `bandeau` | `band` | les deux | **Ta survie, toujours en vue** Ce bandeau affiche tes PV, ta CA et tes emplacements de sort sur chaque onglet. Touche-le pour soigner ou blesser en un geste. | **Your vitals, always in sight** This band shows your HP, AC and spell slots on every tab. Tap it to heal or take damage in one gesture. |
| 3 | `onglets` | `dock` / `tabbar` | mobile/desktop | **Tes onglets** Survie en premier, puis les plus utiles selon ta classe. Un appui, un onglet — et tout le reste se cache derrière le bouton central. | **Your tabs** Survival first, then the most useful ones for your class. One tap, one tab — everything else hides behind the centre button. |
| 4 | `hub` | `dock-hub` | mobile | **Le bouton central** Inventaire, Traits, Description, PNJ, Notes… tout y vit. Et pendant un combat, il devient ton indicateur : il rougit et t'appelle quand c'est ton tour. | **The centre button** Inventory, Features, Description, NPCs, Notes… they all live here. And in combat it becomes your indicator: it turns red and calls on you when it's your turn. |
| 5 | `fin` | — (carte centrée) | les deux | **C'est parti pour la Survie** Cette visite se relance quand tu veux : « Mon compte → Réinitialiser le tutoriel ». Prochain arrêt : la Survie, le cœur du jeu. | **On to Survival** Replay this tour anytime: “My account → Reset tutorial”. Next stop: Survival, the heart of play. |

## 6. Script « Survie » (7 étapes · onglet `survival`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `vitalite` | `survie-vitalite` | les deux | **❤️ Vitalité** Tes points de vie et leurs temporaires. Les boutons ±1 / ±5 vont vite ; à 0 PV, les jets de sauvegarde contre la mort s'affichent tout seuls. | **❤️ Vitality** Your hit points and temp HP. The ±1 / ±5 buttons are quick; at 0 HP, death saves appear on their own. |
| 2 | `attaques` | `survie-attaques` | les deux | **⚔ Attaques** Tes armes avec les bons chiffres : la puce 🎯 donne le bonus, ⚔ les dégâts, ✨ la magie. Caractéristique, maîtrise, style de combat… tout est calculé selon les règles. | **⚔ Attacks** Your weapons with the right numbers: the 🎯 chip shows the attack bonus, ⚔ damage, ✨ magic. Ability, proficiency, fighting style… it's all computed by the rules. |
| 3 | `des-vie` | `survie-des-vie` | les deux | **🎲 Dés de vie** Ta réserve de dés de vie, un compteur par classe. Un repos long t'en rend la moitié ; pendant un repos court, dépenses-en pour te soigner. | **🎲 Hit dice** Your hit-dice pool, one counter per class. A long rest returns half of them; during a short rest, spend them to heal. |
| 4 | `etats` | `survie-etats` | les deux | **🎭 États** Conditions et épuisement, avec durées. Ils suivent ton personnage partout : ta fiche et le traqueur du MD restent synchronisés. | **🎭 Conditions** Conditions and exhaustion, with durations. They follow your character everywhere: your sheet and the GM's tracker stay in sync. |
| 5 | `ressources` | `survie-ressources` | les deux | **⚡ Ressources de classe** Rage, ki, points de sorcellerie… les compteurs de tes traits, avec leur maximum calculé à ton niveau actuel. | **⚡ Class resources** Rage, ki, sorcery points… your features' counters, with their maximum computed at your current level. |
| 6 | `repos` | `survie-repos` | les deux | **⛺ Repos court, 🌙 repos long** Un appui applique les règles : emplacements, ressources, dés de vie. Et ton MD te voit te reposer en direct. | **⛺ Short rest, 🌙 long rest** One tap applies the rules: slots, resources, hit dice. And your GM watches you rest live. |
| 7 | `forme` | `survie-forme` | les deux · `when` druide | **🐾 Forme sauvage** Choisis une bête déjà vue : la fiche gère ses PV, le retour automatique à 0 et le DD maximal selon ton niveau. | **🐾 Wild shape** Pick a beast you've seen: the sheet tracks its HP, the auto-revert at 0, and the CR gates for your level. |

## 7. Script « Caractéristiques » (5 étapes · onglet `stats`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `scores` | `stats-caracts` | les deux | **Tes six scores** FORCE, DEXTERITÉ… modifiables ici ; chaque modificateur et chaque sauvegarde suivent aussitôt. | **Your six scores** STR, DEX… editable right here; every modifier and save follows instantly. |
| 2 | `derivees` | `stats-derivees` | les deux | **Statistiques dérivées** Tout ce qui se calcule : initiative, perception passive, vitesse… recalculées en direct selon tes classes, ton équipement et tes états. | **Derived statistics** Everything that's computed: initiative, passive perception, speed… recomputed live from your classes, gear and conditions. |
| 3 | `ca` | `stats-ca` | les deux | **La CA, auto ou manuelle** Ton armure et ton bouclier donnent la Classe d'armure. Objet magique imprévu ? Bascule en « Manuel » et saisis-la — « ↺ Auto » revient aux règles. | **AC, auto or manual** Your armour and shield set the Armor Class. Unexpected magic item? Switch to “Manual” and type it — “↺ Auto” returns to the rules. |
| 4 | `portage` | `stats-portage` | les deux | **Portage max** Ce que tu peux porter, calculé sur ta FORCE et le poids réel de ton sac — pièces comprises. Un multiplicateur ×N couvre mules et serviteurs. | **Max carry** What you can carry, computed from your STR and your bag's real weight — coins included. An ×N multiplier covers mules and hirelings. |
| 5 | `vitesse` | `stats-derivees` | les deux | **La vitesse suit le rythme** Elle ralentit avec l'encombrement et l'armure lourde mal portée, et s'adapte à ta forme sauvage — Moine et Barbare y gagnent leurs bonus. | **Speed keeps pace** It slows with encumbrance and mishandled heavy armour, and adapts to your wild shape — Monk and Barbarian earn their bonuses here. |

## 8. Script « Compétences » (4 étapes · onglet `skills`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `sauvegardes` | `skills-sauvegardes` | les deux | **Jets de sauvegarde** Tes six sauvegardes, avec bonus de maîtrise quand il s'applique — et l'aura du paladin s'ajoute toute seule dès le niveau 6. | **Saving throws** Your six saves, with proficiency where it applies — and the paladin's aura adds itself from level 6. |
| 2 | `competences` | `skills-competences` | les deux | **○, ●, puis ◉** Un appui passe de rien à la maîtrise ● ; un second, à l'expertise ◉ (double bonus). Les emplacements d'expertise sont comptés selon ta classe. | **○, ●, then ◉** One tap goes from nothing to proficiency ●; a second one, to expertise ◉ (double bonus). Expertise slots are counted per your class. |
| 3 | `outils-langues` | `skills-outils-langues` | les deux | **Outils & langues** 39 outils et 16 langues du SRD, plus tes propres entrées. L'expertise vaut aussi pour les outils de voleur. | **Tools & languages** 39 SRD tools and 16 languages, plus your own entries. Expertise applies to thieves' tools too. |
| 4 | `maitrises` | `skills-maitrises` | les deux | **Maîtrise d'armes** Celles de ta classe par défaut. Arme exotique gagnée en jeu ? Ajoute-la — sinon la fiche signale ⚠ les attaques non qualifiées. | **Weapon proficiency** Your class's list by default. Exotic blade won in play? Add it — otherwise the sheet flags ⚠ unproficient attacks. |

## 9. Script « Sorts » (6 étapes · onglet `spells`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `emplacements` | `sorts-emplacements` | les deux · `when` a des emplacements | **Emplacements de sort** Un compteur par niveau. La magie de pacte recharge au repos court, le reste au repos long — la fiche sait laquelle dépenser. | **Spell slots** One counter per level. Pact magic recharges on a short rest, the rest on a long one — the sheet knows which to spend. |
| 2 | `lancer` | `sorts-connus` | les deux · `when` a des sorts | **Lancer un sort** Le bouton ✨ ouvre l'incantation : choisis le niveau, la fiche montre dégâts ou soins mis à l'échelle, puis dépense l'emplacement. | **Cast a spell** The ✨ button opens casting: pick the level, the sheet shows damage or healing scaled, then spends the slot. |
| 3 | `concentration` | `sorts-connus` | les deux · `when` a des sorts | **🌀 Concentration** Un seul sort de concentration à la fois. Si tu prends des dégâts, la fiche te rappelle le jet à faire — et le rompt si tu tombes. | **🌀 Concentration** One concentration spell at a time. Take damage and the sheet prompts the save — break it if you drop. |
| 4 | `toujours-prepares` | `sorts-connus` | les deux · `when` sorts de domaine | **◆ Toujours préparés** Les sorts de domaine, cercle ou serment portent un ◆ : toujours prêts, et ils ne comptent pas dans ta limite de sorts préparés. | **◆ Always prepared** Domain, circle or oath spells carry a ◆: always ready, and they don't count against your prepared limit. |
| 5 | `grimoire` | `sorts-connus` | les deux | **Tes sorts connus** L'étoile ★ prépare un sort, dans la limite de ta classe ; glisse la ligne vers la gauche pour l'oublier. | **Your known spells** The ★ star prepares a spell, within your class's limit; swipe the row left to forget it. |
| 6 | `cantrips` | `sorts-cantrips` | les deux · `when` tours de magie | **Tours de magie** Niveau 0, donc toujours « à volonté » : ils ne consomment aucun emplacement, repos ou pas. | **Cantrips** Level 0, so always “at will”: they consume no slot, rest or not. |

## 10. Script « Inventaire » (7 étapes · onglet `inventory`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `rangements` | `inv-rangs` | les deux | **Tes rangements** Le sac à dos par défaut, plus tes conteneurs et montures — chacun avec son poids propre et sa barre de charge. Touche une pastille pour l'ouvrir. | **Your storage** The default backpack, plus your containers and mounts — each with its own weight and load bar. Tap a pill to open it. |
| 2 | `sac` | `inv-sac` | les deux | **Le sac à dos** Ton équipement d'un regard. Réorganise au glisser, pose un objet sur un autre rangement pour le transférer. | **The backpack** Your gear at a glance. Drag to reorder, drop an item onto another storage to move it. |
| 3 | `puces` | `inv-sac` | les deux | **Des puces qui lisent les règles** 🎯 attaque, ⚔ dégâts, ✨ magie, ×N attaques supplémentaires… et ⚠ si l'arme n'est pas maîtrisée. Calculé, jamais recopié. | **Chips that read the rules** 🎯 attack, ⚔ damage, ✨ magic, ×N extra attacks… and ⚠ if the weapon isn't proficient. Computed, never copied. |
| 4 | `transfert` | `inv-sac` | les deux | **Donner un objet** « ↗ Transférer » envoie un objet — ou des pièces — à un autre personnage du groupe : il le voit apparaître sans recharger. | **Give an item** “↗ Transfer” sends an item — or coins — to another character in the party: they see it appear without reloading. |
| 5 | `bourse` | `inv-bourse` | les deux | **La bourse** PO, PA, PC et le total. Tout a un poids : même les pièces comptent dans ton portage. | **The purse** GP, SP, CP and the total. Everything has weight: even coins count toward your carry limit. |
| 6 | `catalogue` | `inv-fab` / `inv-catalogue` | mobile/desktop | **Le catalogue, 646 objets** Le bouton ✚ (ou la colonne de droite) ouvre le catalogue : cherche « corde » ou « épée », ajoute en un appui. Introuvable ? « Créer un objet » t'ouvre la voie. | **The catalog, 646 items** The ✚ button (or the right-hand column) opens the catalog: search “rope” or “sword”, add with one tap. Can't find it? “Create an item” shows the way. |
| 7 | `poids` | `inv-rangs` | les deux | **Le poids, pour de vrai** Chaque rangement affiche son total en kg — armes, pièces et conteneurs compris. À bout de portage, c'est ta vitesse qui trinque. | **Weight, for real** Each storage shows its total in kg — weapons, coins and containers included. Over your limit, your speed pays for it. |

## 11. Script « Traits » (4 étapes · onglet `features`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `catalogue` | `traits-catalogue` | les deux | **Catalogue de classe** Les 307 traits officiels du SRD, par classe et niveau — Fougue, Inflexible, Conduit divin… L'officiel, à un appui. | **Class catalog** The 307 official SRD features, by class and level — Action Surge, Indomitable, Channel Divinity… Officialdom, one tap away. |
| 2 | `ajout` | `traits-catalogue` | les deux | **Ajout en 1 clic** Chaque trait arrive avec sa description et, s'il a un compteur, sa réserve : furie 2/2, points de ki… réglés à ton niveau. | **One-click add** Each feature arrives with its description and, if it has a counter, its pool: rage 2/2, ki points… set to your level. |
| 3 | `compteurs` | `traits-liste` | les deux | **Repos courts, repos longs** Chaque compteur coche ce qu'il récupère — pré-coché selon le SRD. Décoche pour gérer à la main. | **Short rests, long rests** Each counter ticks what it recovers — pre-checked per the SRD. Untick to manage it by hand. |
| 4 | `ma-liste` | `traits-liste` | les deux | **Tes traits, tes repères** Ta liste reste éditable : renomme, réordonne, ajoute ce que le MD accorde hors catalogue. | **Your features, your landmarks** Your list stays editable: rename, reorder, add whatever the GM grants off-catalog. |

## 12. Script « Description » (3 étapes · onglet `description`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `identite` | `desc-identite` | les deux | **Identité & classe** Le résumé « Classe A n / Classe B n », des lignes éditables : niveau, sous-classe, style de combat. Le multiclassage SRD est géré. | **Identity & class** The “Class A n / Class B n” summary, editable lines: level, subclass, fighting style. SRD multiclassing handled. |
| 2 | `ajouter-classe` | `desc-identite` | les deux | **＋ Ajouter une classe** Feuille guidée : prérequis ⚠ et maîtrises acquises affichés avant de valider. La fiche recalcule PV, emplacements et attaques. | **＋ Add a class** Guided form: ⚠ prerequisites and gained proficiencies shown before you confirm. The sheet recomputes HP, slots and attacks. |
| 3 | `histoire` | `desc-apparence` | les deux | **Le reste de ton histoire** Apparence, personnalité, historique, alliés… et la visibilité : ce que le MD et les autres joueurs peuvent voir de ta fiche. | **The rest of your story** Appearance, personality, backstory, allies… and visibility: what the GM and other players can see of your sheet. |

## 13. Script « PNJ » (2 étapes · onglet `npcs`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `figures` | `pnj-liste` | les deux | **Les figures de la campagne** Alliés, contacts, adversaires récurrents : chaque PNJ garde son apparence et ses notes, prêts à resservir. | **The campaign's cast** Allies, contacts, recurring rivals: each NPC keeps its appearance and notes, ready to return. |
| 2 | `ajouter` | `pnj-liste` | les deux | **＋ Ajouter un PNJ** Une fiche simple, prête en trente secondes — pour que l'infâme marchand revienne te hanter. | **＋ Add an NPC** A simple card, ready in thirty seconds — so the odious merchant comes back to haunt you. |

## 14. Script « Notes » (2 étapes · onglet `notes`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `libres` | `notes-liste` | les deux | **Notes libres** Indices, dettes, promesses… Titre, contenu, ordre, et l'aperçu 👁 pour relire en jeu. | **Free notes** Clues, debts, promises… Title, content, order, and the 👁 preview to reread at the table. |
| 2 | `partout` | `notes-liste` | les deux | **Sur tous tes écrans** Sauvegardées aussitôt écrites, synchronisées avec ton compte : tablette ce soir, téléphone la semaine prochaine — rien à recopier. | **On every screen** Saved as you type, synced with your account: tablet tonight, phone next week — nothing to copy over. |


## 15. Script « Messages » (2 étapes · onglet `messages`)

| # | id | Cible | Vue | Texte FR | Texte EN |
|---|---|---|---|---|---|
| 1 | `fil` | `messages-fil` | les deux | **Le canal secret** Échange en privé avec le MD : indices, secrets, révélations que la table ne doit pas entendre. Ce fil appartient à ce personnage — l'historique y reste. | **The secret channel** Trade privately with the GM: clues, secrets, revelations the table must not hear. This thread belongs to this character — the history stays here. |
| 2 | `partout` | `messages-fil` | les deux | **Partout, même hors de la fiche** Un message qui arrive s'affiche en bannière où que tu sois, une pastille compte les non-lus — et si l'app est fermée, une notification sonne. | **Anywhere, even outside the sheet** An incoming message drops a banner wherever you are, a badge counts the unread — and if the app is closed, a notification fires. |

## 16. Réinitialisation — section « Tutoriel » de « Mon compte »

Nouvelle section carte entre « Langue » et « Mot de passe » (`apps/web/src/pages/AccountPage.tsx`), `aria-labelledby` comme ses voisines.

| Clé | FR | EN |
|---|---|---|
| `account.tutoriel` | Tutoriel | Tutorial |
| `account.tutoriel.aide` | La visite guidée présente la fiche : bandeau d'état, onglets, survie, sorts, inventaire… | The guided tour walks you through the sheet: status band, tabs, survival, spells, inventory… |
| `account.tutoriel.bouton` | Réinitialiser le tutoriel | Reset tutorial |
| `account.tutoriel.toast` | Visite guidée réactivée — elle démarre à la prochaine fiche ouverte. | Guided tour re-enabled — it starts next time you open a sheet. |

Le bouton efface `dnd-inv-tour-seen` **et** `dnd-inv-tour-tabs` (localStorage) **et** réarme le serveur (`PATCH /api/auth/me { tutorialSeenAt: null }`) : le suivi suit le COMPTE, pas le navigateur — la réinitialisation rejoue la visite sur tous les appareils, et réciproquement un compte ayant déjà vu la visite ne la rejoue pas sur un nouvel appareil (convergence serveur → localStorage au chargement de session, cf. `tutorial/serverSync.ts`). Le toast s'affiche. À la prochaine ouverture d'une fiche, la chaîne *Bienvenue → Survie* se rejoue — puis chaque onglet retrouve sa visite propre au premier passage.

## 17. Déclenchement et enchaînement

- **Première visite** : `dnd-inv-tour-seen` absent ⇒ la chaîne *Bienvenue → Survie* démarre après le chargement de la fiche (≈ 800 ms, comme l'ancienne carte). La fin ou l'abandon (Échap, « Passer ») écrit `'1'` dans le drapeau — localement **et côté serveur** (`tutorial_seen_at`), si bien qu'un nouvel appareil du même compte n'aura plus la visite.
- **Visite propre d'onglet** : le premier passage sur un onglet (changement d'onglet uniquement, jamais au montage) déclenche son script — une fois la visite d'accueil passée. Terminé **ou** passé ⇒ l'onglet est coché dans `dnd-inv-tour-tabs` (JSON array) et ne se redéclenche plus. La Survie est cochée par la chaîne d'accueil ; un « Passer » sur l'accueil ne déclenche pas aussitôt la Survie déjà affichée (déclencheurs limités aux changements d'onglet).
- **Après réinitialisation** : les deux clés disparaissent — la chaîne d'accueil rejoue, puis chaque onglet retrouve sa visite au premier passage.
- **Vue MD sur une fiche joueur** : le tutoriel se joue aussi (lecture) ; les textes d'édition restent valides (« ton MD » devient le lecteur).
