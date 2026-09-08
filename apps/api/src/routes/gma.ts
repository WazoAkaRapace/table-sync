/**
 * GM Assistant integration routes.
 *
 * Two halves:
 * - Account (per user): store/validate/delete the GMA API key. The key lives
 *   server-side only, encrypted at rest — payloads carry a masked email.
 * - Party: link a group to a GMA campaign (existing, or the one-time INIT
 *   that creates campaign + selected characters FROM the group), the
 *   GM-triggered character resync (upsert batch — deletes are always a
 *   dedicated explicit gesture), and the member-facing sessions/recaps
 *   chronicle served from the SQLite cache (stale-on-error: a GMA outage
 *   degrades to a readable-but-old chronicle, never a player-facing 5xx).
 *
 * All upstream calls go through src/gma/client.ts and resolve the key of the
 * user who created the link (linked_by) — except the campaigns picker, which
 * shows the CALLING GM's own campaigns.
 */

import { createHash } from 'node:crypto';
import type {
  GmaInitPayload,
  GmaLinkCampaignPayload,
  GmaLinkEntityPayload,
  GmaPullEntityPayload,
  GmaSaveKeyPayload,
  GmaSyncCharactersPayload,
} from '@table-sync/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import {
  characters,
  gmaEntities,
  gmaEntityDiscards,
  gmaEntitySessions,
  gmaMoments,
  gmaNpcLinks,
  gmaPcLinks,
  gmaRecaps,
  gmaSessions,
  npcs,
  parties,
  partyGmaLinks,
  userGmaLinks,
  users,
} from '../db/schema.ts';
import {
  decryptSecret,
  encryptSecret,
  GmaError,
  gmaCacheTtlMs,
  gmaErrorToResponse,
  gmaListAll,
  gmaRequest,
  maskEmail,
} from '../gma/client.ts';
import { bus } from '../sync/bus.ts';
import { attachCharacterClasses, isPartyGM, isPartyMember, requireUser } from './helpers.ts';
import { apiMsg } from './messages.ts';
import { mapNpc } from './npcs.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nowIso(): string {
  return new Date().toISOString();
}

/** Cache marker still inside the TTL. */
function isFresh(marker: string | null | undefined): boolean {
  if (!marker) return false;
  const t = Date.parse(marker);
  return Number.isFinite(t) && Date.now() - t < gmaCacheTtlMs();
}

// ---------- local state helpers ----------

function getUserKeyRow(userId: number): any | null {
  return (
    getDrizzle()
      .select(cols(userGmaLinks))
      .from(userGmaLinks)
      .where(eq(userGmaLinks.userId, userId))
      .get() ?? null
  );
}

/** Decrypt a stored key; null when absent or unreadable (rotated secret). */
function decryptUserKey(row: any | null): string | null {
  if (!row) return null;
  try {
    return decryptSecret(row.api_key_enc);
  } catch {
    return null;
  }
}

function getPartyLink(partyId: number): any | null {
  return (
    getDrizzle()
      .select(cols(partyGmaLinks))
      .from(partyGmaLinks)
      .where(eq(partyGmaLinks.partyId, partyId))
      .get() ?? null
  );
}

/** The key that serves a linked party: the linking GM's stored key. */
function resolveLinkKey(link: any): string | null {
  return decryptUserKey(getUserKeyRow(link.linked_by_user_id));
}

function emitGma(
  partyId: number,
  actorUserId: number,
  action: 'link' | 'unlink' | 'init' | 'sync' | 'entity',
): void {
  bus.emitChange({ type: 'gma:change', partyId, action, actorUserId });
}

/** Auth + membership + GM door for party-scoped GMA routes. */
function requirePartyGM(req: FastifyRequest, reply: FastifyReply, partyId: number): boolean {
  const userId = requireUser(req, reply);
  if (userId === null) return false;
  if (!Number.isInteger(partyId) || partyId <= 0) {
    reply.code(400).send({
      error: apiMsg(req, 'bad_request'),
      message: apiMsg(req, 'Identifiant de groupe invalide.'),
    });
    return false;
  }
  if (!isPartyMember(partyId, userId)) {
    reply.code(403).send({
      error: apiMsg(req, 'not a member'),
      message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
    });
    return false;
  }
  if (!isPartyGM(partyId, userId)) {
    reply.code(403).send({
      error: apiMsg(req, 'gm only'),
      message: apiMsg(req, 'Seul le MD peut gérer GM Assistant.'),
    });
    return false;
  }
  return true;
}

/** Any successful write proves full_access; insufficient_scope proves read. */
function noteScope(userId: number, err: unknown): void {
  const scope =
    err instanceof GmaError && err.status === 403 && err.code === 'insufficient_scope'
      ? 'read'
      : null;
  if (!scope) return;
  getDrizzle().update(userGmaLinks).set({ scope }).where(eq(userGmaLinks.userId, userId)).run();
}

// ---------- character shaping (init + resync payloads) ----------

function loadPartyCharacters(partyId: number): any[] {
  const rows = getDrizzle()
    .select({ ...cols(characters), owner_name: users.displayName })
    .from(characters)
    .innerJoin(users, eq(users.id, characters.ownerId))
    .where(eq(characters.partyId, partyId))
    .orderBy(sql`${characters.name} COLLATE NOCASE ASC`)
    .all() as any[];
  attachCharacterClasses(rows);
  return rows;
}

/** 'Guerrier niveau 3' — or 'Guerrier 5 / Roublard 2' when multiclassed. */
function classSummary(row: any): string {
  const lines: any[] = row._classes ?? [];
  if (lines.length === 1) {
    return `${lines[0].class_key} niveau ${lines[0].level}`;
  }
  if (lines.length > 1) {
    return lines.map((c: any) => `${c.class_key} ${c.level}`).join(' / ');
  }
  return row.character_class ? `${row.character_class} niveau ${row.level}` : `Niveau ${row.level}`;
}

/** GMA rejects longer descriptions (openapi maxLength 6000). */
const GMA_DESCRIPTION_MAX = 6000;

/** Quick identity fields → one readable line ('femme · 32 ans · peau pâle'). */
function physicalLine(row: any): string {
  const bits: string[] = [];
  for (const key of ['sex', 'age', 'height', 'weight']) {
    const v = String(row[key] ?? '').trim();
    if (v) bits.push(v);
  }
  for (const [key, label] of [
    ['skin', 'peau'],
    ['eyes', 'yeux'],
    ['hair', 'cheveux'],
  ] as const) {
    const v = String(row[key] ?? '').trim();
    if (v) bits.push(`${label} ${v[0].toLowerCase()}${v.slice(1)}`);
  }
  return bits.join(' · ');
}

