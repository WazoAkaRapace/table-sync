/**
 * Tours de combat — déplacés à l'identique depuis routes/combat.ts
 * (phase 4d, déplacement pur) : next-turn MD (démarrage setup->active et
 * avance), end-my-turn joueur (garde de propriété sur le tour courant),
 * prev-turn MD #169 (restauration du cran unique). advanceTurnTx garde
 * l'expiration des conditions et des effets éphémères (miroir CA compris)
 * DANS la même transaction que l'avance de tour ; notifyTurnPush pousse
 * « À toi de joue ! » au propriétaire du tour nouvellement courant.
 *
 * R4 hérité documenté : import de '../character-spell-effects.ts'
 * (expireEphemeralEffects, mirrorAcToCombatants), couplage préexistant au
 * découpage, extraction routes/lib prévue en phase 4b.
 */

import type { Combatant, CombatantCondition } from '@table-sync/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import {
  characters as charactersTable,
  combatants as combatantsTable,
  encounters as encountersTable,
} from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { expireEphemeralEffects, mirrorAcToCombatants } from '../character-spell-effects.ts';
import { mirrorConditionsToCharacter } from '../lib/conditions.ts';
import { isPartyGM, requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
import { mapCombatant, mapEncounter, notifyTurnPush, sortCombatants } from './shared.ts';

export async function turnRoutes(app: FastifyInstance) {
  // ===== Next turn (GM only): advance turnIndex, handle round wrap + condition expiry =====
  app.post(
    '/encounters/:id/next-turn',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = drizzle
        .select()
        .from(encountersTable)
        .where(eq(encountersTable.id, Number(req.params.id)))
        .get();
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyGM(enc.partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      // Une rencontre terminée n'avance plus (setup reste accepté : c'est le démarrage).
      if (enc.status === 'ended')
        return reply.code(400).send({ error: apiMsg(req, 'Combat terminé') });

      const sorted = sortCombatants(
        drizzle
          .select()
          .from(combatantsTable)
          .where(eq(combatantsTable.encounterId, enc.id))
          .all()
          .map(mapCombatant),
      );
      const active = sorted.filter((c) => !c.defeated);

      if (active.length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'Aucun combattant actif') });
      }

      // --- Starting the combat: setup → active, round 1, first combatant acts.
      // No turn is ending yet, so no condition expiry and no advancing.
      if (enc.status === 'setup') {
        const firstIdx = Math.max(
          0,
          sorted.findIndex((c) => !c.defeated),
        );
        drizzle
          .update(encountersTable)
          .set({ status: 'active', round: 1, turnIndex: firstIdx })
          .where(eq(encountersTable.id, enc.id))
          .run();
        const started = drizzle
          .select()
          .from(encountersTable)
          .where(eq(encountersTable.id, enc.id))
          .get();
        bus.emitChange({
          type: 'combat:change',
          partyId: enc.partyId,
          encounterId: enc.id,
          action: 'turn',
          actorUserId: userId,
        });
        // Le premier combattant agissant peut être un PJ : préviens son joueur.
        notifyTurnPush(started);
        return reply.send({ encounter: mapEncounter(started) });
      }

      const currentIdx = Math.min(enc.turnIndex, sorted.length - 1);
      advanceTurnTx(enc, sorted, currentIdx, userId);

      const row = drizzle
        .select()
        .from(encountersTable)
        .where(eq(encountersTable.id, enc.id))
        .get();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.partyId,
        encounterId: enc.id,
        action: 'turn',
        actorUserId: userId,
      });
      notifyTurnPush(row);
      return reply.send({ encounter: mapEncounter(row) });
    },
  );

  // ===== End MY turn (player): the owner of the current combatant advances the
  // turn themselves — same advance as the GM's next-turn (condition expiry,
  // round wrap), allowed ONLY while one of the caller's characters holds the
  // current turn. The GM keeps next-turn; this route never starts a combat.
  app.post(
    '/encounters/:id/end-my-turn',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = drizzle
        .select()
        .from(encountersTable)
        .where(eq(encountersTable.id, Number(req.params.id)))
        .get();
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (enc.status !== 'active')
        return reply.code(400).send({ error: apiMsg(req, 'Combat non actif') });

      const sorted = sortCombatants(
        drizzle
          .select()
          .from(combatantsTable)
          .where(eq(combatantsTable.encounterId, enc.id))
          .all()
          .map(mapCombatant),
      );
      const active = sorted.filter((c) => !c.defeated);

      if (active.length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'Aucun combattant actif') });
      }

      const currentIdx = Math.min(enc.turnIndex, sorted.length - 1);
      const current = sorted[currentIdx];
      if (!current) return reply.code(400).send({ error: apiMsg(req, 'Aucun combattant actif') });

      // The current turn belongs to a group (or a lone combatant): the caller
      // must own one of its characters to close it. Ownership is checked on the
      // character row — UI gating hides the button, this is the real guard.
      const currentGroup = current.groupId;
      const sameTurn = sorted.filter(
        (c) => (currentGroup && c.groupId === currentGroup) || c.id === current.id,
      );
      const turnCharacterIds = sameTurn
        .filter((c) => c.characterId !== null)
        .map((c) => c.characterId as number);
      const owned =
        turnCharacterIds.length > 0
          ? drizzle
              .select({ id: charactersTable.id })
              .from(charactersTable)
              .where(
                and(
                  inArray(charactersTable.id, turnCharacterIds),
                  eq(charactersTable.ownerId, userId),
                ),
              )
              .get()
          : undefined;
      if (!owned) return reply.code(403).send({ error: "Ce n'est pas ton tour" });

      advanceTurnTx(enc, sorted, currentIdx, userId);

      const row = drizzle
        .select()
        .from(encountersTable)
        .where(eq(encountersTable.id, enc.id))
        .get();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.partyId,
        encounterId: enc.id,
        action: 'turn',
        actorUserId: userId,
      });
      notifyTurnPush(row);
      return reply.send({ encounter: mapEncounter(row) });
    },
  );

  // ===== Previous turn (GM only, #169): undo the LAST advance — restores the
  // pre-advance position (turnIndex/round) and the conditions the advance
  // expired/decremented (real time-travel of turn state). Single-step history:
  // the snapshot is consumed (NULLed) — a second consecutive prev 400s. PV,
  // defeated, initiative, morts are deliberately untouched (documented
  // non-goals): the undo covers the TURN state, damage stays table reality.
  app.post(
    '/encounters/:id/prev-turn',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const enc = drizzle
        .select()
        .from(encountersTable)
        .where(eq(encountersTable.id, Number(req.params.id)))
        .get();
      if (!enc) return reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
      if (!isPartyGM(enc.partyId, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });
      if (enc.status !== 'active')
        return reply.code(400).send({ error: apiMsg(req, 'Combat non actif') });

      const snapshot = parseTurnSnapshot(enc.turnSnapshot ?? null);
      if (!snapshot)
        return reply.code(400).send({ error: apiMsg(req, "Plus d'historique de tour") });

      const db = getDb();
      const prevTx = db.transaction(() => {
        // Restore each snapshotted combatant's full conditions array (durations
        // included) — expired conditions come back, decremented ones regain
        // their turn count. Sheet mirrors follow (player conditions travel
        // sheet↔tracker); monsters carry no sheet.
        for (const entry of snapshot.conditions) {
          const row = drizzle
            .select()
            .from(combatantsTable)
            .where(eq(combatantsTable.id, entry.combatantId))
            .get();
          // Combatant deleted since the advance — nothing to restore for it.
          if (!row) continue;
          const before = JSON.parse(row.conditions || '[]') as CombatantCondition[];
          drizzle
            .update(combatantsTable)
            .set({ conditions: JSON.stringify(entry.conditions) })
            .where(eq(combatantsTable.id, entry.combatantId))
            .run();
          if (row.type === 'player' && row.characterId) {
            const removed = before
              .filter((c) => !entry.conditions.some((e) => e.name === c.name))
              .map((c) => c.name);
            const added = entry.conditions
              .filter((c) => !before.some((e) => e.name === c.name))
              .map((c) => c.name);
            if (removed.length > 0 || added.length > 0) {
              mirrorConditionsToCharacter(enc.partyId, row.characterId, added, removed, userId);
            }
          }
        }

        // Restore the pre-advance position and consume the single-step history
        // (a second consecutive prev 400s — re-advancing re-snapshots).
        drizzle
          .update(encountersTable)
          .set({
            turnIndex: snapshot.turnIndex,
            round: snapshot.round,
            turnSnapshot: null,
          })
          .where(eq(encountersTable.id, enc.id))
          .run();
      });
      prevTx();

      const row = drizzle
        .select()
        .from(encountersTable)
        .where(eq(encountersTable.id, enc.id))
        .get();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.partyId,
        encounterId: enc.id,
        action: 'turn',
        actorUserId: userId,
      });
      return reply.send({ encounter: mapEncounter(row) });
    },
  );
}

