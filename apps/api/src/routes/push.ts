/**
 * Routes Push (Web Push / VAPID) — gestion de l'abonnement de CE navigateur.
 * GET /push/config          : gate de l'UI (fonctionnalité + clé publique)
 * POST /push/subscribe      : upsert de l'abonnement (l'endpoint est la clé naturelle)
 * POST /push/unsubscribe    : suppression, limitée à ses propres lignes
 * POST /push/test           : envoie une notification à ses appareils —
 *                             valide toute la chaîne (VAPID → push service → SW)
 *
 * Pas d'entrée dans l'allowlist du garde JWT : tout est authentifié.
 */

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { pushSubscriptions } from '../db/schema.ts';
import { pushEnabled, pushVapidConfig } from '../push/config.ts';
import { sendPushToUser } from '../push/send.ts';
import { requireUser } from './helpers.ts';
import { langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export async function pushRoutes(app: FastifyInstance) {
  app.get('/push/config', async () => {
    const config = pushVapidConfig();
    return { enabled: pushEnabled, publicKey: config ? config.publicKey : null };
  });

  app.post('/push/subscribe', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const body = req.body as SubscribeBody;
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : '';
    // Les push services n'existent qu'en https (la lib web-push y insiste
    // aussi) ; ces bornes évitent de stocker n'importe quoi.
    if (!endpoint.startsWith('https://') || endpoint.length > 2048) {
      return reply.code(400).send({ error: apiMsg(req, 'endpoint push invalide') });
    }
    if (!p256dh || !auth || p256dh.length > 512 || auth.length > 512) {
      return reply.code(400).send({ error: apiMsg(req, 'clés push manquantes') });
    }

    const drizzle = getDrizzle();
    // Re-abonnement depuis le même navigateur : l'endpoint ne change pas, les
    // clés si — on écrase aussi user/locale (changement de compte ou de langue).
    drizzle
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint,
        p256dh,
        auth,
        locale: langFromReq(req),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh, auth, locale: langFromReq(req) },
      })
      .run();
    return reply.code(201).send({ ok: true });
  });

  app.post('/push/unsubscribe', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    const endpoint =
      typeof (req.body as { endpoint?: unknown })?.endpoint === 'string'
        ? (req.body as { endpoint: string }).endpoint.trim()
        : '';
    if (!endpoint) return reply.code(400).send({ error: apiMsg(req, 'endpoint push invalide') });

    // Scopé à l'appelant : on ne peut retirer que ses propres abonnements.
    getDrizzle()
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
      .run();
    return reply.code(204).send();
  });

  app.post('/push/test', async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return;
    if (!pushEnabled) {
      return reply
        .code(503)
        .send({ error: apiMsg(req, 'Notifications désactivées sur ce serveur (VAPID absent)') });
    }
    const result = await sendPushToUser(
      userId,
      {
        kind: 'test',
        title: { fr: 'Table Sync', en: 'Table Sync' },
        body: {
          fr: 'Notifications actives — la chaîne complète fonctionne.',
          en: 'Notifications on — the whole chain works.',
        },
        url: '/parties',
      },
      { ttl: 60, urgency: 'normal' },
    );
    return { sent: result.sent, removed: result.removed, errors: result.errors };
  });
}
