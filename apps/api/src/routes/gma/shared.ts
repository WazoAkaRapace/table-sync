/**
 * GM Assistant — helpers partagés des routes/gma/ (phase 4e, déplacement pur
 * depuis routes/gma.ts, corps verbatim) : état local (clé utilisateur chiffrée,
 * lien de groupe, porte GM), note de scope, façonnage des personnages pour les
 * payloads GMA (init + resync) et droits de contenu PNJ.
 */

import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { characters, partyGmaLinks, userGmaLinks, users } from '../../db/schema.ts';
import { decryptSecret, GmaError, gmaCacheTtlMs } from '../../gma/client.ts';
import { bus } from '../../sync/bus.ts';
import { attachCharacterClasses } from '../lib/character-classes.ts';
import { isPartyGM, isPartyMember, requireUser } from '../lib/membership.ts';
import { apiMsg } from '../messages.ts';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nowIso(): string {
  return new Date().toISOString();
}

/** Cache marker still inside the TTL. */
export function isFresh(marker: string | null | undefined): boolean {
  if (!marker) return false;
  const t = Date.parse(marker);
  return Number.isFinite(t) && Date.now() - t < gmaCacheTtlMs();
}

/**
 * GMA serves HTML-escaped text (&amp; &#39; &quot;…). We cache PLAIN text —
 * every consumer renders it as text nodes (React escapes again), so a stored
 * &amp; would display literally. Decode ONCE at cache-write; &amp; LAST so a
 * double-encoded &amp;amp; round-trips to &amp;, not &.
 */
export function decodeGmaText(s: unknown): string {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d: string) => {
      const cp = Number(d);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : `&#${d};`;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const cp = Number.parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : `&#x${h};`;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&');
}

// ---------- local state helpers ----------

export function getUserKeyRow(userId: number): any | null {
  return (
    getDrizzle()
      .select(cols(userGmaLinks))
      .from(userGmaLinks)
      .where(eq(userGmaLinks.userId, userId))
      .get() ?? null
  );
}

/** Decrypt a stored key; null when absent or unreadable (rotated secret). */
export function decryptUserKey(row: any | null): string | null {
  if (!row) return null;
  try {
    return decryptSecret(row.api_key_enc);
  } catch {
    return null;
  }
}

export function getPartyLink(partyId: number): any | null {
  return (
    getDrizzle()
      .select(cols(partyGmaLinks))
      .from(partyGmaLinks)
      .where(eq(partyGmaLinks.partyId, partyId))
      .get() ?? null
  );
}

/** The key that serves a linked party: the linking GM's stored key. */
export function resolveLinkKey(link: any): string | null {
  return decryptUserKey(getUserKeyRow(link.linked_by_user_id));
}

export function emitGma(
  partyId: number,
  actorUserId: number,
  action: 'link' | 'unlink' | 'init' | 'sync' | 'entity',
): void {
  bus.emitChange({ type: 'gma:change', partyId, action, actorUserId });
}

