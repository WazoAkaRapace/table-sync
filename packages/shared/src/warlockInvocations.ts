/**
 * Catalogue des manifestations occultes (PHB 2014 / SRD 5.1) — français.
 *
 * Source de vérité : la page AideDD de CHAQUE manifestation (noms, descriptions
 * et prérequis officiels, vérifiés 2026-10-05 sur aidedd.org/dnd/invocations.php).
 * Seules les manifestations PHB/SRD sont cataloguées — les entrées italiques
 * SCAG/XGE/TCE restent hors périmètre (même statut « extension » que le reste
 * du catalogue).
 *
 * Contrairement à CLASS_FEATURES, ce sont des OPTIONS avec prérequis, pas des
 * lignes de table de classe : elles ne vivent PAS dans le catalogue de classe.
 * La sélection persiste comme lignes `character_features` avec
 * `catalog_id` = id de manifestation (préfixe occultiste-invo-) — repos,
 * compteurs, tri et EN s'appliquent tel quel.
 *
 * Les descriptions sont résumées en 1-2 phrases depuis le wording AideDD
 * (placeholders {{...}} de renderFeatureTemplate si pertinent). Les
 * manifestations purement descriptives (Armure d'ombres, Vision du diable…)
 * restent du texte SANS effet moteur — design assumé du catalogue-aide.
 */

/** Prérequis de Faveur de pacte. */
export type PactBoon = 'lame' | 'chaine' | 'grimoire';

export type WarlockInvocationEffect =
  /** Décharge déchirante : +mod CHA aux dégâts de décharge occulte (Phase B). */
  | { kind: 'agonizing-blast' }
  /** Lance occulte : portée de décharge occulte portée à 45 m (150 ft, PHB 2014 p.111). */
  | { kind: 'eldritch-spear' }
  /** Sorts lancables à volonté (slugs srd_index du catalogue spells). */
  | { kind: 'at-will'; spells: string[] }
  /** Sort lançable 1×/repos long via emplacement d'occultiste, compteur dédié. */
  | { kind: 'free-cast'; spell: string }
  /** Lame assoiffée : 2 attaques avec l'arme de pacte (Phase C). */
  | { kind: 'pact-weapon-extra-attack' }
  /** Buveuse de vie : +mod CHA nécrotique sur l'arme de pacte (Phase C). */
  | { kind: 'pact-weapon-lifedrinker' };

export interface WarlockInvocation {
  /** id stable : occultiste-invo-<slug>, stocké dans character_features.catalog_id. */
  id: string;
  /** Nom officiel AideDD. */
  name: string;
  /** 1-2 phrases, wording AideDD (placeholders {{cha_mod}} si pertinent). */
  description: string;
  /** Prérequis de niveau D'OCCULTISTE (absent = aucun, accessible dès le niv. 2). */
  prereqLevel?: number;
  /** Prérequis « sort mineur décharge occulte » — jamais bloquant : tout
   *  occultiste choisit ce sort mineur en prenant la manifestation (PHB). */
  prereqEldritchBlast?: boolean;
  /** Prérequis de Faveur de pacte, si applicable. */
  prereqPact?: PactBoon;
  /** Effet moteur branché (clé discriminante pour les Phases B/C). */
  effect?: WarlockInvocationEffect;
  /** Compteur SRD 1/repos long (free-cast : le lancer gratuit au compteur). */
  resource?: { max: () => number; reset: 'long' };
}

// slugs srd_index du catalogue spells (data/spells-seed.json)
const AT_WILL = (spells: string[]): { kind: 'at-will'; spells: string[] } => ({
  kind: 'at-will',
  spells,
});

/**
 * Les 32 manifestations PHB 2014 (ordre alphabétique du nom FR AideDD).
 * Prérequis vérifiés sur chaque page individuelle.
 */
