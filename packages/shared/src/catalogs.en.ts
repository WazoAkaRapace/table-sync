// Miroirs anglais des catalogues SRD (classes, espèces, historiques) de
// index.ts — clés = noms FR (langue de stockage), valeurs EN d'affichage.
// Consommés via apps/web/src/i18n/labels.ts (raceInfo/classInfo/backgroundInfo).
export type CatalogEntryEn = { name: string; description?: string };

export const DND_CLASSES_EN: Record<string, CatalogEntryEn> = {
  Artificier: {
    name: 'Artificer',
    description:
      'Supreme inventors unleashing magic into everyday objects; spells channeled through tools, infused magic items.',
  },
  Barbare: {
    name: 'Barbarian',
    description:
      'Feral warriors fueled by fury; unquenchable rage, superhuman strength and resilience, unarmored combat.',
  },
  Barde: {
    name: 'Bard',
    description:
      'Versatile and inspiring, masters of song and word-magic; charm, illusions, universal knowledge.',
  },
  Clerc: {
    name: 'Cleric',
    description:
      'Intermediaries between mortals and gods, imbued with divine magic; heal their allies, turn undead, serve a divine domain.',
  },
  Druide: {
    name: 'Druid',
    description:
      'Embodiments of nature’s strength and wrath; animal wild shape, elemental spells; the Druidic tongue.',
  },
  Ensorceleur: {
    name: 'Sorcerer',
    description:
      'Bearers of innate magic that chose them; draconic bloodline or wild magic, metamagic and sorcery points.',
  },
  Guerrier: {
    name: 'Fighter',
    description:
      'Unequaled masters of weapons and armor, from knight to mercenary; all armors, Second Wind and Action Surge.',
  },
  Magicien: {
    name: 'Wizard',
    description:
      'Scholars obsessed with the arcane, living by their spells; spellbook, Intelligence casting, eight schools of magic.',
  },
  Moine: {
    name: 'Monk',
    description:
      'Disciplined martial artists uniting body and spirit; ki, unarmed combat, unarmored speed and defense.',
  },
  Occultiste: {
    name: 'Warlock',
    description:
      'Seekers of forbidden knowledge, bound by pact to an otherworldly patron; pact magic, eldritch invocations.',
  },
  Paladin: {
    name: 'Paladin',
    description:
      'Blessed champions bound by a sacred oath, bulwarks against evil; divine magic, healing and radiant smites.',
  },
  Rôdeur: {
    name: 'Ranger',
    description:
      'Independent warriors of the wilds, watching civilization’s frontier; favored enemy, nature magic, favored terrain.',
  },
  Roublard: {
    name: 'Rogue',
    description:
      'Clever and discreet, masters of lockpicking and shadows; sneak attack and uncanny dodge.',
  },
};

