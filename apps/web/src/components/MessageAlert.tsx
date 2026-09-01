/**
 * Bannière d'arrivée de correspondance — « le sceau tombe ». Géométrie du
 * ConcentrationAlert (portal document.body, top centré sous l'en-tête) mais
 * registre encre : une lettre arrive, elle ne blesse personne. Le corps ne
 * montre JAMAIS le message (il peut attendre dans le fil) — l'émetteur et le
 * personnage suffisent à décider d'ouvrir. band-rise : la même phrase courte
 * que la ligne Agir au moment où le tour devient tien.
 */

import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export interface MessageAlertPayload {
  partyId: number;
  characterId: number;
  characterName: string;
  fromGM: boolean;
  senderName: string;
}

export default function MessageAlert({
  notice,
  onDone,
}: {
  notice: MessageAlertPayload;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const open = () => {
    onDone();
    navigate(
      notice.fromGM
        ? `/party/${notice.partyId}/character/${notice.characterId}?tab=messages`
        : `/party/${notice.partyId}/messages`,
    );
  };

  return createPortal(
    <div
      id="message-alert"
      className="band-rise fixed top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.5rem)] left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2"
      role="status"
    >
      <div className="rounded-xl border-2 border-ink-700 bg-parchment-50/95 p-3 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <span className="text-xl leading-none" aria-hidden="true">
            ✉️
          </span>
          <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
            {notice.fromGM
              ? t('msgs.banniere.md')
              : t('msgs.banniere.joueur', { name: notice.senderName })}
            <span className="block truncate font-normal text-ink-500">{notice.characterName}</span>
          </p>
          <button
            type="button"
            onClick={onDone}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-parchment-200 hover:text-ink-700"
            aria-label={t('cast.fermer')}
          >
            ✕
          </button>
        </div>
        <button type="button" onClick={open} className="btn-primary mt-2 w-full text-sm">
          {t('msgs.ouvrir')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
