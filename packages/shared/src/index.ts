/**
 * Shared domain types — imported by both the Fastify API and the React frontend.
 * Weights are ALWAYS in kilograms (SI). The SRD source data (lb) is converted at import.
 */

import { DND_SKILLS_EN } from './catalogs.en.ts';
import {
  bardicInspirationDie,
  classFeatureResourceMax,
  effectiveFeatureReset,
  eldritchInvocationsCount,
  type FeatureResetType,
  findClassFeature,
  findClassFeatureClass,
  songOfRestDie,
} from './classFeatures.ts';

export * from './catalogs.en.ts';
export * from './classFeatures.en.ts';
export * from './classFeatures.ts';
export * from './labels.en.ts';

// ---------- Langue des chaînes calculées ----------

/**
 * Langue d'affichage des chaînes construites par le moteur (sources de CA,
 * vitesses, libellés de défense sans armure, types de dégâts…). 'fr' est la
 * valeur par défaut SACRÉE : langue de stockage et des suites de règles —
 * les résultats français doivent rester identiques octet par octet.
 */
export type AppLang = 'fr' | 'en';

/** Variante bilingue d'une chaîne calculée — le français reste le défaut. */
function pickLang(lang: AppLang, fr: string, en: string): string {
  return lang === 'en' ? en : fr;
}

// ---------- Items ----------

export type ItemCategory =
  | 'weapon'
  | 'armor'
  | 'gear' // adventuring gear
  | 'tool'
  | 'mount' // mounts & vehicles
  | 'ammunition'
  | 'magic' // magic items
  | 'custom';

export type Rarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'veryRare'
  | 'legendary'
  | 'artifact'
  | 'none'; // mundane items have no rarity

export type CostUnit = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';

/** A catalog item (SRD-sourced or GM-created custom). */
export interface Item {
  id: number;
  source: 'srd' | 'custom';
  partyId: number | null; // null for SRD/global; set for custom items
  /** Author of a custom item (players can author when the party allows it). */
  createdBy: number | null;
  category: ItemCategory;
  /** Localisé par l'API selon la langue de la requête (repli FR si absent). */
  name: string;
  rarity: Rarity;
  /** Weight in KILOGRAMS. Null when unknown (some magic items). */
  weightKg: number | null;
  costQty: number | null;
  costUnit: CostUnit | null;
  /** Localisée par l'API selon la langue de la requête (repli FR si absent). */
  description: string | null;
  /** Clés de base stables (calculées à l'import/création — voir
   *  docs/i18n-engine-refactor-plan.md) : le moteur ne parse plus les noms. */
  baseWeapon: string | null;
  baseArmor: string | null;
  armorFamily: 'light' | 'medium' | 'heavy' | 'shield' | null;
  magicBonus: number | null;
  // Weapon/armor specifics
  damageDice: string | null;
  damageType: string | null;
  acBase: number | null;
  strMin: number | null;
  stealthDisadvantage: boolean;
  properties: string[]; // weapon properties: light, finesse, two-handed...
  survivalTags: string[]; // ["food"] / ["water"] / ["food","water"] / []
  aliases: string[]; // alternative search names: ["bricoleur","outils de bricoleur"]
  imagePath: string | null;
  // An illustration (map, letter…) is attached — the bytes NEVER ride in list
  // payloads; clients fetch GET /api/items/:id/image once (cached, immutable).
  hasImage: boolean;
  /**
   * Version du fichier illustration (mtime+taille, même forme que l'ETag) —
   * change à chaque écriture (remplacement MD, 2e annotation sur l'exemplaire
   * dérivé). Les clients l'appendent à l'URL (?v=…) : un <img> dont le src ne
   * change pas ne re-demande JAMAIS le fichier, ETag ou pas. Null = pas
   * d'illustration (ou fichier absent).
   */
  imageRev?: string | null;
  /**
   * Annotation d'exemplaire : id de l'objet de BASE dont celui-ci est la copie
   * annotée (dessin/notes aplatis dans sa propre image). Null = objet de
   * catalogue. Les dérivés sont exclus des recherches/catalogues (GET /items)
   * mais servis par GET /items/:id et par la fiche inventaire.
   */
  derivedFromItemId: number | null;
}

export type SurvivalTag = 'food' | 'water';

/** Item search/create payloads. */
export interface ItemSearchQuery {
  search?: string;
  category?: ItemCategory;
  rarity?: Rarity;
  limit?: number;
  offset?: number;
}

export interface CreateCustomItem {
  name: string;
  nameFr?: string;
  category: ItemCategory;
  rarity?: Rarity;
  weightKg?: number | null;
  costQty?: number | null;
  costUnit?: CostUnit | null;
  description?: string;
}

// ---------- Users & auth ----------

