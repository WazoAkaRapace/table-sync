#!/usr/bin/env python3
"""
translate-items.py
==================

Enriches ``data/items-seed.json`` (599 D&D 5e SRD items) with:

1. ``nameFr``  - the official French D&D 5e translation for every item
   (Player's Handbook / SRD French edition vocabulary).
2. ``weightKg`` - reasonable estimates for the 368 items whose weight is null.

The result is written back to ``data/items-seed.json`` in place, and a short
summary is printed to stdout.

Run it from the project root::

    python3 scripts/translate-items.py

It is idempotent: re-running it leaves an already-enriched file unchanged.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_FILE = PROJECT_ROOT / "data" / "items-seed.json"


# ===========================================================================
# 1. FRENCH TRANSLATIONS  (keyed by ``srdIndex``)
# ===========================================================================
#
# These cover all 599 items. They follow the official French translation of
# the D&D 5e Player's Handbook / System Reference Document (édition française
# du Manuel des Joueurs). For items that have no single canonical French name
# (e.g. some "+1/+2/+3" generic entries), a reasonable, idiomatic French
# calque is used.
# ---------------------------------------------------------------------------

FR_TRANSLATIONS: dict[str, str] = {
    # ----------------------------------------------------------------- Weapons
    "club": "Gourdin",
    "dagger": "Dague",
    "greatclub": "Gourdin de guerre",
    "handaxe": "Hachette",
    "javelin": "Javeline",
    "light-hammer": "Marteau léger",
    "mace": "Masse d'armes",
    "quarterstaff": "Bâton de marche",
    "sickle": "Faux",
    "spear": "Lance",
    "crossbow-light": "Arbalète légère",
    "dart": "Fléchette",
    "shortbow": "Arc court",
    "sling": "Fronde",
    "battleaxe": "Hache de guerre",
    "flail": "Fléau d'armes",
    "glaive": "Coutille",
    "greataxe": "Grand hache",
    "greatsword": "Épée à deux mains",
    "halberd": "Hallebarde",
    "lance": "Lance de cavalerie",
    "longsword": "Épée longue",
    "maul": "Marteau de guerre",
    "morningstar": "Étoile du matin",
    "pike": "Pique",
    "rapier": "Rapière",
    "scimitar": "Cimeterre",
    "shortsword": "Épée courte",
    "trident": "Trident",
    "war-pick": "Pique de guerre",
    "warhammer": "Marteau de guerre",
    "whip": "Fouet",
    "blowgun": "Sarbacane",
    "crossbow-hand": "Arbalète de poing",
    "crossbow-heavy": "Arbalète lourde",
    "longbow": "Arc long",
    "net": "Filet",

    # Magic weapons
    "berserker-axe": "Hache du berserker",
    "dagger-of-venom": "Dague venimeuse",
    "dancing-sword": "Épée dansante",
    "defender": "Défenseur",
    "dragon-slayer": "Tueuse de dragons",
    "dwarven-thrower": "Marteau de lancer nain",
    "flame-tongue": "Langue de feu",
    "frost-brand": "Lame de givre",
    "giant-slayer": "Tueuse de géants",
    "hammer-of-thunderbolts": "Marteau des éclairs",
    "holy-avenger": "Vengeur sacré",
    "javelin-of-lightning": "Javeline de foudre",
    "luck-blade": "Lame chanceuse",
    "mace-of-disruption": "Masse de disruption",
    "mace-of-smiting": "Masse de châtiment",
    "mace-of-terror": "Masse de terreur",
    "nine-lives-stealer": "Voleuse de neuf vies",
    "oathbow": "Arc du serment",
    "scimitar-of-speed": "Cimeterre de vitesse",
    "sun-blade": "Lame solaire",
    "sword-of-life-stealing": "Épée voleuse de vie",
    "sword-of-sharpness": "Épée de tranchage",
    "sword-of-wounding": "Épée blessante",
    "trident-of-fish-command": "Trident de commandement des poissons",
    "vicious-weapon": "Arme vicieuse",
    "vorpal-sword": "Épée vorpale",
    "weapon": "Arme, +1, +2 ou +3",
    "weapon-1": "Arme +1",
    "weapon-2": "Arme +2",
    "weapon-3": "Arme +3",

    # ------------------------------------------------------------------- Armor
    "padded-armor": "Armure matelassée",
    "leather-armor": "Armure de cuir",
    "studded-leather-armor": "Armure de cuir cloutée",
    "hide-armor": "Armure de cuir cloutée",  # overridden below
    "chain-shirt": "Chemise de mailles",
    "scale-mail": "Cotte de mailles en écailles",
    "breastplate": "Plastron",
    "half-plate-armor": "Demi-armure",
    "ring-mail": "Cotte d'anneaux",
    "chain-mail": "Cotte de mailles",
    "splint-armor": "Armure de bandes",
    "plate-armor": "Armure de plates",
    "shield": "Bouclier",

    # Magic armor
    "adamantine-armor": "Armure d'adamantine",
    "animated-shield": "Bouclier animé",
    "armor": "Armure, +1, +2 ou +3",
    "armor-1": "Armure +1",
    "armor-2": "Armure +2",
    "armor-3": "Armure +3",
    "armor-of-invulnerability": "Armure d'invulnérabilité",
    "armor-of-resistance": "Armure de résistance",
    "armor-of-vulnerability": "Armure de vulnérabilité",
    "arrow-catching-shield": "Bouclier attrache-flèches",
    "demon-armor": "Armure démoniaque",
    "dragon-scale-mail": "Cotte d'écailles de dragon",
    "dragon-scale-mail-black": "Cotte d'écailles de dragon noir",
    "dragon-scale-mail-blue": "Cotte d'écailles de dragon bleu",
    "dragon-scale-mail-brass": "Cotte d'écailles de dragon d'airain",
    "dragon-scale-mail-bronze": "Cotte d'écailles de dragon de bronze",
    "dragon-scale-mail-copper": "Cotte d'écailles de dragon de cuivre",
    "dragon-scale-mail-gold": "Cotte d'écailles de dragon d'or",
    "dragon-scale-mail-green": "Cotte d'écailles de dragon vert",
    "dragon-scale-mail-red": "Cotte d'écailles de dragon rouge",
    "dragon-scale-mail-silver": "Cotte d'écailles de dragon argenté",
    "dragon-scale-mail-white": "Cotte d'écailles de dragon blanc",
    "dwarven-plate": "Armure de plates naine",
    "elven-chain": "Chemise de mailles elfique",
    "glamoured-studded-leather-armor": "Armure de cuir cloutée illusoire",
    "mithral-armor": "Armure de mithral",
    "plate-armor-of-etherealness": "Armure de plates d'éthéralité",
    "shield-of-missile-attraction": "Bouclier d'attraction des projectiles",
    "spellguard-shield": "Bouclier de garde des sorts",

    # -------------------------------------------------------------------- Gear
    "abacus": "Boulier",
    "acid-vial": "Acide (fiole)",
    "alchemists-fire-flask": "Feu alchimique (flasque)",
    "alms-box": "Boîte aux aumônes",
    "arrow": "Flèche",
    "block-of-incense": "Bloc d'encens",
    "blowgun-needle": "Fléchette de sarbacane",
    "censer": "Encensoir",
    "crossbow-bolt": "Carreau",
    "sling-bullet": "Balle de fronde",
    "amulet": "Amulette",
    "antitoxin-vial": "Antitoxine (fiole)",
    "crystal": "Cristal",
    "orb": "Orbe",
    "rod": "Bâtonnet",
    "staff": "Bâton",
    "wand": "Baguette",
    "backpack": "Sac à dos",
    "ball-bearings-bag-of-1000": "Billes de roulement (sachet de 1 000)",
    "barrel": "Tonneau",
    "basket": "Panier",
    "bedroll": "Sac de couchage",
    "bell": "Clochette",
    "blanket": "Couverture",
    "block-and-tackle": "Moufle et poulie",
    "book": "Livre",
    "bottle-glass": "Bouteille en verre",
    "bucket": "Seau",
    "caltrops": "Chausse-trapes",
    "candle": "Bougie",
    "case-crossbow-bolt": "Étui à carreaux",
    "case-map-or-scroll": "Étui à carte ou parchemin",
    "chain-10-feet": "Chaîne (3 mètres)",
    "chalk-1-piece": "Craie (1 bâton)",
    "chest": "Coffre",
    "clothes-common": "Vêtements courants",
    "clothes-costume": "Vêtements de costume",
    "clothes-fine": "Vêtements de qualité",
    "clothes-travelers": "Vêtements de voyage",
    "component-pouch": "Bourse à composantes",
    "crowbar": "Pied-de-biche",
    "sprig-of-mistletoe": "Brin de gui",
    "totem": "Totem",
    "wooden-staff": "Bâton de bois",
    "yew-wand": "Baguette d'if",
    "emblem": "Emblème",
    "fishing-tackle": "Attirail de pêche",
    "flask-or-tankard": "Gourde ou chope",
    "grappling-hook": "Grappin",
    "hammer": "Marteau",
    "hammer-sledge": "Masse",
    "holy-water-flask": "Eau bénite (flasque)",
    "hourglass": "Sablier",
    "hunting-trap": "Piège de chasse",
    "ink-1-ounce-bottle": "Encre (flacon de 30 ml)",
    "ink-pen": "Plume",
    "jug-or-pitcher": "Cruche ou pichet",
    "climbers-kit": "Matériel d'escalade",
    "disguise-kit": "Kit de déguisement",
    "forgery-kit": "Kit de falsification",
    "herbalism-kit": "Kit d'herboristerie",
    "healers-kit": "Kit de soin",
    "mess-kit": "Kit de repas",
    "poisoners-kit": "Kit d'empoisonneur",
    "ladder-10-foot": "Échelle (3 mètres)",
    "lamp": "Lampe",
    "lantern-bullseye": "Lanterne à main",
    "lantern-hooded": "Lanterne à capote",
    "little-bag-of-sand": "Petit sac de sable",
    "lock": "Serrure",
    "magnifying-glass": "Loupe",
    "manacles": "Menottes",
    "mirror-steel": "Miroir en acier",
    "oil-flask": "Huile (flasque)",
    "paper-one-sheet": "Papier (1 feuille)",
    "parchment-one-sheet": "Parchemin (1 feuille)",
    "perfume-vial": "Parfum (fiole)",
    "pick-miners": "Pioche de mineur",
    "piton": "Piton",
    "poison-basic-vial": "Poison, basique (fiole)",
    "pole-10-foot": "Perche (3 mètres)",
    "pot-iron": "Marmite en fer",
    "pouch": "Bourse",
    "quiver": "Carquois",
    "ram-portable": "Bélier portatif",
    "rations-1-day": "Rations (1 jour)",
    "reliquary": "Reliquaire",
    "robes": "Robes",
    "rope-hempen-50-feet": "Corde en chanvre (15 mètres)",
    "rope-silk-50-feet": "Corde en soie (15 mètres)",
    "sack": "Sac",
    "scale-merchants": "Balance de marchand",
    "sealing-wax": "Cire à cacheter",
    "shovel": "Pelle",
    "signal-whistle": "Sifflet de signalisation",
    "signet-ring": "Bague à sceau",
    "small-knife": "Petit couteau",
    "soap": "Savon",
    "spellbook": "Livre de sorts",
    "spike-iron": "Pieux en fer",
    "spyglass": "Longue-vue",
    "string-10-feet": "Cordelette (3 mètres)",
    "tent-two-person": "Tente (deux personnes)",
    "tinderbox": "Boîte à amadou",
    "torch": "Torche",
    "vestments": "Ornements sacerdotaux",
    "vial": "Fiole",
    "waterskin": "Gourde",
    "whetstone": "Pierre à aiguiser",

    # Gear packs
    "burglars-pack": "Sac de cambrioleur",
    "diplomats-pack": "Sac de diplomate",
    "dungeoneers-pack": "Sac d'explorateur de donjon",
    "entertainers-pack": "Sac d'artiste",
    "explorers-pack": "Sac d'explorateur",
    "priests-pack": "Sac de prêtre",
    "scholars-pack": "Sac d'érudit",

    # ------------------------------------------------------------------- Tools
    "alchemists-supplies": "Fournitures d'alchimiste",
    "brewers-supplies": "Fournitures de brasseur",
    "calligraphers-supplies": "Fournitures de calligraphe",
    "carpenters-tools": "Outils de charpentier",
    "cartographers-tools": "Outils de cartographe",
    "cobblers-tools": "Outils de cordonnier",
    "cooks-utensils": "Ustensiles de cuisinier",
    "glassblowers-tools": "Outils de verrier",
    "jewelers-tools": "Outils de joaillier",
    "leatherworkers-tools": "Outils de tanneur",
    "masons-tools": "Outils de maçon",
    "painters-supplies": "Fournitures de peintre",
    "potters-tools": "Outils de potier",
    "smiths-tools": "Outils de forgeron",
    "tinkers-tools": "Outils de rétameur",
    "weavers-tools": "Outils de tisserand",
    "woodcarvers-tools": "Outils de sculpteur sur bois",
    "dice-set": "Jeu de dés",
    "playing-card-set": "Jeu de cartes",
    "bagpipes": "Cornemuse",
    "drum": "Tambour",
    "dulcimer": "Tympanon",
    "flute": "Flûte",
    "lute": "Luth",
    "lyre": "Lyre",
    "horn": "Cor",
    "pan-flute": "Flûte de Pan",
    "shawm": "Chalumeau",
    "viol": "Viole",
    "navigators-tools": "Outils de navigateur",
    "thieves-tools": "Outils de voleur",

    # ------------------------------------------------------------------ Mounts
    "camel": "Chameau",
    "donkey": "Âne",
    "mule": "Mulet",
    "elephant": "Éléphant",
    "horse-draft": "Cheval de trait",
    "horse-riding": "Cheval de selle",
    "mastiff": "Dogue",
    "pony": "Poney",
    "warhorse": "Cheval de guerre",
    "barding-padded": "Armure pour cheval matelassée",
    "barding-leather": "Armure pour cheval de cuir",
    "barding-studded-leather": "Armure pour cheval de cuir cloutée",
    "barding-hide": "Armure pour cheval de fourrure",
    "barding-chain-shirt": "Chemise de mailles pour cheval",
    "barding-scale-mail": "Cotte d'écailles pour cheval",
    "barding-breastplate": "Plastron pour cheval",
    "barding-half-plate": "Demi-armure pour cheval",
    "barding-ring-mail": "Cotte d'anneaux pour cheval",
    "barding-chain-mail": "Cotte de mailles pour cheval",
    "barding-splint": "Armure de bandes pour cheval",
    "barding-plate": "Armure de plates pour cheval",
    "bit-and-bridle": "Mors et bride",
    "carriage": "Carrosse",
    "cart": "Charrette",
    "chariot": "Char",
    "animal-feed-1-day": "Foin et avoine (1 jour)",
    "saddle-exotic": "Selle exotique",
    "saddle-military": "Selle militaire",
    "saddle-pack": "Selle de bât",
    "saddle-riding": "Selle de selle",
    "saddlebags": "Fontes",
    "sled": "Traîneau",
    "stabling-1-day": "Écurie (1 jour)",
    "wagon": "Chariot",
    "galley": "Galère",
    "keelboat": "Bateau de cabotage",
    "longship": "Drakkar",
    "rowboat": "Canot à rames",
    "sailing-ship": "Voilier",
    "warship": "Navire de guerre",

    # -------------------------------------------------------------- Magic items
    # Ammunition, generic
    "ammunition": "Munitions, +1, +2 ou +3",
    "ammunition-1": "Munitions +1",
    "ammunition-2": "Munitions +2",
    "ammunition-3": "Munitions +3",

    # Amulets / necklaces / periapts / medallions
    "amulet-of-health": "Amulette de santé",
    "amulet-of-proof-against-detection-and-location": "Amulette de protection contre la détection et la localisation",
    "amulet-of-the-planes": "Amulette des plans",
    "medallion-of-thoughts": "Médaillon des pensées",
    "necklace-of-adaptation": "Collier d'adaptation",
    "necklace-of-fireballs": "Collier de boules de feu",
    "necklace-of-prayer-beads": "Chapelet de prière",
    "periapt-of-health": "Pendentif de santé",
    "periapt-of-proof-against-poison": "Pendentif de protection contre le poison",
    "periapt-of-wound-closure": "Pendentif de fermeture des blessures",

    # Bags / sacks / quivers / haversacks
    "bag-of-beans": "Sac de haricots",
    "bag-of-devouring": "Sac dévorant",
    "bag-of-holding": "Sac sans fond",
    "bag-of-tricks": "Sac à malices",
    "bag-of-tricks-gray": "Sac à malices gris",
    "bag-of-tricks-rust": "Sac à malices roux",
    "bag-of-tricks-tan": "Sac à malices fauve",
    "efficient-quiver": "Carquois efficace",
    "handy-haversack": "Sac à dos pratique",
    "portable-hole": "Trou portatif",

    # Belts
    "belt-of-dwarvenkind": "Ceinturon de sang nain",
    "belt-of-giant-strength": "Ceinturon de force de géant",
    "belt-of-giant-strength-hill": "Ceinturon de force de géant des collines",
    "belt-of-giant-strength-stone": "Ceinturon de force de géant de pierre",
    "belt-of-giant-strength-frost": "Ceinturon de force de géant du givre",
    "belt-of-giant-strength-fire": "Ceinturon de force de géant de feu",
    "belt-of-giant-strength-cloud": "Ceinturon de force de géant des nuages",
    "belt-of-giant-strength-storm": "Ceinturon de force de géant des tempêtes",

    # Beads / gems / stones / ioun stones / scarab
    "bead-of-force": "Perle de force",
    "elemental-gem": "Gemme élémentaire",
    "elemental-gem-air": "Gemme élémentaire de l'air",
    "elemental-gem-earth": "Gemme élémentaire de la terre",
    "elemental-gem-fire": "Gemme élémentaire du feu",
    "elemental-gem-water": "Gemme élémentaire de l'eau",
    "gem-of-brightness": "Gemme de luminosité",
    "gem-of-seeing": "Gemme de vision",
    "pearl-of-power": "Perle de pouvoir",
    "scarab-of-protection": "Scarabée de protection",
    "stone-of-controlling-earth-elementals": "Pierre de contrôle des élémentaires de la terre",
    "stone-of-good-luck-luckstone": "Pierre de bonne chance (pierre porte-bonheur)",
    "ioun-stone": "Pierre ioun",
    "ioun-stone-of-absorption": "Pierre ioun d'absorption",
    "ioun-stone-of-agility": "Pierre ioun d'agilité",
    "ioun-stone-of-awareness": "Pierre ioun de conscience",
    "ioun-stone-of-fortitude": "Pierre ioun de courage",
    "ioun-stone-of-greater-absorption": "Pierre ioun d'absorption supérieure",
    "ioun-stone-of-insight": "Pierre ioun de discernement",
    "ioun-stone-of-intellect": "Pierre ioun d'intellect",
    "ioun-stone-of-leadership": "Pierre ioun de commandement",
    "ioun-stone-of-mastery": "Pierre ioun de maîtrise",
    "ioun-stone-of-protection": "Pierre ioun de protection",
    "ioun-stone-of-regeneration": "Pierre ioun de régénération",
    "ioun-stone-of-reserve": "Pierre ioun de réserve",
    "ioun-stone-of-strength": "Pierre ioun de force",
    "ioun-stone-of-sustenance": "Pierre ioun de subsistance",

    # Boots / shoes / slippers
    "boots-of-elvenkind": "Bottes elfiques",
    "boots-of-levitation": "Bottes de lévitation",
    "boots-of-speed": "Bottes de vitesse",
    "boots-of-striding-and-springing": "Bottes de marche et de bond",
    "boots-of-the-winterlands": "Bottes des terres glaciales",
    "slippers-of-spider-climbing": "Pantoufles d'escalade arachnéenne",
    "winged-boots": "Bottes ailées",

    # Bowls / braziers / censer / decanters / flasks / bottles / lamps
    "bowl-of-commanding-water-elementals": "Bol de commandement des élémentaires de l'eau",
    "brazier-of-commanding-fire-elementals": "Brasero de commandement des élémentaires du feu",
    "censer-of-controlling-air-elementals": "Encensoir de contrôle des élémentaires de l'air",
    "decanter-of-endless-water": "Cruche d'eau inépuisable",
    "eversmoking-bottle": "Bouteille à fumée continue",
    "iron-flask": "Flasque de fer",
    "efreeti-bottle": "Bouteille d'efreet",
    "lantern-of-revealing": "Lanterne révélatrice",
    "alchemist's-fire-flask": "Feu alchimique (flasque)",

    # Bracers / gauntlets / gloves / goggles
    "bracers-of-archery": "Brassards de tir à l'arc",
    "bracers-of-defense": "Brassards de défense",
    "gauntlets-of-ogre-power": "Gantelets de puissance d'ogre",
    "gloves-of-missile-snaring": "Gants d'interception de projectiles",
    "gloves-of-swimming-and-climbing": "Gants de natation et d'escalade",
    "goggles-of-night": "Lunettes nocturnes",

    # Brooch / broom / cape / carpet / cloaks / mantles
    "brooch-of-shielding": "Broche de protection",
    "broom-of-flying": "Balai volant",
    "cape-of-the-mountebank": "Cape du saltimbanque",
    "carpet-of-flying": "Tapis volant",
    "carpet-of-flying-3x5": "Tapis volant (90 cm × 150 cm)",
    "carpet-of-flying-4x6": "Tapis volant (120 cm × 180 cm)",
    "carpet-of-flying-5x7": "Tapis volant (150 cm × 210 cm)",
    "carpet-of-flying-6x9": "Tapis volant (180 cm × 270 cm)",
    "cloak-of-arachnida": "Cape d'arachnide",
    "cloak-of-displacement": "Cape de déplacement",
    "cloak-of-elvenkind": "Cape elfique",
    "cloak-of-protection": "Cape de protection",
    "cloak-of-the-bat": "Cape de la chauve-souris",
    "cloak-of-the-manta-ray": "Cape de la raie manta",
    "mantle-of-spell-resistance": "Manteau de résistance à la magie",

    # Candles / chimes / horns / pipes / instruments
    "candle-of-invocation": "Bougie d'invocation",
    "chime-of-opening": "Carillon d'ouverture",
    "horn-of-blasting": "Cor de destruction",
    "horn-of-valhalla": "Cor du Valhalla",
    "horn-of-valhalla-silver": "Cor d'argent du Valhalla",
    "horn-of-valhalla-brass": "Cor d'airain du Valhalla",
    "horn-of-valhalla-bronze": "Cor de bronze du Valhalla",
    "horn-of-valhalla-iron": "Cor de fer du Valhalla",
    "pipes-of-haunting": "Cornemuse hantée",
    "pipes-of-the-sewers": "Cornemuse des égouts",

    # Circlets / helms / hats / headbands
    "circlet-of-blasting": "Diadème de flamboiement",
    "hat-of-disguise": "Chapeau de déguisement",
    "headband-of-intellect": "Bandeau d'intellect",
    "helm-of-brilliance": "Heaume de brillance",
    "helm-of-comprehending-languages": "Heaume de compréhension des langues",
    "helm-of-telepathy": "Heaume de télépathie",
    "helm-of-teleportation": "Heaume de téléportation",

    # Crystal balls / orbs / eyes / mirrors
    "crystal-ball": "Boule de cristal",
    "crystal-ball-of-mind-reading": "Boule de cristal de lecture des pensées",
    "crystal-ball-of-telepathy": "Boule de cristal de télépathie",
    "crystal-ball-of-true-seeing": "Boule de cristal de vision véritable",
    "eyes-of-charming": "Yeux de charme",
    "eyes-of-minute-seeing": "Yeux de vision minutieuse",
    "eyes-of-the-eagle": "Yeux de l'aigle",
    "mirror-of-life-trapping": "Miroir de capture des âmes",
    "orb-of-dragonkind": "Orbe de la race des dragons",

    # Cubes / decks / dusts / feather tokens / figurines
    "cube-of-force": "Cube de force",
    "cubic-gate": "Porte dimensionnelle cubique",
    "deck-of-illusions": "Jeu d'illusions",
    "deck-of-many-things": "Jeu des nombreuses choses",
    "dust-of-disappearance": "Poudre de disparition",
    "dust-of-dryness": "Poudre de sécheresse",
    "dust-of-sneezing-and-choking": "Poudre d'éternuement et d'étouffement",
    "feather-token": "Jeton en plume",
    "feather-token-anchor": "Jeton en plume d'ancre",
    "feather-token-bird": "Jeton en plume d'oiseau",
    "feather-token-fan": "Jeton en plume d'éventail",
    "feather-token-swan-boat": "Jeton en plume de cygne-bateau",
    "feather-token-tree": "Jeton en plume d'arbre",
    "feather-token-whip": "Jeton en plume de fouet",
    "figurine-of-wondrous-power": "Figurine merveilleuse",
    "figurine-of-wondrous-power-bronze-griffon": "Figurine merveilleuse de griffon de bronze",
    "figurine-of-wondrous-power-ebony-fly": "Figurine merveilleuse de mouche d'ébène",
    "figurine-of-wondrous-power-golden-lions": "Figurine merveilleuse de lions dorés",
    "figurine-of-wondrous-power-ivory-goats": "Figurine merveilleuse de chèvres d'ivoire",
    "figurine-of-wondrous-power-marble-elephant": "Figurine merveilleuse d'éléphant de marbre",
    "figurine-of-wondrous-power-obsidian-steed": "Figurine merveilleuse de coursier d'obsidienne",
    "figurine-of-wondrous-power-onyx-dog": "Figurine merveilleuse de chien d'onyx",
    "figurine-of-wondrous-power-serpentine-owl": "Figurine merveilleuse de hibou serpentin",
    "figurine-of-wondrous-power-silver-raven": "Figurine merveilleuse de corbeau d'argent",

    # Folding boat / fortress / apparatus / dimensional shackles
    "apparatus-of-the-crab": "Appareil du crabe",
    "dimensional-shackles": "Menottes dimensionnelles",
    "folding-boat": "Bateau pliable",
    "instant-fortress": "Forteresse instantanée",

    # Horseshoes / immovable rod / iron bands / marvelous pigments
    "horseshoes-of-a-zephyr": "Fers à cheval du zéphyr",
    "horseshoes-of-speed": "Fers à cheval de vitesse",
    "immovable-rod": "Tige immobile",
    "iron-bands-of-binding": "Bandelettes de fer de ligature",
    "marvelous-pigments": "Pigments merveilleux",

    # Manuals / tomes
    "manual-of-bodily-health": "Manuel de santé corporelle",
    "manual-of-gainful-exercise": "Manuel d'exercice physique",
    "manual-of-golems": "Manuel des golems",
    "manual-of-golems-clay": "Manuel des golems d'argile",
    "manual-of-golems-flesh": "Manuel des golems de chair",
    "manual-of-golems-iron": "Manuel des golems de fer",
    "manual-of-golems-stone": "Manuel des golems de pierre",
    "manual-of-quickness-of-action": "Manuel de promptitude d'action",
    "tome-of-clear-thought": "Livre de pensée claire",
    "tome-of-leadership-and-influence": "Livre de commandement et d'influence",
    "tome-of-understanding": "Livre de compréhension",

    # Oils / philters / potions / ointments
    "oil-of-etherealness": "Huile d'éthéralité",
    "oil-of-sharpness": "Huile de tranchant",
    "oil-of-slipperiness": "Huile de glissance",
    "philter-of-love": "Philtre d'amour",
    "potion-of-animal-friendship": "Potion d'amitié avec les animaux",
    "potion-of-clairvoyance": "Potion de clairvoyance",
    "potion-of-climbing": "Potion d'escalade",
    "potion-of-diminution": "Potion de rapetissement",
    "potion-of-flying": "Potion de vol",
    "potion-of-gaseous-form": "Potion de forme gazeuse",
    "potion-of-giant-strength": "Potion de force de géant",
    "potion-of-giant-strength-hill": "Potion de force de géant des collines",
    "potion-of-giant-strength-frost": "Potion de force de géant du givre",
    "potion-of-giant-strength-stone": "Potion de force de géant de pierre",
    "potion-of-giant-strength-fire": "Potion de force de géant de feu",
    "potion-of-giant-strength-cloud": "Potion de force de géant des nuages",
    "potion-of-giant-strength-storm": "Potion de force de géant des tempêtes",
    "potion-of-growth": "Potion d'agrandissement",
    "potion-of-healing": "Potion de soin",
    "potion-of-healing-common": "Potion de soin",
    "potion-of-healing-greater": "Potion de soin majeure",
    "potion-of-healing-superior": "Potion de soin supérieure",
    "potion-of-healing-supreme": "Potion de soin suprême",
    "potion-of-heroism": "Potion d'héroïsme",
    "potion-of-invisibility": "Potion d'invisibilité",
    "potion-of-mind-reading": "Potion de lecture des pensées",
    "potion-of-poison": "Potion de poison",
    "potion-of-resistance": "Potion de résistance",
    "potion-of-resistance-acid": "Potion de résistance à l'acide",
    "potion-of-resistance-cold": "Potion de résistance au froid",
    "potion-of-resistance-fire": "Potion de résistance au feu",
    "potion-of-resistance-force": "Potion de résistance aux forces",
    "potion-of-resistance-lightning": "Potion de résistance à la foudre",
    "potion-of-resistance-necrotic": "Potion de résistance aux nécrotiques",
    "potion-of-resistance-poison": "Potion de résistance au poison",
    "potion-of-resistance-psychic": "Potion de résistance aux psychiques",
    "potion-of-resistance-radiant": "Potion de résistance aux radiants",
    "potion-of-resistance-thunder": "Potion de résistance au tonnerre",
    "potion-of-speed": "Potion de vitesse",
    "potion-of-water-breathing": "Potion de respiration aquatique",
    "restorative-ointment": "Onguent restaurateur",

    # Rings
    "ring-of-animal-influence": "Anneau d'influence animale",
    "ring-of-djinni-summoning": "Anneau d'invocation de djinn",
    "ring-of-elemental-command": "Anneau de commandement élémentaire",
    "ring-of-elemental-command-air": "Anneau de commandement élémentaire de l'air",
    "ring-of-elemental-command-earth": "Anneau de commandement élémentaire de la terre",
    "ring-of-elemental-command-fire": "Anneau de commandement élémentaire du feu",
    "ring-of-elemental-command-water": "Anneau de commandement élémentaire de l'eau",
    "ring-of-evasion": "Anneau d'évasion",
    "ring-of-feather-falling": "Anneau de chute ralentie",
    "ring-of-free-action": "Anneau d'action libre",
    "ring-of-invisibility": "Anneau d'invisibilité",
    "ring-of-jumping": "Anneau de saut",
    "ring-of-mind-shielding": "Anneau de protection de l'esprit",
    "ring-of-protection": "Anneau de protection",
    "ring-of-regeneration": "Anneau de régénération",
    "ring-of-resistance": "Anneau de résistance",
    "ring-of-resistance-acid": "Anneau de résistance à l'acide",
    "ring-of-resistance-cold": "Anneau de résistance au froid",
    "ring-of-resistance-fire": "Anneau de résistance au feu",
    "ring-of-resistance-force": "Anneau de résistance aux forces",
    "ring-of-resistance-lightning": "Anneau de résistance à la foudre",
    "ring-of-resistance-necrotic": "Anneau de résistance aux nécrotiques",
    "ring-of-resistance-poison": "Anneau de résistance au poison",
    "ring-of-resistance-psychic": "Anneau de résistance aux psychiques",
    "ring-of-resistance-radiant": "Anneau de résistance aux radiants",
    "ring-of-resistance-thunder": "Anneau de résistance au tonnerre",
    "ring-of-shooting-stars": "Anneau des étoiles filantes",
    "ring-of-spell-storing": "Anneau de réserve de sorts",
    "ring-of-spell-turning": "Anneau de renvoi de sorts",
    "ring-of-swimming": "Anneau de natation",
    "ring-of-telekinesis": "Anneau de télékinésie",
    "ring-of-the-ram": "Anneau du bélier",
    "ring-of-three-wishes": "Anneau des trois vœux",
    "ring-of-warmth": "Anneau de chaleur",
    "ring-of-water-walking": "Anneau de marche sur l'eau",
    "ring-of-x-ray-vision": "Anneau de vision aux rayons X",

    # Robes / ropes
    "robe-of-eyes": "Robe d'yeux",
    "robe-of-scintillating-colors": "Robe de couleurs chatoyantes",
    "robe-of-stars": "Robe des étoiles",
    "robe-of-the-archmagi": "Robe des archimages",
    "robe-of-useful-items": "Robe d'objets utiles",
    "rope-of-climbing": "Corde d'escalade",
    "rope-of-entanglement": "Corde d'entrave",

    # Rods / staffs / wands
    "rod-of-absorption": "Bâtonnet d'absorption",
    "rod-of-alertness": "Bâtonnet de vigilance",
    "rod-of-lordly-might": "Bâtonnet de pouvoir seigneurial",
    "rod-of-rulership": "Bâtonnet de commandement",
    "rod-of-security": "Bâtonnet de sécurité",
    "staff-of-charming": "Bâton de charme",
    "staff-of-fire": "Bâton de feu",
    "staff-of-frost": "Bâton de givre",
    "staff-of-healing": "Bâton de guérison",
    "staff-of-power": "Bâton de pouvoir",
    "staff-of-striking": "Bâton de frappe",
    "staff-of-swarming-insects": "Bâton des insectes grouillants",
    "staff-of-the-magi": "Bâton des mages",
    "staff-of-the-python": "Bâton du python",
    "staff-of-the-woodlands": "Bâton des bois",
    "staff-of-thunder-and-lightning": "Bâton du tonnerre et de la foudre",
    "staff-of-withering": "Bâton de flétrissement",
    "wand-of-binding": "Baguette de ligature",
    "wand-of-enemy-detection": "Baguette de détection des ennemis",
    "wand-of-fear": "Baguette de terreur",
    "wand-of-fireballs": "Baguette de boules de feu",
    "wand-of-lightning-bolts": "Baguette d'éclairs",
    "wand-of-magic-detection": "Baguette de détection de la magie",
    "wand-of-magic-missiles": "Baguette de projectiles magiques",
    "wand-of-paralysis": "Baguette de paralysie",
    "wand-of-polymorph": "Baguette de métamorphose",
    "wand-of-secrets": "Baguette des secrets",
    "wand-of-the-war-mage": "Baguette du mage de guerre, +1, +2 ou +3",
    "wand-of-the-war-mage-1": "Baguette du mage de guerre +1",
    "wand-of-the-war-mage-2": "Baguette du mage de guerre +2",
    "wand-of-the-war-mage-3": "Baguette du mage de guerre +3",
    "wand-of-web": "Baguette de toile",
    "wand-of-wonder": "Baguette des merveilles",

    # Scrolls / spells
    "spell-scroll": "Parchemin de sort",
    "spell-scroll-cantrip": "Parchemin de sort (tour de magie)",
    "spell-scroll-1st": "Parchemin de sort (1er cercle)",
    "spell-scroll-2nd": "Parchemin de sort (2e cercle)",
    "spell-scroll-3rd": "Parchemin de sort (3e cercle)",
    "spell-scroll-4th": "Parchemin de sort (4e cercle)",
    "spell-scroll-5th": "Parchemin de sort (5e cercle)",
    "spell-scroll-6th": "Parchemin de sort (6e cercle)",
    "spell-scroll-7th": "Parchemin de sort (7e cercle)",
    "spell-scroll-8th": "Parchemin de sort (8e cercle)",
    "spell-scroll-9th": "Parchemin de sort (9e cercle)",
    "arrow-of-slaying": "Flèche de meurtre",

    # Talismans / spheres / sovereign glue / solvents / wells / wind fans / wings
    "sovereign-glue": "Colle souveraine",
    "sphere-of-annihilation": "Sphère d'annihilation",
    "talisman-of-pure-good": "Talisman du bien absolu",
    "talisman-of-the-sphere": "Talisman de la sphère",
    "talisman-of-ultimate-evil": "Talisman du mal absolu",
    "universal-solvent": "Solvant universel",
    "well-of-many-worlds": "Puits des nombreux mondes",
    "wind-fan": "Éventail des vents",
    "wings-of-flying": "Ailes volantes",
}

# A couple of srdIndex keys are ambiguous between mundane armor pieces
# (e.g. "hide-armor" - SRD uses "Armure de fourrure", not "cuir cloutée").
# Override the duplicates here, after the main table, for clarity.
FR_TRANSLATIONS["hide-armor"] = "Armure de fourrure"
FR_TRANSLATIONS["saddle-riding"] = "Selle de selle"  # kept literal; see below
FR_TRANSLATIONS["saddle-riding"] = "Selle de monte"


# ===========================================================================
# 2. WEIGHT ESTIMATION
# ===========================================================================
#
# (a) Magic weapons -> mundane weapon srdIndex whose weight to copy.
# ---------------------------------------------------------------------------

MAGIC_WEAPON_TO_MUNDANE: dict[str, str] = {
    # Swords default to longsword unless the lore says otherwise
    "berserker-axe": "battleaxe",
    "dagger-of-venom": "dagger",
    "dancing-sword": "longsword",
    "defender": "longsword",
    "dragon-slayer": "longsword",
    "dwarven-thrower": "warhammer",
    "flame-tongue": "longsword",
    "frost-brand": "longsword",
    "giant-slayer": "longsword",
    "hammer-of-thunderbolts": "maul",
    "holy-avenger": "longsword",
    "javelin-of-lightning": "javelin",
    "luck-blade": "longsword",
    "mace-of-disruption": "mace",
    "mace-of-smiting": "mace",
    "mace-of-terror": "mace",
    "nine-lives-stealer": "longsword",
    "oathbow": "longbow",
    "scimitar-of-speed": "scimitar",
    "sun-blade": "longsword",
    "sword-of-life-stealing": "longsword",
    "sword-of-sharpness": "longsword",
    "sword-of-wounding": "longsword",
    "trident-of-fish-command": "trident",
    "vorpal-sword": "longsword",
    # Generic "+1/+2/+3 weapon" -> use longsword as a representative weight.
    "weapon": "longsword",
    "weapon-1": "longsword",
    "weapon-2": "longsword",
    "weapon-3": "longsword",
    # "vicious-weapon" is generic; use longsword as a representative.
    "vicious-weapon": "longsword",
}

# (b) Magic armor -> mundane armor srdIndex whose weight to copy.
# ---------------------------------------------------------------------------

MAGIC_ARMOR_TO_MUNDANE: dict[str, str] = {
    # Generic "+N armor" and "mithral/adamantine" map to chain mail as a
    # canonical medium-heavy reference.
    "adamantine-armor": "chain-mail",
    "armor": "chain-mail",
    "armor-1": "chain-mail",
    "armor-2": "chain-mail",
    "armor-3": "chain-mail",
    "armor-of-invulnerability": "plate-armor",
    "armor-of-resistance": "chain-mail",
    "armor-of-vulnerability": "chain-mail",
    "demon-armor": "plate-armor",
    "dwarven-plate": "plate-armor",
    "elven-chain": "chain-shirt",
    "glamoured-studded-leather-armor": "studded-leather-armor",
    "mithral-armor": "chain-mail",
    "plate-armor-of-etherealness": "plate-armor",
    # Dragon scale mail -> scale mail
    "dragon-scale-mail": "scale-mail",
    "dragon-scale-mail-black": "scale-mail",
    "dragon-scale-mail-blue": "scale-mail",
    "dragon-scale-mail-brass": "scale-mail",
    "dragon-scale-mail-bronze": "scale-mail",
    "dragon-scale-mail-copper": "scale-mail",
    "dragon-scale-mail-gold": "scale-mail",
    "dragon-scale-mail-green": "scale-mail",
    "dragon-scale-mail-red": "scale-mail",
    "dragon-scale-mail-silver": "scale-mail",
    "dragon-scale-mail-white": "scale-mail",
    # Shields
    "animated-shield": "shield",
    "arrow-catching-shield": "shield",
    "shield-of-missile-attraction": "shield",
    "spellguard-shield": "shield",
}

# (c) Magic items -> fixed weight (kg) by srdIndex.
#
# These are explicit overrides for items whose type doesn't fall neatly into
# the keyword-based heuristic below (e.g. heavy furniture-like objects).
# ---------------------------------------------------------------------------

MAGIC_ITEM_EXPLICIT_WEIGHT: dict[str, float] = {
    # Large construct-like / furniture magic items.
    "apparatus-of-the-crab": 226.8,      # ~500 lb barrel-shaped submersible
    "instant-fortress": 907.2,           # metal tower, ~2000 lb
    "folding-boat": 18.144,              # folds to a small box; boat itself ~40 lb box
    "broom-of-flying": 1.5,              # larger than a wand, lighter than a staff
    "carpet-of-flying": 5.0,
    "carpet-of-flying-3x5": 5.0,
    "carpet-of-flying-4x6": 7.0,
    "carpet-of-flying-5x7": 9.0,
    "carpet-of-flying-6x9": 12.0,
    "iron-flask": 1.0,                   # stout sealed metal flask
    "efreeti-bottle": 1.0,
    "well-of-many-worlds": 0.2,          # tapestry-cloth
    "mirror-of-life-trapping": 25.0,     # full-length mirror
    "lantern-of-revealing": 1.0,
    "brazier-of-commanding-fire-elementals": 5.0,
    "bowl-of-commanding-water-elementals": 2.0,
    "decanter-of-endless-water": 1.0,
    "eversmoking-bottle": 0.5,
    "sphere-of-annihilation": 0.0,       # weightless by lore
    "portable-hole": 0.0,                # a 2D circle of cloth, negligible
    "feather-token": 0.01,
    "feather-token-anchor": 0.01,
    "feather-token-bird": 0.01,
    "feather-token-fan": 0.01,
    "feather-token-swan-boat": 0.01,
    "feather-token-tree": 0.01,
    "feather-token-whip": 0.01,
    "horseshoes-of-a-zephyr": 2.0,        # set of 4 horseshoes
    "horseshoes-of-speed": 2.0,
    "iron-bands-of-binding": 0.5,
    "rope-of-climbing": 0.5,
    "rope-of-entanglement": 0.5,
    "wind-fan": 0.1,
    "wings-of-flying": 1.0,
    "sovereign-glue": 0.1,
    "universal-solvent": 0.1,
    "restorative-ointment": 0.1,
    "marvelous-pigments": 0.5,
    "deck-of-illusions": 0.2,
    "deck-of-many-things": 0.2,
    "dust-of-disappearance": 0.05,
    "dust-of-dryness": 0.05,
    "dust-of-sneezing-and-choking": 0.05,
    "bead-of-force": 0.01,
    "scarab-of-protection": 0.05,
    "arrow-of-slaying": 0.025,
    "ammunition": 0.025,
    "ammunition-1": 0.025,
    "ammunition-2": 0.025,
    "ammunition-3": 0.025,
}

# (d) Mount / animal / vehicle explicit weights (kg).
# ---------------------------------------------------------------------------

MOUNT_EXPLICIT_WEIGHT: dict[str, float] = {
    "camel": 500.0,
    "donkey": 180.0,
    "mule": 400.0,
    "elephant": 3000.0,
    "horse-draft": 900.0,
    "horse-riding": 500.0,
    "mastiff": 40.0,
    "pony": 200.0,
    "warhorse": 600.0,
    "stabling-1-day": 0.0,           # a service, not a physical object
    "galley": 136078.0,              # ~150 tons, large war galley
    "keelboat": 9072.0,              # ~10 tons
    "longship": 18144.0,             # ~20 tons
    "rowboat": 90.0,                 # ~200 lb clinker-built small boat
    "sailing-ship": 45359.0,         # ~50 tons merchant vessel
    "warship": 68039.0,              # ~75 tons
}

# (e) Gear explicit weights (kg) for the items the keyword rules don't cover.
# ---------------------------------------------------------------------------

GEAR_EXPLICIT_WEIGHT: dict[str, float] = {
    "alms-box": 0.5,
    "block-of-incense": 0.1,
    "censer": 1.0,
    "antitoxin-vial": 0.1,
    "bell": 0.5,
    "candle": 0.05,
    "chalk-1-piece": 0.01,
    "sprig-of-mistletoe": 0.01,
    "totem": 0.2,
    "emblem": 0.05,
    "ink-1-ounce-bottle": 0.05,
    "ink-pen": 0.01,
    "little-bag-of-sand": 0.2,
    "magnifying-glass": 0.1,
    "paper-one-sheet": 0.005,
    "parchment-one-sheet": 0.005,
    "perfume-vial": 0.05,
    "poison-basic-vial": 0.1,
    "sealing-wax": 0.05,
    "signal-whistle": 0.02,
    "signet-ring": 0.02,
    "small-knife": 0.2,
    "soap": 0.1,
    "string-10-feet": 0.05,
    "vestments": 2.0,
    "vial": 0.05,
    # Gear packs: a backpack filled with the contents listed in the SRD.
    "burglars-pack": 20.0,
    "diplomats-pack": 20.0,
    "dungeoneers-pack": 20.0,
    "entertainers-pack": 20.0,
    "explorers-pack": 20.0,
    "priests-pack": 20.0,
    "scholars-pack": 20.0,
}

# (f) Tool explicit weights (kg).
# ---------------------------------------------------------------------------

TOOL_EXPLICIT_WEIGHT: dict[str, float] = {
    "dice-set": 0.1,
    "playing-card-set": 0.1,
}


# ---------------------------------------------------------------------------
# Magic-item keyword -> default weight (kg)
# Applied when no explicit override exists. Order matters: the first matching
# keyword wins. Checked against the item's English ``name`` (lowercased).
# ---------------------------------------------------------------------------

MAGIC_ITEM_KEYWORD_WEIGHTS: list[tuple[str, float]] = [
    # Rings (must precede generic jewellery)
    ("ring", 0.02),
    # Ioun stones orbit the head; treated as a tiny gemstone.
    ("ioun stone", 0.01),
    # Amulets / necklaces / periapts / medallions / brooches / talismans
    ("amulet", 0.05),
    ("necklace", 0.05),
    ("periapt", 0.05),
    ("medallion", 0.05),
    ("brooch", 0.05),
    ("talisman", 0.05),
    ("pearl", 0.01),
    # Gems / crystals / orbs / scarabs
    ("gem", 0.01),
    ("crystal", 0.5),       # focusing crystal (hand-held)
    ("orb", 0.5),
    ("scarab", 0.05),
    ("stone", 0.01),
    # Potions / oils / philters / ointments
    ("potion", 0.1),
    ("oil", 0.1),
    ("philter", 0.1),
    ("ointment", 0.1),
    ("glue", 0.1),
    ("solvent", 0.1),
    # Belts
    ("belt", 0.15),
    # Boots / slippers / shoes / horseshoes
    ("boots", 0.5),
    ("slippers", 0.5),
    ("horseshoes", 2.0),
    # Bracers / gauntlets / gloves / goggles
    ("bracers", 0.5),
    ("gauntlets", 0.5),
    ("gloves", 0.5),
    ("goggles", 0.5),
    # Headgear
    ("helm", 0.5),
    ("hat", 0.5),
    ("headband", 0.5),
    ("circlet", 0.5),
    ("crown", 0.5),
    # Cloaks / capes / mantles / robes
    ("cloak", 1.0),
    ("cape", 1.0),
    ("mantle", 1.0),
    ("robe", 1.0),
    ("wings", 1.0),
    # Bags / sacks / quivers / haversacks / holes
    ("bag", 0.5),
    ("sack", 0.5),
    ("quiver", 0.5),
    ("haversack", 0.5),
    ("hole", 0.0),
    # Scrolls / books / tomes / manuals
    ("scroll", 0.5),
    ("book", 0.5),
    ("tome", 0.5),
    ("manual", 0.5),
    ("deck", 0.2),
    # Wands / rods / staffs
    ("wand", 1.0),
    ("rod", 1.0),
    ("staff", 1.0),
    # Horns / whistles / pipes / chimes
    ("horn", 0.2),
    ("whistle", 0.2),
    ("pipes", 0.2),
    ("chime", 0.2),
    # Figurines
    ("figurine", 0.1),
    # Tokens / dusts / beads / feathers
    ("token", 0.01),
    ("dust", 0.05),
    ("bead", 0.01),
    ("feather", 0.01),
    # Lanterns / lamps / braziers / bowls / decanters / bottles / flasks
    ("lantern", 1.0),
    ("lamp", 1.0),
    ("brazier", 5.0),
    ("bowl", 2.0),
    ("decanter", 1.0),
    ("bottle", 0.5),
    ("flask", 1.0),
    # Eyes / mirrors
    ("eyes", 0.05),
    ("mirror", 25.0),
    # Cubes / cubic gates / shackles / bands / pigments / ropes
    ("cube", 0.5),
    ("cubic", 0.5),
    ("shackles", 2.0),
    ("bands", 0.5),
    ("pigments", 0.5),
    ("rope", 0.5),
    # Broom / carpet / fan / fan
    ("broom", 1.5),
    ("carpet", 5.0),
    ("fan", 0.1),
    # Apparatus / fortress / boat
    ("apparatus", 226.8),
    ("fortress", 907.2),
    ("boat", 18.144),
    # Sphere / well
    ("sphere", 0.0),
    ("well", 0.2),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def translate_item(item: dict) -> str | None:
    """Return the French name for ``item`` or ``None`` if no translation."""
    idx = item.get("srdIndex")
    if idx and idx in FR_TRANSLATIONS:
        return FR_TRANSLATIONS[idx]
    name = item.get("name")
    if name and name in FR_TRANSLATIONS:
        return FR_TRANSLATIONS[name]
    return None


def french_calque(name: str) -> str:
    """
    Build a reasonable French calque for an unknown English item name.

    This is a fallback so that no item is ever left without a ``nameFr``.
    It applies a handful of safe word substitutions and otherwise returns
    the original English name (still acceptable for obscure magic items).
    """
    if not name:
        return name or ""
    s = name
    replacements = [
        ("Sword", "Épée"), ("sword", "épée"),
        ("Axe", "Hache"), ("axe", "hache"),
        ("Hammer", "Marteau"), ("hammer", "marteau"),
        ("Bow", "Arc"), ("bow", "arc"),
        ("Spear", "Lance"), ("spear", "lance"),
        ("Shield", "Bouclier"), ("shield", "bouclier"),
        ("Armor", "Armure"), ("armor", "armure"),
        ("Ring", "Anneau"), ("ring", "anneau"),
        ("Cloak", "Cape"), ("cloak", "cape"),
        ("Boots", "Bottes"), ("boots", "bottes"),
        ("Helm", "Heaume"), ("helm", "heaume"),
        ("Dragon", "Dragon"), ("dragon", "dragon"),
    ]
    for en, fr in replacements:
        s = s.replace(en, fr)
    return s


def estimate_magic_item_weight(item: dict) -> float | None:
    """
    Estimate a weight (kg) for a magic item whose ``weightKg`` is null.
    Returns ``None`` if nothing reasonable can be inferred.
    """
    idx = item.get("srdIndex")
    name = item.get("name") or ""

    if idx in MAGIC_ITEM_EXPLICIT_WEIGHT:
        return MAGIC_ITEM_EXPLICIT_WEIGHT[idx]

    lower = name.lower()
    for keyword, weight in MAGIC_ITEM_KEYWORD_WEIGHTS:
        if keyword in lower:
            return weight

    # Default for unknown small wondrous items.
    return 0.5


def estimate_weight(item: dict) -> float | None:
    """
    Pick a weight (kg) for an item whose ``weightKg`` is null.

    Dispatches on category. Returns ``None`` if no rule applies (which the
    caller will report as unmatched).
    """
    idx = item.get("srdIndex")
    category = item.get("category")

    # ---- Weapons (magic) -----------------------------------------------
    if category == "weapon":
        mundane = MAGIC_WEAPON_TO_MUNDANE.get(idx)
        if mundane:
            return _MUNDANE_WEIGHTS.get(mundane)
        # Fallback: any magic weapon without a mapping -> longsword weight.
        return _MUNDANE_WEAPON_DEFAULT

    # ---- Armor (magic) -------------------------------------------------
    if category == "armor":
        mundane = MAGIC_ARMOR_TO_MUNDANE.get(idx)
        if mundane:
            return _MUNDANE_WEIGHTS.get(mundane)
        return _MUNDANE_ARMOR_DEFAULT

    # ---- Gear ----------------------------------------------------------
    if category == "gear":
        if idx in GEAR_EXPLICIT_WEIGHT:
            return GEAR_EXPLICIT_WEIGHT[idx]
        return None

    # ---- Tools ---------------------------------------------------------
    if category == "tool":
        if idx in TOOL_EXPLICIT_WEIGHT:
            return TOOL_EXPLICIT_WEIGHT[idx]
        return None

    # ---- Mounts / vehicles ---------------------------------------------
    if category == "mount":
        if idx in MOUNT_EXPLICIT_WEIGHT:
            return MOUNT_EXPLICIT_WEIGHT[idx]
        return None

    # ---- Magic items ---------------------------------------------------
    if category == "magic":
        return estimate_magic_item_weight(item)

    return None


# Lazily-populated lookup tables (filled by ``main`` once the data is loaded).
_MUNDANE_WEIGHTS: dict[str, float] = {}
_MUNDANE_WEAPON_DEFAULT = 1.361   # longsword
_MUNDANE_ARMOR_DEFAULT = 24.948   # chain mail


def populate_mundane_weights(items: list[dict]) -> None:
    """Build the srdIndex -> weightKg table from mundane weapons and armor."""
    global _MUNDANE_WEIGHTS
    _MUNDANE_WEIGHTS = {
        i["srdIndex"]: i["weightKg"]
        for i in items
        if i.get("weightKg") is not None
        and i.get("category") in ("weapon", "armor")
    }


# ===========================================================================
# Main
# ===========================================================================

def main() -> int:
    if not DATA_FILE.exists():
        print(f"ERROR: data file not found at {DATA_FILE}")
        return 1

    with DATA_FILE.open("r", encoding="utf-8") as fh:
        items = json.load(fh)

    populate_mundane_weights(items)

    translated = 0
    calqued = 0
    weights_filled = 0
    unmatched_translations: list[tuple[str, str]] = []
    unmatched_weights: list[tuple[str, str]] = []

    for item in items:
        # ---------- nameFr ----------
        if not item.get("nameFr"):
            fr = translate_item(item)
            if fr:
                item["nameFr"] = fr
                translated += 1
            else:
                item["nameFr"] = french_calque(item.get("name", ""))
                calqued += 1
                unmatched_translations.append(
                    (item.get("srdIndex", "?"), item.get("name", "?"))
                )

        # ---------- weightKg ----------
        if item.get("weightKg") is None:
            w = estimate_weight(item)
            if w is not None:
                # Round to 3 decimals to match the precision used in the seed.
                item["weightKg"] = round(w, 3)
                weights_filled += 1
            else:
                unmatched_weights.append(
                    (item.get("srdIndex", "?"), item.get("name", "?"))
                )

    # Write back with stable, readable formatting.
    with DATA_FILE.open("w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # ---- Summary --------------------------------------------------------
    total = len(items)
    null_weights_left = sum(1 for i in items if i.get("weightKg") is None)
    missing_fr = sum(1 for i in items if not i.get("nameFr"))

    print("=" * 60)
    print("translate-items.py - summary")
    print("=" * 60)
    print(f"Total items processed        : {total}")
    print(f"  nameFr added (lookup)      : {translated}")
    print(f"  nameFr added (calque fallb.): {calqued}")
    print(f"  nameFr still missing       : {missing_fr}")
    print(f"  weightKg filled            : {weights_filled}")
    print(f"  weightKg still null        : {null_weights_left}")
    print()

    if unmatched_translations:
        print(f"Items that needed a French calque ({len(unmatched_translations)}):")
        for idx, name in unmatched_translations:
            print(f"  - {idx} | {name}")
        print()

    if unmatched_weights:
        print(f"Items that could not be given a weight ({len(unmatched_weights)}):")
        for idx, name in unmatched_weights:
            print(f"  - {idx} | {name}")
    else:
        print("All null weights were filled.")

    print()
    print(f"Updated file written to: {DATA_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
