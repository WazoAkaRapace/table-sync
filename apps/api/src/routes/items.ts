/**
 * Item catalog routes: search SRD + custom items, GM creates custom items.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateCustomItem } from '@table-sync/shared';
import { resolveItemBases } from '@table-sync/shared';
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getItemImagesDir } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { items, parties, partyMembers } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { isPartyGM, isPartyMember, mapItem, requireUser } from './helpers.ts';
import { langFromReq } from './lang.ts';

interface ItemQuery {
  search?: string;
  category?: string;
  rarity?: string;
  limit?: string;
  offset?: string;
  partyId?: string;
}

export async function itemRoutes(app: FastifyInstance) {
  // ---------- Search catalog ----------
  app.get(
    '/items',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Querystring: ItemQuery }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const {
        search,
        category,
        rarity,
        limit,
        offset,
        source,
        partyId: partyIdFilter,
      } = (req.query as any) || {};
      const lim = Math.min(parseInt(limit || '50', 10) || 50, 200);
      const off = Math.max(parseInt(offset || '0', 10) || 0, 0);

      const drizzle = getDrizzle();
      const where: Array<SQL | undefined> = [];

      // Les exemplaires annotés (objets dérivés) ne sont PAS du catalogue :
      // ni recherche joueur ni onglet Objets custom — chaque annotation ne
      // doit pas devenir un objet « ajoutable ». GET /items/:id les sert.
      where.push(isNull(items.derivedFromItemId));

      // A party context (inventory search, GM dashboard) scopes the catalog:
      // SRD items + THAT party's customs only — a member of several parties
      // never sees another party's items. Compose with source=custom for the
      // party's own items alone (GM dashboard custom-items tab).
      if (partyIdFilter) {
        if (!isPartyMember(Number(partyIdFilter), userId)) {
          return reply.code(403).send({ error: 'not a member' });
        }
        where.push(or(isNull(items.partyId), eq(items.partyId, Number(partyIdFilter))));
      } else {
        // Default: show global SRD items + custom items from the user's parties
        const userPartyIds = (
          drizzle
            .select({ party_id: partyMembers.partyId })
            .from(partyMembers)
            .where(eq(partyMembers.userId, userId))
            .all() as any[]
        ).map((r) => r.party_id);
        where.push(
          userPartyIds.length > 0
            ? or(isNull(items.partyId), inArray(items.partyId, userPartyIds))
            : isNull(items.partyId),
        );
      }

      if (search) {
        // Accent-insensitive search using a custom SQLite function registered in server.ts.
        // normalize() strips diacritics (é→e, è→e) and lowercases.
        const norm = search.replace(/-/g, ' ');
        where.push(
          or(
            sql`${items.name} LIKE ${`%${search}%`} ESCAPE '\\'`,
            sql`${items.nameFr} LIKE ${`%${search}%`} ESCAPE '\\'`,
            sql`${items.srdIndex} LIKE ${`%${search}%`} ESCAPE '\\'`,
            sql`normalize(${items.name}) LIKE normalize(${`%${norm}%`})`,
            sql`normalize(${items.nameFr}) LIKE normalize(${`%${norm}%`})`,
            sql`normalize(REPLACE(${items.name}, '-', ' ')) LIKE normalize(${`%${norm}%`})`,
            sql`normalize(COALESCE(${items.aliases}, '')) LIKE normalize(${`%${norm}%`})`,
          ),
        );
      }
      if (category) {
        where.push(eq(items.category, category));
      }
      if (rarity && rarity !== 'none') {
        where.push(eq(items.rarity, rarity));
      }
      if (source) {
        where.push(eq(items.source, source));
      }

      const filter = and(...where);
      const rows = drizzle
        .select(cols(items))
        .from(items)
        .where(filter)
        .orderBy(sql`${items.name} COLLATE NOCASE ASC`)
        .limit(lim)
        .offset(off)
        .all() as any[];
      const total = (
        drizzle.select({ n: sql<number>`count(*)` }).from(items).where(filter).get() as any
      ).n;

      return reply.send({
        items: rows.map((r: any) => mapItem(r, langFromReq(req))),
        total,
        limit: lim,
        offset: off,
      });
    },
  );

  // ---------- Get single item ----------
  app.get(
    '/items/:id',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const row = getDrizzle()
        .select(cols(items))
        .from(items)
        .where(eq(items.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: 'item not found' });
      // Custom items are only visible to members of the owning party (SRD items have party_id NULL).
      if (row.party_id != null && !isPartyMember(row.party_id, userId)) {
        return reply.code(403).send({ error: 'not a member' });
      }
      return reply.send({ item: mapItem(row, langFromReq(req)) });
    },
  );

  // ---------- Create custom item (GM always; players when the party allows) ----------
  app.post(
    '/parties/:partyId/items',
    { onRequest: [(app as any).authenticate] },
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateCustomItem }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      const drizzle = getDrizzle();
      if (!isPartyGM(partyId, userId)) {
        // Player-created items are a party setting the GM toggles — autonomy
        // for the players, the kill switch stays on the GM's dashboard.
        const allowed =
          isPartyMember(partyId, userId) &&
          !!(
            drizzle.select(cols(parties)).from(parties).where(eq(parties.id, partyId)).get() as any
          )?.players_create_items;
        if (!allowed) {
          return reply.code(403).send({ error: 'only the GM can create custom items' });
        }
      }
      const body = req.body || ({} as CreateCustomItem);

      if (!body.name?.trim()) {
        return reply.code(400).send({ error: 'name is required' });
      }

      // Clés de base résolues à la création (découplage moteur/noms)
      const bases = resolveItemBases({
        category: body.category || 'custom',
        name: body.name.trim(),
        nameFr: body.nameFr || body.name.trim(),
        description: body.description || null,
      });
      const row = drizzle
        .insert(items)
        .values({
          source: 'custom',
          partyId,
          createdBy: userId,
          category: body.category || 'custom',
          name: body.name.trim(),
          nameFr: body.nameFr || null,
          rarity: body.rarity || 'none',
          weightKg: body.weightKg ?? null,
          costQty: body.costQty ?? null,
          costUnit: body.costUnit || null,
          description: body.description || null,
          baseWeapon: bases.baseWeapon,
          baseArmor: bases.baseArmor,
          armorFamily: bases.armorFamily,
          magicBonus: bases.magicBonus,
        })
        .returning(cols(items))
        .get() as any;
      bus.emitChange({ type: 'party:change', partyId, action: 'custom-item', actorUserId: userId });
      return reply.code(201).send({ item: mapItem(row, langFromReq(req)) });
    },
  );

  // ---------- GM: update a custom item ----------
  app.patch(
    '/items/:id',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const itemId = Number(req.params.id);
      const item = drizzle.select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
      if (!item) return reply.code(404).send({ error: 'item not found' });
      if (item.source !== 'custom')
        return reply.code(403).send({ error: 'can only modify custom items' });

      // Check GM access
      if (!isPartyGM(item.party_id, userId)) {
        return reply.code(403).send({ error: 'only the GM can modify items' });
      }

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.name !== undefined) values.name = body.name.trim();
      if (body.category !== undefined) values.category = body.category;
      if (body.rarity !== undefined) values.rarity = body.rarity;
      if (body.weightKg !== undefined) values.weightKg = body.weightKg;
      if (body.costQty !== undefined) values.costQty = body.costQty;
      if (body.costUnit !== undefined) values.costUnit = body.costUnit;
      if (body.description !== undefined) values.description = body.description;
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: 'no fields to update' });
      }

      drizzle.update(items).set(values).where(eq(items.id, itemId)).run();
      const row = drizzle.select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
      bus.emitChange({
        type: 'party:change',
        partyId: item.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.send({ item: mapItem(row, langFromReq(req)) });
    },
  );

  // ---------- GM: delete a custom item ----------
  app.delete(
    '/items/:id',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const itemId = Number(req.params.id);
      const item = drizzle.select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
      if (!item) return reply.code(404).send({ error: 'item not found' });
      if (item.source !== 'custom')
        return reply.code(403).send({ error: 'can only delete custom items' });

      // Check GM access
      if (!isPartyGM(item.party_id, userId)) {
        return reply.code(403).send({ error: 'only the GM can delete items' });
      }

      drizzle.delete(items).where(eq(items.id, itemId)).run();
      // Drop the attached illustration file too (the row is gone — leave no orphan).
      if (item.image_url) {
        const filePath = join(getItemImagesDir(), item.image_url);
        if (existsSync(filePath)) unlinkSync(filePath);
      }
      bus.emitChange({
        type: 'party:change',
        partyId: item.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
