/**
 * Combat routes: encounters + combatants CRUD, initiative, turn management.
 *
 * Encounters are party-scoped. Any party member can read; only the GM can
 * create/mutate encounters and combatants — EXCEPT a player can set the
 * initiative for their own combatant (so players roll their own initiative).
 *
 * Every mutation emits a 'combat:change' sync event so all connected clients
 * (GM grid + player widgets) refresh in real time.
 */

import type {
  AddMonsterPayload,
  AddPlayerPayload,
  Combatant,
  CombatantCondition,
  CombatantType,
  ConcentrationCheck,
  CreateEncounterPayload,
  Encounter,
  EncounterDetail,
  EncounterRosterEntry,
  EncounterSummary,
  PatchCombatantPayload,
  PatchEncounterPayload,
  SetInitiativePayload,
} from '@table-sync/shared';
import {
  abilityModifier,
  CONCENTRATION_BREAKING_CONDITIONS_FR,
  computeAC,
  rollHitPoints,
} from '@table-sync/shared';
import { and, desc, eq, exists, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import {
  characters as charactersTable,
  combatants as combatantsTable,
  encounters as encountersTable,
  inventory,
  items,
  monsters,
} from '../db/schema.ts';
import { type PushPayload, type PushSendOptions, sendPushToUser } from '../push/send.ts';
import { bus } from '../sync/bus.ts';
import {
  getUserId,
  isPartyGM,
  isPartyMember,
  mirrorConditionsToCharacter,
  requireUser,
} from './helpers.ts';
import { apiMsg } from './messages.ts';

// ---------- Row mappers ----------

function parseConditions(raw: any): CombatantCondition[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Row mappers read BOTH key styles: snake_case from cols() projections and
// camelCase from `select().from(table)` rows — one mapping truth for the two
// select shapes that coexist in this file.
function mapCombatant(row: any): Combatant {
  return {
    id: row.id,
    encounterId: row.encounter_id ?? row.encounterId,
    type: row.type as CombatantType,
    characterId: row.character_id ?? row.characterId ?? null,
    monsterSlug: row.monster_slug ?? row.monsterSlug ?? null,
    name: row.name,
    count: row.count ?? 1,
    groupId: row.group_id ?? row.groupId ?? null,
    initiative: row.initiative ?? null,
    initiativeBonus: row.initiative_bonus ?? row.initiativeBonus ?? 0,
    armorClass: row.armor_class ?? row.armorClass ?? 10,
    hitPoints: row.hit_points ?? row.hitPoints ?? 1,
    maxHitPoints: row.max_hit_points ?? row.maxHitPoints ?? 1,
    conditions: parseConditions(row.conditions),
    sortOrder: row.sort_order ?? row.sortOrder ?? 0,
    defeated: !!row.defeated,
    cardColor: row.card_color ?? row.cardColor ?? null,
  };
}

function mapEncounter(row: any): Encounter {
  return {
    id: row.id,
    partyId: row.party_id ?? row.partyId,
    name: row.name,
    round: row.round ?? 0,
    turnIndex: row.turn_index ?? row.turnIndex ?? 0,
    status: row.status ?? 'setup',
    createdAt: row.created_at ?? row.createdAt,
  };
}

function mapEncounterSummary(row: any, roster: EncounterRosterEntry[] = []): EncounterSummary {
  return {
    ...mapEncounter(row),
    combatantCount: row.combatant_count ?? 0,
    roster,
  };
}

function getEncounter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(encountersTable))
    .from(encountersTable)
    .where(eq(encountersTable.id, id))
    .get() as any;
}

function getCombatant(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(combatantsTable))
    .from(combatantsTable)
    .where(eq(combatantsTable.id, id))
    .get() as any;
}

