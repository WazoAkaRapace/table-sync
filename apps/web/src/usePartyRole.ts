/**
 * Rôle du membre courant dans le groupe — LA forme canonique de l'entrée de
 * cache ['party-role'] (fiche, boîte de réception MD). Une clé de requête
 * partagée ne tolère pas deux formes : chaque page qui vivait sa propre
 * queryFn empoisonnait l'entrée pour l'autre (la boîte lisait l'objet de la
 * fiche, n'y trouvait pas son booléen et renvoyait au groupe sans un mot).
 *
 * Sonde LÉGÈRE : GET /parties/:id/me ne renvoie que les deux booléens —
 * charger le détail entier du groupe (résumé de tous les personnages, ~150 Ko
 * compressés) pour un isGM coûtait la bande passante à chaque montage
 * d'onglet et à chaque vague d'invalidation (party:change, resync WS).
 */

import { useQuery } from '@tanstack/react-query';
import api from './api';
import { useAuth } from './auth';

export function usePartyRole(partyId: number | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['party-role', partyId, user?.id ?? null],
    enabled: partyId !== null && !!user,
    queryFn: async () => {
      const res = await api.get<{ isGM: boolean; playersCreateItems: boolean }>(
        `/api/parties/${partyId}/me`,
      );
      return res.data;
    },
  });
}
