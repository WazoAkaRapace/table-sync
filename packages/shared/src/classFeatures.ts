/**
 * Catalogue des capacités de classe (SRD 5.1 + Artificier Tasha) — français.
 *
 * Convention de nommage : noms selon AideDD.org (traduction officielle du PHB
 * 2014, pages /regles/classes/…). Couverture COMPLÈTE des tables de classes
 * (hors ASI et lignes structurelles de choix de sous-classe), vérifiée 2026-08
 * par un agent par classe.
 *
 * Les descriptions utilisent les placeholders {{...}} de renderFeatureTemplate
 * pour toute valeur dérivée du personnage (modificateurs, DD, niveau, bonus de
 * maîtrise) — le joueur voit la version calculée directement. Les nombres SRD
 * statiques (dés, seuils de niveau, comptes fixes) restent en texte.
 *
 * Chaque capacité : niveau d'acquisition, description courte et ressource
 * optionnelle (formule de taille + recharge). Les compteurs posés sur la fiche
 * via le catalogue servent au bouton Repos (court/long) et à la carte
 * Ressources de Survie ; le catalogue pré-remplit, le joueur décide
 * (effectiveFeatureReset).
 *
 * `max` retourne null pour « pas de compteur » : capacité sans usage limité,
 * ou illimitée (Rage au niveau 20) — la description l'explique alors.
 */

// Import runtime SÛR malgré le cycle index.ts ⇄ classFeatures.ts : les appels
// (classesOf) n'ont lieu qu'à l'exécution des fonctions, jamais à l'évaluation
// du module — pas d'accès TDZ dans le cycle ESM. Les types voyagent avec.
import {
  type Character,
  type CharacterClassEntry,
  classesOf,
  type FightingStyle,
} from './index.ts';

/** Modificateurs courts (str/dex/con/int/wis/cha) passés aux formules de ressources. */
export type AbilityMods = Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;

export type ResourceReset = 'short' | 'long';

export interface ClassFeatureResource {
  /** Taille maximale au niveau donné ; null = pas de compteur (illimité ou sans usage). */
  max: (level: number, mods: AbilityMods) => number | null;
  /** 'short' = repos court OU long ; 'long' = repos long uniquement. */
  reset: ResourceReset;
  /** La recharge passe à repos court à partir de ce niveau (ex. Inspiration bardique @5). */
  shortFromLevel?: number;
  /** Unité affichée (ex. pool de PV pour l'Imposition des mains). */
  unit?: 'PV';
}

export interface ClassFeatureDef {
  /** Identifiant stable du catalogue, stocké sur la ligne de trait (character_features.catalog_id). */
  id: string;
  /** Niveau d'acquisition. */
  level: number;
  name: string;
  description: string;
  resource?: ClassFeatureResource;
  /** Capacité déjà calculée/suivie nativement par la fiche (libellé « géré par la fiche »). */
  native?: boolean;
}

export interface SubclassDef {
  /** Clé stockée en base (colonne `subclass`, ou colonne dédiée : druidCircle/divineDomain/sacredOath). */
  key: string;
  label: string;
  /** Niveau d'acquisition de la sous-classe (3 en général, 1 pour Ensorceleur/Occultiste, 2 Barde/Druide). */
  level: number;
  /** Capacités de la sous-classe. */
  features: ClassFeatureDef[];
}

/** Modificateur d'une caractéristique (identique à abilityModifier, copié local pour éviter un cycle). */
function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

const modsFrom = (c: Character): AbilityMods => ({
  str: mod(c.strength ?? 10),
  dex: mod(c.dexterity ?? 10),
  con: mod(c.constitution ?? 10),
  int: mod(c.intelligence ?? 10),
  wis: mod(c.wisdom ?? 10),
  cha: mod(c.charisma ?? 10),
});

/** Table de rage (PHB 2014) : 2@1, 3@3, 4@6, 5@12, 6@17, illimité@20. */
function rageUses(level: number): number | null {
  if (level >= 20) return null; // Champion primitif : rage illimitée
  if (level >= 17) return 6;
  if (level >= 12) return 5;
  if (level >= 6) return 4;
  if (level >= 3) return 3;
  return 2;
}

/** Conduit divin (Clerc/Paladin) : 1@2(3), 2@6, 3@18. */
function channelDivinityUses(level: number): number {
  if (level >= 18) return 3;
  if (level >= 6) return 2;
  return 1;
}

// ---------- Capacités de classe (base) ----------

