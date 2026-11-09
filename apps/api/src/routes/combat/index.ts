/**
 * Registrar combat — agrège les sous-modules de routes/combat/.
 * Découpage 2026-11 (phase 4d) : déplacement pur depuis routes/combat.ts,
 * même signature exportée (`combatRoutes`), server.ts ne change que son
 * chemin d'import. Ordre d'enregistrement = ordre historique du monolithe,
 * au détail près que DELETE /combatants/:cid (ex-10e route) suit désormais
 * son PATCH (ex-9e) — verbes distincts, aucune ambiguïté de routage.
 */

import type { FastifyInstance } from 'fastify';
import { combatantRoutes } from './combatants.ts';
import { combatantUpdateRoutes } from './update.ts';
import { encounterRoutes } from './encounters.ts';
import { turnRoutes } from './turns.ts';

export async function combatRoutes(app: FastifyInstance) {
  await encounterRoutes(app);
  await combatantRoutes(app);
  await combatantUpdateRoutes(app);
  await turnRoutes(app);
}
