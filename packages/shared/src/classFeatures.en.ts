// GÉNÉRÉ par scripts/i18n/build-class-features-en.py — ne pas éditer à la main.
// Source : miroir GitHub de 2014.5e.tools (voir docs/i18n-english-plan.md).

export const CLASS_NAMES_EN: Record<string, string> = {
  Artificier: 'Artificer',
  Barbare: 'Barbarian',
  Barde: 'Bard',
  Clerc: 'Cleric',
  Druide: 'Druid',
  Ensorceleur: 'Sorcerer',
  Guerrier: 'Fighter',
  Magicien: 'Wizard',
  Moine: 'Monk',
  Occultiste: 'Warlock',
  Paladin: 'Paladin',
  Rôdeur: 'Ranger',
  Roublard: 'Rogue',
};

export const SUBCLASS_SHORTNAMES_EN: Record<string, string> = {
  'Artificier/alchimiste': 'Alchemist',
  'Artificier/artilleur': 'Artillerist',
  'Artificier/forgeron-de-guerre': 'Battle Smith',
  'Barbare/berserker': 'Berserker',
  'Barbare/totem': 'Totem Warrior',
  'Barde/savoir': 'Lore',
  'Clerc/vie': 'Life',
  'Clerc/lumiere': 'Light',
  'Clerc/nature': 'Nature',
  'Clerc/tempete': 'Tempest',
  'Clerc/tromperie': 'Trickery',
  'Clerc/guerre': 'War',
  'Clerc/savoir': 'Knowledge',
  'Druide/terre': 'Land',
  'Druide/lune': 'Moon',
  'Ensorceleur/draconique': 'Draconic',
  'Ensorceleur/sauvage': 'Wild',
  'Guerrier/champion': 'Champion',
  'Guerrier/maitre-de-guerre': 'Battle Master',
  'Guerrier/chevalier-occulte': 'Eldritch Knight',
  'Magicien/abjuration': 'Abjuration',
  'Magicien/evocation': 'Evocation',
  'Magicien/divination': 'Divination',
  'Magicien/enchantement': 'Enchantment',
  'Magicien/illusion': 'Illusion',
  'Magicien/invocation': 'Conjuration',
  'Magicien/necromancie': 'Necromancy',
  'Magicien/transmutation': 'Transmutation',
  'Moine/main-ouverte': 'Open Hand',
  'Occultiste/archfee': 'Archfey',
  'Occultiste/fielon': 'Fiend',
  'Occultiste/grand-ancien': 'Great Old One',
  'Paladin/devotion': 'Devotion',
  'Paladin/anciennes': 'Ancients',
  'Paladin/vengeance': 'Vengeance',
  'Rôdeur/chasseur': 'Hunter',
  'Roublard/voleur': 'Thief',
  'Roublard/assassin': 'Assassin',
  'Roublard/escroc-arcanique': 'Arcane Trickster',
};