export const DND_RACES_EN: Record<string, CatalogEntryEn> = {
  Humain: {
    name: 'Human',
    description: 'Adaptable and ambitious — the most widespread people of all worlds.',
  },
  Nain: {
    name: 'Dwarf',
    description: 'Sturdy, long-memoryed, darkvision, poison resistance; the Dwarvish tongue.',
  },
  'Nain des collines': {
    name: 'Hill Dwarf',
    description: 'Keen senses, deep resilience, the wisdom of the mountains.',
  },
  'Nain des montagnes': {
    name: 'Mountain Dwarf',
    description: 'Strong as stone, raised among the armories.',
  },
  Elfe: {
    name: 'Elf',
    description:
      'Graceful and near-immortal; trance instead of sleep, darkvision; the Elvish tongue.',
  },
  'Haut-elfe': {
    name: 'High Elf',
    description: 'Learned and arcane, a cantrip in the blood.',
  },
  'Elfe des bois': {
    name: 'Wood Elf',
    description: 'Swift and fey, soul of the deep forests.',
  },
  'Elfe noir (drow)': {
    name: 'Dark Elf (Drow)',
    description: 'Child of the Underdark, innate dark magic.',
  },
  Halfelin: {
    name: 'Halfling',
    description: 'Small, lucky and fearless — they slip in anywhere; the Halfling tongue.',
  },
  'Halfelin pied-léger': {
    name: 'Lightfoot Halfling',
    description: 'Stealthy and affable, at ease in any crowd.',
  },
  'Halfelin robuste': {
    name: 'Stout Halfling',
    description: 'Stocky and resilient, native of the windy hills.',
  },
  Gnome: {
    name: 'Gnome',
    description: 'Quick and curious, legendary cunning, darkvision; the Gnomish tongue.',
  },
  'Gnome des forêts': {
    name: 'Forest Gnome',
    description: 'A natural illusionist, friend of small beasts.',
  },
  'Gnome des rochers': {
    name: 'Rock Gnome',
    description: 'Born tinkerer — toys, gadgets and clockwork machines.',
  },
  'Demi-elfe': {
    name: 'Half-Elf',
    description: 'Two worlds in the blood: darkvision, fey heritage, two extra languages.',
  },
  'Demi-orc': {
    name: 'Half-Orc',
    description: 'Imposing, unrelenting, savage attacks; the Orc tongue.',
  },
  Tieffelin: {
    name: 'Tiefling',
    description:
      'Infernal heritage at first glance; fire resistance, dark magic; the Infernal tongue.',
  },
};

export const DND_BACKGROUNDS_EN: Record<string, CatalogEntryEn> = {
  Acolyte: {
    name: 'Acolyte',
    description: 'Raised in the temple — shelter and care among the faithful.',
  },
  Criminel: {
    name: 'Criminal',
    description: 'Petty crimes and underworld contacts (variant: spy).',
  },
  'Héros du peuple': {
    name: 'Folk Hero',
    description: 'Born of the people, you became their defender.',
  },
  Noble: {
    name: 'Noble',
    description: 'Birth, title and rank — the court owes you deference.',
  },
  Sage: {
    name: 'Sage',
    description: 'Years of study — you know where to look for the answer.',
  },
  Soldat: {
    name: 'Soldier',
    description: 'War, discipline and the chain of command.',
  },
  Orphelin: {
    name: 'Urchin',
    description: 'Raised in the streets — fast, resourceful, alone.',
  },
};

export const DND_SKILLS_EN: Record<string, string> = {
  acrobatics: 'Acrobatics',
  animalHandling: 'Animal Handling',
  arcanes: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
};

export const DND_TOOLS_EN: Record<string, string> = {
  brewerSupplies: "Brewer's Supplies",
  calligrapherSupplies: "Calligrapher's Supplies",
  carpenterTools: "Carpenter's Tools",
  cartographerTools: "Cartographer's Tools",
  cobblerTools: "Cobbler's Tools",
  cookUtensils: "Cook's Utensils",
  glassblowerTools: "Glassblower's Tools",
  jewelerTools: "Jeweler's Tools",
  leatherworkerTools: "Leatherworker's Tools",
  masonTools: "Mason's Tools",
  painterSupplies: "Painter's Supplies",
  potterTools: "Potter's Tools",
  smithTools: "Smith's Tools",
  tinkerTools: "Tinker's Tools",
  weaverTools: "Weaver's Tools",
  woodcarverTools: "Woodcarver's Tools",
  disguiseKit: 'Disguise Kit',
  forgeryKit: 'Forgery Kit',
  diceSet: 'Dice Set',
  dragonchessSet: 'Dragonchess Set',
  playingCardSet: 'Playing Card Set',
  bagpipes: 'Bagpipes',
  drum: 'Drum',
  dulcimer: 'Dulcimer',
  flute: 'Flute',
  lute: 'Lute',
  lyre: 'Lyre',
  horn: 'Horn',
  panFlute: 'Pan Flute',
  shawm: 'Shawm',
  viol: 'Viol',
  thievesTools: "Thieves' Tools",
  navigatorTools: "Navigator's Tools",
  vehicleLand: 'Land Vehicle',
  vehicleWater: 'Water Vehicle',
};
