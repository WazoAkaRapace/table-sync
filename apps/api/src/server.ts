/**
 * Fastify server entry point.
 * Runs the dev API on http://localhost:4000
 */

import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { backfillItemBases } from './db/backfill.ts';
import { runDrizzleMigrations } from './db/drizzle.ts';
import { migrate } from './db/index.ts';
import { seedItems, seedMonsters, seedSpells } from './db/seed.ts';
import { emailEnabled } from './email/config.ts';
import { pushEnabled } from './push/config.ts';
import { errorRateLimit } from './rateLimit.ts';
import { authRoutes } from './routes/auth.ts';
import { characterFeatureRoutes } from './routes/character-features.ts';
import { characterNoteRoutes } from './routes/character-notes.ts';
import { characterSpellRoutes } from './routes/character-spells.ts';
import { characterRoutes } from './routes/characters.ts';
import { combatRoutes } from './routes/combat.ts';
import { domainSpellRoutes } from './routes/domain-spells.ts';
import { gmaRoutes } from './routes/gma.ts';
import { inventoryRoutes } from './routes/inventory.ts';
import { itemImageRoutes } from './routes/item-images.ts';
import { itemRoutes } from './routes/items.ts';
import { locationRoutes } from './routes/locations.ts';
import { monsterRoutes } from './routes/monsters.ts';
import { npcRoutes } from './routes/npcs.ts';
import { partyRoutes } from './routes/parties.ts';
import { pushRoutes } from './routes/push.ts';
import { restRoutes } from './routes/rest.ts';
import { spellRoutes } from './routes/spells.ts';
import { wildShapeRoutes } from './routes/wildshape.ts';
import { registerWsRoutes } from './sync/ws.ts';

const PORT = parseInt(process.env.PORT || '4000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-in-production';
if (JWT_SECRET === 'dev-only-change-me-in-production') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a strong random value in production');
  }
  console.warn('[server] WARNING: using dev JWT secret — set JWT_SECRET outside local dev');
}
// CORS allowlist (comma-separated). Empty = reflect any origin (local dev only).
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function buildServer() {
  const app = Fastify({
    logger: {
      serializers: {
        // Strip the WS auth token (?token=<JWT>) from logged URLs.
        req(req: any) {
          const url =
            typeof req.url === 'string'
              ? req.url.replace(/([?&])token=[^&]*/, '$1token=***')
              : req.url;
          return {
            method: req.method,
            url,
            remoteAddress: req.remoteAddress,
            remotePort: req.remotePort,
          };
        },
      },
    },
  });

  // Plugins
  await app.register(cors, CORS_ORIGINS.length > 0 ? { origin: CORS_ORIGINS } : { origin: true });
  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: { expiresIn: '7d' },
  });
  // Error-scoped rate limiting: only failed responses consume budget, so a
  // whole table sharing one IP (or one nginx proxy IP) is never blocked by
  // normal successful usage. Installed as plain root-level hooks (not a
  // registered plugin) so they apply to every /api route below.
  await errorRateLimit(app);
  // Multipart uploads (item illustrations). fileSize ceiling aligns with the
  // PUT route's bodyLimit — the 2 MB business rule lives in the route itself.
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(websocket);

  // Health check (public)
  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  // Auth decorator
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // Global auth guard: require JWT on all /api routes EXCEPT public ones.
  // /ws and the item-image GET authenticate via query param token, so they're
  // excluded here (the image GET verifies its token itself; its PUT/DELETE
  // siblings self-authenticate via their onRequest hook).
  app.addHook('onRequest', async (request: any, reply: any) => {
    const url = request.url.split('?')[0];
    if (
      url === '/api/health' ||
      url === '/api/auth/login' ||
      url === '/api/auth/register' ||
      url === '/api/auth/logout' ||
      url === '/api/auth/forgot-password' ||
      url === '/api/auth/reset-password' ||
      url === '/api/auth/verify-email' ||
      url === '/ws' ||
      /^\/api\/items\/\d+\/image$/.test(url)
    ) {
      return; // public routes
    }
    if (!url.startsWith('/api/')) return;
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(itemRoutes, { prefix: '/api' });
  await app.register(itemImageRoutes, { prefix: '/api' });
  await app.register(partyRoutes, { prefix: '/api' });
  await app.register(characterRoutes, { prefix: '/api' });
  await app.register(inventoryRoutes, { prefix: '/api' });
  await app.register(locationRoutes, { prefix: '/api' });
  await app.register(npcRoutes, { prefix: '/api' });
  await app.register(spellRoutes, { prefix: '/api' });
  await app.register(characterSpellRoutes, { prefix: '/api' });
  await app.register(characterFeatureRoutes, { prefix: '/api' });
  await app.register(characterNoteRoutes, { prefix: '/api' });
  await app.register(monsterRoutes, { prefix: '/api' });
  await app.register(combatRoutes, { prefix: '/api' });
  await app.register(wildShapeRoutes, { prefix: '/api' });
  await app.register(domainSpellRoutes, { prefix: '/api' });
  await app.register(restRoutes, { prefix: '/api' });
  await app.register(gmaRoutes, { prefix: '/api' });
  await app.register(pushRoutes, { prefix: '/api' });

  // WebSocket (real-time sync)
  await registerWsRoutes(app);

  return app;
}

async function start() {
  // Auto-migrate + seed on boot (idempotent)
  migrate();
  runDrizzleMigrations();
  backfillItemBases();
  try {
    seedItems();
  } catch (err) {
    console.warn(`[server] seed skipped: ${(err as Error).message}`);
  }
  try {
    seedSpells();
  } catch (err) {
    console.warn(`[server] spell seed skipped: ${(err as Error).message}`);
  }
  try {
    seedMonsters();
  } catch (err) {
    console.warn(`[server] monster seed skipped: ${(err as Error).message}`);
  }

  const app = await buildServer();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 API running at http://localhost:${PORT}`);
    console.log(`🔌 WebSocket at ws://localhost:${PORT}/ws`);
    console.log(
      pushEnabled
        ? '🔔 Push notifications: activé'
        : '🔕 Push notifications: désactivé (VAPID absent)',
    );
    console.log(
      emailEnabled
        ? '📧 Emails transactionnels: activé (mailjet)'
        : '📭 Emails transactionnels: désactivés (MAILJET absent)',
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
