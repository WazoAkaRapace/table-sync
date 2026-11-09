/**
 * Fastify server entry point.
 * Runs the dev API on http://localhost:4000
 */

import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { verifyAccess } from './auth/refresh.ts';
import {
  backfillItemBases,
  backfillMonsterSearchText,
  reconcileAmmoPacks,
  reconcileHealingPotionDuplicate,
} from './db/backfill.ts';
import { runDrizzleMigrations } from './db/drizzle.ts';
import { migrate } from './db/index.ts';
import { seedItems, seedMonsters, seedSpells } from './db/seed.ts';
import { emailEnabled } from './email/config.ts';
import { pushEnabled } from './push/config.ts';
import { errorRateLimit } from './rateLimit.ts';
import { authRoutes } from './routes/auth.ts';
import { campaignRoutes } from './routes/campaign.ts';
import { characterFeatureRoutes } from './routes/character-features.ts';
import { characterMessageRoutes } from './routes/character-messages.ts';
import { characterNoteRoutes } from './routes/character-notes.ts';
import { characterSpellEffectRoutes } from './routes/character-spell-effects.ts';
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
  // Compression des réponses JSON (gzip/brotli selon Accept-Encoding) — sans
  // elle, chaque payload traverse le fil en brut (~5× trop gros sur une
  // liaison lente). Seuil 1 Ko : les petites réponses (< ETag/health) partent
  // telles quelles. nginx ne re-comprime jamais ce qui porte déjà un
  // Content-Encoding, aucun double travail.
  await app.register(compress, { threshold: 1024 });
  // Cookies (refresh token HttpOnly — auth/refresh.ts). Parse par défaut à
  // onRequest : req.cookies est disponible partout, y compris routes publiques.
  await app.register(cookie);
  await app.register(cors, CORS_ORIGINS.length > 0 ? { origin: CORS_ORIGINS } : { origin: true });
  await app.register(jwt, {
    secret: JWT_SECRET,
    // 24 h (était 7 j) : fenêtre de vol réduite — le refresh cookie (30 j
    // glissants) maintient la session, le JWT ne survit qu'une journée.
    sign: { expiresIn: '24h' },
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

  // Gestionnaire d'erreurs global : toute erreur NON anticipée rend un 500
  // JSON structuré { error: <message> } (le contrat {error} existant) au lieu
  // du payload Fastify par défaut — la stack part dans les logs serveur
  // (app.log.error), JAMAIS dans la réponse ; en NODE_ENV=production le
  // message client devient générique. Les erreurs < 500 (validation Fastify,
  // 4xx métier) passent telles quelles : les 400 apiMsg i18n des routes ne
  // doivent jamais être réécrits (des tests les épignent).
  app.setErrorHandler((err, _request, reply) => {
    const status = err.statusCode ?? 500;
    if (reply.sent) return; // la route a déjà répondu : ne rien réécrire
    if (status < 500) return reply.send(err);
    app.log.error(err);
    const message =
      process.env.NODE_ENV === 'production' ? 'erreur interne' : (err.message ?? 'erreur interne');
    return reply.status(500).send({ error: message });
  });

  // Health check (public)
  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  // Route de test du gestionnaire d'erreurs — montée UNIQUEMENT sous
  // TEST_ONLY=error-handler (mod-error-handler.ts boote sa propre instance
  // avec cette variable). Hors /api : hors du garde d'auth global.
  if (process.env.TEST_ONLY === 'error-handler') {
    app.get('/__test/boom', async () => {
      throw new Error('boom intentionnel (error-handler)');
    });
  }

  // Auth decorator — header Authorization d'abord (scripts/tests), sinon le
  // cookie HttpOnly ts_access (le chemin du navigateur). Cf. verifyAccess.
  app.decorate('authenticate', async (request: any, reply: any) => {
    if (!(await verifyAccess(request))) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // Global auth guard: require JWT on all /api routes EXCEPT public ones.
  // /ws and the item-image GET authenticate via query param token, so they're
  // excluded here (the image GET verifies its token itself; its PUT/DELETE
  // siblings self-authenticate via their onRequest hook). GET /api/auth/token
  // n'est PAS dans l'allowlist : elle est authentifiée par le cookie
  // ts_access (c'est l'échange contrôlé JWT ↔ cookie pour WS/images).
  app.addHook('onRequest', async (request: any, reply: any) => {
    const url = request.url.split('?')[0];
    if (
      url === '/api/health' ||
      url === '/api/auth/login' ||
      url === '/api/auth/register' ||
      url === '/api/auth/logout' ||
      url === '/api/auth/refresh' ||
      url === '/api/auth/forgot-password' ||
      url === '/api/auth/reset-password' ||
      url === '/api/auth/verify-email' ||
      url === '/ws' ||
      /^\/api\/items\/\d+\/image$/.test(url)
    ) {
      return; // public routes
    }
    if (!url.startsWith('/api/')) return;
    if (!(await verifyAccess(request))) {
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
  await app.register(characterSpellEffectRoutes, { prefix: '/api' });
  await app.register(characterFeatureRoutes, { prefix: '/api' });
  await app.register(characterNoteRoutes, { prefix: '/api' });
  await app.register(characterMessageRoutes, { prefix: '/api' });
  await app.register(monsterRoutes, { prefix: '/api' });
  await app.register(combatRoutes, { prefix: '/api' });
  await app.register(wildShapeRoutes, { prefix: '/api' });
  await app.register(domainSpellRoutes, { prefix: '/api' });
  await app.register(restRoutes, { prefix: '/api' });
  await app.register(campaignRoutes, { prefix: '/api' });
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
  try {
    backfillMonsterSearchText();
  } catch (err) {
    console.warn(`[server] monster search backfill skipped: ${(err as Error).message}`);
  }
  try {
    // #143/A7 : réconcilie les lots de munitions ajoutés AVANT le fix — les
    // lignes « Flèches (20) » mortes (pas de tag de tir) deviennent des
    // unités sur la munition taggée. Idempotent : après la passe, plus
    // aucune ligne de lot n'existe.
    reconcileAmmoPacks();
  } catch (err) {
    console.warn(`[server] ammo pack reconciliation skipped: ${(err as Error).message}`);
  }
  try {
    // 2026-11 : la Potion de soin basique existait en double au seed SRD —
    // les inventaires pointant l'entrée « variable » partent sur l'entrée
    // « commune », puis la ligne obsolète disparaît. Idempotent.
    reconcileHealingPotionDuplicate();
  } catch (err) {
    console.warn(`[server] healing potion dedup skipped: ${(err as Error).message}`);
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
