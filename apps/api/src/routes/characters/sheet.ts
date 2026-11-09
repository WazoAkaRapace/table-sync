/**
 * Fiche personnage — création, listes (groupe + roster MD), détail, suppression.
 * Découpage 2026-11 (phase 4) : déplacement pur depuis routes/characters.ts.
 */

import type { CreateCharacterPayload } from '@table-sync/shared';
import { abilityModifier, computeAC, raceSpeedMeters } from '@table-sync/shared';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import {
  characters,
  combatants,
  encounters,
  parties as partiesTable,
  users,
} from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import {
  attachCharacterClasses,
  replaceCharacterClasses,
  validateClassEntries,
} from '../lib/character-classes.ts';
import { mapCharacter, mapCharacterSummary } from '../lib/mappers.ts';
import { characterVisibleTo, isPartyGM, isPartyMember, requireUser } from '../lib/membership.ts';
import { sendCachedJson } from '../httpCache.ts';
// Imports hérités du monolithe (R4_LEGACY, shrink-only) : extraction routes/lib en phase 4b.
import { loadInventoryView } from '../inventory/index.ts';
import { activeAcEffectsOf } from '../character-spell-effects.ts';
import { langFromReq } from '../lang.ts';
import { apiMsg } from '../messages.ts';

/** characters.* + the owner's display_name (JOIN users) — the mappers' shape. */
const CHARACTER_WITH_OWNER = { ...cols(characters), owner_name: users.displayName };

export function getCharacterWithOwner(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(CHARACTER_WITH_OWNER)
    .from(characters)
    .innerJoin(users, eq(users.id, characters.ownerId))
    .where(eq(characters.id, id))
    .get() as any;
}

/** The character's player combatants in non-ended encounters (newest first). */
export function activePlayerCombatants(characterId: number): any[] {
  return getDrizzle()
    .select(cols(combatants))
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(
      and(
        eq(combatants.characterId, characterId),
        eq(combatants.type, 'player'),
        ne(encounters.status, 'ended'),
      ),
    )
    .orderBy(desc(encounters.createdAt), desc(combatants.id))
    .all() as any[];
}