export interface User {
  id: number;
  username: string;
  displayName: string;
  /** Null pour les comptes créés avant l'ajout de l'email (optionnel pour eux). */
  email: string | null;
  /** NULL = adresse non vérifiée (clic sur le lien de vérification en attente). */
  emailVerifiedAt: string | null;
  /**
   * Changement d'adresse en attente de vérification : l'adresse `email`
   * (vérifiée) reste active jusqu'au clic sur le lien envoyé à celle-ci.
   */
  pendingEmail: string | null;
  /** Visite guidée déjà vue (côté serveur) — NULL = jamais vue. */
  tutorialSeenAt: string | null;
  /** Ids des onglets dont la visite propre a déjà été jouée. */
  tutorialTabsDone: string[];
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface RegisterPayload {
  username: string;
  password: string;
  displayName: string;
  email: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

/**
 * PATCH /api/auth/me — champs omis = inchangés. L'email ne peut pas être
 * retiré : '' est refusé (les comptes sans email sont un héritage d'avant
 * son obligation à l'inscription).
 */
export interface UpdateProfilePayload {
  displayName?: string;
  email?: string;
  /**
   * Synchronisation de la visite guidée : `tutorialSeenAt: null` réarme la
   * visite (bouton « Réinitialiser »), une valeur ISO la marque vue ;
   * `tutorialTabsDone` remplace la liste des onglets visités.
   */
  tutorialSeenAt?: string | null;
  tutorialTabsDone?: string[];
}

/** POST /api/auth/password */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** POST /api/auth/forgot-password — la réponse est toujours générique (anti-énumération). */
export interface ForgotPasswordPayload {
  email: string;
  /** Langue de l'e-mail envoyé ('fr' | 'en'), figée au moment de la demande. */
  locale?: 'fr' | 'en';
}

/** POST /api/auth/reset-password — succès = AuthResponse (auto-login après reset). */
export interface ResetPasswordPayload {
  token: string;
  newPassword: string;
}

/** POST /api/auth/verify-email — consommation du lien de vérification. */
export interface VerifyEmailPayload {
  token: string;
}

// ---------- Parties ----------

export type EncumbranceMode = 'variant' | 'standard' | 'slots';
export type PartyRole = 'gm' | 'player';

export interface Party {
  id: number;
  name: string;
  gmUserId: number;
  inviteCode: string;
  encumbranceMode: EncumbranceMode;
  /** Players may create custom items themselves (GM toggles this). */
  playersCreateItems: boolean;
  createdAt: string;
}

export interface PartyMember {
  userId: number;
  username: string;
  displayName: string;
  role: PartyRole;
  joinedAt: string;
}

/** A user the GM banned — the invite code is locked for them until unbanned. */
export interface BannedPartyUser {
  userId: number;
  username: string;
  displayName: string;
  bannedAt: string;
}

/** API response row for GET /api/parties — party plus the caller's membership context. */
export interface PartyListRow extends Party {
  gmName?: string;
  role: PartyRole;
  memberCount: number;
  characterCount: number;
  /** Roster character names (alphabetical, same order as the party detail). */
  characterNames: string[];
}

/** API response shape for GET /api/parties/:id — wraps the party with related data. */
export interface PartyDetail {
  party: Party;
  members: PartyMember[];
  characters: CharacterSummary[];
  /** Surfaced in the GM's Joueurs tab only. */
  banned: BannedPartyUser[];
}

export interface CreatePartyPayload {
  name: string;
  encumbranceMode: EncumbranceMode;
}

export interface JoinPartyPayload {
  inviteCode: string;
}

// ---------- GM Assistant (intégration groupe ↔ campagne) ----------

/** GET /api/gma/status — the caller's stored key. Never carries the key itself. */
export interface GmaAccountStatus {
  linked: boolean;
  account: {
    /** Masked (`m***@example.com`) — enough to recognize the account. */
    email: string | null;
    /** 'read' | 'full_access' | null = unknown until the first write attempt. */
    scope: 'read' | 'full_access' | null;
    validatedAt: string;
  } | null;
}

export interface GmaSaveKeyPayload {
  apiKey: string;
}

/** A campaign on GM Assistant (sparse projection — what the picker needs). */
export interface GmaCampaignSummary {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GmaLinkCampaignPayload {
  campaignId: string;
}

/** GET /api/parties/:id/gma/link — party membership view of the link. */
export interface GmaLinkStatus {
  linked: boolean;
  campaign: { id: string; title: string; linkedAt: string } | null;
  /** The linking GM still has a stored key (false → "clé expirée" state). */
  accountOk: boolean;
}

/** POST /api/parties/:id/gma/init — the one-time campaign creation from the group. */
export interface GmaInitPayload {
  characterIds: number[];
}

export interface GmaInitResult {
  campaign: { id: string; title: string };
  created: Array<{
    characterId: number;
    name: string;
    playedBy: string;
    gmaPcId: string;
  }>;
  failed: Array<{ name: string; reason: string }>;
}

/** Writable GMA player-character fields we keep in sync. */
export type GmaPcField = 'name' | 'played_by' | 'description';

export interface GmaPcChange {
  field: GmaPcField;
  from: string;
  to: string;
}

export const GMA_PC_FIELD_LABELS_FR: Record<GmaPcField, string> = {
  name: 'Nom',
  played_by: 'Joué par',
  description: 'Description',
};

/** The GM-triggered resync diff (dryRun returns it without applying). */
export interface GmaCharacterDiff {
  toCreate: Array<{
    characterId: number;
    name: string;
    playedBy: string;
    description: string;
  }>;
  toUpdate: Array<{
    characterId: number;
    name: string;
    gmaPcId: string;
    changes: GmaPcChange[];
  }>;
  /** Link whose local sheet was deleted — explicit delete candidate on GMA. */
  orphans: Array<{ gmaPcId: string; nameAtSync: string }>;
  /** PCs living only on GM Assistant (created in their app) — info only. */
  gmaOnly: Array<{ gmaPcId: string; name: string | null }>;
  upToDate: number;
}

export interface GmaSyncCharactersPayload {
  /** Which unlinked characters to create (the checkboxes). */
  createCharacterIds?: number[];
  dryRun?: boolean;
}

export interface GmaSyncCharactersResult extends GmaCharacterDiff {
  applied: boolean;
  created: Array<{ characterId: number; name: string; gmaPcId: string }>;
  updated: Array<{ characterId: number; name: string }>;
  failed: Array<{ name: string; action: 'create' | 'update'; reason: string }>;
}

/** A session of the linked campaign (chronicle cache). */
export interface GmaSession {
  id: string;
  title: string;
  playedAt: string | null;
  order: number;
}

export interface GmaSessionsResponse {
  sessions: GmaSession[];
  fetchedAt: string | null;
  /** Cache served past its TTL / upstream unreachable — still readable. */
  stale: boolean;
}

/** One recap style of a session (`default` = the canonical recap). */
export interface GmaRecapEntry {
  style: string;
  text: string;
  updatedAt: string | null;
}

export interface GmaRecapsResponse {
  recaps: GmaRecapEntry[];
  /** Memorable moments, user-arranged order (fetched with the recaps). */
  moments: GmaMoment[];
  fetchedAt: string | null;
  stale: boolean;
}

export const GMA_RECAP_STYLE_LABELS_FR: Record<string, string> = {
  default: 'Résumé',
  short_summary: 'En bref',
  classic_summary: 'Héraut',
  fable_summary: 'Conte',
  snarky_summary: 'Ironique',
  sonnet_summary: 'Sonnet',
};

const GMA_RECAP_STYLE_LABELS_EN: Record<string, string> = {
  default: 'Summary',
  short_summary: 'In brief',
  classic_summary: 'Herald',
  fable_summary: 'Tale',
  snarky_summary: 'Snarky',
  sonnet_summary: 'Sonnet',
};

/** Style label for the recap chips — unknown styles surface verbatim. */
export function gmaRecapStyleLabel(style: string, lang: 'fr' | 'en' = 'fr'): string {
  const table = lang === 'en' ? GMA_RECAP_STYLE_LABELS_EN : GMA_RECAP_STYLE_LABELS_FR;
  return table[style] ?? style;
}

/** A memorable moment of a session (quote or highlight, from the analysis). */
export interface GmaMoment {
  id: string;
  isQuote: boolean;
  /** Open enum: epic/funny/dramatic/tragic/intriguing/other + unknown values. */
  type: string | null;
  description: string;
  speaker: string | null;
  context: string | null;
}

export const GMA_MOMENT_TYPE_LABELS_FR: Record<string, string> = {
  epic: 'Épique',
  funny: 'Drôle',
  dramatic: 'Dramatique',
  tragic: 'Tragique',
  intriguing: 'Intrigant',
  other: 'Autre',
};

const GMA_MOMENT_TYPE_LABELS_EN: Record<string, string> = {
  epic: 'Epic',
  funny: 'Funny',
  dramatic: 'Dramatic',
  tragic: 'Tragic',
  intriguing: 'Intriguing',
  other: 'Other',
};

/** Moment type label — unknown values surface verbatim (open enum upstream). */
export function gmaMomentTypeLabel(type: string | null, lang: 'fr' | 'en' = 'fr'): string {
  if (!type) return lang === 'en' ? 'Moment' : 'Moment';
  const table = lang === 'en' ? GMA_MOMENT_TYPE_LABELS_EN : GMA_MOMENT_TYPE_LABELS_FR;
  return table[type] ?? type;
}

// ---------- NPCs ----------

export type NpcDisposition = 'friendly' | 'neutral' | 'hostile' | 'unknown';
export type NpcStatus = 'alive' | 'dead' | 'missing' | 'turned';

export interface Npc {
  id: number;
  partyId: number;
  createdBy: number;
  createdByName: string;
  name: string;
  role: string | null;
  location: string | null;
  faction: string | null;
  disposition: NpcDisposition;
  status: NpcStatus;
  description: string | null;
  secret: string | null; // null if not visible to requesting user
  isShared: boolean;
  sortOrder: number;
}

export interface CreateNpcPayload {
  name: string;
  role?: string;
  location?: string;
  faction?: string;
  disposition?: NpcDisposition;
  status?: NpcStatus;
  description?: string;
  secret?: string;
  isShared?: boolean;
}

export interface PatchNpcPayload {
  name?: string;
  role?: string | null;
  location?: string | null;
  faction?: string | null;
  disposition?: NpcDisposition;
  status?: NpcStatus;
  description?: string | null;
  secret?: string | null;
  isShared?: boolean;
}

export const NPC_DISPOSITION_LABELS_FR: Record<NpcDisposition, string> = {
  friendly: 'Amical',
  neutral: 'Neutre',
  hostile: 'Hostile',
  unknown: 'Inconnu',
};

export const NPC_STATUS_LABELS_FR: Record<NpcStatus, string> = {
  alive: 'En vie',
  dead: 'Mort',
  missing: 'Disparu',
  turned: 'Retourné',
};

// ---------- D&D 5e Conditions (French) ----------

export const DND_CONDITIONS_FR = [
  'Aveuglé',
  'Assourdi',
  'Charmé',
  'Effrayé',
  'Empoisonné',
  'En feu',
  'Entravé',
  'Étourdi',
  'Inconscient',
  'Invisible',
  'Agrippé',
  'À terre',
  'Paralysé',
  'Pétrifié',
  'Possédé',
  'Neutralisé',
] as const;

/**
 * Conditions that incapacitate the character and therefore automatically
 * break concentration (5e SRD: incapacitated = unable to concentrate).
 */
export const CONCENTRATION_BREAKING_CONDITIONS_FR: readonly string[] = [
  'Neutralisé',
  'Étourdi',
  'Inconscient',
  'Paralysé',
  'Pétrifié',
];

// ---------- Characters ----------

export interface CharacterSummary {
  id: number;
  partyId: number;
  ownerId: number;
  ownerName: string;
  name: string;
  strength: number;
  capacityMultiplier: number;
  exhaustion: number; // 0-6
  conditions: string[]; // ["Poisoned", "Frightened", ...]
  foodDays: number; // days without food
  waterDays: number; // days without water
  maxHp: number;
  currentHp: number;
  tempHp: number;
  // Character sheet
  level: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  characterClass: string | null;
  race: string | null;
  background: string | null;
  speed: number; // meters
  skillProficiencies: string[]; // skill keys: ["acrobatics","arcanes",...]
  skillExpertise: string[]; // skill keys with doubled proficiency bonus (Roublard/Barde/Clerc Savoir)
  toolProficiencies: string[]; // tool keys (DND_TOOLS): ["thievesTools","lute",...]
  toolExpertise: string[]; // tool keys with doubled proficiency (outils de voleur — Roublard)
  languages: string[]; // display names: ["Commun","Elfe",...] — custom entries allowed
  savingThrowProficiencies: string[]; // ability keys: ["strength","constitution"]
  weaponProficiencies: string[] | null; // tokens 'simple'/'martial' + EN weapon names; null = class default
  armorProficiencies: string[] | null; // tokens 'light'/'medium'/'heavy'/'shields'; null = class default
  fightingStyle: FightingStyle | null; // SRD fighting style (Guerrier/Paladin/Rôdeur)
  spellSlotsUsed: number[]; // 9 entries, used per spell level 1-9
  // Description / personality
  alignment: string | null;
  sex: string | null;
  height: string | null;
  weight: string | null;
  age: string | null;
  skin: string | null;
  eyes: string | null;
  hair: string | null;
  portraitUrl: string | null;
  personalityTraits: string | null;
  ideals: string | null;
  bonds: string | null;
  flaws: string | null;
  appearance: string | null;
  backstory: string | null;
  alliesOrganizations: string | null;
  armorClassOverride: number | null;
  deathSaveSuccesses: number; // 0-3
  deathSaveFailures: number; // 0-3
  inspiration: boolean;
  concentrating: boolean; // player is concentrating on a spell
  // Wild Shape (Druide)
  wildShapeSlug: string | null;
  wildShapeHp: number | null;
  wildShapeMaxHp: number | null;
  wildShapeUses: number;
  // Hit dice: level dice of the class die; spent on short rests to heal
  hitDiceUsed: number;
  // Wild Shape: beast slugs the druid has seen (SRD requirement)
  wildShapeSeen: string[];
  // Druidic circle: 'terre' | 'lune' | null
  druidCircle: string | null;
  // Subclass for the classes without a dedicated column (Barbare, Barde,
  // Ensorceleur, Guerrier, Magicien, Moine, Occultiste, Rôdeur, Roublard):
  // a CLASS_SUBCLASSES key. Clerc/Druide/Paladin use their dedicated columns.
  subclass: string | null;
  // Divine domain (Clerc): 'savoir' | 'vie' | … | null
  divineDomain: string | null;
  // Druid Circle of the Land terrain + Paladin Sacred Oath
  landCircle: string | null;
  sacredOath: string | null;
  // --- Multiclassage (SRD 5.1): class lines are the source of truth; the
  // flat columns above stay as a denormalized view of the starting class ---
  classes: CharacterClassEntry[];
  pactSlotsUsed: number[];
  /** Active Unarmored Defense when several are available (null = best auto). */
  unarmoredDefense: 'barbare' | 'moine' | 'draconique' | null;
  // Secret prep: hidden characters are invisible to other players (owner + GM
  // still see them) and inactive — excluded from combat rosters and adds.
  hidden: boolean;
}

/** A Constitution save required to maintain concentration after taking damage. */
export interface ConcentrationCheck {
  characterId: number;
  characterName: string;
  damage: number;
  /** DC = max(10, floor(damage / 2)) */
  dc: number;
  /** Set in sync events: the user whose character must roll the save. */
  ownerId?: number;
}

export interface Character extends CharacterSummary {
  notes: string | null;
  // coin purse (cp value)
  copper: number;
  silver: number;
  electrum: number;
  gold: number;
  platinum: number;
  createdAt: string;
}

export interface CreateCharacterPayload {
  name: string;
  strength: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  /** Full creation flow: HP bookends (SQL default 1 when omitted). */
  maxHp?: number;
  currentHp?: number;
  capacityMultiplier?: number;
  characterClass?: string;
  level?: number;
  /** Multiclass creation (campaigns starting above level 1); position 0 = starting class. */
  classes?: CharacterClassEntry[];
  race?: string;
  background?: string;
  skillProficiencies?: string[];
  languages?: string[];
  /** Create as a secret character (hidden from other players). */
  hidden?: boolean;
}

export interface PatchCharacterPayload {
  name?: string;
  strength?: number;
  capacityMultiplier?: number;
  exhaustion?: number;
  conditions?: string[];
  foodDays?: number;
  waterDays?: number;
  maxHp?: number;
  currentHp?: number;
  tempHp?: number;
  notes?: string | null;
  copper?: number;
  silver?: number;
  electrum?: number;
  gold?: number;
  platinum?: number;
  // Character sheet
  level?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  characterClass?: string | null;
  race?: string | null;
  background?: string | null;
  speed?: number;
  skillProficiencies?: string[];
  skillExpertise?: string[];
  toolProficiencies?: string[];
  toolExpertise?: string[];
  languages?: string[];
  savingThrowProficiencies?: string[];
  weaponProficiencies?: string[] | null;
  armorProficiencies?: string[] | null;
  fightingStyle?: FightingStyle | null;
  spellSlotsUsed?: number[];
  // Description / personality
  alignment?: string | null;
  sex?: string | null;
  height?: string | null;
  weight?: string | null;
  age?: string | null;
  skin?: string | null;
  eyes?: string | null;
  hair?: string | null;
  portraitUrl?: string | null;
  personalityTraits?: string | null;
  ideals?: string | null;
  bonds?: string | null;
  flaws?: string | null;
  appearance?: string | null;
  backstory?: string | null;
  alliesOrganizations?: string | null;
  armorClassOverride?: number | null;
  deathSaveSuccesses?: number;
  deathSaveFailures?: number;
  inspiration?: boolean;
  concentrating?: boolean;
  wildShapeSlug?: string | null;
  wildShapeHp?: number | null;
  wildShapeMaxHp?: number | null;
  wildShapeUses?: number;
  hitDiceUsed?: number;
  /** Multiclassage: replace the whole class-line set (position 0 = starting class). */
  classes?: CharacterClassEntry[];
  pactSlotsUsed?: number[];
  unarmoredDefense?: 'barbare' | 'moine' | 'draconique' | null;
  wildShapeSeen?: string[];
  druidCircle?: string | null;
  subclass?: string | null;
  divineDomain?: string | null;
  landCircle?: string | null;
  sacredOath?: string | null;
  /** Owner-only: hide this character from other players (secret prep). */
  hidden?: boolean;
}

// ---------- D&D 5e Abilities (Caractéristiques) ----------

export type AbilityKey =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export interface AbilityInfo {
  key: AbilityKey;
  label: string; // "Force"
  shortLabel: string; // "FOR"
  abbr: string; // "FOR" (same as shortLabel, for convenience)
}

export const DND_ABILITIES: AbilityInfo[] = [
  { key: 'strength', label: 'Force', shortLabel: 'FOR', abbr: 'FOR' },
  { key: 'dexterity', label: 'Dextérité', shortLabel: 'DEX', abbr: 'DEX' },
  { key: 'constitution', label: 'Constitution', shortLabel: 'CON', abbr: 'CON' },
  { key: 'intelligence', label: 'Intelligence', shortLabel: 'INT', abbr: 'INT' },
  { key: 'wisdom', label: 'Sagesse', shortLabel: 'SAG', abbr: 'SAG' },
  { key: 'charisma', label: 'Charisme', shortLabel: 'CHA', abbr: 'CHA' },
];

export const ABILITY_LABELS_FR: Record<AbilityKey, string> = {
  strength: 'Force',
  dexterity: 'Dextérité',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Sagesse',
  charisma: 'Charisme',
};

export const ABILITY_SHORT_FR: Record<AbilityKey, string> = {
  strength: 'FOR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'SAG',
  charisma: 'CHA',
};

/** Compute ability modifier: floor((score - 10) / 2) */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Format a modifier for display: +3, -1, +0 */
export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

// ---------- Proficiency Bonus ----------

/** Proficiency bonus by character level (1-20). */
export function proficiencyBonus(level: number): number {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

// ---------- Skills (Compétences) — 18 skills ----------

export type SkillKey =
  | 'acrobatics'
  | 'arcanes'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleightOfHand'
  | 'stealth'
  | 'survival'
  | 'animalHandling';

export interface SkillInfo {
  key: SkillKey;
  label: string; // French name: "Acrobaties"
  ability: AbilityKey; // associated ability
}

export const DND_SKILLS: SkillInfo[] = [
  { key: 'acrobatics', label: 'Acrobaties', ability: 'dexterity' },
  { key: 'animalHandling', label: 'Dressage', ability: 'wisdom' },
  { key: 'arcanes', label: 'Arcanes', ability: 'intelligence' },
  { key: 'athletics', label: 'Athlétisme', ability: 'strength' },
  { key: 'deception', label: 'Supercherie', ability: 'charisma' },
  { key: 'history', label: 'Histoire', ability: 'intelligence' },
  { key: 'insight', label: 'Perspicacité', ability: 'wisdom' },
  { key: 'intimidation', label: 'Intimidation', ability: 'charisma' },
  { key: 'investigation', label: 'Investigation', ability: 'intelligence' },
  { key: 'medicine', label: 'Médecine', ability: 'wisdom' },
  { key: 'nature', label: 'Nature', ability: 'intelligence' },
  { key: 'perception', label: 'Perception', ability: 'wisdom' },
  { key: 'performance', label: 'Représentation', ability: 'charisma' },
  { key: 'persuasion', label: 'Persuasion', ability: 'charisma' },
  { key: 'religion', label: 'Religion', ability: 'intelligence' },
  { key: 'sleightOfHand', label: 'Escamotage', ability: 'dexterity' },
  { key: 'stealth', label: 'Discrétion', ability: 'dexterity' },
  { key: 'survival', label: 'Survie', ability: 'wisdom' },
];

/** Skill proficiency level: 0=none, 1=proficient, 2=expertise (double proficiency) */
export type ProficiencyLevel = 0 | 1 | 2;

/** Read a skill's proficiency level: expertise implies proficiency (level 2 wins). */
export function skillProficiencyLevel(
  character: Pick<Character, 'skillProficiencies' | 'skillExpertise'>,
  skillKey: SkillKey,
): ProficiencyLevel {
  if ((character.skillExpertise ?? []).includes(skillKey)) return 2;
  if ((character.skillProficiencies ?? []).includes(skillKey)) return 1;
  return 0;
}

/** Total skill check modifier: ability modifier + proficiency bonus × level (×2 on expertise). */
export function skillModifier(character: Character, skillKey: SkillKey): number {
  const skill = DND_SKILLS.find((s) => s.key === skillKey);
  if (!skill) return 0;
  const score = (character[skill.ability as keyof Character] as number) ?? 10;
  const level = skillProficiencyLevel(character, skillKey);
  const bonus = proficiencyBonus(character.level ?? 1);
  return abilityModifier(score) + (level > 0 ? bonus * level : 0);
}

/** Expertise slots by class/level (SRD): Roublard 2 at level 1 (+2 at 6), Barde 2 at
 *  level 3 (+2 at 10), Clerc du Domaine du Savoir 2 at level 1 (Bénédictions de la Connaissance). */
export function expertiseSlots(character: CharacterClassSource): number {
  // Each class grants its own expertise picks at its CLASS level (SRD
  // multiclassing: features as if single-classed); the pools ADD UP. Same
  // skill twice stays double — ProficiencyLevel caps at 2.
  let total = 0;
  for (const entry of classesOf(character)) {
    const name = findClass(entry.classKey)?.name;
    if (name === 'Roublard') total += entry.level >= 6 ? 4 : 2;
    else if (name === 'Barde') total += entry.level >= 10 ? 4 : entry.level >= 3 ? 2 : 0;
    else if (name === 'Clerc' && entry.subclassKey === 'savoir') total += 2;
  }
  return total;
}

// ---------- Tools & languages (SRD 5e) ----------

export type ToolCategory = 'artisan' | 'kit' | 'jeu' | 'instrument' | 'autre';

export interface ToolInfo {
  key: string;
  label: string; // French name, aligned with the item catalog
  category: ToolCategory;
}

export const TOOL_CATEGORY_LABELS_FR: Record<ToolCategory, string> = {
  artisan: "Outils d'artisan",
  kit: 'Kits',
  jeu: 'Jeux',
  instrument: 'Instruments de musique',
  autre: 'Autres',
};

/** The SRD tool set (39). Labels follow the item catalog's French names
 *  (Fournitures d'alchimiste, Outils de verrier, Flûte de Pan…). */
export const DND_TOOLS: ToolInfo[] = [
  { key: 'alchemistSupplies', label: "Fournitures d'alchimiste", category: 'artisan' },
  { key: 'brewerSupplies', label: 'Fournitures de brasseur', category: 'artisan' },
  { key: 'calligrapherSupplies', label: 'Fournitures de calligraphe', category: 'artisan' },
  { key: 'carpenterTools', label: 'Outils de charpentier', category: 'artisan' },
  { key: 'cartographerTools', label: 'Outils de cartographe', category: 'artisan' },
  { key: 'cobblerTools', label: 'Outils de cordonnier', category: 'artisan' },
  { key: 'cookUtensils', label: 'Ustensiles de cuisinier', category: 'artisan' },
  { key: 'glassblowerTools', label: 'Outils de verrier', category: 'artisan' },
  { key: 'jewelerTools', label: 'Outils de joaillier', category: 'artisan' },
  { key: 'leatherworkerTools', label: 'Outils de tanneur', category: 'artisan' },
  { key: 'masonTools', label: 'Outils de maçon', category: 'artisan' },
  { key: 'painterSupplies', label: 'Fournitures de peintre', category: 'artisan' },
  { key: 'potterTools', label: 'Outils de potier', category: 'artisan' },
  { key: 'smithTools', label: 'Outils de forgeron', category: 'artisan' },
  { key: 'tinkerTools', label: 'Outils de bricoleur', category: 'artisan' },
  { key: 'weaverTools', label: 'Outils de tisserand', category: 'artisan' },
  { key: 'woodcarverTools', label: 'Outils de sculpteur sur bois', category: 'artisan' },
  { key: 'disguiseKit', label: 'Kit de déguisement', category: 'kit' },
  { key: 'forgeryKit', label: 'Kit de faux', category: 'kit' },
  { key: 'herbalismKit', label: "Kit d'herboristerie", category: 'kit' },
  { key: 'poisonerKit', label: "Kit d'empoisonneur", category: 'kit' },
  { key: 'diceSet', label: 'Jeu de dés', category: 'jeu' },
  { key: 'dragonchessSet', label: 'Échecs dragon', category: 'jeu' },
  { key: 'playingCardSet', label: 'Jeu de cartes', category: 'jeu' },
  { key: 'threeDragonAnte', label: "Trois dragons d'ante", category: 'jeu' },
  { key: 'bagpipes', label: 'Cornemuse', category: 'instrument' },
  { key: 'drum', label: 'Tambour', category: 'instrument' },
  { key: 'dulcimer', label: 'Dulcimer', category: 'instrument' },
  { key: 'flute', label: 'Flûte', category: 'instrument' },
  { key: 'lute', label: 'Luth', category: 'instrument' },
  { key: 'lyre', label: 'Lyre', category: 'instrument' },
  { key: 'horn', label: 'Cor', category: 'instrument' },
  { key: 'panFlute', label: 'Flûte de Pan', category: 'instrument' },
  { key: 'shawm', label: 'Chalemie', category: 'instrument' },
  { key: 'viol', label: 'Viole', category: 'instrument' },
  { key: 'thievesTools', label: 'Outils de voleur', category: 'autre' },
  { key: 'navigatorTools', label: 'Instruments de navigation', category: 'autre' },
  { key: 'vehicleLand', label: 'Véhicule terrestre', category: 'autre' },
  { key: 'vehicleWater', label: 'Véhicule aquatique', category: 'autre' },
];

/** Known languages for the chips: the 16 SRD languages + the two class languages
 *  (Argot des voleurs — Roublard, Druidique — Druide). Stored as display strings;
 *  custom entries (race/backstory languages) live in the same array. */
export const DND_LANGUAGES: string[] = [
  'Commun',
  'Nain',
  'Elfe',
  'Géant',
  'Gnome',
  'Gobelin',
  'Halfelin',
  'Orc',
  'Abyssal',
  'Céleste',
  'Profond',
  'Draconique',
  'Infernal',
  'Primordial',
  'Sylvestre',
  'Commun des profondeurs',
  'Argot des voleurs',
  'Druidique',
];

/** Read a tool's proficiency level: expertise implies proficiency (level 2 wins). */
export function toolProficiencyLevel(
  character: Pick<Character, 'toolProficiencies' | 'toolExpertise'>,
  toolKey: string,
): ProficiencyLevel {
  if ((character.toolExpertise ?? []).includes(toolKey)) return 2;
  if ((character.toolProficiencies ?? []).includes(toolKey)) return 1;
  return 0;
}

/** Expertise picks used across the shared SRD pool: skills + outils de voleur (Roublard). */
export function expertiseUsed(
  character: Pick<Character, 'skillExpertise' | 'toolExpertise'>,
): number {
  return (character.skillExpertise ?? []).length + (character.toolExpertise ?? []).length;
}

/** Artificier 6+ — Maîtrise des outils: proficiency bonus automatically doubled
 *  for every tool check. Automatic class feature, nothing to store or pick. */
export function hasAutomaticToolExpertise(character: {
  characterClass?: string | null;
  level?: number;
}): boolean {
  return findClass(character.characterClass)?.name === 'Artificier' && (character.level ?? 1) >= 6;
}

// ---------- Classes (SRD reference: hit dice, saves, spellcasting) ----------

export type SpellcastingType = 'none' | 'full' | 'half' | 'pact' | 'artificier';

export interface ClassInfo {
  name: string; // French: "Magicien", "Guerrier"
  /** One-line flavor + teaching description (AideDD intros, condensed). */
  description: string;
  hitDie: number; // 6, 8, 10, 12
  savingThrows: AbilityKey[]; // 2 abilities
  spellcasting: SpellcastingType;
  spellcastingAbility?: AbilityKey; // INT, WIS, CHA (for casters)
  preparesSpells: boolean; // true = must prepare from known list (Wizard/Cleric/Druid/Paladin/Ranger/Artificier)
}

export const DND_CLASSES: ClassInfo[] = [
  {
    name: 'Artificier',
    description:
      'Inventeurs suprêmes libérant la magie dans les objets du quotidien ; sorts canalisés par les outils, objets magiques imprégnés.',
    hitDie: 8,
    savingThrows: ['constitution', 'intelligence'],
    spellcasting: 'artificier',
    spellcastingAbility: 'intelligence',
    preparesSpells: true,
  },
  {
    name: 'Barbare',
    description:
      'Guerriers sauvages nourris de fureur ; rage inextinguible, force et résistance surhumaines, combat sans armure.',
    hitDie: 12,
    savingThrows: ['strength', 'constitution'],
    spellcasting: 'none',
    preparesSpells: false,
  },
  {
    name: 'Barde',
    description:
      'Polyvalents et inspirants, maîtres du chant et de la magie des mots ; charme, illusions, savoir universel.',
    hitDie: 8,
    savingThrows: ['dexterity', 'charisma'],
    spellcasting: 'full',
    spellcastingAbility: 'charisma',
    preparesSpells: false,
  },
  {
    name: 'Clerc',
    description:
      'Intermédiaires entre mortels et dieux, imprégnés de magie divine ; soignent leurs alliés, renvoient les morts-vivants, servent un domaine divin.',
    hitDie: 8,
    savingThrows: ['wisdom', 'charisma'],
    spellcasting: 'full',
    spellcastingAbility: 'wisdom',
    preparesSpells: true,
  },
  {
    name: 'Druide',
    description:
      'Incarnations de la force et de la colère de la nature ; forme sauvage animale, sorts élémentaires ; langue druidique.',
    hitDie: 8,
    savingThrows: ['intelligence', 'wisdom'],
    spellcasting: 'full',
    spellcastingAbility: 'wisdom',
    preparesSpells: true,
  },
  {
    name: 'Ensorceleur',
    description:
      'Porteurs d’une magie innée qui les choisit ; lignée draconique ou magie sauvage, métamagie et points de sorcellerie.',
    hitDie: 6,
    savingThrows: ['constitution', 'charisma'],
    spellcasting: 'full',
    spellcastingAbility: 'charisma',
    preparesSpells: false,
  },
  {
    name: 'Guerrier',
    description:
      'Maîtres inégalés des armes et des armures, du chevalier au mercenaire ; toutes armures, second souffle et fougue.',
    hitDie: 10,
    savingThrows: ['strength', 'constitution'],
    spellcasting: 'none',
    preparesSpells: false,
  },
  {
    name: 'Magicien',
    description:
      'Savants obsédés par les arcanes et vivant par leurs sorts ; grimoire, incantation par Intelligence, huit écoles de magie.',
    hitDie: 6,
    savingThrows: ['intelligence', 'wisdom'],
    spellcasting: 'full',
    spellcastingAbility: 'intelligence',
    preparesSpells: true,
  },
  {
    name: 'Moine',
    description:
      'Artistes martiaux disciplinés unissant corps et esprit ; ki, combat à mains nues, vitesse et défense sans armure.',
    hitDie: 8,
    savingThrows: ['strength', 'dexterity'],
    spellcasting: 'none',
    preparesSpells: false,
  },
  {
    name: 'Occultiste',
    description:
      'Chercheurs de savoir interdit, liés par pacte à un patron d’Outremonde ; magie de pacte, manifestations occultes.',
    hitDie: 8,
    savingThrows: ['wisdom', 'charisma'],
    spellcasting: 'pact',
    spellcastingAbility: 'charisma',
    preparesSpells: false,
  },
  {
    name: 'Paladin',
    description:
      'Champions bénis liés par un serment sacré, remparts contre les forces du mal ; magie divine, soins et châtiments radiants.',
    hitDie: 10,
    savingThrows: ['wisdom', 'charisma'],
    spellcasting: 'half',
    spellcastingAbility: 'charisma',
    preparesSpells: true,
  },
  {
    name: 'Rôdeur',
    description:
      'Guerriers indépendants des étendues sauvages, veillent aux frontières de la civilisation ; ennemi juré, magie naturelle, terrain favori.',
    hitDie: 10,
    savingThrows: ['strength', 'dexterity'],
    spellcasting: 'half',
    spellcastingAbility: 'wisdom',
    preparesSpells: true,
  },
  {
    name: 'Roublard',
    description:
      'Ingénieux et discrets, maîtres du crochetage et des ombres ; attaque sournoise et esquive instinctive.',
    hitDie: 8,
    savingThrows: ['dexterity', 'intelligence'],
    spellcasting: 'none',
    preparesSpells: false,
  },
];

/** Find class info by name (case-insensitive, accent-insensitive match). */
export function findClass(name: string | null | undefined): ClassInfo | null {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    DND_CLASSES.find(
      (c) =>
        c.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') === normalized,
    ) ?? null
  );
}

// ---------- Multiclassage (SRD 5.1 § « Multiclassing ») ----------

/** One class line on a sheet: the multiclass source of truth (character_classes row). */
export interface CharacterClassEntry {
  /** French class name — a DND_CLASSES name ('Magicien'). */
  classKey: string;
  /** Levels in THIS class (1-20); the character's total level is the sum. */
  level: number;
  /** Subclass taken in this class (CLASS_SUBCLASSES / domaine / cercle / serment key). */
  subclassKey?: string | null;
  /** Hit dice of this class already spent (short rests). */
  hitDiceUsed?: number;
  /** Fighting style taken through this class (Guerrier 1, Paladin 2, Rôdeur 2). */
  fightingStyle?: FightingStyle | null;
}

/** Anything carrying class info — legacy flat fields, the new classes[], or both. */
export interface CharacterClassSource {
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
}

/**
 * Resolve a character's class lines. Multiclass sheets carry `classes`
 * directly; legacy single-class characters are synthesized from the flat
 * columns (characterClass + level + subclass columns) so every engine
 * function below works for both storage generations.
 */
export function classesOf(character: CharacterClassSource): CharacterClassEntry[] {
  const entries = (character.classes ?? []).filter(
    (c) => c && findClass(c.classKey) !== null && Number.isFinite(c.level) && c.level >= 1,
  );
  if (entries.length > 0) return entries;
  const info = findClass(character.characterClass ?? '');
  if (!info) return [];
  const subclassKey =
    info.name === 'Clerc'
      ? (character.divineDomain ?? null)
      : info.name === 'Druide'
        ? (character.druidCircle ?? null)
        : info.name === 'Paladin'
          ? (character.sacredOath ?? null)
          : (character.subclass ?? null);
  return [
    {
      classKey: info.name,
      level: character.level ?? 1,
      subclassKey,
      hitDiceUsed: character.hitDiceUsed ?? 0,
      fightingStyle: character.fightingStyle ?? null,
    },
  ];
}

/** Total character level = sum of class levels (SRD multiclassing). */
export function totalLevel(classes: CharacterClassEntry[]): number {
  return classes.reduce((sum, c) => sum + c.level, 0);
}

/** Level in one class (0 when the character has none). */
export function classLevelOf(character: CharacterClassSource, className: string): number {
  const wanted = findClass(className)?.name;
  if (!wanted) return 0;
  const entry = classesOf(character).find((c) => findClass(c.classKey)?.name === wanted);
  return entry?.level ?? 0;
}

/** Fighting styles taken through any class (same style twice doesn't stack — SAC). */
export function fightingStylesOf(character: CharacterClassSource): Set<FightingStyle> {
  const styles = new Set<FightingStyle>();
  for (const entry of classesOf(character)) {
    if (entry.fightingStyle) styles.add(entry.fightingStyle);
  }
  return styles;
}

/**
 * Multiclassing prerequisites (SRD 5.1 table): each class needs one OR-group
 * of abilities at 13+ (Guerrier FOR *ou* DEX ; Moine DEX *et* SAG ; Paladin
 * FOR *et* CHA). The Artificier row (INT 13) is TCE — same extension status
 * as the class itself in this catalog.
 */
export const MULTICLASS_PREREQUISITES: Record<string, AbilityKey[][]> = {
  Artificier: [['intelligence']],
  Barbare: [['strength']],
  Barde: [['charisma']],
  Clerc: [['wisdom']],
  Druide: [['wisdom']],
  Ensorceleur: [['charisma']],
  Guerrier: [['strength'], ['dexterity']],
  Magicien: [['intelligence']],
  Moine: [['dexterity', 'wisdom']],
  Occultiste: [['charisma']],
  Paladin: [['strength', 'charisma']],
  Rôdeur: [['dexterity', 'wisdom']],
  Roublard: [['dexterity']],
};

/** Prerequisite check result for one class line (display + ⚠ in the UI). */
export interface MulticlassPrereqStatus {
  classKey: string;
  satisfied: boolean;
  /** French detail lines, e.g. "FOR 12 (13 requis)". */
  details: string[];
}

/**
 * Prerequisite status of every class AFTER the first (the starting class has
 * none — SRD: you must meet the prereqs of your current and new class when
 * taking a level in a new one; surfaced as ⚠ in the UI, never blocking).
 */
export function multiclassPrereqStatuses(
  character: CharacterClassSource & Record<AbilityKey, number>,
): MulticlassPrereqStatus[] {
  return classesOf(character)
    .slice(1)
    .map((entry) => {
      const name = findClass(entry.classKey)?.name ?? entry.classKey;
      const groups = MULTICLASS_PREREQUISITES[name] ?? [];
      const details: string[] = [];
      let satisfied = false;
      for (const group of groups) {
        if (group.every((a) => (character[a] ?? 10) >= 13)) satisfied = true;
        for (const a of group) {
          details.push(`${ABILITY_SHORT_FR[a]} ${character[a] ?? 10} (13 requis)`);
        }
      }
      return { classKey: name, satisfied, details };
    });
}

/** Proficiencies gained when taking a FIRST level in a class (SRD 5.1 table). */
export interface MulticlassProficiencies {
  /** Armor tokens ('light'/'medium'/'heavy'/'shields'). */
  armor: Array<'light' | 'medium' | 'heavy' | 'shields'>;
  /** Weapon tokens ('simple'/'martial'/English weapon names). */
  weapons: string[];
  /** French lines for the add-class card. */
  linesFr: string[];
}

export const MULTICLASS_PROFICIENCIES_GAINED: Record<string, MulticlassProficiencies> = {
  Artificier: {
    armor: ['light', 'medium', 'shields'],
    weapons: [],
    linesFr: ['Armures légères et intermédiaires', 'Boucliers', 'Outils de voleur'],
  },
  Barbare: {
    armor: ['shields'],
    weapons: ['simple', 'martial'],
    linesFr: ['Boucliers', 'Armes simples et de guerre'],
  },
  Barde: {
    armor: ['light'],
    weapons: [],
    linesFr: ['Armures légères', 'Une compétence au choix', 'Un instrument de musique'],
  },
  Clerc: {
    armor: ['light', 'medium', 'shields'],
    weapons: [],
    linesFr: ['Armures légères et intermédiaires', 'Boucliers'],
  },
  Druide: {
    armor: ['light', 'medium', 'shields'],
    weapons: [],
    linesFr: ['Armures légères et intermédiaires', 'Boucliers (jamais de métal)'],
  },
  Ensorceleur: { armor: [], weapons: [], linesFr: ['Rien'] },
  Guerrier: {
    armor: ['light', 'medium', 'shields'],
    weapons: ['simple', 'martial'],
    linesFr: ['Toutes les armures et boucliers', 'Armes simples et de guerre'],
  },
  Magicien: { armor: [], weapons: [], linesFr: ['Rien'] },
  Moine: {
    armor: [],
    weapons: ['simple', 'Shortsword'],
    linesFr: ['Armes simples', 'Épée courte'],
  },
  Occultiste: {
    armor: ['light'],
    weapons: ['simple'],
    linesFr: ['Armures légères', 'Armes simples'],
  },
  Paladin: {
    armor: ['light', 'medium', 'shields'],
    weapons: ['simple', 'martial'],
    linesFr: ['Toutes les armures et boucliers', 'Armes simples et de guerre'],
  },
  Rôdeur: {
    armor: ['light', 'medium', 'shields'],
    weapons: ['simple', 'martial'],
    linesFr: [
      'Toutes les armures et boucliers',
      'Armes simples et de guerre',
      'Une compétence de la liste de classe',
    ],
  },
  Roublard: {
    armor: ['light'],
    weapons: [],
    linesFr: ['Armures légères', 'Une compétence de la liste de classe', 'Outils de voleur'],
  },
};

/**
 * Multiclass caster level (SRD 5.1): sum full-caster levels, + ⌊paladin/rôdeur
 * ÷ 2⌋, + ⌈artificier ÷ 2⌉ (TCE), + ⌊chevalier occultique / escroc arcanique
 * ÷ 3⌋ (PHB — those subclasses are PHB-only, as in this catalog). Pact magic
 * (Occultiste) NEVER feeds this total. Clamped to 20 (table ceiling).
 */
export function multiclassCasterLevel(classes: CharacterClassEntry[]): number {
  let total = 0;
  for (const entry of classes) {
    const info = findClass(entry.classKey);
    if (!info) continue;
    if (info.spellcasting === 'full') total += entry.level;
    else if (info.name === 'Paladin' || info.name === 'Rôdeur')
      total += Math.floor(entry.level / 2);
    else if (info.name === 'Artificier') total += Math.ceil(entry.level / 2);
    else if (
      (info.name === 'Guerrier' && entry.subclassKey === 'chevalier-occulte') ||
      (info.name === 'Roublard' && entry.subclassKey === 'escroc-arcanique')
    ) {
      total += Math.floor(entry.level / 3);
    }
  }
  return Math.min(20, total);
}

/** The two spell-slot pools of a character (SRD multiclassing spellcasting). */
export interface SpellcastingPools {
  /** Shared Spellcasting pool (multiclass table / own class table), per level 1-9. */
  spellcasting: number[];
  /** Pact magic pool (Occultiste class level only; recharges on a SHORT rest). */
  pact: number[];
  hasPact: boolean;
  /** Caster level feeding the multiclass table. */
  casterLevel: number;
}

/**
 * Spell slots for any sheet. Single class → the class's own table (a lone
 * Paladin keeps its dedicated half table — RAW: the multiclass formula only
 * applies when you have more than one class; the Artificier table happens to
 * equal its ⌈½⌉ formula). Multiclass → SRD incantateur multiclassé table
 * (identical to SPELL_SLOTS_FULL rows — locked by tests), pact pool separate.
 * Third-caster subclasses (chevalier occultique / escroc arcanique, PHB) use
 * the full table at ⌈class level ÷ 3⌉ even alone.
 */
export function computeSpellcastingPools(character: CharacterClassSource): SpellcastingPools {
  const classes = classesOf(character);
  const zeros = (): number[] => [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const pactEntry = classes.find((c) => findClass(c.classKey)?.name === 'Occultiste');
  const pact = pactEntry ? maxSpellSlots(pactEntry.level, 'pact') : zeros();
  const casterLevel = multiclassCasterLevel(classes);

  if (classes.length === 1) {
    const entry = classes[0];
    const info = findClass(entry.classKey);
    const thirdCaster =
      (info?.name === 'Guerrier' && entry.subclassKey === 'chevalier-occulte') ||
      (info?.name === 'Roublard' && entry.subclassKey === 'escroc-arcanique');
    let spellcasting = zeros();
    if (info && info.spellcasting !== 'none' && info.spellcasting !== 'pact') {
      spellcasting = maxSpellSlots(entry.level, info.spellcasting);
    } else if (thirdCaster) {
      spellcasting = maxSpellSlots(Math.ceil(entry.level / 3), 'full');
    }
    return { spellcasting, pact, hasPact: !!pactEntry, casterLevel };
  }

  const spellcasting = casterLevel > 0 ? maxSpellSlots(casterLevel, 'full') : zeros();
  return { spellcasting, pact, hasPact: !!pactEntry, casterLevel };
}

/**
 * Prepared-spells limit per preparing class — each computed as if the
 * character were single-classed in that class (SRD multiclassing).
 */
export function preparedLimits(
  character: CharacterClassSource & Record<AbilityKey, number>,
): Array<{ classKey: string; castingAbility: AbilityKey; limit: number }> {
  const out: Array<{ classKey: string; castingAbility: AbilityKey; limit: number }> = [];
  for (const entry of classesOf(character)) {
    const info = findClass(entry.classKey);
    if (!info?.preparesSpells || !info.spellcastingAbility) continue;
    const limit = computePreparedSpellsLimit(
      info,
      entry.level,
      character[info.spellcastingAbility],
    );
    if (limit !== null)
      out.push({ classKey: info.name, castingAbility: info.spellcastingAbility, limit });
  }
  return out;
}

/** Hit dice by class line — the pool keeps its die types separate (SRD). */
export interface ClassHitDice {
  classKey: string;
  die: number;
  max: number;
  used: number;
}

export function hitDiceByClassOf(character: CharacterClassSource): ClassHitDice[] {
  const classes = classesOf(character);
  if (classes.length === 0) {
    // Fiche sans classe définie : le compteur de dés suit le niveau total
    // (comme avant le multiclassage — le type de dé est inconnu, seul le
    // compte importe ici).
    return [{ classKey: '', die: 8, max: character.level ?? 1, used: character.hitDiceUsed ?? 0 }];
  }
  return classes.map((entry) => ({
    classKey: entry.classKey,
    die: findClass(entry.classKey)?.hitDie ?? 8,
    max: entry.level,
    used: entry.hitDiceUsed ?? 0,
  }));
}

/**
 * Average max HP for a multiclass sheet: the STARTING class's max hit die at
 * level 1, every further level at its own class's average die (SRD).
 */
export function averageMaxHpMulti(
  classes: CharacterClassEntry[],
  constitutionScore: number,
): number {
  if (classes.length === 0) return 1;
  const conMod = abilityModifier(constitutionScore);
  const dieOf = (key: string) => findClass(key)?.hitDie ?? 8;
  const avg = (die: number) => Math.max(1, Math.floor(die / 2) + 1 + conMod);
  let hp = Math.max(1, dieOf(classes[0].classKey) + conMod);
  hp += Math.max(0, classes[0].level - 1) * avg(dieOf(classes[0].classKey));
  for (const entry of classes.slice(1)) {
    hp += entry.level * avg(dieOf(entry.classKey));
  }
  return hp;
}

/** Unarmored Defense candidate — SRD: gaining it again from another class does nothing. */
export interface UnarmoredDefenseOption {
  key: 'barbare' | 'moine' | 'draconique';
  classKey: string;
  /** Formula label, e.g. "Barbare · 10 + DEX + CON" / "Barbarian · 10 + Dex + Con". */
  label: string;
  /** AC from the formula alone (DEX included, shield excluded). */
  ac: number;
  /** Moine: the class feature only applies WITHOUT a shield. */
  shieldForbidden: boolean;
}

export function unarmoredDefensesOf(
  character: CharacterClassSource & {
    dexterity?: number;
    constitution?: number;
    wisdom?: number;
  },
  lang: AppLang = 'fr',
): UnarmoredDefenseOption[] {
  const dexMod = abilityModifier(character.dexterity ?? 10);
  const out: UnarmoredDefenseOption[] = [];
  if (classLevelOf(character, 'Barbare') > 0) {
    const conMod = abilityModifier(character.constitution ?? 10);
    out.push({
      key: 'barbare',
      classKey: 'Barbare',
      label: pickLang(lang, 'Barbare · 10 + DEX + CON', 'Barbarian · 10 + Dex + Con'),
      ac: 10 + dexMod + conMod,
      shieldForbidden: false,
    });
  }
  if (classLevelOf(character, 'Moine') > 0) {
    const wisMod = abilityModifier(character.wisdom ?? 10);
    out.push({
      key: 'moine',
      classKey: 'Moine',
      label: pickLang(lang, 'Moine · 10 + DEX + SAG', 'Monk · 10 + Dex + Wis'),
      ac: 10 + dexMod + wisMod,
      shieldForbidden: true,
    });
  }
  for (const entry of classesOf(character)) {
    if (findClass(entry.classKey)?.name === 'Ensorceleur' && entry.subclassKey === 'draconique') {
      out.push({
        key: 'draconique',
        classKey: 'Ensorceleur',
        label: pickLang(lang, 'Résilience draconique · 13 + DEX', 'Draconic Resilience · 13 + Dex'),
        ac: 13 + dexMod,
        shieldForbidden: false,
      });
    }
  }
  return out;
}

// ---------- Character creation catalogs (SRD 5.1 FR) ----------

/** Standard ability array (SRD): assign these six scores across the six abilities. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Skill choices a class grants at creation (SRD 5.1): pick `count` from
 *  `skills`, or from all 18 when `anySkill` (Barde). */
export interface ClassSkillChoice {
  count: number;
  skills: SkillKey[];
  anySkill?: boolean;
}

export const CLASS_SKILLS: Record<string, ClassSkillChoice> = {
  Artificier: {
    count: 2,
    skills: [
      'arcanes',
      'history',
      'investigation',
      'medicine',
      'nature',
      'perception',
      'sleightOfHand',
    ],
  },
  Barbare: {
    count: 2,
    skills: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
  },
  Barde: { count: 3, skills: [], anySkill: true },
  Clerc: { count: 2, skills: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
  Druide: {
    count: 2,
    skills: [
      'arcanes',
      'animalHandling',
      'insight',
      'medicine',
      'nature',
      'perception',
      'religion',
      'survival',
    ],
  },
  Ensorceleur: {
    count: 2,
    skills: ['arcanes', 'history', 'insight', 'intimidation', 'persuasion', 'religion'],
  },
  Guerrier: {
    count: 2,
    skills: [
      'acrobatics',
      'animalHandling',
      'athletics',
      'history',
      'insight',
      'intimidation',
      'perception',
      'survival',
    ],
  },
  Magicien: {
    count: 2,
    skills: ['arcanes', 'history', 'insight', 'investigation', 'medicine', 'religion'],
  },
  Moine: {
    count: 2,
    skills: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
  },
  Occultiste: {
    count: 2,
    skills: [
      'arcanes',
      'deception',
      'history',
      'intimidation',
      'investigation',
      'nature',
      'religion',
    ],
  },
  Paladin: {
    count: 2,
    skills: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
  },
  Rôdeur: {
    count: 2,
    skills: [
      'animalHandling',
      'athletics',
      'insight',
      'investigation',
      'nature',
      'perception',
      'stealth',
      'survival',
    ],
  },
  Roublard: {
    count: 4,
    skills: [
      'acrobatics',
      'athletics',
      'deception',
      'insight',
      'intimidation',
      'investigation',
      'perception',
      'performance',
      'persuasion',
      'sleightOfHand',
      'stealth',
    ],
  },
};

/** Resolve creation skill choices for a class name. Unknown/custom class →
 *  2 free picks among all 18 (the sheet remains freely editable afterwards). */
export function classSkillChoices(className: string | null | undefined): ClassSkillChoice {
  const cls = findClass(className);
  if (cls && CLASS_SKILLS[cls.name]) return CLASS_SKILLS[cls.name];
  return { count: 2, skills: [], anySkill: true };
}

/** One-line flavor + teaching description; traits/languages are cited but
 * never mechanically applied (creation is catalog-names-only by design). */
export interface SubraceInfo {
  name: string; // full French display name: "Nain des collines", "Haut-elfe"
  description: string;
  /** Vitesse de base en mètres (SRD) — absent = celle de l'espèce. */
  speedMeters?: number;
}

export interface RaceInfo {
  name: string;
  description: string;
  subraces: SubraceInfo[];
  /** Vitesse de base en mètres (SRD 5.1 : 9 m par défaut, petites races 7,5 m). */
  speedMeters: number;
}

/**
 * Vitesse de base d'une espèce/sous-espèce SRD (en mètres), null si le nom
 * ne fait pas partie du catalogue (race personnalisée ou inconnue).
 * Le nom stocké est la sous-race si elle a été choisie ("Elfe des bois"),
 * sinon l'espèce ("Elfe") — les deux formes résolvent.
 */
export function raceSpeedMeters(raceName: string | null | undefined): number | null {
  if (!raceName) return null;
  const race = DND_RACES.find((r) => r.name === raceName);
  if (race) return race.speedMeters;
  for (const r of DND_RACES) {
    const sub = r.subraces.find((s) => s.name === raceName);
    if (sub) return sub.speedMeters ?? r.speedMeters;
  }
  return null;
}

/** SRD 5.1 races in French (5e-drs naming). */
export const DND_RACES: RaceInfo[] = [
  {
    name: 'Humain',
    description: 'Adaptables et ambitieux — le peuple le plus répandu de tous les mondes.',
    speedMeters: 9,
    subraces: [],
  },
  {
    name: 'Nain',
    description:
      'Endurants, mémoire longue, vision dans le noir, résistance au poison ; langue naine.',
    speedMeters: 7.5,
    subraces: [
      { name: 'Nain des collines', description: 'Avisé et tenace — le nain le plus répandu.' },
      {
        name: 'Nain des montagnes',
        description: 'Fort comme la pierre, grandi dans les armureries.',
      },
    ],
  },
  {
    name: 'Elfe',
    description:
      'Gracieux et quasi immortels ; transe au lieu de sommeil, vision dans le noir ; langue elfique.',
    speedMeters: 9,
    subraces: [
      { name: 'Haut-elfe', description: 'Érudit — un tour de magie de plus dans le sang.' },
      {
        name: 'Elfe des bois',
        description: 'Rapide et féerique, âme des forêts profondes.',
        speedMeters: 10.5,
      },
      {
        name: 'Elfe noir (drow)',
        description: 'Enfant de l’Outreterre, magie innée des ténèbres.',
      },
    ],
  },
  {
    name: 'Halfelin',
    description: 'Petits, chanceux et intrépides — ils se faufilent partout ; langue halfeline.',
    speedMeters: 7.5,
    subraces: [
      {
        name: 'Halfelin pied-léger',
        description: 'Sociable, insaisissable, l’appel des grands chemins.',
      },
      {
        name: 'Halfelin robuste',
        description: 'Trapu et résistant, natif des collines venteuses.',
      },
    ],
  },
  {
    name: 'Gnome',
    description: 'Vifs et curieux, astuce légendaire, vision dans le noir ; langue gnome.',
    speedMeters: 7.5,
    subraces: [
      {
        name: 'Gnome des forêts',
        description: 'Discret, ami des animaux, talent pour les illusions.',
      },
      {
        name: 'Gnome des rochers',
        description: 'Inventeur né — jouets, gadgets et machines d’engrenages.',
      },
    ],
  },
  {
    name: 'Demi-elfe',
    description:
      'Deux mondes dans le sang : vision dans le noir, héritage féerique, deux langues de plus.',
    speedMeters: 9,
    subraces: [],
  },
  {
    name: 'Demi-orc',
    description: 'Impressionnant, inébranlable, coups sauvages ; langue orc.',
    speedMeters: 9,
    subraces: [],
  },
  {
    name: 'Tieffelin',
    description:
      'Héritage infernal au premier regard ; résistance au feu, magie des ténèbres ; langue infernale.',
    speedMeters: 9,
    subraces: [],
  },
];

export interface BackgroundInfo {
  name: string;
  description: string;
}

/** SRD 5.1 backgrounds in French (5e-drs naming). */
export const DND_BACKGROUNDS: BackgroundInfo[] = [
  { name: 'Acolyte', description: 'Élevé au temple — abri et soins auprès des fidèles.' },
  { name: 'Criminel', description: 'Larcins et contacts dans la pègre (variante : espion).' },
  { name: 'Héros du peuple', description: 'Issu du peuple, tu en es devenu le défenseur.' },
  { name: 'Noble', description: 'Naissance, titre et rang — la cour te doit des égards.' },
  { name: 'Sage', description: 'Des années d’étude — tu sais où chercher la réponse.' },
  { name: 'Soldat', description: 'Guerre, discipline et chaîne de commandement.' },
  { name: 'Orphelin', description: 'Grandi dans les rues — rapide, débrouillard, seul.' },
];

/** Average max HP for a character created at a given level (SRD): full hit
 *  die + CON at level 1, the fixed average (die/2 + 1) + CON per additional
 *  level, minimum 1 HP per level. */
export function averageMaxHp(level: number, hitDie: number, constitutionScore: number): number {
  const conMod = abilityModifier(constitutionScore);
  const first = Math.max(1, hitDie + conMod);
  const perLevel = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
  return first + Math.max(0, level - 1) * perLevel;
}

/**
 * Compute the number of spells a character can have prepared.
 * Returns null for classes that don't prepare spells (Barde, Ensorceleur, Occultiste, non-casters).
 *
 * SRD rules:
 * - Full casters (Magicien, Clerc, Druide): casting ability mod + class level (min 1)
 * - Half casters (Paladin, Rôdeur, Artificier): casting ability mod + floor(level / 2) (min 1)
 */
export function computePreparedSpellsLimit(
  classInfo: ClassInfo,
  level: number,
  castingAbilityScore: number,
): number | null {
  if (!classInfo.preparesSpells || !classInfo.spellcastingAbility) return null;
  const mod = abilityModifier(castingAbilityScore);
  const effectiveLevel =
    classInfo.spellcasting === 'half' || classInfo.spellcasting === 'artificier'
      ? Math.floor(level / 2)
      : level;
  return Math.max(1, mod + effectiveLevel);
}

// ---------- Spell Slots (Emplacements de sort) ----------

/**
 * Full caster spell slots by level (1-20).
 * Each row is [slotsL1..slotsL9] for that character level.
 * Cantrips (L0) are at-will and not tracked here.
 */
export const SPELL_SLOTS_FULL: number[][] = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // L1
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // L2
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // L3
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // L4
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // L5
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // L6
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // L7
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // L8
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // L9
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // L10
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // L11
  [4, 3, 3, 3, 2, 1, 0, 0, 0], // L12
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // L13
  [4, 3, 3, 3, 2, 1, 1, 0, 0], // L14
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // L15
  [4, 3, 3, 3, 2, 1, 1, 1, 0], // L16
  [4, 3, 3, 3, 2, 1, 1, 1, 1], // L17
  [4, 3, 3, 3, 3, 1, 1, 1, 1], // L18
  [4, 3, 3, 3, 3, 2, 1, 1, 1], // L19
  [4, 3, 3, 3, 3, 2, 2, 1, 1], // L20
];

/**
 * Half caster (Paladin, Ranger) spell slots by level (1-20).
 * Paladin/Ranger get slots starting at character level 2.
 */
export const SPELL_SLOTS_HALF: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0], // L1
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // L2
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // L3
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // L4
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // L5
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // L6
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // L7
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // L8
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // L9
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // L10
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // L11
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // L12
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // L13
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // L14
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // L15
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // L16
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // L17
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // L18
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // L19
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // L20
];

/**
 * Artificier spell slots by level (1-20).
 * Unlike Paladin/Ranger, the Artificier gets spell slots at level 1
 * and follows its own progression table from Tasha's Cauldron.
 * Max spell level is 5 (9-element array, entries 6-9 are always 0).
 */
export const SPELL_SLOTS_ARTIFICIER: number[][] = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // L1
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // L2
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // L3
  [3, 0, 0, 0, 0, 0, 0, 0, 0], // L4
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // L5
  [4, 2, 0, 0, 0, 0, 0, 0, 0], // L6
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // L7
  [4, 3, 0, 0, 0, 0, 0, 0, 0], // L8
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // L9
  [4, 3, 2, 0, 0, 0, 0, 0, 0], // L10
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // L11
  [4, 3, 3, 0, 0, 0, 0, 0, 0], // L12
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // L13
  [4, 3, 3, 1, 0, 0, 0, 0, 0], // L14
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // L15
  [4, 3, 3, 2, 0, 0, 0, 0, 0], // L16
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // L17
  [4, 3, 3, 3, 1, 0, 0, 0, 0], // L18
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // L19
  [4, 3, 3, 3, 2, 0, 0, 0, 0], // L20
];

/**
 * Pact magic (Warlock) slots by level (1-20), SRD RAW.
 * 1 slot of level 1 at level 1, 2 slots from level 2, 3 slots at level 11,
 * 4 slots at level 17 — the slot level scales: L1 (1-2), L2 (3-4), L3 (5-6),
 * L4 (7-8), L5 (9+). Represented as [slotLevel-1 filled with the count, rest 0].
 */
export const SPELL_SLOTS_PACT: number[][] = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0], // L1
  [2, 0, 0, 0, 0, 0, 0, 0, 0], // L2
  [0, 2, 0, 0, 0, 0, 0, 0, 0], // L3
  [0, 2, 0, 0, 0, 0, 0, 0, 0], // L4
  [0, 0, 2, 0, 0, 0, 0, 0, 0], // L5
  [0, 0, 2, 0, 0, 0, 0, 0, 0], // L6
  [0, 0, 0, 2, 0, 0, 0, 0, 0], // L7
  [0, 0, 0, 2, 0, 0, 0, 0, 0], // L8
  [0, 0, 0, 0, 2, 0, 0, 0, 0], // L9
  [0, 0, 0, 0, 2, 0, 0, 0, 0], // L10
  [0, 0, 0, 0, 3, 0, 0, 0, 0], // L11
  [0, 0, 0, 0, 3, 0, 0, 0, 0], // L12
  [0, 0, 0, 0, 3, 0, 0, 0, 0], // L13
  [0, 0, 0, 0, 3, 0, 0, 0, 0], // L14
  [0, 0, 0, 0, 3, 0, 0, 0, 0], // L15
  [0, 0, 0, 0, 3, 0, 0, 0, 0], // L16
  [0, 0, 0, 0, 4, 0, 0, 0, 0], // L17
  [0, 0, 0, 0, 4, 0, 0, 0, 0], // L18
  [0, 0, 0, 0, 4, 0, 0, 0, 0], // L19
  [0, 0, 0, 0, 4, 0, 0, 0, 0], // L20
];

