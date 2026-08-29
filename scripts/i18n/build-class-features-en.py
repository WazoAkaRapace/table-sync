#!/usr/bin/env python3
"""Génère packages/shared/src/classFeatures.en.ts depuis le miroir 2014.5e.tools.

Décision actée : le texte EN est COPIÉ DIRECTEMENT de 5e.tools (classFeature /
subclassFeature.entries aplaties), pas traduit. La correspondance passe par un
dictionnaire de noms FR→EN vérifié : chaque entrée doit exister sur 5e.tools avec
la bonne classe (et sous-classe) au bon niveau, sinon le script échoue.
"""
import glob
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, 'scripts/i18n')
from flatten5e import flatten

ET = '/tmp/5etools'
OUT = 'packages/shared/src/classFeatures.en.ts'

CLASS_NAMES_EN = {
  'Artificier': 'Artificer', 'Barbare': 'Barbarian', 'Barde': 'Bard', 'Clerc': 'Cleric',
  'Druide': 'Druid', 'Ensorceleur': 'Sorcerer', 'Guerrier': 'Fighter', 'Magicien': 'Wizard',
  'Moine': 'Monk', 'Occultiste': 'Warlock', 'Paladin': 'Paladin', 'Rôdeur': 'Ranger',
  'Roublard': 'Rogue',
}

SUBCLASS_SHORTNAME = {
  ('Artificier', 'alchimiste'): 'Alchemist', ('Artificier', 'artilleur'): 'Artillerist',
  ('Artificier', 'forgeron-de-guerre'): 'Battle Smith',
  ('Barbare', 'berserker'): 'Berserker', ('Barbare', 'totem'): 'Totem Warrior',
  ('Barde', 'savoir'): 'Lore',
  ('Clerc', 'vie'): 'Life', ('Clerc', 'lumiere'): 'Light', ('Clerc', 'nature'): 'Nature',
  ('Clerc', 'tempete'): 'Tempest', ('Clerc', 'tromperie'): 'Trickery',
  ('Clerc', 'guerre'): 'War', ('Clerc', 'savoir'): 'Knowledge',
  ('Druide', 'terre'): 'Land', ('Druide', 'lune'): 'Moon',
  ('Ensorceleur', 'draconique'): 'Draconic', ('Ensorceleur', 'sauvage'): 'Wild',
  ('Guerrier', 'champion'): 'Champion', ('Guerrier', 'maitre-de-guerre'): 'Battle Master',
  ('Guerrier', 'chevalier-occulte'): 'Eldritch Knight',
  ('Magicien', 'abjuration'): 'Abjuration', ('Magicien', 'evocation'): 'Evocation',
  ('Magicien', 'divination'): 'Divination', ('Magicien', 'enchantement'): 'Enchantment',
  ('Magicien', 'illusion'): 'Illusion', ('Magicien', 'invocation'): 'Conjuration',
  ('Magicien', 'necromancie'): 'Necromancy', ('Magicien', 'transmutation'): 'Transmutation',
  ('Moine', 'main-ouverte'): 'Open Hand',
  ('Occultiste', 'archfee'): 'Archfey', ('Occultiste', 'fielon'): 'Fiend',
  ('Occultiste', 'grand-ancien'): 'Great Old One',
  ('Paladin', 'devotion'): 'Devotion', ('Paladin', 'anciennes'): 'Ancients',
  ('Paladin', 'vengeance'): 'Vengeance',
  ('Rôdeur', 'chasseur'): 'Hunter',
  ('Roublard', 'voleur'): 'Thief', ('Roublard', 'assassin'): 'Assassin',
  ('Roublard', 'escroc-arcanique'): 'Arcane Trickster',
}

