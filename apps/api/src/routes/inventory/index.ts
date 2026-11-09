/**
 * Registrar inventory — agrège les sous-modules de routes/inventory/.
 * Découpage 2026-11 (phase 4) : déplacement pur depuis routes/inventory.ts,
 * même signature exportée (`inventoryRoutes`), server.ts ne change que son
 * chemin d'import. Réexporte la surface historique du fichier (vue et
 * projection i_*) pour ses consommateurs routes (characters/sheet.ts,
 * item-images.ts).
 */

import type { FastifyInstance } from 'fastify';
import { containersRoutes } from './containers.ts';
import { flowsRoutes } from './flows.ts';
import { entriesRoutes } from './entries.ts';
import { ledgerRoutes } from './ledger.ts';
import { transfersRoutes } from './transfers.ts';
import { viewsRoutes } from './views.ts';

export { INVENTORY_WITH_ITEM } from './shared.ts';
export { loadInventoryView } from './views.ts';

export async function inventoryRoutes(app: FastifyInstance) {
  await viewsRoutes(app);
  await entriesRoutes(app);
  await transfersRoutes(app);
  await containersRoutes(app);
  await flowsRoutes(app);
  await ledgerRoutes(app);
}