export async function characterSheetRoutes(app: FastifyInstance) {
  // ---------- Create character in a party ----------
  app.post(
    '/parties/:partyId/characters',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateCharacterPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const body = req.body || ({} as CreateCharacterPayload);
      if (!body.name?.trim())
        return reply.code(400).send({ error: apiMsg(req, 'name is required') });
      const ability = (value: number | undefined, fallback: number): number => {
        const score = value ?? fallback;
        if (score < 1 || score > 30) return -1;
        return score;
      };
      const abilities = {
        strength: ability(body.strength, 10),
        dexterity: ability(body.dexterity, 10),
        constitution: ability(body.constitution, 10),
        intelligence: ability(body.intelligence, 10),
        wisdom: ability(body.wisdom, 10),
        charisma: ability(body.charisma, 10),
      };
      for (const [label, score] of Object.entries(abilities)) {
        if (score < 0) return reply.code(400).send({ error: `${label} must be between 1 and 30` });
      }
      const maxHp = body.maxHp ?? 1;
      if (maxHp < 1) return reply.code(400).send({ error: apiMsg(req, 'maxHp must be ≥ 1') });
      const currentHp = body.currentHp ?? maxHp;
      const capMult = body.capacityMultiplier ?? 1;
      // Vitesse de base : explicite (fiche libre) sinon dérivée de l'espèce
      // SRD (petites races 7,5 m, Elfe des bois 10,5 m…), repli 9 m.
      const speed =
        typeof body.speed === 'number' && Number.isFinite(body.speed) && body.speed >= 0
          ? body.speed
          : (raceSpeedMeters(body.race) ?? 9);
      const skillProficiencies = (body.skillProficiencies ?? []).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      );
      const languages = (body.languages ?? []).filter(
        (l): l is string => typeof l === 'string' && l.trim().length > 0,
      );

      const drizzle = getDrizzle();
      const { id: charId } = drizzle
        .insert(characters)
        .values({
          partyId,
          ownerId: userId,
          name: body.name.trim(),
          strength: abilities.strength,
          dexterity: abilities.dexterity,
          constitution: abilities.constitution,
          intelligence: abilities.intelligence,
          wisdom: abilities.wisdom,
          charisma: abilities.charisma,
          capacityMultiplier: capMult,
          characterClass: body.characterClass ?? null,
          level: body.level ?? 1,
          race: body.race ?? null,
          background: body.background ?? null,
          skillProficiencies: JSON.stringify(skillProficiencies),
          languages: JSON.stringify(languages),
          maxHp,
          currentHp,
          speed,
          hidden: body.hidden ? 1 : 0,
        })
        .returning({ id: characters.id })
        .get();
      // Multiclassage : lignes de classe (toujours présentes, même mono-classe)
      const classPayload =
        body.classes ??
        (body.characterClass ? [{ classKey: body.characterClass, level: body.level ?? 1 }] : []);
      if (classPayload.length > 0) {
        const validated = validateClassEntries(classPayload);
        if (!validated.ok) return reply.code(400).send({ error: validated.error });
        replaceCharacterClasses(charId, validated.entries);
      }
      const row = getCharacterWithOwner(drizzle, charId);
      attachCharacterClasses([row]);
      bus.emitChange({
        type: 'party:change',
        partyId,
        characterId: charId,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(201).send({ character: mapCharacterSummary(row) });
    },
  );

  // ---------- List characters in a party ----------
  app.get(
    '/parties/:partyId/characters',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const rows = getDrizzle()
        .select(CHARACTER_WITH_OWNER)
        .from(characters)
        .innerJoin(users, eq(users.id, characters.ownerId))
        .where(eq(characters.partyId, partyId))
        .orderBy(sql`${characters.name} COLLATE NOCASE ASC`)
        .all() as any[];
      // Hidden characters leave the party listing for everyone but their
      // owner and the GM.
      const callerIsGM = isPartyGM(partyId, userId);
      const visible = rows.filter((row) => !row.hidden || row.owner_id === userId || callerIsGM);
      attachCharacterClasses(visible);
      return reply.send({ characters: visible.map(mapCharacterSummary) });
    },
  );

  // ---------- Roster overview (tableau MD : UNE requête au lieu de N fiches) ----------
  // Le tableau du MD ne rend par personnage que 4 chiffres dérivés de la
  // fiche complète (CA effective, % de charge, ration, eau pleine) — il
  // téléchargeait l'inventaire ENTIER de chaque joueur (N × fiches complètes,
  // entrées + objets inclus). Mêmes règles de visibilité que le détail de
  // groupe (personnages cachés : propriétaire + MD). ETag : le tableau
  // rafraîchit à chaque geste d'inventaire du groupe — inchangé → 304.
  app.get(
    '/parties/:partyId/roster-overview',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });

      const drizzle = getDrizzle();
      const chars = drizzle
        .select({ ...cols(characters), encumbrance_mode: partiesTable.encumbranceMode })
        .from(characters)
        .innerJoin(partiesTable, eq(partiesTable.id, characters.partyId))
        .where(eq(characters.partyId, partyId))
        .orderBy(sql`${characters.name} COLLATE NOCASE ASC`)
        .all() as any[];
      const callerIsGM = isPartyGM(partyId, userId);
      const visible = chars.filter((c) => !c.hidden || c.owner_id === userId || callerIsGM);
      const lang = langFromReq(req);

      const overview = await Promise.all(
        visible.map(async (char) => {
          const view = await loadInventoryView(drizzle, char, lang);
          const character = view.character as any;
          const dexMod = abilityModifier(character.dexterity ?? 10);
          const ac = computeAC(
            view.entries,
            dexMod,
            character.fightingStyle === 'defense',
            character,
            'fr',
            // Effets de sort actifs (Bouclier de la foi…) : la CA du
            // tableau MD suit — le miroir de roster-overview.
            activeAcEffectsOf(character.id),
          );
          // Rations / eau : mêmes règles que la carte du tableau (les gourdes
          // VIDES portent « empty » en note et ne comptent pas).
          let foodCount = 0;
          let fullWaterCount = 0;
          for (const e of view.entries as any[]) {
            const tags = e.item?.survivalTags ?? [];
            if (tags.includes('food')) foodCount += e.quantity;
            if (tags.includes('water') && !e.notes?.includes('empty')) fullWaterCount += e.quantity;
          }
          return {
            characterId: character.id,
            ac: ac?.ac ?? null,
            weightPct: view.encumbrance?.pct ?? null,
            // Kg bruts pour l'étiquette de la barre de charge (« x / y kg »).
            carriedKg: view.encumbrance?.totalWeightKg ?? null,
            capacityKg: view.encumbrance?.maxCarryKg ?? null,
            foodCount,
            fullWaterCount,
          };
        }),
      );

      return sendCachedJson(req, reply, { overview });
    },
  );

  // ---------- Get single character ----------
  app.get(
    '/characters/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const row = getCharacterWithOwner(getDrizzle(), Number(req.params.id));
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(row.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      // 404 (not 403): a hidden character must not betray its existence
      if (!characterVisibleTo(row, userId))
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      attachCharacterClasses([row]);
      return reply.send({ character: mapCharacter(row) });
    },
  );

  // ---------- Delete character ----------
  app.delete(
    '/characters/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      const isGM = isPartyGM(char.party_id, userId);
      if (char.owner_id !== userId && !isGM) {
        return reply.code(403).send({ error: apiMsg(req, 'only the owner or GM can delete') });
      }
      drizzle.delete(characters).where(eq(characters.id, char.id)).run();
      bus.emitChange({
        type: 'party:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
