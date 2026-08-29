/**
 * Character ↔ Feature routes: free-form traits (class / racial / background /
 * feat / custom) with {{template}} variables in the description.
 *
 * Ownership rules:
 *  - GET    /characters/:id/features     → any party member
 *  - POST   /characters/:id/features     → owner or GM (any party member may read;
 *                                           only the owner or GM may modify)
 *  - PATCH  /character-features/:featureId → owner or GM (resolved via the feature row)
 *  - DELETE /character-features/:featureId → owner or GM
 *
 * All mutations emit a `character:change` sync event.
 */

import type {
  CreateCharacterFeaturePayload,
  PatchCharacterFeaturePayload,
  ReorderPayload,
} from '@table-sync/shared';
import { classFeatureResourceMax, findClassFeature } from '@table-sync/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { characterFeatures, characters } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  attachCharacterClasses,
  characterVisibleTo,
  isPartyGM,
  isPartyMember,
  mapCharacter,
  mapFeature,
  requireUser,
} from './helpers.ts';
import { apiMsg } from './messages.ts';

/**
 * Fetch the (feature, character) pair for a character_features row.
 * Used by PATCH/DELETE to resolve ownership before mutating.
 * Returns null if the feature row doesn't exist.
 */
function getFeatureWithCharacter(featureId: number): { feature: any; char: any } | null {
  const drizzle = getDrizzle();
  const feature = drizzle
    .select(cols(characterFeatures))
    .from(characterFeatures)
    .where(eq(characterFeatures.id, featureId))
    .get() as any;
  if (!feature) return null;
  const char = drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, feature.character_id))
    .get() as any;
  if (!char) return null;
  return { feature, char };
}

/** Returns true if the user is the owner or the GM of the character's party. */
function isOwnerOrGM(char: any, userId: number): boolean {
  return char.owner_id === userId || isPartyGM(char.party_id, userId);
}

function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

