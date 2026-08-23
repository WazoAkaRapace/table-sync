/**
 * Item illustration routes — attach / serve / remove an image on CUSTOM items
 * (hand-drawn maps, letters, documents photographed at the table) — and the
 * per-copy ANNOTATION flow (drawing/notes flattened into the image): the
 * annotated copy becomes a DERIVED item so it survives inventory transfers.
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
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb, getItemImagesDir } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { characters, inventory, items, parties } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  isOwnerOrGM,
  isPartyGM,
  isPartyMember,
  mapInventoryEntry,
  requireUser,
} from './helpers.ts';
import { INVENTORY_WITH_ITEM } from './inventory.ts';

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

  // ---------- Annotation (dessin/notes) : l'exemplaire devient un dérivé ----------
  //
  // Au premier enregistrement, la ligne d'inventaire se détache de l'objet de
  // base et pointe une COPIE DÉRIVÉE (même nom/poids/description, image =
  // JPEG annoté, party_id = celle du personnage propriétaire — piège SRD : la
  // base globale a party_id NULL, le dérivé doit rester dans le groupe). Le
  // dérivé survit aux transferts (c'est un objet comme un autre) et l'image
  // de base n'est jamais touchée. Re-annoter un dérivé écrase SON fichier —
  // jamais de second niveau de dérivation.

  /** The inventory row (with its item, i_ aliases) for one inventory id. */
  const getEntryWithItem = (invId: number): any =>
    getDrizzle()
      .select(INVENTORY_WITH_ITEM)
      .from(inventory)
      .innerJoin(items, eq(items.id, inventory.itemId))
      .where(eq(inventory.id, invId))
      .get() ?? null;

  app.post(
    '/inventory/:id/annotation',
    { onRequest: [(app as any).authenticate], bodyLimit: 5 * 1024 * 1024 },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();

      const entry = getEntryWithItem(Number(req.params.id));
      if (!entry) return reply.code(404).send({ error: 'inventory entry not found' });
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, entry.character_id))
        .get() as any;
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: 'only the owner or GM can annotate' });
      }
      // Annoter n'a de sens que sur un objet illustré — on dessine SUR l'image.
      if (!entry.i_image_url) {
        return reply.code(400).send({ error: 'item has no illustration to annotate' });
      }

      const data = (await req.file()) as MultipartFile | undefined;
      if (!data) return reply.code(400).send({ error: 'image field is required' });
      const buffer = await data.toBuffer();
      if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        return reply.code(413).send({ error: 'image must be at most 2 MB' });
      }
      if (!sniffImageMime(buffer)) {
        return reply.code(400).send({ error: 'file is not a JPEG or PNG image' });
      }

      // L'objet porté : dérivé existant (écrasement) ou objet de base (dérivation).
      const carried = getItem(entry.item_id);
      const alreadyDerived = carried.derived_from_item_id != null;

      const dir = getItemImagesDir();
      mkdirSync(dir, { recursive: true });

      let updatedEntryId = entry.id;
      getDb().transaction(() => {
        if (alreadyDerived) {
          // Écrasement : même dérivé, nouveau JPEG — pas de second niveau.
          writeFileSync(join(dir, `${carried.id}.jpg`), buffer);
          return;
        }
        // Dérivation : copie de l'objet de base, ancrée au groupe du personnage.
        const derived = drizzle
          .insert(items)
          .values({
            source: 'custom',
            partyId: char.party_id,
            createdBy: userId,
            category: carried.category,
            name: carried.name,
            nameFr: carried.name_fr,
            rarity: carried.rarity,
            weightKg: carried.weight_kg,
            costQty: carried.cost_qty,
            costUnit: carried.cost_unit,
            description: carried.description,
            damageDice: carried.damage_dice,
            damageType: carried.damage_type,
            acBase: carried.ac_base,
            strMin: carried.str_min,
            stealthDisadvantage: carried.stealth_disadvantage,
            propertiesJson: carried.properties_json,
            survivalTags: carried.survival_tags,
            aliases: carried.aliases,
            imagePath: carried.image_path,
            derivedFromItemId: carried.id,
          })
          .returning(cols(items))
          .get() as any;
        writeFileSync(join(dir, `${derived.id}.jpg`), buffer);
        drizzle
          .update(items)
          .set({ imageUrl: `${derived.id}.jpg` })
          .where(eq(items.id, derived.id))
          .run();

        if (entry.quantity > 1) {
          // Split (motif transfert partiel) : la pile d'origine garde son état
          // (qty−1, équipé, notes), l'exemplaire annoté naît neutre à côté.
          drizzle
            .update(inventory)
            .set({ quantity: entry.quantity - 1 })
            .where(eq(inventory.id, entry.id))
            .run();
          updatedEntryId = drizzle
            .insert(inventory)
            .values({
              characterId: entry.character_id,
              itemId: derived.id,
              quantity: 1,
              equipped: 0,
              notes: null,
              storageLocationId: entry.storage_location_id,
            })
            .returning({ id: inventory.id })
            .get().id;
        } else {
          // qty 1 : la ligne change d'objet, l'état (équipé/notes/emplacement) reste.
          drizzle
            .update(inventory)
            .set({ itemId: derived.id })
            .where(eq(inventory.id, entry.id))
            .run();
        }
      })();

      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
        actorUserId: userId,
      });
      bus.emitChange({
        type: 'party:change',
        partyId: char.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.code(200).send({ entry: mapInventoryEntry(getEntryWithItem(updatedEntryId)) });
    },
  );

  // ---------- Reset : l'exemplaire redevient l'objet de base ----------
  app.post(
    '/inventory/:id/annotation/reset',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();

      const entry = getEntryWithItem(Number(req.params.id));
      if (!entry) return reply.code(404).send({ error: 'inventory entry not found' });
      const char = drizzle
        .select(cols(characters))
        .from(characters)
        .where(eq(characters.id, entry.character_id))
        .get() as any;
      if (!char) return reply.code(404).send({ error: 'character not found' });
      if (!isOwnerOrGM(char, userId)) {
        return reply.code(403).send({ error: 'only the owner or GM can annotate' });
      }
      const derived = getItem(entry.item_id);
      // Base supprimée entre-temps → SET NULL → la ligne n'est plus « annotée ».
      if (!derived || derived.derived_from_item_id == null) {
        return reply.code(400).send({ error: 'entry is not annotated' });
      }
      const baseId = derived.derived_from_item_id;

      // Le dérivé n'a pu être créé que pour CETTE ligne, mais un transfert a pu
      // déplacer cette dernière : si une autre ligne le référence, on refuse.
      const otherRows = drizzle
        .select({ id: inventory.id })
        .from(inventory)
        .where(and(eq(inventory.itemId, entry.item_id), ne(inventory.id, entry.id)))
        .all();
      if (otherRows.length > 0) {
        return reply.code(409).send({ error: 'annotated copy is referenced elsewhere' });
      }

      let updatedEntryId = entry.id;
      getDb().transaction(() => {
        // Re-fusion (motif /transfer) : une pile de la base existe déjà au même
        // emplacement → la quantité s'y replie ; sinon la ligne reprend la base.
        const mergeTarget = drizzle
          .select({ id: inventory.id })
          .from(inventory)
          .where(
            and(
              eq(inventory.characterId, entry.character_id),
              eq(inventory.itemId, baseId),
              // Même emplacement, NULL compris (SQLite : NULL ≠ NULL dans l'index
              // unique — on cible explicitement le NULL quand la ligne annotée l'est).
              entry.storage_location_id == null
                ? isNull(inventory.storageLocationId)
                : eq(inventory.storageLocationId, entry.storage_location_id),
            ),
          )
          .get();
        if (mergeTarget) {
          drizzle
            .update(inventory)
            .set({ quantity: sql`${inventory.quantity} + ${entry.quantity}` })
            .where(eq(inventory.id, mergeTarget.id))
            .run();
          drizzle.delete(inventory).where(eq(inventory.id, entry.id)).run();
          updatedEntryId = mergeTarget.id;
        } else {
          drizzle.update(inventory).set({ itemId: baseId }).where(eq(inventory.id, entry.id)).run();
        }
        drizzle.delete(items).where(eq(items.id, entry.item_id)).run();
        if (derived.image_url) {
          const filePath = join(getItemImagesDir(), derived.image_url);
          if (existsSync(filePath)) unlinkSync(filePath);
        }
      })();

      bus.emitChange({
        type: 'inventory:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'adjust',
        actorUserId: userId,
      });
      bus.emitChange({
        type: 'party:change',
        partyId: char.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.code(200).send({ entry: mapInventoryEntry(getEntryWithItem(updatedEntryId)) });
    },
  );
}