export const CLASS_FEATURES: Record<string, ClassFeatureDef[]> = {
  Artificier: [
    {
      id: 'artificier-bricolage-magique',
      level: 1,
      name: 'Bricolage magique',
      description:
        'Avec des outils d’artisan en main, conférez une propriété magique (lumière, son, odeur, image) à un objet non magique de taille TP — max. {{int_mod}} (min 1) objets affectés à la fois.',
    },
    {
      id: 'artificier-objets-infuses',
      level: 2,
      name: 'Imprégnation d’objet',
      description:
        'Conférez des propriétés magiques durables : 2 objets imprégnés simultanément (3 au niv. 6, 4 au niv. 10, 5 au niv. 14, 6 au niv. 18) parmi 4 imprégnations connues (6/8/10/12 aux mêmes paliers) ; échange possible à chaque prise de niveau.',
      resource: {
        max: (level) => (level >= 18 ? 6 : level >= 14 ? 5 : level >= 10 ? 4 : level >= 6 ? 3 : 2),
        reset: 'long',
      },
    },
    {
      id: 'artificier-bon-outil',
      level: 3,
      name: 'Outil de circonstance',
      description:
        'Avec des outils de bricoleur en main, créez en 1 heure (repos possible) des outils d’artisan du type de votre choix dans un espace libre à 1,50 m ; ils disparaissent à la réutilisation.',
    },
    {
      id: 'artificier-expertise-outillage',
      level: 6,
      name: 'Expertise de l’outillage',
      description: 'Bonus de maîtrise doublé pour tout jet utilisant la maîtrise d’un outil.',
      native: true,
    },
    {
      id: 'artificier-genie-eclair',
      level: 7,
      name: 'Trait de génie',
      description:
        'En réaction, ajoutez {{int_mod}} à un test de caractéristique ou une sauvegarde — le vôtre ou celui d’une créature visible à 9 m ou moins de vous.',
      resource: { max: (_level, m) => Math.max(1, m.int), reset: 'long' },
    },
    {
      id: 'artificier-adepte-objets-magiques',
      level: 10,
      name: 'Adepte des objets magiques',
      description:
        'Liez-vous à 4 objets magiques à la fois ; fabrication d’objets communs ou peu communs en un quart du temps pour la moitié du coût.',
    },
    {
      id: 'artificier-objet-receptacle',
      level: 11,
      name: 'Objet de stockage de sort',
      description:
        'Stockez un sort d’artificier de niv. 1 ou 2 dans une arme ou un focaliseur ; toute créature le tenant peut le lancer (DD {{save_dc}}) — 2 × {{int_mod}} (min 2) utilisations, re-stockable après un repos long.',
    },
    {
      id: 'artificier-erudit-objets-magiques',
      level: 14,
      name: 'Érudit des objets magiques',
      description:
        'Ignorez toute exigence de classe, race, sort ou niveau pour utiliser ou lier un objet magique (5 liaisons à la fois).',
    },
    {
      id: 'artificier-maitre-objets-magiques',
      level: 18,
      name: 'Maître des objets magiques',
      description: 'Vous pouvez vous lier à 6 objets magiques à la fois.',
    },
    {
      id: 'artificier-ame-artifice',
      level: 20,
      name: 'Âme de l’artifice',
      description:
        '+1 aux sauvegardes par objet magique lié ; en réaction, terminez une imprégnation pour rester à 1 PV au lieu de tomber à 0.',
    },
  ],
  Barbare: [
    {
      id: 'barbare-rage',
      level: 1,
      name: 'Rage',
      description:
        'En action bonus : sans armure lourde, avantage aux tests et sauvegardes de Force ({{save:str}}), +2 aux dégâts de mêlée utilisant la Force (+3 au niv. 9, +4 au niv. 16) et résistance aux dégâts contondants, perforants et tranchants ; 1 minute, sans lancer ni se concentrer sur un sort. Utilisations : 2 (3 au niv. 3, 4 au niv. 6, 5 au niv. 12, 6 au niv. 17, illimité au niv. 20) — repos long.',
      resource: { max: (level) => rageUses(level), reset: 'long' },
    },
    {
      id: 'barbare-defense-sans-armure',
      level: 1,
      name: 'Défense sans armure',
      description:
        'Sans armure : CA = 10 + {{dex_mod}} + {{con_mod}} (le bouclier reste autorisé).',
      native: true,
    },
    {
      id: 'barbare-attaque-imprudente',
      level: 2,
      name: 'Attaque téméraire',
      description:
        'Dès votre première attaque du tour : avantage à vos attaques de mêlée de Force ; en échange, les attaques contre vous ont l’avantage jusqu’à votre prochain tour.',
    },
    {
      id: 'barbare-sens-du-danger',
      level: 2,
      name: 'Sens du danger',
      description:
        'Avantage aux sauvegardes de Dextérité ({{save:dex}}) contre les effets visibles, si vous n’êtes ni aveuglé, ni assourdi, ni incapable d’agir.',
    },
    {
      id: 'barbare-attaque-supplementaire',
      level: 5,
      name: 'Attaque supplémentaire',
      description: 'Vous attaquez deux fois avec l’action Attaquer.',
      native: true,
    },
    {
      id: 'barbare-deplacement-rapide',
      level: 5,
      name: 'Déplacement rapide',
      description: '+3 m de vitesse tant que vous ne portez pas d’armure lourde.',
      native: true,
    },
    {
      id: 'barbare-instinct-feroce',
      level: 7,
      name: 'Instinct sauvage',
      description:
        'Avantage à l’initiative ; si vous êtes surpris et capable d’agir, vous jouez normalement votre premier tour en entrant en rage avant tout autre action.',
    },
    {
      id: 'barbare-critical-brutal',
      level: 9,
      name: 'Critique brutal',
      description:
        'Sur un critique de mêlée, +1 dé de dégâts de l’arme (2 dés au niv. 13, 3 dés au niv. 17).',
    },
    {
      id: 'barbare-rage-implacable',
      level: 11,
      name: 'Rage implacable',
      description:
        'À 0 PV en rage sans mourir : sauvegarde de CON DD 10 ({{save:con}}) pour retomber à 1 PV ; +5 au DD à chaque utilisation après la première, DD de retour à 10 après un repos court ou long.',
    },
    {
      id: 'barbare-persistance-rage',
      level: 15,
      name: 'Rage persistante',
      description:
        'Votre rage ne se termine plus prématurément (sauf inconscience ou action bonus pour y mettre fin).',
    },
    {
      id: 'barbare-puissance-indomptable',
      level: 18,
      name: 'Puissance indomptable',
      description:
        'Si un jet de Force est inférieur à votre valeur de Force, utilisez votre valeur à la place.',
    },
    {
      id: 'barbare-champion-primordial',
      level: 20,
      name: 'Champion primitif',
      description: 'Force et Constitution +4 (max 24) ; rage illimitée.',
    },
  ],
  Barde: [
    {
      id: 'barde-inspiration-bardique',
      level: 1,
      name: 'Inspiration bardique',
      description:
        'En action bonus, une créature autre que vous, à 18 m et vous entendant, gagne un dé d’Inspiration bardique ({{bardic_die}}) à ajouter une fois à un jet de caractéristique, une attaque ou une sauvegarde dans les 10 min. Utilisations : {{cha_mod}} (min 1) — repos long (repos court dès le niv. 5).',
      resource: {
        max: (_level, m) => Math.max(1, m.cha),
        reset: 'long',
        shortFromLevel: 5,
      },
    },
    {
      id: 'barde-don-des-multiples',
      level: 2,
      name: 'Touche-à-tout',
      description:
        'Ajoutez la moitié de votre bonus de maîtrise ({{prof}} ÷ 2, arrondi au chiffre inférieur) à tout jet de caractéristique qui n’utilise pas déjà votre maîtrise.',
    },
    {
      id: 'barde-chant-de-repos',
      level: 2,
      name: 'Chant reposant',
      description:
        'À la fin d’un repos court, vous et les alliés vous entendant récupérez +{{song_die}} PV supplémentaires par dé de vie dépensé.',
    },
    {
      id: 'barde-expertise',
      level: 3,
      name: 'Expertise',
      description:
        'Deux compétences maîtrisées doublent leur bonus de maîtrise, deux autres au niveau 10 — géré par l’onglet Compétences.',
      native: true,
    },
    {
      id: 'barde-source-inspiration',
      level: 5,
      name: 'Source d’inspiration',
      description:
        'Vous regagnez vos Inspirations bardiques utilisées lorsque vous terminez un repos court ou long.',
    },
    {
      id: 'barde-contre-charme',
      level: 6,
      name: 'Contre-charme',
      description:
        'En action : vous et les alliés à 9 m vous entendant avez avantage à vos jets de sauvegarde contre être effrayé ou charmé jusqu’à la fin de votre prochain tour.',
    },
    {
      id: 'barde-secrets-magiques',
      level: 10,
      name: 'Secrets magiques',
      description:
        'Apprenez 2 sorts de n’importe quelle classe, d’un niveau lançable selon la table du barde ou des sorts mineurs ; ils comptent comme sorts de barde (+2 aux niveaux 14 et 18).',
    },
    {
      id: 'barde-inspiration-superieure',
      level: 20,
      name: 'Inspiration supérieure',
      description:
        'Lorsque vous lancez l’initiative et n’avez plus d’Inspiration bardique, vous regagnez une utilisation.',
    },
  ],
  Clerc: [
    {
      id: 'clerc-canalisation-divine',
      level: 2,
      name: 'Conduit divin',
      description:
        'Vous canalisez l’énergie divine (Renvoi des morts-vivants ou l’option de votre domaine, DD {{save_dc}}). Utilisations : 1 (2 au niv. 6, 3 au niv. 18) — repos court ou long.',
      resource: { max: (level) => channelDivinityUses(level), reset: 'short' },
    },
    {
      id: 'clerc-renvoi-morts-vivants',
      level: 2,
      name: 'Renvoi des morts-vivants',
      description:
        'Action : chaque mort-vivant à 9 m vous voyant ou vous entendant sauvegarde de Sagesse ({{save_dc}}) ; échec = renvoyé 1 minute ou jusqu’à dégâts (doit s’éloigner, uniquement Foncer/s’échapper/Esquiver).',
    },
    {
      id: 'clerc-destruction-morts-vivants',
      level: 5,
      name: 'Destruction des morts-vivants',
      description:
        'Un mort-vivant qui rate sa sauvegarde de Renvoi des morts-vivants est détruit si sa FP ≤ ½ (FP 1 au niv. 8, 2 au niv. 11, 3 au niv. 14, 4 au niv. 17).',
    },
    {
      id: 'clerc-intervention-divine',
      level: 10,
      name: 'Intervention divine',
      description:
        'Vous implorez votre divinité : réussite sur d100 ≤ {{level}} — réutilisable après 7 jours (repos long en cas d’échec). Compteur approximé à 1/repos long.',
      resource: { max: () => 1, reset: 'long' },
    },
    {
      id: 'clerc-intervention-divine-superieure',
      level: 20,
      name: 'Intervention divine supérieure',
      description: 'Votre appel réussit automatiquement, sans jet — réutilisable après 7 jours.',
    },
  ],
  Druide: [
    {
      id: 'druide-druidique',
      level: 1,
      name: 'Druidique',
      description:
        'Vous connaissez le druidique, langue secrète des druides, et pouvez laisser des messages cachés repérés par un jet de Sagesse (Perception) DD 15 — langue gérée dans l’onglet Compétences.',
      native: true,
    },
    {
      id: 'druide-forme-sauvage',
      level: 2,
      name: 'Forme sauvage',
      description:
        '2 utilisations récupérées après un repos court ou long ; au niv. 2, bête de FP ≤ ¼ sans vol ni nage, durée {{level}} ÷ 2 heures (arrondi inférieur) — CR, vol/nage, formes vues et PV suivis nativement (onglet Survie).',
      native: true,
    },
    {
      id: 'druide-forme-sauvage-amelioree-4',
      level: 4,
      name: 'Forme sauvage améliorée (nage)',
      description:
        'Forme sauvage : bêtes de FP ≤ ½, nage autorisée (vol toujours interdit) — intégré au suivi natif.',
      native: true,
    },
    {
      id: 'druide-forme-sauvage-amelioree-8',
      level: 8,
      name: 'Forme sauvage améliorée (vol)',
      description:
        'Forme sauvage : bêtes de FP ≤ 1, vol et nage autorisés — intégré au suivi natif.',
      native: true,
    },
    {
      id: 'druide-corps-immortel',
      level: 18,
      name: 'Jeunesse éternelle',
      description: 'La magie primordiale ralentit votre vieillissement : 1 an d’âge par décennie.',
    },
    {
      id: 'druide-forme-animale',
      level: 18,
      name: 'Incantation animale',
      description:
        'Vous lancez vos sorts de druide en forme sauvage (composantes verbales et somatiques comprises, pas matérielles).',
    },
    {
      id: 'druide-archidruide',
      level: 20,
      name: 'Archidruide',
      description:
        'Forme sauvage illimitée ; ignorez les composantes verbales, somatiques et matérielles sans coût ni consommation.',
      native: true,
    },
  ],
  Ensorceleur: [
    {
      id: 'ensorceleur-source-de-magie',
      level: 2,
      name: 'Source de magie',
      description:
        '{{level}} points de sorcellerie (repos long). En action bonus : créez un emplacement (coût 2/3/5/6/7 pts par niveau 1-5) ou convertissez un emplacement en points égaux à son niveau.',
      resource: { max: (level) => level, reset: 'long' },
    },
    {
      id: 'ensorceleur-metamagie',
      level: 3,
      name: 'Métamagie',
      description:
        '2 options modifiant vos sorts au lancer contre des points de sorcellerie (Sort jumeau, accéléré, subtil, prévenant, ample, étendu, intensifié, renforcé) ; +1 option aux niv. 10 et 17.',
    },
    {
      id: 'ensorceleur-restauration-sorciere',
      level: 20,
      name: 'Restauration ensorcelée',
      description: 'Vous regagnez 4 points de sorcellerie après chaque repos court.',
    },
  ],
  Guerrier: [
    {
      id: 'guerrier-style-de-combat',
      level: 1,
      name: 'Style de combat',
      description:
        'Choisissez un style : Archerie, Arme à deux mains, Combat à deux armes, Défense, Duel ou Protection — sélectionnable dans l’onglet Caractéristiques.',
      native: true,
    },
    {
      id: 'guerrier-second-souffle',
      level: 1,
      name: 'Second souffle',
      description:
        'En action bonus, regagnez 1d10 + {{level}} PV — 1 utilisation par repos court ou long.',
      resource: { max: () => 1, reset: 'short' },
    },
    {
      id: 'guerrier-sursaut-activite',
      level: 2,
      name: 'Fougue',
      description:
        'À votre tour, gagnez une action supplémentaire (2 util. au niv. 17, 1×/tour) — 1 par repos court ou long.',
      resource: { max: (level) => (level >= 17 ? 2 : 1), reset: 'short' },
    },
    {
      id: 'guerrier-archetype-martial',
      level: 3,
      name: 'Archétype martial',
      description: 'Choisissez votre archétype — sélectionnable dans l’onglet Caractéristiques.',
      native: true,
    },
    {
      id: 'guerrier-attaque-supplementaire',
      level: 5,
      name: 'Attaque supplémentaire',
      description: '2 attaques au niv. 5, 3 au niv. 11, 4 au niv. 20 avec l’action Attaquer.',
      native: true,
    },
    {
      id: 'guerrier-indomptable',
      level: 9,
      name: 'Inflexible',
      description:
        'Relancez une sauvegarde ratée, nouveau résultat obligatoire (1 util. au niv. 9, 2 au niv. 13, 3 au niv. 17) — repos long.',
      resource: { max: (level) => (level >= 17 ? 3 : level >= 13 ? 2 : 1), reset: 'long' },
    },
  ],
  Magicien: [
    {
      id: 'magicien-recuperation-arcanique',
      level: 1,
      name: 'Restauration arcanique',
      description:
        '1×/jour, après un repos court, récupérez des emplacements dépensés d’un niveau total ≤ {{level}} ÷ 2 (arrondi supérieur, max niv. 5).',
      resource: { max: () => 1, reset: 'long' },
    },
    {
      id: 'magicien-ecole-de-magie',
      level: 2,
      name: 'Tradition arcanique',
      description:
        'Choisissez l’une des huit écoles de magie — sélectionnable dans l’onglet Caractéristiques.',
      native: true,
    },
    {
      id: 'magicien-maitrise-de-la-magie',
      level: 18,
      name: 'Maîtrise des sorts',
      description:
        'Choisissez un sort de niv. 1 et un de niv. 2 de votre grimoire : lancez-les à volonté au niveau minimum (échangeables après 8 h d’étude).',
    },
    {
      id: 'magicien-sorts-signature',
      level: 20,
      name: 'Sorts de prédilection',
      description:
        '2 sorts de niv. 3 toujours préparés (hors quota), chacun lançable 1× gratuitement au niv. 3 par repos court ou long (emplacements pour les niveaux supérieurs).',
    },
  ],
  Moine: [
    {
      id: 'moine-arts-martiaux',
      level: 1,
      name: 'Arts martiaux',
      description:
        'Dés de dégâts d4 → d10 (niv. 17) pour les armes de moine et les attaques à mains nues ; la Dextérité remplace la Force ; une attaque à mains nues en action bonus après l’action Attaquer.',
      native: true,
    },
    {
      id: 'moine-defense-sans-armure',
      level: 1,
      name: 'Défense sans armure',
      description: 'Sans armure ni bouclier : CA = 10 + {{dex_mod}} + {{wis_mod}}.',
      native: true,
    },
    {
      id: 'moine-ki',
      level: 2,
      name: 'Ki',
      description:
        '{{level}} points de ki (repos court ou long, 30 min de méditation) ; DD du ki = 8 + {{prof}} + {{wis_mod}}. Dépenses : Déluge de coups (2 attaques à mains nues en action bonus), Défense patiente (action Esquiver en action bonus), Déplacement aérien (Se désengager ou Foncer + saut doublé en action bonus) — 1 ki chacune.',
      resource: { max: (level) => level, reset: 'short' },
    },
    {
      id: 'moine-deplacement-sans-armure',
      level: 2,
      name: 'Déplacement sans armure',
      description:
        '+3 m de vitesse sans armure ni bouclier (+4,50 m au niv. 6, +6 m au niv. 10, +7,50 m au niv. 14, +9 m au niv. 18).',
      native: true,
    },
    {
      id: 'moine-deviation-projectiles',
      level: 3,
      name: 'Parade de projectiles',
      description:
        'Réaction contre une attaque à distance : dégâts réduits de 1d10 + {{level}} + {{dex_mod}} ; si réduits à 0, attrapez le projectile et dépensez 1 ki pour le renvoyer (attaque à distance 6/18 m).',
    },
    {
      id: 'moine-chute-lente',
      level: 4,
      name: 'Chute ralentie',
      description: 'En réaction, réduisez les dégâts de chute de 5 × {{level}}.',
    },
    {
      id: 'moine-attaque-supplementaire',
      level: 5,
      name: 'Attaque supplémentaire',
      description: 'Vous attaquez deux fois avec l’action Attaquer.',
      native: true,
    },
    {
      id: 'moine-frappe-etourdissante',
      level: 5,
      name: 'Frappe étourdissante',
      description:
        'En touchant au corps à corps, dépensez 1 ki : sauvegarde de CON DD 8 + {{prof}} + {{wis_mod}} ou la cible est étourdie jusqu’à la fin de votre prochain tour.',
    },
    {
      id: 'moine-frappes-de-ki',
      level: 6,
      name: 'Frappes de ki',
      description:
        'Vos attaques à mains nues comptent comme magiques pour vaincre la résistance et l’immunité aux dégâts non-magiques.',
    },
    {
      id: 'moine-evasion',
      level: 7,
      name: 'Esquive totale',
      description:
        'Effet de zone avec sauvegarde de Dextérité ({{save:dex}}) pour demi-dégâts : aucun dégât si vous réussissez, moitié des dégâts si vous échouez.',
    },
    {
      id: 'moine-serenite',
      level: 7,
      name: 'Sérénité',
      description: 'En action, mettez fin à un effet qui vous inflige l’état charmé ou effrayé.',
    },
    {
      id: 'moine-deplacement-sans-armure-ameliore',
      level: 9,
      name: 'Déplacement sans armure amélioré',
      description:
        'Durant votre tour, vous pouvez courir sur les parois verticales et la surface des liquides sans tomber.',
    },
    {
      id: 'moine-corps-pur',
      level: 10,
      name: 'Pureté physique',
      description: 'Immunité aux maladies et aux poisons.',
    },
    {
      id: 'moine-langue-soleil-lune',
      level: 13,
      name: 'Langue du soleil et de la lune',
      description:
        'Vous comprenez toutes les langues parlées ; toute créature comprenant un langage vous comprend.',
    },
    {
      id: 'moine-ame-de-diamant',
      level: 14,
      name: 'Âme de diamant',
      description:
        'Maîtrise de toutes les sauvegardes ; 1 ki pour relancer une sauvegarde ratée (second résultat obligatoire).',
    },
    {
      id: 'moine-jeunesse-eternelle',
      level: 15,
      name: 'Jeunesse éternelle',
      description:
        'Vous ne subissez plus les affres de la vieillesse, ne pouvez être vieilli par magie, et n’avez plus besoin de manger ni boire.',
    },
    {
      id: 'moine-desertion-ame',
      level: 18,
      name: 'Désertion de l’âme',
      description:
        '4 ki : invisible 1 min + résistance à tous les dégâts sauf de force ; 8 ki : Projection astrale sur vous seul.',
    },
    {
      id: 'moine-perfection-de-soi',
      level: 20,
      name: 'Perfection de l’être',
      description: 'À l’initiative sans points de ki, regagnez 4 points de ki.',
    },
  ],
  Occultiste: [
    {
      id: 'occultiste-invocations',
      level: 2,
      name: 'Manifestations occultes',
      description:
        'Des fragments d’un savoir interdit (ex. Déchaînement occulte) conférant une capacité magique permanente ; certaines ont des prérequis. Vous en connaissez {{invocations}}, remplaçables en gagnant un niveau.',
    },
    {
      id: 'occultiste-faveur-de-pacte',
      level: 3,
      name: 'Faveur de pacte',
      description:
        'Chaîne : Appel de familier en rituel (formes étendues, attaque en réaction si vous renoncez à une attaque) ; Lame : arme de pacte magique créée en action (rituel d’1 h pour lier une arme magique) ; Grimoire : livre des Ombres avec 3 sorts mineurs de n’importe quelle liste, à volonté.',
    },
    {
      id: 'occultiste-arcanum-6',
      level: 11,
      name: 'Arcanum mystique (niveau 6)',
      description: 'Apprenez 1 sort de niveau 6, lançable 1× sans emplacement par repos long.',
      resource: { max: () => 1, reset: 'long' },
    },
    {
      id: 'occultiste-arcanum-7',
      level: 13,
      name: 'Arcanum mystique (niveau 7)',
      description: 'Apprenez 1 sort de niveau 7, lançable 1× sans emplacement par repos long.',
      resource: { max: () => 1, reset: 'long' },
    },
    {
      id: 'occultiste-arcanum-8',
      level: 15,
      name: 'Arcanum mystique (niveau 8)',
      description: 'Apprenez 1 sort de niveau 8, lançable 1× sans emplacement par repos long.',
      resource: { max: () => 1, reset: 'long' },
    },
    {
      id: 'occultiste-arcanum-9',
      level: 17,
      name: 'Arcanum mystique (niveau 9)',
      description: 'Apprenez 1 sort de niveau 9, lançable 1× sans emplacement par repos long.',
      resource: { max: () => 1, reset: 'long' },
    },
    {
      id: 'occultiste-maitre-occulte',
      level: 20,
      name: 'Maître de l’occulte',
      description:
        'En 1 minute passée à supplier votre patron, récupérez tous vos emplacements de sorts de pacte — 1× par repos long.',
      resource: { max: () => 1, reset: 'long' },
    },
  ],
  Paladin: [
    {
      id: 'paladin-sens-divins',
      level: 1,
      name: 'Sens divin',
      description:
        'En action, jusqu’à la fin de votre prochain tour : percevez l’emplacement et le type des célestes, fiélons et morts-vivants à 18 m (hors abri total), et détectez les lieux ou objets consacrés ou profanés. Utilisations : 1 + {{cha_mod}} — repos long.',
      resource: { max: (_level, m) => Math.max(1, 1 + m.cha), reset: 'long' },
    },
    {
      id: 'paladin-imposition-des-mains',
      level: 1,
      name: 'Imposition des mains',
      description:
        'Réserve de {{lay_on_hands}} PV (5 × niveau), repos long. En action : soignez une créature touchée, ou dépensez 5 PV pour guérir une maladie ou neutraliser un poison.',
      resource: { max: (level) => 5 * level, reset: 'long', unit: 'PV' },
    },
    {
      id: 'paladin-chatiment-divin',
      level: 2,
      name: 'Châtiment divin',
      description:
        'Sur une touche d’arme de mêlée, dépensez un emplacement de sort : +2d8 dégâts radiants, +1d8 par niveau d’emplacement au-delà du 1er (max 5d8 ; 6d8 contre morts-vivants et fiélons). Accès rapide sur les cartes d’attaque.',
    },
    {
      id: 'paladin-canalisation-divine',
      level: 3,
      name: 'Conduit divin',
      description:
        'Options du serment sacré (DD {{save_dc}}). Utilisations : 1 (2 au niv. 6, 3 au niv. 18) — repos court ou long.',
      resource: { max: (level) => channelDivinityUses(level), reset: 'short' },
    },
    {
      id: 'paladin-sante-divine',
      level: 3,
      name: 'Santé divine',
      description: 'La magie divine vous immunise contre les maladies.',
    },
    {
      id: 'paladin-attaque-supplementaire',
      level: 5,
      name: 'Attaque supplémentaire',
      description: 'Vous attaquez deux fois avec l’action Attaquer.',
      native: true,
    },
    {
      id: 'paladin-aura-de-protection',
      level: 6,
      name: 'Aura de protection',
      description:
        'Vous et les alliés à 3 m (9 m au niv. 18) ajoutez {{cha_mod}} (min +1) à toutes vos sauvegardes tant que vous êtes conscient — affiché sur vos sauvegardes.',
      native: true,
    },
    {
      id: 'paladin-aura-de-courage',
      level: 10,
      name: 'Aura de courage',
      description:
        'Vous et les alliés à 3 m (9 m au niv. 18) ne pouvez être effrayés tant que vous êtes conscient.',
    },
    {
      id: 'paladin-chatiment-divin-ameliore',
      level: 11,
      name: 'Châtiment divin amélioré',
      description: 'Toutes vos attaques d’arme de mêlée infligent +1d8 dégâts radiants.',
    },
    {
      id: 'paladin-toucher-purificateur',
      level: 14,
      name: 'Contact purifiant',
      description:
        'En action, mettez fin à un sort sur vous ou une créature consentante touchée. Utilisations : {{cha_mod}} (min 1) — repos long.',
      resource: { max: (_level, m) => Math.max(1, m.cha), reset: 'long' },
    },
    {
      id: 'paladin-amelioration-auras',
      level: 18,
      name: 'Amélioration d’auras',
      description: 'Le rayon de vos auras passe de 3 m à 9 m.',
      native: true,
    },
  ],
  Rôdeur: [
    {
      id: 'rodeur-ennemi-favori',
      level: 1,
      name: 'Ennemi juré',
      description:
        'Choisissez un type d’ennemi juré ou deux races d’humanoïdes (+1 aux niv. 6 et 14) : avantage à la Survie ({{skill:survival}}) pour les pister et à l’Intelligence pour s’en souvenir ; vous apprenez une de leurs langues.',
    },
    {
      id: 'rodeur-explorateur-naturel',
      level: 1,
      name: 'Explorateur-né',
      description:
        'Un terrain favori (+1 aux niv. 6 et 10) : bonus de maîtrise doublé aux jets d’Intelligence/Sagesse liés si vous utilisez une compétence maîtrisée ; en voyage d’une heure : terrain difficile non ralentissant, groupe ne se perd pas (sauf magie), déplacement furtif au rythme normal en solo, nourriture doublée.',
    },
    {
      id: 'rodeur-conscience-primordiale',
      level: 3,
      name: 'Vigilance primitive',
      description:
        'En action + 1 emplacement de sort (1 min/niveau d’emplacement) : sentez la présence (ni l’emplacement, ni le nombre) des aberrations, célestes, dragons, élémentaires, fées, fiélons et morts-vivants à 1,5 km (9 km en terrain favori).',
    },
    {
      id: 'rodeur-attaque-supplementaire',
      level: 5,
      name: 'Attaque supplémentaire',
      description: 'Vous attaquez deux fois avec l’action Attaquer.',
      native: true,
    },
    {
      id: 'rodeur-foulee-de-la-terre',
      level: 8,
      name: 'Foulée tellurique',
      description:
        'Terrain difficile non magique sans surcoût de déplacement, végétation non magique sans ralenti ; avantage aux sauvegardes contre les plantes magiques entravant (ex. enchevêtrement).',
    },
    {
      id: 'rodeur-dissimulation-naturelle',
      level: 10,
      name: 'Camouflage naturel',
      description:
        'En 1 minute, créez un camouflage : +10 à la Discrétion ({{skill:stealth}}) tant que vous restez immobile sans action ni réaction, contre une surface aussi grande que vous.',
    },
    {
      id: 'rodeur-disparition',
      level: 14,
      name: 'Disparition',
      description:
        'Se cacher en action bonus ; impossible d’être pisté par des moyens non magiques.',
    },
    {
      id: 'rodeur-sens-feroce',
      level: 18,
      name: 'Sens sauvages',
      description:
        'Pas de désavantage d’attaque contre les créatures que vous ne voyez pas ; position connue des invisibles à 9 m (sauf si cachées de vous et si vous n’êtes ni aveuglé ni assourdi).',
    },
    {
      id: 'rodeur-fleau-des-ennemis',
      level: 20,
      name: 'Tueur implacable',
      description:
        'Une fois par tour, ajoutez {{wis_mod}} à un jet d’attaque ou de dégâts contre un ennemi juré, avant ou après le jet mais avant l’application des effets.',
    },
  ],
  Roublard: [
    {
      id: 'roublard-expertise',
      level: 1,
      name: 'Expertise',
      description:
        'Deux maîtrises (deux compétences, ou une et les outils de voleur) doublent leur bonus ; deux supplémentaires au niv. 6 — géré par l’onglet Compétences.',
      native: true,
    },
    {
      id: 'roublard-attaque-sournoise',
      level: 1,
      name: 'Attaque sournoise',
      description:
        'Une fois par tour, +{{sneak_dice}} dégâts avec une arme de finesse ou à distance, si vous avez l’avantage ou si un autre ennemi de la cible est à 1,50 m et que vous n’avez pas de désavantage — affiché sur les cartes d’attaque.',
      native: true,
    },
    {
      id: 'roublard-argot-des-voleurs',
      level: 1,
      name: 'Jargon des voleurs',
      description:
        'Vous comprenez le code secret des voleurs (signes et symboles cachés) — langue gérée dans l’onglet Compétences.',
      native: true,
    },
    {
      id: 'roublard-action-rusee',
      level: 2,
      name: 'Ruse',
      description:
        'À chaque tour en combat, une action bonus pour Se désengager, Se cacher (Discrétion {{skill:stealth}}) ou Foncer.',
    },
    {
      id: 'roublard-archetype',
      level: 3,
      name: 'Archétype de roublard',
      description:
        'Choisissez Voleur, Assassin ou Escroc arcanique — sélectionnable dans l’onglet Caractéristiques.',
      native: true,
    },
    {
      id: 'roublard-esquive-extraordinaire',
      level: 5,
      name: 'Esquive instinctive',
      description:
        'En réaction, quand un attaquant que vous pouvez voir vous touche : dégâts de l’attaque réduits de moitié.',
    },
    {
      id: 'roublard-evasion',
      level: 7,
      name: 'Esquive totale',
      description:
        'Zone d’effet avec sauvegarde de DEX ({{save:dex}}) pour demi-dégâts : aucun dégât en cas de réussite, moitié en cas d’échec.',
    },
    {
      id: 'roublard-talent-fiable',
      level: 11,
      name: 'Savoir-faire',
      description:
        'Pour tout test où vous ajoutez votre bonus de maîtrise, un d20 ≤ 9 compte comme 10.',
    },
    {
      id: 'roublard-perception-aveugle',
      level: 14,
      name: 'Perception aveugle',
      description:
        'Si vous entendez, vous connaissez l’emplacement des créatures cachées ou invisibles à 3 m ou moins.',
    },
    {
      id: 'roublard-esprit-glissant',
      level: 15,
      name: 'Esprit fuyant',
      description:
        'Maîtrise des sauvegardes de Sagesse ({{save:wis}}) — à cocher dans l’onglet Compétences.',
    },
    {
      id: 'roublard-insaisissable',
      level: 18,
      name: 'Insaisissable',
      description:
        'Aucun jet d’attaque n’a l’avantage contre vous tant que vous n’êtes pas incapable d’agir.',
    },
    {
      id: 'roublard-coup-de-chance',
      level: 20,
      name: 'Coup de chance',
      description:
        'Transformez un échec d’attaque en réussite, ou traitez le d20 d’un test de caractéristique raté comme un 20 — 1× par repos court ou long.',
      resource: { max: () => 1, reset: 'short' },
    },
  ],
};