export const CLASS_FEATURES_EN: Record<string, { name: string; description: string }> = {
  'artificier-bricolage-magique': {
    name: 'Magical Tinkering',
    description:
      "1st-level artificer feature\n\nYou've learned how to invest a spark of magic into mundane objects. To use this ability, you must have thieves' tools or artisan's tools in hand. You then touch a Tiny nonmagical object as an action and give it one of the following magical properties of your choice:\n\n- The object sheds bright light in a 5-foot radius and dim light for an additional 5 feet.\n- Whenever tapped by a creature, the object emits a recorded message that can be heard up to 10 feet away. You utter the message when you bestow this property on the object, and the recording can be no more than 6 seconds long.\n- The object continuously emits your choice of an odor or a nonverbal sound (wind, waves, chirping, or the like). The chosen phenomenon is perceivable up to 10 feet away.\n- A static visual effect appears on one of the object's surfaces. This effect can be a picture, up to 25 words of text, lines and shapes, or a mixture of these elements, as you like.\n\nThe chosen property lasts indefinitely. As an action, you can touch the object and end the property early.\n\nYou can bestow magic on multiple objects, touching one object each time you use this feature, though a single object can only bear one property at a time. The maximum number of objects you can affect with this feature at one time is equal to your Intelligence modifier (minimum of one object). If you try to exceed your maximum, the oldest property immediately ends, and then the new property applies.",
  },
  'artificier-objets-infuses': {
    name: 'Infuse Item',
    description:
      "2nd-level artificer feature\n\nYou've gained the ability to imbue mundane items with certain magical infusions, turning those objects into magic items.\n\nArtificers have invented numerous magical infusions, extraordinary processes that rapidly create magic items. To many, artificers seem like wonderworkers, accomplishing in hours what others need weeks to complete.\n\nThe description of each of the following infusions details the type of item that can receive it, along with whether the resulting magic item requires attunement.\n\nSome infusions specify a minimum artificer level. You can't learn such an infusion until you are at least that level.\n\nUnless an infusion's description says otherwise, you can't learn an infusion more than once.\n\nInfusing an Item.\nWhenever you finish a long rest, you can touch a nonmagical object and imbue it with one of your artificer infusions, turning it into a magic item. An infusion works on only certain kinds of objects, as specified in the infusion's description. If the item requires attunement, you can attune yourself to it the instant you infuse the item. If you decide to attune to the item later, you must do so using the normal process for attunement (see \"Attunement\" in chapter 7 of the Dungeon Master's Guide).\n\nYour infusion remains in an item indefinitely, but when you die, the infusion vanishes after a number of days have passed equal to your Intelligence modifier (minimum of 1 day). The infusion also vanishes if you give up your knowledge of the infusion for another one.\n\nYou can infuse more than one nonmagical object at the end of a long rest; the maximum number of objects appears in the Infused Items column of the Artificer table. You must touch each of the objects, and each of your infusions can be in only one object at a time. Moreover, no object can bear more than one of your infusions at a time. If you try to exceed your maximum number of infusions, the oldest infusion immediately ends, and then the new infusion applies.\n\nIf an infusion ends on an item that contains other things, like a bag of holding, its contents harmlessly appear in and around its space.",
  },
  'artificier-bon-outil': {
    name: 'The Right Tool for the Job',
    description:
      "3rd-level artificer feature\n\nYou've learned how to produce exactly the tool you need: with thieves' tools or artisan's tools in hand, you can magically create one set of artisan's tools in an unoccupied space within 5 feet of you. This creation requires 1 hour of uninterrupted work, which can coincide with a short or long rest. Though the product of magic, the tools are nonmagical, and they vanish when you use this feature again.",
  },
  'artificier-expertise-outillage': {
    name: 'Tool Expertise',
    description:
      '6th-level artificer feature\n\nYour proficiency bonus is now doubled for any ability check you make that uses your proficiency with a tool.',
  },
  'artificier-genie-eclair': {
    name: 'Flash of Genius',
    description:
      "7th-level artificer feature\n\nYou've gained the ability to come up with solutions under pressure. When you or another creature you can see within 30 feet of you makes an ability check or a saving throw, you can use your reaction to add your Intelligence modifier to the roll.\n\nYou can use this feature a number of times equal to your Intelligence modifier (minimum of once). You regain all expended uses when you finish a long rest.",
  },
  'artificier-adepte-objets-magiques': {
    name: 'Magic Item Adept',
    description:
      "10th-level artificer feature\n\nYou've achieved a profound understanding of how to use and make magic items:\n\n- You can attune to up to four magic items at once.\n- If you craft a magic item with a rarity of common or uncommon, it takes you a quarter of the normal time, and it costs you half as much of the usual gold.",
  },
  'artificier-objet-receptacle': {
    name: 'Spell-Storing Item',
    description:
      "11th-level artificer feature\n\nYou can now store a spell in an object. Whenever you finish a long rest, you can touch one simple or martial weapon or one item that you can use as a spellcasting focus, and you store a spell in it, choosing a 1st- or 2nd-level spell from the artificer spell list that requires 1 action to cast (you needn't have it prepared).\n\nWhile holding the object, a creature can take an action to produce the spell's effect from it, using your spellcasting ability modifier. If the spell requires concentration, the creature must concentrate. The spell stays in the object until it's been used a number of times equal to twice your Intelligence modifier (minimum of twice) or until you use this feature again to store a spell in an object.",
  },
  'artificier-erudit-objets-magiques': {
    name: 'Magic Item Savant',
    description:
      '14th-level artificer feature\n\nYour skill with magic items deepens:\n\n- You can attune to up to five magic items at once.\n- You ignore all class, race, spell, and level requirements on attuning to or using a magic item.',
  },
  'artificier-maitre-objets-magiques': {
    name: 'Magic Item Master',
    description:
      '18th-level artificer feature\n\nYou can now attune to up to six magic items at once.',
  },
  'artificier-ame-artifice': {
    name: 'Soul of Artifice',
    description:
      "20th-level artificer feature\n\nYou have developed a mystical connection to your magic items, which you can draw on for protection:\n\n- You gain a +1 bonus to all saving throws per magic item you are currently attuned to.\n- If you're reduced to 0 hit points but not killed outright, you can use your reaction to end one of your artificer infusions, causing you to drop to 1 hit point instead of 0.",
  },
  'barbare-rage': {
    name: 'Rage',
    description:
      "In battle, you fight with primal ferocity. On your turn, you can enter a rage as a bonus action.\n\nWhile raging, you gain the following benefits if you aren't wearing heavy armor:\n\n- You have advantage on Strength checks and Strength saving throws.\n- When you make a melee weapon attack using Strength, you gain a +2 bonus to the damage roll. This bonus increases as you level.\n- You have resistance to bludgeoning, piercing, and slashing damage.\n\nIf you are able to cast spells, you can't cast them or concentrate on them while raging.\n\nYour rage lasts for 1 minute. It ends early if you are knocked unconscious or if your turn ends and you haven't attacked a hostile creature since your last turn or taken damage since then. You can also end your rage on your turn as a bonus action.\n\nOnce you have raged the maximum number of times for your barbarian level, you must finish a long rest before you can rage again. You may rage 2 times at 1st level, 3 at 3rd, 4 at 6th, 5 at 12th, and 6 at 17th.",
  },
  'barbare-defense-sans-armure': {
    name: 'Unarmored Defense',
    description:
      'While you are not wearing any armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a shield and still gain this benefit.',
  },
  'barbare-attaque-imprudente': {
    name: 'Reckless Attack',
    description:
      'Starting at 2nd level, you can throw aside all concern for defense to attack with fierce desperation. When you make your first attack on your turn, you can decide to attack recklessly. Doing so gives you advantage on melee weapon attack rolls using Strength during this turn, but attack rolls against you have advantage until your next turn.',
  },
  'barbare-sens-du-danger': {
    name: 'Danger Sense',
    description:
      "At 2nd level, you gain an uncanny sense of when things nearby aren't as they should be, giving you an edge when you dodge away from danger. You have advantage on Dexterity saving throws against effects that you can see, such as traps and spells. To gain this benefit, you can't be blinded, deafened, or incapacitated.",
  },
  'barbare-attaque-supplementaire': {
    name: 'Extra Attack',
    description:
      'Beginning at 5th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.',
  },
  'barbare-deplacement-rapide': {
    name: 'Fast Movement',
    description:
      "Starting at 5th level, your speed increases by 10 feet while you aren't wearing heavy armor.",
  },
  'barbare-instinct-feroce': {
    name: 'Feral Instinct',
    description:
      "By 7th level, your instincts are so honed that you have advantage on initiative rolls.\n\nAdditionally, if you are surprised at the beginning of combat and aren't incapacitated, you can act normally on your first turn, but only if you enter your rage before doing anything else on that turn.",
  },
  'barbare-critical-brutal': {
    name: 'Brutal Critical (1 die)',
    description:
      'Beginning at 9th level, you can roll one additional weapon damage die when determining the extra damage for a critical hit with a melee attack.\n\nThis increases to two additional dice at 13th level and three additional dice at 17th level.',
  },
  'barbare-rage-implacable': {
    name: 'Relentless Rage',
    description:
      "Starting at 11th level, your rage can keep you fighting despite grievous wounds. If you drop to 0 hit points while you're raging and don't die outright, you can make a DC 10 Constitution saving throw. If you succeed, you drop to 1 hit point instead.\n\nEach time you use this feature after the first, the DC increases by 5. When you finish a short or long rest, the DC resets to 10.",
  },
  'barbare-persistance-rage': {
    name: 'Persistent Rage',
    description:
      'Beginning at 15th level, your rage is so fierce that it ends early only if you fall unconscious or if you choose to end it.',
  },
  'barbare-puissance-indomptable': {
    name: 'Indomitable Might',
    description:
      'Beginning at 18th level, if your total for a Strength check is less than your Strength score, you can use that score in place of the total.',
  },
  'barbare-champion-primordial': {
    name: 'Primal Champion',
    description:
      'At 20th level, you embody the power of the wilds. Your Strength and Constitution scores increase by 4. Your maximum for those scores is now 24.',
  },
  'barde-inspiration-bardique': {
    name: 'Bardic Inspiration',
    description:
      'You can inspire others through stirring words or music. To do so, you use a bonus action on your turn to choose one creature other than yourself within 60 feet of you who can hear you. That creature gains one Bardic Inspiration die, a d6.\n\nOnce within the next 10 minutes, the creature can roll the die and add the number rolled to one ability check, attack roll, or saving throw it makes. The creature can wait until after it rolls the d20 before deciding to use the Bardic Inspiration die, but must decide before the DM says whether the roll succeeds or fails. Once the Bardic Inspiration die is rolled, it is lost. A creature can have only one Bardic Inspiration die at a time.\n\nYou can use this feature a number of times equal to your Charisma modifier (a minimum of once). You regain any expended uses when you finish a long rest.\n\nYour Bardic Inspiration die changes when you reach certain levels in this class. The die becomes a d8 at 5th level, a d10 at 10th level, and a d12 at 15th level.',
  },
  'barde-don-des-multiples': {
    name: 'Jack of All Trades',
    description:
      "Starting at 2nd level, you can add half your proficiency bonus, rounded down, to any ability check you make that doesn't already include your proficiency bonus.",
  },
  'barde-chant-de-repos': {
    name: 'Song of Rest (d6)',
    description:
      'Beginning at 2nd level, you can use soothing music or oration to help revitalize your wounded allies during a short rest. If you or any friendly creatures who can hear your performance regain hit points by spending Hit Dice at the end of the short rest, each of those creatures regains an extra 1d6 hit points.\n\nThe extra hit points increase when you reach certain levels in this class: to 1d8 at 9th level, to 1d10 at 13th level, and to 1d12 at 17th level.',
  },
  'barde-expertise': {
    name: 'Expertise',
    description:
      'At 3rd level, choose two of your skill proficiencies. Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies.\n\nAt 10th level, you can choose another two skill proficiencies to gain this benefit.',
  },
  'barde-source-inspiration': {
    name: 'Font of Inspiration',
    description:
      'Beginning when you reach 5th level, you regain all of your expended uses of Bardic Inspiration when you finish a short or long rest.',
  },
  'barde-contre-charme': {
    name: 'Countercharm',
    description:
      'At 6th level, you gain the ability to use musical notes or words of power to disrupt mind-influencing effects. As an action, you can start a performance that lasts until the end of your next turn. During that time, you and any friendly creatures within 30 feet of you have advantage on saving throws against being frightened or charmed. A creature must be able to hear you to gain this benefit. The performance ends early if you are incapacitated or silenced or if you voluntarily end it (no action required).',
  },
  'barde-secrets-magiques': {
    name: 'Magical Secrets',
    description:
      'By 10th level, you have plundered magical knowledge from a wide spectrum of disciplines. Choose two spells from any classes, including this one. A spell you choose must be of a level you can cast, as shown on the Bard table, or a cantrip.\n\nThe chosen spells count as bard spells for you and are included in the number in the Spells Known column of the Bard table.\n\nYou learn two additional spells from any classes at 14th level and again at 18th level.',
  },
  'barde-inspiration-superieure': {
    name: 'Superior Inspiration',
    description:
      'At 20th level, when you roll initiative and have no uses of Bardic Inspiration left, you regain one use.',
  },
  'clerc-canalisation-divine': {
    name: 'Channel Divinity',
    description:
      'At 2nd level, you gain the ability to channel divine energy directly from your deity, using that energy to fuel magical effects. You start with two such effects: Turn Undead and an effect determined by your domain. Some domains grant you additional effects as you advance in levels, as noted in the domain description.\n\nWhen you use your Channel Divinity, you choose which effect to create. You must then finish a short or long rest to use your Channel Divinity again.\n\nSome Channel Divinity effects require saving throws. When you use such an effect from this class, the DC equals your cleric spell save DC.\n\nBeginning at 6th level, you can use your Channel Divinity twice between rests, and beginning at 18th level, you can use it three times between rests. When you finish a short or long rest, you regain your expended uses.',
  },
  'clerc-renvoi-morts-vivants': {
    name: 'Channel Divinity: Turn Undead',
    description:
      "As an action, you present your holy symbol and speak a prayer censuring the undead. Each undead that can see or hear you within 30 feet of you must make a Wisdom saving throw. If the creature fails its saving throw, it is turned for 1 minute or until it takes any damage.\n\nA turned creature must spend its turns trying to move as far away from you as it can, and it can't willingly move to a space within 30 feet of you. It also can't take reactions. For its action, it can use only the Dash action or try to escape from an effect that prevents it from moving. If there's nowhere to move, the creature can use the Dodge action.",
  },
  'clerc-destruction-morts-vivants': {
    name: 'Destroy Undead (CR 1/2)',
    description:
      'Starting at 5th level, when an undead of CR 1/2 or lower fails its saving throw against your Turn Undead feature, the creature is instantly destroyed.',
  },
  'clerc-intervention-divine': {
    name: 'Divine Intervention',
    description:
      "Beginning at 10th level, you can call on your deity to intervene on your behalf when your need is great.\n\nImploring your deity's aid requires you to use your action. Describe the assistance you seek, and roll percentile dice. If you roll a number equal to or lower than your cleric level, your deity intervenes. The DM chooses the nature of the intervention; the effect of any cleric spell or cleric domain spell would be appropriate. If your deity intervenes, you can't use this feature again for 7 days. Otherwise, you can use it again after you finish a long rest.\n\nAt 20th level, your call for intervention succeeds automatically, no roll required.",
  },
  'clerc-intervention-divine-superieure': {
    name: 'Divine Intervention Improvement',
    description:
      'At 20th level, your call for intervention succeeds automatically, no roll required.',
  },
  'druide-druidique': {
    name: 'Druidic',
    description:
      "You know Druidic, the secret language of druids. You can speak the language and use it to leave hidden messages. You and others who know this language automatically spot such a message. Others spot the message's presence with a successful DC 15 Wisdom (Perception) check but can't decipher it without magic.",
  },
  'druide-forme-sauvage': {
    name: 'Wild Shape',
    description:
      "Starting at 2nd level, you can use your action to magically assume the shape of a beast that you have seen before. You can use this feature twice. You regain expended uses when you finish a short or long rest.\n\nYour druid level determines the beasts you can transform into, as shown in the Beast Shapes table. At 2nd level, for example, you can transform into any beast that has a challenge rating of 1/4 or lower that doesn't have a flying or swimming speed.\n\nLevel | Max. CR | Limitations | Example\n--- | ---- | ------ | ----\n2nd | 1/4 | No flying or swimming speed | Wolf\n4th | 1/2 | No flying speed | Crocodile\n8th | 1 | — | Giant eagle\n\nYou can stay in a beast shape for a number of hours equal to half your druid level (rounded down). You then revert to your normal form unless you expend another use of this feature. You can revert to your normal form earlier by using a bonus action on your turn. You automatically revert if you fall unconscious, drop to 0 hit points, or die.\n\nWhile you are transformed, the following rules apply:\n\n- Your game statistics are replaced by the statistics of the beast, but you retain your alignment, personality, and Intelligence, Wisdom, and Charisma scores. You also retain all of your skill and saving throw proficiencies, in addition to gaining those of the creature. If the creature has the same proficiency as you and the bonus in its stat block is higher than yours, use the creature's bonus instead of yours. If the creature has any legendary or lair actions, you can't use them.\n- When you transform, you assume the beast's hit points and Hit Dice. When you revert to your normal form, you return to the number of hit points you had before you transformed. However, if you revert as a result of dropping to 0 hit points, any excess damage carries over to your normal form. For example, if you take 10 damage in animal form and have only 1 hit point left, you revert and take 9 damage. As long as the excess damage doesn't reduce your normal form to 0 hit points, you aren't knocked unconscious.\n- You can't cast spells, and your ability to speak or take any action that requires hands is limited to the capabilities of your beast form. Transforming doesn't break your concentration on a spell you've already cast, however, or prevent you from taking actions that are part of a spell, such as call lightning, that you've already cast.\n- You retain the benefit of any features from your class, race, or other source and can use them if the new form is physically capable of doing so. However, you can't use any of your special senses, such as darkvision, unless your new form also has that sense.\n- You choose whether your equipment falls to the ground in your space, merges into your new form, or is worn by it. Worn equipment functions as normal, but the DM decides whether it is practical for the new form to wear a piece of equipment, based on the creature's shape and size. Your equipment doesn't change size or shape to match the new form, and any equipment that the new form can't wear must either fall to the ground or merge with it. Equipment that merges with the form has no effect until you leave the form.",
  },
  'druide-forme-sauvage-amelioree-4': {
    name: 'Wild Shape Improvement',
    description: 'At 4th level, your Wild Shape improves as shown on the Beast Shapes table.',
  },
  'druide-forme-sauvage-amelioree-8': {
    name: 'Wild Shape Improvement',
    description: 'At 8th level, your Wild Shape improves as shown on the Beast Shapes table.',
  },
  'druide-corps-immortel': {
    name: 'Timeless Body',
    description:
      'Starting at 18th level, the primal magic that you wield causes you to age more slowly. For every 10 years that pass, your body ages only 1 year.',
  },
  'druide-forme-animale': {
    name: 'Beast Spells',
    description:
      "Beginning at 18th level, you can cast many of your druid spells in any shape you assume using Wild Shape. You can perform the somatic and verbal components of a druid spell while in a beast shape, but you aren't able to provide material components.",
  },
  'druide-archidruide': {
    name: 'Archdruid',
    description:
      "At 20th level, you can use your Wild Shape an unlimited number of times.\n\nAdditionally, you can ignore the verbal and somatic components of your druid spells, as well as any material components that lack a cost and aren't consumed by a spell. You gain this benefit in both your normal shape and your beast shape from Wild Shape.",
  },
  'ensorceleur-source-de-magie': {
    name: 'Font of Magic',
    description:
      'At 2nd level, you tap into a deep wellspring of magic within yourself. This wellspring is represented by sorcery points, which allow you to create a variety of magical effects.',
  },
  'ensorceleur-metamagie': {
    name: 'Metamagic',
    description:
      'At 3rd level, you gain the ability to twist your spells to suit your needs. You gain two of the following Metamagic options of your choice. You gain another one at 10th and 17th level.\n\nYou can use only one Metamagic option on a spell when you cast it, unless otherwise noted.',
  },
  'ensorceleur-restauration-sorciere': {
    name: 'Sorcerous Restoration',
    description:
      'At 20th level, you regain 4 expended sorcery points whenever you finish a short rest.',
  },
  'guerrier-style-de-combat': {
    name: 'Fighting Style',
    description:
      "You adopt a particular style of fighting as your specialty. Choose one of the following options. You can't take the same Fighting Style option more than once, even if you get to choose again.",
  },
  'guerrier-second-souffle': {
    name: 'Second Wind',
    description:
      'You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.\n\nOnce you use this feature, you must finish a short or long rest before you can use it again.',
  },
  'guerrier-sursaut-activite': {
    name: 'Action Surge',
    description:
      'Starting at 2nd level, you can push yourself beyond your normal limits for a moment. On your turn, you can take one additional action.\n\nOnce you use this feature, you must finish a short or long rest before you can use it again. Starting at 17th level, you can use it twice before a rest, but only once on the same turn.',
  },
  'guerrier-archetype-martial': {
    name: 'Martial Archetype',
    description:
      'At 3rd level, you choose an archetype from the list available that you strive to emulate in your combat styles and techniques. The archetype you choose grants you features at 3rd level and again at 7th, 10th, 15th, and 18th level.',
  },
  'guerrier-attaque-supplementaire': {
    name: 'Extra Attack',
    description:
      'Beginning at 5th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.\n\nThe number of attacks increases to three when you reach 11th level in this class and to four when you reach 20th level in this class.',
  },
  'guerrier-indomptable': {
    name: 'Indomitable',
    description:
      "Beginning at 9th level, you can reroll a saving throw that you fail. If you do so, you must use the new roll, and you can't use this feature again until you finish a long rest.\n\nYou can use this feature twice between long rests starting at 13th level and three times between long rests starting at 17th level.",
  },
  'magicien-recuperation-arcanique': {
    name: 'Arcane Recovery',
    description:
      "You have learned to regain some of your magical energy by studying your spellbook. Once per day when you finish a short rest, you can choose expended spell slots to recover. The spell slots can have a combined level that is equal to or less than half your wizard level (rounded up), and none of the slots can be 6th level or higher.\n\nFor example, if you're a 4th-level wizard, you can recover up to two levels worth of spell slots. You can recover either a 2nd-level spell slot or two 1st-level spell slots.",
  },
  'magicien-ecole-de-magie': {
    name: 'Arcane Tradition',
    description:
      'When you reach 2nd level, you choose an arcane tradition from the list of available traditions, shaping your practice of magic. Your choice grants you features at 2nd level and again at 6th, 10th, and 14th level.',
  },
  'magicien-maitrise-de-la-magie': {
    name: 'Spell Mastery',
    description:
      'At 18th level, you have achieved such mastery over certain spells that you can cast them at will. Choose a 1st-level wizard spell and a 2nd-level wizard spell that are in your spellbook. You can cast those spells at their lowest level without expending a spell slot when you have them prepared. If you want to cast either spell at a higher level, you must expend a spell slot as normal.\n\nBy spending 8 hours in study, you can exchange one or both of the spells you chose for different spells of the same levels.',
  },
  'magicien-sorts-signature': {
    name: 'Signature Spells',
    description:
      "When you reach 20th level, you gain mastery over two powerful spells and can cast them with little effort. Choose two 3rd-level wizard spells in your spellbook as your signature spells. You always have these spells prepared, they don't count against the number of spells you have prepared, and you can cast each of them once at 3rd level without expending a spell slot. When you do so, you can't do so again until you finish a short or long rest.\n\nIf you want to cast either spell at a higher level, you must expend a spell slot as normal.",
  },
  'moine-arts-martiaux': {
    name: 'Martial Arts',
    description:
      "Your practice of martial arts gives you mastery of combat styles that use unarmed strikes and monk weapons, which are shortsword and any simple melee weapons that don't have the two-handed or heavy property.\n\nYou gain the following benefits while you are unarmed or wielding only monk weapons and you aren't wearing armor or wielding a shield.\n\n- You can use Dexterity instead of Strength for the attack and damage rolls of your unarmed strikes and monk weapons.\n- You can roll a d4 in place of the normal damage of your unarmed strike or monk weapon. This die changes as you gain monk levels, as shown in the Martial Arts column of the Monk table.\n- When you use the Attack action with an unarmed strike or a monk weapon on your turn, you can make one unarmed strike as a bonus action. For example, if you take the Attack action and attack with a quarterstaff, you can also make an unarmed strike as a bonus action, assuming you haven't already taken a bonus action this turn.\n\nCertain monasteries use specialized forms of the monk weapons. For example, you might use a club that is two lengths of wood connected by a short chain (called a nunchaku) or a sickle with a shorter, straighter blade (called a kama).",
  },
  'moine-defense-sans-armure': {
    name: 'Unarmored Defense',
    description:
      'Beginning at 1st level, while you are wearing no armor and not wielding a shield, your AC equals 10 + your Dexterity modifier + your Wisdom modifier.',
  },
  'moine-ki': {
    name: 'Ki',
    description:
      "Starting at 2nd level, your training allows you to harness the mystic energy of ki. Your access to this energy is represented by a number of ki points. Your monk level determines the number of points you have, as shown in the Ki Points column of the Monk table.\n\nYou can spend these points to fuel various ki features. You start knowing three such features: Flurry of Blows, Patient Defense, and Step of the Wind. You learn more ki features as you gain levels in this class.\n\nWhen you spend a ki point, it is unavailable until you finish a short or long rest, at the end of which you draw all of your expended ki back into yourself. You must spend at least 30 minutes of the rest meditating to regain your ki points.\n\nSome of your ki features require your target to make a saving throw to resist the feature's effects. The saving throw DC is calculated as follows:\n\nSpell save DC = 8 + proficiency + $",
  },
  'moine-deplacement-sans-armure': {
    name: 'Unarmored Movement',
    description:
      'Starting at 2nd level, your speed increases by 10 feet while you are not wearing armor or wielding a shield. This bonus increases when you reach certain monk levels, as shown in the Monk table.\n\nAt 9th level, you gain the ability to move along vertical surfaces and across liquids on your turn without falling during the move.',
  },
  'moine-deviation-projectiles': {
    name: 'Deflect Missiles',
    description:
      'Starting at 3rd level, you can use your reaction to deflect or catch the missile when you are hit by a ranged weapon attack. When you do so, the damage you take from the attack is reduced by 1d10 + your Dexterity modifier + your monk level.\n\nIf you reduce the damage to 0, you can catch the missile if it is small enough for you to hold in one hand and you have at least one hand free. If you catch a missile in this way, you can spend 1 ki point to make a ranged attack (range 20/60 feet) with the weapon or piece of ammunition you just caught, as part of the same reaction. You make this attack with proficiency, regardless of your weapon proficiencies, and the missile counts as a monk weapon for the attack.',
  },
  'moine-chute-lente': {
    name: 'Slow Fall',
    description:
      'Beginning at 4th level, you can use your reaction when you fall to reduce any falling damage you take by an amount equal to five times your monk level.',
  },
  'moine-attaque-supplementaire': {
    name: 'Extra Attack',
    description:
      'Beginning at 5th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.',
  },
  'moine-frappe-etourdissante': {
    name: 'Stunning Strike',
    description:
      "Starting at 5th level, you can interfere with the flow of ki in an opponent's body. When you hit another creature with a melee weapon attack, you can spend 1 ki point to attempt a stunning strike. The target must succeed on a Constitution saving throw or be stunned until the end of your next turn.",
  },
  'moine-frappes-de-ki': {
    name: 'Ki-Empowered Strikes',
    description:
      'Starting at 6th level, your unarmed strikes count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.',
  },
  'moine-evasion': {
    name: 'Evasion',
    description:
      "At 7th level, your instinctive agility lets you dodge out of the way of certain area effects, such as a blue dragon's lightning breath or a fireball spell. When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.",
  },
  'moine-serenite': {
    name: 'Stillness of Mind',
    description:
      'Starting at 7th level, you can use your action to end one effect on yourself that is causing you to be charmed or frightened.',
  },
  'moine-deplacement-sans-armure-ameliore': {
    name: 'Unarmored Movement improvement',
    description:
      'At 9th level, you gain the ability to move along vertical surfaces and across liquids on your turn without falling during the move.',
  },
  'moine-corps-pur': {
    name: 'Purity of Body',
    description:
      'At 10th level, your mastery of the ki flowing through you makes you immune to disease and poison.',
  },
  'moine-langue-soleil-lune': {
    name: 'Tongue of the Sun and Moon',
    description:
      'Starting at 13th level, you learn to touch the ki of other minds so that you understand all spoken languages. Moreover, any creature that can understand a language can understand what you say.',
  },
  'moine-ame-de-diamant': {
    name: 'Diamond Soul',
    description:
      'Beginning at 14th level, your mastery of ki grants you proficiency in all saving throws.\n\nAdditionally, whenever you make a saving throw and fail, you can spend 1 ki point to reroll it and take the second result.',
  },
  'moine-jeunesse-eternelle': {
    name: 'Timeless Body',
    description:
      "At 15th level, your ki sustains you so that you suffer none of the frailty of old age, and you can't be aged magically. You can still die of old age, however. In addition, you no longer need food or water.",
  },
  'moine-desertion-ame': {
    name: 'Empty Body',
    description:
      "Beginning at 18th level, you can use your action to spend 4 ki points to become invisible for 1 minute. During that time, you also have resistance to all damage but force damage.\n\nAdditionally, you can spend 8 ki points to cast the astral projection spell, without needing material components. When you do so, you can't take any other creatures with you.",
  },
  'moine-perfection-de-soi': {
    name: 'Perfect Self',
    description:
      'At 20th level, when you roll for initiative and have no ki points remaining, you regain 4 ki points.',
  },
  'occultiste-invocations': {
    name: 'Eldritch Invocations',
    description:
      'In your study of occult lore, you have unearthed eldritch invocations, fragments of forbidden knowledge that imbue you with an abiding magical ability.\n\nAt 2nd level, you gain two eldritch invocations of your choice. A list of the available options can be found on the Optional Features page. When you gain certain warlock levels, you gain additional invocations of your choice, as shown in the Invocations Known column of the Warlock table.\n\nAdditionally, when you gain a level in this class, you can choose one of the invocations you know and replace it with another invocation that you could learn at that level.\n\nIf an eldritch invocation has prerequisites, you must meet them to learn it. You can learn the invocation at the same time that you meet its prerequisites. A level prerequisite refers to your level in this class.',
  },
  'occultiste-faveur-de-pacte': {
    name: 'Pact Boon',
    description:
      'At 3rd level, your otherworldly patron bestows a gift upon you for your loyal service. You gain one of the following features of your choice.',
  },
  'occultiste-arcanum-6': {
    name: 'Mystic Arcanum (6th level)',
    description:
      'At 11th level, your patron bestows upon you a magical secret called an arcanum. Choose one 6th-level spell from the warlock spell list as this arcanum.\n\nYou can cast your arcanum spell once without expending a spell slot. You must finish a long rest before you can do so again.\n\nAt higher levels, you gain more warlock spells of your choice that can be cast in this way: one 7th-level spell at 13th level, one 8th-level spell at 15th level, and one 9th-level spell at 17th level. You regain all uses of your Mystic Arcanum when you finish a long rest.',
  },
  'occultiste-arcanum-7': {
    name: 'Mystic Arcanum (7th level)',
    description:
      'At 13th level, your patron bestows upon you a magical secret called an arcanum. Choose one 7th-level spell from the warlock spell list as this arcanum.\n\nYou can cast your arcanum spell once without expending a spell slot. You must finish a long rest before you can do so again.',
  },
  'occultiste-arcanum-8': {
    name: 'Mystic Arcanum (8th level)',
    description:
      'At 15th level, your patron bestows upon you a magical secret called an arcanum. Choose one 8th-level spell from the warlock spell list as this arcanum.\n\nYou can cast your arcanum spell once without expending a spell slot. You must finish a long rest before you can do so again.',
  },
  'occultiste-arcanum-9': {
    name: 'Mystic Arcanum (9th level)',
    description:
      'At 17th level, your patron bestows upon you a magical secret called an arcanum. Choose one 9th-level spell from the warlock spell list as this arcanum.\n\nYou can cast your arcanum spell once without expending a spell slot. You must finish a long rest before you can do so again.',
  },
  'occultiste-maitre-occulte': {
    name: 'Eldritch Master',
    description:
      'At 20th level, you can draw on your inner reserve of mystical power while entreating your patron to regain expended spell slots. You can spend 1 minute entreating your patron for aid to regain all your expended spell slots from your Pact Magic feature. Once you regain spell slots with this feature, you must finish a long rest before you can do so again.',
  },
  'paladin-sens-divins': {
    name: 'Divine Sense',
    description:
      'The presence of strong evil registers on your senses like a noxious odor, and powerful good rings like heavenly music in your ears. As an action, you can open your awareness to detect such forces. Until the end of your next turn, you know the location of any celestial, fiend, or undead within 60 feet of you that is not behind Cover. You know the type (celestial, fiend, or undead) of any being whose presence you sense, but not its identity (the vampire Count Strahd von Zarovich, for instance). Within the same radius, you also detect the presence of any place or object that has been consecrated or desecrated, as with the hallow spell.\n\nYou can use this feature a number of times equal to 1 + your Charisma modifier. When you finish a long rest, you regain all expended uses.',
  },
  'paladin-imposition-des-mains': {
    name: 'Lay on Hands',
    description:
      'Your blessed touch can heal wounds. You have a pool of healing power that replenishes when you take a long rest. With that pool, you can restore a total number of hit points equal to your paladin level × 5.\n\nAs an action, you can touch a creature and draw power from the pool to restore a number of hit points to that creature, up to the maximum amount remaining in your pool.\n\nAlternatively, you can expend 5 hit points from your pool of healing to cure the target of one disease or neutralize one poison affecting it. You can cure multiple diseases and neutralize multiple poisons with a single use of Lay on Hands, expending hit points separately for each one.\n\nThis feature has no effect on undead and constructs.',
  },
  'paladin-chatiment-divin': {
    name: 'Divine Smite',
    description:
      "Starting at 2nd level, when you hit a creature with a melee weapon attack, you can expend one spell slot to deal radiant damage to the target, in addition to the weapon's damage. The extra damage is 2d8 for a 1st-level spell slot, plus 1d8 for each spell level higher than 1st, to a maximum of 5d8. The damage increases by 1d8 if the target is an undead or a fiend, to a maximum of 6d8.",
  },
  'paladin-canalisation-divine': {
    name: 'Channel Divinity',
    description:
      'Your oath allows you to channel divine energy to fuel magical effects. Each Channel Divinity option provided by your oath explains how to use it.\n\nWhen you use your Channel Divinity, you choose which option to use. You must then finish a short or long rest to use your Channel Divinity again.\n\nSome Channel Divinity effects require saving throws. When you use such an effect from this class, the DC equals your paladin spell save DC.',
  },
  'paladin-sante-divine': {
    name: 'Divine Health',
    description: 'By 3rd level, the divine magic flowing through you makes you immune to disease.',
  },
  'paladin-attaque-supplementaire': {
    name: 'Extra Attack',
    description:
      'Beginning at 5th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.',
  },
  'paladin-aura-de-protection': {
    name: 'Aura of Protection',
    description:
      'Starting at 6th level, whenever you or a friendly creature within 10 feet of you must make a saving throw, the creature gains a bonus to the saving throw equal to your Charisma modifier (with a minimum bonus of +1). You must be conscious to grant this bonus.\n\nAt 18th level, the range of this aura increases to 30 feet.',
  },
  'paladin-aura-de-courage': {
    name: 'Aura of Courage',
    description:
      "Starting at 10th level, you and friendly creatures within 10 feet of you can't be frightened while you are conscious.\n\nAt 18th level, the range of this aura increases to 30 feet.",
  },
  'paladin-chatiment-divin-ameliore': {
    name: 'Improved Divine Smite',
    description:
      'By 11th level, you are so suffused with righteous might that all your melee weapon strikes carry divine power with them. Whenever you hit a creature with a melee weapon, the creature takes an extra 1d8 radiant damage.',
  },
  'paladin-toucher-purificateur': {
    name: 'Cleansing Touch',
    description:
      'Beginning at 14th level, you can use your action to end one spell on yourself or on one willing creature that you touch.\n\nYou can use this feature a number of times equal to your Charisma modifier (a minimum of once). You regain expended uses when you finish a long rest.',
  },
  'paladin-amelioration-auras': {
    name: 'Aura improvements',
    description: 'At 18th level, the range of your Aura of Protection increases to 30 feet.',
  },
  'rodeur-ennemi-favori': {
    name: 'Favored Enemy',
    description:
      'Beginning at 1st level, you have significant experience studying, tracking, hunting, and even talking to a certain type of enemy.\n\nChoose a type of favored enemy: aberrations, beasts, celestials, constructs, dragons, elementals, fey, fiends, giants, monstrosities, oozes, plants, or undead. Alternatively, you can select two races of humanoid (such as gnoll and orc) as favored enemies.\n\nYou have advantage on Wisdom (Survival) checks to track your favored enemies, as well as on Intelligence checks to recall information about them.\n\nWhen you gain this feature, you also learn one language of your choice that is spoken by your favored enemies, if they speak one at all.\n\nYou choose one additional favored enemy, as well as an associated language, at 6th and 14th level. As you gain levels, your choices should reflect the types of monsters you have encountered on your adventures.',
  },
  'rodeur-explorateur-naturel': {
    name: 'Natural Explorer',
    description:
      "You are particularly familiar with one type of natural environment and are adept at traveling and surviving in such regions. Choose one type of favored terrain: arctic, coast, desert, forest, grassland, mountain, swamp, or the Underdark. When you make an Intelligence or Wisdom check related to your favored terrain, your proficiency bonus is doubled if you are using a skill that you're proficient in.\n\nWhile traveling for an hour or more in your favored terrain, you gain the following benefits:\n\n- Difficult terrain doesn't slow your group's travel.\n- Your group can't become lost except by magical means.\n- Even when you are engaged in another activity while traveling (such as foraging, navigating, or tracking), you remain alert to danger.\n- If you are traveling alone, you can move stealthily at a normal pace.\n- When you forage, you find twice as much food as you normally would.\n- While tracking other creatures, you also learn their exact number, their sizes, and how long ago they passed through the area.\n\nYou choose additional favored terrain types at 6th and 10th level.",
  },
  'rodeur-conscience-primordiale': {
    name: 'Primeval Awareness',
    description:
      "Beginning at 3rd level, you can use your action and expend one ranger spell slot to focus your awareness on the region around you. For 1 minute per level of the spell slot you expend, you can sense whether the following types of creatures are present within 1 mile of you (or within up to 6 miles if you are in your favored terrain): aberrations, celestials, dragons, elementals, fey, fiends, and undead. This feature doesn't reveal the creatures' location or number.",
  },
  'rodeur-attaque-supplementaire': {
    name: 'Extra Attack',
    description:
      'Beginning at 5th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.',
  },
  'rodeur-foulee-de-la-terre': {
    name: "Land's Stride",
    description:
      'Starting at 8th level, moving through nonmagical difficult terrain costs you no extra movement. You can also pass through nonmagical plants without being slowed by them and without taking damage from them if they have thorns, spines, or a similar hazard.\n\nIn addition, you have advantage on saving throws against plants that are magically created or manipulated to impede movement, such as those created by the entangle spell.',
  },
  'rodeur-dissimulation-naturelle': {
    name: 'Hide in Plain Sight',
    description:
      'Starting at 10th level, you can spend 1 minute creating camouflage for yourself. You must have access to fresh mud, dirt, plants, soot, and other naturally occurring materials with which to create your camouflage.\n\nOnce you are camouflaged in this way, you can try to hide by pressing yourself up against a solid surface, such as a tree or wall, that is at least as tall and wide as you are. You gain a +10 bonus to Dexterity (Stealth) checks as long as you remain there without moving or taking actions. Once you move or take an action or a reaction, you must camouflage yourself again to gain this benefit.',
  },
  'rodeur-disparition': {
    name: 'Vanish',
    description:
      "Starting at 14th level, you can use the Hide action as a bonus action on your turn. Also, you can't be tracked by nonmagical means, unless you choose to leave a trail.",
  },
  'rodeur-sens-feroce': {
    name: 'Feral Senses',
    description:
      "At 18th level, you gain preternatural senses that help you fight creatures you can't see. When you attack a creature you can't see, your inability to see it doesn't impose disadvantage on your attack rolls against it. You are also aware of the location of any invisible creature within 30 feet of you, provided that the creature isn't hidden from you and you aren't blinded or deafened.",
  },
  'rodeur-fleau-des-ennemis': {
    name: 'Foe Slayer',
    description:
      'At 20th level, you become an unparalleled hunter of your enemies. Once on each of your turns, you can add your Wisdom modifier to the attack roll or the damage roll of an attack you make against one of your favored enemies. You can choose to use this feature before or after the roll, but before any effects of the roll are applied.',
  },
  'roublard-expertise': {
    name: 'Expertise',
    description:
      "At 1st level, choose two of your skill proficiencies, or one of your skill proficiencies and your proficiency with thieves' tools. Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies.\n\nAt 6th level, you can choose two more of your proficiencies (in skills or with thieves' tools) to gain this benefit.",
  },
  'roublard-attaque-sournoise': {
    name: 'Sneak Attack',
    description:
      "Beginning at 1st level, you know how to strike subtly and exploit a foe's distraction. Once per turn, you can deal an extra 1d6 damage to one creature you hit with an attack if you have advantage on the attack roll. The attack must use a finesse or a ranged weapon.\n\nYou don't need advantage on the attack roll if another enemy of the target is within 5 feet of it, that enemy isn't incapacitated, and you don't have disadvantage on the attack roll.\n\nThe amount of the extra damage increases as you gain levels in this class, as shown in the Sneak Attack column of the Rogue table.",
  },
  'roublard-argot-des-voleurs': {
    name: "Thieves' Cant",
    description:
      "During your rogue training you learned thieves' cant, a secret mix of dialect, jargon, and code that allows you to hide messages in seemingly normal conversation. Only another creature that knows thieves' cant understands such messages. It takes four times longer to convey such a message than it does to speak the same idea plainly.\n\nIn addition, you understand a set of secret signs and symbols used to convey short, simple messages, such as whether an area is dangerous or the territory of a thieves' guild, whether loot is nearby, or whether the people in an area are easy marks or will provide a safe house for thieves on the run.",
  },
  'roublard-action-rusee': {
    name: 'Cunning Action',
    description:
      'Starting at 2nd level, your quick thinking and agility allow you to move and act quickly. You can take a bonus action on each of your turns in combat. This action can be used only to take the Dash, Disengage, or Hide action.',
  },
  'roublard-archetype': {
    name: 'Roguish Archetype',
    description:
      'At 3rd level, you choose an archetype that you emulate in the exercise of your rogue abilities from the list of available archetypes. Your archetype choice grants you features at 3rd level and then again at 9th, 13th, and 17th level.',
  },
  'roublard-esquive-extraordinaire': {
    name: 'Uncanny Dodge',
    description:
      "Starting at 5th level, when an attacker that you can see hits you with an attack, you can use your reaction to halve the attack's damage against you.",
  },
  'roublard-evasion': {
    name: 'Evasion',
    description:
      "Beginning at 7th level, you can nimbly dodge out of the way of certain area effects, such as a red dragon's fiery breath or an ice storm spell. When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.",
  },
  'roublard-talent-fiable': {
    name: 'Reliable Talent',
    description:
      'By 11th level, you have refined your chosen skills until they approach perfection. Whenever you make an ability check that lets you add your proficiency bonus, you can treat a d20 roll of 9 or lower as a 10.',
  },
  'roublard-perception-aveugle': {
    name: 'Blindsense',
    description:
      'Starting at 14th level, if you are able to hear, you are aware of the location of any hidden or invisible creature within 10 feet of you.',
  },
  'roublard-esprit-glissant': {
    name: 'Slippery Mind',
    description:
      'By 15th level, you have acquired greater mental strength. You gain proficiency in Wisdom saving throws.',
  },
  'roublard-insaisissable': {
    name: 'Elusive',
    description:
      "Beginning at 18th level, you are so evasive that attackers rarely gain the upper hand against you. No attack roll has advantage against you while you aren't incapacitated.",
  },
  'roublard-coup-de-chance': {
    name: 'Stroke of Luck',
    description:
      "At 20th level, you have an uncanny knack for succeeding when you need to. If your attack misses a target within range, you can turn the miss into a hit. Alternatively, if you fail an ability check, you can treat the d20 roll as a 20.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.",
  },
  'alchimiste-outils': {
    name: 'Tool Proficiency',
    description:
      "When you adopt this specialization at 3rd level, you gain proficiency with alchemist's supplies. If you already have this proficiency, you gain proficiency with one other type of artisan's tools of your choice.",
  },
  'alchimiste-sorts': {
    name: 'Alchemist Spells',
    description:
      "Starting at 3rd level, you always have certain spells prepared after you reach particular levels in this class, as shown in the Alchemist Spells table. These spells count as artificer spells for you, but they don't count against the number of artificer spells you prepare.\n\nArtificer Level | Spell\n-------- | ---\n3rd | healing word, ray of sickness\n5th | flaming sphere, Melf's acid arrow\n9th | gaseous form, mass healing word\n13th | blight, death ward\n17th | cloudkill, raise dead",
  },
  'alchimiste-elixir-experimental': {
    name: 'Experimental Elixir',
    description:
      "Beginning at 3rd level, whenever you finish a long rest, you can magically produce an experimental elixir in an empty flask you touch. Roll on the Experimental Elixir table for the elixir's effect, which is triggered when someone drinks the elixir. As an action, a creature can drink the elixir or administer it to an incapacitated creature.\n\nCreating an experimental elixir requires you to have alchemist's supplies on your person, and any elixir you create with this feature lasts until it is drunk or until the end of your next long rest.\n\nWhen you reach certain levels in this class, you can make more elixirs at the end of a long rest: two at 6th level and three at 15th level. Roll for each elixir's effect separately. Each elixir requires its own flask.\n\nYou can create additional experimental elixirs by expending a spell slot of 1st level or higher for each one. When you do so, you use your action to create the elixir in an empty flask you touch, and you choose the elixir's effect from the Experimental Elixir table.\n\nd6 | Effect\n--- | ----\n1 | Healing. The drinker regains a number of hit points equal to 2d4 + your Intelligence modifier.\n2 | Swiftness. The drinker's walking speed increases by 10 feet for 1 hour.\n3 | Resilience. The drinker gains a +1 bonus to AC for 10 minutes.\n4 | Boldness. The drinker can roll a d4 and add the number rolled to every attack roll and saving throw they make for the next minute.\n5 | Flight. The drinker gains a flying speed of 10 feet for 10 minutes.\n6 | Transformation. The drinker's body is transformed as if by the alter self spell. The drinker determines the transformation caused by the spell, the effects of which last for 10 minutes.",
  },
  'alchimiste-erudit-alchimique': {
    name: 'Alchemical Savant',
    description:
      "At 5th level, you develop masterful command of magical chemicals, enhancing the healing and damage you create through them. Whenever you cast a spell using your alchemist's supplies as the spellcasting focus, you gain a bonus to one roll of the spell. That roll must restore hit points or be a damage roll that deals acid, fire, necrotic, or poison damage, and the bonus equals your Intelligence modifier (minimum of +1).",
  },
  'alchimiste-ingredients-revigorants': {
    name: 'Restorative Reagents',
    description:
      "Starting at 9th level, you can incorporate restorative reagents into some of your works:\n\n- Whenever a creature drinks an experimental elixir you created, the creature gains temporary hit points equal to 2d6 + your Intelligence modifier (minimum of 1 temporary hit point).\n- You can cast lesser restoration without expending a spell slot and without preparing the spell, provided you use alchemist's supplies as the spellcasting focus. You can do so a number of times equal to your Intelligence modifier (minimum of once), and you regain all expended uses when you finish a long rest.",
  },
  'alchimiste-maitrise-chimique': {
    name: 'Chemical Mastery',
    description:
      "By 15th level, you have been exposed to so many chemicals that they pose little risk to you, and you can use them to quickly end certain ailments:\n\n- You gain resistance to acid damage and poison damage, and you are immune to the poisoned condition.\n- You can cast greater restoration and heal without expending a spell slot, without preparing the spell, and without material components, provided you use alchemist's supplies as the spellcasting focus. Once you cast either spell with this feature, you can't cast that spell with it again until you finish a long rest.",
  },
  'artilleur-outils': {
    name: 'Tool Proficiency',
    description:
      "When you adopt this specialization at 3rd level, you gain proficiency with woodcarver's tools. If you already have this proficiency, you gain proficiency with one other type of artisan's tools of your choice.",
  },
  'artilleur-sorts': {
    name: 'Artillerist Spells',
    description:
      "Starting at 3rd level, you always have certain spells prepared after you reach particular levels in this class, as shown in the Artillerist Spells table. These spells count as artificer spells for you, but they don't count against the number of artificer spells you prepare.\n\nArtificer Level | Spell\n-------- | ---\n3rd | shield, thunderwave\n5th | scorching ray, shatter\n9th | fireball, wind wall\n13th | ice storm, wall of fire\n17th | cone of cold, wall of force",
  },
  'artilleur-canon-occulte': {
    name: 'Eldritch Cannon',
    description:
      "At 3rd level, you learn how to create a magical cannon. Using woodcarver's tools or smith's tools, you can take an action to magically create a Small or Tiny eldritch cannon in an unoccupied space on a horizontal surface within 5 feet of you. A Small eldritch cannon occupies its space, and a Tiny one can be held in one hand.\n\nOnce you create a cannon, you can't do so again until you finish a long rest or until you expend a spell slot of 1st level or higher. You can have only one cannon at a time and can't create one while your cannon is present.\n\nThe cannon is a magical object. Regardless of size, the cannon has an AC of 18 and a number of hit points equal to five times your artificer level. It is immune to poison damage and psychic damage, and all conditions. If it is forced to make an ability check or a saving throw, treat all its ability scores as 10 (+0). If the mending spell is cast on it, it regains 2d6 hit points. It disappears if it is reduced to 0 hit points or after 1 hour. You can dismiss it early as an action.\n\nWhen you create the cannon, you determine its appearance and whether it has legs. You also decide which type it is, choosing from the options on the Eldritch Cannons table. On each of your turns, you can take a bonus action to cause the cannon to activate if you are within 60 feet of it. As part of the same bonus action, you can direct the cannon to walk or climb up to 15 feet to an unoccupied space, provided it has legs.\n\nCannon | Activation\n---- | ------\nEldritch Cannon, Flamethrower | The cannon exhales fire in an adjacent 15-foot cone that you designate. Each creature in that area must make a Dexterity saving throw against your spell save DC, taking 2d8 fire damage on a failed save or half as much damage on a successful one. The fire ignites any flammable objects in the area that aren't being worn or carried.\nEldritch Cannon, Force Ballista | Make a ranged spell attack, originating from the cannon, at one creature or object within 120 feet of it. On a hit, the target takes 2d8 force damage, and if the target is a creature, it is pushed up to 5 feet away from the cannon.\nEldritch Cannon, Protector | The cannon emits a burst of positive energy that grants itself and each creature of your choice within 10 feet of it a number of temporary hit points equal to 1d8 + your Intelligence modifier (minimum of +1).",
  },
  'artilleur-arme-feu-arcanique': {
    name: 'Arcane Firearm',
    description:
      "At 5th level, you know how to turn a wand, staff, or rod into an arcane firearm, a conduit for your destructive spells. When you finish a long rest, you can use woodcarver's tools to carve special sigils into a wand, staff, or rod and thereby turn it into your arcane firearm. The sigils disappear from the object if you later carve them on a different item. The sigils otherwise last indefinitely.\n\nYou can use your arcane firearm as a spellcasting focus for your artificer spells. When you cast an artificer spell through the firearm, roll a d8, and you gain a bonus to one of the spell's damage rolls equal to the number rolled.",
  },
  'artilleur-canon-explosif': {
    name: 'Explosive Cannon',
    description:
      "Starting at 9th level, every eldritch cannon you create is more destructive:\n\n- The cannon's damage rolls all increase by 1d8.\n- As an action, you can command the cannon to detonate if you are within 60 feet of it. Doing so destroys the cannon and forces each creature within 20 feet of it to make a Dexterity saving throw against your spell save DC, taking 3d8 force damage on a failed save or half as much damage on a successful one.",
  },
  'artilleur-position-fortifiee': {
    name: 'Fortified Position',
    description:
      "Starting at 15th level, you're a master at forming well-defended emplacements using Eldritch Cannon:\n\n- You and your allies have Cover while within 10 feet of a cannon you create with Eldritch Cannon, as a result of a shimmering field of magical protection that the cannon emits.\n- You can now have two cannons at the same time. You can create two with the same action (but not the same spell slot), and you can activate both of them with the same bonus action. You determine whether the cannons are identical to each other or different. You can't create a third cannon while you have two.",
  },
  'forgeron-outils': {
    name: 'Tool Proficiency',
    description:
      "When you adopt this specialization at 3rd level, you gain proficiency with smith's tools. If you already have this proficiency, you gain proficiency with one other type of artisan's tools of your choice.",
  },
  'forgeron-sorts': {
    name: 'Battle Smith Spells',
    description:
      "Starting at 3rd level, you always have certain spells prepared after you reach particular levels in this class, as shown in the Battle Smith Spells table. These spells count as artificer spells for you, but they don't count against the number of artificer spells you prepare.\n\nArtificer Level | Spell\n-------- | ---\n3rd | heroism, shield\n5th | branding smite, warding bond\n9th | aura of vitality, conjure barrage\n13th | aura of purity, fire shield\n17th | banishing smite, mass cure wounds",
  },
  'forgeron-apte-au-combat': {
    name: 'Battle Ready',
    description:
      'When you reach 3rd level, your combat training and your experiments with magic have paid off in two ways:\n\n- You gain proficiency with martial weapons.\n- When you attack with a magic weapon, you can use your Intelligence modifier, instead of Strength or Dexterity modifier, for the attack and damage rolls.',
  },
  'forgeron-defenseur-acier': {
    name: 'Steel Defender',
    description:
      "By 3rd level, your tinkering has borne you a faithful companion, a steel defender. It is friendly to you and your companions, and it obeys your commands. See this creature's game statistics in the steel defender stat block, which uses your proficiency bonus (PB) in several places. You determine the creature's appearance and whether it has two legs or four; your choice has no effect on its game statistics.\n\nIn combat, the defender shares your initiative count, but it takes its turn immediately after yours. It can move and use its reaction on its own, but the only action it takes on its turn is the Dodge action, unless you take a bonus action on your turn to command it to take another action. That action can be one in its stat block or some other action. If you are incapacitated, the defender can take any action of its choice, not just Dodge.\n\nIf the mending spell is cast on it, it regains 2d6 hit points. If it has died within the last hour, you can use your smith's tools as an action to revive it, provided you are within 5 feet of it and you expend a spell slot of 1st level or higher. The steel defender returns to life after 1 minute with all its hit points restored.\n\nAt the end of a long rest, you can create a new steel defender if you have your smith's tools with you. If you already have a steel defender from this feature, the first one immediately perishes. The defender also perishes if you die.",
  },
  'forgeron-attaque-supplementaire': {
    name: 'Extra Attack',
    description:
      'Starting at 5th level, you can attack twice, rather than once, whenever you take the Attack action on your turn.',
  },
  'forgeron-decharge-arcanique': {
    name: 'Arcane Jolt',
    description:
      'At 9th level, you learn new ways to channel arcane energy to harm or heal. When either you hit a target with a magic weapon attack or your steel defender hits a target, you can channel magical energy through the strike to create one of the following effects:\n\n- The target takes an extra 2d6 force damage.\n- Choose one creature or object you can see within 30 feet of the target. Healing energy flows into the chosen recipient, restoring 2d6 hit points to it.\n\nYou can use this energy a number of times equal to your Intelligence modifier (minimum of once), but you can do so no more than once on a turn. You regain all expended uses when you finish a long rest.',
  },
  'forgeron-defenseur-ameliore': {
    name: 'Improved Defender',
    description:
      'At 15th level, your Arcane Jolt and steel defender become more powerful:\n\n- The extra damage and the healing of your Arcane Jolt both increase to 4d6.\n- Your steel defender gains a +2 bonus to Armor Class.\n- Whenever your steel defender uses its Deflect Attack, the attacker takes force damage equal to 1d4 + your Intelligence modifier.',
  },
  'berserker-frenesie': {
    name: 'Frenzy',
    description:
      'Starting when you choose this path at 3rd level, you can go into a frenzy when you rage. If you do so, for the duration of your rage you can make a single melee weapon attack as a bonus action on each of your turns after this one. When your rage ends, you suffer one level of exhaustion.',
  },
  'berserker-rage-aveugle': {
    name: 'Mindless Rage',
    description:
      "Beginning at 6th level, you can't be charmed or frightened while raging. If you are charmed or frightened when you enter your rage, the effect is suspended for the duration of the rage.",
  },
  'berserker-intimidation': {
    name: 'Intimidating Presence',
    description:
      "Beginning at 10th level, you can use your action to frighten someone with your menacing presence. When you do so, choose one creature that you can see within 30 feet of you. If the creature can see or hear you, it must succeed on a Wisdom saving throw (DC equal to 8 + your proficiency bonus + your Charisma modifier) or be frightened of you until the end of your next turn. On subsequent turns, you can use your action to extend the duration of this effect on the frightened creature until the end of your next turn. This effect ends if the creature ends its turn out of line of sight or more than 60 feet away from you.\n\nIf the creature succeeds on its saving throw, you can't use this feature on that creature again for 24 hours.",
  },
  'berserker-represailles': {
    name: 'Retaliation',
    description:
      'Starting at 14th level, when you take damage from a creature that is within 5 feet of you, you can use your reaction to make a melee weapon attack against that creature.',
  },
  'totem-queteur-spirituel': {
    name: 'Spirit Seeker',
    description:
      'Yours is a path that seeks attunement with the natural world, giving you a kinship with beasts. At 3rd level when you adopt this path, you gain the ability to cast the beast sense and speak with animals spells, but only as rituals, as described in chapter 10.',
  },
  'totem-esprit': {
    name: 'Totem Spirit',
    description:
      'At 3rd level, when you adopt this path, you choose a totem spirit and gain its feature. You must make or acquire a physical totem object—an amulet or similar adornment—that incorporates fur or feathers, claws, teeth, or bones of the totem animal. At your option, you also gain minor physical attributes that are reminiscent of your totem spirit. For example, if you have a bear totem spirit, you might be unusually hairy and thick-skinned, or if your totem is the eagle, your eyes turn bright yellow.\n\nYour totem animal might be an animal related to those listed here but more appropriate to your homeland. For example, you could choose a hawk or vulture in place of an eagle.',
  },
  'totem-aspect-de-la-bete': {
    name: 'Aspect of the Beast',
    description:
      'At 6th level, you gain a magical benefit based on the totem animal of your choice. You can choose the same animal you selected at 3rd level or a different one.',
  },
  'totem-marcheur-spirituel': {
    name: 'Spirit Walker',
    description:
      'At 10th level, you can cast the commune with nature spell, but only as a ritual. When you do so, a spiritual version of one of the animals you chose for Totem Spirit or Aspect of the Beast appears to you to convey the information you seek.',
  },
  'totem-harmonisation': {
    name: 'Totemic Attunement',
    description:
      'At 14th level, you gain a magical benefit based on a totem animal of your choice. You can choose the same animal you selected previously or a different one.',
  },
  'savoir-maitrises-supplementaires': {
    name: 'Bonus Proficiencies',
    description:
      'When you join the College of Lore at 3rd level, you gain proficiency with three skills of your choice.',
  },
  'savoir-mots-cinglants': {
    name: 'Cutting Words',
    description:
      "Also at 3rd level, you learn how to use your wit to distract, confuse, and otherwise sap the confidence and competence of others. When a creature that you can see within 60 feet of you makes an attack roll, an ability check, or a damage roll, you can use your reaction to expend one of your uses of Bardic Inspiration, rolling a Bardic Inspiration die and subtracting the number rolled from the creature's roll. You can choose to use this feature after the creature makes its roll, but before the DM determines whether the attack roll or ability check succeeds or fails, or before the creature deals its damage. The creature is immune if it can't hear you or if it's immune to being charmed.",
  },
  'savoir-secrets-magiques': {
    name: 'Additional Magical Secrets',
    description:
      "At 6th level, you learn two spells of your choice from any class. A spell you choose must be of a level you can cast, as shown on the Bard table, or a cantrip. The chosen spells count as bard spells for you but don't count against the number of bard spells you know.",
  },
  'savoir-competence-hors-pair': {
    name: 'Peerless Skill',
    description:
      'Starting at 14th level, when you make an ability check, you can expend one use of Bardic Inspiration. Roll a Bardic Inspiration die and add the number rolled to your ability check. You can choose to do so after you roll the die for the ability check, but before the DM tells you whether you succeed or fail.',
  },
  'vie-armures': {
    name: 'Bonus Proficiency',
    description: 'When you choose this domain at 1st level, you gain proficiency with heavy armor.',
  },
  'vie-disciple-de-la-vie': {
    name: 'Disciple of Life',
    description:
      "Also starting at 1st level, your healing spells are more effective. Whenever you use a spell of 1st level or higher to restore hit points to a creature, the creature regains additional hit points equal to 2 + the spell's level.",
  },
  'vie-conduit-preservation': {
    name: 'Channel Divinity: Preserve Life',
    description:
      "Starting at 2nd level, you can use your Channel Divinity to heal the badly injured.\n\nAs an action, you present your holy symbol and evoke healing energy that can restore a number of hit points equal to five times your cleric level. Choose any creatures within 30 feet of you, and divide those hit points among them. This feature can restore a creature to no more than half of its hit point maximum. You can't use this feature on an undead or a construct.",
  },
  'vie-guerisseur-beni': {
    name: 'Blessed Healer',
    description:
      "Beginning at 6th level, the healing spells you cast on others heal you as well. When you cast a spell of 1st level or higher that restores hit points to a creature other than you, you regain hit points equal to 2 + the spell's level.",
  },
  'vie-frappe-divine': {
    name: 'Divine Strike',
    description:
      'At 8th level, you gain the ability to infuse your weapon strikes with divine energy. Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 radiant damage to the target. When you reach 14th level, the extra damage increases to 2d8.',
  },
  'vie-guerison-supreme': {
    name: 'Supreme Healing',
    description:
      'Starting at 17th level, when you would normally roll one or more dice to restore hit points with a spell, you instead use the highest number possible for each die. For example, instead of restoring 2d6 hit points to a creature, you restore 12.',
  },
  'lumiere-sort-mineur': {
    name: 'Bonus Cantrip',
    description:
      "When you choose this domain at 1st level, you gain the light cantrip if you don't already know it. This cantrip doesn't count against the number of cleric cantrips you know.",
  },
  'lumiere-illumination-protectrice': {
    name: 'Warding Flare',
    description:
      "Also at 1st level, you can interpose divine light between yourself and an attacking enemy. When you are attacked by a creature within 30 feet of you that you can see, you can use your reaction to impose disadvantage on the attack roll, causing light to flare before the attacker before it hits or misses. An attacker that can't be blinded is immune to this feature.\n\nYou can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.",
  },
  'lumiere-conduit-radiance': {
    name: 'Channel Divinity: Radiance of the Dawn',
    description:
      'Starting at 2nd level, you can use your Channel Divinity to harness sunlight, banishing darkness and dealing radiant damage to your foes.\n\nAs an action, you present your holy symbol, and any magical darkness within 30 feet of you is dispelled. Additionally, each hostile creature within 30 feet of you must make a Constitution saving throw. A creature takes radiant damage equal to 2d10 + your cleric level on a failed saving throw, and half as much damage on a successful one. A creature that has Cover from you is not affected.',
  },
  'lumiere-illumination-amelioree': {
    name: 'Improved Flare',
    description:
      'Starting at 6th level, you can also use your Warding Flare feature when a creature that you can see within 30 feet of you attacks a creature other than you.',
  },
  'lumiere-incantation-puissante': {
    name: 'Potent Spellcasting',
    description:
      'Starting at 8th level, you add your Wisdom modifier to the damage you deal with any cleric cantrip.',
  },
  'lumiere-halo': {
    name: 'Corona of Light',
    description:
      'Starting at 17th level, you can use your action to activate an aura of sunlight that lasts for 1 minute or until you dismiss it using another action. You emit bright light in a 60-foot radius and dim light 30 feet beyond that. Your enemies in the bright light have disadvantage on saving throws against any spell that deals fire or radiant damage.',
  },
  'nature-acolyte': {
    name: 'Acolyte of Nature',
    description:
      "At 1st level, you learn one druid cantrip of your choice. This cantrip doesn't count against the number of cleric cantrips you know. You also gain proficiency in one of the following skills of your choice: Animal Handling, Nature, or Survival.",
  },
  'nature-armures': {
    name: 'Bonus Proficiency',
    description: 'Also at 1st level, you gain proficiency with heavy armor.',
  },
  'nature-conduit-charme': {
    name: 'Channel Divinity: Charm Animals and Plants',
    description:
      'Starting at 2nd level, you can use your Channel Divinity to charm animals and plants.\n\nAs an action, you present your holy symbol and invoke the name of your deity. Each beast or plant creature that can see you within 30 feet of you must make a Wisdom saving throw. If the creature fails its saving throw, it is charmed by you for 1 minute or until it takes damage. While it is charmed by you, it is friendly to you and other creatures you designate.',
  },
  'nature-attenuation-elements': {
    name: 'Dampen Elements',
    description:
      'Starting at 6th level, when you or a creature within 30 feet of you takes acid, cold, fire, lightning, or thunder damage, you can use your reaction to grant resistance to the creature against that instance of the damage.',
  },
  'nature-frappe-divine': {
    name: 'Divine Strike',
    description:
      'At 8th level, you gain the ability to infuse your weapon strikes with divine energy. Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 cold, fire, or lightning damage (your choice) to the target. When you reach 14th level, the extra damage increases to 2d8.',
  },
  'nature-maitre': {
    name: 'Master of Nature',
    description:
      'At 17th level, you gain the ability to command animals and plant creatures. While creatures are charmed by your Charm Animals and Plants feature, you can take a bonus action on your turn to verbally command what each of those creatures will do on its next turn.',
  },
  'tempete-maitrises': {
    name: 'Bonus Proficiencies',
    description: 'At 1st level, you gain proficiency with martial weapons and heavy armor.',
  },
  'tempete-fureur-ouragan': {
    name: 'Wrath of the Storm',
    description:
      'Also at 1st level, you can thunderously rebuke attackers. When a creature within 5 feet of you that you can see hits you with an attack, you can use your reaction to cause the creature to make a Dexterity saving throw. The creature takes 2d8 lightning or thunder damage (your choice) on a failed saving throw, and half as much damage on a successful one.\n\nYou can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.',
  },
  'tempete-conduit-fureur-destructrice': {
    name: 'Channel Divinity: Destructive Wrath',
    description:
      'Starting at 2nd level, you can use your Channel Divinity to wield the power of the storm with unchecked ferocity.\n\nWhen you roll lightning or thunder damage, you can use your Channel Divinity to deal maximum damage, instead of rolling.',
  },
  'tempete-frappe-eclair': {
    name: 'Thunderbolt Strike',
    description:
      'At 6th level, when you deal lightning damage to a Large or smaller creature, you can also push it up to 10 feet away from you.',
  },
  'tempete-frappe-divine': {
    name: 'Divine Strike',
    description:
      'At 8th level, you gain the ability to infuse your weapon strikes with divine energy. Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 thunder damage to the target. When you reach 14th level, the extra damage increases to 2d8.',
  },
  'tempete-enfant': {
    name: 'Stormborn',
    description:
      'At 17th level, you have a flying speed equal to your current walking speed whenever you are not underground or indoors.',
  },
  'tromperie-benediction-escroc': {
    name: 'Blessing of the Trickster',
    description:
      'Starting when you choose this domain at 1st level, you can use your action to touch a willing creature other than yourself to give it advantage on Dexterity (Stealth) checks. This blessing lasts for 1 hour or until you use this feature again.',
  },
  'tromperie-conduit-replique': {
    name: 'Channel Divinity: Invoke Duplicity',
    description:
      "Starting at 2nd level, you can use your Channel Divinity to create an illusory duplicate of yourself.\n\nAs an action, you create a perfect illusion of yourself that lasts for 1 minute, or until you lose your concentration (as if you were concentration on a spell). The illusion appears in an unoccupied space that you can see within 30 feet of you. As a bonus action on your turn, you can move the illusion up to 30 feet to a space you can see, but it must remain within 120 feet of you.\n\nFor the duration, you can cast spells as though you were in the illusion's space, but you must use your own senses. Additionally, when both you and your illusion are within 5 feet of a creature that can see the illusion, you have advantage on attack rolls against that creature, given how distracting the illusion is to the target.",
  },
  'tromperie-conduit-linceul': {
    name: 'Channel Divinity: Cloak of Shadows',
    description:
      'Starting at 6th level, you can use your Channel Divinity to vanish.\n\nAs an action, you become invisible until the end of your next turn. You become visible if you attack or cast a spell.',
  },
  'tromperie-frappe-divine': {
    name: 'Divine Strike',
    description:
      'At 8th level, you gain the ability to infuse your weapon strikes with poison—a gift from your deity. Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 poison damage to the target. When you reach 14th level, the extra damage increases to 2d8.',
  },
  'tromperie-replique-amelioree': {
    name: 'Improved Duplicity',
    description:
      'At 17th level, you can create up to four duplicates of yourself, instead of one, when you use Invoke Duplicity. As a bonus action on your turn, you can move any number of them up to 30 feet, to a maximum range of 120 feet.',
  },
  'guerre-maitrises': {
    name: 'Bonus Proficiencies',
    description: 'At 1st level, you gain proficiency with martial weapons and heavy armor.',
  },
  'guerre-pretre-de-guerre': {
    name: 'War Priest',
    description:
      'From 1st level, your god delivers bolts of inspiration to you while you are engaged in battle. When you use the Attack action, you can make one weapon attack as a bonus action. You can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.',
  },
  'guerre-conduit-frappe-guidee': {
    name: 'Channel Divinity: Guided Strike',
    description:
      'Starting at 2nd level, you can use your Channel Divinity to strike with supernatural accuracy. When you make an attack roll, you can use your Channel Divinity to gain a +10 bonus to the roll. You make this choice after you see the roll, but before the DM says whether the attack hits or misses.',
  },
  'guerre-conduit-benediction': {
    name: "Channel Divinity: War God's Blessing",
    description:
      'At 6th level, when a creature within 30 feet of you makes an attack roll, you can use your reaction to grant that creature a +10 bonus to the roll, using your Channel Divinity. You make this choice after you see the roll, but before the DM says whether the attack hits or misses.',
  },
  'guerre-frappe-divine': {
    name: 'Divine Strike',
    description:
      'At 8th level, you gain the ability to infuse your weapon strikes with divine energy. Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 damage of the same type dealt by the weapon to the target. When you reach 14th level, the extra damage increases to 2d8.',
  },
  'guerre-avatar': {
    name: 'Avatar of Battle',
    description:
      'At 17th level, you gain resistance to bludgeoning, piercing, and slashing damage from nonmagical attacks.',
  },
  'savoir-benedictions': {
    name: 'Blessings of Knowledge',
    description:
      'At 1st level, you learn two languages of your choice. You also become proficient in your choice of two of the following skills: Arcana, History, Nature, or Religion.\n\nYour proficiency bonus is doubled for any ability check you make that uses either of those skills.',
  },
  'savoir-conduit-ancestral': {
    name: 'Channel Divinity: Knowledge of the Ages',
    description:
      'Starting at 2nd level, you can use your Channel Divinity to tap into a divine well of knowledge. As an action, you choose one skill or tool. For 10 minutes, you have proficiency with the chosen skill or tool.',
  },
  'savoir-conduit-lecture-pensees': {
    name: 'Channel Divinity: Read Thoughts',
    description:
      "At 6th level, you can use your Channel Divinity to read a creature's thoughts. You can then use your access to the creature's mind to command it.\n\nAs an action, choose one creature that you can see within 60 feet of you. That creature must make a Wisdom saving throw. If the creature succeeds on the saving throw, you can't use this feature on it again until you finish a long rest.\n\nIf the creature fails its save, you can read its surface thoughts (those foremost in its mind, reflecting its current emotions and what it is actively thinking about) when it is within 60 feet of you. This effect lasts for 1 minute.\n\nDuring that time, you can use your action to end this effect and cast the suggestion spell on the creature without expending a spell slot. The target automatically fails its saving throw against the spell.",
  },
  'savoir-incantation-puissante': {
    name: 'Potent Spellcasting',
    description:
      'Starting at 8th level, you add your Wisdom modifier to the damage you deal with any cleric cantrip.',
  },
  'savoir-visions-du-passe': {
    name: 'Visions of the Past',
    description:
      "Starting at 17th level, you can call up visions of the past that relate to an object you hold or your immediate surroundings. You spend at least 1 minute in meditation and prayer, then receive dreamlike, shadowy glimpses of recent events. You can meditate in this way for a number of minutes equal to your Wisdom score and must maintain concentration during that time, as if you were casting a spell.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.\n\nObject Reading.\nHolding an object as you meditate, you can see visions of the object's previous owner. After meditating for 1 minute, you learn how the owner acquired and lost the object, as well as the most recent significant event involving the object and that owner. If the object was owned by another creature in the recent past (within a number of days equal to your Wisdom score), you can spend 1 additional minute for each owner to learn the same information about that creature.\n\nArea Reading.\nAs you meditate, you see visions of recent events in your immediate vicinity (a room, street, tunnel, clearing, or the like, up to a 50-foot cube), going back a number of days equal to your Wisdom score. For each minute you meditate, you learn about one significant event, beginning with the most recent. Significant events typically involve powerful emotions, such as battles and betrayals, marriages and murders, births and funerals. However, they might also include more mundane events that are nevertheless important in your current situation.",
  },
  'terre-sort-mineur-supplementaire': {
    name: 'Bonus Cantrip',
    description:
      "You learn one additional druid cantrip of your choice. This cantrip doesn't count against the number of druid cantrips you know.",
  },
  'terre-recuperation-naturelle': {
    name: 'Natural Recovery',
    description:
      "Starting at 2nd level, you can regain some of your magical energy by sitting in meditation and communing with nature. During a short rest, you choose expended spell slots to recover. The spell slots can have a combined level that is equal to or less than half your druid level (rounded up), and none of the slots can be 6th level or higher. You can't use this feature again until you finish a long rest.\n\nFor example, when you are a 4th-level druid, you can recover up to two levels worth of spell slots. You can recover either a 2nd-level slot or two 1st-level slots.",
  },
  'terre-foulee-tellurique': {
    name: "Land's Stride",
    description:
      'Starting at 6th level, moving through nonmagical difficult terrain costs you no extra movement. You can also pass through nonmagical plants without being slowed by them and without taking damage from them if they have thorns, spines, or a similar hazard.\n\nIn addition, you have advantage on saving throws against plants that are magically created or manipulated to impede movement, such as those created by the entangle spell.',
  },
  'terre-protege-dame-nature': {
    name: "Nature's Ward",
    description:
      "When you reach 10th level, you can't be charmed or frightened by elementals or fey, and you are immune to poison and disease.",
  },
  'terre-sanctuaire-nature': {
    name: "Nature's Sanctuary",
    description:
      'When you reach 14th level, creatures of the natural world sense your connection to nature and become hesitant to attack you. When a beast or plant creature attacks you, that creature must make a Wisdom saving throw against your druid spell save DC. On a failed save, the creature must choose a different target, or the attack automatically misses. On a successful save, the creature is immune to this effect for 24 hours.\n\nThe creature is aware of this effect before it makes its attack against you.',
  },
  'lune-forme-sauvage-combative': {
    name: 'Combat Wild Shape',
    description:
      'You gain the ability to use Wild Shape on your turn as a bonus action, rather than as an action.\n\nAdditionally, while you are transformed by Wild Shape, you can use a bonus action to expend one spell slot to regain 1d8 hit points per level of the spell slot expended.',
  },
  'lune-formes-du-cercle': {
    name: 'Circle Forms',
    description:
      'The rites of your circle grant you the ability to transform into more dangerous animal forms. Starting at 2nd level, you can use your Wild Shape to transform into a beast with a challenge rating as high as 1 (you ignore the Max. CR column of the Beast Shapes table, but must abide by the other limitations there).\n\nStarting at 6th level, you can transform into a beast with a challenge rating as high as your druid level divided by 3, rounded down.\n\nLevel | Max. CR | Limitations\n--- | ---- | ------\n2nd | 1 | No flying or swimming speed\n4th | 1 | No flying speed\n6th | 2 | No flying speed\n8th | 2 | —\n9th | 3 | —\n12th | 4 | —\n15th | 5 | —\n18th | 6 | —',
  },
  'lune-frappe-primordiale': {
    name: 'Primal Strike',
    description:
      'Starting at 6th level, your attacks in beast form count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.',
  },
  'lune-forme-elementaire': {
    name: 'Elemental Wild Shape',
    description:
      'At 10th level, you can expend two uses of Wild Shape at the same time to transform into an air elemental, an earth elemental, a fire elemental, or a water elemental.',
  },
  'lune-mille-formes': {
    name: 'Thousand Forms',
    description:
      'By 14th level, you have learned to use magic to alter your physical form in more subtle ways. You can cast the alter self spell at will.',
  },
  'draconique-ancetre-draconique': {
    name: 'Dragon Ancestor',
    description:
      'At 1st level, you choose one type of dragon as your ancestor. The damage type associated with each dragon is used by features you gain later.\n\nDragon | Damage Type\n---- | ------\nBlack | Acid\nBlue | Lightning\nBrass | Fire\nBronze | Lightning\nCopper | Acid\nGold | Fire\nGreen | Poison\nRed | Fire\nSilver | Cold\nWhite | Cold\n\nYou can speak, read, and write Draconic. Additionally, whenever you make a Charisma check when interacting with dragons, your proficiency bonus is doubled if it applies to the check.',
  },
  'draconique-resilience': {
    name: 'Draconic Resilience',
    description:
      "As magic flows through your body, it causes physical traits of your dragon ancestors to emerge. At 1st level, your hit point maximum increases by 1 and increases by 1 again whenever you gain a level in this class.\n\nAdditionally, parts of your skin are covered by a thin sheen of dragon-like scales. When you aren't wearing armor, your AC equals 13 + your Dexterity modifier.",
  },
  'draconique-affinite-elementaire': {
    name: 'Elemental Affinity',
    description:
      'Starting at 6th level, when you cast a spell that deals damage of the type associated with your draconic ancestry, you can add your Charisma modifier to one damage roll of that spell. At the same time, you can spend 1 sorcery point to gain resistance to that damage type for 1 hour.',
  },
  'draconique-ailes': {
    name: 'Dragon Wings',
    description:
      "At 14th level, you gain the ability to sprout a pair of dragon wings from your back, gaining a flying speed equal to your current speed. You can create these wings as a bonus action on your turn. They last until you dismiss them as a bonus action on your turn.\n\nYou can't manifest your wings while wearing armor unless the armor is made to accommodate them, and clothing not made to accommodate your wings might be destroyed when you manifest them.",
  },
  'draconique-presence': {
    name: 'Draconic Presence',
    description:
      'Beginning at 18th level, you can channel the dread presence of your dragon ancestor, causing those around you to become awestruck or frightened. As an action, you can spend 5 sorcery points to draw on this power and exude an aura of awe or fear (your choice) to a distance of 60 feet. For 1 minute or until you lose your concentration (as if you were casting a concentration spell), each hostile creature that starts its turn in this aura must succeed on a Wisdom saving throw or be charmed (if you chose awe) or frightened (if you chose fear) until the aura ends. A creature that succeeds on this saving throw is immune to your aura for 24 hours.',
  },
  'sauvage-pic-magie': {
    name: 'Wild Magic Surge',
    description:
      "Starting when you choose this origin at 1st level, your spellcasting can unleash surges of untamed magic. Immediately after you cast a sorcerer spell of 1st level or higher, the DM can have you roll a d20. If you roll a 1, roll on the Wild Magic Surge table to create a random magical effect. A Wild Magic Surge can happen once per turn.\n\nIf a Wild Magic effect is a spell, it's too wild to be affected by Metamagic. If it normally requires concentration, it doesn't require concentration in this case; the spell lasts for its full duration.\n\nd100 | Effect\n--- | ----\n01-02 | Roll on this table at the start of each of your turns for the next minute, ignoring this result on subsequent rolls.\n03-04 | For the next minute, you can see any invisible creature if you have line of sight to it.\n05-06 | A modron chosen and controlled by the DM appears in an unoccupied space within 5 feet of you, then disappears 1 minute later.\n07-08 | You cast fireball as a 3rd-level spell centered on yourself.\n09-10 | You cast magic missile as a 5th-level spell.\n11-12 | Roll a d10. Your height changes by a number of inches equal to the roll. If the roll is odd, you shrink. If the roll is even, you grow.\n13-14 | You cast confusion centered on yourself.\n15-16 | For the next minute, you regain 5 hit points at the start of each of your turns.\n17-18 | You grow a long beard made of feathers that remains until you sneeze, at which point the feathers explode out from your face.\n19-20 | You cast grease centered on yourself.\n21-22 | Creatures have disadvantage on saving throws against the next spell you cast in the next minute that involves a saving throw.\n23-24 | Your skin turns a vibrant shade of blue. A remove curse spell can end this effect.\n25-26 | An eye appears on your forehead for the next minute. During that time, you have advantage on Wisdom (Perception) checks that rely on sight.\n27-28 | For the next minute, all your spells with a casting time of 1 action have a casting time of 1 bonus action.\n29-30 | You teleport up to 60 feet to an unoccupied space of your choice that you can see.\n31-32 | You are transported to the Astral Plane until the end of your next turn, after which time you return to the space you previously occupied or the nearest unoccupied space if that space is occupied.\n33-34 | Maximize the damage of the next damaging spell you cast within the next minute.\n35-36 | Roll a d10. Your age changes by a number of years equal to the roll. If the roll is odd, you get younger (minimum 1 year old). If the roll is even, you get older.\n37-38 | 1d6 flumph controlled by the DM appear in unoccupied spaces within 60 feet of you and are frightened of you. They vanish after 1 minute.\n39-40 | You regain 2d10 hit points.\n41-42 | You turn into a potted plant until the start of your next turn. While a plant, you are incapacitated and have vulnerability to all damage. If you drop to 0 hit points, your pot breaks, and your form reverts.\n43-44 | For the next minute, you can teleport up to 20 feet as a bonus action on each of your turns.\n45-46 | You cast levitate on yourself.\n47-48 | A unicorn controlled by the DM appears in a space within 5 feet of you, then disappears 1 minute later.\n49-50 | You can't speak for the next minute. Whenever you try, pink bubbles float out of your mouth.\n51-52 | A spectral shield hovers near you for the next minute, granting you a +2 bonus to AC and immunity to magic missile.\n53-54 | You are immune to being intoxicated by alcohol for the next 5d6 days.\n55-56 | Your hair falls out but grows back within 24 hours.\n57-58 | For the next minute, any flammable object you touch that isn't being worn or carried by another creature bursts into flame.\n59-60 | You regain your lowest-level expended spell slot.\n61-62 | For the next minute, you must shout when you speak.\n63-64 | You cast fog cloud centered on yourself.\n65-66 | Up to three creatures you choose within 30 feet of you take 4d10 lightning damage.\n67-68 | You are frightened by the nearest creature until the end of your next turn.\n69-70 | Each creature within 30 feet of you becomes invisible for the next minute. The invisibility ends on a creature when it attacks or casts a spell.\n71-72 | You gain resistance to all damage for the next minute.\n73-74 | A random creature within 60 feet of you becomes poisoned for 1d4 hours.\n75-76 | You glow with bright light in a 30-foot radius for the next minute. Any creature that ends its turn within 5 feet of you is blinded until the end of its next turn.\n77-78 | You cast polymorph on yourself. If you fail the saving throw, you turn into a sheep for the spell's duration.\n79-80 | Illusory butterflies and flower petals flutter in the air within 10 feet of you for the next minute.\n81-82 | You can take one additional action immediately.\n83-84 | Each creature within 30 feet of you takes 1d10 necrotic damage. You regain hit points equal to the sum of the necrotic damage dealt.\n85-86 | You cast mirror image.\n87-88 | You cast fly on a random creature within 60 feet of you.\n89-90 | You become invisible for the next minute. During that time, other creatures can't hear you. The invisibility ends if you attack or cast a spell.\n91-92 | If you die within the next minute, you immediately come back to life as if by the reincarnate spell.\n93-94 | Your size increases by one size category for the next minute.\n95-96 | You and all creatures within 30 feet of you gain vulnerability to piercing damage for the next minute.\n97-98 | You are surrounded by faint, ethereal music for the next minute.\n99-00 | You regain all expended sorcery points.",
  },
  'sauvage-maree-du-chaos': {
    name: 'Tides of Chaos',
    description:
      'Starting at 1st level, you can manipulate the forces of chance and chaos to gain advantage on one attack roll, ability check, or saving throw. Once you do so, you must finish a long rest before you can use this feature again.\n\nAny time before you regain the use of this feature, the DM can have you roll on the Wild Magic Surge table immediately after you cast a sorcerer spell of 1st level or higher. You then regain the use of this feature.',
  },
  'sauvage-chance-forcée': {
    name: 'Bend Luck',
    description:
      "Starting at 6th level, you have the ability to twist fate using your wild magic. When another creature you can see makes an attack roll, an ability check, or a saving throw, you can use your reaction and spend 2 sorcery points to roll 1d4 and apply the number rolled as a bonus or penalty (your choice) to the creature's roll. You can do so after the creature rolls but before any effects of the roll occur.",
  },
  'sauvage-chaos-controle': {
    name: 'Controlled Chaos',
    description:
      'At 14th level, you gain a modicum of control over the surges of your wild magic. Whenever you roll on the Wild Magic Surge table, you can roll twice and use either number.',
  },
  'sauvage-bombardement': {
    name: 'Spell Bombardment',
    description:
      'Beginning at 18th level, the harmful energy of your spells intensifies. When you roll damage for a spell and roll the highest number possible on any of the dice, choose one of those dice, roll it again and add that roll to the damage. You can use the feature only once per turn.',
  },
  'champion-critique-ameliore': {
    name: 'Improved Critical',
    description:
      'Beginning when you choose this archetype at 3rd level, your weapon attacks score a critical hit on a roll of 19 or 20.',
  },
  'champion-athlete': {
    name: 'Remarkable Athlete',
    description:
      "Starting at 7th level, you can add half your proficiency bonus (round up) to any Strength, Dexterity, or Constitution check you make that doesn't already use your proficiency bonus.\n\nIn addition, when you make a running long jump, the distance you can cover increases by a number of feet equal to your Strength modifier.",
  },
  'champion-style-supplementaire': {
    name: 'Additional Fighting Style',
    description:
      'At 10th level, you can choose a second option from the Fighting Style class feature.',
  },
  'champion-critique-superieur': {
    name: 'Superior Critical',
    description:
      'Starting at 15th level, your weapon attacks score a critical hit on a roll of 18-20.',
  },
  'champion-survivant': {
    name: 'Survivor',
    description:
      "At 18th level, you attain the pinnacle of resilience in battle. At the start of each of your turns, you regain hit points equal to 5 + your Constitution modifier if you have no more than half of your hit points left. You don't gain this benefit if you have 0 hit points.",
  },
  'maitre-guerre-disciple-martial': {
    name: 'Student of War',
    description:
      "At 3rd level, you gain proficiency with one type of artisan's tools of your choice.",
  },
  'maitre-guerre-superiorite-martial': {
    name: 'Combat Superiority',
    description:
      'When you choose this archetype at 3rd level, you learn maneuvers that are fueled by special dice called superiority dice.\n\nManeuvers.\nYou learn three maneuvers of your choice, which are listed under "Maneuvers" below. Many maneuvers enhance an attack in some way. You can use only one maneuver per attack.\n\nYou learn two additional maneuvers of your choice at 7th, 10th, and 15th level. Each time you learn new maneuvers, you can also replace one maneuver you know with a different one.\n\nSuperiority Dice.\nYou have four superiority dice, which are d8s. A superiority die is expended when you use it. You regain all of your expended superiority dice when you finish a short or long rest.\n\nYou gain another superiority die at 7th level and one more at 15th level.\n\nSaving Throws.\nSome of your maneuvers require your target to make a saving throw to resist the maneuver\'s effects. The saving throw DC is calculated as follows:\n\nSpell save DC = 8 + proficiency + $',
  },
  'maitre-guerre-observation-ennemi': {
    name: 'Know Your Enemy',
    description:
      'If you spend at least 1 minute observing or interacting with another creature outside combat, you can learn certain information about its capabilities compared to your own. The DM tells you if the creature is your equal, superior, or inferior in regard to two of the following characteristics of your choice:\n\n- Strength score\n- Dexterity score\n- Constitution score\n- Armor Class\n- Current hit points\n- Total class levels (if any)\n- Fighter class levels (if any)',
  },
  'maitre-guerre-superiorite-amelioree': {
    name: 'Improved Combat Superiority (d10)',
    description: 'At 10th level, your superiority dice turn into d10s.',
  },
  'maitre-guerre-implacable': {
    name: 'Relentless',
    description:
      'Starting at 15th level, when you roll initiative and have no superiority dice remaining, you regain 1 superiority die.',
  },
  'chevalier-occulte-incantation': {
    name: 'Spellcasting',
    description:
      "When you reach 3rd level, you augment your martial prowess with the ability to cast spells. See chapter 10 for the general rules of spellcasting and chapter 11 for the wizard spell list.\n\nCantrips.\nYou learn two cantrips of your choice from the wizard spell list. You learn an additional wizard cantrip of your choice at 10th level.\n\nSpell Slots.\nThe Eldritch Knight Spellcasting table shows how many spell slots you have to cast your wizard spells of 1st level and higher. To cast one of these spells, you must expend a slot of the spell's level or higher. You regain all expended spell slots when you finish a long rest.\n\nFor example, if you know the 1st-level spell shield and have a 1st-level and a 2nd-level spell slot available, you can cast shield using either slot.\n\nSpells Known of 1st-Level and Higher.\nYou know three 1st-level wizard spells of your choice, two of which you must choose from the abjuration and evocation spells on the wizard spell list.\n\nThe Spells Known column of the Eldritch Knight Spellcasting table shows when you learn more wizard spells of 1st level or higher. Each of these spells must be an abjuration or evocation spell of your choice, and must be of a level for which you have spell slots. For instance, when you reach 7th level in this class, you can learn one new spell of 1st or 2nd level.\n\nThe spells you learn at 8th, 14th, and 20th level can come from any school of magic.\n\nWhenever you gain a level in this class, you can replace one of the wizard spells you know with another spell of your choice from the wizard spell list. The new spell must be of a level for which you have spell slots, and it must be an abjuration or evocation spell, unless you're replacing the spell you gained at 3rd, 8th, 14th, or 20th level from any school of magic.\n\nSpellcasting Ability.\nIntelligence is your spellcasting ability for your wizard spells, since you learn your spells through study and memorization. You use your Intelligence whenever a spell refers to your spellcasting ability. In addition, you use your Intelligence modifier when setting the saving throw DC for a wizard spell you cast and when making an attack roll with one.\n\nSpell save DC = 8 + proficiency + $",
  },
  'chevalier-occulte-lien-arme': {
    name: 'Weapon Bond',
    description:
      "At 3rd level, you learn a ritual that creates a magical bond between yourself and one weapon. You perform the ritual over the course of 1 hour, which can be done during a short rest. The weapon must be within your reach throughout the ritual, at the conclusion of which you touch the weapon and forge the bond.\n\nOnce you have bonded a weapon to yourself, you can't be disarmed of that weapon unless you are incapacitated. If it is on the same plane of existence, you can summon that weapon as a bonus action on your turn, causing it to teleport instantly to your hand.\n\nYou can have up to two bonded weapons, but can summon only one at a time with your bonus action. If you attempt to bond with a third weapon, you must break the bond with one of the other two.",
  },
  'chevalier-occulte-magie-de-guerre': {
    name: 'War Magic',
    description:
      'Beginning at 7th level, when you use your action to cast a cantrip, you can make one weapon attack as a bonus action.',
  },
  'chevalier-occulte-frappe-occulte': {
    name: 'Eldritch Strike',
    description:
      "At 10th level, you learn how to make your weapon strikes undercut a creature's resistance to your spells. When you hit a creature with a weapon attack, that creature has disadvantage on the next saving throw it makes against a spell you cast before the end of your next turn.",
  },
  'chevalier-occulte-charge-arcanique': {
    name: 'Arcane Charge',
    description:
      'At 15th level, you gain the ability to teleport up to 30 feet to an unoccupied space you can see when you use your Action Surge. You can teleport before or after the additional action.',
  },
  'chevalier-occulte-magie-de-guerre-amelioree': {
    name: 'Improved War Magic',
    description:
      'Starting at 18th level, when you use your action to cast a spell, you can make one weapon attack as a bonus action.',
  },
  'abjuration-abjurateur-erudit': {
    name: 'Abjuration Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an abjuration spell into your spellbook is halved.',
  },
  'abjuration-protection-arcanique': {
    name: 'Arcane Ward',
    description:
      "Starting at 2nd level, you can weave magic around yourself for protection. When you cast an abjuration spell of 1st level or higher, you can simultaneously use a strand of the spell's magic to create a magical ward on yourself that lasts until you finish a long rest. The ward has a hit point maximum equal to twice your wizard level + your Intelligence modifier. Whenever you take damage, the ward takes the damage instead. If this damage reduces the ward to 0 hit points, you take any remaining damage.\n\nWhile the ward has 0 hit points, it can't absorb damage, but its magic remains. Whenever you cast an abjuration spell of 1st level or higher, the ward regains a number of hit points equal to twice the level of the spell.\n\nOnce you create the ward, you can't create it again until you finish a long rest.",
  },
  'abjuration-protection-projetee': {
    name: 'Projected Ward',
    description:
      'Starting at 6th level, when a creature that you can see within 30 feet of you takes damage, you can use your reaction to cause your Arcane Ward to absorb that damage. If this damage reduces the ward to 0 hit points, the warded creature takes any remaining damage.',
  },
  'abjuration-abjuration-amelioree': {
    name: 'Improved Abjuration',
    description:
      'Beginning at 10th level, when you cast an abjuration spell that requires you to make an ability check as a part of casting that spell (as in counterspell and dispel magic), you add your proficiency bonus to that ability check.',
  },
  'abjuration-resistance-aux-sorts': {
    name: 'Spell Resistance',
    description:
      'Starting at 14th level, you have advantage on saving throws against spells.\n\nFurthermore, you have resistance against the damage of spells.',
  },
  'evocation-evocateur-erudit': {
    name: 'Evocation Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an evocation spell into your spellbook is halved.',
  },
  'evocation-faconneur-de-sorts': {
    name: 'Sculpt Spells',
    description:
      "Beginning at 2nd level, you can create pockets of relative safety within the effects of your evocation spells. When you cast an evocation spell that affects other creatures that you can see, you can choose a number of them equal to 1 + the spell's level. The chosen creatures automatically succeed on their saving throws against the spell, and they take no damage if they would normally take half damage on a successful save.",
  },
  'evocation-sort-mineur-puissant': {
    name: 'Potent Cantrip',
    description:
      "Starting at 6th level, your damaging cantrips affect even creatures that avoid the brunt of the effect. When a creature succeeds on a saving throw against your cantrip, the creature takes half the cantrip's damage (if any) but suffers no additional effect from the cantrip.",
  },
  'evocation-evocation-amelioree': {
    name: 'Empowered Evocation',
    description:
      'Beginning at 10th level, you can add your Intelligence modifier to one damage roll of any wizard evocation spell you cast.',
  },
  'evocation-surcharge-magique': {
    name: 'Overchannel',
    description:
      'Starting at 14th level, you can increase the power of your simpler spells. When you cast a wizard spell of 1st through 5th-level that deals damage, you can deal maximum damage with that spell.\n\nThe first time you do so, you suffer no adverse effect. If you use this feature again before you finish a long rest, you take 2d12 necrotic damage for each level of the spell, immediately after you cast it. Each time you use this feature again before finishing a long rest, the necrotic damage per spell level increases by 1d12. This damage ignores resistance and immunity.',
  },
  'divination-devin-erudit': {
    name: 'Divination Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy a divination spell into your spellbook is halved.',
  },
  'divination-presage': {
    name: 'Portent',
    description:
      'Starting at 2nd level when you choose this school, glimpses of the future begin to press in on your awareness. When you finish a long rest, roll two d20s and record the numbers rolled. You can replace any attack roll, saving throw, or ability check made by you or a creature that you can see with one of these foretelling rolls. You must choose to do so before the roll, and you can replace a roll in this way only once per turn.\n\nEach foretelling roll can be used only once. When you finish a long rest, you lose any unused foretelling rolls.',
  },
  'divination-divination-experte': {
    name: 'Expert Divination',
    description:
      "Beginning at 6th level, casting divination spells comes so easily to you that it expends only a fraction of your spellcasting efforts. When you cast a divination spell of 2nd level or higher using a spell slot, you regain one expended spell slot. The slot you regain must be of a level lower than the spell you cast and can't be higher than 5th level.",
  },
  'divination-troisieme-oeil': {
    name: 'The Third Eye',
    description:
      "Starting at 10th level, you can use your action to increase your powers of perception. When you do so, choose one of the following benefits, which lasts until you are incapacitated or you take a short or long rest. You can't use the feature again until you finish a rest.\n\nDarkvision.\nYou gain darkvision out to a range of 60 feet.\n\nEthereal Sight.\nYou can see into the Ethereal Plane within 60 feet of you.\n\nGreater Comprehension.\nYou can read any language.\n\nSee Invisibility.\nYou can see invisible creatures and objects within 10 feet of you that are within line of sight.",
  },
  'divination-presage-superieur': {
    name: 'Greater Portent',
    description:
      'Starting at 14th level, the visions in your dreams intensify and paint a more accurate picture in your mind of what is to come. You roll three d20s for your Portent feature, rather than two.',
  },
  'enchantement-enchanteur-erudit': {
    name: 'Enchantment Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an enchantment spell into your spellbook is halved.',
  },
  'enchantement-regard-hypnotique': {
    name: 'Hypnotic Gaze',
    description:
      "Starting at 2nd level when you choose this school, your soft words and enchanting gaze can magically enthrall another creature. As an action, choose one creature that you can see within 5 feet of you. If the target can see or hear you, it must succeed on a Wisdom saving throw against your wizard spell save DC or be charmed by you until the end of your next turn. The charmed creature's speed drops to 0, and the creature is incapacitated and visibly dazed.\n\nOn subsequent turns, you can use your action to maintain this effect, extending its duration until the end of your next turn. However, the effect ends if you move more than 5 feet away from the creature, if the creature can neither see nor hear you, or if the creature takes damage.\n\nOnce the effect ends, or if the creature succeeds on its initial saving throw against this effect, you can't use this feature on that creature again until you finish a long rest.",
  },
  'enchantement-charme-instinctif': {
    name: 'Instinctive Charm',
    description:
      "Beginning at 6th level, when a creature you can see within 30 feet of you makes an attack roll against you, you can use your reaction to divert the attack, provided that another creature is within the attack's range. The attacker must make a Wisdom saving throw against your wizard spell save DC. On a failed save, the attacker must target the creature that is closest to it, not including you or itself. If multiple creatures are closest, the attacker chooses which one to target. On a successful save, you can't use this feature on the attacker again until you finish a long rest.\n\nYou must choose to use this feature before knowing whether the attack hits or misses. Creatures that can't be charmed are immune to this effect.",
  },
  'enchantement-partage': {
    name: 'Split Enchantment',
    description:
      'Starting at 10th level, when you cast an enchantment spell of 1st level or higher that targets only one creature, you can have it target a second creature.',
  },
  'enchantement-alteration-memorielle': {
    name: 'Alter Memories',
    description:
      "At 14th level, you gain the ability to make a creature unaware of your magical influence on it. When you cast an enchantment spell to charm one or more creatures, you can alter one creature's understanding so that it remains unaware of being charmed.\n\nAdditionally, once before the spell expires, you can use your action to try to make the chosen creature forget some of the time it spent charmed. The creature must succeed on an Intelligence saving throw against your wizard spell save DC or lose a number of hours of its memories equal to 1 + your Charisma modifier (minimum of 1). You can make the creature forget less time, and the amount of time can't exceed the duration of your enchantment spell.",
  },
  'illusion-illusionniste-erudit': {
    name: 'Illusion Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an illusion spell into your spellbook is halved.',
  },
  'illusion-illusion-mineure-amelioree': {
    name: 'Improved Minor Illusion',
    description:
      "When you choose this school at 2nd level, you learn the minor illusion cantrip. If you already know this cantrip, you learn a different wizard cantrip of your choice. The cantrip doesn't count against your number of cantrips known.\n\nWhen you cast minor illusion, you can create both a sound and an image with a single casting of the spell.",
  },
  'illusion-illusions-malleables': {
    name: 'Malleable Illusions',
    description:
      "Starting at 6th level, when you cast an illusion spell that has a duration of 1 minute or longer, you can use your action to change the nature of that illusion (using the spell's normal parameters for the illusion), provided that you can see the illusion.",
  },
  'illusion-double-illusoire': {
    name: 'Illusory Self',
    description:
      "Beginning at 10th level, you can create an illusory duplicate of yourself as an instant, almost instinctual reaction to danger. When a creature makes an attack roll against you, you can use your reaction to interpose the illusory duplicate between the attacker and yourself. The attack automatically misses you, then the illusion dissipates.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.",
  },
  'illusion-realite-illusoire': {
    name: 'Illusory Reality',
    description:
      "By 14th level, you have learned the secret of weaving shadow magic into your illusions to give them a semi-reality. When you cast an illusion spell of 1st level or higher, you can choose one inanimate, nonmagical object that is part of the illusion and make that object real. You can do this on your turn as a bonus action while the spell is ongoing. The object remains real for 1 minute. For example, you can create an illusion of a bridge over a chasm and then make it real long enough for your allies to cross.\n\nThe object can't deal damage or otherwise directly harm anyone.",
  },
  'invocation-invocateur-erudit': {
    name: 'Conjuration Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy a conjuration spell into your spellbook is halved.',
  },
  'invocation-invocation-mineure': {
    name: 'Minor Conjuration',
    description:
      'Starting at 2nd level when you select this school, you can use your action to conjure up an inanimate object in your hand or on the ground in an unoccupied space that you can see within 10 feet of you. This object can be no larger than 3 feet on a side and weigh no more than 10 pounds, and its form must be that of a nonmagical object that you have seen. The object is visibly magical, radiating dim light out to 5 feet.\n\nThe object disappears after 1 hour, when you use this feature again, if it takes any damage, or if it deals any damage.',
  },
  'invocation-permutation': {
    name: 'Benign Transposition',
    description:
      "Starting at 6th level, you can use your action to teleport up to 30 feet to an unoccupied space that you can see. Alternatively, you can choose a space within range that is occupied by a Small or Medium creature. If that creature is willing, you both teleport, swapping places.\n\nOnce you use this feature, you can't use it again until you finish a long rest or you cast a conjuration spell of 1st level or higher.",
  },
  'invocation-invocation-consciencieuse': {
    name: 'Focused Conjuration',
    description:
      "Beginning at 10th level, while you are concentration on a conjuration spell, your concentration can't be broken as a result of taking damage.",
  },
  'invocation-convocations-coriaces': {
    name: 'Durable Summons',
    description:
      'Starting at 14th level, any creature that you summon or create with a conjuration spell has 30 temporary hit points.',
  },
  'necromancie-necromancien-erudit': {
    name: 'Necromancy Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy a necromancy spell into your spellbook is halved.',
  },
  'necromancie-sinistre-moisson': {
    name: 'Grim Harvest',
    description:
      "At 2nd level, you gain the ability to reap life energy from creatures you kill with your spells. Once per turn when you kill one or more creatures with a spell of 1st level or higher, you regain hit points equal to twice the spell's level, or three times its level if the spell belongs to the School of Necromancy. You don't gain this benefit for killing constructs or undead.",
  },
  'necromancie-serviteurs-morts-vivants': {
    name: 'Undead Thralls',
    description:
      "At 6th level, you add the animate dead spell to your spellbook if it is not there already. When you cast animate dead, you can target one additional corpse or pile of bones, creating another zombie or skeleton, as appropriate.\n\nWhenever you create an undead using a necromancy spell, it has additional benefits:\n\n- The creature's hit point maximum is increased by an amount equal to your wizard level.\n- The creature adds your proficiency bonus to its weapon damage rolls.",
  },
  'necromancie-insensibilite-non-vie': {
    name: 'Inured to Undeath',
    description:
      "Beginning at 10th level, you have resistance to necrotic damage, and your hit point maximum can't be reduced. You have spent so much time dealing with undead and the forces that animate them that you have become inured to some of their worst effects.",
  },
  'necromancie-controle-morts-vivants': {
    name: 'Command Undead',
    description:
      "Starting at 14th level, you can use magic to bring undead under your control, even those created by other wizards. As an action, you can choose one undead that you can see within 60 feet of you. That creature must make a Charisma saving throw against your wizard spell save DC. If it succeeds, you can't use this feature on it again. If it fails, it becomes friendly to you and obeys your commands until you use this feature again.\n\nIntelligent undead are harder to control in this way. If the target has an Intelligence of 8 or higher, it has advantage on the saving throw. If it fails the saving throw and has an Intelligence of 12 or higher, it can repeat the saving throw at the end of every hour until it succeeds and breaks free.",
  },
  'transmutation-transmutateur-erudit': {
    name: 'Transmutation Savant',
    description:
      'Beginning when you select this school at 2nd level, the gold and time you must spend to copy a transmutation spell into your spellbook is halved.',
  },
  'transmutation-alchimie-mineure': {
    name: 'Minor Alchemy',
    description:
      'Starting at 2nd level when you select this school, you can temporarily alter the physical properties of one nonmagical object, changing it from one substance into another. You perform a special alchemical procedure on one object composed entirely of wood, stone (but not a gemstone), iron, copper, or silver, transforming it into a different one of those materials. For each 10 minutes you spend performing the procedure, you can transform up to 1 cubic foot of material. After 1 hour, or until you lose your concentration (as if you were concentration on a spell), the material reverts to its original substance.',
  },
  'transmutation-pierre-transmutateur': {
    name: "Transmuter's Stone",
    description:
      "Starting at 6th level, you can spend 8 hours creating a transmuter's stone that stores transmutation magic. You can benefit from the stone yourself or give it to another creature. A creature gains a benefit of your choice as long as the stone is in the creature's possession. When you create the stone, choose the benefit from the following options:\n\n- Darkvision out to a range of 60 feet, as described in chapter 8.\n- An increase to speed of 10 feet while the creature is unencumbered.\n- Proficiency in Constitution saving throws.\n- Resistance to acid, cold, fire, lightning, or thunder damage (your choice whenever you choose this benefit).\n\nEach time you cast a transmutation spell of 1st level or higher, you can change the effect of your stone if the stone is on your person.\n\nIf you create a new transmuter's stone, the previous one ceases to function.",
  },
  'transmutation-metamorphe': {
    name: 'Shapechanger',
    description:
      "At 10th level, you add the polymorph spell to your spellbook, if it is not there already. You can cast polymorph without expending a spell slot. When you do so, you can target only yourself and transform into a beast whose challenge rating is 1 or lower.\n\nOnce you cast polymorph in this way, you can't do so again until you finish a short or long rest, though you can still cast it normally using an available spell slot.",
  },
  'transmutation-maitre-transmutateur': {
    name: 'Master Transmuter',
    description:
      "Starting at 14th level, you can use your action to consume the reserve of transmutation magic stored within your transmuter's stone in a single burst. When you do so, choose one of the following effects. Your transmuter's stone is destroyed and can't be remade until you finish a long rest.\n\nMajor Transformation.\nYou can transmute one nonmagical object—no larger than a 5-foot cube—into another nonmagical object of similar size and mass and of equal or lesser value. You must spend 10 minutes handling the object to transform it.\n\nPanacea.\nYou remove all curses, diseases, and poisons affecting a creature that you touch with the transmuter's stone. The creature also regains all its hit points.\n\nRestore Life.\nYou cast the raise dead spell on a creature you touch with the transmuter's stone, without expending a spell slot or needing to have the spell in your spellbook.\n\nRestore Youth.\nYou touch the transmuter's stone to a willing creature, and that creature's apparent age is reduced by 3d10 years, to a minimum of 13 years. This effect doesn't extend the creature's lifespan.",
  },
  'main-ouverte-technique': {
    name: 'Open Hand Technique',
    description:
      "You can manipulate your enemy's ki when you harness your own. Whenever you hit a creature with one of the attacks granted by your Flurry of Blows, you can impose one of the following effects on that target.\n\n- It must succeed on a Dexterity saving throw or be knocked prone.\n- It must make a Strength saving throw. If it fails, you can push it up to 15 feet away from you.\n- It can't take reactions until the end of your next turn.",
  },
  'main-ouverte-plenitude-physique': {
    name: 'Wholeness of Body',
    description:
      'You gain the ability to heal yourself. As an action, you can regain hit points equal to three times your monk level. You must finish a long rest before you can use this feature again.',
  },
  'main-ouverte-tranquillite': {
    name: 'Tranquility',
    description:
      'Beginning at 11th level, you can enter a special meditation that surrounds you with an aura of peace. At the end of a long rest, you gain the effect of a sanctuary spell that lasts until the start of your next long rest (the spell can end early as normal). The saving throw DC for the spell equals 8 + your Wisdom modifier + your proficiency bonus.',
  },
  'main-ouverte-paume-fremissante': {
    name: 'Quivering Palm',
    description:
      "You gain the ability to set up lethal vibrations in someone's body. When you hit a creature with an unarmed strike, you can spend 3 ki points to start these imperceptible vibrations, which last for a number of days equal to your monk level. The vibrations are harmless unless you use your action to end them. To do so, you and the target must be on the same plane of existence. When you use this action, the creature must make a Constitution saving throw. If it fails, it is reduced to 0 hit points. If it succeeds, it takes 10d10 necrotic damage.\n\nYou can have only one creature under the effect of this feature at a time. You can choose to end the vibrations harmlessly without using an action.",
  },
  'archfee-presence-feerique': {
    name: 'Fey Presence',
    description:
      "Starting at 1st level, your patron bestows upon you the ability to project the beguiling and fearsome presence of the fey. As an action, you can cause each creature in a 10-foot cube originating from you to make a Wisdom saving throw against your warlock spell save DC. The creatures that fail their saving throws are all charmed or frightened by you (your choice) until the end of your next turn.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.",
  },
  'archfee-evasion-feerique': {
    name: 'Misty Escape',
    description:
      "Starting at 6th level, you can vanish in a puff of mist in response to harm. When you take damage, you can use your reaction to turn invisible and teleport up to 60 feet to an unoccupied space you can see. You remain invisible until the start of your next turn or until you attack or cast a spell.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.",
  },
  'archfee-defenses-captivantes': {
    name: 'Beguiling Defenses',
    description:
      'Beginning at 10th level, your patron teaches you how to turn the mind-affecting magic of your enemies against them. You are immune to being charmed, and when another creature attempts to charm you, you can use your reaction to attempt to turn the charm back on that creature. The creature must succeed on a Wisdom saving throw against your warlock spell save DC or be charmed by you for 1 minute or until the creature takes any damage.',
  },
  'archfee-sombre-delire': {
    name: 'Dark Delirium',
    description:
      'Starting at 14th level, you can plunge a creature into an illusory realm. As an action, choose a creature that you can see within 60 feet of you. It must make a Wisdom saving throw against your warlock spell save DC. On a failed save, it is charmed or frightened by you (your choice) for 1 minute or until your concentration is broken (as if you are concentration on a spell). This effect ends early if the creature takes any damage.\n\nUntil this illusion ends, the creature thinks it is lost in a misty realm, the appearance of which you choose. The creature can see and hear only itself, you, and the illusion.\n\nYou must finish a short or long rest before you can use this feature again.',
  },
  'fielon-benediction': {
    name: "Dark One's Blessing",
    description:
      'Starting at 1st level, when you reduce a hostile creature to 0 hit points, you gain temporary hit points equal to your Charisma modifier + your warlock level (minimum of 1).',
  },
  'fielon-chance-du-tenebreux': {
    name: "Dark One's Own Luck",
    description:
      "Starting at 6th level, you can call on your patron to alter fate in your favor. When you make an ability check or a saving throw, you can use this feature to add a d10 to your roll. You can do so after seeing the initial roll but before any of the roll's effects occur.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.",
  },
  'fielon-resistance-fielonne': {
    name: 'Fiendish Resilience',
    description:
      'Starting at 10th level, you can choose one damage type when you finish a short or long rest. You gain resistance to that damage type until you choose a different one with this feature. Damage from magical weapons or silver weapons ignores this resistance.',
  },
  'fielon-traversee-des-enfers': {
    name: 'Hurl Through Hell',
    description:
      "Starting at 14th level, when you hit a creature with an attack, you can use this feature to instantly transport the target through the lower planes. The creature disappears and hurtles through a nightmare landscape.\n\nAt the end of your next turn, the target returns to the space it previously occupied, or the nearest unoccupied space. If the target is not a fiend, it takes 10d10 psychic damage as it reels from its horrific experience.\n\nOnce you use this feature, you can't use it again until you finish a long rest.",
  },
  'grand-ancien-esprit-eveille': {
    name: 'Awakened Mind',
    description:
      "Starting at 1st level, your alien knowledge gives you the ability to touch the minds of other creatures. You can telepathically speak to any creature you can see within 30 feet of you. You don't need to share a language with the creature for it to understand your telepathic utterances, but the creature must be able to understand at least one language.",
  },
  'grand-ancien-protection-entropique': {
    name: 'Entropic Ward',
    description:
      "At 6th level, you learn to magically ward yourself against attack and to turn an enemy's failed strike into good luck for yourself. When a creature makes an attack roll against you, you can use your reaction to impose disadvantage on that roll. If the attack misses you, your next attack roll against the creature has advantage if you make it before the end of your next turn.\n\nOnce you use this feature, you can't use it again until you finish a short or long rest.",
  },
  'grand-ancien-bouclier-mental': {
    name: 'Thought Shield',
    description:
      "Starting at 10th level, your thoughts can't be read by telepathy or other means unless you allow it. You also have resistance to psychic damage, and whenever a creature deals psychic damage to you, that creature takes the same amount of damage that you do.",
  },
  'grand-ancien-asservissement': {
    name: 'Create Thrall',
    description:
      "At 14th level, you gain the ability to infect a humanoid's mind with the alien magic of your patron. You can use your action to touch an incapacitated humanoid. That creature is then charmed by you until a remove curse spell is cast on it, the charmed condition is removed from it, or you use this feature again.\n\nYou can communicate telepathically with the charmed creature as long as the two of you are on the same plane of existence.",
  },
  'paladin-devotion-conduit': {
    name: 'Sacred Weapon / Turn the Unholy',
    description:
      "As an action, you can imbue one weapon that you are holding with positive energy, using your Channel Divinity. For 1 minute, you add your Charisma modifier to attack rolls made with that weapon (with a minimum bonus of +1). The weapon also emits bright light in a 20-foot radius and dim light 20 feet beyond that. If the weapon is not already magical, it becomes magical for the duration.\n\nYou can end this effect on your turn as part of any other action. If you are no longer holding or carrying this weapon, or if you fall unconscious, this effect ends.\n\nAs an action, you present your holy symbol and speak a prayer censuring fiends and undead, using your Channel Divinity. Each fiend or undead that can see or hear you within 30 feet of you must make a Wisdom saving throw. If the creature fails its saving throw, it is turned for 1 minute or until it takes damage.\n\nA turned creature must spend its turns trying to move as far away from you as it can, and it can't willingly move to a space within 30 feet of you. It also can't take reactions. For its action, it can use only the Dash action or try to escape from an effect that prevents it from moving. If there's nowhere to move, the creature can use the Dodge action.",
  },
  'paladin-aura-devotion': {
    name: 'Aura of Devotion',
    description:
      "Starting at 7th level, you and friendly creatures within 10 feet of you can't be charmed while you are conscious.\n\nAt 18th level, the range of this aura increases to 30 feet.",
  },
  'paladin-purete-esprit': {
    name: 'Purity of Spirit',
    description:
      'Beginning at 15th level, you are always under the effects of a protection from evil and good spell.',
  },
  'paladin-nimbe-sacre': {
    name: 'Holy Nimbus',
    description:
      "At 20th level, as an action, you can emanate an aura of sunlight. For 1 minute, bright light shines from you in a 30-foot radius, and dim light shines 30 feet beyond that.\n\nWhenever an enemy creature starts its turn in the bright light, the creature takes 10 radiant damage.\n\nIn addition, for the duration, you have advantage on saving throws against spells cast by fiends or undead.\n\nOnce you use this feature, you can't use it again until you finish a long rest.",
  },
  'paladin-anciennes-conduit': {
    name: "Nature's Wrath / Turn the Faithless",
    description:
      "You can use your Channel Divinity to invoke primeval forces to ensnare a foe. As an action, you can cause spectral vines to spring up and reach for a creature within 10 feet of you that you can see. The creature must succeed on a Strength or Dexterity saving throw (its choice) or be restrained. While restrained by the vines, the creature repeats the saving throw at the end of each of its turns. On a success, it frees itself and the vines vanish.\n\nYou can use your Channel Divinity to utter ancient words that are painful for fey and fiends to hear. As an action, you present your holy symbol, and each fey or fiend within 30 feet of you that can hear you must make a Wisdom saving throw. On a failed save, the creature is turned for 1 minute or until it takes damage.\n\nA turned creature must spend its turns trying to move as far away from you as it can, and it can't willingly move to a space within 30 feet of you. It also can't take reactions. For its action, it can use only the Dash action or try to escape from an effect that prevents it from moving. If there's nowhere to move, the creature can use the Dodge action.\n\nIf the creature's true form is concealed by an illusion, shapeshifting, or other effect, that form is revealed while it is turned.",
  },
  'paladin-aura-garde': {
    name: 'Aura of Warding',
    description:
      'Beginning at 7th level, ancient magic lies so heavily upon you that it forms an eldritch ward. You and friendly creatures within 10 feet of you have resistance to damage from spells.\n\nAt 18th level, the range of this aura increases to 30 feet.',
  },
  'paladin-sentinelle-immortelle': {
    name: 'Undying Sentinel',
    description:
      "Starting at 15th level, when you are reduced to 0 hit points and are not killed outright, you can choose to drop to 1 hit point instead. Once you use this ability, you can't use it again until you finish a long rest.\n\nAdditionally, you suffer none of the drawbacks of old age, and you can't be aged magically.",
  },
  'paladin-champion-antique': {
    name: 'Elder Champion',
    description:
      "At 20th level, you can assume the form of an ancient force of nature, taking on an appearance you choose. For example, your skin might turn green or take on a bark-like texture, your hair might become leafy or moss-like, or you might sprout antlers or a lion-like mane.\n\nUsing your action, you undergo a transformation. For 1 minute, you gain the following benefits:\n\n- At the start of each of your turns, you regain 10 hit points.\n- Whenever you cast a paladin spell that has a casting time of 1 action, you can cast it using your bonus action instead.\n- Enemy creatures within 10 feet of you have disadvantage on saving throws against your paladin spells and Channel Divinity options.\n\nOnce you use this feature, you can't use it again until you finish a long rest.",
  },
  'paladin-vengeance-conduit': {
    name: 'Abjure Enemy / Vow of Enmity',
    description:
      "As an action, you present your holy symbol and speak a prayer of denunciation, using your Channel Divinity. Choose one creature within 60 feet of you that you can see. That creature must make a Wisdom saving throw, unless it is immune to being frightened. Fiends and undead have disadvantage on this saving throw.\n\nOn a failed save, the creature is frightened for 1 minute or until it takes any damage. While frightened, the creature's speed is 0, and it can't benefit from any bonus to its speed.\n\nOn a successful save, the creature's speed is halved for 1 minute or until the creature takes any damage.\n\nAs a bonus action, you can utter a vow of enmity against a creature you can see within 10 feet of you, using your Channel Divinity. You gain advantage on attack rolls against the creature for 1 minute or until it drops to 0 hit points or falls unconscious.",
  },
  'paladin-vengeur-implacable': {
    name: 'Relentless Avenger',
    description:
      "By 7th level, your supernatural focus helps you close off a foe's retreat. When you hit a creature with an opportunity attack, you can move up to half your speed immediately after the attack and as part of the same reaction. This movement doesn't provoke opportunity attacks.",
  },
  'paladin-ame-vengeresse': {
    name: 'Soul of Vengeance',
    description:
      'Starting at 15th level, the authority with which you speak your Vow of Enmity gives you greater power over your foe. When a creature under the effect of your Vow of Enmity makes an attack, you can use your reaction to make a melee weapon attack against that creature if it is within range.',
  },
  'paladin-ange-vengeance': {
    name: 'Avenging Angel',
    description:
      "At 20th level, you can assume the form of an angelic avenger. Using your action, you undergo a transformation. For 1 hour, you gain the following benefits:\n\n- Wings sprout from your back and grant you a flying speed of 60 feet.\n- You emanate an aura of menace in a 30-foot radius. The first time any enemy creature enters the aura or starts its turn there during a battle, the creature must succeed on a Wisdom saving throw or become frightened of you for 1 minute or until it takes any damage. Attack rolls against the frightened creature have advantage.\n\nOnce you use this feature, you can't use it again until you finish a long rest.",
  },
  'chasseur-proie-du-chasseur': {
    name: "Hunter's Prey",
    description: 'At 3rd level, you gain one of the following features of your choice.',
  },
  'chasseur-tactiques-defensives': {
    name: 'Defensive Tactics',
    description: 'At 7th level, you gain one of the following features of your choice.',
  },
  'chasseur-attaque-multiple': {
    name: 'Multiattack',
    description: 'At 11th level, you gain one of the following features of your choice.',
  },
  'chasseur-defense-superieure': {
    name: "Superior Hunter's Defense",
    description: 'At 15th level, you gain one of the following features of your choice.',
  },
  'voleur-mains-lestes': {
    name: 'Fast Hands',
    description:
      "Starting at 3rd level, you can use the bonus action granted by your Cunning Action to make a Dexterity (Sleight of Hand) check, use your thieves' tools to disarm a trap or open a lock, or take the Use an Object action.",
  },
  'voleur-monte-en-lair': {
    name: 'Second-Story Work',
    description:
      'When you choose this archetype at 3rd level, you gain the ability to climb faster than normal; climbing no longer costs you extra movement.\n\nIn addition, when you make a running jump, the distance you cover increases by a number of feet equal to your Dexterity modifier.',
  },
  'voleur-discretion-supreme': {
    name: 'Supreme Sneak',
    description:
      'Starting at 9th level, you have advantage on a Dexterity (Stealth) check if you move no more than half your speed on the same turn.',
  },
  'voleur-utilisation-objets-magiques': {
    name: 'Use Magic Device',
    description:
      'By 13th level, you have learned enough about the workings of magic that you can improvise the use of items even when they are not intended for you. You ignore all class, race, and level requirements on the use of magic items.',
  },
  'voleur-reflexes': {
    name: "Thief's Reflexes",
    description:
      "When you reach 17th level, you have become adept at laying ambushes and quickly escaping danger. You can take two turns during the first round of any combat. You take your first turn at your normal initiative and your second turn at your initiative minus 10. You can't use this feature when you are surprised.",
  },
  'assassin-maitrises-supplementaires': {
    name: 'Bonus Proficiencies',
    description:
      "When you choose this archetype at 3rd level, you gain proficiency with the disguise kit and the poisoner's kit.",
  },
  'assassin-assassinat': {
    name: 'Assassinate',
    description:
      "Starting at 3rd level, you are at your deadliest when you get the drop on your enemies. You have advantage on attack rolls against any creature that hasn't taken a turn in the combat yet. In addition, any hit you score against a creature that is surprised is a critical hit.",
  },
  'assassin-expert-infiltration': {
    name: 'Infiltration Expertise',
    description:
      "Starting at 9th level, you can unfailingly create false identities for yourself. You must spend seven days and 25 gp to establish the history, profession, and affiliations for an identity. You can't establish an identity that belongs to someone else. For example, you might acquire appropriate clothing, letters of introduction, and official-looking certification to establish yourself as a member of a trading house from a remote city so you can insinuate yourself into the company of other wealthy merchants.\n\nThereafter, if you adopt the new identity as a disguise, other creatures believe you to be that person until given an obvious reason not to.",
  },
  'assassin-imposteur': {
    name: 'Impostor',
    description:
      "At 13th level, you gain the ability to unerringly mimic another person's speech, writing, and behavior. You must spend at least three hours studying these three components of the person's behavior, listening to speech, examining handwriting, and observing mannerism.\n\nYour ruse is indiscernible to the casual observer. If a wary creature suspects something is amiss, you have advantage on any Charisma (Deception) check you make to avoid detection.",
  },
  'assassin-frappe-meurtriere': {
    name: 'Death Strike',
    description:
      'Starting at 17th level, you become a master of instant death. When you attack and hit a creature that is surprised, it must make a Constitution saving throw (DC 8 + your Dexterity modifier + your proficiency bonus). On a failed save, double the damage of your attack against the creature.',
  },
  'escroc-arcanique-incantation': {
    name: 'Spellcasting',
    description:
      "When you reach 3rd level, you gain the ability to cast spells. See chapter 10 for the general rules of spellcasting and chapter 11 for the wizard spell list.\n\nCantrips.\nYou learn three cantrips: mage hand and two other cantrips of your choice from the wizard spell list. You learn another wizard cantrip of your choice at 10th level.\n\nSpell Slots.\nThe Arcane Trickster Spellcasting table shows how many spell slots you have to cast your wizard spells of 1st level and higher. To cast one of these spells, you must expend a slot of the spell's level or higher. You regain all expended spell slots when you finish a long rest.\n\nFor example, if you know the 1st-level spell charm person and have a 1st-level and a 2nd-level spell slot available, you can cast charm person using either slot.\n\nSpells Known of 1st-Level and Higher.\nYou know three 1st-level wizard spells of your choice, two of which you must choose from the enchantment and illusion spells on the wizard spell list.\n\nThe Spells Known column of the Arcane Trickster Spellcasting table shows when you learn more wizard spells of 1st level or higher. Each of these spells must be an enchantment or illusion spell of your choice, and must be of a level for which you have spell slots. For instance, when you reach 7th level in this class, you can learn one new spell of 1st or 2nd level.\n\nThe spells you learn at 8th, 14th, and 20th level can come from any school of magic.\n\nWhenever you gain a level in this class, you can replace one of the wizard spells you know with another spell of your choice from the wizard spell list. The new spell must be of a level for which you have spell slots, and it must be an enchantment or illusion spell, unless you're replacing the spell you gained at 3rd, 8th, 14th, or 20th level from any school of magic.\n\nSpellcasting Ability.\nIntelligence is your spellcasting ability for your wizard spells, since you learn your spells through dedicated study and memorization. You use your Intelligence whenever a spell refers to your spellcasting ability. In addition, you use your Intelligence modifier when setting the saving throw DC for a wizard spell you cast and when making an attack roll with one.\n\nSpell save DC = 8 + proficiency + $",
  },
  'escroc-arcanique-escamotage': {
    name: 'Mage Hand Legerdemain',
    description:
      "Starting at 3rd level, when you cast mage hand, you can make the spectral hand invisible, and you can perform the following additional tasks with it:\n\n- You can stow one object the hand is holding in a container worn or carried by another creature.\n- You can retrieve an object in a container worn or carried by another creature.\n- You can use thieves' tools to pick locks and disarm traps at range.\n\nYou can perform one of these tasks without being noticed by a creature if you succeed on a Dexterity (Sleight of Hand) check contested by the creature's Wisdom (Perception) check.\n\nIn addition, you can use the bonus action granted by your Cunning Action to control the hand.",
  },
  'escroc-arcanique-embuscade-magique': {
    name: 'Magical Ambush',
    description:
      'Starting at 9th level, if you are hidden from a creature when you cast a spell on it, the creature has disadvantage on any saving throw it makes against the spell this turn.',
  },
  'escroc-arcanique-escroc-polyvalent': {
    name: 'Versatile Trickster',
    description:
      'At 13th level, you gain the ability to distract targets with your mage hand. As a bonus action on your turn, you can designate a creature within 5 feet of the spectral hand created by the spell. Doing so gives you advantage on attack rolls against that creature until the end of the turn.',
  },
  'escroc-arcanique-voleur-de-sort': {
    name: 'Spell Thief',
    description:
      "At 17th level, you gain the ability to magically steal the knowledge of how to cast a spell from another spellcaster.\n\nImmediately after a creature casts a spell that targets you or includes you in its area of effect, you can use your reaction to force the creature to make a saving throw with its spellcasting ability modifier. The DC equals your spell save DC. On a failed save, you negate the spell's effect against you, and you steal the knowledge of the spell if it is at least 1st level and of a level you can cast (it doesn't need to be a wizard spell). For the next 8 hours, you know the spell and can cast it using your spell slots. The creature can't cast that spell until the 8 hours have passed.\n\nOnce you use this feature, you can't use it again until you finish a long rest.",
  },
};
