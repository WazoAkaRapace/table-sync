/**
 * GM Assistant — chronique (phase 4e, déplacement pur depuis routes/gma.ts,
 * corps verbatim) : séances + récits/moments marquants servis du cache
 * SQLite (stale-on-error : une panne GMA dégrade en vieux lisible, jamais
 * un 5x joueur) ; refresh=1 réservé au MD.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { gmaErrorToResponse } from '../../gma/client.ts';
import { apiMsg } from '../messages.ts';
import { isPartyGM } from '../lib/membership.ts';
import {
  cachedMoments,
  cachedRecaps,
  cachedSessionRow,
  cachedSessions,
  syncRecaps,
  syncSessions,
} from './cache.ts';
import { isFresh, requireGmaMemberLink, resolveLinkKey } from './shared.ts';

export async function chronicleRoutes(app: FastifyInstance) {
  // =================== Chronicle (sessions + recaps, cache-first) ===================

  app.get(
    '/parties/:partyId/gma/sessions',
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Querystring: { refresh?: string } }>,
      reply: FastifyReply,
    ) => {
      const ctx = requireGmaMemberLink(req, reply, req.params.partyId);
      if (ctx === null) return;
      const { userId, partyId, link } = ctx;
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
      const ctx = requireGmaMemberLink(req, reply, req.params.partyId);
      if (ctx === null) return;
      const { userId, partyId, link } = ctx;
      const sessionId = String(req.params.sessionId ?? '');
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
}
