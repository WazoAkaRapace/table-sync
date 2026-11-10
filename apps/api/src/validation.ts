/**
 * Validation TypeBox des corps de requête (phase 3 qualité backend).
 *
 * Choix d'infrastructure : schémas TypeBox « purs » SANS
 * @fastify/type-provider-typebox. Le provider n'apporte que l'inférence de
 * types des handlers — les generics manuels FastifyRequest<{ Body: … }>
 * existants restent la source de typage, et la validation runtime passe
 * par l'ajv que Fastify 5 embarque déjà (les schémas TypeBox sont du JSON
 * Schema standard). Une dépendance de moins, zéro registrar
 * (withTypeProvider) à propager.
 *
 * ALIGNEMENT SUR LE COMPORTEMENT RUNTIME (les tests api-tests sont la
 * spec — aucun changement visible après conversion) :
 *  - Les schémas n'expriment que la STRUCTURE (champs requis, types
 *    grossiers) ; les règles de VALEUR (longueurs min, formats e-mail,
 *    énumérations qui retombent en silence sur un défaut) restent dans
 *    les handlers : leurs messages apiMsg exacts sont déjà épinglés par
 *    les tests, les reproduire dans ajv ferait diverger des cas limites
 *    (champ vide '' vs absent, encumbranceMode invalide → repli 'variant'
 *    sans erreur à la création, etc.).
 *  - ajv de Fastify coerce les scalaires (5 → '5') comme les handlers le
 *    faisaient via String(...) : ces entrées continuent de passer.
 *  - Les champs à vérification typeof stricte (playersCreateItems) sont
 *    déclarés Type.Unknown() : la validation de type resterait dans la
 *    route, message métier à l'appui.
 *  - NoBody (Type.Unknown) : routes en écriture SANS corps (logout,
 *    refresh, open, resend, DELETE) — Fastify valide AUSSI les corps
 *    absents contre un schéma objet (« must be object »), un
 *    Type.Object({}) casserait tous les appels sans body du client web
 *    (vérifié par sonde, 2026-11-09).
 *
 * Les 400 issus de ces schémas ne voient JAMAIS les messages techniques
 * ajv EN : le setErrorHandler de server.ts les traduit via
 * validationMessage() ci-dessous — même statut, même { error: apiMsg }
 * que les checks manuels qu'ils doublonnent.
 */
import { Type } from '@sinclair/typebox';

// ---------- Schémas : auth ----------

/** Route en écriture sans corps — permissif à dessein (voir l'en-tête). */
export const NoBody = Type.Unknown();

/** POST /api/auth/login — AuthBody (username + password requis). */
export const LoginBody = Type.Object({
  username: Type.String(),
  password: Type.String(),
});

/** POST /api/auth/register — les 4 champs sont requis (check manuel combiné). */
export const RegisterBody = Type.Object({
  username: Type.String(),
  password: Type.String(),
  displayName: Type.String(),
  email: Type.String(),
});

/** POST /api/auth/forgot-password — locale optionnelle, préservée telle quelle. */
export const ForgotPasswordBody = Type.Object({
  email: Type.String(),
  locale: Type.Optional(Type.String()),
});

/** POST /api/auth/reset-password. */
export const ResetPasswordBody = Type.Object({
  token: Type.String(),
  newPassword: Type.String(),
});

/** POST /api/auth/verify-email. */
export const VerifyEmailBody = Type.Object({ token: Type.String() });

/** POST /api/auth/password. */
export const ChangePasswordBody = Type.Object({
  currentPassword: Type.String(),
  newPassword: Type.String(),
});

/**
 * PATCH /api/auth/me — UpdateProfilePayload de @table-sync/shared. Tout est
 * optionnel (« aucun champ à mettre à jour » reste un 400 de la route) ;
 * les valeurs valides mais étranges (displayName numérique coercé,
 * tutorialSeenAt en epoch ms) passaient via String()/new Date() avant —
 * les unions les laissent passer, seuls les objets non coercibles
 * deviennent des 400 métier.
 */
export const UpdateProfileBody = Type.Object({
  displayName: Type.Optional(Type.String()),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  // Attention : TOUT type ici subit la coercion ajv (null → '' pour une
  // chaîne) et `tutorialSeenAt: null` (réarmement du tutoriel) doit
  // atteindre la route TEL QUEL — seul Type.Unknown() le garantit ; les
  // dates invalides restent un 400 de la route (« horodatage … invalide »).
  tutorialSeenAt: Type.Optional(Type.Unknown()),
  // Non-tableau → 400 « liste d'onglets de tutoriel invalide » (route) ;
  // PAS de Type.Array() ici : l'ajv de Fastify (coerceTypes:'array')
  // transformerait 'nope' en ['nope'] et COURT-CIRCUITERAIT le check
  // manuel — les éléments non-chaîne restent filtrés silencieusement.
  tutorialTabsDone: Type.Optional(Type.Unknown()),
  // Vérité quelconque (« coupe TOUT ») : la route tranche, pas le schéma.
  tutorialDisabled: Type.Optional(Type.Unknown()),
});

// ---------- Schémas : parties ----------

