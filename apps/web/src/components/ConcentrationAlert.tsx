import type { ConcentrationCheck } from '@table-sync/shared';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';

/**
 * Floating banner telling the player to roll a Constitution save
 * (DC 10 or half the damage taken, whichever is higher) after taking
 * damage while concentrating on a spell.
 *
 * Rendered via portal (fixed positioning breaks inside .card's
 * backdrop-filter containing block).
 */
export default function ConcentrationAlert({
  check,
  onDone,
  onBreak,
}: {
  check: ConcentrationCheck;
  onDone: () => void;
  /**
   * Called when the save is failed. When provided (e.g. from the character
   * sheet), use this instead of the internal PATCH so the host page can
   * refetch its state.
   */
  onBreak?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  const breakConcentration = async () => {
    setBusy(true);
    try {
      if (onBreak) {
        await onBreak();
      } else {
        await api.patch(`/api/characters/${check.characterId}`, { concentrating: false });
      }
    } catch {
      /* the toggle on the sheet stays the source of truth */
    }
    onDone();
  };

  return createPortal(
    <div
      className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,26rem)] px-1"
      role="alert"
    >
      <div
        className="rounded-xl border-2 border-blood-500 bg-blood-50/95 backdrop-blur-sm p-4 shadow-xl space-y-3"
        style={{
          boxShadow:
            '0 0 0 2px rgb(185 28 28 / 0.55), 0 0 24px 6px rgb(185 28 28 / 0.30), 0 10px 24px rgba(42,31,20,0.25)',
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-blood-800 flex items-center gap-2">
            <span aria-hidden="true">🌀</span> Jet de concentration
          </h3>
          <button
            type="button"
            onClick={onDone}
            className="text-blood-400 hover:text-blood-700 text-lg leading-none px-1"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-blood-900">
          <strong>{check.characterName}</strong> subit <strong>{check.damage} dégâts</strong> tout
          en concentrant un sort.
        </p>
        <p className="text-sm text-blood-900">
          Jet de sauvegarde de <strong>Constitution DD {check.dc}</strong>{' '}
          <span className="text-blood-600 text-xs">(10 ou ½ dégâts, le plus élevé)</span> pour
          maintenir la concentration.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-white text-green-700 border border-green-300 hover:bg-green-50 transition-colors"
          >
            ✅ Réussi — je maintiens
          </button>
          <button
            type="button"
            onClick={breakConcentration}
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-blood-600 text-white border border-blood-700 hover:bg-blood-700 disabled:opacity-50 transition-colors"
          >
            💔 Raté — rompre
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
