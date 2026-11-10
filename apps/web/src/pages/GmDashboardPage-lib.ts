// déplacement pur depuis GmDashboardPage.tsx (ratchet R1)

/** Vue d'ensemble du roster (GET /parties/:id/roster-overview) : par
 *  personnage, les 4 chiffres dérivés que rend la carte du tableau MD. */
export interface RosterOverviewEntry {
  characterId: number;
  ac: number | null;
  weightPct: number | null;
  weightKg: number | null;
  capacityKg: number | null;
  foodCount: number;
  fullWaterCount: number;
}

export interface Transaction {
  id: number;
  partyId: number;
  characterId: number | null;
  itemId: number | null;
  itemName: string;
  deltaQty: number;
  reason: string;
  actorName: string | null;
  at: string;
}