export async function characterFeatureRoutes(app: FastifyInstance) {
  // ---------- List a character's features ----------
  app.get(
    '/characters/:id/features',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      // Hidden character: 404 for everyone but its owner and the GM
      if (!characterVisibleTo(char, userId)) {
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      }

      const rows = drizzle
        .select(cols(characterFeatures))
        .from(characterFeatures)
        .where(eq(characterFeatures.characterId, char.id))
        .orderBy(characterFeatures.sortOrder, characterFeatures.createdAt)
        .all();

      return reply.send({ features: rows.map(mapFeature) });
    },
  );

  // ---------- Create a feature for a character ----------
  app.post(
    '/characters/:id/features',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: CreateCharacterFeaturePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can modify features') });
      }

      const body = req.body || ({} as CreateCharacterFeaturePayload);
      if (!body.title?.trim()) {
        return reply.code(400).send({ error: apiMsg(req, 'title is required') });
      }

      const category = body.category ?? 'custom';
      const description = body.description ?? null;
      const catalogId = body.catalogId ?? null;
      // From the catalog without an explicit counterMax: derive it from the
      // SRD formula at the character's current level (null = no counter).
      let counterMax = body.counterMax ?? null;
      if (counterMax === null && catalogId) {
        const def = findClassFeature(catalogId);
        if (def) {
          // Multiclassage : la formule s'évalue avec les lignes de classe
          // (chaque capacité suit le niveau de SA classe, pas le total).
          attachCharacterClasses([char]);
          counterMax = classFeatureResourceMax(def, mapCharacter(char));
        }
      }
      const counterCurrent = counterMax ?? null; // initialize to max
      const resetType = body.resetType ?? null;

      // Compute sort_order as MAX(sort_order)+1 for this character (0 if none yet).
      const maxSort = (
        drizzle
          .select({
            max_sort: sql<number>`coalesce(max(${characterFeatures.sortOrder}), -1)`,
          })
          .from(characterFeatures)
          .where(eq(characterFeatures.characterId, char.id))
          .get() as any
      ).max_sort;
      const sortOrder = maxSort + 1;

      const { id } = drizzle
        .insert(characterFeatures)
        .values({
          characterId: char.id,
          title: body.title.trim(),
          category,
          description,
          catalogId,
          resetType,
          counterMax,
          counterCurrent,
          sortOrder,
        })
        .returning({ id: characterFeatures.id })
        .get();

      const row = drizzle
        .select(cols(characterFeatures))
        .from(characterFeatures)
        .where(eq(characterFeatures.id, id))
        .get();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(201).send({ feature: mapFeature(row) });
    },
  );

  // ---------- Update a feature ----------
  app.patch(
    '/character-features/:featureId',
    async (
      req: FastifyRequest<{ Params: { featureId: string }; Body: PatchCharacterFeaturePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const resolved = getFeatureWithCharacter(Number(req.params.featureId));
      if (!resolved) return reply.code(404).send({ error: apiMsg(req, 'feature not found') });
      const { feature, char } = resolved;
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can modify features') });
      }

      const body = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.title !== undefined) values.title = body.title;
      if (body.category !== undefined) values.category = body.category;
      if (body.description !== undefined) values.description = body.description;
      if (body.catalogId !== undefined) values.catalogId = body.catalogId;
      if (body.resetType !== undefined) values.resetType = body.resetType;
      if (body.counterMax !== undefined) {
        values.counterMax = body.counterMax;
        // If setting a new max and current is null or exceeds new max, reset to max
        if (
          body.counterMax !== null &&
          (feature.counter_current === null || feature.counter_current > body.counterMax)
        ) {
          values.counterCurrent = body.counterMax;
        }
        // If removing the counter (null), also clear current
        if (body.counterMax === null) {
          values.counterCurrent = null;
        }
      }
      if (body.counterCurrent !== undefined) values.counterCurrent = body.counterCurrent;
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      drizzle
        .update(characterFeatures)
        .set(values)
        .where(eq(characterFeatures.id, feature.id))
        .run();

      const row = drizzle
        .select(cols(characterFeatures))
        .from(characterFeatures)
        .where(eq(characterFeatures.id, feature.id))
        .get();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.send({ feature: mapFeature(row) });
    },
  );

  // ---------- Reorder one category group ----------
  // The traits grid keeps its category sections: each is its own drag arena,
  // so the client sends ONE group's ids and the server rewrites
  // sort_order = index for those rows only (ordering matters within a
  // category after grouping — interleaved values across groups are fine).
  app.patch(
    '/characters/:id/features/order',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: ReorderPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can modify features') });
      }

      const body = req.body || ({} as ReorderPayload);
      const order = [
        ...new Set(
          (Array.isArray(body.order) ? body.order : []).map(Number).filter(Number.isInteger),
        ),
      ];
      if (order.length === 0)
        return reply.code(400).send({ error: apiMsg(req, 'order is required') });

      // Every id must belong to this character
      const owned = new Set(
        (
          drizzle
            .select({ id: characterFeatures.id })
            .from(characterFeatures)
            .where(inArray(characterFeatures.id, order))
            .all() as any[]
        ).map((r) => r.id),
      );
      if (order.some((id) => !owned.has(id))) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'feature does not belong to this character') });
      }

      getDb().transaction(() => {
        order.forEach((id, index) => {
          drizzle
            .update(characterFeatures)
            .set({ sortOrder: index })
            .where(eq(characterFeatures.id, id))
            .run();
        });
      })();

      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.send({ ok: true });
    },
  );

  // ---------- Delete a feature ----------
  app.delete(
    '/character-features/:featureId',
    async (req: FastifyRequest<{ Params: { featureId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const resolved = getFeatureWithCharacter(Number(req.params.featureId));
      if (!resolved) return reply.code(404).send({ error: apiMsg(req, 'feature not found') });
      const { feature, char } = resolved;
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can modify features') });
      }

      drizzle.delete(characterFeatures).where(eq(characterFeatures.id, feature.id)).run();
      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
