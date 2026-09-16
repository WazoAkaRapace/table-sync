/**
 * Compteurs de non-lus de correspondance pour le groupe courant — la source
 * unique des pastilles (hub mobile, onglet desktop, annexes MD, boîte MD).
 * Un événement message:new (livraison ciblée) rafraîchit le compteur ; la
 * lecture d'un fil l'annule aussi (le POST read invalide le préfixe).
 */

import type { UnreadMessages } from '@table-sync/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from './api';
import { useAuth } from './auth';
import { useSyncEvent } from './sync';

export function useMessagesUnread(partyId: number | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['messages-unread', partyId, user?.id ?? null],
    enabled: partyId !== null && !!user,
    queryFn: async () => {
      const res = await api.get<UnreadMessages>(`/api/parties/${partyId}/messages/unread`);
      return res.data;
    },
  });

  useSyncEvent(
    (event) => {
      // Portée par groupe : un message du groupe B n'entame pas les compteurs
      // du groupe A (l'entrée de cache est préfixée ['messages-unread'] pour
      // toutes les pastilles de CE groupe).
      if (event.type === 'message:new' && event.partyId === partyId) {
        queryClient.invalidateQueries({ queryKey: ['messages-unread'] });
      }
    },
    [partyId],
  );

  return query;
}

/** Pastille commune : encre sur anneau parchemin — lisible sur le hub sang
 *  comme sur les onglets clairs. Rend rien à 0. */
export function UnreadBadge({
  count,
  label,
  className = '',
}: {
  count: number;
  label: string;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={`flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-parchment-50 bg-ink-900 px-1 text-[10px] font-bold text-parchment-50 ${className}`}
      aria-label={label}
      title={label}
      role="status"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
