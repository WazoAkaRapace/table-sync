// Hook partagé des onglets de contenus personnalisés du pupitre MD (objets,
// sorts, monstres — plan « Contenus personnalisés ») : chargement initial,
// réveil ciblé sur SA valeur d'action WS (vocabulaire v2 : chaque onglet ne
// se réveille que sur ses propres écritures) et rattrapage du trou de
// reconnexion (page à état local, les événements ne sont jamais rejoués).
import { useEffect } from 'react';
import { useResyncOnReconnect, useSyncEvent } from '../../sync';

export function usePartyContentSync(
  partyId: string,
  action: 'custom-item' | 'custom-spell' | 'custom-monster',
  load: () => void | Promise<void>,
) {
  useEffect(() => {
    void load();
  }, [load]);
  // Rattrapage de reconnexion : les événements du trou ne seront jamais rejoués.
  useResyncOnReconnect(() => void load());
  useSyncEvent(
    (event) => {
      if (event.partyId === Number(partyId) && event.action === action) {
        void load();
      }
    },
    [partyId],
  );
}