# FR (clé « Classe|Nom » ou « Classe|sousclé|Nom ») → nom EN 5e.tools.
# Les listes concatènent plusieurs features 5e.tools (entrées combinées côté FR).
F = {
 # --- Artificier
 'Artificier|Bricolage magique': 'Magical Tinkering',
 'Artificier|Imprégnation d’objet': 'Infuse Item',
 'Artificier|Outil de circonstance': 'The Right Tool for the Job',
 'Artificier|Expertise de l’outillage': 'Tool Expertise',
 'Artificier|Trait de génie': 'Flash of Genius',
 'Artificier|Adepte des objets magiques': 'Magic Item Adept',
 'Artificier|Objet de stockage de sort': 'Spell-Storing Item',
 'Artificier|Érudit des objets magiques': 'Magic Item Savant',
 'Artificier|Maître des objets magiques': 'Magic Item Master',
 'Artificier|Âme de l’artifice': 'Soul of Artifice',
 # --- Barbare
 'Barbare|Rage': 'Rage', 'Barbare|Défense sans armure': 'Unarmored Defense',
 'Barbare|Attaque téméraire': 'Reckless Attack', 'Barbare|Sens du danger': 'Danger Sense',
 'Barbare|Attaque supplémentaire': 'Extra Attack', 'Barbare|Déplacement rapide': 'Fast Movement',
 'Barbare|Instinct sauvage': 'Feral Instinct', 'Barbare|Critique brutal': 'Brutal Critical (1 die)',
 'Barbare|Rage implacable': 'Relentless Rage', 'Barbare|Rage persistante': 'Persistent Rage',
 'Barbare|Puissance indomptable': 'Indomitable Might', 'Barbare|Champion primitif': 'Primal Champion',
 # --- Barde
 'Barde|Inspiration bardique': 'Bardic Inspiration', 'Barde|Touche-à-tout': 'Jack of All Trades',
 'Barde|Chant reposant': 'Song of Rest (d6)', 'Barde|Expertise': 'Expertise',
 'Barde|Source d’inspiration': 'Font of Inspiration', 'Barde|Contre-charme': 'Countercharm',
 'Barde|Secrets magiques': 'Magical Secrets', 'Barde|Inspiration supérieure': 'Superior Inspiration',
 # --- Clerc
 'Clerc|Conduit divin': 'Channel Divinity',
 'Clerc|Renvoi des morts-vivants': 'Channel Divinity: Turn Undead',
 'Clerc|Destruction des morts-vivants': 'Destroy Undead (CR 1/2)',
 'Clerc|Intervention divine': 'Divine Intervention',
 'Clerc|Intervention divine supérieure': 'Divine Intervention Improvement',
 # --- Druide
 'Druide|Druidique': 'Druidic', 'Druide|Forme sauvage': 'Wild Shape',
 'Druide|Forme sauvage améliorée (nage)': 'Wild Shape Improvement',
 'Druide|Forme sauvage améliorée (vol)': 'Wild Shape Improvement',
 'Druide|Jeunesse éternelle': 'Timeless Body', 'Druide|Incantation animale': 'Beast Spells',
 'Druide|Archidruide': 'Archdruid',
 # --- Ensorceleur
 'Ensorceleur|Source de magie': 'Font of Magic', 'Ensorceleur|Métamagie': 'Metamagic',
 'Ensorceleur|Restauration ensorcelée': 'Sorcerous Restoration',
 # --- Guerrier
 'Guerrier|Style de combat': 'Fighting Style', 'Guerrier|Second souffle': 'Second Wind',
 'Guerrier|Fougue': 'Action Surge', 'Guerrier|Archétype martial': 'Martial Archetype',
 'Guerrier|Attaque supplémentaire': 'Extra Attack', 'Guerrier|Inflexible': 'Indomitable',
 # --- Magicien
 'Magicien|Restauration arcanique': 'Arcane Recovery',
 'Magicien|Tradition arcanique': 'Arcane Tradition',
 'Magicien|Maîtrise des sorts': 'Spell Mastery',
 'Magicien|Sorts de prédilection': 'Signature Spells',
 # --- Moine
 'Moine|Arts martiaux': 'Martial Arts', 'Moine|Défense sans armure': 'Unarmored Defense',
 'Moine|Ki': 'Ki', 'Moine|Déplacement sans armure': 'Unarmored Movement',
 'Moine|Parade de projectiles': 'Deflect Missiles', 'Moine|Chute ralentie': 'Slow Fall',
 'Moine|Attaque supplémentaire': 'Extra Attack', 'Moine|Frappe étourdissante': 'Stunning Strike',
 'Moine|Frappes de ki': 'Ki-Empowered Strikes', 'Moine|Esquive totale': 'Evasion',
 'Moine|Sérénité': 'Stillness of Mind',
 'Moine|Déplacement sans armure amélioré': 'Unarmored Movement improvement',
 'Moine|Pureté physique': 'Purity of Body', 'Moine|Langue du soleil et de la lune': 'Tongue of the Sun and Moon',
 'Moine|Âme de diamant': 'Diamond Soul', 'Moine|Jeunesse éternelle': 'Timeless Body',
 'Moine|Désertion de l’âme': 'Empty Body', 'Moine|Perfection de l’être': 'Perfect Self',
 # --- Occultiste
 'Occultiste|Manifestations occultes': 'Eldritch Invocations',
 'Occultiste|Faveur de pacte': 'Pact Boon',
 'Occultiste|Arcanum mystique (niveau 6)': 'Mystic Arcanum (6th level)',
 'Occultiste|Arcanum mystique (niveau 7)': 'Mystic Arcanum (7th level)',
 'Occultiste|Arcanum mystique (niveau 8)': 'Mystic Arcanum (8th level)',
 'Occultiste|Arcanum mystique (niveau 9)': 'Mystic Arcanum (9th level)',
 'Occultiste|Maître de l’occulte': 'Eldritch Master',
 # --- Paladin
 'Paladin|Sens divin': 'Divine Sense', 'Paladin|Imposition des mains': 'Lay on Hands',
 'Paladin|Châtiment divin': 'Divine Smite', 'Paladin|Conduit divin': 'Channel Divinity',
 'Paladin|Santé divine': 'Divine Health', 'Paladin|Attaque supplémentaire': 'Extra Attack',
 'Paladin|Aura de protection': 'Aura of Protection', 'Paladin|Aura de courage': 'Aura of Courage',
 'Paladin|Châtiment divin amélioré': 'Improved Divine Smite',
 'Paladin|Contact purifiant': 'Cleansing Touch', 'Paladin|Amélioration d’auras': 'Aura improvements',
 # --- Rôdeur
 'Rôdeur|Ennemi juré': 'Favored Enemy', 'Rôdeur|Explorateur-né': 'Natural Explorer',
 'Rôdeur|Vigilance primitive': 'Primeval Awareness', 'Rôdeur|Attaque supplémentaire': 'Extra Attack',
 'Rôdeur|Foulée tellurique': 'Land\'s Stride', 'Rôdeur|Camouflage naturel': 'Hide in Plain Sight',
 'Rôdeur|Disparition': 'Vanish', 'Rôdeur|Sens sauvages': 'Feral Senses',
 'Rôdeur|Tueur implacable': 'Foe Slayer',
 # --- Roublard
 'Roublard|Expertise': 'Expertise', 'Roublard|Attaque sournoise': 'Sneak Attack',
 'Roublard|Jargon des voleurs': 'Thieves\' Cant', 'Roublard|Ruse': 'Cunning Action',
 'Roublard|Archétype de roublard': 'Roguish Archetype',
 'Roublard|Esquive instinctive': 'Uncanny Dodge', 'Roublard|Esquive totale': 'Evasion',
 'Roublard|Savoir-faire': 'Reliable Talent', 'Roublard|Perception aveugle': 'Blindsense',
 'Roublard|Esprit fuyant': 'Slippery Mind', 'Roublard|Insaisissable': 'Elusive',
 'Roublard|Coup de chance': 'Stroke of Luck',
 # --- Sous-classes Artificier
 'Artificier|alchimiste|Maîtrise des outils': 'Tool Proficiency',
 'Artificier|alchimiste|Sorts d’alchimiste': 'Alchemist Spells',
 'Artificier|alchimiste|Élixir expérimental': 'Experimental Elixir',
 'Artificier|alchimiste|Érudit alchimique': 'Alchemical Savant',
 'Artificier|alchimiste|Ingrédients revigorants': 'Restorative Reagents',
 'Artificier|alchimiste|Maîtrise chimique': 'Chemical Mastery',
 'Artificier|artilleur|Maîtrise des outils': 'Tool Proficiency',
 'Artificier|artilleur|Sorts d’artilleur': 'Artillerist Spells',
 'Artificier|artilleur|Canon occulte': 'Eldritch Cannon',
 'Artificier|artilleur|Arme à feu arcanique': 'Arcane Firearm',
 'Artificier|artilleur|Canon explosif': 'Explosive Cannon',
 'Artificier|artilleur|Position fortifiée': 'Fortified Position',
 'Artificier|forgeron-de-guerre|Maîtrise des outils': 'Tool Proficiency',
 'Artificier|forgeron-de-guerre|Sorts de forgeron de guerre': 'Battle Smith Spells',
 'Artificier|forgeron-de-guerre|Apte au combat': 'Battle Ready',
 'Artificier|forgeron-de-guerre|Défenseur d’acier': 'Steel Defender',
 'Artificier|forgeron-de-guerre|Attaque supplémentaire': 'Extra Attack',
 'Artificier|forgeron-de-guerre|Décharge arcanique': 'Arcane Jolt',
 'Artificier|forgeron-de-guerre|Défenseur amélioré': 'Improved Defender',
 # --- Barbare
 'Barbare|berserker|Frénésie': 'Frenzy', 'Barbare|berserker|Rage aveugle': 'Mindless Rage',
 'Barbare|berserker|Présence intimidante': 'Intimidating Presence',
 'Barbare|berserker|Représailles': 'Retaliation',
 'Barbare|totem|Quêteur spirituel': 'Spirit Seeker',
 'Barbare|totem|Esprit totem': 'Totem Spirit',
 'Barbare|totem|Aspect de la bête': 'Aspect of the Beast',
 'Barbare|totem|Marcheur spirituel': 'Spirit Walker',
 'Barbare|totem|Lien totémique': 'Totemic Attunement',
 # --- Barde
 'Barde|savoir|Maîtrises supplémentaires': 'Bonus Proficiencies',
 'Barde|savoir|Mots cinglants': 'Cutting Words',
 'Barde|savoir|Secrets magiques supplémentaires': 'Additional Magical Secrets',
 'Barde|savoir|Compétence hors-pair': 'Peerless Skill',
 # --- Clerc (domaines)
 'Clerc|vie|Maîtrise supplémentaire (Vie)': 'Bonus Proficiency',
 'Clerc|vie|Disciple de la vie': 'Disciple of Life',
 'Clerc|vie|Conduit divin : préservation de la vie': 'Channel Divinity: Preserve Life',
 'Clerc|vie|Guérisseur béni': 'Blessed Healer',
 'Clerc|vie|Frappe divine (Vie)': 'Divine Strike',
 'Clerc|vie|Guérison suprême': 'Supreme Healing',
 'Clerc|lumiere|Sort mineur supplémentaire (Lumière)': 'Bonus Cantrip',
 'Clerc|lumiere|Illumination protectrice': 'Warding Flare',
 'Clerc|lumiere|Conduit divin : radiance de l’aube': 'Channel Divinity: Radiance of the Dawn',
 'Clerc|lumiere|Illumination améliorée': 'Improved Flare',
 'Clerc|lumiere|Incantation puissante (Lumière)': 'Potent Spellcasting',
 'Clerc|lumiere|Halo de lumière': 'Corona of Light',
 'Clerc|nature|Acolyte de la nature': 'Acolyte of Nature',
 'Clerc|nature|Maîtrise supplémentaire (Nature)': 'Bonus Proficiency',
 'Clerc|nature|Conduit divin : charme des animaux et des plantes': 'Channel Divinity: Charm Animals and Plants',
 'Clerc|nature|Atténuation des éléments': 'Dampen Elements',
 'Clerc|nature|Frappe divine (Nature)': 'Divine Strike',
 'Clerc|nature|Maître de la nature': 'Master of Nature',
 'Clerc|tempete|Maîtrises supplémentaires (Tempête)': 'Bonus Proficiencies',
 'Clerc|tempete|Fureur de l’ouragan': 'Wrath of the Storm',
 'Clerc|tempete|Conduit divin : fureur destructrice': 'Channel Divinity: Destructive Wrath',
 'Clerc|tempete|Frappe de l’éclair': 'Thunderbolt Strike',
 'Clerc|tempete|Frappe divine (Tempête)': 'Divine Strike',
 'Clerc|tempete|Enfant de la tempête': 'Stormborn',
 'Clerc|tromperie|Bénédiction de l’escroc': 'Blessing of the Trickster',
 'Clerc|tromperie|Conduit divin : invocation de réplique': 'Channel Divinity: Invoke Duplicity',
 'Clerc|tromperie|Conduit divin : linceul d’ombre': 'Channel Divinity: Cloak of Shadows',
 'Clerc|tromperie|Frappe divine (Duperie)': 'Divine Strike',
 'Clerc|tromperie|Réplique améliorée': 'Improved Duplicity',
 'Clerc|guerre|Maîtrises supplémentaires (Guerre)': 'Bonus Proficiencies',
 'Clerc|guerre|Prêtre de guerre': 'War Priest',
 'Clerc|guerre|Conduit divin : frappe guidée': 'Channel Divinity: Guided Strike',
 'Clerc|guerre|Conduit divin : bénédiction du dieu de guerre': 'Channel Divinity: War God\'s Blessing',
 'Clerc|guerre|Frappe divine (Guerre)': 'Divine Strike',
 'Clerc|guerre|Avatar de bataille': 'Avatar of Battle',
 'Clerc|savoir|Bénédictions du savoir': 'Blessings of Knowledge',
 'Clerc|savoir|Conduit divin : savoir ancestral': 'Channel Divinity: Knowledge of the Ages',
 'Clerc|savoir|Conduit divin : lecture des pensées': 'Channel Divinity: Read Thoughts',
 'Clerc|savoir|Incantation puissante (Savoir)': 'Potent Spellcasting',
 'Clerc|savoir|Visions du passé': 'Visions of the Past',
 # --- Druide
 'Druide|terre|Sort mineur supplémentaire': 'Bonus Cantrip',
 'Druide|terre|Récupération naturelle': 'Natural Recovery',
 'Druide|terre|Foulée tellurique': 'Land\'s Stride',
 'Druide|terre|Protégé de dame Nature': 'Nature\'s Ward',
 'Druide|terre|Sanctuaire de dame Nature': 'Nature\'s Sanctuary',
 'Druide|lune|Forme sauvage de combat': 'Combat Wild Shape',
 'Druide|lune|Formes du cercle': 'Circle Forms',
 'Druide|lune|Frappe primitive': 'Primal Strike',
 'Druide|lune|Forme sauvage élémentaire': 'Elemental Wild Shape',
 'Druide|lune|Mille formes': 'Thousand Forms',
 # --- Ensorceleur
 'Ensorceleur|draconique|Ancêtre draconique': 'Dragon Ancestor',
 'Ensorceleur|draconique|Résistance draconique': 'Draconic Resilience',
 'Ensorceleur|draconique|Affinité élémentaire': 'Elemental Affinity',
 'Ensorceleur|draconique|Ailes draconiques': 'Dragon Wings',
 'Ensorceleur|draconique|Présence draconique': 'Draconic Presence',
 'Ensorceleur|sauvage|Pic de magie sauvage': 'Wild Magic Surge',
 'Ensorceleur|sauvage|Marée du chaos': 'Tides of Chaos',
 'Ensorceleur|sauvage|Chance forcée': 'Bend Luck',
 'Ensorceleur|sauvage|Chaos contrôlé': 'Controlled Chaos',
 'Ensorceleur|sauvage|Bombardement de sort': 'Spell Bombardment',
 # --- Guerrier
 'Guerrier|champion|Critique amélioré': 'Improved Critical',
 'Guerrier|champion|Athlète accompli': 'Remarkable Athlete',
 'Guerrier|champion|Style de combat supplémentaire': 'Additional Fighting Style',
 'Guerrier|champion|Critique supérieur': 'Superior Critical',
 'Guerrier|champion|Survivant': 'Survivor',
 'Guerrier|maitre-de-guerre|Disciple martial': 'Student of War',
 'Guerrier|maitre-de-guerre|Supériorité martiale': 'Combat Superiority',
 'Guerrier|maitre-de-guerre|Observation de l’ennemi': 'Know Your Enemy',
 'Guerrier|maitre-de-guerre|Supériorité martiale améliorée': 'Improved Combat Superiority (d10)',
 'Guerrier|maitre-de-guerre|Implacable': 'Relentless',
 'Guerrier|chevalier-occulte|Incantation': 'Spellcasting',
 'Guerrier|chevalier-occulte|Lien avec une arme': 'Weapon Bond',
 'Guerrier|chevalier-occulte|Magie de guerre': 'War Magic',
 'Guerrier|chevalier-occulte|Frappe occulte': 'Eldritch Strike',
 'Guerrier|chevalier-occulte|Charge arcanique': 'Arcane Charge',
 'Guerrier|chevalier-occulte|Magie de guerre améliorée': 'Improved War Magic',
 # --- Magicien
 'Magicien|abjuration|Abjurateur érudit': 'Abjuration Savant',
 'Magicien|abjuration|Protection arcanique': 'Arcane Ward',
 'Magicien|abjuration|Protection projetée': 'Projected Ward',
 'Magicien|abjuration|Abjuration améliorée': 'Improved Abjuration',
 'Magicien|abjuration|Résistance aux sorts': 'Spell Resistance',
 'Magicien|evocation|Évocateur érudit': 'Evocation Savant',
 'Magicien|evocation|Façonneur de sorts': 'Sculpt Spells',
 'Magicien|evocation|Sort mineur puissant': 'Potent Cantrip',
 'Magicien|evocation|Évocation améliorée': 'Empowered Evocation',
 'Magicien|evocation|Surcharge magique': 'Overchannel',
 'Magicien|divination|Devin érudit': 'Divination Savant',
 'Magicien|divination|Présage': 'Portent',
 'Magicien|divination|Divination experte': 'Expert Divination',
 'Magicien|divination|Troisième œil': 'The Third Eye',
 'Magicien|divination|Présage supérieur': 'Greater Portent',
 'Magicien|enchantement|Enchanteur érudit': 'Enchantment Savant',
 'Magicien|enchantement|Regard hypnotique': 'Hypnotic Gaze',
 'Magicien|enchantement|Charme instinctif': 'Instinctive Charm',
 'Magicien|enchantement|Partage d’enchantement': 'Split Enchantment',
 'Magicien|enchantement|Altération mémorielle': 'Alter Memories',
 'Magicien|illusion|Illusionniste érudit': 'Illusion Savant',
 'Magicien|illusion|Illusion mineure améliorée': 'Improved Minor Illusion',
 'Magicien|illusion|Illusions malléables': 'Malleable Illusions',
 'Magicien|illusion|Double illusoire': 'Illusory Self',
 'Magicien|illusion|Réalité illusoire': 'Illusory Reality',
 'Magicien|invocation|Invocateur érudit': 'Conjuration Savant',
 'Magicien|invocation|Invocation mineure': 'Minor Conjuration',
 'Magicien|invocation|Permutation': 'Benign Transposition',
 'Magicien|invocation|Invocation consciencieuse': 'Focused Conjuration',
 'Magicien|invocation|Convocations coriaces': 'Durable Summons',
 'Magicien|necromancie|Nécromancien érudit': 'Necromancy Savant',
 'Magicien|necromancie|Sinistre moisson': 'Grim Harvest',
 'Magicien|necromancie|Serviteurs morts-vivants': 'Undead Thralls',
 'Magicien|necromancie|Insensibilité à la non-vie': 'Inured to Undeath',
 'Magicien|necromancie|Contrôle des morts-vivants': 'Command Undead',
 'Magicien|transmutation|Transmutateur érudit': 'Transmutation Savant',
 'Magicien|transmutation|Alchimie mineure': 'Minor Alchemy',
 'Magicien|transmutation|Pierre du transmutateur': 'Transmuter\'s Stone',
 'Magicien|transmutation|Métamorphe': 'Shapechanger',
 'Magicien|transmutation|Maître transmutateur': 'Master Transmuter',
 # --- Moine
 'Moine|main-ouverte|Technique de la paume': 'Open Hand Technique',
 'Moine|main-ouverte|Plénitude physique': 'Wholeness of Body',
 'Moine|main-ouverte|Tranquillité': 'Tranquility',
 'Moine|main-ouverte|Paume frémissante': 'Quivering Palm',
 # --- Occultiste
 'Occultiste|archfee|Présence féerique': 'Fey Presence',
 'Occultiste|archfee|Échappatoire brumeuse': 'Misty Escape',
 'Occultiste|archfee|Défenses captivantes': 'Beguiling Defenses',
 'Occultiste|archfee|Sombre délire': 'Dark Delirium',
 'Occultiste|fielon|Bénédiction du ténébreux': 'Dark One\'s Blessing',
 'Occultiste|fielon|Chance du ténébreux': 'Dark One\'s Own Luck',
 'Occultiste|fielon|Résistance fiélonne': 'Fiendish Resilience',
 'Occultiste|fielon|Traversée des enfers': 'Hurl Through Hell',
 'Occultiste|grand-ancien|Esprit éveillé': 'Awakened Mind',
 'Occultiste|grand-ancien|Protection entropique': 'Entropic Ward',
 'Occultiste|grand-ancien|Bouclier mental': 'Thought Shield',
 'Occultiste|grand-ancien|Asservissement': 'Create Thrall',
 # --- Paladin (les Conduits divins combinés → concaténation des deux features)
 'Paladin|devotion|Conduit divin : Arme sacrée / Renvoi des impies':
   ['Sacred Weapon', 'Turn the Unholy'],
 'Paladin|devotion|Aura de dévotion': 'Aura of Devotion',
 'Paladin|devotion|Pureté de l’esprit': 'Purity of Spirit',
 'Paladin|devotion|Nimbe sacré': 'Holy Nimbus',
 'Paladin|anciennes|Conduit divin : Courroux de la nature / Renvoi des infidèles':
   ['Nature\'s Wrath', 'Turn the Faithless'],
 'Paladin|anciennes|Aura de garde': 'Aura of Warding',
 'Paladin|anciennes|Sentinelle immortelle': 'Undying Sentinel',
 'Paladin|anciennes|Champion antique': 'Elder Champion',
 'Paladin|vengeance|Conduit divin : Conspuer l’ennemi / Vœu d’hostilité':
   ['Abjure Enemy', 'Vow of Enmity'],
 'Paladin|vengeance|Vengeur implacable': 'Relentless Avenger',
 'Paladin|vengeance|Âme vengeresse': 'Soul of Vengeance',
 'Paladin|vengeance|Ange de la vengeance': 'Avenging Angel',
 # --- Rôdeur
 'Rôdeur|chasseur|Proie du chasseur': 'Hunter\'s Prey',
 'Rôdeur|chasseur|Tactiques défensives': 'Defensive Tactics',
 'Rôdeur|chasseur|Attaques multiples': 'Multiattack',
 'Rôdeur|chasseur|Défense du chasseur supérieure': 'Superior Hunter\'s Defense',
 # --- Roublard
 'Roublard|voleur|Mains lestes': 'Fast Hands',
 'Roublard|voleur|Monte-en-l’air': 'Second-Story Work',
 'Roublard|voleur|Discrétion suprême': 'Supreme Sneak',
 'Roublard|voleur|Utilisation d’objets magiques': 'Use Magic Device',
 'Roublard|voleur|Réflexes de voleur': 'Thief\'s Reflexes',
 'Roublard|assassin|Maîtrises supplémentaires': 'Bonus Proficiencies',
 'Roublard|assassin|Assassinat': 'Assassinate',
 'Roublard|assassin|Expert en infiltration': 'Infiltration Expertise',
 'Roublard|assassin|Imposteur': 'Impostor',
 'Roublard|assassin|Frappe meurtrière': 'Death Strike',
 'Roublard|escroc-arcanique|Incantation': 'Spellcasting',
 'Roublard|escroc-arcanique|Escamotage et main de mage': 'Mage Hand Legerdemain',
 'Roublard|escroc-arcanique|Embuscade magique': 'Magical Ambush',
 'Roublard|escroc-arcanique|Escroc polyvalent': 'Versatile Trickster',
 'Roublard|escroc-arcanique|Voleur de sort': 'Spell Thief',
}


