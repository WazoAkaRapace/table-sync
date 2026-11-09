/**
 * Accès personnage — préambule partagé « requireUser + fetch character +
 * membership/ownership + GM check » des routes /characters/:id et dérivées
 * (rest, spells, spell-effects, features, inventory).
 *
 * Deux régimes mesurés (extraits des sites réels — chaque route garde EXACTEMENT
 * ses statuts et messages apiMsg actuels) :
 *   - 'member-visible' : lecture — 404 si fiche inexistante, 403 « not a
 *     member » hors groupe, puis 404 « character not found » si cachée (un
 *     caché ne trahit pas son existence aux autres membres) ;
 *   - 'owner-or-gm'    : écriture — 404 si inexistante, puis owner/MD requis
 *     (403 forbiddenMsg). `requireMember` rejoue le 403 « not a member »
 *     AVANT le reflet métier quand la route le fait aujourd'hui (rest, spells,
 *     spell-effects, features) ; sans lui (PATCH/DELETE fiche), un hors-groupe
 *     reçoit directement le 403 métier.
 *
 * Voir AGENTS.md — convention « accès personnage : routes/lib/access.ts ».
 */

import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { characters, users } from '../../db/schema.ts';
import { apiMsg } from '../messages.ts';
import { characterVisibleTo, isOwnerOrGM, isPartyMember, requireUser } from './membership.ts';

/** characters.* seul — la projection des routes d'écriture. */
export function getCharacterById(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

/** characters.* + owner_name (JOIN users) — la projection des mappers (fiche). */
export function getCharacterWithOwnerById(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select({ ...cols(characters), owner_name: users.displayName })
    .from(characters)
    .innerJoin(users, eq(users.id, characters.ownerId))
    .where(eq(characters.id, id))
    .get() as any;
}

/**
 * Porte « éditeur d'inventaire » (POST /characters/:id/inventory, /consume,
 * /refill) : 404 « character not found », puis owner/MD requis (403 « only
 * the owner or GM can edit this inventory »). Renvoie null après avoir
 * envoyé la réponse — l'appelant fait `return`.
 */
export function getInventoryEditor(
  req: FastifyRequest,
  reply: FastifyReply,
  characterId: number,
): { userId: number; char: any } | null {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const char = getCharacterById(getDrizzle(), characterId);
  if (!char) {
    reply.code(404).send({ error: apiMsg(req, 'character not found') });
    return null;
  }
  if (!isOwnerOrGM(char, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'only the owner or GM can edit this inventory') });
    return null;
  }
  return { userId, char };
}

/** Régime d'accès exigé par la route (voir l'en-tête du module). */
export type CharacterAccessMode =
  | { access: 'member-visible' }
  | {
      access: 'owner-or-gm';
      /** Message apiMsg du 403 quand l'appelant n'est ni owner ni MD. */
      forbiddenMsg: string;
      /** 403 « not a member » AVANT le refus métier (rest/spells/features). */
      requireMember?: boolean;
    };

/**
 * Vérifie l'accès sur une fiche DÉJÀ chargée (routes qui résolvent la fiche
 * via une ligne liée : character-spells/:linkId, spell-effects/:effectId).
 * Renvoie false après avoir envoyé le 403/404 — l'appelant fait `return`.
 */
export function checkCharacterAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  char: any,
  userId: number,
  mode: CharacterAccessMode,
): boolean {
  if (mode.access === 'member-visible') {
    if (!isPartyMember(char.party_id, userId)) {
      reply.code(403).send({ error: apiMsg(req, 'not a member') });
      return false;
    }
    if (!characterVisibleTo(char, userId)) {
      reply.code(404).send({ error: apiMsg(req, 'character not found') });
      return false;
    }
    return true;
  }
  if (mode.requireMember && !isPartyMember(char.party_id, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'not a member') });
    return false;
  }
  if (!isOwnerOrGM(char, userId)) {
    reply.code(403).send({ error: apiMsg(req, mode.forbiddenMsg) });
    return false;
  }
  return true;
}

/**
 * Préambule complet : requireUser + fetch par id + 404 + contrôle d'accès.
 * Renvoie { char, userId } ou null après avoir envoyé la réponse d'erreur.
 */
export function requireCharacterAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  charId: number,
  mode: CharacterAccessMode & {
    /** Fetch avec le JOIN owner (fiche complète). */ withOwner?: boolean;
  },
): { char: any; userId: number } | null {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const char = mode.withOwner
    ? getCharacterWithOwnerById(getDrizzle(), charId)
    : getCharacterById(getDrizzle(), charId);
  if (!char) {
    reply.code(404).send({ error: apiMsg(req, 'character not found') });
    return null;
  }
  if (!checkCharacterAccess(req, reply, char, userId, mode)) return null;
  return { char, userId };
}