/**
 * #169 — état annulable du dernier advance (cran unique). `conditions` ne
 * couvre QUE les combattants du tour terminé dont les durées vont bouger
 * (durée non nulle) : leur tableau complet AVANT décrément/expiration.
 * `turnIndex`/`round` suffisent au reste — position d'avant tour.
 */
interface TurnSnapshot {
  turnIndex: number;
  round: number;
  conditions: Array<{ combatantId: number; conditions: CombatantCondition[] }>;
}

function parseTurnSnapshot(raw: string | null): TurnSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.turnIndex === 'number' &&
      typeof parsed.round === 'number' &&
      Array.isArray(parsed.conditions)
    ) {
      return parsed as TurnSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * One atomic turn advance — shared by the GM's next-turn and the player's
 * end-my-turn: expires the ending turn's conditions (grouped monsters share a
 * turn), then updates turn/round skipping defeated combatants. Queries use the
 * Drizzle query-builder over the same better-sqlite3 connection; the native
 * db.transaction() wrapper keeps the condition-mirror writes (raw SQL in
 * lib/character-classes.ts, same connection) inside the same unit — a mid-failure must not
 * expire conditions without advancing the turn (or vice-versa). Sync events
 * emitted from inside are best-effort refresh nudges; a rollback just leaves
 * clients on the pre-tx state.
 *
 * #179/#169 : AVANT de muter, capture dans encounters.turn_snapshot l'état que
 * CE advance peut défaire (position + conditions avant expiry) — historique à
 * cran unique que POST /encounters/:id/prev-turn consomme. Toujours écrit
 * (conditions: [] quand rien ne bouge — la seule position reste annulable) ;
 * le passage setup→active de next-turn ne passe PAS ici et ne snapshotte pas.
 */
