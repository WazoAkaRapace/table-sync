/**
 * Registrar GM Assistant — agrège les sous-modules de routes/gma/.
 * Découpage 2026-11 (phase 4e) : déplacement pur depuis routes/gma.ts,
 * même signature exportée (`gmaRoutes`), server.ts ne change que son chemin
 * d'import. Ordre d'enregistrement = ordre historique du monolithe (les 19
 * routes y figurent dans le même ordre — aucun chevauchement de chemins).
 *
 * Deux moitiés : le compte (clé GMA par utilisateur, chiffrée côté serveur)
 * et le groupe (lien campagne, init one-shot, resync personnages, chronique
 * et rail « PNJ repérés » servis du cache SQLite). Les appels upstream passent
 * par src/gma/client.ts et résolvent la clé du MD qui a créé le lien
 * (linked_by) — sauf le picker de campagnes, qui montre celles du MD appelant.
 */

import type { FastifyInstance } from 'fastify';
import { accountRoutes } from './account.ts';
import { characterSyncRoutes } from './characters.ts';
import { chronicleRoutes } from './chronicle.ts';
import { entityRoutes } from './entities.ts';
import { initRoutes } from './init.ts';
import { linkRoutes } from './link.ts';

export async function gmaRoutes(app: FastifyInstance) {
  await accountRoutes(app);
  await linkRoutes(app);
  await initRoutes(app);
  await characterSyncRoutes(app);
  await chronicleRoutes(app);
  await entityRoutes(app);
}
