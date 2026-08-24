import type { Character } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import api from '../../api';
import type { SheetActionProps } from './types';

interface DeathSaveTrackerProps extends SheetActionProps {
  character: Character;
  charId: number;
}

export function DeathSaveTracker({
  character,
  charId,
  markLocalMutation,
  onSaved,
  onError,
}: DeathSaveTrackerProps) {
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
      onError('Erreur de mise à jour');
    }
  };

  const isDead = failures >= 3;
  const isStable = successes >= 3;

  return (
    <div
      className={`rounded-xl p-3 border ${isDead ? 'bg-red-50 border-red-300' : isStable ? 'bg-green-50 border-green-300' : 'bg-parchment-100 border-parchment-300'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-ink-700">
          💀 Jets de sauvegarde contre la mort
        </span>
        {isDead && <span className="text-xs font-bold text-red-600">MORT</span>}
        {isStable && <span className="text-xs font-bold text-green-600">STABLE</span>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {/* Successes — tap a circle to toggle that position */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-green-600 font-medium w-12">Succès</span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => {
              const filled = i < successes;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => updateSaves('successes', filled ? i : i + 1)}
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                    filled
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'bg-white border-green-300 text-green-300 hover:border-green-500 hover:scale-110'
                  }`}
                  aria-label={`Succès ${i + 1}: ${filled ? 'coché' : 'vide'}`}
                >
                  ✓
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
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                    filled
                      ? 'bg-red-500 border-red-500 text-white'
                      : 'bg-white border-red-300 text-red-300 hover:border-red-500 hover:scale-110'
                  }`}
                  aria-label={`Échec ${i + 1}: ${filled ? 'coché' : 'vide'}`}
                >
                  ✗
                </button>
              );
            })}
          </div>
          <span className="text-xs text-red-600 font-medium w-12 text-right">Échecs</span>
        </div>
      </div>
    </div>
  );
}
