/**
 * Routes combattants (combatants) — déplacées à l'identique depuis
 * routes/combat.ts (phase 4d, déplacement pur) : ajout monstres (groupes,
 * masquage, jets de PV), ajout PJ (naissance bête en forme sauvage #148,
 * push « lance ton initiative »), initiative (joueur pour soi, groupes),
 * suppression (groupe entier). La mise à jour PV/conditions/CA (PATCH
 * /combatants/:cid) vit dans update.ts.
 *
 * R4 hérité documenté : import de '../character-spell-effects.ts'
 * (trackerAcOf — même formule CA que mirrorAcToCombatants), couplage
 * préexistant au découpage, extraction routes/lib prévue en phase 4b.
 */

import type { AddMonsterPayload, AddPlayerPayload, SetInitiativePayload } from '@table-sync/shared';
import { abilityModifier, rollHitPoints } from '@table-sync/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import {
  characters as charactersTable,
  combatants as combatantsTable,
  encounters as encountersTable,
  monsters,
} from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { trackerAcOf } from '../character-spell-effects.ts';
import { isPartyGM, isPartyMember, requireUser } from '../helpers.ts';
import { apiMsg } from '../messages.ts';
import { getCombatant, getEncounter, mapCombatant, pushSafe } from './shared.ts';