/** POST /api/parties — encumbranceMode invalide retombe sur 'variant' (route). */
export const CreatePartyBody = Type.Object({
  name: Type.String(),
  encumbranceMode: Type.Optional(Type.String()),
});

/** POST /api/parties/join. */
export const JoinPartyBody = Type.Object({ inviteCode: Type.String() });

/** POST /api/parties/:id/bans — NaN reste « userId is required » (mapping). */
export const BanMemberBody = Type.Object({ userId: Type.Optional(Type.Number()) });

/** PATCH /api/parties/:id — les vérifications de valeur restent dans la route. */
export const UpdatePartyBody = Type.Object({
  name: Type.Optional(Type.String()),
  encumbranceMode: Type.Optional(Type.String()),
  playersCreateItems: Type.Optional(Type.Unknown()),
});

// ---------- Schémas : items (objets personnalisés) ----------

/**
 * POST /api/parties/:partyId/items + PATCH /api/items/:id — structure
 * grossière seulement : les règles de VALEUR (familles d'armure, bornes
 * CA 8-20, bonus magique 0-3, propriétés d'arme) restent dans
 * validateWeaponFields/validateArmorFields de routes/items.ts, messages
 * métier FR à l'appui. Pièges ajv : les champs resettables (null : acBase,
 * strMin, magicBonus, weightKg…) passent par Type.Unknown() — une Union
 * Number|Null verrait le null coercé en 0 ; properties reste Unknown
 * (coerceTypes 'array' transformerait un scalaire en tableau et
 * court-circuiterait le filtrage de la route).
 */
export const CustomItemBody = Type.Object({
  name: Type.Optional(Type.String()),
  nameFr: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  rarity: Type.Optional(Type.String()),
  weightKg: Type.Optional(Type.Unknown()),
  costQty: Type.Optional(Type.Unknown()),
  costUnit: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  // null = effacer la prose (PATCH du pupitre) — l'union évite la coercion
  // ajv null → '' qui écraserait un « effacer » en « chaîne vide ».
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  // ----- champs d'arme (category 'weapon') -----
  damageDice: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  damageType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  twoHandedDice: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  magicBonus: Type.Optional(Type.Unknown()),
  baseWeapon: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  properties: Type.Optional(Type.Unknown()),
  // ----- champs d'armure (category 'armor') -----
  armorFamily: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  acBase: Type.Optional(Type.Unknown()),
  strMin: Type.Optional(Type.Unknown()),
  stealthDisadvantage: Type.Optional(Type.Unknown()),
  baseArmor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

/** PATCH /api/items/:id — même contrat, champs tous partiels. */
export const UpdateItemBody = CustomItemBody;

// ---------- Mapping erreur de validation → message métier i18n ----------

/**
 * Clé `${method} ${request.routeOptions.url}` (motif de route AVEC préfixe,
 * paramètres en :id) → message apiMsg à servir. Une chaîne s'applique à
 * toute erreur de la route (les checks manuels combinés ne distinguent pas
 * les champs) ; un objet mappe par premier segment d'instancePath
 * ('' = corps entier). Hors table : « requête invalide » (server.ts) —
 * JAMAIS le message ajv anglais brut.
 */
const VALIDATION_MESSAGES: Record<string, string | Record<string, string>> = {
  // auth
  'POST /api/auth/register':
    'nom d’utilisateur, mot de passe, nom affiché et adresse e-mail requis',
  'POST /api/auth/login': 'nom d’utilisateur et mot de passe requis',
  'POST /api/auth/password': 'mot de passe actuel et nouveau mot de passe requis',
  'POST /api/auth/forgot-password': 'adresse e-mail requise',
  'POST /api/auth/reset-password': 'jeton et nouveau mot de passe requis',
  'POST /api/auth/verify-email': 'jeton de vérification requis',
  'PATCH /api/auth/me': {
    '': 'aucun champ à mettre à jour',
    displayName: 'le nom affiché doit contenir entre 1 et 40 caractères',
    email: 'adresse e-mail invalide',
  },
  // parties
  'POST /api/parties': 'name is required',
  'POST /api/parties/join': 'inviteCode is required',
  'POST /api/parties/:id/bans': 'userId is required',
  'PATCH /api/parties/:id': {
    '': 'requête invalide',
    name: 'name cannot be empty',
    encumbranceMode: 'invalid encumbranceMode',
  },
};

/** Une entrée de err.validation (ajv) — seul instancePath nous intéresse. */
interface ValidationItem {
  instancePath?: string;
}

/**
 * Message métier FR d'une erreur de validation ajv, ou null si la route
 * n'est pas dans la table (repli générique côté appelant).
 */
export function validationMessage(
  method: string,
  routeUrl: string | undefined,
  validation: readonly ValidationItem[],
): string | null {
  if (!routeUrl) return null;
  const entry = VALIDATION_MESSAGES[`${method} ${routeUrl}`];
  if (typeof entry === 'string') return entry;
  if (entry) {
    const field = (validation[0]?.instancePath ?? '').replace(/^\//, '').split('/')[0];
    return entry[field] ?? entry[''] ?? null;
  }
  return null;
}
