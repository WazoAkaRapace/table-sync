/**
 * Bottom sheet showing a full spell description.
 * Fetches the spell by id on open and renders name, level, school,
 * casting time, range, components, duration, and the French description.
 */

import type { Spell, SpellSchool } from '@table-sync/shared';
import { SPELL_SCHOOL_LABELS_FR } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import api from '../api';
import { BottomSheet } from './ui';

interface Props {
  open: boolean;
  spellId: number | null;
  onClose: () => void;
}

export default function SpellDetailSheet({ open, spellId, onClose }: Props) {
  const [spell, setSpell] = useState<Spell | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !spellId) return;
    setLoading(true);
    setSpell(null);
    api
      .get(`/api/spells/${spellId}`)
      .then((res) => setSpell(res.data.spell))
      .catch(() => setSpell(null))
      .finally(() => setLoading(false));
  }, [open, spellId]);

  if (!open) return null;

  const levelLabel = spell
    ? spell.level === 0
      ? 'Tour de magie'
      : `Sort de niveau ${spell.level}`
    : '';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={spell?.name ?? (loading ? 'Chargement…' : 'Sort')}
      size="md"
      mobileOnly={false}
    >
      {loading && <p className="text-sm text-ink-400 text-center py-8">Chargement du sort…</p>}
      {!loading && !spell && (
        <p className="text-sm text-ink-400 text-center py-8">Sort introuvable.</p>
      )}
      {spell && (
        <div className="space-y-3">
          {/* Level + school */}
          <p className="text-sm italic text-ink-500">
            {levelLabel}
            {spell.school &&
              ` de ${SPELL_SCHOOL_LABELS_FR[spell.school as SpellSchool] ?? spell.school}`}
          </p>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 text-xs">
            {spell.concentration && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold">
                🌀 Concentration
              </span>
            )}
            {spell.ritual && (
              <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 font-medium">
                ⚗ Rituel
              </span>
            )}
          </div>

          {/* Properties */}
          <div className="space-y-1 text-sm border-y border-parchment-200 py-2">
            {spell.castingTime && (
              <div>
                <span className="font-semibold">Temps d'incantation</span>
                <span className="text-ink-600 ml-2">{spell.castingTime}</span>
              </div>
            )}
            {spell.rangeText && (
              <div>
                <span className="font-semibold">Portée</span>
                <span className="text-ink-600 ml-2">{spell.rangeText}</span>
              </div>
            )}
            <div>
              <span className="font-semibold">Composantes</span>
              <span className="text-ink-600 ml-2">
                {spell.components.join(', ') || '—'}
                {spell.material && <span className="text-ink-400"> ({spell.material})</span>}
              </span>
            </div>
            {spell.duration && (
              <div>
                <span className="font-semibold">Durée</span>
                <span className="text-ink-600 ml-2">{spell.duration}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {spell.description && (
            <p className="text-sm text-ink-700 whitespace-pre-line">{spell.description}</p>
          )}
          {!spell.description && spell.description && (
            <p className="text-sm text-ink-700 whitespace-pre-line">{spell.description}</p>
          )}

          {/* At higher levels */}
          {(spell.higherLevel || spell.higherLevel) && (
            <div className="text-sm">
              <span className="font-semibold">Aux niveaux supérieurs.</span>{' '}
              <span className="text-ink-600">{spell.higherLevel || spell.higherLevel}</span>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