export async function combatantRoutes(app: FastifyInstance) {
  // ===== Add monster combatant (GM only) =====
  app.post(
    '/encounters/:id/combatants/monster',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: AddMonsterPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = getEncounter(drizzle, Number(req.params.id));
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyGM(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      const body = req.body || ({} as AddMonsterPayload);
      if (!body.monsterSlug)
        return reply.code(400).send({ error: apiMsg(req, 'monsterSlug requis') });

      const monster = drizzle
        .select(cols(monsters))
        .from(monsters)
        .where(eq(monsters.slug, body.monsterSlug))
        .get() as any;
      if (!monster)
        return reply
          .code(404)
          .send({ error: apiMsg(req, 'Monstre introuvable dans le catalogue') });

      const abilities = monster.abilities_json ? JSON.parse(monster.abilities_json) : { dex: 10 };
      const dexMod = abilityModifier(abilities.dex ?? 10);
      const count = Math.max(1, Math.min(body.count ?? 1, 50));
      const name = (body.name || monster.name_fr).trim();

      // Parse CON modifier for HP rolls (hit dice + CON mod per die)
      const conMod = abilityModifier(abilities.con ?? 10);

      // Check if there's already a group of this monster type in this encounter.
      // If so, new combatants join the existing group (same initiative).
      const existingGroup = drizzle
        .select({
          group_id: combatantsTable.groupId,
          initiative: combatantsTable.initiative,
          sort_order: combatantsTable.sortOrder,
          name_hidden: combatantsTable.nameHidden,
        })
        .from(combatantsTable)
        .where(
          and(
            eq(combatantsTable.encounterId, enc.id),
            eq(combatantsTable.monsterSlug, monster.slug),
            sql`${combatantsTable.groupId} IS NOT NULL`,
          ),
        )
        .limit(1)
        .get() as any;

      // GM mask: explicit intent covers every member of the group; a late
      // joiner without intent (flag absent) inherits the group's mask.
      const nameHidden =
        body.nameHidden !== undefined
          ? body.nameHidden
            ? 1
            : 0
          : (existingGroup?.name_hidden ?? 0);

      // Unique group id — Date.now() alone can collide when two different
      // monster types are added within the same millisecond, which would
      // wrongly merge them into one group.
      const groupId =
        existingGroup?.group_id ?? Date.now() * 1000 + Math.floor(Math.random() * 1000);
      const sortOrder = existingGroup?.sort_order ?? groupId;
      const sharedInitiative = existingGroup?.initiative ?? null;

      // Create N independent combatants sharing a group_id.
      // Each rolls its own HP from the hit dice formula for variety.
      // If joining an existing group, inherit its initiative.
      const createdIds: number[] = [];
      getDb().transaction(() => {
        for (let i = 0; i < count; i++) {
          const hp = rollHitPoints(monster.hit_dice, monster.hit_points ?? 1, conMod);
          const { id } = drizzle
            .insert(combatantsTable)
            .values({
              encounterId: enc.id,
              type: 'monster',
              monsterSlug: monster.slug,
              name,
              nameHidden,
              count,
              groupId,
              initiative: sharedInitiative,
              initiativeBonus: dexMod,
              armorClass: monster.armor_class ?? 10,
              hitPoints: hp,
              maxHitPoints: hp,
              sortOrder,
            })
            .returning({ id: combatantsTable.id })
            .get();
          createdIds.push(id);
        }
      })();

      // An explicit mask flag realigns the whole group — the members share one
      // name on screen, and a mixed group would show players a half-masked name.
      if (
        body.nameHidden !== undefined &&
        existingGroup &&
        existingGroup.name_hidden !== nameHidden
      ) {
        drizzle
          .update(combatantsTable)
          .set({ nameHidden })
          .where(
            and(
              eq(combatantsTable.encounterId, enc.id),
              eq(combatantsTable.groupId, existingGroup.group_id),
            ),
          )
          .run();
      }

      const rows = drizzle
        .select(cols(combatantsTable))
        .from(combatantsTable)
        .where(inArray(combatantsTable.id, createdIds))
        .orderBy(combatantsTable.id)
        .all();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'add',
        actorUserId: userId,
      });
      return reply.code(201).send({ combatants: rows.map(mapCombatant) });
    },
  );

  // ===== Add player combatant (GM only) =====
  app.post(
    '/encounters/:id/combatants/player',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: AddPlayerPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = getEncounter(drizzle, Number(req.params.id));
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyGM(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      const body = req.body || ({} as AddPlayerPayload);
      // Accept a batch (characterIds) or a single legacy characterId
      const characterIds = body.characterIds?.length
        ? body.characterIds
        : body.characterId
          ? [body.characterId]
          : [];
      if (characterIds.length === 0)
        return reply.code(400).send({ error: apiMsg(req, 'characterId requis') });

      const chars = drizzle
        .select(cols(charactersTable))
        .from(charactersTable)
        .where(inArray(charactersTable.id, characterIds))
        .all() as any[];
      if (chars.length !== characterIds.length) {
        return reply.code(404).send({ error: apiMsg(req, 'Personnage introuvable') });
      }
      if (chars.some((char) => char.party_id !== enc.party_id)) {
        return reply.code(400).send({ error: apiMsg(req, 'Personnage pas dans ce groupe') });
      }
      // Hidden characters are inactive — they don't join fights
      if (chars.some((char) => char.hidden)) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'Personnage caché — il ne peut pas rejoindre un combat') });
      }

      const createdIds: number[] = [];
      getDb().transaction(() => {
        for (const char of chars) {
          const dexMod = abilityModifier(char.dexterity ?? 10);
          // Ajout PENDANT une forme sauvage : le combatant NAÎT bête (nom, PV
          // et CA de la forme) — mêmes valeurs que la route wild-shape écrit
          // sur les combatants existants, sinon le traqueur affiche la fiche
          // humaine et les miroirs (mirrorAcToCombatants saute les formes)
          // ne le rattrapent jamais.
          let name = char.name;
          let hp = char.current_hp ?? 1;
          let maxHp = char.max_hp ?? 1;
          let ac: number;
          if (char.wild_shape_slug) {
            const beast = drizzle
              .select({ name_fr: monsters.nameFr, armor_class: monsters.armorClass })
              .from(monsters)
              .where(eq(monsters.slug, char.wild_shape_slug))
              .get() as any;
            if (beast) {
              name = `${char.name} (${beast.name_fr ?? char.wild_shape_slug})`;
              hp = char.wild_shape_hp ?? hp;
              maxHp = char.wild_shape_max_hp ?? maxHp;
              ac = beast.armor_class ?? 10;
            } else {
              ac = trackerAcOf(char);
            }
          } else {
            // CA d'ajout = équipement + effets de sort actifs, override GAGNE —
            // la même formule que mirrorAcToCombatants : création et miroirs ne
            // peuvent pas diverger.
            ac = trackerAcOf(char);
          }

          const { id } = drizzle
            .insert(combatantsTable)
            .values({
              encounterId: enc.id,
              type: 'player',
              characterId: char.id,
              name,
              count: 1,
              initiativeBonus: dexMod,
              armorClass: ac,
              hitPoints: hp,
              maxHitPoints: maxHp,
              sortOrder: Date.now(),
            })
            .returning({ id: combatantsTable.id })
            .get();
          createdIds.push(id);
        }
      })();

      const rows = drizzle
        .select(cols(combatantsTable))
        .from(combatantsTable)
        .where(inArray(combatantsTable.id, createdIds))
        .orderBy(combatantsTable.id)
        .all();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'add',
        actorUserId: userId,
      });
      // --- Push « lance ton initiative » : c'est ici que le combat démarre
      // pour les joueurs (le MD ne peut pas lancer tant que tout le monde
      // n'a pas répondu) — un envoi par propriétaire, vers sa fiche, le lien
      // profond `?combat=init` ouvre la saisie d'initiative.
      const firstCharByOwner = new Map<number, number>();
      for (const char of chars) {
        if (!firstCharByOwner.has(char.owner_id)) firstCharByOwner.set(char.owner_id, char.id);
      }
      for (const [ownerId, characterId] of firstCharByOwner) {
        pushSafe(
          ownerId,
          {
            kind: 'initiative',
            title: { fr: '⚔ Le combat se prépare !', en: '⚔ Combat is starting!' },
            body: {
              fr: `« ${enc.name} » — lance ton initiative !`,
              en: `"${enc.name}" — roll your initiative!`,
            },
            url: `/party/${enc.party_id}/character/${characterId}?combat=init`,
            tag: `init:${enc.id}`,
          },
          // Rattrapable : la rencontre attend l'initiative, mais un push
          // livré après la fin du combat n'est que du bruit.
          { ttl: 600, urgency: 'high' },
        );
      }
      return reply.code(201).send({ combatants: rows.map(mapCombatant) });
    },
  );

  // ===== Set initiative (player for own combatant, or GM for any) =====
  app.patch(
    '/encounters/:id/combatants/:cid/initiative',
    async (
      req: FastifyRequest<{ Params: { id: string; cid: string }; Body: SetInitiativePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = getEncounter(drizzle, Number(req.params.id));
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyMember(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Pas membre du groupe') });

      const combatant = getCombatant(drizzle, Number(req.params.cid));
      if (!combatant || combatant.encounter_id !== enc.id) {
        return reply.code(404).send({ error: apiMsg(req, 'Combattant introuvable') });
      }

      // Authorization: GM can set any; player can only set their own combatant
      const gm = isPartyGM(enc.party_id, userId);
      if (!gm) {
        const char = combatant.character_id
          ? (drizzle
              .select({ owner_id: charactersTable.ownerId })
              .from(charactersTable)
              .where(eq(charactersTable.id, combatant.character_id))
              .get() as any)
          : null;
        if (!char || char.owner_id !== userId) {
          return reply
            .code(403)
            .send({ error: apiMsg(req, 'Vous ne pouvez modifier que votre propre initiative') });
        }
      }

      const body = req.body || ({} as SetInitiativePayload);
      const initiative = Math.max(0, Math.min(40, Math.round(body.initiative)));

      // If this combatant is part of a group, set initiative for ALL members
      // (grouped monsters share initiative).
      if (combatant.group_id) {
        drizzle
          .update(combatantsTable)
          .set({ initiative })
          .where(
            and(
              eq(combatantsTable.encounterId, enc.id),
              eq(combatantsTable.groupId, combatant.group_id),
            ),
          )
          .run();
      } else {
        drizzle
          .update(combatantsTable)
          .set({ initiative })
          .where(eq(combatantsTable.id, combatant.id))
          .run();
      }

      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'initiative',
        actorUserId: userId,
      });
      return reply.send({ ok: true });
    },
  );
  // ===== Delete combatant (GM only). If grouped, deletes entire group. =====
  app.delete(
    '/combatants/:cid',
    async (req: FastifyRequest<{ Params: { cid: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const combatant = getCombatant(drizzle, Number(req.params.cid));
      if (!combatant) return reply.code(404).send({ error: apiMsg(req, 'Combattant introuvable') });

      const enc = drizzle
        .select({ party_id: encountersTable.partyId, id: encountersTable.id })
        .from(encountersTable)
        .where(eq(encountersTable.id, combatant.encounter_id))
        .get() as any;
      if (!isPartyGM(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      // If grouped, delete ALL members of the group (they were added together)
      if (combatant.group_id) {
        drizzle
          .delete(combatantsTable)
          .where(
            and(
              eq(combatantsTable.encounterId, combatant.encounter_id),
              eq(combatantsTable.groupId, combatant.group_id),
            ),
          )
          .run();
      } else {
        drizzle.delete(combatantsTable).where(eq(combatantsTable.id, combatant.id)).run();
      }
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'remove',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