/** Get max spell slots for a character level + spellcasting type. Returns 9-element array. */
export function maxSpellSlots(level: number, type: SpellcastingType): number[] {
  const idx = Math.max(0, Math.min(19, level - 1));
  const table =
    type === 'half'
      ? SPELL_SLOTS_HALF
      : type === 'pact'
        ? SPELL_SLOTS_PACT
        : type === 'artificier'
          ? SPELL_SLOTS_ARTIFICIER
          : SPELL_SLOTS_FULL;
  return table[idx] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/** Spell save DC: 8 + casting ability modifier + proficiency bonus. */
export function spellSaveDC(castingMod: number, profBonus: number): number {
  return 8 + castingMod + profBonus;
}

/** Passive perception: 10 + WIS mod + proficiency bonus (×2 with expertise). */
export function passivePerception(
  wisMod: number,
  profBonus: number,
  proficiency: ProficiencyLevel,
): number {
  return 10 + wisMod + (proficiency > 0 ? profBonus * proficiency : 0);
}

// ---------- Armor Class (CA) computation ----------

export interface ArmorClassResult {
  ac: number;
  /** Human-readable source, e.g. "Cuirasse · DEX +2" or "Sans armure · 10 + DEX"
   * (EN: "Breastplate · 14 +2" or "Unarmored · 10 +3") */
  source: string;
  /** Whether a shield is equipped */
  hasShield: boolean;
}

/**
 * Compute Armor Class from equipped armor items + DEX modifier.
 * Armor type detection by strMin and acBase:
 *   - Heavy (strMin >= 13): acBase, no DEX
 *   - Medium (acBase 12-15): acBase + min(DEX, 2)
 *   - Light (acBase <= 12): acBase + DEX
 * Magic armor (acBase null) resolves to its mundane base + magic bonus,
 * like magic weapons. defenseStyle: +1 CA from the Défense fighting style.
 * lang: langue du libellé `source` ('fr' par défaut — identique octet par octet).
 */
export function computeAC(
  entries: Array<{
    item: {
      category: string;
      acBase: number | null;
      strMin: number | null;
      nameFr?: string | null;
      name: string;
      description?: string | null;
    } & ItemBaseKeys;
    equipped: boolean;
  }>,
  dexMod: number,
  defenseStyle = false,
  character?: CharacterClassSource & {
    constitution?: number;
    wisdom?: number;
    dexterity?: number;
    unarmoredDefense?: 'barbare' | 'moine' | 'draconique' | null;
  },
  lang: AppLang = 'fr',
): ArmorClassResult {
  // Find equipped armor (non-shield) and shield
  let armor: {
    acBase: number;
    armorType: 'light' | 'medium' | 'heavy';
    name: string;
    /** Nom anglais canonique quand la base SRD est résolue (affichage EN). */
    nameEn: string | null;
  } | null = null;
  let hasShield = false;
  let magicAcBonus = 0;

  for (const entry of entries) {
    if (!entry.equipped) continue;
    if (entry.item.category !== 'armor') continue;
    const name = (entry.item.nameFr ?? entry.item.name).toLowerCase();

    // Magic armor: resolve its mundane base (+ bonus) before the acBase filter
    let acBase = entry.item.acBase;
    let base: MundaneArmor | null = null;
    let magicBonus = 0;
    if (acBase === null || acBase === 0) {
      const magic = resolveMagicArmorBase(entry.item);
      if (magic.shield) {
        hasShield = true;
        continue;
      }
      if (!magic.base) continue; // family armor (légère/intermédiaire/lourde): base unknowable
      acBase = magic.base.acBase;
      base = magic.base;
      magicBonus = magic.magicBonus;
    } else {
      // Mundane armor: look up its true type (acBase 12 is studded-leather
      // light AND hide medium — the value alone can't tell them apart).
      // Clé stable d'abord : en mono-locale, `name` est localisé.
      const keyedArmor = entry.item.baseArmor
        ? MUNDANE_ARMORS.find((a) => a.nameEn === entry.item.baseArmor)
        : undefined;
      base = keyedArmor ?? findMundaneArmorByName(entry.item.name, entry.item.nameFr);
    }

    // Shield gives +2 and is tracked separately
    if (base?.armorType === 'shield' || name.includes('bouclier') || name.includes('shield')) {
      hasShield = true;
      continue;
    }
    // First equipped armor piece wins
    if (!armor) {
      armor = {
        acBase,
        // (a shield base already `continue`d above, so base.armorType is
        // never 'shield' here — the type was narrowed accordingly)
        armorType: base
          ? base.armorType
          : entry.item.strMin !== null && entry.item.strMin >= 13
            ? 'heavy'
            : acBase >= 13 && acBase <= 15
              ? 'medium'
              : 'light',
        name: entry.item.nameFr ?? entry.item.name,
        nameEn: base?.nameEn ?? null,
      };
      magicAcBonus = magicBonus;
    }
  }

  let ac: number;
  let source: string;

  if (!armor) {
    // Unarmored: 10 + DEX, or ONE class Unarmored Defense (SRD multiclassing:
    // gaining it again from another class does nothing — pick one, never
    // combine). Multiclass sheets choose via `unarmoredDefense`; the default
    // is the best computed AC. Moine's defense only applies without a shield
    // (a shield still gives its +2).
    const conMod = abilityModifier(character?.constitution ?? 10);
    const wisMod = abilityModifier(character?.wisdom ?? 10);
    const byKey: Record<string, { ac: number; source: string }> = {};
    if (character && classLevelOf(character, 'Barbare') > 0) {
      byKey.barbare = {
        ac: 10 + dexMod + conMod,
        source: pickLang(
          lang,
          `Sans armure · 10 ${formatModifier(dexMod)} ${formatModifier(conMod)} (Barbare)`,
          `Unarmored · 10 ${formatModifier(dexMod)} ${formatModifier(conMod)} (Barbarian)`,
        ),
      };
    }
    if (
      character &&
      classesOf(character).some(
        (c) => findClass(c.classKey)?.name === 'Ensorceleur' && c.subclassKey === 'draconique',
      )
    ) {
      byKey.draconique = {
        ac: 13 + dexMod,
        source: pickLang(
          lang,
          `Sans armure · 13 ${formatModifier(dexMod)} (Résilience draconique)`,
          `Unarmored · 13 ${formatModifier(dexMod)} (Draconic Resilience)`,
        ),
      };
    }
    if (character && classLevelOf(character, 'Moine') > 0 && !hasShield) {
      byKey.moine = {
        ac: 10 + dexMod + wisMod,
        source: pickLang(
          lang,
          `Sans armure · 10 ${formatModifier(dexMod)} ${formatModifier(wisMod)} (Moine)`,
          `Unarmored · 10 ${formatModifier(dexMod)} ${formatModifier(wisMod)} (Monk)`,
        ),
      };
    }
    const choice = character?.unarmoredDefense ?? null;
    const keys = Object.keys(byKey);
    let pick: { ac: number; source: string } | null =
      choice && byKey[choice] ? byKey[choice] : null;
    if (!pick && keys.length > 0) {
      const sorted = keys.map((k) => byKey[k]).sort((a, b) => b.ac - a.ac);
      pick = sorted[0] ?? null;
    }
    if (pick) {
      ac = pick.ac;
      source = pick.source;
    } else {
      ac = 10 + dexMod;
      source = pickLang(
        lang,
        `Sans armure · 10 ${formatModifier(dexMod)}`,
        `Unarmored · 10 ${formatModifier(dexMod)}`,
      );
    }
  } else {
    const isHeavy = armor.armorType === 'heavy';
    const isMedium = armor.armorType === 'medium';
    // EN: nom canonique de la base SRD quand elle est résolue, sinon le nom
    // localisé de l'objet (payload mono-locale — `name` suit la langue).
    const armorName = lang === 'en' ? (armor.nameEn ?? armor.name) : armor.name;
    // Light: acBase + full DEX; Medium: acBase + min(DEX, 2); Heavy: acBase only
    if (isHeavy) {
      ac = armor.acBase;
      source = `${armorName} · ${armor.acBase}`;
    } else if (isMedium) {
      const dexBonus = Math.min(dexMod, 2);
      ac = armor.acBase + dexBonus;
      source = `${armorName} · ${armor.acBase} ${formatModifier(dexBonus)}`;
    } else {
      ac = armor.acBase + dexMod;
      source = `${armorName} · ${armor.acBase} ${formatModifier(dexMod)}`;
    }
    if (magicAcBonus > 0) {
      ac += magicAcBonus;
      source += ` +${magicAcBonus}`;
    }
  }

  if (hasShield) {
    ac += 2;
    source += pickLang(lang, ' · Bouclier +2', ' · Shield +2');
  }

  // Défense fighting style: +1 while wearing armor
  if (defenseStyle && armor) {
    ac += 1;
    source += pickLang(lang, ' · Défense +1', ' · Defense +1');
  }

  return { ac, source, hasShield };
}

// ---------- Fighting styles (SRD) ----------

export type FightingStyle =
  | 'archery'
  | 'defense'
  | 'dueling'
  | 'great-weapon'
  | 'protection'
  | 'two-weapon';

export const FIGHTING_STYLE_LABELS_FR: Record<FightingStyle, string> = {
  archery: 'Archerie (+2 att. à distance)',
  defense: 'Défense (+1 CA)',
  dueling: 'Duel (+2 dégâts arme à une main)',
  'great-weapon': 'Arme à deux mains',
  protection: 'Protection (réaction : désavantage, bouclier requis)',
  'two-weapon': 'Combat à deux armes',
};

/** Classes that can pick a fighting style (SRD). */
export const FIGHTING_STYLE_CLASSES: readonly string[] = ['Guerrier', 'Paladin', 'Rôdeur'];

// ---------- Weapon attack & damage computation (SRD combat rules) ----------

/** French labels for SRD weapon properties. */
export const WEAPON_PROPERTY_LABELS_FR: Record<string, string> = {
  light: 'Légère',
  finesse: 'Finesse',
  thrown: 'Lancer',
  'two-handed': 'À deux mains',
  versatile: 'Polyvalente',
  ammunition: 'Munitions',
  loading: 'Rechargement',
  heavy: 'Lourde',
  reach: 'Allonge',
  special: 'Spéciale',
};

/** French labels for damage types (keys match item damageType: capitalized English). */
export const DAMAGE_TYPE_LABELS_FR: Record<string, string> = {
  Bludgeoning: 'contondants',
  Piercing: 'perforants',
  Slashing: 'tranchants',
  Fire: 'de feu',
  Cold: 'de froid',
  Lightning: 'de foudre',
  Thunder: 'de tonnerre',
  Acid: "d'acide",
  Poison: 'de poison',
  Necrotic: 'nécrotiques',
  Radiant: 'radiants',
  Force: 'de force',
  Psychic: 'psychiques',
};

/** One SRD mundane weapon. nameEn/nameFr match the item catalog exactly. */
export interface MundaneWeapon {
  nameEn: string;
  nameFr: string;
  dice: string;
  damageType: string; // capitalized English, matches item.damageType
  properties: string[];
  simple: boolean; // false = martial
  /** Two-handed dice for versatile weapons. */
  twoHandedDice?: string;
}

/** The 37 SRD mundane weapons (names as they appear in the item catalog). */
export const MUNDANE_WEAPONS: MundaneWeapon[] = [
  // Simple melee
  {
    nameEn: 'Club',
    nameFr: 'Gourdin',
    dice: '1d4',
    damageType: 'Bludgeoning',
    properties: ['light'],
    simple: true,
  },
  {
    nameEn: 'Dagger',
    nameFr: 'Dague',
    dice: '1d4',
    damageType: 'Piercing',
    properties: ['finesse', 'light', 'thrown'],
    simple: true,
  },
  {
    nameEn: 'Greatclub',
    nameFr: 'Massue',
    dice: '1d8',
    damageType: 'Bludgeoning',
    properties: ['two-handed'],
    simple: true,
  },
  {
    nameEn: 'Handaxe',
    nameFr: 'Hachette',
    dice: '1d6',
    damageType: 'Slashing',
    properties: ['light', 'thrown'],
    simple: true,
  },
  {
    nameEn: 'Javelin',
    nameFr: 'Javeline',
    dice: '1d6',
    damageType: 'Piercing',
    properties: ['thrown'],
    simple: true,
  },
  {
    nameEn: 'Light hammer',
    nameFr: 'Marteau léger',
    dice: '1d4',
    damageType: 'Bludgeoning',
    properties: ['light', 'thrown'],
    simple: true,
  },
  {
    nameEn: 'Mace',
    nameFr: "Masse d'armes",
    dice: '1d6',
    damageType: 'Bludgeoning',
    properties: [],
    simple: true,
  },
  {
    nameEn: 'Quarterstaff',
    nameFr: 'Bâton',
    dice: '1d6',
    damageType: 'Bludgeoning',
    properties: ['versatile'],
    simple: true,
    twoHandedDice: '1d8',
  },
  {
    nameEn: 'Sickle',
    nameFr: 'Serpe',
    dice: '1d4',
    damageType: 'Slashing',
    properties: ['light'],
    simple: true,
  },
  {
    nameEn: 'Spear',
    nameFr: 'Lance',
    dice: '1d6',
    damageType: 'Piercing',
    properties: ['thrown', 'versatile'],
    simple: true,
    twoHandedDice: '1d8',
  },
  // Simple ranged
  {
    nameEn: 'Crossbow, light',
    nameFr: 'Arbalète légère',
    dice: '1d8',
    damageType: 'Piercing',
    properties: ['ammunition', 'loading', 'two-handed'],
    simple: true,
  },
  {
    nameEn: 'Dart',
    nameFr: 'Fléchette',
    dice: '1d4',
    damageType: 'Piercing',
    properties: ['finesse', 'thrown'],
    simple: true,
  },
  {
    nameEn: 'Shortbow',
    nameFr: 'Arc court',
    dice: '1d6',
    damageType: 'Piercing',
    properties: ['ammunition', 'two-handed'],
    simple: true,
  },
  {
    nameEn: 'Sling',
    nameFr: 'Fronde',
    dice: '1d4',
    damageType: 'Bludgeoning',
    properties: ['ammunition'],
    simple: true,
  },
  // Martial melee
  {
    nameEn: 'Battleaxe',
    nameFr: "Hache d'armes",
    dice: '1d8',
    damageType: 'Slashing',
    properties: ['versatile'],
    simple: false,
    twoHandedDice: '1d10',
  },
  {
    nameEn: 'Flail',
    nameFr: 'Fléau',
    dice: '1d8',
    damageType: 'Bludgeoning',
    properties: [],
    simple: false,
  },
  {
    nameEn: 'Glaive',
    nameFr: 'Coutille',
    dice: '1d10',
    damageType: 'Slashing',
    properties: ['heavy', 'reach', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Greataxe',
    nameFr: 'Hache à deux mains',
    dice: '1d12',
    damageType: 'Slashing',
    properties: ['heavy', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Greatsword',
    nameFr: 'Épée à deux mains',
    dice: '2d6',
    damageType: 'Slashing',
    properties: ['heavy', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Halberd',
    nameFr: 'Hallebarde',
    dice: '1d10',
    damageType: 'Slashing',
    properties: ['heavy', 'reach', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Lance',
    nameFr: "Lance d'arçon",
    dice: '1d12',
    damageType: 'Piercing',
    properties: ['reach', 'special'],
    simple: false,
  },
  {
    nameEn: 'Longsword',
    nameFr: 'Épée longue',
    dice: '1d8',
    damageType: 'Slashing',
    properties: ['versatile'],
    simple: false,
    twoHandedDice: '1d10',
  },
  {
    nameEn: 'Maul',
    nameFr: 'Maillet',
    dice: '2d6',
    damageType: 'Bludgeoning',
    properties: ['heavy', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Morningstar',
    nameFr: 'Morgenstern',
    dice: '1d8',
    damageType: 'Piercing',
    properties: [],
    simple: false,
  },
  {
    nameEn: 'Pike',
    nameFr: 'Pique',
    dice: '1d10',
    damageType: 'Piercing',
    properties: ['heavy', 'reach', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Rapier',
    nameFr: 'Rapière',
    dice: '1d8',
    damageType: 'Piercing',
    properties: ['finesse'],
    simple: false,
  },
  {
    nameEn: 'Scimitar',
    nameFr: 'Cimeterre',
    dice: '1d6',
    damageType: 'Slashing',
    properties: ['finesse', 'light'],
    simple: false,
  },
  {
    nameEn: 'Shortsword',
    nameFr: 'Épée courte',
    dice: '1d6',
    damageType: 'Piercing',
    properties: ['finesse', 'light'],
    simple: false,
  },
  {
    nameEn: 'Trident',
    nameFr: 'Trident',
    dice: '1d6',
    damageType: 'Piercing',
    properties: ['thrown', 'versatile'],
    simple: false,
    twoHandedDice: '1d8',
  },
  {
    nameEn: 'War pick',
    nameFr: 'Pic de guerre',
    dice: '1d8',
    damageType: 'Piercing',
    properties: [],
    simple: false,
  },
  {
    nameEn: 'Warhammer',
    nameFr: 'Marteau de guerre',
    dice: '1d8',
    damageType: 'Bludgeoning',
    properties: ['versatile'],
    simple: false,
    twoHandedDice: '1d10',
  },
  {
    nameEn: 'Whip',
    nameFr: 'Fouet',
    dice: '1d4',
    damageType: 'Slashing',
    properties: ['finesse', 'reach'],
    simple: false,
  },
  // Martial ranged
  {
    nameEn: 'Blowgun',
    nameFr: 'Sarbacane',
    dice: '1',
    damageType: 'Piercing',
    properties: ['ammunition', 'loading'],
    simple: false,
  },
  {
    nameEn: 'Crossbow, hand',
    nameFr: 'Arbalète de poing',
    dice: '1d6',
    damageType: 'Piercing',
    properties: ['ammunition', 'light', 'loading'],
    simple: false,
  },
  {
    nameEn: 'Crossbow, heavy',
    nameFr: 'Arbalète lourde',
    dice: '1d10',
    damageType: 'Piercing',
    properties: ['ammunition', 'heavy', 'loading', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Longbow',
    nameFr: 'Arc long',
    dice: '1d8',
    damageType: 'Piercing',
    properties: ['ammunition', 'heavy', 'two-handed'],
    simple: false,
  },
  {
    nameEn: 'Net',
    nameFr: 'Filet',
    dice: '',
    damageType: 'Slashing',
    properties: ['thrown', 'special'],
    simple: false,
  },
];

/** Weapon proficiency profile for a class (SRD). */
export interface WeaponProficiencySet {
  simple: boolean;
  martial: boolean;
  /** Specific weapons (English item names) granted beyond simple/martial. */
  specific: string[];
}

export const CLASS_WEAPON_PROFICIENCIES: Record<string, WeaponProficiencySet> = {
  Artificier: { simple: true, martial: false, specific: [] },
  Barbare: { simple: true, martial: true, specific: [] },
  Barde: {
    simple: true,
    martial: false,
    specific: ['Crossbow, hand', 'Longsword', 'Rapier', 'Shortsword'],
  },
  Clerc: { simple: true, martial: false, specific: [] },
  Druide: {
    simple: false,
    martial: false,
    specific: ['Club', 'Dagger', 'Dart', 'Quarterstaff', 'Scimitar', 'Sickle', 'Sling', 'Spear'],
  },
  Ensorceleur: {
    simple: false,
    martial: false,
    specific: ['Dagger', 'Dart', 'Sling', 'Quarterstaff', 'Crossbow, light'],
  },
  Guerrier: { simple: true, martial: true, specific: [] },
  Magicien: {
    simple: false,
    martial: false,
    specific: ['Dagger', 'Dart', 'Sling', 'Quarterstaff', 'Crossbow, light'],
  },
  Moine: { simple: true, martial: false, specific: ['Shortsword'] },
  Occultiste: { simple: true, martial: false, specific: ['Crossbow, light'] },
  Paladin: { simple: true, martial: true, specific: [] },
  Rôdeur: { simple: true, martial: true, specific: [] },
  Roublard: {
    simple: true,
    martial: false,
    specific: ['Crossbow, hand', 'Longsword', 'Rapier', 'Shortsword'],
  },
};

/** Class default weapon proficiencies (SRD). Unknown class → nothing. */
export function classWeaponProficiencies(
  className: string | null | undefined,
): WeaponProficiencySet {
  const cls = findClass(className);
  if (!cls) return { simple: false, martial: false, specific: [] };
  return CLASS_WEAPON_PROFICIENCIES[cls.name] ?? { simple: false, martial: false, specific: [] };
}

/**
 * Effective weapon proficiencies for a character: the explicit list
 * (weaponProficiencies tokens: 'simple', 'martial', or English weapon names)
 * when set, otherwise the class default — for multiclass sheets the union of
 * the starting class's full set and each later class's "proficiencies gained"
 * (SRD 5.1 multiclassing table). Single-class sheets get exactly the old
 * class default.
 */
export function effectiveWeaponProficiencies(
  character: CharacterClassSource & { weaponProficiencies?: string[] | null },
): WeaponProficiencySet {
  if (character.weaponProficiencies != null) {
    const tokens = character.weaponProficiencies;
    return {
      simple: tokens.includes('simple'),
      martial: tokens.includes('martial'),
      specific: tokens.filter((t) => t !== 'simple' && t !== 'martial'),
    };
  }
  const classes = classesOf(character);
  const set = classWeaponProficiencies(classes[0]?.classKey ?? null);
  if (classes.length <= 1) return set;
  const specific = new Set(set.specific);
  let simple = set.simple;
  let martial = set.martial;
  for (const entry of classes.slice(1)) {
    const gained = MULTICLASS_PROFICIENCIES_GAINED[findClass(entry.classKey)?.name ?? ''];
    if (!gained) continue;
    for (const token of gained.weapons) {
      if (token === 'simple') simple = true;
      else if (token === 'martial') martial = true;
      else specific.add(token);
    }
  }
  return { simple, martial, specific: [...specific] };
}

/** Is the character proficient with this weapon? (Magic weapons follow their base weapon.) */
export function isProficientWithWeapon(
  item: {
    category: string;
    name: string;
    nameFr?: string | null;
    properties?: string[];
    damageDice?: string | null;
    damageType?: string | null;
    description?: string | null;
  } & ItemBaseKeys,
  character: { characterClass?: string | null; weaponProficiencies?: string[] | null },
): boolean {
  if (item.category !== 'weapon') return false;
  // Resolve the effective weapon name: the base weapon for magic items
  let nameEn = item.name;
  if (!item.damageDice) {
    const magic = resolveMagicWeaponBase(item);
    if (magic.base) nameEn = magic.base.nameEn;
  } else if (item.baseWeapon) {
    nameEn = item.baseWeapon;
  }
  const prof = effectiveWeaponProficiencies(character);
  const base = findMundaneByName(nameEn, item.nameFr);
  const simple = base ? base.simple : isSimpleWeaponName(nameEn);
  if (prof.martial && !simple) return true;
  if (prof.simple && simple) return true;
  return prof.specific.includes(nameEn);
}

function isSimpleWeaponName(nameEn: string): boolean {
  const w = MUNDANE_WEAPONS.find((m) => m.nameEn === nameEn);
  return w ? w.simple : false;
}

// ---------- Armor proficiency (maîtrise d'armures, SRD) ----------

/** Armor training profile for a class (SRD). */
export interface ArmorProficiencySet {
  light: boolean;
  medium: boolean;
  heavy: boolean;
  shields: boolean;
}

export const CLASS_ARMOR_PROFICIENCIES: Record<string, ArmorProficiencySet> = {
  Artificier: { light: true, medium: true, heavy: false, shields: true },
  Barbare: { light: true, medium: true, heavy: false, shields: true },
  Barde: { light: true, medium: false, heavy: false, shields: false },
  Clerc: { light: true, medium: true, heavy: false, shields: true },
  Druide: { light: true, medium: true, heavy: false, shields: true },
  Ensorceleur: { light: false, medium: false, heavy: false, shields: false },
  Guerrier: { light: true, medium: true, heavy: true, shields: true },
  Magicien: { light: false, medium: false, heavy: false, shields: false },
  Moine: { light: true, medium: false, heavy: false, shields: false },
  Occultiste: { light: true, medium: false, heavy: false, shields: false },
  Paladin: { light: true, medium: true, heavy: true, shields: true },
  Rôdeur: { light: true, medium: true, heavy: false, shields: true },
  Roublard: { light: true, medium: false, heavy: false, shields: false },
};

/** Class default armor proficiencies (SRD). Unknown class → nothing. */
export function classArmorProficiencies(className: string | null | undefined): ArmorProficiencySet {
  const cls = findClass(className);
  if (!cls) return { light: false, medium: false, heavy: false, shields: false };
  return (
    CLASS_ARMOR_PROFICIENCIES[cls.name] ?? {
      light: false,
      medium: false,
      heavy: false,
      shields: false,
    }
  );
}

/**
 * Effective armor proficiencies for a character: the explicit token list
 * (armorProficiencies: 'light'/'medium'/'heavy'/'shields') when set,
 * otherwise the class default — multiclass sheets union the starting class's
 * full set with each later class's "proficiencies gained" (SRD 5.1 table).
 */
export function effectiveArmorProficiencies(
  character: CharacterClassSource & { armorProficiencies?: string[] | null },
): ArmorProficiencySet {
  if (character.armorProficiencies != null) {
    const tokens = character.armorProficiencies;
    return {
      light: tokens.includes('light'),
      medium: tokens.includes('medium'),
      heavy: tokens.includes('heavy'),
      shields: tokens.includes('shields'),
    };
  }
  const classes = classesOf(character);
  const set = classArmorProficiencies(classes[0]?.classKey ?? null);
  if (classes.length <= 1) return set;
  const merged = { ...set };
  for (const entry of classes.slice(1)) {
    const gained = MULTICLASS_PROFICIENCIES_GAINED[findClass(entry.classKey)?.name ?? ''];
    if (!gained) continue;
    for (const token of gained.armor) merged[token] = true;
  }
  return merged;
}

/**
 * Is the character trained with this armor? (Magic armor follows its base;
 * family armor — "+1 armure (légère)" — follows its header family. Shields
 * follow the 'shields' token. Unresolvable items count as trained: the raw
 * non-proficiency downsides are disadvantage + blocked spellcasting, which
 * the sheet only surfaces as a hint, never blocks.)
 */
export function isProficientWithArmor(
  item: {
    category: string;
    name: string;
    nameFr?: string | null;
    acBase?: number | null;
    strMin?: number | null;
    description?: string | null;
  } & ItemBaseKeys,
  character: { characterClass?: string | null; armorProficiencies?: string[] | null },
): boolean {
  if (item.category !== 'armor') return false;
  const prof = effectiveArmorProficiencies(character);

  const nameLower = `${item.name ?? ''} ${item.nameFr ?? ''}`.toLowerCase();
  const magic = resolveMagicArmorBase(item);
  if (magic.shield || nameLower.includes('bouclier') || nameLower.includes('shield')) {
    return prof.shields;
  }

  let acBase = item.acBase;
  let base: MundaneArmor | null = null;
  if (acBase === null || acBase === 0) {
    if (!magic.base) {
      // Family armor: the description header names the family (légère/…)
      const header = item.description?.match(/^Armure \(([^)]+)\)/i)?.[1]?.toLowerCase() ?? '';
      if (header.includes('légère') || header.includes('legere')) return prof.light;
      if (header.includes('intermédiaire') || header.includes('intermediaire')) return prof.medium;
      if (header.includes('lourde')) return prof.heavy;
      return true; // unknowable base — don't warn
    }
    base = magic.base;
    acBase = magic.base.acBase;
  } else {
    base = findMundaneArmorByName(item.name, item.nameFr);
  }

  const armorType =
    base && base.armorType !== 'shield'
      ? base.armorType
      : item.strMin != null && item.strMin >= 13
        ? 'heavy'
        : acBase != null && acBase >= 13 && acBase <= 15
          ? 'medium'
          : 'light';
  if (armorType === 'light') return prof.light;
  if (armorType === 'medium') return prof.medium;
  return prof.heavy;
}

/** Find a mundane weapon by exact English or French name. */
export function findMundaneByName(
  nameEn: string | null | undefined,
  nameFr: string | null | undefined,
): MundaneWeapon | null {
  if (nameEn) {
    const byEn = MUNDANE_WEAPONS.find((m) => m.nameEn.toLowerCase() === nameEn.toLowerCase());
    if (byEn) return byEn;
  }
  if (nameFr) {
    const byFr = MUNDANE_WEAPONS.find((m) => m.nameFr.toLowerCase() === nameFr.toLowerCase());
    if (byFr) return byFr;
  }
  return null;
}

/** Entrée de resolveItemBases : un objet seed/BD avec ses noms FR/EN d'origine. */
export interface ItemBasesInput {
  category?: string | null;
  name: string | null;
  nameFr?: string | null;
  description?: string | null;
  properties?: string[];
  damageDice?: string | null;
}

/** Clés de base stables d'un objet — persistées en base, lues par le moteur. */
export interface ItemBases {
  baseWeapon: string | null;
  baseArmor: string | null;
  armorFamily: 'light' | 'medium' | 'heavy' | 'shield' | null;
  magicBonus: number | null;
}

/**
 * Résout les clés de base d'un objet UNE FOIS (seed, création, backfill boot) en
 * réutilisant les résolveurs par noms FR/EN. C'est l'outil d'import du
 * découplage moteur/noms — le runtime, lui, lit `Item.baseWeapon` etc.
 * (docs/i18n-engine-refactor-plan.md).
 */
export function resolveItemBases(item: ItemBasesInput): ItemBases {
  const out: ItemBases = {
    baseWeapon: null,
    baseArmor: null,
    armorFamily: null,
    magicBonus: null,
  };
  if (item.category === 'weapon') {
    const base = item.damageDice
      ? findMundaneByName(item.name, item.nameFr)
      : resolveMagicWeaponBase(item).base;
    if (base) {
      out.baseWeapon = base.nameEn;
      out.magicBonus = item.damageDice ? 0 : resolveMagicWeaponBase(item).magicBonus;
    }
    return out;
  }
  if (item.category === 'armor') {
    const magic = resolveMagicArmorBase(item);
    if (magic.shield) {
      out.armorFamily = 'shield';
      out.baseArmor = magic.base?.nameEn ?? 'Shield';
      out.magicBonus = magic.magicBonus || null;
      return out;
    }
    if (magic.base) {
      out.baseArmor = magic.base.nameEn;
      out.armorFamily = magic.base.armorType;
      out.magicBonus = magic.magicBonus || null;
      return out;
    }
    // Armure de famille (« +1 armure (légère) ») : famille seule
    const header = item.description?.match(/^Armure \(([^)]+)\)/i)?.[1]?.toLowerCase() ?? '';
    if (header.includes('légère') || header.includes('legere')) out.armorFamily = 'light';
    else if (header.includes('intermédiaire') || header.includes('intermediaire'))
      out.armorFamily = 'medium';
    else if (header.includes('lourde')) out.armorFamily = 'heavy';
  }
  return out;
}

/** Champs de clés de base optionnels — acceptés par les résolveurs runtime. */
export interface ItemBaseKeys {
  baseWeapon?: string | null;
  baseArmor?: string | null;
  armorFamily?: 'light' | 'medium' | 'heavy' | 'shield' | null;
  magicBonus?: number | null;
}

/** Result of resolving a magic weapon to its base weapon + magic bonus. */
export interface MagicWeaponBase {
  base: MundaneWeapon | null;
  /** True when the base is a family default (e.g. "n'importe quelle épée" → épée longue). */
  presumed: boolean;
  /** Flat attack & damage bonus (+1/+2/+3), 0 when none. */
  magicBonus: number;
}

/**
 * Resolve a magic weapon (damageDice null) to its base weapon and magic bonus.
 *
 * Detection order:
 *  1. Exact mundane name (EN or FR, word-boundary) inside the item name
 *     (e.g. "Dague venimeuse" → Dague).
 *  2. The French SRD description header `Arme (<base>)` — specific bases
 *     (épée longue, marteau de guerre…) or families with a presumed default
 *     (n'importe quelle épée → épée longue, hache → hache d'armes, masse → masse d'armes).
 *  3. Magic bonus: "+N" in the name, or "bonus de +N aux jets d'attaque et
 *     de dégâts" in the description.
 */
export function resolveMagicWeaponBase(
  item: {
    name: string | null;
    nameFr?: string | null;
    description?: string | null;
    properties?: string[];
    damageDice?: string | null;
  } & ItemBaseKeys,
): MagicWeaponBase {
  const result: MagicWeaponBase = { base: null, presumed: false, magicBonus: 0 };

  // Clé stable d'abord (docs/i18n-engine-refactor-plan.md) — insensible à la
  // langue d'affichage. Le parse de noms qui suit n'est plus qu'un repli pour
  // les lignes sans clés.
  if (item.baseWeapon) {
    const keyed = MUNDANE_WEAPONS.find((m) => m.nameEn === item.baseWeapon);
    if (keyed) {
      result.base = keyed;
      result.magicBonus = item.magicBonus ?? 0;
      return result;
    }
  }

  // Magic bonus from name ("Arme +2") or description
  const nameBonus = (item.name ?? '').match(/\+(\d)/);
  if (nameBonus) result.magicBonus = parseInt(nameBonus[1], 10);
  if (result.magicBonus === 0 && item.description) {
    // Accept both straight (') and typographic (’) apostrophes
    const descBonus = item.description.match(/bonus de \+(\d+) aux jets d['’]attaque et de dégâts/);
    if (descBonus) result.magicBonus = parseInt(descBonus[1], 10);
  }

  // 1. Word-boundary name match against mundane weapons (longest names first)
  const haystack = `${item.name ?? ''} ${item.nameFr ?? ''}`.toLowerCase();
  const candidates = [...MUNDANE_WEAPONS].sort((a, b) => b.nameFr.length - a.nameFr.length);
  for (const m of candidates) {
    const en = escapeRegExp(m.nameEn.toLowerCase());
    const fr = escapeRegExp(m.nameFr.toLowerCase());
    if (
      new RegExp(`(^|[^a-zà-öø-ÿ])${en}([^a-zà-öø-ÿ]|$)`).test(haystack) ||
      new RegExp(`(^|[^a-zà-öø-ÿ])${fr}([^a-zà-öø-ÿ]|$)`).test(haystack)
    ) {
      result.base = m;
      return result;
    }
  }

  // 2. Description header: "Arme (<base>)"
  const header = item.description?.match(/^Arme \(([^)]+)\)/i)?.[1]?.toLowerCase() ?? '';
  if (header) {
    const specific: Record<string, string> = {
      dague: 'Dagger',
      javeline: 'Javelin',
      'arc long': 'Longbow',
      cimeterre: 'Scimitar',
      'épée longue': 'Longsword',
      trident: 'Trident',
      'marteau de guerre': 'Warhammer',
      "masse d'armes": 'Mace',
    };
    for (const [needle, nameEn] of Object.entries(specific)) {
      if (header.includes(needle)) {
        result.base = MUNDANE_WEAPONS.find((m) => m.nameEn === nameEn) ?? null;
        return result;
      }
    }
    // Families → presumed defaults
    if (header.includes('épée')) {
      result.base = MUNDANE_WEAPONS.find((m) => m.nameEn === 'Longsword') ?? null;
      result.presumed = true;
    } else if (header.includes('hache')) {
      result.base = MUNDANE_WEAPONS.find((m) => m.nameEn === 'Battleaxe') ?? null;
      result.presumed = true;
    } else if (header.includes('masse')) {
      result.base = MUNDANE_WEAPONS.find((m) => m.nameEn === 'Mace') ?? null;
      result.presumed = true;
    }
  }

  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Computed attack & damage stats for a weapon, from SRD combat rules. */
export interface WeaponAttackStats {
  proficient: boolean;
  /** Ability used for attack & damage. */
  ability: 'strength' | 'dexterity';
  /** d20 attack bonus (ability mod + proficiency if proficient + magic bonus). */
  attackBonus: number;
  /** Damage with modifier & magic bonus, e.g. "2d6+3" (empty when the weapon has no dice, e.g. filet). */
  damageStr: string | null;
  damageTypeFr: string | null;
  /** Two-handed variant for versatile weapons, e.g. "1d10+3". */
  versatileDamageStr: string | null;
  /** Flat magic bonus (+1/+2/+3), 0 for mundane weapons. */
  magicBonus: number;
  /** True when the base weapon was inferred from a family (magic items). */
  presumedBase: boolean;
  /** Moine: the martial arts die replaced the weapon's damage die (SRD). */
  martialArtsDie: boolean;
  /** Lower d20 bound for a critical hit (Champion: 19 or 18; 20 = default). */
  critRange: 18 | 19 | 20;
  ranged: boolean;
  finesse: boolean;
}

function formatDiceWithMod(dice: string, mod: number): string | null {
  if (dice === '') return null;
  if (mod === 0) return dice;
  return mod > 0 ? `${dice}+${mod}` : `${dice}${mod}`;
}

/**
 * Compute attack & damage stats for a weapon item given the character.
 *
 * SRD rules: attack = d20 + ability modifier + proficiency (if proficient) + magic bonus.
 * Ability: melee → STR, ranged (ammunition) → DEX, finesse (and monk weapons for Monks)
 * → best of STR/DEX, thrown without finesse → STR.
 * Damage = weapon dice + same ability modifier (+ magic bonus).
 * Returns null for non-weapons or weapons with no dice and no resolvable base.
 */
export function computeWeaponStats(
  item: {
    category: string;
    name: string;
    nameFr?: string | null;
    description?: string | null;
    properties?: string[];
    damageDice?: string | null;
    damageType?: string | null;
  } & ItemBaseKeys,
  character: CharacterClassSource &
    Pick<Character, 'strength' | 'dexterity' | 'level'> & {
      weaponProficiencies?: string[] | null;
    },
): WeaponAttackStats | null {
  if (item.category !== 'weapon') return null;

  // Magic weapons: resolve base weapon + bonus
  let dice: string | null = item.damageDice ?? null;
  let damageType = item.damageType ?? null;
  let props = item.properties ?? [];
  let magicBonus = 0;
  let presumedBase = false;
  let nameEn = item.name;

  // Clé stable d'abord (docs/i18n-engine-refactor-plan.md) : en payload
  // mono-locale, `name` est localisé (FR par défaut) — le moteur raisonne
  // sur le nom anglais de la base, pour les armes mundane comme magiques.
  if (item.baseWeapon) {
    const keyed = MUNDANE_WEAPONS.find((m) => m.nameEn === item.baseWeapon);
    if (keyed) nameEn = keyed.nameEn;
  }

  if (!dice) {
    const magic = resolveMagicWeaponBase(item);
    if (!magic.base) return null;
    dice = magic.base.dice;
    damageType = magic.base.damageType;
    props = magic.base.properties;
    magicBonus = magic.magicBonus;
    presumedBase = magic.presumed;
    nameEn = magic.base.nameEn;
  }

  const strMod = abilityModifier(character.strength ?? 10);
  const dexMod = abilityModifier(character.dexterity ?? 10);
  const ranged = props.includes('ammunition');
  const finesse = props.includes('finesse');
  // Monk weapons (martial arts): STR or DEX for Monks — monk features key off
  // the Moine CLASS level (SRD multiclassing), not the character level.
  const monkLvl = classLevelOf(character, 'Moine');
  const monkWeapon = props.includes('monk') || isMonkWeaponName(nameEn, item.nameFr ?? null);
  const styles = fightingStylesOf(character);

  // Martial arts: the monk's damage die replaces the weapon's when larger
  // ("You can roll a d4 in place of the normal damage of your unarmed
  // strike or monk weapon") — monk weapons are all single-die.
  let martialDieApplied = false;
  if (monkLvl > 0 && monkWeapon && dice) {
    const mDie = martialArtsDie(monkLvl);
    const w = dice.match(/^(\d+)d(\d+)$/);
    const m = mDie.match(/^(\d+)d(\d+)$/);
    if (
      w &&
      m &&
      parseInt(w[1], 10) === 1 &&
      parseInt(m[1], 10) === 1 &&
      parseInt(m[2], 10) > parseInt(w[2], 10)
    ) {
      dice = mDie;
      martialDieApplied = true;
    }
  }

  let ability: 'strength' | 'dexterity';
  if (finesse || (monkLvl > 0 && monkWeapon)) {
    ability = dexMod >= strMod ? 'dexterity' : 'strength';
  } else if (ranged) {
    ability = 'dexterity';
  } else {
    ability = 'strength';
  }
  const abilityMod = ability === 'dexterity' ? dexMod : strMod;

  // Proficiency (magic weapons inherit the base weapon's category)
  const prof = effectiveWeaponProficiencies(character);
  const base = findMundaneByName(nameEn, item.nameFr);
  const simple = base ? base.simple : isSimpleWeaponName(nameEn);
  const proficient =
    (prof.martial && !simple) || (prof.simple && simple) || prof.specific.includes(nameEn);

  const attackBonus =
    abilityMod +
    (proficient ? proficiencyBonus(character.level ?? 1) : 0) +
    magicBonus +
    // Fighting style: Archery — +2 to attack rolls with ranged weapons
    (styles.has('archery') && ranged ? 2 : 0);

  // Fighting style: Dueling — +2 damage with a one-handed melee weapon
  // (the SRD "no other weapon" condition can't be checked per-item)
  const dueling = styles.has('dueling') && !ranged && !props.includes('two-handed');
  const damageStr = dice
    ? formatDiceWithMod(dice, abilityMod + magicBonus + (dueling ? 2 : 0))
    : null;
  const twoHanded =
    base?.twoHandedDice ?? MUNDANE_WEAPONS.find((m) => m.nameEn === nameEn)?.twoHandedDice;
  const versatileDamageStr =
    twoHanded && dice ? formatDiceWithMod(twoHanded, abilityMod + magicBonus) : null;

  return {
    proficient,
    ability,
    attackBonus,
    damageStr,
    damageTypeFr: damageType ? (DAMAGE_TYPE_LABELS_FR[damageType] ?? damageType) : null,
    versatileDamageStr,
    magicBonus,
    presumedBase,
    martialArtsDie: martialDieApplied,
    critRange: criticalRangeOf(character),
    ranged,
    finesse,
  };
}

/** Monk weapon names (SRD martial arts: simple melee + shortsword, minus heavy/two-handed). */
function isMonkWeaponName(nameEn: string, nameFr: string | null): boolean {
  const m = findMundaneByName(nameEn, nameFr);
  if (!m) return false;
  if (!m.simple) return m.nameEn === 'Shortsword';
  // Simple melee weapons (no ammunition) that aren't two-handed
  return !m.properties.includes('ammunition') && !m.properties.includes('two-handed');
}

// ---------- Armor-dependent speed (SRD) ----------

/** Monk Unarmored Movement bonus (meters) by level: 3 at 2, 4.5 at 6, 6 at 10, 7.5 at 14, 9 at 18. */
export function unarmoredMovementBonus(level: number): number {
  if (level >= 18) return 9;
  if (level >= 14) return 7.5;
  if (level >= 10) return 6;
  if (level >= 6) return 4.5;
  if (level >= 2) return 3;
  return 0;
}

export interface SpeedResult {
  /** Effective speed in meters (base + modifiers). */
  speed: number;
  /** Net bonus applied, 0 when none (meters). */
  bonus: number;
  /** Human-readable modifier sources (class bonus, armor penalty…). */
  sources: string[];
}

/**
 * Effective speed with SRD armor-dependent class features:
 *  - Moine, Déplacement sans armure: +bonus while wearing no armor and no shield
 *  - Barbare, Déplacement rapide (level 5+): +3 m unless wearing heavy armor
 * lang: langue des libellés `sources` ('fr' par défaut — identique octet par octet).
 */
export function computeSpeed(
  character: CharacterClassSource & { speed?: number; strength?: number },
  entries: Array<{
    item: {
      category: string;
      acBase: number | null;
      strMin: number | null;
      nameFr?: string | null;
      name: string;
      description?: string | null;
    } & ItemBaseKeys;
    equipped: boolean;
  }>,
  lang: AppLang = 'fr',
): SpeedResult {
  const base = character.speed ?? 9;

  const worn = entries.filter((e) => {
    if (!e.equipped || e.item.category !== 'armor') return false;
    const name = (e.item.nameFr ?? e.item.name).toLowerCase();
    if (name.includes('bouclier') || name.includes('shield')) return false;
    if (e.item.acBase !== null && e.item.acBase !== 0) return true;
    // Magic armor counts as worn if it resolved to a non-shield base
    return resolveMagicArmorBase(e.item).base !== null;
  });
  const wearingArmor = worn.length > 0;
  const wearingHeavy = worn.some((e) => {
    if (e.item.acBase !== null && e.item.acBase !== 0) {
      const base = findMundaneArmorByName(e.item.name, e.item.nameFr);
      return base ? base.armorType === 'heavy' : e.item.strMin !== null && e.item.strMin >= 13;
    }
    return resolveMagicArmorBase(e.item).base?.armorType === 'heavy';
  });
  const hasShield = entries.some((e) => {
    if (!e.equipped || e.item.category !== 'armor') return false;
    const name = (e.item.nameFr ?? e.item.name).toLowerCase();
    if (name.includes('bouclier') || name.includes('shield')) return true;
    if (e.item.acBase === null || e.item.acBase === 0) return resolveMagicArmorBase(e.item).shield;
    return false;
  });

  const sources: string[] = [];
  let speed = base;

  // Class movement features use CLASS levels; a Moine/Barbare multiclass gets
  // BOTH (distinctly named features — they stack, unlike Extra Attack).
  const monkLvl = classLevelOf(character, 'Moine');
  if (monkLvl > 0 && !wearingArmor && !hasShield) {
    const bonus = unarmoredMovementBonus(monkLvl);
    if (bonus > 0) {
      speed += bonus;
      sources.push(
        pickLang(lang, `Déplacement sans armure +${bonus} m`, `Unarmored Movement +${bonus} m`),
      );
    }
  }
  const barbLvl = classLevelOf(character, 'Barbare');
  if (barbLvl >= 5 && !wearingHeavy) {
    speed += 3;
    sources.push(pickLang(lang, 'Déplacement rapide +3 m', 'Fast Movement +3 m'));
  }

  // SRD: heavy armor worn below its STR minimum costs 3 m of speed
  const heavyWorn = entries.filter((e) => {
    if (!e.equipped || e.item.category !== 'armor') return false;
    const name = (e.item.nameFr ?? e.item.name).toLowerCase();
    if (name.includes('bouclier') || name.includes('shield')) return false;
    if (e.item.acBase !== null && e.item.acBase !== 0) {
      const base = findMundaneArmorByName(e.item.name, e.item.nameFr);
      return base ? base.armorType === 'heavy' : e.item.strMin !== null && e.item.strMin >= 13;
    }
    return resolveMagicArmorBase(e.item).base?.armorType === 'heavy';
  });
  const strScore = character.strength ?? 10;
  const underStrMin = heavyWorn.some((e) => {
    if (e.item.acBase !== null && e.item.acBase !== 0) {
      return (e.item.strMin ?? 0) > strScore;
    }
    return (resolveMagicArmorBase(e.item).base?.strMin ?? 0) > strScore;
  });
  if (underStrMin) {
    speed -= 3;
    sources.push(
      pickLang(lang, 'Armure lourde −3 m (FOR insuffisante)', 'Heavy armor −3 m (low STR)'),
    );
  }

  return { speed, bonus: speed - base, sources };
}

// ---------- Spell damage at slot level (SRD scaling) ----------

/** Scaled damage for a spell at a chosen slot level (cantrips: character level). */
export interface SpellDamagePreview {
  /** Dice string, e.g. "9d6". Null when the spell has no damage data. */
  dice: string | null;
  /** French damage type, e.g. "de feu". */
  typeFr: string | null;
}

/** Lowercase English damage types from spell damageJson → French. */
const SPELL_DAMAGE_TYPE_FR: Record<string, string> = {
  fire: 'de feu',
  cold: 'de froid',
  lightning: 'de foudre',
  thunder: 'de tonnerre',
  acid: "d'acide",
  poison: 'de poison',
  necrotic: 'nécrotiques',
  radiant: 'radiants',
  force: 'de force',
  psychic: 'psychiques',
  bludgeoning: 'contondants',
  piercing: 'perforants',
  slashing: 'tranchants',
};

/**
 * Damage a spell deals at the chosen slot level (slotted spells) or the
 * character's level (cantrips), from damageJson's damage_at_slot_level /
 * damage_at_character_level tables. Picks the highest known key at or
 * below the requested level.
 */
export function spellDamageAtLevel(
  spell: { level: number; damageJson: string | null },
  slotLevel: number,
  charLevel: number,
): SpellDamagePreview {
  if (!spell.damageJson) return { dice: null, typeFr: null };
  try {
    const dmg = JSON.parse(spell.damageJson) as {
      damage_type?: { index?: string };
      damage_at_slot_level?: Record<string, string>;
      damage_at_character_level?: Record<string, string>;
    };
    const table = spell.level === 0 ? dmg.damage_at_character_level : dmg.damage_at_slot_level;
    if (!table) return { dice: null, typeFr: null };
    const wanted = spell.level === 0 ? charLevel : slotLevel;
    const keys = Object.keys(table)
      .map(Number)
      .sort((a, b) => a - b);
    const best = [...keys].reverse().find((k) => k <= Math.max(wanted, keys[0]));
    const typeEn = dmg.damage_type?.index ?? '';
    return {
      dice: best !== undefined ? (table[String(best)] ?? null) : null,
      typeFr: SPELL_DAMAGE_TYPE_FR[typeEn] ?? null,
    };
  } catch {
    return { dice: null, typeFr: null };
  }
}

/** Healing a spell restores at a given slot level (cantrips: character level),
 * from damageJson's heal_at_slot_level / heal_at_character_level tables — the
 * healing mirror of the SRD damage tables. `dice` is the raw value ("1d8",
 * "4d8+15", Heal's flat "70") picked at the highest known key at or below the
 * requested level; `addsModifier` flags the SRD spells that heal "XdY + le
 * modificateur de votre caractéristique d'incantation" (Soins, Mot de
 * guérison…) — callers append the character's casting modifier. Display-only. */
export interface SpellHealingPreview {
  dice: string | null;
  addsModifier: boolean;
}

export function spellHealingAtLevel(
  spell: { level: number; damageJson: string | null },
  slotLevel: number,
  charLevel: number,
): SpellHealingPreview {
  if (!spell.damageJson) return { dice: null, addsModifier: false };
  try {
    const heal = JSON.parse(spell.damageJson) as {
      heal_at_slot_level?: Record<string, string>;
      heal_at_character_level?: Record<string, string>;
      heal_adds_modifier?: boolean;
    };
    const table = spell.level === 0 ? heal.heal_at_character_level : heal.heal_at_slot_level;
    if (!table) return { dice: null, addsModifier: false };
    const wanted = spell.level === 0 ? charLevel : slotLevel;
    const keys = Object.keys(table)
      .map(Number)
      .sort((a, b) => a - b);
    const best = [...keys].reverse().find((k) => k <= Math.max(wanted, keys[0]));
    return {
      dice: best !== undefined ? (table[String(best)] ?? null) : null,
      addsModifier: heal.heal_adds_modifier === true,
    };
  } catch {
    return { dice: null, addsModifier: false };
  }
}

// ---------- Divine domains (Clerc, SRD) ----------

export interface DivineDomainInfo {
  key: string;
  label: string;
  /** Spell level 1-5 → two English spell names (matched against the catalog). */
  spells: Record<number, [string, string]>;
}

/** The seven SRD cleric domains. Domain spells are always prepared and
 *  don't count against the prepared-spells limit. */
export const DIVINE_DOMAINS: DivineDomainInfo[] = [
  {
    key: 'savoir',
    label: 'Savoir',
    spells: {
      1: ['Command', 'Identify'],
      2: ['Augury', 'Suggestion'],
      3: ['Nondetection', 'Speak with Dead'],
      4: ['Arcane Eye', 'Confusion'],
      5: ['Legend Lore', 'Scrying'],
    },
  },
  {
    key: 'vie',
    label: 'Vie',
    spells: {
      1: ['Bless', 'Cure Wounds'],
      2: ['Lesser Restoration', 'Spiritual Weapon'],
      3: ['Beacon of Hope', 'Revivify'],
      4: ['Death Ward', 'Guardian of Faith'],
      5: ['Mass Cure Wounds', 'Raise Dead'],
    },
  },
  {
    key: 'lumiere',
    label: 'Lumière',
    spells: {
      1: ['Burning Hands', 'Faerie Fire'],
      2: ['Flaming Sphere', 'Scorching Ray'],
      3: ['Daylight', 'Fireball'],
      4: ['Guardian of Faith', 'Wall of Fire'],
      5: ['Flame Strike', 'Scrying'],
    },
  },
  {
    key: 'nature',
    label: 'Nature',
    spells: {
      1: ['Animal Friendship', 'Speak with Animals'],
      2: ['Barkskin', 'Spike Growth'],
      3: ['Plant Growth', 'Wind Wall'],
      4: ['Dominate Beast', 'Grasping Vine'],
      5: ['Insect Plague', 'Tree Stride'],
    },
  },
  {
    key: 'tempete',
    label: 'Tempête',
    spells: {
      1: ['Fog Cloud', 'Thunderwave'],
      2: ['Gust of Wind', 'Shatter'],
      3: ['Call Lightning', 'Sleet Storm'],
      4: ['Control Water', 'Ice Storm'],
      5: ['Destructive Wave', 'Insect Plague'],
    },
  },
  {
    key: 'tromperie',
    label: 'Tromperie',
    spells: {
      1: ['Charm Person', 'Disguise Self'],
      2: ['Mirror Image', 'Pass Without Trace'],
      3: ['Blink', 'Dispel Magic'],
      4: ['Dimension Door', 'Polymorph'],
      5: ['Dominate Person', 'Modify Memory'],
    },
  },
  {
    key: 'guerre',
    label: 'Guerre',
    spells: {
      1: ['Divine Favor', 'Shield of Faith'],
      2: ['Magic Weapon', 'Spiritual Weapon'],
      3: ['Crusader s mantle', 'Spirit Guardians'], // OCR: apostrophe lost in the catalog
      4: ['Freedom of Movement', 'Stoneskin'],
      5: ['Flame Strike', 'Hold Monster'],
    },
  },
];

/** Domain spell names unlocked at the given cleric level (spell level L unlocks at 2L−1). */
export function domainSpellsFor(
  domain: string | null | undefined,
  level: number,
): Array<{ level: number; names: string[] }> {
  if (!domain) return [];
  const info = DIVINE_DOMAINS.find((d) => d.key === domain);
  if (!info) return [];
  const out: Array<{ level: number; names: string[] }> = [];
  for (const lvl of [1, 2, 3, 4, 5]) {
    if (level >= 2 * lvl - 1) {
      out.push({ level: lvl, names: [...info.spells[lvl]] });
    }
  }
  return out;
}

// ---------- Circle spells (Druide, Terre) & Oath spells (Paladin, SRD) ----------

export interface LandCircleInfo {
  key: string;
  label: string;
  /** Spell level 2-5 → two English names; unlocked at druid levels 3/5/7/9. */
  spells: Record<number, [string, string]>;
}

/** Circle of the Land terrains — circle spells are always prepared (SRD). */
export const LAND_CIRCLES: LandCircleInfo[] = [
  {
    key: 'arctique',
    label: 'Arctique',
    spells: {
      2: ['Hold Person', 'Spike Growth'],
      3: ['Sleet Storm', 'Slow'],
      4: ['Freedom of Movement', 'Ice Storm'],
      5: ['Commune with Nature', 'Cone of Cold'],
    },
  },
  {
    key: 'littoral',
    label: 'Littoral',
    spells: {
      2: ['Mirror Image', 'Misty Step'],
      3: ['Water Breathing', 'Water Walk'],
      4: ['Control Water', 'Freedom of Movement'],
      5: ['Conjure Elemental', 'Scrying'],
    },
  },
  {
    key: 'desert',
    label: 'Désert',
    spells: {
      2: ['Blur', 'Silence'],
      3: ['Create Food and Water', 'Protection From Energy'],
      4: ['Blight', 'Hallucinatory Terrain'],
      5: ['Insect Plague', 'Wall of Stone'],
    },
  },
  {
    key: 'foret',
    label: 'Forêt',
    spells: {
      2: ['Barkskin', 'Spider Climb'],
      3: ['Call Lightning', 'Plant Growth'],
      4: ['Divination', 'Freedom of Movement'],
      5: ['Commune with Nature', 'Tree Stride'],
    },
  },
  {
    key: 'prairie',
    label: 'Prairie',
    spells: {
      2: ['Invisibility', 'Pass Without Trace'],
      3: ['Daylight', 'Haste'],
      4: ['Divination', 'Freedom of Movement'],
      5: ['Dream', 'Wall of Thorns'],
    },
  },
  {
    key: 'montagne',
    label: 'Montagne',
    spells: {
      2: ['Spider Climb', 'Spike Growth'],
      3: ['Lightning Bolt', 'Meld into Stone'],
      4: ['Stone Shape', 'Stoneskin'],
      5: ['Passwall', 'Wall of Stone'],
    },
  },
  {
    key: 'marais',
    label: 'Marais',
    spells: {
      2: ['Darkness', 'Acid Arrow'], // Acid Arrow = Flèche acide de Melf
      3: ['Water Walk', 'Stinking Cloud'],
      4: ['Freedom of Movement', 'Locate Creature'],
      5: ['Insect Plague', 'Scrying'],
    },
  },
  {
    key: 'outreterre',
    label: 'Outreterre',
    spells: {
      2: ['Spider Climb', 'Web'],
      3: ['Gaseous Form', 'Stinking Cloud'],
      4: ['Greater Invisibility', 'Stone Shape'],
      5: ['Cloudkill', 'Insect Plague'],
    },
  },
];

export interface SacredOathInfo {
  key: string;
  label: string;
  /** Spell level 1-5 → two English names; unlocked at paladin levels 3/5/9/13/17. */
  spells: Record<number, [string, string]>;
}

/** Paladin Sacred Oaths (SRD) — oath spells are always prepared. */
export const SACRED_OATHS: SacredOathInfo[] = [
  {
    key: 'devotion',
    label: 'Dévotion',
    spells: {
      1: ['Protection From Evil and Good', 'Sanctuary'],
      2: ['Aid', 'Zone of Truth'],
      3: ['Beacon of Hope', 'Dispel Magic'],
      4: ['Freedom of Movement', 'Guardian of Faith'],
      5: ['Commune', 'Flame Strike'],
    },
  },
  {
    key: 'anciennes',
    label: 'Anciennes',
    spells: {
      1: ['Ensnaring Strike', 'Speak with Animals'],
      2: ['Moonbeam', 'Misty Step'],
      3: ['Plant Growth', 'Protection From Energy'],
      4: ['Ice Storm', 'Freedom of Movement'],
      5: ['Commune with Nature', 'Tree Stride'],
    },
  },
  {
    key: 'vengeance',
    label: 'Vengeance',
    spells: {
      1: ['Bane', "Hunter's Mark"],
      2: ['Hold Person', 'Misty Step'],
      3: ['Haste', 'Protection From Energy'],
      4: ['Banishment', 'Dimension Door'],
      5: ['Hold Monster', 'Scrying'],
    },
  },
];

/**
 * Always-prepared bonus spells for druid (Circle of the Land terrain) or
 * paladin (Sacred Oath). Druid spell levels 2-5 unlock at levels 3/5/7/9;
 * paladin spell levels 1-5 unlock at levels 3/5/9/13/17.
 */
export function bonusPreparedSpells(
  cls: string | null | undefined,
  subclass: string | null | undefined,
  level: number,
): Array<{ level: number; names: string[] }> {
  if (!subclass) return [];
  const out: Array<{ level: number; names: string[] }> = [];
  if (cls === 'Druide') {
    const terrain = LAND_CIRCLES.find((t) => t.key === subclass);
    if (!terrain) return [];
    const unlock: Record<number, number> = { 2: 3, 3: 5, 4: 7, 5: 9 };
    for (const lvl of [2, 3, 4, 5]) {
      if (level >= unlock[lvl]) out.push({ level: lvl, names: [...terrain.spells[lvl]] });
    }
  } else if (cls === 'Paladin') {
    const oath = SACRED_OATHS.find((o) => o.key === subclass);
    if (!oath) return [];
    const unlock: Record<number, number> = { 1: 3, 2: 5, 3: 9, 4: 13, 5: 17 };
    for (const lvl of [1, 2, 3, 4, 5]) {
      if (level >= unlock[lvl]) out.push({ level: lvl, names: [...oath.spells[lvl]] });
    }
  }
  return out;
}

// ---------- Wild Shape (Druide, SRD) ----------

/**
 * Max beast CR by druid level: 1/4 (2-3), 1/2 (4-7), 1 (8+).
 * Circle of the Moon: level ÷ 3 rounded down, minimum 1 (Circle Forms).
 */
export function wildShapeMaxCR(level: number, circle?: string | null): number {
  if (circle === 'lune') return Math.max(1, Math.floor(level / 3));
  if (level >= 8) return 1;
  if (level >= 4) return 0.5;
  return 0.25;
}

/** Circle of the Moon, Elemental Wild Shape (level 10): the four SRD elementals. */
export const MOON_ELEMENTAL_SLUGS: readonly string[] = [
  'elementaire-de-l-air',
  'elementaire-de-l-eau',
  'elementaire-de-la-terre',
  'elementaire-du-feu',
];

export function wildShapeCanSwim(level: number): boolean {
  return level >= 4;
}

export function wildShapeCanFly(level: number): boolean {
  return level >= 8;
}

/** Wild Shape duration in hours (SRD: half the druid level, rounded down). */
export function wildShapeDurationHours(level: number): number {
  return Math.max(1, Math.floor(level / 2));
}

export interface WildShapeFormSummary {
  slug: string;
  name: string;
  challengeRating: number;
  size: string | null;
  armorClass: number | null;
  hitPoints: number | null;
  hitDice: string | null;
  fly: boolean;
  swim: boolean;
  /** The druid has seen this beast before (SRD requirement). */
  seen?: boolean;
}

/**
 * Roll HP from a hit dice formula like "2d6+0" or "18d10+36".
 * Each die is rolled individually, then the flat bonus is added
 * (formulas already include the CON bonus in the flat part).
 * Falls back to the average HP when the formula can't be parsed.
 */
export function rollHitPoints(hitDice: string | null, avgHp: number, _conMod = 0): number {
  if (!hitDice) return Math.max(1, avgHp);
  const match = hitDice.match(/^(\d+)d(\d+)(?:([+-]\d+))?$/);
  if (!match) return Math.max(1, avgHp);
  const numDice = parseInt(match[1], 10);
  const dieSize = parseInt(match[2], 10);
  const flatBonus = match[3] ? parseInt(match[3], 10) : 0;
  let total = flatBonus;
  for (let i = 0; i < numDice; i++) {
    total += Math.floor(Math.random() * dieSize) + 1;
  }
  return Math.max(1, total);
}

// ---------- Sneak Attack & Extra Attack (SRD) ----------

/** Rogue Sneak Attack dice: one d6 per 2 levels (ceil). */
export function sneakAttackDice(level: number): string {
  return `${Math.ceil(level / 2)}d6`;
}

/**
 * Extra Attack: attacks per Attack action.
 * Guerrier 2/3/4 at levels 5/11/20; Barbare, Paladin, Rôdeur, Moine 2 at level 5.
 */
export function extraAttacks(characterClass: string | null | undefined, level: number): number {
  const cls = findClass(characterClass)?.name;
  if (cls === 'Guerrier') {
    if (level >= 20) return 4;
    if (level >= 11) return 3;
    if (level >= 5) return 2;
  } else if (
    (cls === 'Barbare' || cls === 'Paladin' || cls === 'Rôdeur' || cls === 'Moine') &&
    level >= 5
  ) {
    return 2;
  }
  return 1;
}

/**
 * Extra Attack across all classes — « son effet n'est pas cumulatif » (SRD
 * multiclassing): take the MAX, each class evaluated at its own class level.
 */
export function extraAttacksOf(character: CharacterClassSource): number {
  let best = 1;
  for (const entry of classesOf(character)) {
    best = Math.max(best, extraAttacks(entry.classKey, entry.level));
  }
  return best;
}

// ---------- Critical range & Paladin auras (SRD) ----------

/**
 * Weapon crit range on the d20 (lower bound; 20 = default).
 * Guerrier Champion: 19 at level 3, 18 at level 15 (Critique amélioré/supérieur).
 */
export function criticalRange(
  characterClass: string | null | undefined,
  subclass: string | null | undefined,
  level: number,
): 18 | 19 | 20 {
  if (findClass(characterClass)?.name === 'Guerrier' && subclass === 'champion') {
    if (level >= 15) return 18;
    if (level >= 3) return 19;
  }
  return 20;
}

/** Champion improved critical, evaluated at the Guerrier CLASS level. */
export function criticalRangeOf(character: CharacterClassSource): 18 | 19 | 20 {
  for (const entry of classesOf(character)) {
    if (findClass(entry.classKey)?.name !== 'Guerrier') continue;
    if (entry.subclassKey !== 'champion') continue;
    if (entry.level >= 15) return 18;
    if (entry.level >= 3) return 19;
  }
  return 20;
}

/** Paladin Aura of Protection (Paladin CLASS level 6): +CHA mod (min 1) to all saves. */
export function auraOfProtectionBonus(
  character: CharacterClassSource & { charisma?: number },
): number {
  if (classLevelOf(character, 'Paladin') < 6) return 0;
  return Math.max(1, abilityModifier(character.charisma ?? 10));
}

/** Paladin aura radius in meters (3 m, 9 m from level 18). */
export function auraRadiusMeters(level: number): number {
  return level >= 18 ? 9 : 3;
}

// ---------- Unarmed strikes (SRD) ----------

/** Monk martial arts damage die by level (d4 → d6 at 5 → d8 at 11 → d10 at 17). */
export function martialArtsDie(level: number): string {
  if (level >= 17) return '1d10';
  if (level >= 11) return '1d8';
  if (level >= 5) return '1d6';
  return '1d4';
}

/** Computed unarmed-strike stats (everyone can punch; monks use martial arts). */
export interface UnarmedStats {
  /** d20 attack bonus (ability mod + proficiency — everyone is proficient with unarmed strikes). */
  attackBonus: number;
  ability: 'strength' | 'dexterity';
  /** e.g. "1+2", or "1d4+3" for monks. */
  damageStr: string;
  damageTypeFr: string;
  /** True when the character is a Monk (martial arts die + DEX option). */
  monk: boolean;
  /** Monks: one extra unarmed strike as a bonus action after attacking. */
  bonusActionAttack: boolean;
}

/**
 * Unarmed strike, SRD rules: attack = ability mod + proficiency, damage
 * 1 + mod bludgeoning. Monks (Arts martiaux) use DEX if better and roll
 * their martial arts die (martialArtsDie) instead of the flat 1, and can
 * make one unarmed strike as a bonus action.
 */
export function computeUnarmedStats(
  character: CharacterClassSource & Pick<Character, 'strength' | 'dexterity' | 'level'>,
): UnarmedStats {
  const strMod = abilityModifier(character.strength ?? 10);
  const dexMod = abilityModifier(character.dexterity ?? 10);
  const monkLvl = classLevelOf(character, 'Moine');
  const isMonk = monkLvl > 0;
  // Monks may use DEX for unarmed strikes; everyone else uses STR
  const ability: 'strength' | 'dexterity' = isMonk && dexMod >= strMod ? 'dexterity' : 'strength';
  const mod = ability === 'dexterity' ? dexMod : strMod;
  const prof = proficiencyBonus(character.level ?? 1);
  const dice = isMonk ? martialArtsDie(monkLvl) : '1';
  return {
    attackBonus: mod + prof,
    ability,
    damageStr: formatDiceWithMod(dice, mod) ?? dice,
    damageTypeFr: 'contondants',
    monk: isMonk,
    bonusActionAttack: isMonk,
  };
}

// ---------- Magic armor base resolution (SRD) ----------

/** One SRD mundane armor (names match the item catalog). strMin: 0 = no minimum. */
export interface MundaneArmor {
  nameEn: string;
  nameFr: string;
  acBase: number;
  strMin: number;
  stealthDisadvantage: boolean;
  armorType: 'light' | 'medium' | 'heavy' | 'shield';
}

export const MUNDANE_ARMORS: MundaneArmor[] = [
  {
    nameEn: 'Padded Armor',
    nameFr: 'Matelassée',
    acBase: 11,
    strMin: 0,
    stealthDisadvantage: true,
    armorType: 'light',
  },
  {
    nameEn: 'Leather Armor',
    nameFr: 'Cuir',
    acBase: 11,
    strMin: 0,
    stealthDisadvantage: false,
    armorType: 'light',
  },
  {
    nameEn: 'Studded Leather Armor',
    nameFr: 'Cuir clouté',
    acBase: 12,
    strMin: 0,
    stealthDisadvantage: false,
    armorType: 'light',
  },
  {
    nameEn: 'Hide Armor',
    nameFr: 'Peaux',
    acBase: 12,
    strMin: 0,
    stealthDisadvantage: false,
    armorType: 'medium',
  },
  {
    nameEn: 'Chain Shirt',
    nameFr: 'Chemise de mailles',
    acBase: 13,
    strMin: 0,
    stealthDisadvantage: false,
    armorType: 'medium',
  },
  {
    nameEn: 'Scale Mail',
    nameFr: "Cotte d'écailles",
    acBase: 14,
    strMin: 0,
    stealthDisadvantage: true,
    armorType: 'medium',
  },
  {
    nameEn: 'Breastplate',
    nameFr: 'Cuirasse',
    acBase: 14,
    strMin: 0,
    stealthDisadvantage: false,
    armorType: 'medium',
  },
  {
    nameEn: 'Half Plate Armor',
    nameFr: 'Demi-plate',
    acBase: 15,
    strMin: 0,
    stealthDisadvantage: true,
    armorType: 'medium',
  },
  {
    nameEn: 'Ring Mail',
    nameFr: 'Broigne',
    acBase: 14,
    strMin: 0,
    stealthDisadvantage: true,
    armorType: 'heavy',
  },
  {
    nameEn: 'Chain Mail',
    nameFr: 'Cotte de mailles',
    acBase: 16,
    strMin: 13,
    stealthDisadvantage: true,
    armorType: 'heavy',
  },
  {
    nameEn: 'Splint Armor',
    nameFr: 'Clibanion',
    acBase: 17,
    strMin: 15,
    stealthDisadvantage: true,
    armorType: 'heavy',
  },
  {
    nameEn: 'Plate Armor',
    nameFr: 'Harnois',
    acBase: 18,
    strMin: 15,
    stealthDisadvantage: true,
    armorType: 'heavy',
  },
  {
    nameEn: 'Shield',
    nameFr: 'Bouclier',
    acBase: 2,
    strMin: 0,
    stealthDisadvantage: false,
    armorType: 'shield',
  },
];

/** Find a mundane armor by exact English or French name. */
export function findMundaneArmorByName(
  nameEn: string | null | undefined,
  nameFr: string | null | undefined,
): MundaneArmor | null {
  if (nameEn) {
    const byEn = MUNDANE_ARMORS.find((a) => a.nameEn.toLowerCase() === nameEn.toLowerCase());
    if (byEn) return byEn;
  }
  if (nameFr) {
    const byFr = MUNDANE_ARMORS.find((a) => a.nameFr.toLowerCase() === nameFr.toLowerCase());
    if (byFr) return byFr;
  }
  return null;
}

/** Result of resolving a magic armor to its base armor + AC bonus. */
export interface MagicArmorBase {
  base: MundaneArmor | null; // null: family armor (légère/intermédiaire/lourde) — base unknowable
  shield: boolean;
  /** Flat AC bonus (+1/+2/+3), 0 when none. */
  magicBonus: number;
}

/**
 * Resolve a magic armor (acBase null) to its base armor and magic AC bonus.
 *
 * Detection order (mirrors resolveMagicWeaponBase):
 *  1. Shield: name contains bouclier/shield, or the description header
 *     `Armure (bouclier)`.
 *  2. Exact mundane name (EN or FR, word-boundary, longest first).
 *  3. Description header `Armure (<base>)` — specific bases, including the
 *     synonyms "plates"/"armure de plates" → Harnois (Plate). Family headers
 *     (légère/intermédiaire/lourde) resolve to no base.
 *  4. Bonus: "+N" in the name, or "bonus de +N à la CA" in the description —
 *     excluding the conditional "+N à la CA contre …" (Bouclier attrape-flèches).
 */
export function resolveMagicArmorBase(
  // Wider than Pick<Item, …>: computeAC/computeSpeed entry items carry an
  // optional description (string | null | undefined) — full Item still matches.
  item: { name: string | null; nameFr?: string | null; description?: string | null } & ItemBaseKeys,
): MagicArmorBase {
  const result: MagicArmorBase = { base: null, shield: false, magicBonus: 0 };

  // Clé stable d'abord (docs/i18n-engine-refactor-plan.md) — remplace le parse
  // d'en-têtes FR/noms, qui ne survit pas à un affichage localisé.
  if (item.baseArmor || item.armorFamily === 'shield') {
    result.shield = item.armorFamily === 'shield';
    result.base = MUNDANE_ARMORS.find((a) => a.nameEn === (item.baseArmor ?? 'Shield')) ?? null;
    result.magicBonus = item.magicBonus ?? 0;
    return result;
  }

  const header = item.description?.match(/^Armure \(([^)]+)\)/i)?.[1]?.toLowerCase() ?? '';
  const nameLower = `${item.name ?? ''} ${item.nameFr ?? ''}`.toLowerCase();

  // Shields
  if (
    nameLower.includes('bouclier') ||
    nameLower.includes('shield') ||
    header.includes('bouclier')
  ) {
    result.shield = true;
    result.base = MUNDANE_ARMORS.find((a) => a.armorType === 'shield') ?? null;
  }

  // Magic bonus: +N in the name, or "bonus de +N à la CA" (not the conditional "contre" variant)
  const nameBonus = (item.name ?? '').match(/\+(\d)/);
  if (nameBonus) result.magicBonus = parseInt(nameBonus[1], 10);
  if (result.magicBonus === 0 && item.description) {
    const descBonus = item.description.match(/bonus de \+(\d+) à la CA(?! contre)/i);
    if (descBonus) result.magicBonus = parseInt(descBonus[1], 10);
  }

  if (result.shield) return result;

  // Description header first — canonical and immune to French inflections
  // ("cuir cloutée" never word-matches "Cuir clouté" and would fall through
  // to the shorter base "Cuir")
  if (header) {
    const specific: Array<[string, string]> = [
      ["cotte d'écailles", 'Scale Mail'],
      ['chemise de mailles', 'Chain Shirt'],
      ['cuir clouté', 'Studded Leather Armor'],
      ['plates', 'Plate Armor'],
    ];
    for (const [needle, nameEn] of specific) {
      if (header.includes(needle)) {
        result.base = MUNDANE_ARMORS.find((a) => a.nameEn === nameEn) ?? null;
        return result;
      }
    }
    // Family headers (légère / intermédiaire ou lourde) → fall through to
    // name matching, then no base
  }

  // Exact mundane name (longest FR names first, word boundaries)
  const candidates = [...MUNDANE_ARMORS]
    .filter((a) => a.armorType !== 'shield')
    .sort((a, b) => b.nameFr.length - a.nameFr.length);
  for (const a of candidates) {
    const en = escapeRegExp(a.nameEn.toLowerCase());
    const fr = escapeRegExp(a.nameFr.toLowerCase());
    if (
      new RegExp(`(^|[^a-zà-öø-ÿ])${en}([^a-zà-öø-ÿ]|$)`).test(nameLower) ||
      new RegExp(`(^|[^a-zà-öø-ÿ])${fr}([^a-zà-öø-ÿ]|$)`).test(nameLower)
    ) {
      result.base = a;
      return result;
    }
  }

  return result;
}

// ---------- Spells (SRD catalog) ----------

export type SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

export const SPELL_SCHOOL_LABELS_FR: Record<SpellSchool, string> = {
  abjuration: 'Abjuration',
  conjuration: 'Invocation',
  divination: 'Divination',
  enchantment: 'Enchantement',
  evocation: 'Évocation',
  illusion: 'Illusion',
  necromancy: 'Nécromancie',
  transmutation: 'Transmutation',
};

export interface Spell {
  id: number;
  srdIndex: string;
  /** Localisé par l'API selon la langue de la requête (?lang=/Accept-Language, fr par défaut). */
  name: string;
  level: number; // 0-9 (0 = cantrip)
  school: SpellSchool;
  castingTime: string | null;
  rangeText: string | null;
  components: string[]; // ["V","S","M"]
  material: string | null;
  duration: string | null;
  concentration: boolean;
  ritual: boolean;
  /** Localisés par l'API selon la langue de la requête (repli FR si absent). */
  description: string | null;
  higherLevel: string | null;
  attackType: string | null; // "ranged"/"melee" or null
  damageJson: string | null;
  dcJson: string | null;
  classes: string[]; // French class names: ["Magicien","Ensorceleur"]
}

export interface CharacterSpell {
  id: number; // character_spells.id
  characterId: number;
  spell: Spell;
  prepared: boolean;
  /** Class whose list this spell was taken from (multiclassing SRD). */
  classSource: string | null;
  sortOrder: number;
  addedAt: string;
}

// ---------- Character features (free-form traits with templating) ----------

export type FeatureCategory = 'class' | 'racial' | 'background' | 'feat' | 'custom';

export interface CharacterFeature {
  id: number;
  characterId: number;
  title: string;
  category: FeatureCategory;
  description: string | null; // template text with {{variables}}
  /** Catalog link (classFeatures.ts id) when added from the SRD catalog — powers
   *  rest resets (short/long) and level-scaled counterMax recomputation. */
  catalogId: string | null;
  /** Player's recharge choice — OVERRIDES the catalog's SRD rule (the catalog
   *  pre-fills, the player decides). 'short' = court OU long, 'long' = repos
   *  long uniquement, 'none' = rechargement manuel explicite,
   *  null = suit la règle SRD du catalogue (ou manuel si pas de catalogue). */
  resetType: FeatureResetType | null;
  counterMax: number | null; // null/0 = no counter; positive = max charges
  counterCurrent: number | null;
  sortOrder: number;
  createdAt: string;
}

export interface CreateCharacterFeaturePayload {
  title: string;
  category?: FeatureCategory;
  description?: string;
  catalogId?: string | null;
  resetType?: FeatureResetType | null;
  counterMax?: number;
}

export interface PatchCharacterFeaturePayload {
  title?: string;
  category?: FeatureCategory;
  description?: string | null;
  catalogId?: string | null;
  resetType?: FeatureResetType | null;
  counterMax?: number | null;
  counterCurrent?: number | null;
}

export const FEATURE_CATEGORY_LABELS_FR: Record<FeatureCategory, string> = {
  class: 'Classe',
  racial: 'Race',
  background: 'Historique',
  feat: 'Don',
  custom: 'Personnalisé',
};

/**
 * Render a feature template by replacing {{variable}} tokens with computed
 * values from the character's stats. Unknown variables are left as-is.
 *
 * Supported variables:
 *   {{name}} {{level}} {{class}} {{race}} {{background}} {{speed}} {{max_hp}}
 *   {{prof}} {{initiative}} {{passive_perception}} {{save_dc}} {{spell_attack}}
 *   {{str}} {{dex}} {{con}} {{int}} {{wis}} {{cha}}
 *   {{str_mod}} {{dex_mod}} {{con_mod}} {{int_mod}} {{wis_mod}} {{cha_mod}}
 *   {{save:str}} {{save:dex}} {{save:con}} {{save:int}} {{save:wis}} {{save:cha}}
 *   {{skill:athletics}} {{skill:perception}} {{skill:arcanes}} ... (18 skills)
 */
export function renderFeatureTemplate(text: string, character: Character): string {
  if (!text) return text;

  const level = character.level ?? 1;
  const prof = proficiencyBonus(level);
  const classInfo = findClass(character.characterClass);
  const castingAbility = classInfo?.spellcastingAbility;
  const isCaster = !!(classInfo && classInfo.spellcasting !== 'none' && castingAbility);
  const castingMod =
    isCaster && castingAbility
      ? abilityModifier((character[castingAbility as keyof Character] as number) ?? 10)
      : 0;
  const wisMod = abilityModifier(character.wisdom ?? 10);
  const dexMod = abilityModifier(character.dexterity ?? 10);
  const perceptionLevel = skillProficiencyLevel(character, 'perception');
  const saveProfs = new Set(character.savingThrowProficiencies ?? []);

  // Build variable map
  const vars: Record<string, string> = {
    name: character.name,
    level: String(level),
    class: character.characterClass ?? '',
    race: character.race ?? '',
    background: character.background ?? '',
    speed: String(character.speed ?? 9),
    max_hp: String(character.maxHp ?? 1),
    prof: formatModifier(prof),
    initiative: formatModifier(dexMod),
    passive_perception: String(passivePerception(wisMod, prof, perceptionLevel)),
  };

  // Class-resource variables (feature catalog formulas)
  vars.bardic_die = bardicInspirationDie(level);
  vars.song_die = songOfRestDie(level);
  vars.invocations = String(eldritchInvocationsCount(level));
  vars.lay_on_hands = String(5 * level);
  vars.sneak_dice = sneakAttackDice(level);

  // Spellcasting variables
  if (isCaster) {
    vars.save_dc = String(spellSaveDC(castingMod, prof));
    vars.spell_attack = formatModifier(castingMod + prof);
  }

  // Ability scores and modifiers
  const abilities: Array<{ key: string; field: keyof Character }> = [
    { key: 'str', field: 'strength' },
    { key: 'dex', field: 'dexterity' },
    { key: 'con', field: 'constitution' },
    { key: 'int', field: 'intelligence' },
    { key: 'wis', field: 'wisdom' },
    { key: 'cha', field: 'charisma' },
  ];

  for (const { key, field } of abilities) {
    const score = (character[field] as number) ?? 10;
    vars[key] = String(score);
    vars[`${key}_mod`] = formatModifier(abilityModifier(score));
    // Saving throw modifiers
    vars[`save:${key}`] = formatModifier(
      abilityModifier(score) + (saveProfs.has(field as string) ? prof : 0),
    );
  }

  // Skill modifiers
  for (const skill of DND_SKILLS) {
    vars[`skill:${skill.key}`] = formatModifier(skillModifier(character, skill.key));
  }

  // Replace all {{variable}} tokens
  return text.replace(/\{\{(\w+:[\w]+|\w+)\}\}/g, (match, key: string) => {
    return vars[key] ?? match; // Leave unknown variables as-is
  });
}

// ---------- Rests (repos court / repos long, SRD) ----------

/** What a rest changes: the character PATCH plus catalog-feature counter resets. */
export interface RestResult {
  characterPatch: PatchCharacterPayload;
  /** Per-class hit-dice totals to persist on the character_classes rows. */
  classHitDice: Array<{ classKey: string; hitDiceUsed: number }>;
  featureResets: Array<{
    featureId: number;
    counterMax: number;
    counterCurrent: number;
  }>;
  /** Hit dice spent on the rest (counted — the PLAYER rolls them at the table). */
  diceSpent: number;
  /** Total HP actually regained (the player-entered healing, capped at max HP). */
  healed: number;
}

/**
 * Apply a short or long rest (pure — returns the patch, the caller persists it).
 *
 * Short rest: pact-magic slots restored (Occultiste), wild shape uses reset,
 * short-rest catalog counters reset, optional hit-dice spending. The dice are
 * rolled BY THE PLAYER at the table — we only count them (hitDiceSpent) and
 * apply the healing they announce (healedHp), capped at max HP; any HP regained
 * clears death saves.
 *
 * Long rest: HP to max, temp HP to 0, all slots restored, half the level (min 1)
 * hit dice regained, exhaustion −1, death saves cleared, concentration dropped,
 * wild shape uses reset, every catalog counter reset (max recomputed from the
 * formula at the current level). Conditions and food/water are untouched
 * (conditions persist through rests per SRD; survival flow is separate).
 */
export function applyRest(
  character: Character,
  features: Array<
    Pick<CharacterFeature, 'id' | 'catalogId' | 'resetType' | 'counterMax' | 'counterCurrent'>
  >,
  options: { type: 'short' | 'long'; hitDiceSpent?: number; healedHp?: number },
): RestResult {
  const level = character.level ?? 1;
  const classes = classesOf(character);
  const dice = hitDiceByClassOf(character);
  const patch: PatchCharacterPayload = {};
  let classHitDice: RestResult['classHitDice'] = [];

  // Counters to reset on this rest type. The PLAYER'S reset choice
  // (resetType — the checkboxes) overrides the catalog's SRD rule: the catalog
  // pre-fills, it doesn't automate. With no player choice, a catalog trait
  // follows its SRD rule, evaluated at the level of the class that GRANTS it
  // (SRD multiclassing) — never the character's total level.
  const featureResets: RestResult['featureResets'] = [];
  for (const feature of features) {
    if ((feature.counterMax ?? 0) <= 0) continue;
    const owner = feature.catalogId ? findClassFeatureClass(feature.catalogId) : null;
    const ownerLevel = owner
      ? (classes.find((c) => findClass(c.classKey)?.name === owner)?.level ?? level)
      : level;
    const effective = effectiveFeatureReset(feature, ownerLevel);
    // 'short' recharges on short AND long rests; 'long' only on long; 'none' never
    if (effective !== 'short' && !(effective === 'long' && options.type === 'long')) continue;
    // Catalog formula when the trait is catalog-linked with a resource,
    // otherwise the stored max (manual trait, or counter added by hand)
    const def = feature.catalogId ? findClassFeature(feature.catalogId) : null;
    const max = def?.resource
      ? (classFeatureResourceMax(def, character) ?? feature.counterMax ?? 0)
      : (feature.counterMax ?? 0);
    if (max <= 0) continue; // unlimited (Rage @20) or invalid: nothing to track
    featureResets.push({ featureId: feature.id, counterMax: max, counterCurrent: max });
  }

  // Hit-dice spending on a short rest: the player rolls their own dice at the
  // table — we only COUNT them (FIFO across class lines when they spend a
  // plain count) and apply the healing they announce (capped).
  let diceSpent = 0;
  let healed = 0;
  if (options.type === 'short') {
    const available = dice.reduce((sum, d) => sum + Math.max(0, d.max - d.used), 0);
    diceSpent = Math.max(0, Math.min(options.hitDiceSpent ?? 0, available));
    const announced = Math.max(0, Math.floor(options.healedHp ?? 0));
    if (diceSpent > 0) {
      let left = diceSpent;
      classHitDice = dice.map((d) => {
        const take = Math.min(Math.max(0, d.max - d.used), left);
        left -= take;
        return { classKey: d.classKey, hitDiceUsed: d.used + take };
      });
      patch.hitDiceUsed = (character.hitDiceUsed ?? 0) + diceSpent;
    }
    if (announced > 0) {
      const currentHp = Math.min(
        character.maxHp ?? Number.POSITIVE_INFINITY,
        character.currentHp + announced,
      );
      healed = currentHp - character.currentHp; // what was actually applied
      patch.currentHp = currentHp;
      // Regaining any HP ends the death-save tally (SRD)
      patch.deathSaveSuccesses = 0;
      patch.deathSaveFailures = 0;
    }
  }

  if (options.type === 'short') {
    // Pact magic recharges on a short rest (Occultiste — its own pool)
    if (classes.some((c) => findClass(c.classKey)?.name === 'Occultiste')) {
      patch.pactSlotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
    if (classes.some((c) => findClass(c.classKey)?.name === 'Druide')) {
      patch.wildShapeUses = 2;
    }
  } else {
    patch.currentHp = character.maxHp;
    patch.tempHp = 0;
    patch.spellSlotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    patch.pactSlotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    // Long rest: regain up to half the TOTAL dice pool, minimum 1 (SRD);
    // restored front-loaded by class-line order (the SRD leaves the choice
    // of which dice to the player — FIFO is the documented default).
    const totalDice = dice.reduce((sum, d) => sum + d.max, 0);
    const budget = Math.max(1, Math.floor(totalDice / 2));
    let left = budget;
    classHitDice = dice.map((d) => {
      const regain = Math.min(d.used, left);
      left -= regain;
      return { classKey: d.classKey, hitDiceUsed: d.used - regain };
    });
    patch.hitDiceUsed = classHitDice.reduce((sum, p) => sum + p.hitDiceUsed, 0);
    patch.exhaustion = Math.max(0, character.exhaustion - 1);
    patch.deathSaveSuccesses = 0;
    patch.deathSaveFailures = 0;
    patch.concentrating = false;
    if (classes.some((c) => findClass(c.classKey)?.name === 'Druide')) {
      patch.wildShapeUses = 2;
    }
  }

  return { characterPatch: patch, classHitDice, featureResets, diceSpent, healed };
}

// ---------- Character notes (free-form with simple formatting) ----------

export interface CharacterNote {
  id: number;
  characterId: number;
  title: string;
  content: string | null;
  sortOrder: number;
  updatedAt: string;
  createdAt: string;
}

export interface CreateCharacterNotePayload {
  title: string;
  content?: string;
}

export interface PatchCharacterNotePayload {
  title?: string;
  content?: string | null;
}

/** Reorder payload — ids in the new order. For features this covers ONE
 *  category group (sections are separate drag arenas); for notes the whole
 *  list. The server rewrites sort_order = index for exactly these ids. */
export interface ReorderPayload {
  order: number[];
}

// ---------- Carnet du MD (journal de campagne privé au MD) ----------

/** Les 4 saisons — le MD avance la sienne à la main (pas de mois au compteur). */
export type CampaignSeason = 'spring' | 'summer' | 'autumn' | 'winter';

export const CAMPAIGN_SEASONS: CampaignSeason[] = ['spring', 'summer', 'autumn', 'winter'];

export const CAMPAIGN_SEASON_LABELS_FR: Record<CampaignSeason, string> = {
  spring: 'Printemps',
  summer: 'Été',
  autumn: 'Automne',
  winter: 'Hiver',
};

/** L'horloge de campagne : une ligne par groupe (créée au premier accès MD). */
export interface CampaignState {
  partyId: number;
  day: number;
  season: CampaignSeason;
  /** Météo du jour courant — texte libre (« ☀️ Dégagé », « Pluie chaude »…). */
  weather: string | null;
  /** Journal du jour courant — figé dans campaign_days quand l'horloge avance. */
  note: string | null;
}

/** Un jour archivé : figé quand l'horloge avance (le journal des jours passés).
 *  N'entre au registre que s'il porte météo OU note. */
export interface CampaignDay {
  id: number;
  partyId: number;
  day: number;
  weather: string | null;
  note: string | null;
}

/** Échéance nommée. La cible est un jour ABSOLU — l'affichage « J−N » est
 *  dérivé (targetDay − jour courant), donc corriger le jour ne casse rien. */
export interface CampaignCountdown {
  id: number;
  partyId: number;
  label: string;
  targetDay: number;
  createdAt: string;
}

/** Note du carnet — même grammaire que les notes de fiche, au niveau du groupe. */
export interface DmNote {
  id: number;
  partyId: number;
  title: string;
  content: string | null;
  sortOrder: number;
  updatedAt: string;
  createdAt: string;
}

export type DmQuestStatus = 'preparation' | 'active' | 'done' | 'failed';

export const DM_QUEST_STATUSES: DmQuestStatus[] = ['active', 'preparation', 'done', 'failed'];

export const DM_QUEST_STATUS_LABELS_FR: Record<DmQuestStatus, string> = {
  preparation: 'Préparation',
  active: 'En cours',
  done: 'Terminée',
  failed: 'Échouée',
};

export interface DmQuest {
  id: number;
  partyId: number;
  title: string;
  body: string | null;
  status: DmQuestStatus;
  sortOrder: number;
  updatedAt: string;
  createdAt: string;
}

/** Réponse unique de GET /parties/:id/campaign — tout le carnet en un appel. */
export interface CampaignPayload {
  state: CampaignState;
  countdowns: CampaignCountdown[];
  days: CampaignDay[];
  notes: DmNote[];
  quests: DmQuest[];
}

export interface PatchCampaignStatePayload {
  /** Correction directe du numéro de jour (erreur de comptage, saut de voyage). */
  day?: number;
  season?: CampaignSeason;
  weather?: string | null;
  note?: string | null;
}

/** Retouche a posteriori d'un jour archivé (registre des jours passés). */
export interface PatchCampaignDayPayload {
  weather?: string | null;
  note?: string | null;
}

export interface AdvanceCampaignPayload {
  /** Jours à avancer (défaut 1 ; plafonné). */
  steps?: number;
}

export interface CreateCampaignCountdownPayload {
  label: string;
  targetDay: number;
}

export interface PatchCampaignCountdownPayload {
  label?: string;
  targetDay?: number;
}

export interface CreateDmNotePayload {
  title: string;
  content?: string;
}

export interface PatchDmNotePayload {
  title?: string;
  content?: string | null;
}

export interface CreateDmQuestPayload {
  title: string;
  body?: string;
  status?: DmQuestStatus;
}

export interface PatchDmQuestPayload {
  title?: string;
  body?: string | null;
  status?: DmQuestStatus;
}

/** Différentiel d'un compte à rebours, calculé côté client (jamais stocké). */
export function countdownRemaining(targetDay: number, day: number): number {
  return targetDay - day;
}

// ---------- Correspondance secrète MD ↔ joueur (fil par personnage) ----------

/** One entry in a character's secret thread. `fromGM` is resolved server-side
 *  (sender is a party GM) so the UI never trusts a client-sent role. */
export interface SecretMessage {
  id: number;
  characterId: number;
  senderUserId: number;
  senderName: string;
  fromGM: boolean;
  body: string;
  createdAt: string;
  /** Set when the RECIPIENT side read the message (owner or a GM). */
  readAt: string | null;
}

/** One register entry of the GM inbox — a character's thread at a glance. */
export interface MessageThreadSummary {
  characterId: number;
  characterName: string;
  ownerName: string;
  ownerUserId: number;
  hidden: boolean;
  lastMessage: SecretMessage | null;
  /** Messages waiting for THE CALLER to read (recipient-side unread). */
  unread: number;
}

export interface CreateMessagePayload {
  body: string;
}

/** Unread counts for the current user across a party's threads. */
export interface UnreadMessages {
  byCharacter: Record<string, number>;
  total: number;
}

/** List of available template variables for the help UI. */
export const TEMPLATE_VARIABLES: Array<{ syntax: string; description: string }> = [
  { syntax: '{{name}}', description: 'Nom du personnage' },
  { syntax: '{{level}}', description: 'Niveau' },
  { syntax: '{{class}}', description: 'Classe' },
  { syntax: '{{race}}', description: 'Race' },
  { syntax: '{{prof}}', description: 'Bonus de maîtrise (+3)' },
  { syntax: '{{save_dc}}', description: 'DD de sauvegarde des sorts (14)' },
  { syntax: '{{spell_attack}}', description: "Bonus d'attaque de sort (+6)" },
  { syntax: '{{str_mod}}', description: 'Modificateur de Force (+4)' },
  { syntax: '{{dex_mod}}', description: 'Modificateur de Dextérité (+2)' },
  { syntax: '{{con_mod}}', description: 'Modificateur de Constitution (+1)' },
  { syntax: '{{int_mod}}', description: "Modificateur d'Intelligence (+3)" },
  { syntax: '{{wis_mod}}', description: 'Modificateur de Sagesse (+1)' },
  { syntax: '{{cha_mod}}', description: 'Modificateur de Charisme (+0)' },
  { syntax: '{{save:dex}}', description: 'Sauvegarde de Dextérité (+2)' },
  { syntax: '{{save:con}}', description: 'Sauvegarde de Constitution (+1)' },
  { syntax: '{{skill:perception}}', description: 'Modificateur de Perception (+4)' },
  { syntax: '{{skill:athletics}}', description: "Modificateur d'Athlétisme (+4)" },
  { syntax: '{{passive_perception}}', description: 'Perception passive (14)' },
  { syntax: '{{initiative}}', description: 'Initiative (+2)' },
  { syntax: '{{speed}}', description: 'Vitesse en mètres (9, ou 7.5 pour les petites races)' },
  { syntax: '{{max_hp}}', description: 'PV maximum' },
];

// ---------- Inventory & Storage ----------

export type StorageType = 'carried' | 'mount' | 'container';

export interface StorageLocation {
  id: number;
  characterId: number;
  name: string;
  type: StorageType;
  strength: number | null; // for mounts
  multiplier: number; // Beast of Burden = 2
  capacityKg: number | null; // fixed for containers
  ownWeightKg: number; // container's weight on carrier
  itemId: number | null; // link to catalog item
  sortOrder: number;
}

export interface LocationWeight {
  locationId: number;
  locationName: string;
  locationType: StorageType;
  itemsWeightKg: number; // weight of items in this location
  ownWeightKg: number; // container's own weight
  maxCapacityKg: number | null; // null = uses STR formula (carried)
  pct: number; // fill percentage
}

export interface InventoryEntry {
  id: number;
  characterId: number;
  itemId: number;
  item: Item;
  quantity: number;
  equipped: boolean;
  notes: string | null;
  storageLocationId: number | null;
  addedAt: string;
}

export interface EncumbranceState {
  /** Total carried weight in kg (items + coins). */
  totalWeightKg: number;
  /** Weight of coins alone, in kg. */
  coinWeightKg: number;
  /** STR-derived thresholds (kg). */
  encumberedKg: number;
  heavilyEncumberedKg: number;
  maxCarryKg: number;
  /** Current tier label. */
  tier: 'unencumbered' | 'encumbered' | 'heavilyEncumbered' | 'overburdened';
  /** Percentage of max carry capacity (0-100+, capped at 100 for bar fill). */
  pct: number;
}

export interface CharacterInventory {
  character: Character;
  entries: InventoryEntry[];
  encumbrance: EncumbranceState;
  locations: StorageLocation[];
  locationWeights: LocationWeight[];
}

export interface AddInventoryPayload {
  itemId: number;
  quantity?: number;
  equipped?: boolean;
  notes?: string;
  storageLocationId?: number | null;
}

export interface PatchInventoryPayload {
  quantity?: number;
  equipped?: boolean;
  notes?: string | null;
  storageLocationId?: number | null;
}

export interface CreateStorageLocationPayload {
  name: string;
  type: StorageType;
  strength?: number;
  multiplier?: number;
  capacityKg?: number | null;
  ownWeightKg?: number;
  itemId?: number | null;
}

export interface TransferPayload {
  toCharacterId: number;
  inventoryId: number;
  quantity: number;
}

// ---------- Encumbrance math (shared) ----------

/** 1 lb = 0.4536 kg (used by the import script). */
export const LB_TO_KG = 0.4536;

/**
 * DMG variant encumbrance thresholds.
 * Official French SRD metric values (5e-drs.fr / SRD 5.1 FR):
 * STR × 2.5 / 5 / 7.5 kg (the French publisher rounded to clean metric numbers,
 * instead of converting 5/10/15 lb → 2.27/4.54/6.80 kg).
 */
export const ENCUMBRANCE_FACTORS = {
  encumbered: 2.5,
  heavily: 5.0,
  max: 7.5,
} as const;

/** Standard PHB mode: STR × 7.5 kg (max only). */
export const STANDARD_MAX_FACTOR = 7.5;

export function computeEncumbrance(
  totalWeightKg: number,
  strength: number,
  mode: EncumbranceMode,
  coinWeightKg: number = 0,
  capacityMultiplier: number = 1,
): EncumbranceState {
  const mult = capacityMultiplier > 0 ? capacityMultiplier : 1;
  const encumberedKg = +(strength * ENCUMBRANCE_FACTORS.encumbered * mult).toFixed(2);
  const heavilyEncumberedKg = +(strength * ENCUMBRANCE_FACTORS.heavily * mult).toFixed(2);
  const maxCarryKg = +(strength * ENCUMBRANCE_FACTORS.max * mult).toFixed(2);

  let tier: EncumbranceState['tier'];
  if (mode === 'standard') {
    tier = totalWeightKg > maxCarryKg ? 'overburdened' : 'unencumbered';
  } else if (mode === 'slots') {
    // slots mode doesn't use weight thresholds; report unencumbered unless over max
    tier = totalWeightKg > maxCarryKg ? 'overburdened' : 'unencumbered';
  } else {
    if (totalWeightKg > maxCarryKg) tier = 'overburdened';
    else if (totalWeightKg > heavilyEncumberedKg) tier = 'heavilyEncumbered';
    else if (totalWeightKg > encumberedKg) tier = 'encumbered';
    else tier = 'unencumbered';
  }

  const pct = maxCarryKg > 0 ? Math.min(100, (totalWeightKg / maxCarryKg) * 100) : 0;

  return { totalWeightKg, coinWeightKg, encumberedKg, heavilyEncumberedKg, maxCarryKg, tier, pct };
}

// ---------- Coin conversion ----------

/** Convert all coins to copper pieces (lowest denomination). */
export const COIN_TO_CP: Record<CostUnit, number> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

export const COIN_LABELS_FR: Record<CostUnit, string> = {
  cp: 'PC', // Pièce de Cuivre
  sp: 'PA', // Pièce d'Argent
  ep: 'PE', // Pièce d'Électrum
  gp: 'PO', // Pièce d'Or
  pp: 'PP', // Pièce de Platine
};

export const RARITY_LABELS_FR: Record<Rarity, string> = {
  common: 'Commun',
  uncommon: 'Peu commun',
  rare: 'Rare',
  veryRare: 'Très rare',
  legendary: 'Légendaire',
  artifact: 'Artefact',
  none: '—',
};

export const CATEGORY_LABELS_FR: Record<ItemCategory, string> = {
  weapon: 'Arme',
  armor: 'Armure',
  gear: 'Équipement',
  tool: 'Outil',
  mount: 'Monture / Véhicule',
  ammunition: 'Munitions',
  magic: 'Objet magique',
  custom: 'Personnalisé',
};

export const ENCUMBRANCE_LABELS_FR: Record<EncumbranceState['tier'], string> = {
  unencumbered: 'Sans encombre',
  encumbered: 'Encombré',
  heavilyEncumbered: 'Lourdement encombré',
  overburdened: 'Surchargé',
};

// ---------- Monsters (French SRD bestiary) ----------

export interface MonsterAction {
  name: string;
  desc: string;
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  cost?: number; // legendary actions only: 1/2/3
}

// ---------- Analyse bilingue des textes d'action du bestiaire ----------

/** Préambules d'attaque 5e.tools abrégés → formulation SRD anglaise. */
const ATTACK_MODE_LABELS_EN: Record<string, string> = {
  mw: 'Melee Weapon Attack',
  rw: 'Ranged Weapon Attack',
  ms: 'Melee Spell Attack',
  rs: 'Ranged Spell Attack',
};

/**
 * Nettoie le texte d'une action du bestiaire EN (source 5e.tools) : restitue
 * le préambule d'attaque canonique (« mw 4 to hit » → « Melee Weapon Attack:
 * +4 to hit ») et le marqueur « Hit: » ({@h}).
 */
export function cleanMonsterActionTextEn(desc: string): string {
  let s = desc;
  s = s.replace(
    /\b(mw|rw|ms|rs)((?:\s*,\s*(?:mw|rw|ms|rs))*)\s+(\d+)\s+to hit/g,
    (_all: string, first: string, rest: string, bonus: string) => {
      const modes = [
        first,
        ...rest
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      ];
      const label =
        modes.length > 1
          ? `${ATTACK_MODE_LABELS_EN[modes[0]] ?? 'Attack'} or ${
              ATTACK_MODE_LABELS_EN[modes[modes.length - 1]] ?? 'Attack'
            }`
          : (ATTACK_MODE_LABELS_EN[modes[0]] ?? 'Attack');
      return `${label}: +${bonus} to hit`;
    },
  );
  s = s.replace(/\{@h\}\s*/g, 'Hit: ');
  return s;
}

/** Préfixes FR des types de dégâts → anglais (repli quand l'analyse EN échoue). */
const DAMAGE_TYPE_PREFIXES_EN: Array<[string, string]> = [
  ['contondant', 'bludgeoning'],
  ['tranchant', 'slashing'],
  ['perforant', 'piercing'],
  ['feu', 'fire'],
  ['froid', 'cold'],
  ['acide', 'acid'],
  ['poison', 'poison'],
  ['foudre', 'lightning'],
  ['tonnerre', 'thunder'],
  ['radiant', 'radiant'],
  ['nécrotiqu', 'necrotic'],
  ['psychiqu', 'psychic'],
  ['force', 'force'],
];

export function monsterDamageTypeEn(fr: string | null | undefined): string | null | undefined {
  if (!fr) return fr;
  const low = fr.toLowerCase();
  for (const [prefix, en] of DAMAGE_TYPE_PREFIXES_EN) {
    if (low.startsWith(prefix)) return en;
  }
  return fr;
}

/**
 * Mots FR de type de dégât — singulier/pluriel/féminin, formes préfixées —
 * vers l'anglais canonique. Les clés déjà anglaises passent telles quelles.
 */
const DAMAGE_TYPE_WORDS_EN: Record<string, string> = {
  contondant: 'bludgeoning',
  contondante: 'bludgeoning',
  contondants: 'bludgeoning',
  contondantes: 'bludgeoning',
  tranchant: 'slashing',
  tranchante: 'slashing',
  tranchants: 'slashing',
  tranchantes: 'slashing',
  perforant: 'piercing',
  perforante: 'piercing',
  perforants: 'piercing',
  perforantes: 'piercing',
  'de feu': 'fire',
  feu: 'fire',
  'de froid': 'cold',
  froid: 'cold',
  'de foudre': 'lightning',
  foudre: 'lightning',
  'de tonnerre': 'thunder',
  tonnerre: 'thunder',
  "d'acide": 'acid',
  acide: 'acid',
  'de poison': 'poison',
  poison: 'poison',
  nécrotique: 'necrotic',
  nécrotiques: 'necrotic',
  radiant: 'radiant',
  radiante: 'radiant',
  radiants: 'radiant',
  radiantes: 'radiant',
  'de force': 'force',
  force: 'force',
  psychique: 'psychic',
  psychiques: 'psychic',
  // Valeurs déjà anglaises (index SRD / analyse du texte EN) — passage direct.
  // ('radiant' est couvert par l'entrée FR — même orthographe.)
  bludgeoning: 'bludgeoning',
  piercing: 'piercing',
  slashing: 'slashing',
  fire: 'fire',
  cold: 'cold',
  lightning: 'lightning',
  thunder: 'thunder',
  acid: 'acid',
  necrotic: 'necrotic',
  psychic: 'psychic',
};

/**
 * Libellé d'affichage d'un type de dégât. 'fr' (défaut) renvoie la valeur
 * telle quelle — la valeur stockée EST le français. 'en' mappe le mot FR
 * (variantes incluses) vers l'anglais ; les valeurs non reconnues passent
 * par `monsterDamageTypeEn` (préfixes) puis restent inchangées.
 */
export function damageTypeLabel(
  fr: string | null | undefined,
  lang: AppLang = 'fr',
): string | null | undefined {
  if (fr == null || lang !== 'en') return fr;
  return DAMAGE_TYPE_WORDS_EN[fr.toLowerCase()] ?? monsterDamageTypeEn(fr);
}

/** Mots d'alignement du bestiaire → anglais (vocable fermé SRD 5.1). */
const ALIGNMENT_WORDS_EN: Record<string, string> = {
  loyal: 'Lawful',
  loyale: 'Lawful',
  neutre: 'Neutral',
  mauvais: 'Evil',
  mauvaise: 'Evil',
  bon: 'Good',
  bonne: 'Good',
  chaotique: 'Chaotic',
  ou: 'or',
};

/**
 * Alignement du bestiaire (FR, casse variable, OCR) → anglais : les neuf
 * combinaisons, « non aligné », et les formes « tout/n'importe quel
 * alignement … ». Les parenthèses (pourcentages) passent telles quelles ;
 * une valeur exotique reste inchangée.
 */
export function monsterAlignmentEn(fr: string): string {
  const norm = fr.trim().replace(/\s+/g, ' ');
  const low = norm.toLowerCase();
  if (/^non[- ]alignée?$/.test(low) || low === 'sans alignement') return 'Unaligned';
  const any = low.match(/^(?:n'importe quel alignement|tout alignement)\s*(.*)$/);
  if (any) {
    const rest = any[1].trim();
    if (rest === '') return 'Any alignment';
    if (rest === 'chaotique') return 'Any chaotic alignment';
    if (rest === 'mauvais') return 'Any evil alignment';
    if (rest === 'bon') return 'Any good alignment';
    if (rest === 'non bon') return 'Any non-good alignment';
    if (rest === 'non loyal') return 'Any non-lawful alignment';
    if (rest === 'autre que bon') return 'Any alignment other than good';
    if (rest === 'autre que loyal') return 'Any alignment other than lawful';
  }
  return norm
    .split(' ')
    .map((w) => ALIGNMENT_WORDS_EN[w.toLowerCase()] ?? w)
    .join(' ')
    .replace(/^alignement\s+/i, '')
    .replace(/\s{2,}/g, ' ');
}

/** États du bestiaire (minuscules OCR, variantes) → anglais SRD 5.1. */
const MONSTER_CONDITION_LABELS_EN: Record<string, string> = {
  'à terre': 'Prone',
  agrippé: 'Grappled',
  assourdi: 'Deafened',
  aveuglé: 'Blinded',
  charmé: 'Charmed',
  effrayé: 'Frightened',
  empoigné: 'Grappled',
  empoisonné: 'Poisoned',
  entravé: 'Restrained',
  épuisé: 'Exhaustion',
  épuisement: 'Exhaustion',
  étourdi: 'Stunned',
  inconscient: 'Unconscious',
  paralysé: 'Paralyzed',
  pétrifié: 'Petrified',
  terrorisé: 'Frightened',
  terrifié: 'Frightened',
};

/** État d'immunité FR → EN (casse insensible ; valeur inconnue inchangée). */
export function monsterConditionEn(fr: string): string {
  return MONSTER_CONDITION_LABELS_EN[fr.trim().toLowerCase()] ?? fr;
}

/** Phrases composées de résistance/immunité → formulation SRD anglaise. */
const MONSTER_DAMAGE_TRAITS_EN: Record<string, string> = {
  "contondant, perforant et tranchant d'attaques magiques":
    'bludgeoning, piercing, and slashing from magical attacks',
  "contondant, perforant et tranchant d'attaques non magiques":
    'bludgeoning, piercing, and slashing from nonmagical attacks',
  "contondant, perforant, ou tranchant d'attaques non magiques":
    'bludgeoning, piercing, or slashing from nonmagical attacks',
  "contondant, tranchant, et perforant d'attaques non magiques":
    'bludgeoning, piercing, and slashing from nonmagical attacks',
  "contondant, perforant et tranchant d'attaques non magiques qui ne sont pas en adamantium":
    "bludgeoning, piercing, and slashing from nonmagical attacks that aren't adamantine",
  "contondant, perforant et tranchant d'attaques non magiques qui ne sont pas en argent":
    "bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered",
  'tranchants des attaques non magiques': 'slashing from nonmagical attacks',
  "tranchants des attaques non magiques sauf celles venant d'une arme en adamantium":
    "slashing from nonmagical attacks that aren't adamantine",
  "tranchants des armes non magiques autres qu'en adamantium":
    'slashing from nonmagical weapons other than adamantine',
  'perforants et tranchants des attaques non magiques':
    'piercing and slashing from nonmagical attacks',
  'perforants et tranchants infligés par des attaques non magiques':
    'piercing and slashing from nonmagical attacks',
  "de froid (tant qu'il porte l'anneau de l'hiver)": 'cold (while wearing the Ring of Winter)',
};

/**
 * Résistance/immunité aux dégâts du bestiaire (FR, phrases OCR) → anglais :
 * phrase composée exacte d'abord (les formulations « d'attaques non
 * magiques… » sont fermées), sinon chaque terme séparé par « ; » passe par
 * `damageTypeLabel`. Une valeur exotique reste inchangée.
 */
export function monsterDamageTraitEn(fr: string): string {
  const norm = fr.trim().replace(/\s+/g, ' ');
  const exact = MONSTER_DAMAGE_TRAITS_EN[norm.toLowerCase()];
  if (exact) return exact;
  if (norm.includes(';')) {
    return norm
      .split(';')
      .map((part) => damageTypeLabel(part.trim(), 'en') ?? '')
      .join('; ');
  }
  return damageTypeLabel(norm, 'en') ?? norm;
}

/** Compétences du bestiaire : nom FR (OCR, casse/accents variables) → EN SRD. */
const MONSTER_SKILLS_EN: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const skill of DND_SKILLS) {
    const key = skill.label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    out[key] = DND_SKILLS_EN[skill.key] ?? skill.label;
  }
  // Synonymes du bestiaire (5e-drs) absents du canon DND_SKILLS.
  out.intuition = DND_SKILLS_EN.insight; // « Perspicacité »
  out.tromperie = DND_SKILLS_EN.deception; // « Supercherie »
  return out;
})();

/** Nom de compétence du bestiaire FR → EN (repli : la valeur inchangée). */
export function monsterSkillEn(name: string): string {
  const stripped = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const exact = MONSTER_SKILLS_EN[stripped.trim()];
  if (exact) return exact;
  // Déchets OCR (« Perspicacité +S », « Représentation+? ») : coupe au plus
  // long préfixe reconnu (frontière mot ou non-lettre), le reste suit tel quel.
  for (let cut = stripped.length; cut >= 3; cut--) {
    const prefix = stripped.slice(0, cut);
    const mapped = MONSTER_SKILLS_EN[prefix];
    if (mapped && (cut === stripped.length || /[^a-z]/.test(stripped[cut] ?? ''))) {
      const rest = name.slice(cut).trim();
      return rest === '' ? mapped : `${mapped} ${rest}`;
    }
  }
  return name;
}

/** Codes de caractéristique FR des jets de sauvegarde → abréviation EN. */
const SAVE_ABILITY_CODES_EN: Record<string, string> = {
  for: 'Str',
  dex: 'Dex',
  con: 'Con',
  int: 'Int',
  sag: 'Wis',
  cha: 'Cha',
};

/** Jet de sauvegarde du bestiaire (« For +4 » → « Str +4 » ; sinon inchangé). */
export function monsterSaveEn(fr: string): string {
  const m = fr.match(/^([A-Za-z]{3})\b/);
  if (!m) return fr;
  const en = SAVE_ABILITY_CODES_EN[m[1].toLowerCase()];
  return en ? en + fr.slice(m[1].length) : fr;
}

/** Description d'armure du bestiaire : jetons FR (vocable fermé) → EN SRD. */
const MONSTER_ARMOR_TOKENS_EN: Record<string, string> = {
  'armure naturelle': 'natural armor',
  'armure naturelle et mystique': 'natural and mystical armor',
  'armure de cuir clouté': 'studded leather armor',
  'armure de cuir': 'leather armor',
  'armure de peaux': 'hide armor',
  'armure de peau': 'hide armor',
  "armure d'écailles": 'scale mail',
  'armure de pièces': 'patchwork armor',
  'armure de coquillages': 'shell armor',
  'armure composite': 'composite armor',
  'chemise de mailles': 'chain shirt',
  'cotte de mailles': 'chain mail',
  'demi-plate': 'half plate armor',
  cuirasse: 'breastplate',
  harnois: 'plate armor',
  clibanion: 'splint armor',
  broigne: 'ring mail',
  'cuir clouté': 'studded leather',
  plate: 'plate armor',
  bouclier: 'shield',
  'armure du mage': 'mage armor',
  'armure de mage': 'mage armor',
  "peau d'écorce": 'barkskin',
  'bracelets de défense': 'bracers of defense',
  'restes de caparaçonnage': 'caparison remnants',
  "débris d'armure": 'armor scraps',
  'débris de barde': 'barding scraps',
  'manteau renforcé rudimentaire': 'crude reinforced cloak',
  'parfois plus avec une armure': 'sometimes more with armor',
  "voir l'aptitude armure naturelle": 'see the natural armor feature',
  cage: 'cage',
};

/**
 * `armorDesc` du bestiaire FR → EN : jetons séparés par «, » mappés un à un
 * (vocable fermé de 45 valeurs sur les graines), préfixe « N avec … »
 * préservé (« 15 avec armure du mage » → « 15 with mage armor »). Une valeur
 * inconnue reste inchangée.
 */
export function monsterArmorDescEn(fr: string): string {
  const withPrefix = fr
    .trim()
    .replace(/\s+/g, ' ')
    .match(/^(\d+)\s+avec\s+(.+)$/);
  const body = withPrefix ? withPrefix[2] : fr.trim().replace(/\s+/g, ' ');
  const mapped = body
    .split(',')
    .map((token) => MONSTER_ARMOR_TOKENS_EN[token.trim().toLowerCase()] ?? token.trim())
    .filter(Boolean)
    .join(', ');
  return withPrefix ? `${withPrefix[1]} with ${mapped}` : mapped;
}

/**
 * Extrait bonus d'attaque, dés de dégâts et type d'un texte d'action, FR
 * (« +9 pour toucher », « 15 (3d6+5) dégâts contondants ») ou EN (« +9 to
 * hit », « 15 (3d6 + 5) bludgeoning damage »). Les dés sont normalisés
 * compacts (« 3d6 + 5 » → « 3d6+5 »). Comme l'import FR, les dés ne sont
 * retenus que suivis d'un type de dégâts (les « regains N (XdY) PV » ne
 * deviennent pas des puces de dégâts).
 */
export function parseMonsterActionCombatInfo(desc: string): {
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
} {
  const out: { attackBonus?: number; damageDice?: string; damageType?: string } = {};
  const atk =
    desc.match(/[+:]\s*(\d+)\s+pour toucher/) ??
    desc.match(/\+\s*(\d+)\s+to hit/i) ??
    desc.match(/(?:^|[:.,]\s*)(?:mw|rw|ms|rs)(?:\s*,\s*(?:mw|rw|ms|rs))*\s+(\d+)\s+to hit/i);
  if (atk) out.attackBonus = parseInt(atk[1], 10);
  const dice = /(\d+)\s*\((\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)\)/.exec(desc);
  if (dice) {
    const after = desc.slice(dice.index + dice[0].length);
    const frType = after.match(/^\s*dégâts\s+(\w+)/i);
    const enType = after.match(/^\s+([a-z]+)\s+damage/i);
    if (frType) {
      out.damageDice = dice[2].replace(/\s+/g, '');
      out.damageType = frType[1];
    } else if (enType) {
      out.damageDice = dice[2].replace(/\s+/g, '');
      out.damageType = enType[1];
    }
  }
  return out;
}

export interface MonsterSkill {
  name: string;
  isExpert: boolean;
}

/** A full monster stat block from the French SRD bestiary (metric units). */
export interface Monster {
  slug: string;
  /** Localisé par l'API selon la langue de la requête (repli FR si absent). */
  name: string;
  type: string;
  subtype: string | null;
  size: string; // French size code: T (Très petit), P (Petit), M (Moyen), G (Grand), TG (Très grand), Gig (Gigantesque), C (Colossal)
  alignment: string | null;
  armorClass: number;
  armorDesc: string | null;
  hitPoints: number;
  hitDice: string | null;
  /** Speeds in meters (walk/swim/fly/climb/burrow). */
  speed: Partial<Record<'walk' | 'swim' | 'fly' | 'climb' | 'burrow', number>>;
  /** Texte de vitesse localisé (pieds en EN) quand l'overlay existe — sinon l'UI formate `speed`. */
  speedText?: string | null;
  abilities: { for: number; dex: number; con: number; int: number; sag: number; cha: number };
  savingThrows: string[]; // ability short codes that get a save bonus
  skills: MonsterSkill[];
  languages: string[];
  challengeRating: number;
  xp: number;
  senses: string | null;
  telepathy: number | null;
  damageResistances: string[] | null;
  damageImmunities: string[] | null;
  conditionImmunities: string[] | null;
  traits: MonsterAction[];
  actions: MonsterAction[];
  legendaryActions: MonsterAction[];
}

/** Light row for the picker/search (no prose). */
export interface MonsterSummary {
  slug: string;
  /** Localisé par l'API selon la langue de la requête (repli FR si absent). */
  name: string;
  type: string;
  size: string;
  challengeRating: number;
  armorClass: number;
  hitPoints: number;
}

export interface MonsterSearchQuery {
  search?: string;
  limit?: number;
}

/** French size label lookup (5e-drs codes). */
export const MONSTER_SIZE_LABELS_FR: Record<string, string> = {
  TP: 'Très petit',
  T: 'Très petit',
  P: 'Petit',
  M: 'Moyen',
  G: 'Grand',
  TG: 'Très grand',
  Gig: 'Gigantesque',
  C: 'Colossal',
};

/** French CR label (for display). */
export function formatCR(cr: number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

// ---------- Combat (initiative tracker) ----------

export type CombatantType = 'player' | 'monster';

/**
 * A condition applied to a combatant, with an optional duration.
 * duration = number of rounds remaining (decremented at the end of the
 * combatant's turn). null = until dispelled (no auto-expiry).
 */
export interface CombatantCondition {
  name: string;
  duration: number | null;
}

/**
 * Name shown to non-GM viewers of a name-hidden monster combatant. The server
 * substitutes it for the real name (data-layer French, like monster names);
 * the real name never reaches the player client.
 */
export const HIDDEN_COMBATANT_NAME = 'Créature inconnue';

export interface Combatant {
  id: number;
  encounterId: number;
  type: CombatantType;
  characterId: number | null; // set when type === 'player'
  monsterSlug: string | null; // catalog ref when type === 'monster'
  name: string; // display name (player char name / monster name)
  /**
   * GM mask on the name: players (non-GM viewers) receive
   * HIDDEN_COMBATANT_NAME instead of the real name. The GM keeps the real
   * name and this flag lets the UI mark it as masked. Grouped monsters share
   * the mask — toggling one member covers the whole group.
   */
  nameHidden: boolean;
  count: number; // group size (1 for players, ≥1 for monster groups)
  groupId: number | null; // shared by grouped monsters (same initiative, independent HP)
  initiative: number | null; // null = not yet rolled
  initiativeBonus: number; // dex mod cached at add time (for tie-breaking)
  armorClass: number | null; // null = hidden (non-owner player can't see)
  hitPoints: number | null; // current (null = hidden)
  maxHitPoints: number | null;
  conditions: CombatantCondition[];
  sortOrder: number;
  defeated: boolean;
  cardColor: string | null; // hex color for the card background, null = default
  /**
   * Vague apparent-health tier for monsters when HP is redacted for non-GM
   * viewers: 0 = dying, 1 = badly hurt, 2 = hurt, 3 = healthy. Computed
   * server-side from the real ratio with a stable per-combatant jitter, so
   * players read "how it looks", never a percentage. Undefined for GM views
   * and for combatants whose HP is not redacted.
   */
  feeling?: number;
}

export type EncounterStatus = 'setup' | 'active' | 'ended';

export interface Encounter {
  id: number;
  partyId: number;
  name: string;
  round: number; // 0 = setup, ≥1 = in combat
  turnIndex: number; // index into the sorted combatants list
  status: EncounterStatus;
  createdAt: string;
}

export interface EncounterDetail extends Encounter {
  combatants: Combatant[];
}

/** One roster line of an encounter summary: a character or an aggregated monster group. */
export interface EncounterRosterEntry {
  name: string;
  count: number;
  player: boolean;
}

export interface EncounterSummary {
  id: number;
  partyId: number;
  name: string;
  round: number;
  turnIndex: number;
  status: EncounterStatus;
  combatantCount: number;
  /** Who is in the fight: characters first, then monster groups by size. */
  roster: EncounterRosterEntry[];
  createdAt: string;
}

export interface CreateEncounterPayload {
  name: string;
}

export interface PatchEncounterPayload {
  name?: string;
  status?: EncounterStatus;
  round?: number;
  turnIndex?: number;
}

export interface AddMonsterPayload {
  monsterSlug: string;
  count?: number;
  name?: string;
  /** Mask the name from players at add time (whole group). */
  nameHidden?: boolean;
}

export interface AddPlayerPayload {
  /** Single character (legacy) — use characterIds to add several at once. */
  characterId?: number;
  characterIds?: number[];
}

export interface PatchCombatantPayload {
  name?: string;
  count?: number;
  initiative?: number;
  armorClass?: number;
  hitPoints?: number;
  maxHitPoints?: number;
  conditions?: CombatantCondition[];
  defeated?: boolean;
  cardColor?: string | null;
  /** GM mask on the name — grouped monsters fan out to the whole group. */
  nameHidden?: boolean;
}

export interface SetInitiativePayload {
  initiative: number;
}
