/**
 * Registrar characters — agrège les sous-modules de routes/characters/.
 * Découpage 2026-11 (phase 4) : déplacement pur depuis routes/characters.ts,
 * même signature exportée (`characterRoutes`), server.ts ne change que son
 * chemin d'import.
 */

import type { FastifyInstance } from 'fastify';
import { characterSheetRoutes } from './sheet.ts';
import { characterUpdateRoutes } from './update.ts';

export async function characterRoutes(app: FastifyInstance) {
  await characterSheetRoutes(app);
  await characterUpdateRoutes(app);
}
