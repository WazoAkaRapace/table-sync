/**
 * LE CHIP « JOUR N » (#159) — l'horloge de campagne dans l'en-tête collant,
 * à gauche du titre, sur toutes les pages du groupe. Le tap mène à l'onglet
 * Calendrier de la fiche ACTIVE de l'utilisateur (sa première fiche visible
 * du groupe), à défaut à la page du groupe (un MD sans fiche).
 *
 * Sonde légère : l'entrée react-query ['campaign-day'] est partagée avec la
 * vue semaine et invalidée sur campaign:change (campaignCalendar.ts).
 * Le 403 (visiteur retiré du groupe en pleine session) fait juste disparaître
 * le chip — la page sous-jacente porte son propre état d'erreur.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from './api';
import { useAuth } from './auth';
import { useCampaignInvalidation, useLightDay } from './campaignCalendar';
import { Glyph } from './components/Glyph';

interface CharacterSummaryLite {
  id: number;
  ownerId: number;
  hidden: boolean;
}

export default function CampaignDayChip({ partyId }: { partyId: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dayQuery = useLightDay(partyId);
  useCampaignInvalidation(partyId);

  // Fiche active du compte dans CE groupe (fiche non cachée ; cachée = propre
  // au MD pour préparer en secret — le chip ne doit pas y mener).
  const rosterQuery = useQuery({
    queryKey: ['campaign-chip-roster', partyId],
    enabled: dayQuery.isSuccess,
    queryFn: async () => {
      const res = await api.get<{ characters: CharacterSummaryLite[] }>(
        `/api/parties/${partyId}/characters`,
      );
      return res.data.characters;
    },
    staleTime: 60_000,
  });
  const mine = rosterQuery.data?.find((c) => c.ownerId === user?.id && !c.hidden) ?? null;
  const day = dayQuery.data?.state.day ?? null;

  if (day === null) return null;

  return (
    <Link
      to={mine ? `/party/${partyId}/character/${mine.id}?tab=calendar` : `/party/${partyId}`}
      className="flex min-h-11 items-center rounded-full border border-gold-600/60 bg-night-800 px-3 text-sm font-medium text-gold-300 hover:bg-night-700 transition-colors shrink-0"
      aria-label={t('calendrier.chip.aria', { day })}
      title={t('calendrier.chip.aria', { day })}
    >
      <span aria-hidden="true" className="mr-1.5">
        <Glyph name="calendar" />
      </span>
      {t('carnet.jours.passe', { day })}
    </Link>
  );
}
