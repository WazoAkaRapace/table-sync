/**
 * GM Assistant — cache local (sessions/recaps/moments + « PNJ repérés »),
 * déplacé à l'identique depuis routes/gma.ts (phase 4e, déplacement pur) :
 * refetch sous TTL, remplacements transactionnels, migration d'ids des
 * entités (sweep auto-réparant) — les doc comments d'origine font foi.
 */

import { createHash } from 'node:crypto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import {
  gmaEntities,
  gmaEntityDiscards,
  gmaEntitySessions,
  gmaMoments,
  gmaNpcLinks,
  gmaRecaps,
  gmaSessions,
  partyGmaLinks,
} from '../../db/schema.ts';
import { gmaListAll, gmaRequest } from '../../gma/client.ts';
import { decodeGmaText, nowIso, resolveLinkKey } from './shared.ts';

// ---------- sessions / recaps cache ----------

export function cachedSessions(partyId: number): any[] {
  return getDrizzle()
    .select(cols(gmaSessions))
    .from(gmaSessions)
    .where(eq(gmaSessions.partyId, partyId))
    .orderBy(gmaSessions.sortOrder, gmaSessions.sessionId)
    .all() as any[];
}

/**
 * Refetch the campaign's sessions into the cache. Carries each surviving
 * session's recaps_fetched_at over the replace, drops recaps of sessions that
 * disappeared on GMA, and stamps the party-level marker (it lives on the link
 * row: an empty campaign has no rows to carry a timestamp). Returns the new
 * marker. Throws GmaError upstream on failure (cache intact).
 */
export async function syncSessions(partyId: number, link: any, key: string): Promise<string> {
  const list = await gmaListAll<any>(key, `/campaigns/${link.gma_campaign_id}/sessions`, {
    fields: 'id,title,played_at,order',
    limit: '500',
  });
  const fetchedAt = nowIso();
  const old = cachedSessions(partyId);
  const oldRecapsAt = new Map<string, string | null>(
    old.map((r) => [r.session_id, r.recaps_fetched_at]),
  );
  // « Vu en séance » appearances are fetched once per session — a surviving
  // session keeps its marker across the replace.
  const oldNpcsAt = new Map<string, string | null>(
    old.map((r) => [r.session_id, r.npcs_fetched_at]),
  );
  const ids = list.map((s) => String(s.id));
  getDb().transaction(() => {
    const drizzle = getDrizzle();
    drizzle.delete(gmaSessions).where(eq(gmaSessions.partyId, partyId)).run();
    for (const s of list) {
      drizzle
        .insert(gmaSessions)
        .values({
          partyId,
          sessionId: String(s.id),
          title: decodeGmaText(s.title ?? 'Séance sans titre'),
          playedAt: s.played_at ?? null,
          sortOrder: Number.isInteger(s.order) ? s.order : 0,
          recapsFetchedAt: oldRecapsAt.get(String(s.id)) ?? null,
          npcsFetchedAt: oldNpcsAt.get(String(s.id)) ?? null,
        })
        .run();
    }
    if (ids.length > 0) {
      drizzle
        .delete(gmaRecaps)
        .where(and(eq(gmaRecaps.partyId, partyId), notInArray(gmaRecaps.sessionId, ids)))
        .run();
      drizzle
        .delete(gmaMoments)
        .where(and(eq(gmaMoments.partyId, partyId), notInArray(gmaMoments.sessionId, ids)))
        .run();
    } else {
      drizzle.delete(gmaRecaps).where(eq(gmaRecaps.partyId, partyId)).run();
      drizzle.delete(gmaMoments).where(eq(gmaMoments.partyId, partyId)).run();
    }
    drizzle
      .update(partyGmaLinks)
      .set({ sessionsFetchedAt: fetchedAt, updatedAt: fetchedAt })
      .where(eq(partyGmaLinks.partyId, partyId))
      .run();
  })();
  return fetchedAt;
}