/**
 * GMA player characters expose a single 6000-char description, so the sheet's
 * whole identity composes into it: class headline + alignement, apparence,
 * personnalité, histoire. Labels mirror the Description tab's vocabulary.
 */
function gmaDescription(row: any): string {
  const blocks: string[] = [];
  const headline = [classSummary(row), String(row.alignment ?? '').trim()]
    .filter(Boolean)
    .join(' · ');
  if (headline) blocks.push(headline);

  const physical = physicalLine(row);
  const appearance = String(row.appearance ?? '').trim();
  if (physical || appearance) {
    const head = physical ? `Apparence : ${physical}` : 'Apparence :';
    blocks.push([head, appearance].filter(Boolean).join('\n'));
  }

  const personality = (
    [
      ['Personnalité', row.personality_traits],
      ['Idéaux', row.ideals],
      ['Liens', row.bonds],
      ['Défauts', row.flaws],
    ] as const
  ).filter(([, v]) => String(v ?? '').trim());
  if (personality.length > 0) {
    blocks.push(personality.map(([label, v]) => `${label} : ${String(v).trim()}`).join('\n'));
  }

  const backstory = String(row.backstory ?? '').trim();
  if (backstory) blocks.push(`Histoire :\n${backstory}`);

  const text = blocks.join('\n\n');
  return text.length > GMA_DESCRIPTION_MAX ? `${text.slice(0, GMA_DESCRIPTION_MAX - 1)}…` : text;
}

/** What the character SHOULD look like as a GMA player character. */
function desiredPc(row: any): { name: string; played_by: string; description: string } {
  return { name: row.name, played_by: row.owner_name, description: gmaDescription(row) };
}

// ---------- sessions / recaps cache ----------

