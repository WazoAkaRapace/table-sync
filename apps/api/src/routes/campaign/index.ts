/**
 * Registrar campaign — agrège les sous-modules de routes/campaign/.
 * Découpage 2026-11 (phase 4) : déplacement pur depuis routes/campaign.ts,
 * même signature exportée (`campaignRoutes`), server.ts ne change que son
 * chemin d'import.
 */

import type { FastifyInstance } from 'fastify';
import { clockRoutes } from './clock.ts';
import { countdownsRoutes } from './countdowns.ts';
import { journalRoutes } from './journal.ts';
import { notesRoutes } from './notes.ts';
import { questsRoutes } from './quests.ts';

export async function campaignRoutes(app: FastifyInstance) {
  await clockRoutes(app);
  await journalRoutes(app);
  await countdownsRoutes(app);
  await notesRoutes(app);
  await questsRoutes(app);
}
