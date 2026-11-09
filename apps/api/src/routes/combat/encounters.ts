/**
 * Routes rencontres (encounters) — déplacées à l'identique depuis
 * routes/combat.ts (phase 4d, déplacement pur) : liste par groupe (vue GM vs
 * joueur + ETag), création, détail avec redaction PvP (PV/CA null hors
 * propres combattants, masquage noms monstres, feeling), patch et suppression.
 */

import type {
  CreateEncounterPayload,
  EncounterDetail,
  PatchEncounterPayload,
} from '@table-sync/shared';
import { HIDDEN_COMBATANT_NAME } from '@table-sync/shared';
import { and, desc, eq, exists, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import {
  characters as charactersTable,
  combatants as combatantsTable,
  encounters as encountersTable,
} from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { getUserId, isPartyGM, isPartyMember, requireUser } from '../lib/membership.ts';
import { sendCachedJson } from '../httpCache.ts';
import { apiMsg } from '../messages.ts';
import {
  buildRosters,
  getEncounter,
  getEncounterForUser,
  mapCombatant,
  mapEncounter,
  mapEncounterSummary,
  sortCombatants,
} from './shared.ts';

export async function encounterRoutes(app: FastifyInstance) {
  // ===== List encounters for a party =====
  app.get(
    '/parties/:partyId/encounters',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Pas membre du groupe') });

      const gm = isPartyGM(partyId, userId);
      const drizzle = getDrizzle();
      // Correlated COUNT — the outer reference must be table-qualified by
      // hand: drizzle renders ${encountersTable.id} as bare "id" in select
      // fields, which the subquery's own alias (combatants c) would capture.
      const combatantCount = sql<number>`(SELECT COUNT(*) FROM combatants c WHERE c.encounter_id = encounters.id)`;

      let rows: any[];
      // createdAt a une granularité SECONDE : deux rencontres nées dans la
      // même seconde départagent arbitrairement — id descendant en tie-break
      // (la plus récente d'abord, de façon déterministe).
      if (gm) {
        // GM sees all encounters
        rows = drizzle
          .select({ ...cols(encountersTable), combatant_count: combatantCount })
          .from(encountersTable)
          .where(eq(encountersTable.partyId, partyId))
          .orderBy(desc(encountersTable.createdAt), desc(encountersTable.id))
          .all();
      } else {
        // Players only see encounters where they have a combatant (their character is in the fight)
        rows = drizzle
          .select({ ...cols(encountersTable), combatant_count: combatantCount })
          .from(encountersTable)
          .where(
            and(
              eq(encountersTable.partyId, partyId),
              exists(
                drizzle
                  .select({ one: sql`1` })
                  .from(combatantsTable)
                  .innerJoin(charactersTable, eq(charactersTable.id, combatantsTable.characterId))
                  .where(
                    and(
                      eq(combatantsTable.encounterId, encountersTable.id),
                      eq(charactersTable.ownerId, userId),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(desc(encountersTable.createdAt), desc(encountersTable.id))
          .all();
      }

      const rosters = buildRosters(
        rows.map((r) => r.id),
        gm,
      );
      // ETag : le CombatWidget de CHAQUE joueur sonde cette liste toutes les
      // 30 s — hors combat, le corps est stable et la sonde repart en 304.
      // Le hash couvre le corps SERVI (GM vs joueur diffèrent : masquage de
      // noms, PV redressés) — un 304 ne peut jamais fuiter entre lecteurs.
      return sendCachedJson(req, reply, {
        encounters: rows.map((r) => mapEncounterSummary(r, rosters.get(r.id) ?? [])),
      });
    },
  );

  // ===== Create encounter (GM only) =====
  app.post(
    '/parties/:partyId/encounters',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateEncounterPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyGM(partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      const body = req.body || ({} as CreateEncounterPayload);
      const name = (body.name || '').trim();
      if (!name) return reply.code(400).send({ error: apiMsg(req, 'Le nom est requis') });

      const drizzle = getDrizzle();
      const { id } = drizzle
        .insert(encountersTable)
        .values({ partyId, name })
        .returning({ id: encountersTable.id })
        .get();
      const row = getEncounter(drizzle, id);

      bus.emitChange({
        type: 'combat:change',
        partyId,
        encounterId: id,
        action: 'turn',
        actorUserId: userId,
      });
      return reply.code(201).send({ encounter: mapEncounter(row) });
    },
  );

  // ===== Get full encounter detail (with sorted combatants) =====
  app.get(
    '/encounters/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const enc = await getEncounterForUser(req, reply);
      if (!enc) return;

      const userId = getUserId(req);
      const gm = isPartyGM(enc.party_id, userId!);

      const drizzle = getDrizzle();

      // Players can only view encounters they're part of (have a combatant in)
      if (!gm) {
        const isInEncounter = drizzle
          .select({ one: sql`1` })
          .from(combatantsTable)
          .innerJoin(charactersTable, eq(charactersTable.id, combatantsTable.characterId))
          // Route sous le garde global : userId toujours résolu ici
          .where(and(eq(combatantsTable.encounterId, enc.id), eq(charactersTable.ownerId, userId!)))
          .limit(1)
          .get();
        if (!isInEncounter) {
          return reply.code(403).send({ error: "Vous n'êtes pas dans cette rencontre" });
        }
      }

      const rows = drizzle
        .select(cols(combatantsTable))
        .from(combatantsTable)
        .where(eq(combatantsTable.encounterId, enc.id))
        .all();
      let combatants = sortCombatants(rows.map(mapCombatant));

      // Privacy: non-GM players can only see HP/AC for their own combatants.
      // For everyone else (monsters + other players), redact those fields —
      // monsters keep a vague "how it looks" tier instead of numbers.
      if (!gm) {
        // Find this user's character IDs in the party
        const myCharIds = new Set(
          (
            drizzle
              .select({ id: charactersTable.id })
              .from(charactersTable)
              .where(
                and(
                  eq(charactersTable.partyId, enc.party_id),
                  eq(charactersTable.ownerId, userId!),
                ),
              )
              .all() as any[]
          ).map((r) => r.id),
        );
        combatants = combatants.map((c) => {
          if (c.characterId !== null && myCharIds.has(c.characterId)) return c; // own combatant
          // GM name mask: the placeholder substitutes the real name BEFORE it
          // ever leaves the server — the leak is impossible by construction,
          // whichever player surface renders it.
          if (c.nameHidden && c.type === 'monster') {
            c.name = HIDDEN_COMBATANT_NAME;
            // Le slug identifie le monstre autant que son nom — même fuite, même redaction.
            c.monsterSlug = null;
          }
          // Stable per-combatant jitter (±8 % on the tier boundaries): the same
          // monster always flips wording at the same hidden ratio, and players
          // can't average their way back to exact HP from repeated reads.
          let feeling: number | undefined;
          if (c.type === 'monster' && c.hitPoints !== null && (c.maxHitPoints ?? 0) > 0) {
            const jitter = ((((c.id * 2654435761) >>> 0) % 100) / 100) * 0.16 - 0.08;
            const ratio = c.hitPoints / (c.maxHitPoints as number);
            feeling =
              ratio > 0.72 + jitter ? 3 : ratio > 0.47 + jitter ? 2 : ratio > 0.22 + jitter ? 1 : 0;
          }
          // Joueurs vus par un autre joueur : la vie est rédigée, mais l'état
          // APPARENT « à terre » reste une info de table (le SRD le montre à
          // tous) — indicateur dérivé côté serveur, même philosophie que le
          // feeling des monstres : l'état sans les nombres (#168).
          const dying =
            c.type === 'player' && !c.defeated && (c.hitPoints ?? 0) <= 0 ? true : undefined;
          return {
            ...c,
            hitPoints: null,
            maxHitPoints: null,
            armorClass: null,
            ...(feeling !== undefined ? { feeling } : {}),
            ...(dying !== undefined ? { dying } : {}),
          };
        });
      }

      const detail: EncounterDetail = { ...mapEncounter(enc), combatants };
      // ETag : la fiche polle le détail de SA rencontre active ; hors tour et
      // hors coup, le corps est stable → 304. Même garantie anti-fuite
      // inter-lecteurs que la liste (le hash couvre le corps servi).
      return sendCachedJson(req, reply, { encounter: detail });
    },
  );

  // ===== Update encounter (GM only): name, status, round, turnIndex =====
  app.patch(
    '/encounters/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchEncounterPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = getEncounter(drizzle, Number(req.params.id));
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyGM(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.name !== undefined) values.name = body.name.trim();
      if (body.status !== undefined) {
        if (!['setup', 'active', 'ended'].includes(body.status))
          return reply
            .code(400)
            .send({ error: apiMsg(req, "Statut invalide ('setup' | 'active' | 'ended')") });
        values.status = body.status;
      }
      if (body.round !== undefined) {
        if (!Number.isInteger(body.round) || body.round < 0)
          return reply.code(400).send({ error: apiMsg(req, 'round doit être un entier ≥ 0') });
        values.round = body.round;
      }
      if (body.turnIndex !== undefined) {
        if (!Number.isInteger(body.turnIndex) || body.turnIndex < 0)
          return reply.code(400).send({ error: apiMsg(req, 'turnIndex doit être un entier ≥ 0') });
        values.turnIndex = body.turnIndex;
      }

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      drizzle.update(encountersTable).set(values).where(eq(encountersTable.id, enc.id)).run();

      const row = getEncounter(drizzle, enc.id);
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'turn',
        actorUserId: userId,
      });
      return reply.send({ encounter: mapEncounter(row) });
    },
  );

  // ===== Delete encounter (GM only) =====
  app.delete(
    '/encounters/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = getEncounter(drizzle, Number(req.params.id));
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyGM(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      drizzle.delete(encountersTable).where(eq(encountersTable.id, enc.id)).run();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        encounterId: enc.id,
        action: 'turn',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
