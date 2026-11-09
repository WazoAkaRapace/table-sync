/**
 * GM Assistant — compte utilisateur (phase 4e, déplacement pur depuis
 * routes/gma.ts, corps verbatim) : statut de lien, enregistrement/validation
 * de la clé (chiffrée au repos, e-mail masqué en retour), suppression.
 */

import type { GmaSaveKeyPayload } from '@table-sync/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { userGmaLinks } from '../../db/schema.ts';
import {
  encryptSecret,
  GmaError,
  gmaErrorToResponse,
  gmaRequest,
  maskEmail,
} from '../../gma/client.ts';
import { apiMsg } from '../messages.ts';
import { requireUser } from '../helpers.ts';
import { getUserKeyRow, nowIso } from './shared.ts';

export async function accountRoutes(app: FastifyInstance) {
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
}
