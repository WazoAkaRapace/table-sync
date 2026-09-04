import type { EncounterDetail } from '@table-sync/shared';
import { keepPreviousData, type QueryClient, useQuery } from '@tanstack/react-query';
import api from './api';

/**
 * Détails des rencontres active/setup d'un groupe — liste puis détails en
 * PARALLÈLE (séquentiels avant : à 300 ms de RTT, quatre rencontres
 * coûtaient 1,2 s de latence empilée par rafale d'événements).
 */
export async function fetchActiveEncounterDetails(partyId: number): Promise<EncounterDetail[]> {
  const encRes = await api.get(`/api/parties/${partyId}/encounters`);
  const encounters = encRes.data.encounters || [];
  const relevant = encounters.filter((e: any) => e.status === 'active' || e.status === 'setup');
  const details = await Promise.all(
    relevant.map(async (summary: any) => {
      try {
        const det = await api.get(`/api/encounters/${summary.id}`);
        return det.data.encounter as EncounterDetail;
      } catch {
        return null; // 403 : le joueur n'est pas dans cette rencontre
      }
    }),
  );
  return details.filter((d): d is EncounterDetail => d != null);
}

/**
 * UNE requête partagée fiche ↔ bandeau d'en-tête : la clé ['combat-
 * encounters'] déduplique les fetchs (un même combat:change déclenchait
 * DEUX cascades liste+détails, une par composant) et le staleTime 5 s
 * absorbe les rafales. keepPreviousData : pas de flash vide au refetch.
 */
export function useActiveEncounters(partyId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['combat-encounters', partyId],
    enabled: enabled && partyId != null,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: 1,
    queryFn: () => fetchActiveEncounterDetails(partyId as number),
  });
}

/** Invalide le cache combat partagé (combat:change, initiative, fin de tour). */
export function invalidateCombat(
  qc: QueryClient,
  partyId: number | string | null | undefined,
): void {
  if (partyId == null) return;
  qc.invalidateQueries({ queryKey: ['combat-encounters', Number(partyId)] });
}