def parse_catalog():
  """Extrait (classe → [(id, niveau, nom)]) et (classe → [(sousclé, label, [(id, niveau, nom)])])."""
  src = open('packages/shared/src/classFeatures.ts').read()
  cat, subs = {}, {}
  cf = re.search(r'export const CLASS_FEATURES[^=]*=\s*\{(.*?)\n\};', src, re.S).group(1)
  for m in re.finditer(r"\n  ('?)(\w[^:]*?)\1: \[(.*?)\n  \]", cf, re.S):
    _, cls, block = m.groups()
    cat[cls] = re.findall(r"id: '([^']+)',\s*\n\s*level: (\d+),\s*\n\s*name: '([^']+)'", block)
  sc = re.search(r'export const CLASS_SUBCLASSES[^=]*=\s*\{(.*?)\n\};', src, re.S).group(1)
  for chunk in re.split(r"\n  (?='?[A-Z])", sc):
    km = re.match(r"('?)([A-Za-zÀ-ÿ ]+)\1: \[", chunk)
    if not km:
      continue
    cls = km.group(2)
    for sm in re.finditer(r"key: '([^']+)',\s*\n\s*label: '([^']+)',\s*\n\s*level: (\d+),\s*\n\s*features: \[", chunk):
      key, label, _ = sm.groups()
      i, depth = sm.end(), 1
      while depth > 0:
        if chunk[i] == '[':
          depth += 1
        elif chunk[i] == ']':
          depth -= 1
        i += 1
      feats = re.findall(r"id: '([^']+)',\s*\n\s*level: (\d+),\s*\n\s*name: '([^']+)'", chunk[sm.end():i])
      subs.setdefault(cls, []).append((key, label, feats))
  return cat, subs


