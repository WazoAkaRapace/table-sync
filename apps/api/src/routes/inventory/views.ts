/**
 * Vues d'inventaire — fiche complète d'un personnage (entrées en résumé,
 * emplacements, poids et encombrement) via loadInventoryView, réutilisée par
 * la vue d'ensemble du tableau MD. Découpage 2026-11 (phase 4) : déplacement
 * pur depuis routes/inventory.ts.
 */

import { type CharacterInventory, computeInventoryWeights } from '@table-sync/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { characters, inventory, items, parties, storageLocations, users } from '../../db/schema.ts';
import { attachCharacterClasses } from '../lib/character-classes.ts';
import { checkCharacterAccess } from '../lib/access.ts';
import { mapCharacter, mapInventoryEntry } from '../lib/mappers.ts';
import { requireUser } from '../lib/membership.ts';
import { type AppLang, langFromReq } from '../lang.ts';
import { apiMsg } from '../messages.ts';
import { INVENTORY_WITH_ITEM } from './shared.ts';

/**
 * Entrées + lieux + poids d'un personnage — le cœur de GET
 * /characters/:id/inventory, réutilisé par la vue d'ensemble du tableau MD
 * (GET /parties/:id/roster-overview : UNE requête par groupe au lieu de N
 * fiches complètes). `char` doit porter encumbrance_mode (JOIN parties).
 */
export async function loadInventoryView(
  drizzle: ReturnType<typeof getDrizzle>,
  char: any,
  lang: AppLang = 'fr',
): Promise<{
  entries: any[];
  locations: any[];
  encumbrance: any;
  locationWeights: any;
  carriedLocId: number;
  character: any;
}> {
  const cleanRows = drizzle
    .select(INVENTORY_WITH_ITEM)
    .from(inventory)
    .innerJoin(items, eq(items.id, inventory.itemId))
    .where(eq(inventory.characterId, char.id))
    .orderBy(desc(inventory.equipped), sql`${items.name} COLLATE NOCASE ASC`)
    .all();

  // Ensure carried location exists
  const { ensureCarriedLocation } = await import('../locations.ts');
  const carriedLocId = ensureCarriedLocation(char.id);

  const locRows = drizzle
    .select(cols(storageLocations))
    .from(storageLocations)
    .where(eq(storageLocations.characterId, char.id))
    .orderBy(storageLocations.sortOrder, storageLocations.type, storageLocations.id)
    .all() as any[];
  const locations = locRows.map((r: any) => ({
    id: r.id,
    characterId: r.character_id,
    name: r.name,
    type: r.type,
    strength: r.strength,
    multiplier: r.multiplier,
    capacityKg: r.capacity_kg,
    ownWeightKg: r.own_weight_kg,
    itemId: r.item_id,
    sortOrder: r.sort_order,
  }));

  // Objets embarqués en RÉSUMÉ (description à null via mapInventoryEntry) :
  // la fiche entière re-descend après CHAQUE mutation et à chaque événement
  // de synchronisation — la prose des objets en était le gros du fil. Les
  // lignes la chargent à l'ouverture (GET /items/:id, mis en cache client).
  const cleanEntries = cleanRows.map((r: any) => {
    const entry = mapInventoryEntry(r, lang);
    if (entry.storageLocationId == null) entry.storageLocationId = carriedLocId;
    return entry;
  }) as any[];

  // ---- Poids par emplacement + encombrement (moteur partagé) ----
  // Extrait vers packages/shared (computeInventoryWeights) : le client le
  // rejoue après une mutation locale (setQueryData) sans re-télécharger
  // la fiche — UNE seule implémentation des deux côtés du fil.
  // Multiclassage : joindre les lignes de classe (source de vérité moteur)
  attachCharacterClasses([char]);
  const character = mapCharacter(char);
  const weights = computeInventoryWeights(
    character,
    cleanEntries,
    locations,
    char.encumbrance_mode,
    carriedLocId,
  );

  return {
    entries: cleanEntries,
    locations,
    encumbrance: weights.encumbrance,
    locationWeights: weights.locationWeights,
    carriedLocId,
    character,
  };
}

export async function viewsRoutes(app: FastifyInstance) {
  // ---------- Get character inventory (with computed kg encumbrance) ----------
  app.get(
    '/characters/:id/inventory',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();

      const char = drizzle
        .select({
          ...cols(characters),
          encumbrance_mode: parties.encumbranceMode,
          owner_name: users.displayName,
        })
        .from(characters)
        .innerJoin(parties, eq(parties.id, characters.partyId))
        .innerJoin(users, eq(users.id, characters.ownerId))
        .where(eq(characters.id, Number(req.params.id)))
        .get() as any;
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!checkCharacterAccess(req, reply, char, userId, { access: 'member-visible' })) return;

      const view = await loadInventoryView(drizzle, char, langFromReq(req));

      const result: CharacterInventory = {
        character: view.character,
        entries: view.entries,
        // Mode exposé pour que le client recalcule les poids localement
        encumbranceMode: char.encumbrance_mode,
        encumbrance: view.encumbrance,
        locations: view.locations,
        locationWeights: view.locationWeights,
      };
      return reply.send(result);
    },
  );
}