/** Auth + membership + GM door for party-scoped GMA routes. */
export function requirePartyGM(req: FastifyRequest, reply: FastifyReply, partyId: number): boolean {
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

/** Contexte renvoyé par les portes membre/lien — link pour les routes qui l'utilisent. */
export interface GmaMemberLink {
  userId: number;
  partyId: number;
  link: any;
}

/**
 * Porte « membre + lien GMA » des routes entités/chronique : 401 implicite
 * (requireUser), 403 « not a member » hors groupe, puis 404 « not_linked »
 * sans campagne liée. Renvoie null après avoir envoyé la réponse —
 * l'appelant fait `return`.
 */
export function requireGmaMemberLink(
  req: FastifyRequest,
  reply: FastifyReply,
  partyIdRaw: string,
): GmaMemberLink | null {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const partyId = Number(partyIdRaw);
  if (!isPartyMember(partyId, userId)) {
    reply.code(403).send({
      error: apiMsg(req, 'not a member'),
      message: apiMsg(req, 'Tu n’es pas membre de ce groupe.'),
    });
    return null;
  }
  const link = getPartyLink(partyId);
  if (!link) {
    reply.code(404).send({
      error: apiMsg(req, 'not_linked'),
      message: apiMsg(req, 'Aucune campagne GM Assistant liée à ce groupe.'),
    });
    return null;
  }
  return { userId, partyId, link };
}

/**
 * Porte « GM + lien requis » (sync/delete PNJ GMA, unlink de campagne) :
 * même contrat, 404 « not_linked » au libellé « Ce groupe n'est pas lié… ».
 */
export function requireGmaLinked(
  req: FastifyRequest,
  reply: FastifyReply,
  partyIdRaw: string,
): GmaMemberLink | null {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const partyId = Number(partyIdRaw);
  if (!requirePartyGM(req, reply, partyId)) return null;
  const link = getPartyLink(partyId);
  if (!link) {
    reply.code(404).send({
      error: apiMsg(req, 'not_linked'),
      message: apiMsg(req, 'Ce groupe n’est pas lié à une campagne GM Assistant.'),
    });
    return null;
  }
  return { userId, partyId, link };
}

/**
 * Porte « init/link » : GM + groupe PAS encore lié (409 already_linked) +
 * clé utilisateur enregistrée (400 no_key). Renvoie la clé ou null après
 * avoir envoyé la réponse.
 */
export function requireGmaFreshKey(
  req: FastifyRequest,
  reply: FastifyReply,
  partyIdRaw: string,
): { userId: number; partyId: number; key: string } | null {
  const userId = requireUser(req, reply);
  if (userId === null) return null;
  const partyId = Number(partyIdRaw);
  if (!requirePartyGM(req, reply, partyId)) return null;
  if (getPartyLink(partyId)) {
    reply.code(409).send({
      error: apiMsg(req, 'already_linked'),
      message: apiMsg(req, 'Ce groupe est déjà lié à une campagne GM Assistant.'),
    });
    return null;
  }
  const key = decryptUserKey(getUserKeyRow(userId));
  if (!key) {
    reply.code(400).send({
      error: apiMsg(req, 'no_key'),
      message: apiMsg(req, 'Enregistre d’abord ta clé GM Assistant ci-dessus.'),
    });
    return null;
  }
  return { userId, partyId, key };
}

/** Any successful write proves full_access; insufficient_scope proves read. */
export function noteScope(userId: number, err: unknown): void {
  const scope =
    err instanceof GmaError && err.status === 403 && err.code === 'insufficient_scope'
      ? 'read'
      : null;
  if (!scope) return;
  getDrizzle().update(userGmaLinks).set({ scope }).where(eq(userGmaLinks.userId, userId)).run();
}

// ---------- character shaping (init + resync payloads) ----------

export function loadPartyCharacters(partyId: number): any[] {
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
export const GMA_DESCRIPTION_MAX = 6000;

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
export function gmaDescription(row: any): string {
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
export function desiredPc(row: any): { name: string; played_by: string; description: string } {
  return { name: row.name, played_by: row.owner_name, description: gmaDescription(row) };
}

/** NPC visibility for a member — mirrors the npcs list route's filter. */
export function npcVisibleToUser(npc: any, userId: number, gm: boolean): boolean {
  return gm || !!npc.is_shared || npc.created_by === userId;
}

/** Content-edit rights on an NPC — mirrors the npcs PATCH door. */
export function mayEditNpcContent(npc: any, userId: number, gm: boolean): boolean {
  return npc.created_by === userId || gm || (!!npc.is_shared && !!npc.allow_member_edit);
}

/** GMA text onto an NPC description — append keeps the player's own words. */
export function appendedDescription(current: string | null, gmaText: string): string {
  const own = String(current ?? '').trim();
  return own ? `${own}\n\n${gmaText}` : gmaText;
}
