/**
 * Notes du MD — grammaire des notes de fiche, party-scoped, GM-only,
 * réordonnancement complet après un card drop. Découpage 2026-11 (phase 4) :
 * déplacement pur depuis routes/campaign.ts.
 */

import type { CreateDmNotePayload, PatchDmNotePayload, ReorderPayload } from '@table-sync/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { getDb } from '../../db/index.ts';
import { cols } from '../../db/projections.ts';
import { dmNotes } from '../../db/schema.ts';
import { bus } from '../../sync/bus.ts';
import { requireUser } from '../helpers.ts';
import { apiMsg } from '../messages.ts';
import { MAX_TITLE_LEN, gmGuard, mapNote, nextSort } from './shared.ts';

export async function notesRoutes(app: FastifyInstance) {
  // ---------- Notes (grammar of character notes, party-scoped) ----------

  app.post(
    '/parties/:partyId/dm-notes',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateDmNotePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body || ({} as CreateDmNotePayload);
      const title = body.title?.trim();
      if (!title || title.length > MAX_TITLE_LEN) {
        return reply.code(400).send({ error: apiMsg(req, 'title is required') });
      }

      const drizzle = getDrizzle();
      const row = drizzle
        .insert(dmNotes)
        .values({
          partyId,
          title,
          content: body.content?.trim() || null,
          sortOrder: nextSort(drizzle, dmNotes, partyId),
        })
        .returning(cols(dmNotes))
        .get();
      bus.emitChange({ type: 'campaign:change', partyId, action: 'note', actorUserId: userId });
      return reply.code(201).send({ note: mapNote(row) });
    },
  );

  app.patch(
    '/dm-notes/:id',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: PatchDmNotePayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const note = drizzle
        .select(cols(dmNotes))
        .from(dmNotes)
        .where(eq(dmNotes.id, Number(req.params.id)))
        .get() as any;
      if (!note) return reply.code(404).send({ error: apiMsg(req, 'note not found') });
      if (!gmGuard(req, reply, note.party_id, userId)) return;

      const body = req.body || ({} as PatchDmNotePayload);
      const values: Record<string, unknown> = {};
      if (body.title !== undefined) {
        const title = body.title?.trim();
        if (!title || title.length > MAX_TITLE_LEN) {
          return reply.code(400).send({ error: apiMsg(req, 'title is required') });
        }
        values.title = title;
      }
      if (body.content !== undefined) {
        values.content = body.content === null ? null : String(body.content);
      }
      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }
      values.updatedAt = sql`datetime('now')`;
      drizzle.update(dmNotes).set(values).where(eq(dmNotes.id, note.id)).run();
      const updated = drizzle
        .select(cols(dmNotes))
        .from(dmNotes)
        .where(eq(dmNotes.id, note.id))
        .get();
      bus.emitChange({
        type: 'campaign:change',
        partyId: note.party_id,
        action: 'note',
        actorUserId: userId,
      });
      return reply.send({ note: mapNote(updated) });
    },
  );

  // Full-list reorder after a card drop — same contract as character notes.
  app.patch(
    '/parties/:partyId/dm-notes/order',
    async (req: FastifyRequest<{ Params: { partyId: string }; Body: ReorderPayload }>, reply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      if (!gmGuard(req, reply, partyId, userId)) return;

      const body = req.body as ReorderPayload;
      const order = [
        ...new Set(
          (Array.isArray(body?.order) ? body.order : []).map(Number).filter(Number.isInteger),
        ),
      ];
      if (order.length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'order is required') });
      }
      // Every id must belong to this party — a foreign id would silently
      // rewrite another group's ordering (CodeRabbit #279 : le filtre
      // partyId manquait — un id d'un AUTRE groupe passait le check).
      const owned = new Set(
        (
          getDrizzle()
            .select({ id: dmNotes.id })
            .from(dmNotes)
            .where(and(inArray(dmNotes.id, order), eq(dmNotes.partyId, partyId)))
            .all() as any[]
        ).map((r) => r.id),
      );
      if (order.some((id) => !owned.has(id))) {
        return reply.code(400).send({ error: apiMsg(req, 'note does not belong to this party') });
      }

      const drizzle = getDrizzle();
      getDb().transaction(() => {
        order.forEach((id, index) => {
          drizzle.update(dmNotes).set({ sortOrder: index }).where(eq(dmNotes.id, id)).run();
        });
      })();

      bus.emitChange({ type: 'campaign:change', partyId, action: 'note', actorUserId: userId });
      return reply.send({ ok: true });
    },
  );

  app.delete(
    '/dm-notes/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const note = drizzle
        .select(cols(dmNotes))
        .from(dmNotes)
        .where(eq(dmNotes.id, Number(req.params.id)))
        .get() as any;
      if (!note) return reply.code(404).send({ error: apiMsg(req, 'note not found') });
      if (!gmGuard(req, reply, note.party_id, userId)) return;

      drizzle.delete(dmNotes).where(eq(dmNotes.id, note.id)).run();
      bus.emitChange({
        type: 'campaign:change',
        partyId: note.party_id,
        action: 'note',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