/** AC input rows from a character's equipped items. */
function equippedAcRows(characterId: number): any[] {
  return getDrizzle()
    .select({
      category: items.category,
      ac_base: items.acBase,
      str_min: items.strMin,
      name_fr: items.nameFr,
      name: items.name,
      equipped: inventory.equipped,
    })
    .from(inventory)
    .innerJoin(items, eq(items.id, inventory.itemId))
    .where(and(eq(inventory.characterId, characterId), eq(inventory.equipped, 1)))
    .all() as any[];
}

/**
 * Aggregate combatants of several encounters into roster previews: characters
 * first (alphabetical), then monster groups by descending size. Grouped and
 * ungrouped monsters sharing a name are merged — the register only needs
 * "Gobelin ×6", not six rows.
 */
function buildRosters(encounterIds: number[]): Map<number, EncounterRosterEntry[]> {
  const byEncounter = new Map<number, Map<string, EncounterRosterEntry>>();
  if (encounterIds.length > 0) {
    const rows = getDrizzle()
      .select({
        encounter_id: combatantsTable.encounterId,
        name: combatantsTable.name,
        type: combatantsTable.type,
      })
      .from(combatantsTable)
      .where(inArray(combatantsTable.encounterId, encounterIds))
      .all() as any[];
    for (const row of rows) {
      const perEncounter =
        byEncounter.get(row.encounter_id) ?? new Map<string, EncounterRosterEntry>();
      const key = `${row.type}:${row.name}`;
      const entry = perEncounter.get(key) ?? {
        name: row.name,
        count: 0,
        player: row.type === 'player',
      };
      entry.count += 1;
      perEncounter.set(key, entry);
      byEncounter.set(row.encounter_id, perEncounter);
    }
  }
  const result = new Map<number, EncounterRosterEntry[]>();
  for (const [encId, perEncounter] of byEncounter) {
    result.set(
      encId,
      [...perEncounter.values()].sort((a, b) => {
        if (a.player !== b.player) return a.player ? -1 : 1;
        if (a.count !== b.count) return b.count - a.count;
        return a.name.localeCompare(b.name, 'fr');
      }),
    );
  }
  return result;
}

/**
 * Sort combatants by initiative (desc), then initiative bonus (desc), then
 * name (asc). Combatants with null initiative sort last.
 * This is the canonical combat order.
 */
function sortCombatants(combatants: Combatant[]): Combatant[] {
  return [...combatants].sort((a, b) => {
    // Defeated combatants always go last
    if (a.defeated !== b.defeated) return a.defeated ? 1 : -1;
    // Null initiative sorts last
    const ai = a.initiative ?? -1;
    const bi = b.initiative ?? -1;
    if (bi !== ai) return bi - ai;
    // Tie-break on initiative bonus (dex mod)
    if (b.initiativeBonus !== a.initiativeBonus) return b.initiativeBonus - a.initiativeBonus;
    // Keep grouped monsters together
    const ga = a.groupId ?? -1;
    const gb = b.groupId ?? -1;
    if (ga !== gb) return ga - gb;
    // Final tie-break: name
    return a.name.localeCompare(b.name, 'fr');
  });
}

// ---------- Déclencheurs push (fire-and-forget, docs/push-notifications.md) ----------

/** Push fire-and-forget : un échec d'envoi ne doit jamais toucher la réponse de la route. */
function pushSafe(userId: number, payload: PushPayload, options?: PushSendOptions): void {
  sendPushToUser(userId, payload, options).catch((err) =>
    console.warn('[push] combat:', (err as Error).message),
  );
}

/**
 * Notification « À toi de jouer » : poussée au propriétaire du combattant qui
 * tient le tour après un démarrage ou une avance (next-turn MD comme fin de
 * tour joueur). Monstres et vaincus n'ont pas de destinataire — aucun envoi.
 * ttl 0 : livrer maintenant ou jeter, un tour dépassé ne vaut rien.
 */