def load_5etools():
  cf, scf = defaultdict(list), defaultdict(list)
  for f in glob.glob(f'{ET}/data/class/class-*.json'):
    d = json.load(open(f))
    for e in d.get('classFeature', []):
      cf[(e['className'], e['name'], e['level'])].append(e)
    for e in d.get('subclassFeature', []):
      scf[(e['className'], e.get('subclassShortName'), e['name'], e['level'])].append(e)
  return cf, scf


def pick(bucket):
  if not bucket:
    return None
  for cand in bucket:
    if cand.get('source') == 'PHB':
      return cand
  return bucket[0]


def main():
  cat, subs = parse_catalog()
  et_cf, et_scf = load_5etools()
  out = {}
  errors = []

  def resolve(kind, key, en_names, level, fid):
    texts, final_name = [], None
    for en in ([en_names] if isinstance(en_names, str) else en_names):
      bucket = (et_cf if kind == 'class' else et_scf).get(key + ((en, level) if kind == 'class' else (en, level)))
      e = pick(bucket)
      if e is None:
        errors.append(f'{kind}: {key} L{level} « {en} » introuvable (feature {fid})')
        continue
      texts.append(flatten(e.get('entries', [])).strip())
      final_name = en if final_name is None else f'{final_name} / {en}'
    if not texts:
      return
    out[fid] = {'name': final_name, 'description': '\n\n'.join(texts)}

  for cls, feats in cat.items():
    for fid, level, name in feats:
      en = F.get(f'{cls}|{name}')
      if en is None:
        errors.append(f'classe {cls}: pas de traduction pour « {name} » ({fid})')
        continue
      resolve('class', (CLASS_NAMES_EN[cls],), en, int(level), fid)

  subclass_labels = {}
  for cls, sub_list in subs.items():
    for key, label, feats in sub_list:
      short = SUBCLASS_SHORTNAME[(cls, key)]
      subclass_labels[f'{cls}/{key}'] = short
      for fid, level, name in feats:
        en = F.get(f'{cls}|{key}|{name}')
        if en is None:
          errors.append(f'sous-classe {cls}/{key}: pas de traduction pour « {name} » ({fid})')
          continue
        resolve('sub', (CLASS_NAMES_EN[cls], short), en, int(level), fid)

  if errors:
    print(f'{len(errors)} erreurs :')
    for e in errors:
      print(' ', e)
    return 1

  with open(OUT, 'w') as f:
    f.write('// GÉNÉRÉ par scripts/i18n/build-class-features-en.py — ne pas éditer à la main.\n')
    f.write('// Source : miroir GitHub de 2014.5e.tools (voir docs/i18n-english-plan.md).\n\n')
    f.write('export const CLASS_NAMES_EN: Record<string, string> = ')
    f.write(json.dumps(CLASS_NAMES_EN, ensure_ascii=False, indent=2).replace("'", "'"))
    f.write(';\n\n')
    f.write('export const SUBCLASS_SHORTNAMES_EN: Record<string, string> = ')
    f.write(json.dumps(subclass_labels, ensure_ascii=False, indent=2))
    f.write(';\n\n')
    f.write('export const CLASS_FEATURES_EN: Record<string, { name: string; description: string }> = ')
    f.write(json.dumps(out, ensure_ascii=False, indent=2))
    f.write(';\n')

  n_class = sum(len(v) for v in cat.values())
  n_sub = sum(len(feats) for _, _, feats in (s for v in subs.values() for s in v))
  print(f'OK : {len(out)}/{n_class + n_sub} features EN écrites dans {OUT}')
  return 0


if __name__ == '__main__':
  sys.exit(main())