function advanceTurnTx(
  enc: { id: number; partyId: number; round: number; turnIndex: number },
  sorted: Combatant[],
  currentIdx: number,
  userId: number,
): void {
  const db = getDb();
  const drizzle = getDrizzle();
  const currentCombatant = sorted[currentIdx];

  const advanceTx = db.transaction(() => {
    // --- Condition expiry for ALL combatants whose turn is ending ---
    // (grouped monsters share initiative, so they share a turn)
    const snapshotConditions: TurnSnapshot['conditions'] = [];
    if (currentCombatant) {
      const currentGroup = currentCombatant.groupId;
      // Find all combatants sharing this turn (same group, or same initiative
      // for non-grouped combatants at the same position)
      const sameTurn = sorted.filter(
        (c) => (currentGroup && c.groupId === currentGroup) || c.id === currentCombatant.id,
      );
      for (const c of sameTurn) {
        // Snapshot BEFORE mutating: only combatants whose durations will move
        // (null duration = until dispelled, never touched by the advance)
        if (c.conditions.some((cond) => cond.duration !== null)) {
          snapshotConditions.push({ combatantId: c.id, conditions: c.conditions });
        }
        // --- Effets de sort éphémères (Bouclier) : fin du tour du LANCEUR ---
        // RAW « jusqu'au début de ton prochain tour », approximé en fin de
        // tour (jamais de CA fantôme) ; miroir CA + emitChange 'stats' des
        // porteurs touchés — dans la même transaction que l'avance.
        if (c.characterId) {
          const expiredBearers = expireEphemeralEffects(c.characterId);
          for (const bearerId of expiredBearers) {
            // per-encounter : le porteur peut combattre ailleurs — chaque
            // traqueur affecté reçoit SON combat:change (CodeRabbit #281).
            mirrorAcToCombatants(bearerId, userId, { emit: 'per-encounter' });
            bus.emitChange({
              type: 'character:change',
              partyId: enc.partyId,
              characterId: bearerId,
              action: 'stats',
              actorUserId: userId,
            });
          }
        }
        if (c.conditions.length === 0) continue;
        let changed = false;
        const expired: string[] = [];
        const updated = c.conditions
          .map((cond) => {
            if (cond.duration === null) return cond; // until dispelled
            if (cond.duration <= 1) {
              changed = true;
              expired.push(cond.name);
              return null;
            } // expired
            changed = true;
            return { ...cond, duration: cond.duration - 1 };
          })
          .filter((cond): cond is CombatantCondition => cond !== null);
        if (changed) {
          drizzle
            .update(combatantsTable)
            .set({ conditions: JSON.stringify(updated) })
            .where(eq(combatantsTable.id, c.id))
            .run();
          // Expired conditions leave the character sheet too
          if (expired.length > 0 && c.type === 'player' && c.characterId) {
            mirrorConditionsToCharacter(enc.partyId, c.characterId, [], expired, userId);
          }
        }
      }
    }

    // --- Advance turn: skip past the entire current group ---
    // Grouped combatants are adjacent in sorted order. Find the next combatant
    // that is NOT in the current group (or, for non-grouped, just +1).
    let nextIndex = currentIdx + 1;
    let round = enc.round;
    const currentGroup = currentCombatant?.groupId;

    // If current is part of a group, skip past all group members
    if (currentGroup) {
      while (nextIndex < sorted.length && sorted[nextIndex]?.groupId === currentGroup) {
        nextIndex++;
      }
    }

    // If we've passed the end, wrap to start and increment round
    if (nextIndex >= sorted.length) {
      nextIndex = 0;
      round = round + 1;
      if (round === 1) {
        drizzle
          .update(encountersTable)
          .set({ status: 'active' })
          .where(eq(encountersTable.id, enc.id))
          .run();
      }
    }

    // Skip defeated combatants (and their group members)
    const refetchedSorted = sortCombatants(
      drizzle
        .select()
        .from(combatantsTable)
        .where(eq(combatantsTable.encounterId, enc.id))
        .all()
        .map(mapCombatant),
    );
    let guard = 0;
    while (refetchedSorted[nextIndex]?.defeated && guard < refetchedSorted.length * 2) {
      const skipGroup = refetchedSorted[nextIndex]?.groupId;
      nextIndex++;
      // Skip remaining group members too
      if (skipGroup) {
        while (
          nextIndex < refetchedSorted.length &&
          refetchedSorted[nextIndex]?.groupId === skipGroup
        ) {
          nextIndex++;
        }
      }
      if (nextIndex >= refetchedSorted.length) {
        nextIndex = 0;
        round++;
      }
      guard++;
    }

    drizzle
      .update(encountersTable)
      .set({ turnIndex: nextIndex, round })
      .where(eq(encountersTable.id, enc.id))
      .run();

    // #169 — snapshot du cran unique : position d'avant + conditions d'avant.
    // Écrit DANS la transaction (une advance sans snapshot ne serait pas
    // annulable). Toujours écrit, même sans conditions (position seule).
    const snapshot: TurnSnapshot = {
      turnIndex: enc.turnIndex,
      round: enc.round,
      conditions: snapshotConditions,
    };
    drizzle
      .update(encountersTable)
      .set({ turnSnapshot: JSON.stringify(snapshot) })
      .where(eq(encountersTable.id, enc.id))
      .run();
  });
  advanceTx();
}
