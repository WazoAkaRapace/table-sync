/**
 * Item illustration routes — attach / serve / remove an image on CUSTOM items
 * (hand-drawn maps, letters, documents photographed at the table).
 *
 * Responsiveness contract: image BYTES never ride in list/search/inventory
 * payloads — those carry only the derived hasImage boolean. The GET below is
 * the single fetch per item (served with an immutable cache header, so the
 * fullscreen viewer reuses the browser cache the inventory vignette paid for).
 *
 * GET authenticates via ?token=<JWT> like /ws (an <img src> cannot send an
 * Authorization header) — it is exempted from the global auth hook in
 * server.ts and verifies the token itself.
 *
 * PUT/DELETE follow the custom-item creation gate (GM always; players when
 * the party allows playersCreateItems) so the player's « Créer un objet »
 * modal can stage an illustration the same way the GM dashboard does.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getItemImagesDir } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { items, parties } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { isPartyGM, isPartyMember, requireUser } from './helpers.ts';

/** Hard upload ceiling — the client downscales to 1280px JPEG (~150-400 ko);
 * anything bigger than this is a client that skipped the canvas step. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Sniff the magic bytes: JPEG (ffd8) or PNG (8950). */
function sniffImageMime(buffer: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  return null;
}

/** Load an item row or null. */
function getItem(itemId: number): any {
  return getDrizzle().select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
}

/**
 * May this user attach/remove an illustration? Same door as custom-item
 * creation: the GM always, a member when the party lets players create items.
 * Returns an error reply, or null when allowed.
 */
function rejectImageMutation(item: any, userId: number, reply: FastifyReply): FastifyReply | null {
  if (item.source !== 'custom') {
    return reply.code(403).send({ error: 'can only modify custom items' });
  }
  if (isPartyGM(item.party_id, userId)) return null;
  const allowed =
    isPartyMember(item.party_id, userId) &&
    !!getDrizzle().select(cols(parties)).from(parties).where(eq(parties.id, item.party_id)).get()
      ?.players_create_items;
  if (!allowed) {
    return reply.code(403).send({ error: 'only the GM can modify items' });
  }
  return null;
}

export async function itemImageRoutes(app: FastifyInstance) {
  // ---------- Serve the illustration (public route, ?token= JWT like /ws) ----------
  app.get(
    '/items/:id/image',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const token = (req.query as any)?.token;
      if (typeof token !== 'string' || token === '') {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      let userId: number;
      try {
        const payload = (app as any).jwt.verify(token);
        userId = payload.sub;
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const row = getItem(Number(req.params.id));
      if (!row) return reply.code(404).send({ error: 'item not found' });
      // Same visibility rule as GET /items/:id: custom items stay in-party.
      if (row.party_id != null && !isPartyMember(row.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      if (!row.image_url) return reply.code(404).send({ error: 'no image' });
      const filePath = join(getItemImagesDir(), String(row.image_url));
      if (!existsSync(filePath)) return reply.code(404).send({ error: 'no image' });

      const buffer = readFileSync(filePath);
      // The column stores what was uploaded (client sends JPEG; a raw PNG is
      // accepted) — serve the true type from the magic bytes.
      const mime = sniffImageMime(buffer) ?? 'image/jpeg';
      // Immutable for a year: the path is stable per item and a re-upload
      // replaces the content — clients bust the cache with ?r=n on error.
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      reply.header('Content-Type', mime);
      return reply.send(buffer);
    },
  );

  // ---------- Attach / replace the illustration (multipart field `image`) ----------
  app.put(
    '/items/:id/image',
    { onRequest: [(app as any).authenticate], bodyLimit: 5 * 1024 * 1024 },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const itemId = Number(req.params.id);
      const item = getItem(itemId);
      if (!item) return reply.code(404).send({ error: 'item not found' });
      const rejected = rejectImageMutation(item, userId, reply);
      if (rejected) return rejected;

      const data = (await req.file()) as MultipartFile | undefined;
      if (!data) return reply.code(400).send({ error: 'image field is required' });
      const buffer = await data.toBuffer();

      if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        return reply.code(413).send({ error: 'image must be at most 2 MB' });
      }
      if (!sniffImageMime(buffer)) {
        return reply.code(400).send({ error: 'file is not a JPEG or PNG image' });
      }

      const dir = getItemImagesDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${itemId}.jpg`), buffer);

      getDrizzle()
        .update(items)
        .set({ imageUrl: `${itemId}.jpg` })
        .where(eq(items.id, itemId))
        .run();
      bus.emitChange({
        type: 'party:change',
        partyId: item.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.send({ ok: true });
    },
  );

  // ---------- Remove the illustration ----------
  app.delete(
    '/items/:id/image',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const itemId = Number(req.params.id);
      const item = getItem(itemId);
      if (!item) return reply.code(404).send({ error: 'item not found' });
      const rejected = rejectImageMutation(item, userId, reply);
      if (rejected) return rejected;

      if (item.image_url) {
        const filePath = join(getItemImagesDir(), item.image_url);
        if (existsSync(filePath)) unlinkSync(filePath);
        getDrizzle().update(items).set({ imageUrl: null }).where(eq(items.id, itemId)).run();
      }
      bus.emitChange({
        type: 'party:change',
        partyId: item.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.send({ ok: true });
    },
  );
}
