/**
 * Rôle du membre courant dans le groupe — LA forme canonique de l'entrée de
 * cache ['party-role'] (fiche, boîte de réception MD). Une clé de requête
 * partagée ne tolère pas deux formes : chaque page qui vivait sa propre
 * queryFn empoisonnait l'entrée pour l'autre (la boîte lisait l'objet de la
 * fiche, n'y trouvait pas son booléen et renvoyait au groupe sans un mot).
 */

import type { PartyDetail } from '@table-sync/shared';
import { useQuery } from '@tanstack/react-query';
import api from './api';
import { useAuth } from './auth';

export function usePartyRole(partyId: number | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['party-role', partyId, user?.id ?? null],
    enabled: partyId !== null && !!user,
    queryFn: async () => {
      const res = await api.get<PartyDetail>(`/api/parties/${partyId}`);
      return {
        isGM: res.data.members.some((m) => m.userId === user?.id && m.role === 'gm'),
        playersCreateItems: res.data.party.playersCreateItems,
      };
    },
  });
}