export function cachedSessionRow(partyId: number, sessionId: string): any | null {
  return (
    getDrizzle()
      .select(cols(gmaSessions))
      .from(gmaSessions)
      .where(and(eq(gmaSessions.partyId, partyId), eq(gmaSessions.sessionId, sessionId)))
      .get() ?? null
  );
}

export function cachedRecaps(partyId: number, sessionId: string): any[] {
  return (
    getDrizzle()
      .select(cols(gmaRecaps))
      .from(gmaRecaps)
      .where(and(eq(gmaRecaps.partyId, partyId), eq(gmaRecaps.sessionId, sessionId)))
      // GMA ordering: `default` first, then styles ascending.
      .orderBy(sql`CASE WHEN ${gmaRecaps.style} = 'default' THEN 0 ELSE 1 END`, gmaRecaps.style)
      .all() as any[]
  );
}

export function cachedMoments(partyId: number, sessionId: string): any[] {
  return getDrizzle()
    .select(cols(gmaMoments))
    .from(gmaMoments)
    .where(and(eq(gmaMoments.partyId, partyId), eq(gmaMoments.sessionId, sessionId)))
    .orderBy(gmaMoments.sortOrder, gmaMoments.momentId)
    .all() as any[];
}

/**
 * Refetch one session's recaps AND memorable moments into the cache (one
 * freshness marker, one transaction). Throws GmaError upstream.
 */
export async function syncRecaps(
  partyId: number,
  link: any,
  key: string,
  sessionId: string,
): Promise<void> {
  const campaignPath = `/campaigns/${link.gma_campaign_id}/sessions/${sessionId}`;
  const [res, moments] = await Promise.all([
    gmaRequest<{ data?: any[] }>(key, 'GET', `${campaignPath}/recaps`),
    // Sparse by default — widen for the fields the chronicle displays.
    gmaListAll<any>(key, `${campaignPath}/memorable-moments`, {
      fields: 'id,description,is_quote,type,speaker,context,order',
      limit: '500',
    }),
  ]);
  const entries = Array.isArray(res?.data) ? res.data : [];
  const fetchedAt = nowIso();
  getDb().transaction(() => {
    const drizzle = getDrizzle();
    drizzle
      .delete(gmaRecaps)
      .where(and(eq(gmaRecaps.partyId, partyId), eq(gmaRecaps.sessionId, sessionId)))
      .run();
    for (const e of entries) {
      drizzle
        .insert(gmaRecaps)
        .values({
          partyId,
          sessionId,
          style: String(e.style),
          text: decodeGmaText(e.text ?? ''),
          updatedAt: e.updated_at ?? null,
        })
        .run();
    }
    drizzle
      .delete(gmaMoments)
      .where(and(eq(gmaMoments.partyId, partyId), eq(gmaMoments.sessionId, sessionId)))
      .run();
    for (const m of moments) {
      drizzle
        .insert(gmaMoments)
        .values({
          partyId,
          sessionId,
          momentId: String(m.id),
          isQuote: m.is_quote ? 1 : 0,
          type: m.type ?? null,
          description: decodeGmaText(m.description ?? ''),
          speaker: m.speaker != null ? decodeGmaText(m.speaker) : null,
          context: m.context != null ? decodeGmaText(m.context) : null,
          sortOrder: Number.isInteger(m.order) ? m.order : 0,
        })
        .run();
    }
    drizzle
      .update(gmaSessions)
      .set({ recapsFetchedAt: fetchedAt })
      .where(and(eq(gmaSessions.partyId, partyId), eq(gmaSessions.sessionId, sessionId)))
      .run();
  })();
}

// ---------- entities cache (« PNJ repérés ») ----------

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function cachedEntities(partyId: number): any[] {
  return getDrizzle()
    .select(cols(gmaEntities))
    .from(gmaEntities)
    .where(eq(gmaEntities.partyId, partyId))
    .orderBy(gmaEntities.sortOrder, sql`${gmaEntities.name} COLLATE NOCASE ASC`)
    .all() as any[];
}

