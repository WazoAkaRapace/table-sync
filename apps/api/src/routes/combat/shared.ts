/**
 * Helpers partagés du domaine combat — déplacés à l'identique depuis
 * routes/combat.ts (phase 4d, déplacement pur) : mappers de lignes (les deux
 * styles de clés snake_case/camelCase), lectures d'agrégats (rosters), tri
 * canonique de l'initiative, déclencheurs push et garde d'accès rencontre.
 */

import type {
  Combatant,
  CombatantCondition,
  CombatantType,
  Encounter,
  EncounterRosterEntry,
  EncounterSummary,
} from '@table-sync/shared';
import { HIDDEN_COMBATANT_NAME } from '@table-sync/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import {
  characters as charactersTable,
  combatants as combatantsTable,
  encounters as encountersTable,
} from '../../db/schema.ts';
import { type PushPayload, type PushSendOptions, sendPushToUser } from '../../push/send.ts';
import { isPartyMember, requireUser } from '../helpers.ts';
import { apiMsg } from '../messages.ts';

// ---------- Row mappers ----------

export function parseConditions(raw: any): CombatantCondition[] {
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
export function mapCombatant(row: any): Combatant {
  return {
    id: row.id,
    encounterId: row.encounter_id ?? row.encounterId,
    type: row.type as CombatantType,
    characterId: row.character_id ?? row.characterId ?? null,
    monsterSlug: row.monster_slug ?? row.monsterSlug ?? null,
    name: row.name,
    nameHidden: !!(row.name_hidden ?? row.nameHidden),
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

export function mapEncounter(row: any): Encounter {
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

export function mapEncounterSummary(
  row: any,
  roster: EncounterRosterEntry[] = [],
): EncounterSummary {
  return {
    ...mapEncounter(row),
    combatantCount: row.combatant_count ?? 0,
    roster,
  };
}

export function getEncounter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(encountersTable))
    .from(encountersTable)
    .where(eq(encountersTable.id, id))
    .get() as any;
}

export function getCombatant(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(combatantsTable))
    .from(combatantsTable)
    .where(eq(combatantsTable.id, id))
    .get() as any;
}

/**
 * Aggregate combatants of several encounters into roster previews: characters
 * first (alphabetical), then monster groups by descending size. Grouped and
 * ungrouped monsters sharing a name are merged — the register only needs
 * "Gobelin ×6", not six rows. For non-GM viewers, masked monster names become
 * the shared placeholder — distinct hidden groups merge into one line, which
 * keeps even their count-by-type secret.
 */
export function buildRosters(
  encounterIds: number[],
  gm: boolean,
): Map<number, EncounterRosterEntry[]> {
  const byEncounter = new Map<number, Map<string, EncounterRosterEntry>>();
  if (encounterIds.length > 0) {
    const rows = getDrizzle()
      .select({
        encounter_id: combatantsTable.encounterId,
        name: combatantsTable.name,
        type: combatantsTable.type,
        name_hidden: combatantsTable.nameHidden,
      })
      .from(combatantsTable)
      .where(inArray(combatantsTable.encounterId, encounterIds))
      .all() as any[];
    for (const row of rows) {
      const masked = !gm && row.type === 'monster' && row.name_hidden;
      const displayName = masked ? HIDDEN_COMBATANT_NAME : row.name;
      const perEncounter =
        byEncounter.get(row.encounter_id) ?? new Map<string, EncounterRosterEntry>();
      const key = `${row.type}:${displayName}`;
      const entry = perEncounter.get(key) ?? {
        name: displayName,
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
export function sortCombatants(combatants: Combatant[]): Combatant[] {
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
export function pushSafe(userId: number, payload: PushPayload, options?: PushSendOptions): void {
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
export function notifyTurnPush(enc: any): void {
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
export async function getEncounterForUser(
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
