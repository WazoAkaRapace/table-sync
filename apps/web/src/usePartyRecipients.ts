import type { CharacterSummary, PartyDetail } from '@table-sync/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from './api';
import { apiError } from './pages/character/types';

/**
 * Liste les destinataires possibles d'un transfert : les personnages du
 * groupe, membre d'origine exclue. Une seule requête par ouverture de la
 * porte (annulation propre au démontage / fermeture) ; le même dialecte
 * sert au transfert d'objet, de conteneur et de bourse.
 */
export function usePartyRecipients(
  open: boolean,
  partyId: string | undefined,
  charId: number,
  onError: (msg: string) => void,
): { loadingParty: boolean; others: CharacterSummary[] } {
  const { t } = useTranslation();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [loadingParty, setLoadingParty] = useState(false);
  // CodeRabbit #288 : l'identité du callback change à chaque rendu des
  // appelants — la dernière valeur vit dans une ref, jamais dans les deps
  // (sinon l'effet refetcherait à chaque rendu de la modale ouverte).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!open || !partyId) return;
    let cancelled = false;
    setLoadingParty(true);
    api
      .get<PartyDetail>(`/api/parties/${partyId}`)
      .then((res) => {
        if (!cancelled) setParty(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) onErrorRef.current(apiError(err, t('transfert.groupe.introuvable')));
      })
      .finally(() => {
        if (!cancelled) setLoadingParty(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, partyId, t]);

  const others: CharacterSummary[] = party ? party.characters.filter((c) => c.id !== charId) : [];
  return { loadingParty, others };
}