function notifyTurnPush(enc: any): void {
  if (enc?.status !== 'active') return;
  const drizzle = getDrizzle();
  const sorted = sortCombatants(
    drizzle
      .select()
      .from(combatantsTable)
      .where(eq(combatantsTable.encounterId, enc.id))
      .all()
      .map(mapCombatant),
  );
  const current = sorted[enc.turnIndex];
  if (!current || current.defeated || current.type !== 'player' || !current.characterId) return;
  const owner = drizzle
    .select({ owner_id: charactersTable.ownerId })
    .from(charactersTable)
    .where(eq(charactersTable.id, current.characterId))
    .get() as any;
  if (!owner) return;
  pushSafe(
    owner.owner_id,
    {
      kind: 'turn',
      title: { fr: 'À toi de jouer !', en: 'Your turn!' },
      body: {
        fr: `Au tour de ${current.name} — round ${enc.round}`,
        en: `${current.name}'s turn — round ${enc.round}`,
      },
      url: `/party/${enc.partyId}/character/${current.characterId}?tab=survival`,
      tag: `turn:${enc.id}`,
    },
    { ttl: 0, urgency: 'high' },
  );
}

/** Fetch encounter, verify party membership, return the encounter row or send error. */
async function getEncounterForUser(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<any | null> {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const enc = getEncounter(getDrizzle(), Number(req.params.id));
  if (!enc) {
    reply.code(404).send({ error: apiMsg(req, 'Rencontre introuvable') });
    return null;
  }
  if (!isPartyMember(enc.party_id, userId)) {
    reply.code(403).send({ error: apiMsg(req, 'Pas membre du groupe') });
    return null;
  }
  return enc;
}

// ---------- Routes ----------

export async function combatRoutes(app: FastifyInstance) {
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
      if (gm) {
        // GM sees all encounters
        rows = drizzle
          .select({ ...cols(encountersTable), combatant_count: combatantCount })
          .from(encountersTable)
          .where(eq(encountersTable.partyId, partyId))
          .orderBy(desc(encountersTable.createdAt))
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
          .orderBy(desc(encountersTable.createdAt))
          .all();
      }

      const rosters = buildRosters(rows.map((r) => r.id));
      return reply.send({
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

      bus.emitChange({ type: 'combat:change', partyId, action: 'turn', actorUserId: userId });
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
          .where(and(eq(combatantsTable.encounterId, enc.id), eq(charactersTable.ownerId, userId)))
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
          return {
            ...c,
            hitPoints: null,
            maxHitPoints: null,
            armorClass: null,
            ...(feeling !== undefined ? { feeling } : {}),
          };
        });
      }

      const detail: EncounterDetail = { ...mapEncounter(enc), combatants };
      return reply.send({ encounter: detail });
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
      if (body.status !== undefined) values.status = body.status;
      if (body.round !== undefined) values.round = body.round;
      if (body.turnIndex !== undefined) values.turnIndex = body.turnIndex;

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      drizzle.update(encountersTable).set(values).where(eq(encountersTable.id, enc.id)).run();

      const row = getEncounter(drizzle, enc.id);
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
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
        action: 'turn',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );

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

      const rows = drizzle
        .select(cols(combatantsTable))
        .from(combatantsTable)
        .where(inArray(combatantsTable.id, createdIds))
        .orderBy(combatantsTable.id)
        .all();
      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
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
          // Compute AC from equipped armor
          const invRows = equippedAcRows(char.id);
          const dexMod = abilityModifier(char.dexterity ?? 10);
          const acResult = computeAC(
            invRows.map((r) => ({
              item: {
                category: r.category,
                acBase: r.ac_base,
                strMin: r.str_min,
                nameFr: r.name_fr,
                name: r.name,
              },
              equipped: !!r.equipped,
            })),
            dexMod,
            char.fighting_style === 'defense',
            {
              constitution: char.constitution,
              wisdom: char.wisdom,
              characterClass: char.character_class,
            },
          );
          const ac = char.armor_class_override ?? acResult.ac;

          const { id } = drizzle
            .insert(combatantsTable)
            .values({
              encounterId: enc.id,
              type: 'player',
              characterId: char.id,
              name: char.name,
              count: 1,
              initiativeBonus: dexMod,
              armorClass: ac,
              hitPoints: char.current_hp ?? 1,
              maxHitPoints: char.max_hp ?? 1,
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
        action: 'initiative',
        actorUserId: userId,
      });
      return reply.send({ ok: true });
    },
  );

  // ===== Update combatant (GM only): HP, conditions, count, etc. =====
  app.patch(
    '/combatants/:cid',
    async (
      req: FastifyRequest<{ Params: { cid: string }; Body: PatchCombatantPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const combatant = getCombatant(drizzle, Number(req.params.cid));
      if (!combatant) return reply.code(404).send({ error: apiMsg(req, 'Combattant introuvable') });

      const enc = drizzle
        .select({ party_id: encountersTable.partyId })
        .from(encountersTable)
        .where(eq(encountersTable.id, combatant.encounter_id))
        .get() as any;
      if (!isPartyGM(enc.party_id, userId))
        return reply.code(403).send({ error: apiMsg(req, 'Réservé au MD') });

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.name !== undefined) values.name = body.name;
      if (body.count !== undefined) values.count = Math.max(1, body.count);
      if (body.initiative !== undefined) values.initiative = body.initiative;
      if (body.armorClass !== undefined) values.armorClass = body.armorClass;
      if (body.hitPoints !== undefined) values.hitPoints = Math.max(0, body.hitPoints);
      if (body.maxHitPoints !== undefined) values.maxHitPoints = Math.max(1, body.maxHitPoints);
      if (body.conditions !== undefined) values.conditions = JSON.stringify(body.conditions);
      if (body.defeated !== undefined) values.defeated = body.defeated ? 1 : 0;
      if (body.cardColor !== undefined) values.cardColor = body.cardColor;

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }

      // Auto-set defeated when HP hits 0; auto-clear when HP goes above 0
      if (body.hitPoints !== undefined && body.defeated === undefined) {
        values.defeated = body.hitPoints <= 0 ? 1 : 0;
      }

      drizzle.update(combatantsTable).set(values).where(eq(combatantsTable.id, combatant.id)).run();

      // --- Concentration: if the GM damaged a player who is concentrating on
      // a spell, that player must roll a CON save (DC 10 or half damage).
      // SRD: temp HP absorbs damage first — only the real loss threatens the spell.
      let concentration: ConcentrationCheck | undefined;
      if (body.hitPoints !== undefined && combatant.type === 'player' && combatant.character_id) {
        const ch = drizzle
          .select({
            id: charactersTable.id,
            name: charactersTable.name,
            owner_id: charactersTable.ownerId,
            concentrating: charactersTable.concentrating,
            temp_hp: charactersTable.tempHp,
            wild_shape_slug: charactersTable.wildShapeSlug,
          })
          .from(charactersTable)
          .where(eq(charactersTable.id, combatant.character_id))
          .get() as any;
        if (ch?.concentrating) {
          const damage = (combatant.hit_points ?? 0) - Math.max(0, body.hitPoints);
          // While shaped, damage routes to the shape's bar — temp HP stays out of it.
          const tempHp = ch.wild_shape_slug ? 0 : (ch.temp_hp ?? 0);
          const absorbed = damage > 0 ? Math.min(tempHp, damage) : 0;
          const realHp = Math.max(0, body.hitPoints) + absorbed;
          // PHB p.203: the damage TAKEN threatens concentration — absorbed by
          // temp HP or not, the save rolls against the full hit (DD 10 or ½ dégâts).
          if (damage > 0 && realHp > 0) {
            concentration = {
              characterId: ch.id,
              characterName: ch.name,
              damage,
              dc: Math.max(10, Math.floor(damage / 2)),
              ownerId: ch.owner_id,
            };
          } else if (realHp <= 0) {
            // Unconscious → concentration ends automatically on the sheet too.
            drizzle
              .update(charactersTable)
              .set({ concentrating: 0 })
              .where(eq(charactersTable.id, ch.id))
              .run();
            bus.emitChange({
              type: 'character:change',
              partyId: enc.party_id,
              characterId: ch.id,
              action: 'stats',
              actorUserId: userId,
            });
          }
        }
      }

      // --- HP sync: the tracker is the player's sheet HP — mirror PV/PV max
      // changes back to the character so both views stay identical.
      // While the character is in Wild Shape, damage routes to the shape's
      // bar; dropping it to 0 reverts with excess carried over (SRD).
      if (
        combatant.type === 'player' &&
        combatant.character_id &&
        (body.hitPoints !== undefined || body.maxHitPoints !== undefined)
      ) {
        const ch = drizzle
          .select({
            id: charactersTable.id,
            name: charactersTable.name,
            current_hp: charactersTable.currentHp,
            max_hp: charactersTable.maxHp,
            temp_hp: charactersTable.tempHp,
            wild_shape_slug: charactersTable.wildShapeSlug,
            wild_shape_max_hp: charactersTable.wildShapeMaxHp,
          })
          .from(charactersTable)
          .where(eq(charactersTable.id, combatant.character_id))
          .get() as any;

        if (ch?.wild_shape_slug && body.hitPoints !== undefined) {
          if (body.hitPoints > 0) {
            drizzle
              .update(charactersTable)
              .set({ wildShapeHp: Math.max(0, body.hitPoints) })
              .where(eq(charactersTable.id, ch.id))
              .run();
          } else {
            // Shape dropped to 0 → auto-revert with carry-over
            const excess = Math.max(0, -(body.hitPoints ?? 0));
            const newHp = Math.max(0, (ch.current_hp ?? 1) - excess);
            const revertName = combatant.name.replace(/ \([^)]*\)$/, '');
            drizzle
              .update(charactersTable)
              .set({
                wildShapeSlug: null,
                wildShapeHp: null,
                wildShapeMaxHp: null,
                currentHp: newHp,
              })
              .where(eq(charactersTable.id, ch.id))
              .run();
            drizzle
              .update(combatantsTable)
              .set({
                name: revertName,
                hitPoints: newHp,
                maxHitPoints: ch.max_hp ?? 1,
                defeated: newHp <= 0 ? 1 : 0,
              })
              .where(eq(combatantsTable.id, combatant.id))
              .run();
          }
          bus.emitChange({
            type: 'character:change',
            partyId: enc.party_id,
            characterId: ch.id,
            action: 'stats',
            actorUserId: userId,
          });
        } else {
          const valuesC: Record<string, unknown> = {};
          if (body.hitPoints !== undefined) {
            let newHp = Math.max(0, body.hitPoints);
            // SRD: damage eats temp HP first. The tracker doesn't display temp,
            // so the server absorbs it here and settles the tracker's row on
            // the real HP (a fully absorbed hit leaves the row unchanged).
            const damage = (combatant.hit_points ?? 0) - newHp;
            const tempHp = ch?.temp_hp ?? 0;
            if (damage > 0 && tempHp > 0) {
              const absorbed = Math.min(tempHp, damage);
              newHp += absorbed;
              valuesC.tempHp = tempHp - absorbed;
              drizzle
                .update(combatantsTable)
                .set({ hitPoints: newHp, defeated: newHp <= 0 ? 1 : 0 })
                .where(eq(combatantsTable.id, combatant.id))
                .run();
            }
            valuesC.currentHp = newHp;
          }
          if (body.maxHitPoints !== undefined) {
            valuesC.maxHp = Math.max(1, body.maxHitPoints);
          }
          if (Object.keys(valuesC).length > 0) {
            drizzle
              .update(charactersTable)
              .set(valuesC)
              .where(eq(charactersTable.id, combatant.character_id))
              .run();
            bus.emitChange({
              type: 'character:change',
              partyId: enc.party_id,
              characterId: combatant.character_id,
              action: 'hp',
              actorUserId: userId,
            });
          }
        }
      }

      // Re-read AFTER the HP mirror — temp absorption may have settled the
      // combatant's row on a different value than the GM sent.
      const row = getCombatant(drizzle, combatant.id);

      // --- Condition sync: tracker condition changes mirror to the sheet
      // (names only — durations stay a combat-tracker detail).
      if (body.conditions !== undefined && combatant.type === 'player' && combatant.character_id) {
        const prevNames = parseConditions(combatant.conditions).map((c) => c.name);
        const nextNames = body.conditions.map((c) => c.name);
        mirrorConditionsToCharacter(
          enc.party_id,
          combatant.character_id,
          nextNames.filter((n) => !prevNames.includes(n)),
          prevNames.filter((n) => !nextNames.includes(n)),
          userId,
        );
      }

      // --- Concentration: an incapacitating condition applied by the GM
      // (Inconscient, Paralysé, …) breaks the player's concentration.
      let concentrationBroken: string | undefined;
      if (body.conditions && combatant.type === 'player' && combatant.character_id) {
        const breaking = body.conditions.find((c) =>
          CONCENTRATION_BREAKING_CONDITIONS_FR.includes(c.name),
        );
        if (breaking) {
          const ch = drizzle
            .select({ id: charactersTable.id, concentrating: charactersTable.concentrating })
            .from(charactersTable)
            .where(eq(charactersTable.id, combatant.character_id))
            .get() as any;
          if (ch?.concentrating) {
            drizzle
              .update(charactersTable)
              .set({ concentrating: 0 })
              .where(eq(charactersTable.id, ch.id))
              .run();
            bus.emitChange({
              type: 'character:change',
              partyId: enc.party_id,
              characterId: ch.id,
              action: 'stats',
              actorUserId: userId,
            });
            concentrationBroken = breaking.name;
          }
        }
      }

      bus.emitChange({
        type: 'combat:change',
        partyId: enc.party_id,
        action: 'hp',
        actorUserId: userId,
        ...(concentration ? { concentration } : {}),
      });
      return reply.send({
        combatant: mapCombatant(row),
        ...(concentrationBroken ? { concentrationBroken } : {}),
      });
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
        .select({ party_id: encountersTable.partyId })
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
        action: 'remove',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );

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
        action: 'turn',
        actorUserId: userId,
      });
      notifyTurnPush(row);
      return reply.send({ encounter: mapEncounter(row) });
    },
  );
}

/**
 * One atomic turn advance — shared by the GM's next-turn and the player's
 * end-my-turn: expires the ending turn's conditions (grouped monsters share a
 * turn), then updates turn/round skipping defeated combatants. Queries use the
 * Drizzle query-builder over the same better-sqlite3 connection; the native
 * db.transaction() wrapper keeps the condition-mirror writes (raw SQL in
 * helpers.ts, same connection) inside the same unit — a mid-failure must not
 * expire conditions without advancing the turn (or vice-versa). Sync events
 * emitted from inside are best-effort refresh nudges; a rollback just leaves
 * clients on the pre-tx state.
 */
function advanceTurnTx(
  enc: { id: number; partyId: number; round: number },
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
    if (currentCombatant) {
      const currentGroup = currentCombatant.groupId;
      // Find all combatants sharing this turn (same group, or same initiative
      // for non-grouped combatants at the same position)
      const sameTurn = sorted.filter(
        (c) => (currentGroup && c.groupId === currentGroup) || c.id === currentCombatant.id,
      );
      for (const c of sameTurn) {
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
  });
  advanceTx();
}