export const WARLOCK_INVOCATIONS: WarlockInvocation[] = [
  {
    id: 'occultiste-invo-armure-d-ombres',
    name: 'Armure d’ombres',
    description:
      'Vous pouvez lancer armure de mage sur vous-même à volonté, sans dépenser d’emplacement de sort ni de composantes.',
    effect: AT_WILL(['mage-armor']),
  },
  {
    id: 'occultiste-invo-buveuse-de-vie',
    name: 'Buveuse de vie',
    prereqLevel: 12,
    prereqPact: 'lame',
    description:
      'Quand vous touchez une créature avec votre arme de pacte, elle subit des dégâts nécrotiques supplémentaires égaux à votre modificateur de Charisme (minimum 1).',
    effect: { kind: 'pact-weapon-lifedrinker' },
  },
  {
    id: 'occultiste-invo-chaines-des-carceres',
    name: 'Chaînes des Carcères',
    prereqLevel: 15,
    prereqPact: 'chaine',
    description:
      'Vous pouvez lancer immobilisation de monstre à volonté (sur un céleste, un démon ou un élémentaire), sans dépenser d’emplacement de sort ni de composantes. Impossible de réutiliser sur la même créature avant un repos long.',
    effect: AT_WILL(['hold-monster']),
  },
  {
    id: 'occultiste-invo-decharge-dechirante',
    name: 'Décharge déchirante',
    prereqEldritchBlast: true,
    description:
      'Lorsque vous lancez décharge occulte, ajoutez votre modificateur de Charisme ({{cha_mod}}) aux dégâts.',
    effect: { kind: 'agonizing-blast' },
  },
  {
    id: 'occultiste-invo-decharge-repulsive',
    name: 'Décharge répulsive',
    prereqEldritchBlast: true,
    description:
      'Quand vous touchez une créature avec décharge occulte, vous pouvez la repousser de 3 mètres en ligne droite.',
    // Le recul n'est pas calculable — texte seul, pas d'effect.
  },
  {
    id: 'occultiste-invo-lance-occulte',
    name: 'Lance occulte',
    prereqEldritchBlast: true,
    description: 'Lorsque vous lancez décharge occulte, sa portée passe à 45 mètres.',
    effect: { kind: 'eldritch-spear' },
  },
  {
    id: 'occultiste-invo-langage-animal',
    name: 'Langage animal',
    description:
      'Vous pouvez lancer communication avec les animaux à volonté, sans dépenser d’emplacement de sort.',
    effect: AT_WILL(['speak-with-animals']),
  },
  {
    id: 'occultiste-invo-lame-assoiffee',
    name: 'Lame assoiffée',
    prereqLevel: 5,
    prereqPact: 'lame',
    description:
      'Vous pouvez attaquer deux fois avec votre arme de pacte, au lieu d’une seule, chaque fois que vous choisissez l’action Attaquer durant votre tour.',
    effect: { kind: 'pact-weapon-extra-attack' },
  },
  {
    id: 'occultiste-invo-lenteur-de-l-esprit',
    name: 'Lenteur de l’esprit',
    prereqLevel: 5,
    description:
      'Vous pouvez lancer lenteur une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'slow' },
    resource: { max: () => 1, reset: 'long' },
  },
  {
    id: 'occultiste-invo-livre-des-secrets-anciens',
    name: 'Livre des secrets anciens',
    prereqPact: 'grimoire',
    description:
      'Vous pouvez inscrire des rituels dans votre Livre des Ombres : choisissez deux sorts de niveau 1 rituels de n’importe quelle liste (lancables en rituel uniquement, ils ne comptent pas dans vos sorts connus) ; vous pouvez copier d’autres rituels d’un niveau ≤ ½ de votre niveau d’occultiste (arrondi au supérieur, 2 h et 50 po par niveau).',
  },
  {
    id: 'occultiste-invo-maitre-des-formes',
    name: 'Maître des formes',
    prereqLevel: 15,
    description:
      'Vous pouvez lancer modification d’apparence à volonté, sans dépenser d’emplacement de sort.',
    effect: AT_WILL(['alter-self']),
  },
  {
    id: 'occultiste-invo-maitre-des-ombres',
    name: 'Maître des ombres',
    prereqLevel: 5,
    description:
      'Dans une zone de lumière faible ou de ténèbres, vous pouvez utiliser une action pour devenir invisible jusqu’à ce que vous bougiez ou que vous utilisiez une action ou une réaction.',
  },
  {
    id: 'occultiste-invo-mille-visages',
    name: 'Mille visages',
    description: 'Vous pouvez lancer déguisement à volonté, sans dépenser d’emplacement de sort.',
    effect: AT_WILL(['disguise-self']),
  },
  {
    id: 'occultiste-invo-mot-d-effroi',
    name: 'Mot d’effroi',
    prereqLevel: 7,
    description:
      'Vous pouvez lancer confusion une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'confusion' },
    resource: { max: () => 1, reset: 'long' },
  },
  {
    id: 'occultiste-invo-murmures-de-la-tombe',
    name: 'Murmures de la tombe',
    prereqLevel: 9,
    description:
      'Vous pouvez lancer communication avec les morts à volonté, sans dépenser d’emplacement de sort.',
    effect: AT_WILL(['speak-with-dead']),
  },
  {
    id: 'occultiste-invo-murmures-ensorcelants',
    name: 'Murmures ensorcelants',
    prereqLevel: 7,
    description:
      'Vous pouvez lancer compulsion une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'compulsion' },
    resource: { max: () => 1, reset: 'long' },
  },
  {
    id: 'occultiste-invo-oeil-du-gardien-des-runes',
    name: 'Œil du gardien des runes',
    description: 'Vous pouvez lire toutes les formes d’écritures.',
  },
  {
    id: 'occultiste-invo-pas-aerien',
    name: 'Pas aérien',
    prereqLevel: 9,
    description:
      'Vous pouvez lancer lévitation sur vous-même à volonté, sans dépenser d’emplacement de sort ni de composantes.',
    effect: AT_WILL(['levitate']),
  },
  {
    id: 'occultiste-invo-perception-transferee',
    name: 'Perception transférée',
    description:
      'Action : touchez un humanoïde consentant pour voir et ressentir au travers de ses sens jusqu’à la fin de votre prochain tour (maintenable par des actions tant qu’il est sur votre plan ; vous bénéficiez de ses sens spéciaux mais êtes aveugle et sourd à votre environnement).',
  },
  {
    id: 'occultiste-invo-presence-captivante',
    name: 'Présence captivante',
    description: 'Vous acquérez la maîtrise des compétences Persuasion et Tromperie.',
  },
  {
    id: 'occultiste-invo-royaumes-lointains',
    name: 'Royaumes lointains',
    prereqLevel: 15,
    description: 'Vous pouvez lancer œil magique à volonté, sans dépenser d’emplacement de sort.',
    effect: AT_WILL(['arcane-eye']),
  },
  {
    id: 'occultiste-invo-saut-d-outremonde',
    name: 'Saut d’Outremonde',
    prereqLevel: 9,
    description:
      'Vous pouvez lancer saut sur vous-même à volonté, sans dépenser d’emplacement de sort ni de composantes.',
    effect: AT_WILL(['jump']),
  },
  {
    id: 'occultiste-invo-sbires-du-chaos',
    name: 'Sbires du chaos',
    prereqLevel: 9,
    description:
      'Vous pouvez lancer invocation d’élémentaire une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'conjure-elemental' },
    resource: { max: () => 1, reset: 'long' },
  },
  {
    id: 'occultiste-invo-sculpteur-de-chair',
    name: 'Sculpteur de chair',
    prereqLevel: 7,
    description:
      'Vous pouvez lancer métamorphose une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'polymorph' },
    resource: { max: () => 1, reset: 'long' },
  },
  {
    id: 'occultiste-invo-sombre-presage',
    name: 'Sombre présage',
    prereqLevel: 5,
    description:
      'Vous pouvez lancer malédiction une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'hex' },
    resource: { max: () => 1, reset: 'long' },
  },
  {
    id: 'occultiste-invo-vigueur-fielonne',
    name: 'Vigueur fiélonne',
    description:
      'Vous pouvez lancer simulacre de vie sur vous-même à volonté comme un sort de niveau 1, sans dépenser d’emplacement de sort ni de composantes.',
    effect: AT_WILL(['false-life']),
  },
  {
    id: 'occultiste-invo-vision-de-sorcier',
    name: 'Vision de sorcier',
    prereqLevel: 15,
    description:
      'Vous pouvez voir la forme véritable de chaque métamorphe ou créature dissimulée par la magie des illusions ou de la transmutation, dans un rayon de 9 mètres et dans votre ligne de mire.',
  },
  {
    id: 'occultiste-invo-vision-du-diable',
    name: 'Vision du diable',
    description:
      'Vous voyez normalement dans les ténèbres, qu’elles soient magiques ou non, jusqu’à une distance de 36 mètres.',
  },
  {
    id: 'occultiste-invo-vision-occulte',
    name: 'Vision occulte',
    description:
      'Vous pouvez lancer détection de la magie à volonté, sans dépenser d’emplacement de sort ni de composantes.',
    effect: AT_WILL(['detect-magic']),
  },
  {
    id: 'occultiste-invo-visions-embrumees',
    name: 'Visions embrumées',
    description:
      'Vous pouvez lancer image silencieuse à volonté, sans dépenser d’emplacement de sort ni de composantes.',
    effect: AT_WILL(['silent-image']),
  },
  {
    id: 'occultiste-invo-voix-du-maitre-des-chaines',
    name: 'Voix du maître des Chaînes',
    prereqPact: 'chaine',
    description:
      'Vous pouvez communiquer avec votre familier par télépathie et percevoir les choses par le biais de ses sens, aussi longtemps que vous êtes sur le même plan d’existence ; pendant que vous voyez au travers de ses sens, vous pouvez le faire parler avec votre voix.',
  },
  {
    id: 'occultiste-invo-voleur-des-cinq-destinees',
    name: 'Voleur des cinq destinées',
    description:
      'Vous pouvez lancer fléau une fois en utilisant un emplacement de sort d’occultiste. Vous ne pouvez le lancer de nouveau avant d’avoir terminé un repos long.',
    effect: { kind: 'free-cast', spell: 'bane' },
    resource: { max: () => 1, reset: 'long' },
  },
];

/** Retrouve une manifestation par identifiant de catalogue. */
export function findWarlockInvocation(id: string): WarlockInvocation | null {
  return WARLOCK_INVOCATIONS.find((i) => i.id === id) ?? null;
}