// ---------- Sous-classes ----------
// Colonnes dédiées : Clerc (divine_domain), Druide (druid_circle/land_circle),
// Paladin (sacred_oath) ; les autres classes partagent la colonne `subclass`.
// featuresForCharacter résout la sous-classe active selon la classe.

export const CLASS_SUBCLASSES: Record<string, SubclassDef[]> = {
  Artificier: [
    {
      key: 'alchimiste',
      label: 'Alchimiste',
      level: 3,
      features: [
        {
          id: 'alchimiste-outils',
          level: 3,
          name: 'Maîtrise des outils',
          description: 'Vous gagnez la maîtrise des fournitures d’alchimiste.',
        },
        {
          id: 'alchimiste-sorts',
          level: 3,
          name: 'Sorts d’alchimiste',
          description:
            'Mot de guérison et Rayon empoisonné (niv. 3), Flèche acide de Melf et Sphère de feu (niv. 5), Forme gazeuse et Mot de guérison de groupe (niv. 9), Flétrissement et Protection contre la mort (niv. 13), Brume mortelle et Rappel à la vie (niv. 17) sont toujours préparés.',
        },
        {
          id: 'alchimiste-elixir-experimental',
          level: 3,
          name: 'Élixir expérimental',
          description:
            'À la fin d’un repos long, créez un élixir à effet aléatoire (d6 : soins 2d4+{{int_mod}}, rapidité, résilience, audace, vol, transformation) — 2 élixirs au niv. 6, 3 au niv. 15 ; 1 élixir supplémentaire par emplacement de niv. 1+ (effet au choix).',
          resource: {
            max: (level) => (level >= 15 ? 3 : level >= 6 ? 2 : 1),
            reset: 'long',
          },
        },
        {
          id: 'alchimiste-erudit-alchimique',
          level: 5,
          name: 'Érudit alchimique',
          description:
            'Avec des fournitures d’alchimiste comme focaliseur : +{{int_mod}} (min +1) à un jet de soins ou de dégâts (acide, feu, nécrotique, poison) d’un de vos sorts d’artificier.',
        },
        {
          id: 'alchimiste-ingredients-revigorants',
          level: 9,
          name: 'Ingrédients revigorants',
          description:
            'Boire un de vos élixirs donne 2d6+{{int_mod}} PV temporaires ; Restauration partielle lançable sans emplacement ni préparation ({{int_mod}} min 1 /repos long).',
          resource: { max: (_level, m) => Math.max(1, m.int), reset: 'long' },
        },
        {
          id: 'alchimiste-maitrise-chimique',
          level: 15,
          name: 'Maîtrise chimique',
          description:
            'Résistance à l’acide et au poison, immunité à l’état empoisonné ; Restauration supérieure et Soins gratuits 1 fois chacun par repos long.',
        },
      ],
    },
    {
      key: 'artilleur',
      label: 'Artilleur',
      level: 3,
      features: [
        {
          id: 'artilleur-outils',
          level: 3,
          name: 'Maîtrise des outils',
          description: 'Vous gagnez la maîtrise des outils de charpentier.',
        },
        {
          id: 'artilleur-sorts',
          level: 3,
          name: 'Sorts d’artilleur',
          description:
            'Bouclier et Vague tonnante (niv. 3), Rayon ardent et Fracassement (niv. 5), Boule de feu et Mur de vent (niv. 9), Tempête de grêle et Mur de feu (niv. 13), Cône de froid et Mur de force (niv. 17) sont toujours préparés.',
        },
        {
          id: 'artilleur-canon-occulte',
          level: 3,
          name: 'Canon occulte',
          description:
            'En action, créez un canon (CA 18, PV 5 × {{level}}, activable en action bonus à 18 m) : lance-flammes 2d8 feu (DD {{save_dc}}), baliste 2d8 force ({{spell_attack}}, repousse 1,50 m) ou protecteur (1d8+{{int_mod}} PV temporaires). Un seul canon à la fois, recréable après un repos long ou en dépensant un emplacement de niv. 1+.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'artilleur-arme-feu-arcanique',
          level: 5,
          name: 'Arme à feu arcanique',
          description:
            'Votre baguette/bâton/sceptre gravé sert de focaliseur : +1d8 à un jet de dégâts de chaque sort d’artificier lancé avec.',
        },
        {
          id: 'artilleur-canon-explosif',
          level: 9,
          name: 'Canon explosif',
          description:
            'Dégâts du canon +1d8 ; en action, faites-le exploser (3d8 force, DD {{save_dc}}) dans un rayon de 6 m.',
        },
        {
          id: 'artilleur-position-fortifiee',
          level: 15,
          name: 'Position fortifiée',
          description:
            'Vous et les alliés à 3 m d’un canon bénéficiez d’un abri partiel ; vous pouvez avoir deux canons à la fois, activables avec la même action bonus.',
        },
      ],
    },
    {
      key: 'forgeron-de-guerre',
      label: 'Forgeron de guerre',
      level: 3,
      features: [
        {
          id: 'forgeron-outils',
          level: 3,
          name: 'Maîtrise des outils',
          description: 'Vous gagnez la maîtrise des outils de forgeron.',
        },
        {
          id: 'forgeron-sorts',
          level: 3,
          name: 'Sorts de forgeron de guerre',
          description:
            'Héroïsme et Bouclier (niv. 3), Châtiment révélateur et Lien de protection (niv. 5), Aura de vitalité et Invocation de projectiles (niv. 9), Aura de pureté et Bouclier de feu (niv. 13), Châtiment du ban et Soins de groupe (niv. 17) sont toujours préparés.',
        },
        {
          id: 'forgeron-apte-au-combat',
          level: 3,
          name: 'Apte au combat',
          description:
            'Maîtrise des armes de guerre ; vous utilisez {{int_mod}} pour les jets d’attaque et de dégâts avec les armes magiques.',
        },
        {
          id: 'forgeron-defenseur-acier',
          level: 3,
          name: 'Défenseur d’acier',
          description:
            'Compagnon mécanique (CA 15, PV 2+{{int_mod}}+5×{{level}}) agissant après votre tour en action bonus ; ranimable en 1 h en dépensant un emplacement de niv. 1+, ou recréable après un repos long.',
        },
        {
          id: 'forgeron-attaque-supplementaire',
          level: 5,
          name: 'Attaque supplémentaire',
          description: 'Vous attaquez deux fois avec l’action Attaquer.',
        },
        {
          id: 'forgeron-decharge-arcanique',
          level: 9,
          name: 'Décharge arcanique',
          description:
            'Quand votre Défenseur touche ou que vous touchez avec une arme magique (1×/tour) : +2d6 force, ou 2d6 PV rendus à une créature ou un objet visible à 9 m ou moins de la cible.',
          resource: { max: (_level, m) => Math.max(1, m.int), reset: 'long' },
        },
        {
          id: 'forgeron-defenseur-ameliore',
          level: 15,
          name: 'Défenseur amélioré',
          description:
            'Décharge arcanique passe à 4d6 ; le Défenseur gagne +2 à la CA et inflige 1d4+{{int_mod}} dégâts de force à l’attaquant lors de sa Parade d’attaque.',
        },
      ],
    },
  ],
  Barbare: [
    {
      key: 'berserker',
      label: 'Voie du berserker',
      level: 3,
      features: [
        {
          id: 'berserker-frenesie',
          level: 3,
          name: 'Frénésie',
          description:
            'Option à l’entrée en rage : une unique attaque de mêlée en action bonus à chacun de vos tours après celui-ci ; quand la rage se termine, 1 niveau d’épuisement.',
        },
        {
          id: 'berserker-rage-aveugle',
          level: 6,
          name: 'Rage aveugle',
          description:
            'En rage, vous ne pouvez être charmé ni effrayé ; un tel effet actif est suspendu le temps de la rage.',
        },
        {
          id: 'berserker-intimidation',
          level: 10,
          name: 'Présence intimidante',
          description:
            'En action, une créature visible à 9 m pouvant vous voir ou entendre sauvegarde de Sagesse (DD 8 + {{prof}} + {{cha_mod}}) ou est effrayée jusqu’à la fin de votre prochain tour (action pour prolonger d’un tour) ; réussite = immunisée 24 h.',
        },
        {
          id: 'berserker-represailles',
          level: 14,
          name: 'Représailles',
          description:
            'Quand vous subissez des dégâts d’une créature à 1,50 m, réaction : attaque de mêlée contre elle.',
        },
      ],
    },
    {
      key: 'totem',
      label: 'Voie du guerrier totem',
      level: 3,
      features: [
        {
          id: 'totem-queteur-spirituel',
          level: 3,
          name: 'Quêteur spirituel',
          description:
            'Vous pouvez lancer Communication avec les animaux et Sens animal, mais seulement en rituels.',
        },
        {
          id: 'totem-esprit',
          level: 3,
          name: 'Esprit totem',
          description:
            'En rage, selon l’esprit : Ours — résistance à tous les dégâts sauf psychiques ; Aigle — sans armure lourde, désavantage aux attaques d’opportunité contre vous et Foncer en action bonus ; Loup — vos alliés ont l’avantage aux attaques de mêlée contre les hostiles à 1,50 m de vous.',
        },
        {
          id: 'totem-aspect-de-la-bete',
          level: 6,
          name: 'Aspect de la bête',
          description:
            'Selon votre totem : Aigle — vision d’aigle à 1,5 km (Perception {{skill:perception}} sans désavantage en faible lumière) ; Loup — pistage au rythme rapide et discrétion au rythme normal ; Ours — capacité de charge doublée et avantage à la Force ({{str_mod}}) pour pousser/soulever/tirer/briser.',
        },
        {
          id: 'totem-marcheur-spirituel',
          level: 10,
          name: 'Marcheur spirituel',
          description: 'Vous pouvez lancer Communion avec la nature, mais seulement en rituel.',
        },
        {
          id: 'totem-harmonisation',
          level: 14,
          name: 'Lien totémique',
          description:
            'En rage, selon votre totem : Aigle — vitesse de vol = vitesse au sol, mais chute si vous terminez votre tour en l’air ; Loup — action bonus pour mettre à terre une créature de taille G ou moins touchée par votre attaque de mêlée ; Ours — désavantage aux attaques des hostiles à 1,50 m visant une cible autre que vous.',
        },
      ],
    },
  ],
  Barde: [
    {
      key: 'savoir',
      label: 'Collège du Savoir',
      level: 3,
      features: [
        {
          id: 'savoir-maitrises-supplementaires',
          level: 3,
          name: 'Maîtrises supplémentaires',
          description:
            'Gagnez la maîtrise de trois compétences de votre choix (onglet Compétences).',
        },
        {
          id: 'savoir-mots-cinglants',
          level: 3,
          name: 'Mots cinglants',
          description:
            'En réaction, dépensez une Inspiration bardique pour soustraire le dé ({{bardic_die}}) à un jet d’attaque, de caractéristique ou de dégâts d’une créature visible à 18 m, après le jet mais avant le résultat ; sans effet si elle ne peut pas vous entendre ou si les charmes ne l’affectent pas.',
        },
        {
          id: 'savoir-secrets-magiques',
          level: 6,
          name: 'Secrets magiques supplémentaires',
          description:
            'Apprenez 2 sorts de n’importe quelle classe (d’un niveau lançable ou des sorts mineurs) : ils comptent comme sorts de barde et ne comptent pas dans votre quota de sorts connus.',
        },
        {
          id: 'savoir-competence-hors-pair',
          level: 14,
          name: 'Compétence hors-pair',
          description:
            'Dépensez une Inspiration bardique pour ajouter le dé ({{bardic_die}}) à vos propres jets de caractéristique, après le jet mais avant le résultat.',
        },
      ],
    },
  ],
  Clerc: [
    {
      key: 'vie',
      label: 'Domaine de la Vie',
      level: 1,
      features: [
        {
          id: 'vie-armures',
          level: 1,
          name: 'Maîtrise supplémentaire (Vie)',
          description: 'Vous acquérez la maîtrise des armures lourdes.',
        },
        {
          id: 'vie-disciple-de-la-vie',
          level: 1,
          name: 'Disciple de la vie',
          description:
            'Vos sorts de guérison de niv. 1+ rendent 2 + niveau du sort PV supplémentaires.',
        },
        {
          id: 'vie-conduit-preservation',
          level: 2,
          name: 'Conduit divin : préservation de la vie',
          description:
            'Répartissez 5 × {{level}} PV de guérison entre les créatures à 9 m (jusqu’à la moitié de leurs PV max ; sans effet sur morts-vivants et artificiels).',
        },
        {
          id: 'vie-guerisseur-beni',
          level: 6,
          name: 'Guérisseur béni',
          description:
            'Quand vous lancez un sort de guérison de niv. 1+ sur autrui, vous regagnez 2 + niveau du sort PV.',
        },
        {
          id: 'vie-frappe-divine',
          level: 8,
          name: 'Frappe divine (Vie)',
          description:
            'Une fois par tour, une attaque d’arme inflige +1d8 dégâts radiants (2d8 au niv. 14).',
        },
        {
          id: 'vie-guerison-supreme',
          level: 17,
          name: 'Guérison suprême',
          description: 'Tous vos sorts de guérison restaurent le maximum possible de PV.',
        },
      ],
    },
    {
      key: 'lumiere',
      label: 'Domaine de la Lumière',
      level: 1,
      features: [
        {
          id: 'lumiere-sort-mineur',
          level: 1,
          name: 'Sort mineur supplémentaire (Lumière)',
          description: 'Vous apprenez le sort mineur Lumière (SAG, hors quota).',
        },
        {
          id: 'lumiere-illumination-protectrice',
          level: 1,
          name: 'Illumination protectrice',
          description:
            'En réaction quand un ennemi visible à 9 m vous attaque : désavantage sur son jet d’attaque (inefficace contre un attaquant qui ne peut pas être aveuglé).',
          resource: { max: (_level, m) => Math.max(1, m.wis), reset: 'long' },
        },
        {
          id: 'lumiere-conduit-radiance',
          level: 2,
          name: 'Conduit divin : radiance de l’aube',
          description:
            'Action : dissipe les ténèbres magiques à 9 m et inflige 2d10 + {{level}} dégâts radiants aux hostiles à 9 m (CON, moitié).',
        },
        {
          id: 'lumiere-illumination-amelioree',
          level: 6,
          name: 'Illumination améliorée',
          description:
            'Illumination protectrice aussi utilisable en réaction quand une créature visible à 9 m attaque une créature autre que vous.',
        },
        {
          id: 'lumiere-incantation-puissante',
          level: 8,
          name: 'Incantation puissante (Lumière)',
          description: 'Vos sorts mineurs de clerc infligent +{{wis_mod}} dégâts.',
        },
        {
          id: 'lumiere-halo',
          level: 17,
          name: 'Halo de lumière',
          description:
            'Action : aura de lumière du soleil (vive sur 18 m, faible sur 9 m de plus) pendant 1 min ; ennemis dans la lumière vive : désavantage aux sauvegardes contre tout sort infligeant des dégâts de feu ou radiants.',
        },
      ],
    },
    {
      key: 'nature',
      label: 'Domaine de la Nature',
      level: 1,
      features: [
        {
          id: 'nature-acolyte',
          level: 1,
          name: 'Acolyte de la nature',
          description:
            'Vous apprenez un sort mineur de druide (SAG) et gagnez une maîtrise parmi Dressage ({{skill:animalHandling}}), Nature ({{skill:nature}}) ou Survie ({{skill:survival}}).',
        },
        {
          id: 'nature-armures',
          level: 1,
          name: 'Maîtrise supplémentaire (Nature)',
          description: 'Vous acquérez la maîtrise des armures lourdes.',
        },
        {
          id: 'nature-conduit-charme',
          level: 2,
          name: 'Conduit divin : charme des animaux et des plantes',
          description:
            'Action : bêtes et plantes à 9 m vous voyant sauvegardent de Sagesse ({{save_dc}}) ; échec = charmée 1 min ou jusqu’à dégâts.',
        },
        {
          id: 'nature-attenuation-elements',
          level: 6,
          name: 'Atténuation des éléments',
          description:
            'En réaction quand vous ou une créature à 9 m subit des dégâts d’acide, de froid, de feu, de foudre ou de tonnerre : résistance à ces dégâts.',
        },
        {
          id: 'nature-frappe-divine',
          level: 8,
          name: 'Frappe divine (Nature)',
          description:
            'Une fois par tour, une attaque d’arme inflige +1d8 dégâts de froid, de feu ou de foudre au choix (2d8 au niv. 14).',
        },
        {
          id: 'nature-maitre',
          level: 17,
          name: 'Maître de la nature',
          description:
            'Action bonus : commandez ce que feront au prochain tour les créatures charmées par votre charme des animaux et des plantes.',
        },
      ],
    },
    {
      key: 'tempete',
      label: 'Domaine de la Tempête',
      level: 1,
      features: [
        {
          id: 'tempete-maitrises',
          level: 1,
          name: 'Maîtrises supplémentaires (Tempête)',
          description: 'Vous acquérez la maîtrise des armes de guerre et des armures lourdes.',
        },
        {
          id: 'tempete-fureur-ouragan',
          level: 1,
          name: 'Fureur de l’ouragan',
          description:
            'En réaction quand un attaquant visible à 1,50 m vous touche : sauvegarde de DEX ({{save_dc}}) ; échec = 2d8 dégâts de foudre ou de tonnerre au choix, réussite = moitié.',
          resource: { max: (_level, m) => Math.max(1, m.wis), reset: 'long' },
        },
        {
          id: 'tempete-conduit-fureur-destructrice',
          level: 2,
          name: 'Conduit divin : fureur destructrice',
          description:
            'Vous infligez les dégâts maximum au lieu de lancer les dés sur un effet de foudre ou de tonnerre.',
        },
        {
          id: 'tempete-frappe-eclair',
          level: 6,
          name: 'Frappe de l’éclair',
          description:
            'Quand vous infligez des dégâts de foudre à une créature de taille G ou moins, vous la repoussez de 3 m.',
        },
        {
          id: 'tempete-frappe-divine',
          level: 8,
          name: 'Frappe divine (Tempête)',
          description:
            'Une fois par tour, une attaque d’arme inflige +1d8 dégâts de tonnerre (2d8 au niv. 14).',
        },
        {
          id: 'tempete-enfant',
          level: 17,
          name: 'Enfant de la tempête',
          description:
            'Vitesse de vol égale à votre vitesse au sol tant que vous n’êtes ni sous terre ni à l’intérieur.',
        },
      ],
    },
    {
      key: 'tromperie',
      label: 'Domaine de la duperie',
      level: 1,
      features: [
        {
          id: 'tromperie-benediction-escroc',
          level: 1,
          name: 'Bénédiction de l’escroc',
          description:
            'Action : une créature consentante (autre que vous) touchée gagne l’avantage à la Discrétion ({{skill:stealth}}) pendant 1 heure.',
        },
        {
          id: 'tromperie-conduit-replique',
          level: 2,
          name: 'Conduit divin : invocation de réplique',
          description:
            'Action : créez un double illusoire (1 min, concentration) déplaçable en action bonus (max 36 m de vous) ; vous lancez des sorts comme depuis son espace et avez l’avantage aux attaques contre une créature qui le voit et se trouve à 1,50 m de vous et du double.',
        },
        {
          id: 'tromperie-conduit-linceul',
          level: 6,
          name: 'Conduit divin : linceul d’ombre',
          description:
            'Action : vous devenez invisible jusqu’à la fin de votre prochain tour (vous redevenez visible si vous attaquez ou lancez un sort).',
        },
        {
          id: 'tromperie-frappe-divine',
          level: 8,
          name: 'Frappe divine (Duperie)',
          description:
            'Une fois par tour, une attaque d’arme inflige +1d8 dégâts de poison (2d8 au niv. 14).',
        },
        {
          id: 'tromperie-replique-amelioree',
          level: 17,
          name: 'Réplique améliorée',
          description:
            'Invocation de réplique crée jusqu’à quatre doublures, déplaçables en action bonus (9 m chacune, max 36 m de vous).',
        },
      ],
    },
    {
      key: 'guerre',
      label: 'Domaine de la Guerre',
      level: 1,
      features: [
        {
          id: 'guerre-maitrises',
          level: 1,
          name: 'Maîtrises supplémentaires (Guerre)',
          description: 'Vous acquérez la maîtrise des armes de guerre et des armures lourdes.',
        },
        {
          id: 'guerre-pretre-de-guerre',
          level: 1,
          name: 'Prêtre de guerre',
          description:
            'Quand vous utilisez l’action Attaquer, vous pouvez faire une attaque d’arme en action bonus.',
          resource: { max: (_level, m) => Math.max(1, m.wis), reset: 'long' },
        },
        {
          id: 'guerre-conduit-frappe-guidee',
          level: 2,
          name: 'Conduit divin : frappe guidée',
          description: '+10 à un jet d’attaque, après le jet mais avant de connaître le résultat.',
        },
        {
          id: 'guerre-conduit-benediction',
          level: 6,
          name: 'Conduit divin : bénédiction du dieu de guerre',
          description:
            'En réaction quand une créature à 9 m attaque : +10 à son jet d’attaque, après le jet mais avant le résultat.',
        },
        {
          id: 'guerre-frappe-divine',
          level: 8,
          name: 'Frappe divine (Guerre)',
          description:
            'Une fois par tour, une attaque d’arme inflige +1d8 dégâts du même type que l’arme (2d8 au niv. 14).',
        },
        {
          id: 'guerre-avatar',
          level: 17,
          name: 'Avatar de bataille',
          description:
            'Résistance aux dégâts contondants, perforants et tranchants d’attaques non magiques.',
        },
      ],
    },
    {
      key: 'savoir',
      label: 'Domaine du Savoir',
      level: 1,
      features: [
        {
          id: 'savoir-benedictions',
          level: 1,
          name: 'Bénédictions du savoir',
          description:
            'Vous apprenez 2 langues et gagnez 2 maîtrises doublées parmi Arcanes ({{skill:arcanes}}), Histoire ({{skill:history}}), Nature ({{skill:nature}}) ou Religion ({{skill:religion}}).',
        },
        {
          id: 'savoir-conduit-ancestral',
          level: 2,
          name: 'Conduit divin : savoir ancestral',
          description:
            'Action : maîtrise de n’importe quelle compétence ou outil pendant 10 minutes.',
        },
        {
          id: 'savoir-conduit-lecture-pensees',
          level: 6,
          name: 'Conduit divin : lecture des pensées',
          description:
            'Action, cible à 18 m : sauvegarde de Sagesse ({{save_dc}}) ; échec = lecture de ses pensées 1 min et Suggestion possible sans emplacement (sauvegarde ratée d’office) ; réussite = cette créature est immunisée jusqu’à votre prochain repos long.',
        },
        {
          id: 'savoir-incantation-puissante',
          level: 8,
          name: 'Incantation puissante (Savoir)',
          description: 'Vos sorts mineurs de clerc infligent +{{wis_mod}} dégâts.',
        },
        {
          id: 'savoir-visions-du-passe',
          level: 17,
          name: 'Visions du passé',
          description:
            'Au moins 1 minute de méditation sous concentration : visions du passé d’un objet ou d’une zone — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
      ],
    },
  ],
  Druide: [
    {
      key: 'terre',
      label: 'Cercle de la Terre',
      level: 2,
      features: [
        {
          id: 'terre-sort-mineur-supplementaire',
          level: 2,
          name: 'Sort mineur supplémentaire',
          description:
            'Apprenez un sort mineur de druide bonus, qui ne compte pas dans votre quota de sorts mineurs connus.',
        },
        {
          id: 'terre-recuperation-naturelle',
          level: 2,
          name: 'Récupération naturelle',
          description:
            'Après un repos court, récupérez des emplacements de sorts d’un niveau total ≤ {{level}} ÷ 2 (arrondi sup., max niv. 5) — 1× par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'terre-foulee-tellurique',
          level: 6,
          name: 'Foulée tellurique',
          description:
            'Terrain difficile non magique sans surcoût, végétation non magique sans ralenti ni dégâts (épines) ; avantage aux sauvegardes contre les plantes magiques entravant.',
        },
        {
          id: 'terre-protege-dame-nature',
          level: 10,
          name: 'Protégé de dame Nature',
          description:
            'Immunisé contre poison et maladies ; ne peut être charmé ni effrayé par les élémentaires et les fées.',
        },
        {
          id: 'terre-sanctuaire-nature',
          level: 14,
          name: 'Sanctuaire de dame Nature',
          description:
            'Une bête ou plante qui vous attaque doit réussir un jet de sauvegarde de Sagesse ({{save_dc}}), sinon elle choisit une autre cible ou rate automatiquement ; en cas de réussite, immunisée 24 h.',
        },
      ],
    },
    {
      key: 'lune',
      label: 'Cercle de la Lune',
      level: 2,
      features: [
        {
          id: 'lune-forme-sauvage-combative',
          level: 2,
          name: 'Forme sauvage de combat',
          description:
            'Forme sauvage en action bonus ; en forme, une action bonus peut dépenser un emplacement pour récupérer 1d8 PV par niveau d’emplacement.',
        },
        {
          id: 'lune-formes-du-cercle',
          level: 2,
          name: 'Formes du cercle',
          description:
            'FP max de forme sauvage = 1 au niv. 2, puis {{level}} ÷ 3 (arrondi inférieur, min 1) dès le niv. 6 — calculé nativement.',
          native: true,
        },
        {
          id: 'lune-frappe-primordiale',
          level: 6,
          name: 'Frappe primitive',
          description:
            'Vos attaques en forme sauvage comptent comme magiques pour surmonter résistances et immunités non magiques.',
        },
        {
          id: 'lune-forme-elementaire',
          level: 10,
          name: 'Forme sauvage élémentaire',
          description:
            'Dépensez 2 utilisations pour devenir un élémentaire d’air, de terre, de feu ou d’eau — intégré au sélecteur de formes.',
          native: true,
        },
        {
          id: 'lune-mille-formes',
          level: 14,
          name: 'Mille formes',
          description: 'Vous pouvez lancer Modification d’apparence à volonté, sur vous-même.',
        },
      ],
    },
  ],
  Ensorceleur: [
    {
      key: 'draconique',
      label: 'Lignée draconique',
      level: 1,
      features: [
        {
          id: 'draconique-ancetre-draconique',
          level: 1,
          name: 'Ancêtre draconique',
          description:
            'Choisissez votre type de dragon (dégâts des capacités ultérieures) ; vous parlez, lisez et écrivez le draconique et doublez votre maîtrise ({{prof}}) aux jets de Charisme face aux dragons.',
        },
        {
          id: 'draconique-resilience',
          level: 1,
          name: 'Résistance draconique',
          description:
            'PV max +1 par niveau d’ensorceleur ; sans armure : CA = 13 + {{dex_mod}} (bouclier autorisé) — calculée nativement.',
          native: true,
        },
        {
          id: 'draconique-affinite-elementaire',
          level: 6,
          name: 'Affinité élémentaire',
          description:
            'Vos sorts du type de votre dragon infligent +{{cha_mod}} à un seul jet de dégâts ; 1 point de sorcellerie = résistance à ce type pendant 1 h.',
        },
        {
          id: 'draconique-ailes',
          level: 14,
          name: 'Ailes draconiques',
          description:
            'En action bonus, faites pousser des ailes : vitesse de vol = votre vitesse actuelle, jusqu’à rejet en action bonus (impossible sous armure non prévue).',
        },
        {
          id: 'draconique-presence',
          level: 18,
          name: 'Présence draconique',
          description:
            'En une action, 5 points de sorcellerie : aura de fascination ou de peur de 18 m (1 min, concentration) ; les hostiles y débutant leur tour sauvegardent de Sagesse ({{save_dc}}), réussite = immunisés 24 h.',
        },
      ],
    },
    {
      key: 'sauvage',
      label: 'Magie sauvage',
      level: 1,
      features: [
        {
          id: 'sauvage-pic-magie',
          level: 1,
          name: 'Pic de magie sauvage',
          description:
            '1× par tour, après un sort d’ensorceleur de niv. 1+, le MD peut vous faire lancer un d20 : sur un 1, lancez un d100 sur la table de magie sauvage.',
        },
        {
          id: 'sauvage-maree-du-chaos',
          level: 1,
          name: 'Marée du chaos',
          description:
            'Avantage sur un jet d’attaque, de caractéristique ou de sauvegarde — 1× par repos long ; tant qu’elle est consommée, un sort d’ensorceleur de niv. 1+ peut déclencher un pic qui la recharge, quel que soit le résultat.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'sauvage-chance-forcée',
          level: 6,
          name: 'Chance forcée',
          description:
            'En réaction quand une créature visible fait un jet d’attaque, de caractéristique ou de sauvegarde : 2 points de sorcellerie pour appliquer ±1d4 au résultat, après le jet mais avant l’annonce de son effet.',
        },
        {
          id: 'sauvage-chaos-controle',
          level: 14,
          name: 'Chaos contrôlé',
          description:
            'Pour chaque jet de Pic de magie sauvage (d100), lancez les dés deux fois et gardez le résultat souhaité.',
        },
        {
          id: 'sauvage-bombardement',
          level: 18,
          name: 'Bombardement de sort',
          description:
            'Quand un dé de dégâts de sort montre sa valeur maximale, relancez-le et additionnez le résultat (1× par tour).',
        },
      ],
    },
  ],
  Guerrier: [
    {
      key: 'champion',
      label: 'Champion',
      level: 3,
      features: [
        {
          id: 'champion-critique-ameliore',
          level: 3,
          name: 'Critique amélioré',
          description:
            'Vos attaques avec arme critiquent sur 19-20 (18-20 au niv. 15) — affiché sur les cartes d’attaque.',
          native: true,
        },
        {
          id: 'champion-athlete',
          level: 7,
          name: 'Athlète accompli',
          description:
            'Moitié du bonus de maîtrise (arrondi sup.) aux jets de FOR/DEX/CON sans maîtrise ; sauts en longueur +{{str_mod}} × 30 cm.',
        },
        {
          id: 'champion-style-supplementaire',
          level: 10,
          name: 'Style de combat supplémentaire',
          description: 'Choisissez une deuxième option de Style de combat.',
        },
        {
          id: 'champion-critique-superieur',
          level: 15,
          name: 'Critique supérieur',
          description:
            'Vos attaques avec arme critiquent sur 18-20 — inclus dans les cartes d’attaque.',
          native: true,
        },
        {
          id: 'champion-survivant',
          level: 18,
          name: 'Survivant',
          description:
            'Au début de chacun de vos tours, récupérez 5 + {{con_mod}} PV s’il vous reste la moitié ou moins de vos PV maximum (rien à 0 PV).',
        },
      ],
    },
    {
      key: 'maitre-de-guerre',
      label: 'Maître de guerre',
      level: 3,
      features: [
        {
          id: 'maitre-guerre-disciple-martial',
          level: 3,
          name: 'Disciple martial',
          description: 'Vous gagnez la maîtrise d’un outil d’artisan de votre choix.',
        },
        {
          id: 'maitre-guerre-superiorite-martial',
          level: 3,
          name: 'Supériorité martiale',
          description:
            '3 manœuvres (+2 aux niv. 7, 10 et 15) et 4 dés de supériorité d8 (+1 aux niv. 7 et 15), regagnés après un repos court ou long ; DD des manœuvres = 8 + {{prof}} + {{str_mod}} ou {{dex_mod}} (au choix).',
          resource: { max: (level) => (level >= 15 ? 6 : level >= 7 ? 5 : 4), reset: 'short' },
        },
        {
          id: 'maitre-guerre-observation-ennemi',
          level: 7,
          name: 'Observation de l’ennemi',
          description:
            'Après 1 minute d’observation hors combat, le MD vous dit si la créature est égale, supérieure ou inférieure à vous pour 2 éléments au choix (FOR, DEX, CON, CA, PV actuels, niveaux totaux, niveau de guerrier).',
        },
        {
          id: 'maitre-guerre-superiorite-amelioree',
          level: 10,
          name: 'Supériorité martiale améliorée',
          description: 'Vos dés de supériorité deviennent des d10 (d12 au niv. 18).',
        },
        {
          id: 'maitre-guerre-implacable',
          level: 15,
          name: 'Implacable',
          description: 'À l’initiative sans dé de supériorité : regagnez-en un.',
        },
      ],
    },
    {
      key: 'chevalier-occulte',
      label: 'Chevalier occulte',
      level: 3,
      features: [
        {
          id: 'chevalier-occulte-incantation',
          level: 3,
          name: 'Incantation',
          description:
            'Sorts de magicien (INT, DD 8 + {{prof}} + {{int_mod}}, attaque {{int_mod}} + {{prof}}) : 2 sorts mineurs (3 au niv. 10) et des sorts d’abjuration/évocation (toute école aux niv. 8, 14, 20), emplacements d’un tiers de votre niveau de guerrier (arrondi au supérieur, repos long).',
        },
        {
          id: 'chevalier-occulte-lien-arme',
          level: 3,
          name: 'Lien avec une arme',
          description:
            'Rituel d’1 heure (repos court possible) liant jusqu’à 2 armes : impossible d’être désarmé ; invocation en action bonus si l’arme est sur le même plan.',
        },
        {
          id: 'chevalier-occulte-magie-de-guerre',
          level: 7,
          name: 'Magie de guerre',
          description:
            'Après avoir lancé un sort mineur avec votre action, attaque d’arme en action bonus.',
        },
        {
          id: 'chevalier-occulte-frappe-occulte',
          level: 10,
          name: 'Frappe occulte',
          description:
            'Une créature touchée par votre arme subit un désavantage à son prochain JS contre un de vos sorts avant la fin de votre prochain tour.',
        },
        {
          id: 'chevalier-occulte-charge-arcanique',
          level: 15,
          name: 'Charge arcanique',
          description:
            'Quand vous utilisez Fougue, téléportez-vous jusqu’à 9 m dans un espace inoccupé visible, avant ou après l’action supplémentaire.',
        },
        {
          id: 'chevalier-occulte-magie-de-guerre-amelioree',
          level: 18,
          name: 'Magie de guerre améliorée',
          description:
            'Après avoir lancé n’importe quel sort avec votre action, attaque d’arme en action bonus.',
        },
      ],
    },
  ],
  Magicien: [
    {
      key: 'abjuration',
      label: 'École d’abjuration',
      level: 2,
      features: [
        {
          id: 'abjuration-abjurateur-erudit',
          level: 2,
          name: 'Abjurateur érudit',
          description: 'Copie des sorts d’abjuration à moitié coût et temps.',
        },
        {
          id: 'abjuration-protection-arcanique',
          level: 2,
          name: 'Protection arcanique',
          description:
            'En lançant un sort d’abjuration de niv. 1+, créez un sceau de 2 × {{level}} + {{int_mod}} PV absorbant vos dégâts ; relancer un tel sort le régénère de 2 × le niveau du sort PV — 1 création par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'abjuration-protection-projetee',
          level: 6,
          name: 'Protection projetée',
          description:
            'En réaction quand une créature visible à 9 m subit des dégâts, votre sceau les absorbe.',
        },
        {
          id: 'abjuration-abjuration-amelioree',
          level: 10,
          name: 'Abjuration améliorée',
          description:
            'Ajoutez {{prof}} aux jets de caractéristique imposés par vos sorts d’abjuration (ex. contresort).',
        },
        {
          id: 'abjuration-resistance-aux-sorts',
          level: 14,
          name: 'Résistance aux sorts',
          description:
            'Avantage aux sauvegardes contre les sorts, et résistance aux dégâts des sorts.',
        },
      ],
    },
    {
      key: 'evocation',
      label: 'École d’évocation',
      level: 2,
      features: [
        {
          id: 'evocation-evocateur-erudit',
          level: 2,
          name: 'Évocateur érudit',
          description: 'Copie des sorts d’évocation à moitié coût et temps.',
        },
        {
          id: 'evocation-faconneur-de-sorts',
          level: 2,
          name: 'Façonneur de sorts',
          description:
            'En lançant un sort d’évocation, 1 + niveau du sort créatures visibles choisies réussissent automatiquement leurs sauvegardes et ne subissent aucun dégât.',
        },
        {
          id: 'evocation-sort-mineur-puissant',
          level: 6,
          name: 'Sort mineur puissant',
          description:
            'Une créature qui réussit sa sauvegarde contre un de vos sorts mineurs infligeant des dégâts subit quand même la moitié des dégâts.',
        },
        {
          id: 'evocation-evocation-amelioree',
          level: 10,
          name: 'Évocation améliorée',
          description:
            'Ajoutez {{int_mod}} à un (et un seul) jet de dégâts de vos sorts d’évocation.',
        },
        {
          id: 'evocation-surcharge-magique',
          level: 14,
          name: 'Surcharge magique',
          description:
            'Vos sorts de magicien de niv. 1-5 infligeant des dégâts : dégâts maximaux ; 1er usage gratuit, puis 2d12 dégâts nécrotiques par niveau de sort avant un repos long (+1d12 par réutilisation).',
        },
      ],
    },
    {
      key: 'divination',
      label: 'École de divination',
      level: 2,
      features: [
        {
          id: 'divination-devin-erudit',
          level: 2,
          name: 'Devin érudit',
          description: 'Copie des sorts de divination à moitié coût et temps.',
        },
        {
          id: 'divination-presage',
          level: 2,
          name: 'Présage',
          description:
            'Après un repos long, lancez 2 d20 : remplacez n’importe quel jet d’attaque, de sauvegarde ou de caractéristique (vous ou une créature visible) par l’un d’eux, avant le jet (1 remplacement/tour, chaque dé 1×).',
        },
        {
          id: 'divination-divination-experte',
          level: 6,
          name: 'Divination experte',
          description:
            'En lançant un sort de divination de niv. 2+, récupérez un emplacement dépensé de niveau inférieur (max niv. 5).',
        },
        {
          id: 'divination-troisieme-oeil',
          level: 10,
          name: 'Troisième œil',
          description:
            'En action, jusqu’à votre prochain repos : lire toutes les langues, vision dans le noir 18 m, vision éthérée ou voir l’invisible.',
        },
        {
          id: 'divination-presage-superieur',
          level: 14,
          name: 'Présage supérieur',
          description: 'Lancez 3 d20 au lieu de 2 pour le Présage.',
        },
      ],
    },
    {
      key: 'enchantement',
      label: 'École d’enchantement',
      level: 2,
      features: [
        {
          id: 'enchantement-enchanteur-erudit',
          level: 2,
          name: 'Enchanteur érudit',
          description: 'Copie des sorts d’enchantement à moitié coût et temps.',
        },
        {
          id: 'enchantement-regard-hypnotique',
          level: 2,
          name: 'Regard hypnotique',
          description:
            'Action : charmez une créature à 1,50 m vous voyant ou vous entendant (JS Sagesse DD {{save_dc}}) : vitesse 0 et incapable d’agir jusqu’à la fin de votre prochain tour, maintenable par action ; 1× par créature par repos long.',
        },
        {
          id: 'enchantement-charme-instinctif',
          level: 6,
          name: 'Charme instinctif',
          description:
            'En réaction quand une créature visible à 9 m vous attaque (si une autre créature est à portée) : l’attaquant sauvegarde de Sagesse (DD {{save_dc}}) ou cible la créature la plus proche ; JS réussi = verrouillé contre cet attaquant jusqu’au repos long.',
        },
        {
          id: 'enchantement-partage',
          level: 10,
          name: 'Partage d’enchantement',
          description:
            'Vos sorts d’enchantement de niv. 1+ à cible unique peuvent cibler une seconde créature.',
        },
        {
          id: 'enchantement-alteration-memorielle',
          level: 14,
          name: 'Altération mémorielle',
          description:
            'Vos cibles charmées ignorent leur charme ; en action avant expiration, la cible sauvegarde d’Intelligence (DD {{save_dc}}) : échec = oubli de 1 + {{cha_mod}} heures (min 1 h).',
        },
      ],
    },
    {
      key: 'illusion',
      label: 'École d’illusion',
      level: 2,
      features: [
        {
          id: 'illusion-illusionniste-erudit',
          level: 2,
          name: 'Illusionniste érudit',
          description: 'Copie des sorts d’illusion à moitié coût et temps.',
        },
        {
          id: 'illusion-illusion-mineure-amelioree',
          level: 2,
          name: 'Illusion mineure améliorée',
          description:
            'Apprenez Illusion mineure (gratuit, hors quota) et créez un son ET une image simultanés.',
        },
        {
          id: 'illusion-illusions-malleables',
          level: 6,
          name: 'Illusions malléables',
          description:
            'En action, changez la nature d’une illusion (durée ≥ 1 min) que vous pouvez voir, dans les limites du sort.',
        },
        {
          id: 'illusion-double-illusoire',
          level: 10,
          name: 'Double illusoire',
          description:
            'En réaction contre un jet d’attaque : interposez un double, l’attaque rate automatiquement — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
        {
          id: 'illusion-realite-illusoire',
          level: 14,
          name: 'Réalité illusoire',
          description:
            'En action bonus sur une illusion de niv. 1+ : rendez réel un objet inanimé non magique pendant 1 minute (sans dégâts ni nuisance directs).',
        },
      ],
    },
    {
      key: 'invocation',
      label: 'École d’invocation',
      level: 2,
      features: [
        {
          id: 'invocation-invocateur-erudit',
          level: 2,
          name: 'Invocateur érudit',
          description: 'Copie des sorts d’invocation à moitié coût et temps.',
        },
        {
          id: 'invocation-invocation-mineure',
          level: 2,
          name: 'Invocation mineure',
          description:
            'Action : créez dans votre main ou à 3 m un objet inanimé non magique déjà vu (≤ 1 m de côté, ≤ 5 kg) pendant 1 h — disparaît à la réutilisation ou s’il subit/inflige des dégâts.',
        },
        {
          id: 'invocation-permutation',
          level: 6,
          name: 'Permutation',
          description:
            'Action : téléportez-vous jusqu’à 9 m dans un espace visible, ou échangez votre place avec une créature consentante de taille P ou M ; se recharge aussi en lançant un sort d’invocation de niv. 1+.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'invocation-invocation-consciencieuse',
          level: 10,
          name: 'Invocation consciencieuse',
          description:
            'Votre concentration sur un sort d’invocation ne peut pas être brisée par les dégâts.',
        },
        {
          id: 'invocation-convocations-coriaces',
          level: 14,
          name: 'Convocations coriaces',
          description:
            '30 PV temporaires aux créatures invoquées ou créées par vos sorts d’invocation.',
        },
      ],
    },
    {
      key: 'necromancie',
      label: 'École de nécromancie',
      level: 2,
      features: [
        {
          id: 'necromancie-necromancien-erudit',
          level: 2,
          name: 'Nécromancien érudit',
          description: 'Copie des sorts de nécromancie à moitié coût et temps.',
        },
        {
          id: 'necromancie-sinistre-moisson',
          level: 2,
          name: 'Sinistre moisson',
          description:
            '1× par tour, en tuant avec un sort de niv. 1+ : récupérez 2 × le niveau du sort en PV (3× si sort de nécromancie ; ni artificiels ni morts-vivants).',
        },
        {
          id: 'necromancie-serviteurs-morts-vivants',
          level: 6,
          name: 'Serviteurs morts-vivants',
          description:
            'Animation des morts ajoutée au grimoire (+1 cadavre ciblé) ; vos morts-vivants créés : PV max +{{level}} et +{{prof}} aux jets de dégâts d’arme.',
        },
        {
          id: 'necromancie-insensibilite-non-vie',
          level: 10,
          name: 'Insensibilité à la non-vie',
          description: 'Résistance aux dégâts nécrotiques ; PV maximum non réductible.',
        },
        {
          id: 'necromancie-controle-morts-vivants',
          level: 14,
          name: 'Contrôle des morts-vivants',
          description:
            'Action : un mort-vivant visible à 18 m sauvegarde de Charisme (DD {{save_dc}}) ou devient amical ; INT 8+ = avantage, INT 12+ = nouveau JS chaque heure.',
        },
      ],
    },
    {
      key: 'transmutation',
      label: 'École de transmutation',
      level: 2,
      features: [
        {
          id: 'transmutation-transmutateur-erudit',
          level: 2,
          name: 'Transmutateur érudit',
          description: 'Copie des sorts de transmutation à moitié coût et temps.',
        },
        {
          id: 'transmutation-alchimie-mineure',
          level: 2,
          name: 'Alchimie mineure',
          description:
            'Par tranche de 10 minutes, transformez un cube de 30 cm de bois, pierre (non précieuse), fer, cuivre ou argent en une autre de ces matières (revient après 1 h).',
        },
        {
          id: 'transmutation-pierre-transmutateur',
          level: 6,
          name: 'Pierre du transmutateur',
          description:
            'Après 8 heures, créez une pierre conférant au porteur : +3 m de vitesse, maîtrise des JS de CON, une résistance (acide/feu/foudre/froid/tonnerre) ou vision dans le noir ; l’effet change en lançant un sort de transmutation de niv. 1+ (pierre en main).',
        },
        {
          id: 'transmutation-metamorphe',
          level: 10,
          name: 'Métamorphe',
          description:
            'Métamorphose ajouté au grimoire et lançable gratuitement sur vous-même (bête FP ≤ 1) — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
        {
          id: 'transmutation-maitre-transmutateur',
          level: 14,
          name: 'Maître transmutateur',
          description:
            'Action : consommez la pierre (détruite) pour Jouvence, Panacée, Restitution de vie ou Transformation majeure — 1 pierre par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
      ],
    },
  ],
  Moine: [
    {
      key: 'main-ouverte',
      label: 'Voie de la paume',
      level: 3,
      features: [
        {
          id: 'main-ouverte-technique',
          level: 3,
          name: 'Technique de la paume',
          description:
            'Sur une touche de Déluge de coups : la cible tombe à terre (DEX DD 8 + {{prof}} + {{wis_mod}}), peut être repoussée de 4,50 m (FOR DD 8 + {{prof}} + {{wis_mod}}) ou ne peut utiliser de réaction jusqu’à la fin de votre prochain tour.',
        },
        {
          id: 'main-ouverte-plenitude-physique',
          level: 6,
          name: 'Plénitude physique',
          description: 'En action, récupérez 3 × {{level}} PV — 1 fois par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'main-ouverte-tranquillite',
          level: 11,
          name: 'Tranquillité',
          description:
            'À la fin d’un repos long, gagnez l’effet du sort Sanctuaire (DD 8 + {{prof}} + {{wis_mod}}) jusqu’à votre prochain repos long.',
        },
        {
          id: 'main-ouverte-paume-fremissante',
          level: 17,
          name: 'Paume frémissante',
          description:
            '3 ki en touchant avec une attaque à mains nues : vibrations létales durant {{level}} jours ; en action (même plan), CON DD 8 + {{prof}} + {{wis_mod}} : échec = 0 PV, réussite = 10d10 dégâts nécrotiques.',
        },
      ],
    },
  ],
  Occultiste: [
    {
      key: 'archfee',
      label: 'L’Archifée',
      level: 1,
      features: [
        {
          id: 'archfee-presence-feerique',
          level: 1,
          name: 'Présence féerique',
          description:
            'Action : les créatures dans un cube de 3 m sauvegardent de Sagesse (DD {{save_dc}}) ou sont charmées ou effrayées (au choix) jusqu’à la fin de votre prochain tour — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
        {
          id: 'archfee-evasion-feerique',
          level: 6,
          name: 'Échappatoire brumeuse',
          description:
            'En réaction à des dégâts : invisible jusqu’au début de votre prochain tour (ou attaque/sort) et téléportation jusqu’à 18 m — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
        {
          id: 'archfee-defenses-captivantes',
          level: 10,
          name: 'Défenses captivantes',
          description:
            'Immunité au charme ; en réaction à une tentative de charme : la créature sauvegarde de Sagesse (DD {{save_dc}}) ou est charmée par vous 1 minute (ou jusqu’à ce qu’elle subisse des dégâts).',
        },
        {
          id: 'archfee-sombre-delire',
          level: 14,
          name: 'Sombre délire',
          description:
            'Action : une créature visible à 18 m sauvegarde de Sagesse (DD {{save_dc}}) ou est charmée ou effrayée 1 min (concentration ; finit plus tôt si elle subit des dégâts), se croyant perdue dans un royaume brumeux — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
      ],
    },
    {
      key: 'fielon',
      label: 'Le Fiélon',
      level: 1,
      features: [
        {
          id: 'fielon-benediction',
          level: 1,
          name: 'Bénédiction du ténébreux',
          description:
            'À chaque réduction d’une créature hostile à 0 PV : PV temporaires = {{cha_mod}} + {{level}} (min 1).',
        },
        {
          id: 'fielon-chance-du-tenebreux',
          level: 6,
          name: 'Chance du ténébreux',
          description:
            '+1d10 à un test ou une sauvegarde, après le lancer mais avant le résultat — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
        {
          id: 'fielon-resistance-fielonne',
          level: 10,
          name: 'Résistance fiélonne',
          description:
            'À la fin de chaque repos court ou long, choisissez un type de dégâts : résistance jusqu’à votre prochain choix (armes magiques ou en argent l’ignorent).',
        },
        {
          id: 'fielon-traversee-des-enfers',
          level: 14,
          name: 'Traversée des enfers',
          description:
            'Quand vous touchez une créature avec une attaque : elle disparaît dans les plans inférieurs et revient à la fin de votre prochain tour ; non-fiélon = 10d10 dégâts psychiques — 1× par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
      ],
    },
    {
      key: 'grand-ancien',
      label: 'Le Grand Ancien',
      level: 1,
      features: [
        {
          id: 'grand-ancien-esprit-eveille',
          level: 1,
          name: 'Esprit éveillé',
          description:
            'Télépathie à 9 m avec toute créature que vous voyez (elle doit comprendre au moins une langue).',
        },
        {
          id: 'grand-ancien-protection-entropique',
          level: 6,
          name: 'Protection entropique',
          description:
            'En réaction à un jet d’attaque contre vous : désavantage ; si l’attaque échoue, votre prochain jet d’attaque contre elle a l’avantage si vous l’attaquez avant la fin de votre prochain tour — 1× par repos court ou long.',
          resource: { max: () => 1, reset: 'short' },
        },
        {
          id: 'grand-ancien-bouclier-mental',
          level: 10,
          name: 'Bouclier mental',
          description:
            'Pensées illisibles ; résistance aux dégâts psychiques, et chaque créature qui vous en inflige subit la même quantité.',
        },
        {
          id: 'grand-ancien-asservissement',
          level: 14,
          name: 'Asservissement',
          description:
            'Action : touchez un humanoïde incapable d’agir — charmé jusqu’à Délivrance des malédictions ou nouvelle utilisation ; télépathie tant que vous êtes sur le même plan.',
        },
      ],
    },
  ],
  Paladin: [
    {
      key: 'devotion',
      label: 'Serment de dévotion',
      level: 3,
      features: [
        {
          id: 'paladin-devotion-conduit',
          level: 3,
          name: 'Conduit divin : Arme sacrée / Renvoi des impies',
          description:
            'Arme sacrée (action, 1 min) : +{{cha_mod}} (min +1) aux attaques avec l’arme tenue, qui devient magique et rayonne une lumière vive (6 m) ; Renvoi des impies : morts-vivants et fiélons à 9 m sauvegardent de Sagesse (DD {{save_dc}}) ou sont renvoyés 1 min (ou jusqu’à dégâts).',
        },
        {
          id: 'paladin-aura-devotion',
          level: 7,
          name: 'Aura de dévotion',
          description:
            'Vous et les alliés à 3 m (9 m au niv. 18) ne pouvez être charmés tant que vous êtes conscient.',
        },
        {
          id: 'paladin-purete-esprit',
          level: 15,
          name: 'Pureté de l’esprit',
          description:
            'Vous êtes en permanence sous l’effet de Protection contre le mal et le bien.',
        },
        {
          id: 'paladin-nimbe-sacre',
          level: 20,
          name: 'Nimbe sacré',
          description:
            'Action : 1 min de lumière vive (9 m) ; un ennemi débutant son tour dans la lumière vive prend 10 dégâts radiants, et vous avez l’avantage aux sauvegardes contre les sorts jetés par les fiélons et morts-vivants — 1× par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
      ],
    },
    {
      key: 'anciennes',
      label: 'Serment des Anciens',
      level: 3,
      features: [
        {
          id: 'paladin-anciennes-conduit',
          level: 3,
          name: 'Conduit divin : Courroux de la nature / Renvoi des infidèles',
          description:
            'Courroux de la nature : vignes spectrales entravent une créature à 3 m (FOR ou DEX, DD {{save_dc}}, nouvelle sauvegarde à la fin de chaque tour) ; Renvoi des infidèles : fées et fiélons à 9 m sauvegardent de Sagesse (DD {{save_dc}}) ou sont renvoyés 1 min (ou jusqu’à dégâts), vraie forme révélée.',
        },
        {
          id: 'paladin-aura-garde',
          level: 7,
          name: 'Aura de garde',
          description:
            'Vous et les alliés à 3 m (9 m au niv. 18) : résistance aux dégâts causés par les sorts.',
        },
        {
          id: 'paladin-sentinelle-immortelle',
          level: 15,
          name: 'Sentinelle immortelle',
          description:
            'Réduit à 0 PV sans être tué : vous pouvez choisir de rester à 1 PV — 1× par repos long ; aucun inconvénient de la vieillesse, pas de vieillissement magique.',
          resource: { max: () => 1, reset: 'long' },
        },
        {
          id: 'paladin-champion-antique',
          level: 20,
          name: 'Champion antique',
          description:
            'Action : 1 min — regagnez 10 PV au début de chaque tour, sorts de paladin à 1 action lancables en action bonus, désavantage aux sauvegardes des ennemis à 3 m contre vos sorts de paladin et vos options de Conduit divin — 1× par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
      ],
    },
    {
      key: 'vengeance',
      label: 'Serment de vengeance',
      level: 3,
      features: [
        {
          id: 'paladin-vengeance-conduit',
          level: 3,
          name: 'Conduit divin : Conspuer l’ennemi / Vœu d’hostilité',
          description:
            'Conspuer l’ennemi : créature à 18 m sauvegarde de Sagesse (DD {{save_dc}}, désavantage pour les fiélons et morts-vivants) ou est effrayée avec vitesse 0 pendant 1 min (réussite : vitesse divisée par deux) ; Vœu d’hostilité (action bonus) : avantage aux attaques contre une créature à 3 m pendant 1 min.',
        },
        {
          id: 'paladin-vengeur-implacable',
          level: 7,
          name: 'Vengeur implacable',
          description:
            'Après une touche d’attaque d’opportunité, déplacez-vous de la moitié de votre vitesse sans provoquer d’attaque d’opportunité.',
        },
        {
          id: 'paladin-ame-vengeresse',
          level: 15,
          name: 'Âme vengeresse',
          description:
            'Quand la cible de votre Vœu d’hostilité attaque, réaction : attaque d’arme contre elle si elle est à portée.',
        },
        {
          id: 'paladin-ange-vengeance',
          level: 20,
          name: 'Ange de la vengeance',
          description:
            'Action : 1 h — ailes (vol 18 m), aura de menace (9 m) : un ennemi entrant dans l’aura ou y débutant son tour sauvegarde de Sagesse (DD {{save_dc}}) ou est effrayé 1 min (ou jusqu’à dégâts), attaques contre lui avec avantage — 1× par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
      ],
    },
  ],
  Rôdeur: [
    {
      key: 'chasseur',
      label: 'Chasseur',
      level: 3,
      features: [
        {
          id: 'chasseur-proie-du-chasseur',
          level: 3,
          name: 'Proie du chasseur',
          description:
            'Tueur de colosses (+1d8, 1×/tour, contre cible blessée), Tueur de géants (réaction contre taille G+ à 1,50 m qui attaque) ou Briseur de hordes (attaque supplémentaire, 1×/tour, contre une autre créature à 1,50 m de la cible).',
        },
        {
          id: 'chasseur-tactiques-defensives',
          level: 7,
          name: 'Tactiques défensives',
          description:
            'Échapper à la horde (désavantage aux attaques d’opportunité contre vous), Défense contre les attaques multiples (+4 CA contre les attaques suivantes de la même créature ce tour) ou Moral d’acier (avantage contre la peur).',
        },
        {
          id: 'chasseur-attaque-multiple',
          level: 11,
          name: 'Attaques multiples',
          description:
            'Volée (attaque à distance contre chaque créature à 3 m d’un point visible, jet par cible) ou Attaque tourbillonnante (attaque de mêlée contre chaque créature à 1,50 m, jet par cible).',
        },
        {
          id: 'chasseur-defense-superieure',
          level: 15,
          name: 'Défense du chasseur supérieure',
          description:
            'Esquive totale (jet de Dex pour ½ dégâts : aucun dégât si réussi, ½ si échoué), Retour de bâton (réaction : l’attaque de mêlée manquée est répétée contre une autre cible) ou Esquive instinctive (réaction : ½ dégâts).',
        },
      ],
    },
  ],
  Roublard: [
    {
      key: 'voleur',
      label: 'Voleur',
      level: 3,
      features: [
        {
          id: 'voleur-mains-lestes',
          level: 3,
          name: 'Mains lestes',
          description:
            'La Ruse permet aussi Escamotage ({{skill:sleightOfHand}}), désamorçage/crochetage avec les outils de voleur, ou Utiliser un objet en action bonus.',
        },
        {
          id: 'voleur-monte-en-lair',
          level: 3,
          name: 'Monte-en-l’air',
          description:
            'Escalader ne vous coûte aucun mouvement supplémentaire ; sauts en longueur +{{dex_mod}} × 30 cm.',
        },
        {
          id: 'voleur-discretion-supreme',
          level: 9,
          name: 'Discrétion suprême',
          description:
            'Avantage à la Discrétion ({{skill:stealth}}) si vous vous déplacez d’au plus la moitié de votre vitesse dans le tour.',
        },
        {
          id: 'voleur-utilisation-objets-magiques',
          level: 13,
          name: 'Utilisation d’objets magiques',
          description: 'Ignorez les restrictions de classe, race et niveau des objets magiques.',
        },
        {
          id: 'voleur-reflexes',
          level: 17,
          name: 'Réflexes de voleur',
          description:
            'Deux tours au premier round : à votre initiative, puis à votre initiative − 10 (sauf si surpris).',
        },
      ],
    },
    {
      key: 'assassin',
      label: 'Assassin',
      level: 3,
      features: [
        {
          id: 'assassin-maitrises-supplementaires',
          level: 3,
          name: 'Maîtrises supplémentaires',
          description: 'Maîtrise du kit de déguisement et du kit d’empoisonneur.',
        },
        {
          id: 'assassin-assassinat',
          level: 3,
          name: 'Assassinat',
          description:
            'Avantage contre toute créature qui n’a pas encore joué son tour ; toute réussite contre une créature surprise est un coup critique.',
        },
        {
          id: 'assassin-expert-infiltration',
          level: 9,
          name: 'Expert en infiltration',
          description:
            'Créez de façon infaillible de fausses identités (1 semaine et 25 po, usurpation d’une identité existante impossible) ; vous en établissez l’histoire, la profession et les affiliations.',
        },
        {
          id: 'assassin-imposteur',
          level: 13,
          name: 'Imposteur',
          description:
            'Après 3 h d’étude, imitez discours, écriture et comportement d’une personne ; avantage à la Tromperie ({{skill:deception}}) en cas de soupçon.',
        },
        {
          id: 'assassin-frappe-meurtriere',
          level: 17,
          name: 'Frappe meurtrière',
          description:
            'Contre une créature surprise : sauvegarde de CON (DD 8 + {{prof}} + {{dex_mod}}) ou les dégâts de l’attaque sont doublés.',
        },
      ],
    },
    {
      key: 'escroc-arcanique',
      label: 'Escroc arcanique',
      level: 3,
      features: [
        {
          id: 'escroc-arcanique-incantation',
          level: 3,
          name: 'Incantation',
          description:
            'Sorts de magicien (INT, DD 8 + {{prof}} + {{int_mod}}, attaque {{int_mod}} + {{prof}}) : 3 sorts mineurs dont Main de mage (+1 au niv. 10), sorts d’enchantement/illusion (toute école aux niv. 8, 14, 20), emplacements selon la table dédiée de l’escroc arcanique (repos long).',
        },
        {
          id: 'escroc-arcanique-escamotage',
          level: 3,
          name: 'Escamotage et main de mage',
          description:
            'La Main de mage invisible range, récupère, crochette ou désarme à distance — Escamotage ({{skill:sleightOfHand}}) opposé à la Perception ; contrôlable via la Ruse.',
        },
        {
          id: 'escroc-arcanique-embuscade-magique',
          level: 9,
          name: 'Embuscade magique',
          description:
            'Sort lancé alors que vous êtes caché de la cible : désavantage à ses sauvegardes contre ce sort pendant ce tour.',
        },
        {
          id: 'escroc-arcanique-escroc-polyvalent',
          level: 13,
          name: 'Escroc polyvalent',
          description:
            'Action bonus : désignez une créature à 1,50 m de la main — avantage d’attaque contre elle jusqu’à la fin du tour.',
        },
        {
          id: 'escroc-arcanique-voleur-de-sort',
          level: 17,
          name: 'Voleur de sort',
          description:
            'Réaction contre un sort vous ciblant ou vous incluant dans sa zone d’effet : sauvegarde (sa caractéristique d’incantation) contre DD 8 + {{prof}} + {{int_mod}} ; échec = effet annulé et sort volé, lançable pendant 8 h (la créature ne peut plus le lancer) — 1× par repos long.',
          resource: { max: () => 1, reset: 'long' },
        },
      ],
    },
  ],
};

// ---------- Aides ----------

/** La classe propriétaire d'une capacité du catalogue ('guerrier-…' → 'Guerrier'). */
export function findClassFeatureClass(catalogId: string): string | null {
  for (const [className, list] of Object.entries(CLASS_FEATURES)) {
    if (list.some((f) => f.id === catalogId)) return className;
  }
  for (const [className, subs] of Object.entries(CLASS_SUBCLASSES)) {
    if (subs.some((s) => s.features.some((f) => f.id === catalogId))) return className;
  }
  return null;
}

/** Une ligne de classe avec ses capacités acquises (multiclassage). */
export interface FeaturesByClass {
  classKey: string;
  classLevel: number;
  /** Subclass key active on this line, if any. */
  subclassKey: string | null;
  /** Acquired features (class level gate applied), sorted by level. */
  features: ClassFeatureDef[];
  /** Full catalog (base + subclass) for browsing, unfiltered by level. */
  catalog: ClassFeatureDef[];
}

/**
 * Capacités par ligne de classe (multiclassage SRD) : chaque classe est
 * évaluée à SON niveau — une capacité de Guerrier 4 n'est pas acquise par un
 * Guerrier 3/Magicien 17. `catalog` reste complet pour la navigation.
 */
export function featuresByClassFor(character: {
  classes?: CharacterClassEntry[] | null;
  characterClass?: string | null;
  level?: number | null;
  subclass?: string | null;
  druidCircle?: string | null;
  divineDomain?: string | null;
  landCircle?: string | null;
  sacredOath?: string | null;
  fightingStyle?: FightingStyle | null;
  hitDiceUsed?: number | null;
}): FeaturesByClass[] {
  const entries = classesOf(character);
  return entries.map((entry) => {
    const base = CLASS_FEATURES[entry.classKey] ?? [];
    const sub =
      entry.subclassKey && CLASS_SUBCLASSES[entry.classKey]
        ? (CLASS_SUBCLASSES[entry.classKey].find((s) => s.key === entry.subclassKey)?.features ??
          [])
        : [];
    const all = [...base, ...sub];
    return {
      classKey: entry.classKey,
      classLevel: entry.level,
      subclassKey: entry.subclassKey ?? null,
      features: all.filter((f) => f.level <= entry.level).sort((a, b) => a.level - b.level),
      catalog: all.sort((a, b) => a.level - b.level),
    };
  });
}

/** Capacités de base + celles de la sous-classe active du personnage, triées par niveau. */
export function featuresForCharacter(character: {
  characterClass?: string | null;
  subclass?: string | null;
  druidCircle?: string | null;
  divineDomain?: string | null;
  sacredOath?: string | null;
}): ClassFeatureDef[] {
  const cls = character.characterClass ?? '';
  const base = CLASS_FEATURES[cls] ?? [];
  // Colonne dédiée selon la classe ; colonne générique `subclass` pour les autres.
  let subclassKey = character.subclass ?? null;
  if (cls === 'Druide') subclassKey = character.druidCircle ?? null;
  else if (cls === 'Clerc') subclassKey = character.divineDomain ?? null;
  else if (cls === 'Paladin') subclassKey = character.sacredOath ?? null;
  const sub =
    subclassKey && CLASS_SUBCLASSES[cls]
      ? (CLASS_SUBCLASSES[cls].find((s) => s.key === subclassKey)?.features ?? [])
      : [];
  return [...base, ...sub].sort((a, b) => a.level - b.level);
}

/** Retrouve une définition du catalogue par identifiant (base + toutes sous-classes). */
export function findClassFeature(catalogId: string): ClassFeatureDef | null {
  for (const list of Object.values(CLASS_FEATURES)) {
    const hit = list.find((f) => f.id === catalogId);
    if (hit) return hit;
  }
  for (const subs of Object.values(CLASS_SUBCLASSES)) {
    for (const sub of subs) {
      const hit = sub.features.find((f) => f.id === catalogId);
      if (hit) return hit;
    }
  }
  return null;
}

/** Prochaine acquisition : capacités (base + sous-classe active) du prochain niveau atteint. */
export function nextClassFeatureGain(character: {
  characterClass?: string | null;
  subclass?: string | null;
  druidCircle?: string | null;
  divineDomain?: string | null;
  sacredOath?: string | null;
  level?: number;
}): { level: number; features: ClassFeatureDef[] } | null {
  const level = character.level ?? 1;
  const all = featuresForCharacter(character);
  for (let l = level + 1; l <= 20; l++) {
    const features = all.filter((f) => f.level === l);
    if (features.length > 0) return { level: l, features };
  }
  return null;
}

/** Prochain palier d'UNE ligne de classe (multiclassage : une entrée par classe). */
export interface NextClassFeatureGain {
  classKey: string;
  nextLevel: number;
  features: ClassFeatureDef[];
}

/** Prochaine acquisition par ligne de classe, chacune évaluée à son propre niveau. */
export function nextClassFeatureGains(character: {
  classes?: CharacterClassEntry[] | null;
  characterClass?: string | null;
  subclass?: string | null;
  druidCircle?: string | null;
  divineDomain?: string | null;
  landCircle?: string | null;
  sacredOath?: string | null;
  level?: number | null;
}): NextClassFeatureGain[] {
  const out: NextClassFeatureGain[] = [];
  for (const entry of classesOf(character)) {
    const base = CLASS_FEATURES[entry.classKey] ?? [];
    const sub =
      entry.subclassKey && CLASS_SUBCLASSES[entry.classKey]
        ? (CLASS_SUBCLASSES[entry.classKey].find((s) => s.key === entry.subclassKey)?.features ??
          [])
        : [];
    const all = [...base, ...sub];
    for (let l = entry.level + 1; l <= 20; l++) {
      const features = all.filter((f) => f.level === l);
      if (features.length > 0) {
        out.push({ classKey: entry.classKey, nextLevel: l, features });
        break;
      }
    }
  }
  return out;
}

/** Taille actuelle de la ressource d'une capacité pour ce personnage (null = pas de compteur). */
export function classFeatureResourceMax(def: ClassFeatureDef, character: Character): number | null {
  if (!def.resource) return null;
  // SRD multiclassage : la ressource évolue au niveau de la classe qui ACCORDE
  // la capacité (Rage d'un Barbare 3/Magicien 17 = 3 utilisations), jamais au
  // niveau total du personnage.
  const owner = findClassFeatureClass(def.id);
  const level = owner
    ? (classesOf(character).find((c) => c.classKey === owner)?.level ?? character.level ?? 1)
    : (character.level ?? 1);
  return def.resource.max(level, modsFrom(character));
}

/** Choix de recharge d'un trait : 'short' (court ou long), 'long' (long
 *  uniquement), 'none' (rechargement manuel explicite). null = non défini. */
export type FeatureResetType = 'short' | 'long' | 'none';

/**
 * Recharge EFFECTIVE d'un trait : le choix du joueur (resetType) prime sur la
 * règle SRD du catalogue — le catalogue n'est qu'une aide de pré-remplissage.
 * Sans choix joueur, un trait de catalogue suit sa règle SRD au niveau actuel.
 * Un `reset` 'short' recharge au repos court d'emblée ; un `reset` 'long'
 * combiné à `shortFromLevel` (ex. Inspiration bardique) ne passe au repos
 * court qu'à partir de ce palier.
 */
export function effectiveFeatureReset(
  feature: { catalogId?: string | null; resetType?: FeatureResetType | null },
  level: number,
): FeatureResetType | null {
  if (feature.resetType) return feature.resetType;
  const def = feature.catalogId ? findClassFeature(feature.catalogId) : null;
  if (def?.resource) {
    if (def.resource.reset === 'short') return 'short';
    const upgrade = def.resource.shortFromLevel;
    if (upgrade !== undefined && level >= upgrade) return 'short'; // long → court au palier
    return 'long';
  }
  return null; // trait manuel sans choix : rechargement manuel
}