function cachedSessions(partyId: number): any[] {
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
async function syncSessions(partyId: number, link: any, key: string): Promise<string> {
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
          title: String(s.title ?? 'Séance sans titre'),
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

function cachedSessionRow(partyId: number, sessionId: string): any | null {
  return (
    getDrizzle()
      .select(cols(gmaSessions))
      .from(gmaSessions)
      .where(and(eq(gmaSessions.partyId, partyId), eq(gmaSessions.sessionId, sessionId)))
      .get() ?? null
  );
}

function cachedRecaps(partyId: number, sessionId: string): any[] {
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

function cachedMoments(partyId: number, sessionId: string): any[] {
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
async function syncRecaps(
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
          text: String(e.text ?? ''),
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
          description: String(m.description ?? ''),
          speaker: m.speaker ?? null,
          context: m.context ?? null,
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

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function cachedEntities(partyId: number): any[] {
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
const NON_NPC_ENTITY_TYPES = new Set([
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
 * Refetch the campaign's NPCs into the cache (replace-all, one transaction,
 * party-level freshness marker on the link row). Verified against the GMA
 * spec (backend.gmassistant.app/v1/openapi.yaml): campaign NPCs live at
 * GET /campaigns/{id}/npcs — descriptions are NOT in the sparse default,
 * hence the explicit fields. « Vu en séance » has no direct link upstream:
 * session NPCs are separate records (their own ids), matched BY NAME — one
 * call per session, once per session (npcs_fetched_at), so a busy campaign
 * costs nothing at steady state. Throws GmaError upstream on a list failure
 * (cache intact); a single session's failure only postpones its appearances
 * to the next TTL. Throws GmaError upstream on failure (cache intact).
 */
async function syncEntities(partyId: number, link: any, key: string): Promise<string> {
  // Appearances lean on the sessions cache — make sure it exists even when
  // the chronicle was never opened (best-effort, ordinals degrade without it).
  if (cachedSessions(partyId).length === 0) {
    try {
      await syncSessions(partyId, link, key);
    } catch {
      /* no sessions → no appearances, the rail still serves */
    }
  }
  const list = await gmaListAll<any>(key, `/campaigns/${link.gma_campaign_id}/npcs`, {
    fields: 'id,name,description,order',
    limit: '500',
  });
  const fetchedAt = nowIso();
  const byNormName = new Map<string, string[]>();
  for (const e of list) {
    const k = normalizeGmaName(e.name);
    if (!k) continue;
    const ids = byNormName.get(k) ?? [];
    ids.push(String(e.id));
    byNormName.set(k, ids);
  }

  // Sessions never processed → fetch their NPC lists, then mark them done.
  const fresh = cachedSessions(partyId).filter((s: any) => !s.npcs_fetched_at);
  const freshIds: string[] = [];
  const appearances: Array<{ entityId: string; sessionId: string }> = [];
  for (const s of fresh) {
    const sessionId = String(s.session_id);
    try {
      const sessionNpcs = await gmaListAll<any>(
        key,
        `/campaigns/${link.gma_campaign_id}/sessions/${sessionId}/npcs`,
        { fields: 'id,name', limit: '500' },
      );
      for (const sn of sessionNpcs) {
        for (const entityId of byNormName.get(normalizeGmaName(sn.name)) ?? []) {
          appearances.push({ entityId, sessionId });
        }
      }
      freshIds.push(sessionId);
    } catch {
      // Unmarked on purpose — retried on the next TTL window.
    }
  }

  getDb().transaction(() => {
    const drizzle = getDrizzle();
    drizzle.delete(gmaEntities).where(eq(gmaEntities.partyId, partyId)).run();
    for (const e of list) {
      drizzle
        .insert(gmaEntities)
        .values({
          partyId,
          entityId: String(e.id),
          name: String(e.name ?? 'Sans nom'),
          description: e.description ?? null,
          type: e.type ?? null,
          sortOrder: Number.isInteger(e.order) ? e.order : 0,
        })
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
    }
    for (const a of appearances) {
      drizzle
        .insert(gmaEntitySessions)
        .values({ partyId, entityId: a.entityId, sessionId: a.sessionId })
        .onConflictDoNothing()
        .run();
    }
    for (const sessionId of freshIds) {
      drizzle
        .update(gmaSessions)
        .set({ npcsFetchedAt: fetchedAt })
        .where(and(eq(gmaSessions.partyId, partyId), eq(gmaSessions.sessionId, sessionId)))
        .run();
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
async function resolveEntity(partyId: number, link: any, entityId: string): Promise<any | null> {
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

/** NPC visibility for a member — mirrors the npcs list route's filter. */
function npcVisibleToUser(npc: any, userId: number, gm: boolean): boolean {
  return gm || !!npc.is_shared || npc.created_by === userId;
}

/** Content-edit rights on an NPC — mirrors the npcs PATCH door. */
function mayEditNpcContent(npc: any, userId: number, gm: boolean): boolean {
  return npc.created_by === userId || gm || (!!npc.is_shared && !!npc.allow_member_edit);
}

/** GMA text onto an NPC description — append keeps the player's own words. */
function appendedDescription(current: string | null, gmaText: string): string {
  const own = String(current ?? '').trim();
  return own ? `${own}\n\n${gmaText}` : gmaText;
}

export async function gmaRoutes(app: FastifyInstance) {
  // =================== Account (per user) ===================

  app.get('/gma/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = requireUser(req, reply);
    if (userId === null) return;
    const row = getUserKeyRow(userId);
    return reply.send({
      linked: !!row,
      account: row
        ? {
            email: maskEmail(row.gma_email),
            scope: row.scope ?? null,
            validatedAt: row.validated_at,
          }
        : null,
    });
  });

  app.put(
    '/gma/key',
    async (req: FastifyRequest<{ Body: GmaSaveKeyPayload }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const { apiKey } = req.body || { apiKey: '' };
      if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 500) {
        return reply.code(400).send({
          error: apiMsg(req, 'invalid_key'),
          message: apiMsg(req, 'Colle la clé GM Assistant (elle commence par « gma_ »).'),
        });
      }
      const trimmed = apiKey.trim();
      try {
        const account = await gmaRequest<any>(trimmed, 'GET', '/account');
        const validatedAt = nowIso();
        getDrizzle()
          .insert(userGmaLinks)
          .values({
            userId,
            apiKeyEnc: encryptSecret(trimmed),
            gmaAccountId: account?.id ? String(account.id) : null,
            gmaEmail: account?.email ? String(account.email) : null,
            scope: null,
            validatedAt,
          })
          .onConflictDoUpdate({
            target: userGmaLinks.userId,
            set: {
              apiKeyEnc: encryptSecret(trimmed),
              gmaAccountId: account?.id ? String(account.id) : null,
              gmaEmail: account?.email ? String(account.email) : null,
              scope: null,
              validatedAt,
            },
          })
          .run();
        return reply.send({
          ok: true,
          account: { email: maskEmail(account?.email), scope: null, validatedAt },
        });
      } catch (err) {
        if (err instanceof GmaError && err.status === 401) {
          return reply.code(401).send({
            error: apiMsg(req, 'invalid_key'),
            message: apiMsg(req, 'GM Assistant refuse cette clé (invalide ou révoquée).'),
          });
        }
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
    },
  );

  app.delete('/gma/key', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = requireUser(req, reply);
    if (userId === null) return;
    getDrizzle().delete(userGmaLinks).where(eq(userGmaLinks.userId, userId)).run();
    return reply.send({ ok: true });
  });

  // =================== Party link ===================

  app.get(
    '/parties/:partyId/gma/link',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) return reply.send({ linked: false, campaign: null, accountOk: false });
      return reply.send({
        linked: true,
        campaign: {
          id: link.gma_campaign_id,
          title: link.campaign_title,
          linkedAt: link.created_at,
        },
        accountOk: !!decryptUserKey(getUserKeyRow(link.linked_by_user_id)),
      });
    },
  );

  app.get(
    '/parties/:partyId/gma/campaigns',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      const key = decryptUserKey(getUserKeyRow(userId));
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Enregistre d’abord ta clé GM Assistant ci-dessus.'),
        });
      }
      try {
        const list = await gmaListAll<any>(key, '/campaigns', { limit: '500' });
        return reply.send({
          campaigns: list.map((c) => ({
            id: String(c.id),
            title: String(c.title ?? 'Sans titre'),
            createdAt: c.created_at ?? null,
            updatedAt: c.updated_at ?? null,
          })),
        });
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
    },
  );

  app.post(
    '/parties/:partyId/gma/link',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: GmaLinkCampaignPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      if (getPartyLink(partyId)) {
        return reply.code(409).send({
          error: apiMsg(req, 'already_linked'),
          message: apiMsg(req, 'Ce groupe est déjà lié à une campagne GM Assistant.'),
        });
      }
      const key = decryptUserKey(getUserKeyRow(userId));
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Enregistre d’abord ta clé GM Assistant ci-dessus.'),
        });
      }
      const { campaignId } = req.body || { campaignId: '' };
      if (typeof campaignId !== 'string' || !UUID_RE.test(campaignId)) {
        return reply.code(400).send({
          error: apiMsg(req, 'invalid_campaign'),
          message: apiMsg(req, 'Identifiant de campagne invalide.'),
        });
      }
      let campaign: any;
      try {
        campaign = await gmaRequest<any>(key, 'GET', `/campaigns/${campaignId}`, {
          query: { fields: 'id,title' },
        });
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
      try {
        getDrizzle()
          .insert(partyGmaLinks)
          .values({
            partyId,
            gmaCampaignId: campaignId,
            campaignTitle: String(campaign?.title ?? campaignId),
            linkedByUserId: userId,
          })
          .run();
      } catch {
        // UNIQUE hit: the campaign belongs to another group (or a concurrent link).
        return reply.code(409).send({
          error: apiMsg(req, 'campaign_taken'),
          message: apiMsg(req, 'Cette campagne GM Assistant est déjà liée à un autre groupe.'),
        });
      }
      emitGma(partyId, userId, 'link');
      return reply.code(201).send({
        ok: true,
        campaign: { id: campaignId, title: String(campaign?.title ?? campaignId) },
      });
    },
  );

  app.delete(
    '/parties/:partyId/gma/link',
    async (req: FastifyRequest<{ Params: { partyId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      if (!getPartyLink(partyId)) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
        });
      }
      getDb().transaction(() => {
        const drizzle = getDrizzle();
        drizzle.delete(partyGmaLinks).where(eq(partyGmaLinks.partyId, partyId)).run();
        drizzle.delete(gmaSessions).where(eq(gmaSessions.partyId, partyId)).run();
        drizzle.delete(gmaRecaps).where(eq(gmaRecaps.partyId, partyId)).run();
        drizzle.delete(gmaMoments).where(eq(gmaMoments.partyId, partyId)).run();
        drizzle.delete(gmaPcLinks).where(eq(gmaPcLinks.partyId, partyId)).run();
        drizzle.delete(gmaEntities).where(eq(gmaEntities.partyId, partyId)).run();
        drizzle.delete(gmaEntitySessions).where(eq(gmaEntitySessions.partyId, partyId)).run();
        drizzle.delete(gmaEntityDiscards).where(eq(gmaEntityDiscards.partyId, partyId)).run();
        // CASCADE would drop these with the party anyway — explicit keeps the
        // purge total even if a future schema change relaxes the FK.
        drizzle.delete(gmaNpcLinks).where(eq(gmaNpcLinks.partyId, partyId)).run();
      })();
      emitGma(partyId, userId, 'unlink');
      return reply.send({ ok: true });
    },
  );

  // =================== Init — create the campaign FROM the group ===================

  app.post(
    '/parties/:partyId/gma/init',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: GmaInitPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      if (getPartyLink(partyId)) {
        return reply.code(409).send({
          error: apiMsg(req, 'already_linked'),
          message: apiMsg(req, 'Ce groupe est déjà lié à une campagne GM Assistant.'),
        });
      }
      const key = decryptUserKey(getUserKeyRow(userId));
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Enregistre d’abord ta clé GM Assistant ci-dessus.'),
        });
      }
      const party = getDrizzle()
        .select(cols(parties))
        .from(parties)
        .where(eq(parties.id, partyId))
        .get() as any;
      if (!party) {
        return reply
          .code(404)
          .send({ error: apiMsg(req, 'not_found'), message: apiMsg(req, 'Groupe introuvable.') });
      }
      const requested = Array.isArray(req.body?.characterIds)
        ? new Set(req.body.characterIds.filter((n: unknown) => Number.isInteger(n)))
        : new Set<number>();
      // Hidden (secret prep) characters stay off GM Assistant — syncing them
      // would defeat the secrecy. The GM unhides first if they want one in.
      const selected = loadPartyCharacters(partyId).filter((c) => requested.has(c.id) && !c.hidden);

      let campaign: any;
      try {
        campaign = await gmaRequest<any>(key, 'POST', '/campaigns', {
          body: {
            title: party.name,
            ttrpg_system: 'dungeons and dragons',
            ttrpg_system_edition: '5e',
          },
        });
      } catch (err) {
        noteScope(userId, err);
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
      getDrizzle()
        .update(userGmaLinks)
        .set({ scope: 'full_access' })
        .where(eq(userGmaLinks.userId, userId))
        .run();

      const created: any[] = [];
      const failed: any[] = [];
      for (const char of selected) {
        try {
          const pc = await gmaRequest<any>(
            key,
            'POST',
            `/campaigns/${campaign.id}/player-characters`,
            { body: desiredPc(char) },
          );
          getDrizzle()
            .insert(gmaPcLinks)
            .values({
              partyId,
              characterId: char.id,
              gmaPcId: String(pc.id),
              nameAtSync: char.name,
            })
            .run();
          created.push({
            characterId: char.id,
            name: char.name,
            playedBy: char.owner_name,
            gmaPcId: String(pc.id),
          });
        } catch (err) {
          failed.push({
            name: char.name,
            reason: err instanceof GmaError ? err.message : 'GM Assistant est injoignable',
          });
          // Key-level failures (auth/scope/rate) would fail every remaining
          // call identically — stop the batch and report.
          if (err instanceof GmaError && [401, 403, 429].includes(err.status)) break;
        }
      }

      getDrizzle()
        .insert(partyGmaLinks)
        .values({
          partyId,
          gmaCampaignId: String(campaign.id),
          campaignTitle: String(campaign.title ?? party.name),
          linkedByUserId: userId,
        })
        .run();
      emitGma(partyId, userId, 'init');
      return reply.code(201).send({
        campaign: { id: String(campaign.id), title: String(campaign.title ?? party.name) },
        created,
        failed,
      });
    },
  );

  // =================== Character resync (upsert batch) ===================

  app.post(
    '/parties/:partyId/gma/characters/sync',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: GmaSyncCharactersPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
        });
      }
      const key = resolveLinkKey(link);
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Clé GM Assistant expirée — le MD doit la ressaisir.'),
        });
      }
      const payload = req.body ?? {};
      const wanted = new Set(
        Array.isArray(payload.createCharacterIds)
          ? payload.createCharacterIds.filter((n: unknown) => Number.isInteger(n))
          : [],
      );
      const dryRun = payload.dryRun === true;
      const campaignId = link.gma_campaign_id;

      let gmaPcs: any[];
      try {
        gmaPcs = await gmaListAll<any>(key, `/campaigns/${campaignId}/player-characters`, {
          fields: 'id,name,played_by,description',
          limit: '500',
        });
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }

      const chars = loadPartyCharacters(partyId);
      const charById = new Map(chars.map((c) => [c.id as number, c]));
      const linkRows = getDrizzle()
        .select(cols(gmaPcLinks))
        .from(gmaPcLinks)
        .where(eq(gmaPcLinks.partyId, partyId))
        .all() as any[];
      const gmaById = new Map(gmaPcs.map((p) => [String(p.id), p]));
      const linkedCharIds = new Set(
        linkRows.filter((l) => l.character_id !== null).map((l) => l.character_id),
      );

      const toCreate: any[] = [];
      const toUpdate: any[] = [];
      const orphans: any[] = [];
      const gmaOnly: any[] = [];
      let upToDate = 0;
      // Link rows whose GMA PC vanished (deleted over there): their character
      // becomes a creation candidate again — apply deletes the stale row first.
      const recreateByCharId = new Map<number, any>();

      for (const c of chars) {
        if (c.hidden || linkedCharIds.has(c.id)) continue;
        toCreate.push({
          characterId: c.id,
          name: c.name,
          playedBy: c.owner_name,
          description: gmaDescription(c),
        });
      }
      for (const l of linkRows) {
        const char = l.character_id !== null ? charById.get(l.character_id) : undefined;
        if (!char) {
          if (l.character_id === null || !charById.has(l.character_id)) {
            orphans.push({ gmaPcId: l.gma_pc_id, nameAtSync: l.name_at_sync });
          }
          continue;
        }
        const gma = gmaById.get(l.gma_pc_id);
        if (!gma) {
          recreateByCharId.set(char.id, l);
          toCreate.push({
            characterId: char.id,
            name: char.name,
            playedBy: char.owner_name,
            description: gmaDescription(char),
          });
          continue;
        }
        const want = desiredPc(char);
        const changes: Array<{ field: string; from: string; to: string }> = [];
        for (const field of ['name', 'played_by', 'description'] as const) {
          const from = String(gma[field] ?? '');
          if (from !== want[field]) changes.push({ field, from, to: want[field] });
        }
        if (changes.length > 0) {
          toUpdate.push({
            characterId: char.id,
            name: char.name,
            gmaPcId: l.gma_pc_id,
            changes,
          });
        } else {
          upToDate++;
        }
      }
      for (const pc of gmaPcs) {
        const id = String(pc.id);
        if (!linkRows.some((l) => l.gma_pc_id === id)) {
          gmaOnly.push({ gmaPcId: id, name: pc.name ?? null });
        }
      }

      const diff = { toCreate, toUpdate, orphans, gmaOnly, upToDate };
      if (dryRun) {
        return reply.send({ ...diff, applied: false, created: [], updated: [], failed: [] });
      }

      const created: any[] = [];
      const updated: any[] = [];
      const failed: any[] = [];
      const isFatal = (err: unknown) =>
        err instanceof GmaError && [401, 403, 429].includes(err.status);

      for (const u of toUpdate) {
        const patch: Record<string, string> = {};
        for (const ch of u.changes) patch[ch.field] = ch.to;
        try {
          await gmaRequest(
            key,
            'PATCH',
            `/campaigns/${campaignId}/player-characters/${u.gmaPcId}`,
            {
              body: patch,
              contentType: 'application/merge-patch+json',
            },
          );
          updated.push({ characterId: u.characterId, name: u.name });
        } catch (err) {
          noteScope(userId, err);
          failed.push({
            name: u.name,
            action: 'update',
            reason: err instanceof GmaError ? err.message : 'GM Assistant est injoignable',
          });
          if (isFatal(err)) break;
        }
      }
      for (const c of toCreate) {
        if (!wanted.has(c.characterId)) continue;
        const staleLink = recreateByCharId.get(c.characterId);
        try {
          const pc = await gmaRequest<any>(
            key,
            'POST',
            `/campaigns/${campaignId}/player-characters`,
            {
              body: { name: c.name, played_by: c.playedBy, description: c.description },
            },
          );
          getDb().transaction(() => {
            const drizzle = getDrizzle();
            if (staleLink) {
              drizzle.delete(gmaPcLinks).where(eq(gmaPcLinks.id, staleLink.id)).run();
            }
            drizzle
              .insert(gmaPcLinks)
              .values({
                partyId,
                characterId: c.characterId,
                gmaPcId: String(pc.id),
                nameAtSync: c.name,
              })
              .run();
          })();
          created.push({ characterId: c.characterId, name: c.name, gmaPcId: String(pc.id) });
        } catch (err) {
          noteScope(userId, err);
          failed.push({
            name: c.name,
            action: 'create',
            reason: err instanceof GmaError ? err.message : 'GM Assistant est injoignable',
          });
          if (isFatal(err)) break;
        }
      }

      if (created.length + updated.length > 0) {
        getDrizzle()
          .update(userGmaLinks)
          .set({ scope: 'full_access' })
          .where(eq(userGmaLinks.userId, link.linked_by_user_id))
          .run();
        getDrizzle()
          .update(partyGmaLinks)
          .set({ updatedAt: nowIso() })
          .where(eq(partyGmaLinks.partyId, partyId))
          .run();
        emitGma(partyId, userId, 'sync');
      }
      return reply.send({ ...diff, applied: true, created, updated, failed });
    },
  );

  /** Explicit orphan delete — the ONLY delete we ever issue on GMA. */
  app.delete(
    '/parties/:partyId/gma/characters/:gmaPcId',
    async (
      req: FastifyRequest<{ Params: { partyId: string; gmaPcId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!requirePartyGM(req, reply, partyId)) return;
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
        });
      }
      const row = getDrizzle()
        .select(cols(gmaPcLinks))
        .from(gmaPcLinks)
        .where(and(eq(gmaPcLinks.partyId, partyId), eq(gmaPcLinks.gmaPcId, req.params.gmaPcId)))
        .get() as any;
      if (!row) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_pc'),
          message: apiMsg(req, 'Ce personnage n’est pas géré par la synchronisation GM Assistant.'),
        });
      }
      const key = resolveLinkKey(link);
      if (!key) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_key'),
          message: apiMsg(req, 'Clé GM Assistant expirée — le MD doit la ressaisir.'),
        });
      }
      try {
        await gmaRequest(
          key,
          'DELETE',
          `/campaigns/${link.gma_campaign_id}/player-characters/${req.params.gmaPcId}`,
        );
      } catch (err) {
        const { status, message } = gmaErrorToResponse(err);
        return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
      }
      getDrizzle().delete(gmaPcLinks).where(eq(gmaPcLinks.id, row.id)).run();
      emitGma(partyId, userId, 'sync');
      return reply.send({ ok: true });
    },
  );

  // =================== Chronicle (sessions + recaps, cache-first) ===================

  app.get(
    '/parties/:partyId/gma/sessions',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Querystring: { refresh?: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      let rows = cachedSessions(partyId);
      const wantRefresh = req.query?.refresh === '1' && isPartyGM(partyId, userId);
      let stale = false;
      let fetchedAt: string | null = link.sessions_fetched_at ?? null;
      if (!isFresh(fetchedAt) || wantRefresh) {
        const key = resolveLinkKey(link);
        if (!key) {
          // Expired/missing key: we can't vouch for freshness anymore — serve
          // whatever cache we have, flagged (even an empty list: "fresh empty"
          // would be a lie).
          stale = true;
        } else {
          try {
            fetchedAt = await syncSessions(partyId, link, key);
            rows = cachedSessions(partyId);
          } catch (err) {
            if (rows.length === 0) {
              const { status, message } = gmaErrorToResponse(err);
              return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
            }
            stale = true; // stale-on-error: keep the table reading
          }
        }
      }
      return reply.send({
        sessions: rows.map((r) => ({
          id: r.session_id,
          title: r.title,
          playedAt: r.played_at ?? null,
          order: r.sort_order,
        })),
        fetchedAt,
        stale,
      });
    },
  );

  app.get(
    '/parties/:partyId/gma/sessions/:sessionId/recap',
    async (
      req: FastifyRequest<{
        Params: { partyId: string; sessionId: string };
        Querystring: { refresh?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      const sessionId = String(req.params.sessionId ?? '');
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      let session = cachedSessionRow(partyId, sessionId);
      if (!session) {
        // Robustness: a recap asked before any sessions sync — sync once, then 404.
        const key = resolveLinkKey(link);
        if (key) {
          try {
            await syncSessions(partyId, link, key);
          } catch {
            /* fall through to the 404 below */
          }
          session = cachedSessionRow(partyId, sessionId);
        }
      }
      if (!session) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_session'),
          message: apiMsg(req, 'Séance inconnue dans la chronique — actualise la liste.'),
        });
      }
      let rows = cachedRecaps(partyId, sessionId);
      const wantRefresh = req.query?.refresh === '1' && isPartyGM(partyId, userId);
      let stale = false;
      if (!isFresh(session.recaps_fetched_at) || wantRefresh) {
        const key = resolveLinkKey(link);
        if (!key) {
          stale = true; // no rows yet + no key → empty chronicle entry, flagged
        } else {
          try {
            await syncRecaps(partyId, link, key, sessionId);
            rows = cachedRecaps(partyId, sessionId);
          } catch (err) {
            if (rows.length === 0 && wantRefresh) {
              const { status, message } = gmaErrorToResponse(err);
              return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
            }
            stale = true; // serve whatever cache we have
          }
        }
      }
      return reply.send({
        recaps: rows.map((r) => ({
          style: r.style,
          text: r.text,
          updatedAt: r.updated_at ?? null,
        })),
        moments: cachedMoments(partyId, sessionId).map((m) => ({
          id: m.moment_id,
          isQuote: !!m.is_quote,
          type: m.type ?? null,
          description: m.description,
          speaker: m.speaker ?? null,
          context: m.context ?? null,
        })),
        fetchedAt: session.recaps_fetched_at ?? null,
        stale,
      });
    },
  );

  // =================== Entities (« PNJ repérés » — member-facing rail) ===================
  //
  // Read-only upstream. Any member sees the assistant's catalogued NPCs,
  // imports the missing ones (shared NPC + link in one gesture) or links
  // them to NPCs already in the registry. Content flows ONLY through an
  // explicit gesture: import copies, link may append (if the actor may edit
  // the NPC), pull re-takes — local text is never silently overwritten.

  app.get(
    '/parties/:partyId/gma/entities',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Querystring: { refresh?: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      let rows = cachedEntities(partyId);
      const wantRefresh = req.query?.refresh === '1' && isPartyGM(partyId, userId);
      let stale = false;
      let fetchedAt: string | null = link.entities_fetched_at ?? null;
      if (!isFresh(fetchedAt) || wantRefresh) {
        const key = resolveLinkKey(link);
        if (!key) {
          stale = true; // expired/missing key — can't vouch for freshness
        } else {
          try {
            fetchedAt = await syncEntities(partyId, link, key);
            rows = cachedEntities(partyId);
          } catch (err) {
            if (rows.length === 0) {
              const { status, message } = gmaErrorToResponse(err);
              return reply.code(status).send({ error: apiMsg(req, 'gma'), message });
            }
            stale = true; // stale-on-error: the rail keeps working
          }
        }
      }

      // « Vu en séance » leans on the sessions cache (ordinals) — make sure it
      // exists even when nobody ever opened the chronicle. Best-effort: an
      // outage here only degrades the session refs, not the rail itself.
      if (!isFresh(link.sessions_fetched_at)) {
        const sessKey = resolveLinkKey(link);
        if (sessKey) {
          try {
            await syncSessions(partyId, link, sessKey);
          } catch {
            /* ordinals degrade — the rail still serves */
          }
        }
      }

      // Session ordinals (chronicle order) for « Vu en séance ».
      const sessRows = cachedSessions(partyId);
      const ordinalById = new Map<string, number>(sessRows.map((r, i) => [r.session_id, i + 1]));
      const appearances = new Map<string, string[]>();
      for (const a of getDrizzle()
        .select(cols(gmaEntitySessions))
        .from(gmaEntitySessions)
        .where(eq(gmaEntitySessions.partyId, partyId))
        .all() as any[]) {
        const list = appearances.get(a.entity_id) ?? [];
        list.push(a.session_id);
        appearances.set(a.entity_id, list);
      }
      // Links, visibility-filtered: an entity linked to an NPC the requester
      // cannot see is simply absent from their list (it is claimed, privately).
      const gm = isPartyGM(partyId, userId);
      const visibleLinks = new Map<string, any>();
      const hiddenEntityIds = new Set<string>();
      for (const l of getDrizzle()
        .select({
          ...cols(gmaNpcLinks),
          npc_name: npcs.name,
          npc_shared: npcs.isShared,
          npc_created_by: npcs.createdBy,
          linker_name: users.displayName,
        })
        .from(gmaNpcLinks)
        .innerJoin(npcs, eq(gmaNpcLinks.npcId, npcs.id))
        .innerJoin(users, eq(gmaNpcLinks.linkedByUserId, users.id))
        .where(eq(gmaNpcLinks.partyId, partyId))
        .all() as any[]) {
        if (!gm && !l.npc_shared && l.npc_created_by !== userId) {
          hiddenEntityIds.add(l.gma_entity_id);
          continue;
        }
        visibleLinks.set(l.gma_entity_id, l);
      }

      const sessById = new Map(sessRows.map((r) => [r.session_id, r]));
      // Party-wide discards (« Écarter ») — survive every cache refresh.
      const discardedIds = new Set(
        (
          getDrizzle()
            .select({ entityId: gmaEntityDiscards.entityId })
            .from(gmaEntityDiscards)
            .where(eq(gmaEntityDiscards.partyId, partyId))
            .all() as any[]
        ).map((d) => d.entityId),
      );
      const entities = rows
        .filter((e) => !e.type || !NON_NPC_ENTITY_TYPES.has(e.type))
        .filter((e) => !hiddenEntityIds.has(e.entity_id))
        .map((e) => {
          const l = visibleLinks.get(e.entity_id) ?? null;
          const sessions = (appearances.get(e.entity_id) ?? [])
            .filter((sid) => ordinalById.has(sid))
            .sort((a, b) => ordinalById.get(a)! - ordinalById.get(b)!)
            .map((sid) => {
              const s = sessById.get(sid)!;
              return {
                id: sid,
                ordinal: ordinalById.get(sid)!,
                title: s.title,
                playedAt: s.played_at ?? null,
              };
            });
          return {
            id: e.entity_id,
            name: e.name,
            description: e.description ?? null,
            type: e.type ?? null,
            sessions,
            discarded: discardedIds.has(e.entity_id),
            linkedNpc: l
              ? {
                  id: l.npc_id,
                  name: l.npc_name,
                  linkedByUserId: l.linked_by_user_id,
                  linkedByName: l.linker_name ?? '',
                  linkedAt: l.created_at,
                  lastPullAt: l.last_pull_at ?? null,
                  textPulled: !!l.description_hash,
                  descriptionUpdated:
                    !!l.description_hash &&
                    l.description_hash !== sha256Hex(String(e.description ?? '')),
                }
              : null,
          };
        });
      return reply.send({
        entities,
        campaignTitle: link.campaign_title,
        fetchedAt,
        stale,
      });
    },
  );

  /** Import: create the shared NPC from the entity + link, in one gesture. */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/import',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      const entity = await resolveEntity(partyId, link, String(req.params.entityId));
      if (!entity) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_entity'),
          message: apiMsg(
            req,
            'Entrée GM Assistant inconnue — actualise la liste des PNJ repérés.',
          ),
        });
      }
      if (
        getDrizzle()
          .select({ id: gmaNpcLinks.id })
          .from(gmaNpcLinks)
          .where(eq(gmaNpcLinks.gmaEntityId, entity.entity_id))
          .get()
      ) {
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      const description = entity.description ?? null;
      const now = nowIso();
      const drizzle = getDrizzle();
      let npcId: number;
      try {
        npcId = getDb().transaction(() => {
          const maxOrder =
            (
              drizzle
                .select({ m: sql<number | null>`max(${npcs.sortOrder})` })
                .from(npcs)
                .where(eq(npcs.partyId, partyId))
                .get() as any
            )?.m ?? 0;
          const { id } = drizzle
            .insert(npcs)
            .values({
              partyId,
              createdBy: userId,
              name: entity.name,
              description,
              // The table's defaults would read 'neutral' — an assistant-
              // catalogued NPC is met, not judged
              disposition: 'unknown',
              isShared: 1,
              allowMemberEdit: 0,
              sortOrder: maxOrder + 1,
            })
            .returning({ id: npcs.id })
            .get();
          drizzle
            .insert(gmaNpcLinks)
            .values({
              partyId,
              npcId: id,
              gmaEntityId: entity.entity_id,
              linkedByUserId: userId,
              descriptionHash: description ? sha256Hex(description) : null,
              lastPullAt: now,
            })
            .run();
          return id;
        })();
      } catch {
        // UNIQUE backstop on a concurrent import of the same entity.
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      emitGma(partyId, userId, 'entity');
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'custom-item',
        actorUserId: userId,
      });
      const row = drizzle
        .select({ ...cols(npcs), creator_name: users.displayName })
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(eq(npcs.id, npcId))
        .get();
      return reply.code(201).send({ npc: mapNpc(row, false), entityId: entity.entity_id });
    },
  );

  /** Link an entity to an NPC already in the registry — content untouched
   *  unless appendDescription is asked for (and the actor may edit the NPC). */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/link',
    async (
      req: FastifyRequest<{
        Params: { partyId: string; entityId: string };
        Body: GmaLinkEntityPayload;
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const link = getPartyLink(partyId);
      if (!link) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      const entity = await resolveEntity(partyId, link, String(req.params.entityId));
      if (!entity) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_entity'),
          message: apiMsg(
            req,
            'Entrée GM Assistant inconnue — actualise la liste des PNJ repérés.',
          ),
        });
      }
      const npcId = Number(req.body?.npcId);
      const npc = Number.isInteger(npcId)
        ? (getDrizzle()
            .select(cols(npcs))
            .from(npcs)
            .where(and(eq(npcs.id, npcId), eq(npcs.partyId, partyId)))
            .get() as any)
        : null;
      const gm = isPartyGM(partyId, userId);
      // 404 (not 403) on an invisible NPC — never confirm someone's private row
      if (!npc || !npcVisibleToUser(npc, userId, gm)) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_npc'),
          message: apiMsg(req, 'PNJ introuvable dans le registre de ce groupe.'),
        });
      }
      const wantAppend = req.body?.appendDescription === true && !!entity.description;
      if (wantAppend && !mayEditNpcContent(npc, userId, gm)) {
        return reply.code(403).send({
          error: apiMsg(req, 'cannot_append'),
          message: apiMsg(
            req,
            'Seuls le créateur, le MD ou un éditeur autorisé peuvent modifier la description. Tu peux lier sans l’ajouter, ou leur demander.',
          ),
        });
      }
      const drizzle = getDrizzle();
      if (
        drizzle
          .select({ id: gmaNpcLinks.id })
          .from(gmaNpcLinks)
          .where(eq(gmaNpcLinks.gmaEntityId, entity.entity_id))
          .get()
      ) {
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }
      if (
        drizzle
          .select({ id: gmaNpcLinks.id })
          .from(gmaNpcLinks)
          .where(and(eq(gmaNpcLinks.partyId, partyId), eq(gmaNpcLinks.npcId, npc.id)))
          .get()
      ) {
        return reply.code(409).send({
          error: apiMsg(req, 'npc_already_linked'),
          message: apiMsg(req, 'Ce PNJ du registre est déjà lié à une autre entrée GM Assistant.'),
        });
      }

      const now = nowIso();
      try {
        getDb().transaction(() => {
          drizzle
            .insert(gmaNpcLinks)
            .values({
              partyId,
              npcId: npc.id,
              gmaEntityId: entity.entity_id,
              linkedByUserId: userId,
              descriptionHash: wantAppend ? sha256Hex(String(entity.description)) : null,
              lastPullAt: wantAppend ? now : null,
            })
            .run();
          if (wantAppend) {
            drizzle
              .update(npcs)
              .set({
                description: appendedDescription(npc.description, String(entity.description)),
              })
              .where(eq(npcs.id, npc.id))
              .run();
          }
        })();
      } catch {
        return reply.code(409).send({
          error: apiMsg(req, 'entity_already_linked'),
          message: apiMsg(req, 'Cette entrée GM Assistant est déjà liée au registre.'),
        });
      }

      emitGma(partyId, userId, 'entity');
      if (wantAppend) {
        bus.emitChange({
          type: 'party:change',
          partyId,
          action: 'custom-item',
          actorUserId: userId,
        });
      }
      const row = drizzle
        .select({ ...cols(npcs), creator_name: users.displayName })
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(eq(npcs.id, npc.id))
        .get();
      return reply
        .code(201)
        .send({ npc: mapNpc(row, gm), appended: wantAppend, entityId: entity.entity_id });
    },
  );

  /** Pull: re-take GMA's description into the NPC (replace, or append). */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/pull',
    async (
      req: FastifyRequest<{
        Params: { partyId: string; entityId: string };
        Body: GmaPullEntityPayload;
      }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const partyLink = getPartyLink(partyId);
      const linkRow = getDrizzle()
        .select(cols(gmaNpcLinks))
        .from(gmaNpcLinks)
        .where(eq(gmaNpcLinks.gmaEntityId, String(req.params.entityId)))
        .get() as any;
      if (!linkRow || linkRow.party_id !== partyId) {
        return reply.code(404).send({
          error: apiMsg(req, 'no_link'),
          message: apiMsg(req, 'Cette entrée GM Assistant n’est pas liée au registre.'),
        });
      }
      const entity = await resolveEntity(partyId, partyLink, linkRow.gma_entity_id);
      if (!entity) {
        return reply.code(404).send({
          error: apiMsg(req, 'entity_gone'),
          message: apiMsg(
            req,
            'Cette entrée n’existe plus chez GM Assistant — délie le PNJ pour retirer le badge.',
          ),
        });
      }
      const npc = getDrizzle()
        .select(cols(npcs))
        .from(npcs)
        .where(eq(npcs.id, linkRow.npc_id))
        .get() as any;
      if (!npc) {
        return reply.code(404).send({
          error: apiMsg(req, 'unknown_npc'),
          message: apiMsg(req, 'PNJ introuvable dans le registre de ce groupe.'),
        });
      }
      const gm = isPartyGM(partyId, userId);
      if (!mayEditNpcContent(npc, userId, gm)) {
        return reply.code(403).send({
          error: apiMsg(req, 'cannot_edit'),
          message: apiMsg(
            req,
            'Seuls le créateur, le MD ou un éditeur autorisé peuvent modifier la description.',
          ),
        });
      }
      const gmaText = String(entity.description ?? '').trim();
      if (!gmaText) {
        return reply.code(400).send({
          error: apiMsg(req, 'no_description'),
          message: apiMsg(req, 'GM Assistant n’a pas de description pour ce PNJ.'),
        });
      }
      const append = req.body?.append === true;
      const now = nowIso();
      const drizzle = getDrizzle();
      getDb().transaction(() => {
        drizzle
          .update(npcs)
          .set({
            description: append ? appendedDescription(npc.description, gmaText) : gmaText,
          })
          .where(eq(npcs.id, npc.id))
          .run();
        drizzle
          .update(gmaNpcLinks)
          .set({ descriptionHash: sha256Hex(gmaText), lastPullAt: now })
          .where(eq(gmaNpcLinks.id, linkRow.id))
          .run();
      })();
      emitGma(partyId, userId, 'entity');
      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'custom-item',
        actorUserId: userId,
      });
      const row = drizzle
        .select({ ...cols(npcs), creator_name: users.displayName })
        .from(npcs)
        .innerJoin(users, eq(npcs.createdBy, users.id))
        .where(eq(npcs.id, npc.id))
        .get();
      return reply.send({ npc: mapNpc(row, gm), appended: append, entityId: entity.entity_id });
    },
  );

  /** Unlink: drop the badge, keep the NPC — GM, NPC creator, or the linker. */
  app.delete(
    '/parties/:partyId/gma/entities/:entityId/link',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      const linkRow = getDrizzle()
        .select(cols(gmaNpcLinks))
        .from(gmaNpcLinks)
        .where(eq(gmaNpcLinks.gmaEntityId, String(req.params.entityId)))
        .get() as any;
      if (!linkRow || linkRow.party_id !== partyId) {
        return reply.code(404).send({
          error: apiMsg(req, 'no_link'),
          message: apiMsg(req, 'Cette entrée GM Assistant n’est pas liée au registre.'),
        });
      }
      const npc = getDrizzle()
        .select(cols(npcs))
        .from(npcs)
        .where(eq(npcs.id, linkRow.npc_id))
        .get() as any;
      const gm = isPartyGM(partyId, userId);
      const mayUnlink =
        gm || (npc && npc.created_by === userId) || linkRow.linked_by_user_id === userId;
      if (!mayUnlink) {
        return reply.code(403).send({
          error: apiMsg(req, 'cannot_unlink'),
          message: apiMsg(
            req,
            'Seuls le MD, le créateur du PNJ ou celui qui a lié peuvent délier.',
          ),
        });
      }
      getDrizzle().delete(gmaNpcLinks).where(eq(gmaNpcLinks.id, linkRow.id)).run();
      emitGma(partyId, userId, 'entity');
      return reply.send({ ok: true });
    },
  );

  /** Discard: hide a useless entity from the rail, party-wide. Local-only —
   *  GMA keeps its entity; the discard outlives every cache refresh, and any
   *  member may undo it below. */
  app.post(
    '/parties/:partyId/gma/entities/:entityId/discard',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      if (!getPartyLink(partyId)) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      // No cache lookup on purpose: discards reference GMA ids that must keep
      // working across cache replaces — the id arrives from the GET we serve.
      getDrizzle()
        .insert(gmaEntityDiscards)
        .values({
          partyId,
          entityId: String(req.params.entityId),
          discardedByUserId: userId,
        })
        .onConflictDoNothing()
        .run();
      emitGma(partyId, userId, 'entity');
      return reply.code(201).send({ ok: true });
    },
  );

  /** Restore: bring a discarded entity back on the rail. */
  app.delete(
    '/parties/:partyId/gma/entities/:entityId/discard',
    async (
      req: FastifyRequest<{ Params: { partyId: string; entityId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!isPartyMember(partyId, userId)) {
        return reply.code(403).send({
          error: apiMsg(req, 'not a member'),
          message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
        });
      }
      if (!getPartyLink(partyId)) {
        return reply.code(404).send({
          error: apiMsg(req, 'not_linked'),
          message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
        });
      }
      getDrizzle()
        .delete(gmaEntityDiscards)
        .where(
          and(
            eq(gmaEntityDiscards.partyId, partyId),
            eq(gmaEntityDiscards.entityId, String(req.params.entityId)),
          ),
        )
        .run();
      emitGma(partyId, userId, 'entity');
      return reply.send({ ok: true });
    },
  );
}
