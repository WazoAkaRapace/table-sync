/**
 * Character notes routes: free-form notes with simple formatting.
 * Same ownership pattern as character-features.
 */

import type {
  CharacterNote,
  CreateCharacterNotePayload,
  PatchCharacterNotePayload,
  ReorderPayload,
} from '@table-sync/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { characterNotes, characters } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { characterVisibleTo, isPartyGM, isPartyMember, requireUser } from './helpers.ts';

function mapNote(row: any): CharacterNote {
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    content: row.content,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function getNoteWithCharacter(noteId: number): { note: any; char: any } | null {
  const drizzle = getDrizzle();
  const note = drizzle
    .select(cols(characterNotes))
    .from(characterNotes)
    .where(eq(characterNotes.id, noteId))
    .get() as any;
  if (!note) return null;
  const char = drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, note.character_id))
    .get() as any;
  if (!char) return null;
  return { note, char };
}

function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

function isOwnerOrGM(char: any, userId: number): boolean {
  return char.owner_id === userId || isPartyGM(char.party_id, userId);
}

export async function characterNoteRoutes(app: FastifyInstance) {
  app.get('/characters/:id/notes', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const charId = Number((req.params as any).id);
    const drizzle = getDrizzle();
    const char = getCharacter(drizzle, charId);
    if (!char) return reply.code(404).send({ error: 'Character not found' });
    if (!isPartyMember(char.party_id, userId))
      return reply.code(403).send({ error: 'Not a party member' });
    // Hidden character: 404 for everyone but its owner and the GM
    if (!characterVisibleTo(char, userId))
      return reply.code(404).send({ error: 'Character not found' });

    const rows = drizzle
      .select(cols(characterNotes))
      .from(characterNotes)
      .where(eq(characterNotes.characterId, charId))
      .orderBy(characterNotes.sortOrder, characterNotes.createdAt)
      .all();
    return { notes: rows.map(mapNote) };
  });

  app.post('/characters/:id/notes', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const charId = Number((req.params as any).id);
    const drizzle = getDrizzle();
    const char = getCharacter(drizzle, charId);
    if (!char) return reply.code(404).send({ error: 'Character not found' });
    if (!isPartyMember(char.party_id, userId))
      return reply.code(403).send({ error: 'Not a party member' });
    if (!isOwnerOrGM(char, userId))
      return reply.code(403).send({ error: 'Only the owner or GM can modify' });

    const body = req.body as CreateCharacterNotePayload;
    const title = body?.title?.trim();
    if (!title) return reply.code(400).send({ error: 'Title is required' });

    const nextSort = (
      drizzle
        .select({
          next: sql<number>`coalesce(max(${characterNotes.sortOrder}), -1) + 1`,
        })
        .from(characterNotes)
        .where(eq(characterNotes.characterId, charId))
        .get() as any
    ).next;

    const row = drizzle
      .insert(characterNotes)
      .values({
        characterId: charId,
        title,
        content: body.content?.trim() || null,
        sortOrder: nextSort,
      })
      .returning(cols(characterNotes))
      .get();
    const note = mapNote(row);
    bus.emitChange({
      type: 'character:change',
      partyId: char.party_id,
      characterId: charId,
      action: 'stats',
      actorUserId: userId,
    });
    return reply.code(201).send({ note });
  });

  app.patch('/character-notes/:noteId', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const noteId = Number((req.params as any).noteId);
    const pair = getNoteWithCharacter(noteId);
    if (!pair) return reply.code(404).send({ error: 'Note not found' });
    const { note, char } = pair;
    if (!isPartyMember(char.party_id, userId))
      return reply.code(403).send({ error: 'Not a party member' });
    if (!isOwnerOrGM(char, userId))
      return reply.code(403).send({ error: 'Only the owner or GM can modify' });

    const body = req.body as PatchCharacterNotePayload;
    const values: Record<string, unknown> = {};
    if (body.title !== undefined) values.title = body.title.trim();
    if (body.content !== undefined) values.content = body.content;
    if (Object.keys(values).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    values.updatedAt = sql`datetime('now')`;

    const drizzle = getDrizzle();
    drizzle.update(characterNotes).set(values).where(eq(characterNotes.id, noteId)).run();
    const updated = mapNote(
      drizzle
        .select(cols(characterNotes))
        .from(characterNotes)
        .where(eq(characterNotes.id, noteId))
        .get(),
    );
    bus.emitChange({
      type: 'character:change',
      partyId: char.party_id,
      characterId: note.character_id,
      action: 'stats',
      actorUserId: userId,
    });
    return { note: updated };
  });

  // ---------- Reorder the whole note list ----------
  // The client sends the full id list after a drop; the server rewrites
  // sort_order = index in one transaction. updatedAt stays untouched — moving
  // a card is not editing its content.
  app.patch('/characters/:id/notes/order', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const charId = Number((req.params as any).id);
    const drizzle = getDrizzle();
    const char = getCharacter(drizzle, charId);
    if (!char) return reply.code(404).send({ error: 'Character not found' });
    if (!isPartyMember(char.party_id, userId))
      return reply.code(403).send({ error: 'Not a party member' });
    if (!isOwnerOrGM(char, userId))
      return reply.code(403).send({ error: 'Only the owner or GM can modify' });

    const body = req.body as ReorderPayload;
    const order = [
      ...new Set(
        (Array.isArray(body?.order) ? body.order : []).map(Number).filter(Number.isInteger),
      ),
    ];
    if (order.length === 0) return reply.code(400).send({ error: 'Order is required' });

    // Every id must belong to this character — a foreign id would silently
    // rewrite another sheet's ordering
    const owned = new Set(
      (
        drizzle
          .select({ id: characterNotes.id })
          .from(characterNotes)
          .where(inArray(characterNotes.id, order))
          .all() as any[]
      ).map((r) => r.id),
    );
    if (order.some((id) => !owned.has(id))) {
      return reply.code(400).send({ error: 'Note does not belong to this character' });
    }

    getDb().transaction(() => {
      order.forEach((id, index) => {
        drizzle
          .update(characterNotes)
          .set({ sortOrder: index })
          .where(eq(characterNotes.id, id))
          .run();
      });
    })();

    bus.emitChange({
      type: 'character:change',
      partyId: char.party_id,
      characterId: charId,
      action: 'stats',
      actorUserId: userId,
    });
    return { ok: true };
  });

  app.delete('/character-notes/:noteId', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const noteId = Number((req.params as any).noteId);
    const pair = getNoteWithCharacter(noteId);
    if (!pair) return reply.code(404).send({ error: 'Note not found' });
    const { note, char } = pair;
    if (!isPartyMember(char.party_id, userId))
      return reply.code(403).send({ error: 'Not a party member' });
    if (!isOwnerOrGM(char, userId))
      return reply.code(403).send({ error: 'Only the owner or GM can modify' });

    getDrizzle().delete(characterNotes).where(eq(characterNotes.id, noteId)).run();
    bus.emitChange({
      type: 'character:change',
      partyId: char.party_id,
      characterId: note.character_id,
      action: 'stats',
      actorUserId: userId,
    });
    return reply.code(204).send();
  });
}
