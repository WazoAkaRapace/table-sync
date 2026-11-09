/**
 * Gestionnaire d'erreurs global (setErrorHandler dans server.ts — phase 0
 * qualité backend). Prouve :
 *
 *  1. Une route qui throw rend un 500 JSON { error: <message> } — pas le
 *     payload Fastify par défaut ({statusCode, error, message}), et AUCUNE
 *     stack dans la réponse (dev comme prod).
 *  2. En NODE_ENV=production le message client devient générique
 *     (« erreur interne »).
 *  3. Un 400 métier existant (login vide → apiMsg) reste byte-identique :
 *     le handler ne réécrit JAMAIS les erreurs < 500 déjà envoyées par les
 *     routes (les tests i18n des 400 apiMsg les épignent).
 *
 * La route qui throw volontairement n'est montée que sous
 * TEST_ONLY=error-handler (instance dédiée, comme mod-heartbeat boote la
 * sienne) — elle n'existe sur aucune instance réelle.
 */
import {
  api,
  eq,
  type Fixtures,
  mintToken,
  ok,
  type ServerHandle,
  startServer,
} from './harness.ts';

export async function run(base: string, _fx: Fixtures, _srv: ServerHandle): Promise<void> {
  // ---------- 400 métier : byte-identique, jamais réécrit ----------
  const r400 = await api(base, 'POST', '/api/auth/login', { body: {} });
  eq(r400.status, 400, 'login vide → 400');
  eq(
    JSON.stringify(Object.keys(r400.data)),
    '["error"]',
    'corps 400 = { error } uniquement (contrat apiMsg inchangé)',
  );
  eq(r400.data.error, 'nom d’utilisateur et mot de passe requis', 'message 400 apiMsg FR inchangé');

  // ---------- instance dédiée : la route qui throw (mode dev) ----------
  const boom = await startServer({ extraEnv: { TEST_ONLY: 'error-handler' } });
  try {
    const r = await api(boom.base, 'GET', '/__test/boom', { token: mintToken(1) });
    eq(r.status, 500, 'route qui throw → 500');
    eq(JSON.stringify(Object.keys(r.data)), '["error"]', 'corps 500 = { error } uniquement');
    ok(!('statusCode' in r.data), 'pas de statusCode Fastify par défaut dans le corps');
    ok(!('message' in r.data), 'pas de message Fastify par défaut dans le corps');
    ok(!JSON.stringify(r.data).includes('stack'), 'aucune stack dans la réponse (dev)');
    eq(
      r.data.error,
      'boom intentionnel (error-handler)',
      'en dev le message client = message de l’erreur',
    );
  } finally {
    await boom.stop();
  }

  // ---------- mode production : message générique, jamais de stack ----------
  const prod = await startServer({
    extraEnv: { TEST_ONLY: 'error-handler', NODE_ENV: 'production' },
  });
  try {
    const r = await api(prod.base, 'GET', '/__test/boom', { token: mintToken(1) });
    eq(r.status, 500, 'prod : route qui throw → 500');
    eq(r.data.error, 'erreur interne', 'prod : message client générique');
    ok(!JSON.stringify(r.data).includes('stack'), 'prod : aucune stack dans la réponse');
  } finally {
    await prod.stop();
  }
}