/** Entity types that are clearly not characters — kept defensively: the real
 *  API serves NPCs from their own collection (no `type` field), so cached rows
 *  carry NULL, but nothing here should break if a typed shape ever appears. */
export const NON_NPC_ENTITY_TYPES = new Set([
  'location',
  'place',
  'faction',
  'organization',
  'item',
  'lore',
  'quest',
]);

/** Name matching for « Vu en séance »: accents & case aside, same name. */
function normalizeGmaName(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Refetch the campaign's NPCs into the cache — the « PNJ repérés » rail.
 * Verified against the live GMA API (spec + the campaign at hand): the
 * campaign-level /npcs list is often EMPTY — the assistant catalogs NPCs
 * PER SESSION (`GET …/sessions/{sid}/npcs`, their own ids, full
 * descriptions). The rail is therefore the union of both layers:
 *
 * - campaign NPCs are the canonical rows (their real id, their description);
 * - session NPCs are aggregated BY NAME into synthetic rows (`sn:<nom>`)
 *   when no campaign NPC carries the name — description = the longest seen;
 * - « Vu en séance » = the sessions whose record mentions the name.
 *
 * One call per session, ONCE per session (npcs_fetched_at) — a new session
 * costs one call, an established campaign nothing. A single session's
 * failure postpones its appearances to the next TTL; a campaign-list
 * failure throws (cache intact).
 *
 * Id migrations: promoting a session NPC to a campaign NPC on GMA changes
 * its id here (synthetic `sn:` row → canonical UUID). Appearances, npc
 * links and discards all key on the id, and the fresh-session rewrite below
 * only touches sessions fetched in THIS run — so after the entities replace,
 * a sweep re-keys every row still holding an id that left the cache onto
 * the surviving entity of the same name (`sn:` ids encode it), or drops it
 * when no survivor exists. Self-healing by design: the sweep repairs rows
 * orphaned by past migrations too, not just this run's.
 */
export async function syncEntities(partyId: number, link: any, key: string): Promise<string> {
  // Appearances lean on the sessions cache — make sure it exists even when
  // the chronicle was never opened (best-effort, ordinals degrade without it).
  if (cachedSessions(partyId).length === 0) {
    try {
      await syncSessions(partyId, link, key);
    } catch {
      /* no sessions → no appearances, the rail still serves */
    }
  }
  const campaignNpcs = await gmaListAll<any>(key, `/campaigns/${link.gma_campaign_id}/npcs`, {
    fields: 'id,name,description,order',
    limit: '500',
  });

  // Sessions never processed → fetch their NPC lists, then mark them done.
  const fresh = cachedSessions(partyId).filter((s: any) => !s.npcs_fetched_at);
  const freshIds: string[] = [];
  const perSession: Array<{ sessionId: string; npcs: any[] }> = [];
  for (const s of fresh) {
    const sessionId = String(s.session_id);
    try {
      const sessionNpcs = await gmaListAll<any>(
        key,
        `/campaigns/${link.gma_campaign_id}/sessions/${sessionId}/npcs`,
        { fields: 'id,name,description,order', limit: '500' },
      );
      perSession.push({ sessionId, npcs: sessionNpcs });
      freshIds.push(sessionId);
    } catch {
      // Unmarked on purpose — retried on the next TTL window.
    }
  }

  // Merge, keyed by normalized name. Existing cached rows come first so
  // prior sessions' entities (and their ids) survive the replace; campaign
  // NPCs are canonical and may take a name over from a synthetic row.
  interface Merged {
    entityId: string;
    name: string;
    description: string | null;
    sortOrder: number;
    fromCampaign: boolean;
    sessions: Set<string>;
  }
  const merged = new Map<string, Merged>();
  for (const row of cachedEntities(partyId)) {
    const k = normalizeGmaName(row.name);
    if (!k || merged.has(k)) continue;
    merged.set(k, {
      entityId: row.entity_id,
      name: row.name,
      description: row.description ?? null,
      sortOrder: row.sort_order ?? 0,
      fromCampaign: !row.entity_id.startsWith('sn:'),
      sessions: new Set(),
    });
  }
  for (const e of campaignNpcs) {
    const k = normalizeGmaName(e.name);
    if (!k) continue;
    const cur = merged.get(k);
    if (!cur?.fromCampaign) {
      merged.set(k, {
        entityId: String(e.id),
        name: decodeGmaText(e.name ?? 'Sans nom'),
        description:
          e.description != null ? decodeGmaText(e.description) : (cur?.description ?? null),
        sortOrder: Number.isInteger(e.order) ? e.order : 0,
        fromCampaign: true,
        sessions: cur?.sessions ?? new Set(),
      });
    } else if (cur.entityId === String(e.id)) {
      // Same canonical row refreshed.
      cur.description = e.description != null ? decodeGmaText(e.description) : cur.description;
      if (Number.isInteger(e.order)) cur.sortOrder = e.order;
    }
  }
  for (const { sessionId, npcs } of perSession) {
    for (const sn of npcs) {
      const k = normalizeGmaName(sn.name);
      if (!k) continue;
      let cur = merged.get(k);
      if (!cur) {
        cur = {
          entityId: `sn:${k.replace(/ /g, '-')}`,
          name: decodeGmaText(sn.name ?? 'Sans nom'),
          description: null,
          // Session-derived rows sort after the campaign cast.
          sortOrder: 1000,
          fromCampaign: false,
          sessions: new Set(),
        };
        merged.set(k, cur);
      }
      cur.sessions.add(sessionId);
      const desc = sn.description != null ? decodeGmaText(sn.description) : null;
      if (
        desc &&
        (!cur.description || (!cur.fromCampaign && desc.length > cur.description.length))
      ) {
        cur.description = desc;
      }
    }
  }

  const fetchedAt = nowIso();
  getDb().transaction(() => {
    const drizzle = getDrizzle();
    drizzle.delete(gmaEntities).where(eq(gmaEntities.partyId, partyId)).run();
    for (const m of merged.values()) {
      drizzle
        .insert(gmaEntities)
        .values({
          partyId,
          entityId: m.entityId,
          name: m.name,
          description: m.description,
          type: null,
          sortOrder: m.sortOrder,
        })
        .run();
    }
    // --- Id-migration sweep (see doc comment) ---
    const liveIds = new Set(Array.from(merged.values(), (m) => m.entityId));
    const snTargetById = new Map<string, string>();
    for (const [k, m] of merged) snTargetById.set(`sn:${k.replace(/ /g, '-')}`, m.entityId);
    const knownIds = new Set<string>();
    for (const rows of [
      drizzle
        .select({ id: gmaEntitySessions.entityId })
        .from(gmaEntitySessions)
        .where(eq(gmaEntitySessions.partyId, partyId))
        .all(),
      drizzle
        .select({ id: gmaNpcLinks.gmaEntityId })
        .from(gmaNpcLinks)
        .where(eq(gmaNpcLinks.partyId, partyId))
        .all(),
      drizzle
        .select({ id: gmaEntityDiscards.entityId })
        .from(gmaEntityDiscards)
        .where(eq(gmaEntityDiscards.partyId, partyId))
        .all(),
    ] as any[][]) {
      for (const row of rows) knownIds.add(row.id);
    }
    for (const oldId of knownIds) {
      if (liveIds.has(oldId)) continue;
      const newId = oldId.startsWith('sn:') ? (snTargetById.get(oldId) ?? null) : null;
      if (newId) {
        // INSERT OR IGNORE, then drop the old rows: a PK/unique hit means
        // the surviving id already carries that row (e.g. the npc was
        // re-linked by hand after the promotion) — keep it, delete the dup.
        drizzle.run(sql`
          INSERT OR IGNORE INTO gma_entity_sessions (party_id, entity_id, session_id)
          SELECT party_id, ${newId}, session_id FROM gma_entity_sessions
          WHERE party_id = ${partyId} AND entity_id = ${oldId}
        `);
        drizzle.run(sql`
          INSERT OR IGNORE INTO gma_npc_links
            (party_id, npc_id, gma_entity_id, linked_by_user_id, description_hash, last_pull_at, created_at)
          SELECT party_id, npc_id, ${newId}, linked_by_user_id, description_hash, last_pull_at, created_at
          FROM gma_npc_links WHERE party_id = ${partyId} AND gma_entity_id = ${oldId}
        `);
        drizzle.run(sql`
          INSERT OR IGNORE INTO gma_entity_discards (party_id, entity_id, discarded_by_user_id, created_at)
          SELECT party_id, ${newId}, discarded_by_user_id, created_at
          FROM gma_entity_discards WHERE party_id = ${partyId} AND entity_id = ${oldId}
        `);
      }
      drizzle
        .delete(gmaEntitySessions)
        .where(and(eq(gmaEntitySessions.partyId, partyId), eq(gmaEntitySessions.entityId, oldId)))
        .run();
      drizzle
        .delete(gmaNpcLinks)
        .where(and(eq(gmaNpcLinks.partyId, partyId), eq(gmaNpcLinks.gmaEntityId, oldId)))
        .run();
      drizzle
        .delete(gmaEntityDiscards)
        .where(and(eq(gmaEntityDiscards.partyId, partyId), eq(gmaEntityDiscards.entityId, oldId)))
        .run();
    }
    // Only the sessions just processed are re-derived; already-processed
    // sessions keep their rows (and disappeared sessions' rows are filtered
    // out at read time by the ordinal join).
    if (freshIds.length > 0) {
      drizzle
        .delete(gmaEntitySessions)
        .where(
          and(
            eq(gmaEntitySessions.partyId, partyId),
            inArray(gmaEntitySessions.sessionId, freshIds),
          ),
        )
        .run();
      for (const m of merged.values()) {
        for (const sessionId of m.sessions) {
          drizzle
            .insert(gmaEntitySessions)
            .values({ partyId, entityId: m.entityId, sessionId })
            .onConflictDoNothing()
            .run();
        }
      }
      for (const sessionId of freshIds) {
        drizzle
          .update(gmaSessions)
          .set({ npcsFetchedAt: fetchedAt })
          .where(and(eq(gmaSessions.partyId, partyId), eq(gmaSessions.sessionId, sessionId)))
          .run();
      }
    }
    drizzle
      .update(partyGmaLinks)
      .set({ entitiesFetchedAt: fetchedAt, updatedAt: fetchedAt })
      .where(eq(partyGmaLinks.partyId, partyId))
      .run();
  })();
  return fetchedAt;
}

function entityFromCache(partyId: number, entityId: string): any | null {
  return (
    getDrizzle()
      .select(cols(gmaEntities))
      .from(gmaEntities)
      .where(and(eq(gmaEntities.partyId, partyId), eq(gmaEntities.entityId, entityId)))
      .get() ?? null
  );
}

/**
 * Entity by id, warming the cache once if it was never synced — same
 * robustness as the recap route (a POST can legitimately arrive before any
 * GET ever listed the rail). A synced cache that lacks the id is a genuine
 * miss and stays null.
 */
export async function resolveEntity(
  partyId: number,
  link: any,
  entityId: string,
): Promise<any | null> {
  const entity = entityFromCache(partyId, entityId);
  if (entity) return entity;
  if (!link || link.entities_fetched_at) return null;
  const key = resolveLinkKey(link);
  if (!key) return null;
  try {
    await syncEntities(partyId, link, key);
  } catch {
    return null;
  }
  return entityFromCache(partyId, entityId);
}
