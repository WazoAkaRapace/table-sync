import type { Character } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import type { SheetActionProps } from './types';
import { Glyph } from '../../components/Glyph';

interface DeathSaveTrackerProps extends SheetActionProps {
  character: Character;
  charId: number;
  /** Only the sheet owner or GM can act on the tally (#146). */
  canEdit: boolean;
}

export function DeathSaveTracker({
  character,
  charId,
  canEdit,
  markLocalMutation,
  onSaved,
  onError,
}: DeathSaveTrackerProps) {
  const { t } = useTranslation();
  const [successes, setSuccesses] = useState(character.deathSaveSuccesses ?? 0);
  const [failures, setFailures] = useState(character.deathSaveFailures ?? 0);

  useEffect(() => {
    setSuccesses(character.deathSaveSuccesses ?? 0);
    setFailures(character.deathSaveFailures ?? 0);
  }, [character.deathSaveSuccesses, character.deathSaveFailures]);

  const updateSaves = async (type: 'successes' | 'failures', value: number) => {
    const clamped = Math.max(0, Math.min(3, value));
    markLocalMutation();
    const field = type === 'successes' ? 'deathSaveSuccesses' : 'deathSaveFailures';
    try {
      await api.patch(`/api/characters/${charId}`, { [field]: clamped });
      await onSaved();
    } catch {
      onError(t('mort.erreur.de.mise.a.jour'));
    }
  };

  const isDead = failures >= 3;
  const isStable = successes >= 3;

  /** #146 : un tiers stabilise le mourant — la manœuvre réussit, la fiche
   * pose les trois succès d'un coup (le joueur garde la main sur les pips). */
  const stabilize = async () => {
    markLocalMutation();
    try {
      await api.patch(`/api/characters/${charId}`, {
        deathSaveSuccesses: 3,
        deathSaveFailures: 0,
      });
      await onSaved();
    } catch {
      onError(t('mort.erreur.de.mise.a.jour'));
    }
  };

  return (
    <div
      className={`rounded-xl p-3 border ${isDead ? 'bg-red-50 border-red-300' : isStable ? 'bg-green-50 border-green-300' : 'bg-parchment-100 border-parchment-300'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-ink-700">
          {t('mort.jets.de.sauvegarde.contre.la.mort')}
        </span>
        {isDead && <span className="text-xs font-bold text-red-700">{t('mort.mort')}</span>}
        {isStable && <span className="text-xs font-bold text-green-700">{t('mort.stable')}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {/* Successes — tap a circle to toggle that position */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-green-700 font-medium w-12">{t('mort.succes')}</span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => {
              const filled = i < successes;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => updateSaves('successes', filled ? i : i + 1)}
                  className={`relative w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all after:absolute after:-inset-2 after:rounded-full after:content-[''] ${
                    filled
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'bg-raised border-green-300 text-green-300 hover:border-green-600 hover:scale-110'
                  }`}
                  aria-label={t('mort.succes.i.1.filled.coch.vide', {
                    i: i + 1,
                    filled: filled ? t('mort.coche') : t('mort.vide'),
                  })}
                >
                  <Glyph name="check" />
                </button>
              );
            })}
          </div>
        </div>
        {/* Failures — tap a circle to toggle that position */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => {
              const filled = i < failures;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => updateSaves('failures', filled ? i : i + 1)}
                  className={`relative w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all after:absolute after:-inset-2 after:rounded-full after:content-[''] ${
                    filled
                      ? 'bg-red-500 border-red-500 text-white'
                      : 'bg-raised border-red-300 text-red-300 hover:border-red-600 hover:scale-110'
                  }`}
                  aria-label={t('mort.echec.i.1.filled.coch.vide', {
                    i: i + 1,
                    filled: filled ? t('mort.coche') : t('mort.vide'),
                  })}
                >
                  <Glyph name="close" />
                </button>
              );
            })}
          </div>
          <span className="text-xs text-red-700 font-medium w-12 text-right">
            {t('mort.echecs')}
          </span>
        </div>
      </div>
      {canEdit && !isStable && !isDead && (
        <button
          type="button"
          onClick={stabilize}
          className="mt-2 w-full min-h-11 rounded-lg border border-green-200 bg-green-50 px-3 text-sm font-medium text-green-700 transition-colors hover:border-green-600 hover:bg-green-100"
        >
          {t('mort.se.stabiliser')}
        </button>
      )}
    </div>
  );
}
