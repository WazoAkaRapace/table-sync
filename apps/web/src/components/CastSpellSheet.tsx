import type { Spell } from '@table-sync/shared';
import {
  formatModifier,
  spellDamageAtLevel,
  spellHealingAtLevel,
  spellSaveDC,
} from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Chip } from './ui';

/**
 * Bottom sheet (mobile) / dialog (desktop) to cast a known spell:
 * pick the slot level (with upcast options), warn about concentration
 * conflicts, then consume the slot in one PATCH.
 *
 * Portaled to body — .card's backdrop-filter would break fixed positioning.
 * Local variant of BottomSheet (which has no desktop-dialog mode): same
 * Esc-to-close + body scroll-lock contract.
 */
export default function CastSpellSheet({
  spell,
  slots,
  slotsUsed,
  pactSlots,
  pactUsed,
  concentrating,
  castingMod,
  profBonus,
  charLevel,
  onClose,
  onCast,
}: {
  spell: Spell;
  /** Max slots per level 1-9 (index 0 = level 1) — Incantation pool. */
  slots: number[];
  slotsUsed: number[];
  /** Pact magic pool (Occultiste) — interchangeable with Incantation (SRD). */
  pactSlots?: number[];
  pactUsed?: number[];
  concentrating: boolean;
  /** For the DD / attack preview chips. */
  castingMod?: number;
  profBonus?: number;
  charLevel?: number;
  onClose: () => void;
  /** Called with the chosen slot level (0 = cantrip, no slot), whether it's
   * a ritual cast (no slot either) and WHICH pool the slot comes from —
   * SRD magie de pacte : les deux pools sont interchangeables, LE JOUEUR
   * choisit (un emplacement de pacte lance le sort au niveau de SON dé). */
  onCast: (level: number, ritual?: boolean, pool?: 'spellcasting' | 'pact') => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const isCantrip = spell.level === 0;
  const canUpcast = !!(spell.higherLevel || spell.higherLevel);

  // Options d'emplacement : un bouton par dépense possible — Incantation
  // (le niveau du sort + les niveaux supérieurs quand il évolue) ET, si le
  // pool de pacte a un emplacement libre de niveau ≥ au sort, l'option pacte
  // (qui lance le sort AU NIVEAU de l'emplacement de pacte — SRD). Le joueur
  // choisit son pool, rien n'est automatique.
  const pactSlotsRef = pactSlots ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const pactUsedRef = pactUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const remainingAt = (lvl: number) => (slots[lvl - 1] ?? 0) - (slotsUsed[lvl - 1] ?? 0);
  type CastOption = { key: string; level: number; pool: 'spellcasting' | 'pact' };
  const castOptions: CastOption[] = [];
  if (!isCantrip) {
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      if (lvl > spell.level && !canUpcast) break;
      if (remainingAt(lvl) > 0)
        castOptions.push({ key: `s${lvl}`, level: lvl, pool: 'spellcasting' });
    }
    // Les emplacements de pacte partagent tous le même niveau : une option.
    const pactIdx = pactSlotsRef.findIndex((max, i) => max - (pactUsedRef[i] ?? 0) > 0);
    if (pactIdx >= 0 && pactIdx + 1 >= spell.level) {
      castOptions.push({ key: `p${pactIdx + 1}`, level: pactIdx + 1, pool: 'pact' });
    }
    castOptions.sort((a, b) => a.level - b.level || (a.pool === 'pact' ? 1 : -1));
  }
  const pactRemaining = () => {
    const idx = pactSlotsRef.findIndex((max, i) => max - (pactUsedRef[i] ?? 0) > 0);
    return idx >= 0 ? pactSlotsRef[idx] - (pactUsedRef[idx] ?? 0) : 0;
  };

  const [chosenKey, setChosenKey] = useState<string>(
    isCantrip ? 'cantrip' : (castOptions[0]?.key ?? ''),
  );
  const chosenOption = castOptions.find((o) => o.key === chosenKey) ?? null;
  const [casting, setCasting] = useState(false);

  // Same dialog contract as BottomSheet: Escape closes, body scroll locks.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const concConflict = spell.concentration && concentrating;

  const cast = async (level: number, ritual = false, pool?: 'spellcasting' | 'pact') => {
    setCasting(true);
    try {
      await onCast(level, ritual, pool);
    } finally {
      setCasting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card w-full sm:max-w-md rounded-b-none sm:rounded-2xl p-4 sheet-enter bg-white max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('cast.lancer.spell.name', { spell_name: spell.name })}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="section-title">🪄 {spell.name}</h3>
            <p className="text-xs text-ink-400">
              {isCantrip ? 'Tour de magie' : `Sort de niveau ${spell.level}`}
              {spell.concentration && ' · 🌀 Concentration'}
              {spell.ritual && ' · ⚗ Rituel'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg leading-none px-1"
            aria-label={t('cast.fermer')}
          >
            ✕
          </button>
        </div>

        {concConflict && (
          <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 mb-3 text-sm text-amber-900">
            <p className="font-semibold">⚠️ Concentration en cours</p>
            <p className="mt-0.5">
              {t('cast.tu.concentres.deja.un.sort.lancer')}
              <strong>{spell.name}</strong>
              {t('cast.mettra.fin.au.sort.precedent')}
            </p>
          </div>
        )}

        {isCantrip ? (
          <p className="text-sm text-ink-600 bg-parchment-100 rounded-lg p-3">
            {t('cast.les.tours.de.magie.se.lancent')}
          </p>
        ) : castOptions.length === 0 ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {t('cast.aucun.emplacement.de.sort.disponible.il')}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-500">{t('cast.emplacement.a.depenser')}</p>
            {castOptions.map((opt) => {
              const selected = chosenKey === opt.key;
              const isUpcast = opt.level > spell.level && canUpcast;
              const isPact = opt.pool === 'pact';
              return (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => setChosenKey(opt.key)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    selected
                      ? 'bg-blood-600 text-white border-blood-700'
                      : 'bg-parchment-50 text-ink-700 border-parchment-200 hover:border-blood-400'
                  }`}
                  aria-pressed={selected}
                >
                  <span className="font-medium flex items-center gap-1.5 min-w-0">
                    Niveau {opt.level}
                    {isUpcast && (
                      <span
                        className={`text-[10px] font-semibold uppercase ${selected ? 'text-gold-300' : 'text-blood-500'}`}
                      >
                        {t('cast.superieur')}
                      </span>
                    )}
                    {isPact && (
                      <span
                        className={`text-[10px] font-semibold uppercase ${selected ? 'text-gold-300' : 'text-gold-600'}`}
                        title={t('cast.emplacement.de.magie.de.pacte.recharge')}
                      >
                        ☾ pacte
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 ${selected ? 'text-parchment-100' : isPact ? 'text-gold-600' : 'text-ink-400'}`}
                  >
                    {isPact ? (
                      <span title={t('cast.emplacement.de.pacte.recharge.au.repos')}>
                        ☾ {pactRemaining()} restant{pactRemaining() > 1 ? 's' : ''} · repos court
                      </span>
                    ) : (
                      <>
                        {remainingAt(opt.level)} restant{remainingAt(opt.level) > 1 ? 's' : ''}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Damage / healing / DD preview at the chosen level */}
        {(() => {
          const chosenLvl = isCantrip ? 0 : chosenOption?.level;
          const dmg = spellDamageAtLevel(spell, chosenLvl ?? -1, charLevel ?? 1);
          const healing = spellHealingAtLevel(spell, chosenLvl ?? -1, charLevel ?? 1);
          const hasPreview = dmg.dice || healing.dice || spell.dcJson || spell.attackType;
          if (!hasPreview || (!chosenOption && !isCantrip)) return null;
          return (
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {!isCantrip && chosenOption && (
                <span className="text-xs text-ink-400">
                  Au niveau {chosenOption.level}
                  {chosenOption.pool === 'pact' ? ' (pacte)' : ''} :
                </span>
              )}
              {dmg.dice && (
                <Chip tone="orange">
                  ⚔ {dmg.dice}
                  {dmg.typeFr ? ` dégâts ${dmg.typeFr}` : ''}
                </Chip>
              )}
              {healing.dice && (
                <Chip
                  tone="green"
                  title={
                    healing.addsModifier
                      ? 'Points de vie restaurés : dés + modificateur de caractéristique'
                      : 'Points de vie restaurés'
                  }
                >
                  ✚ {healing.dice}
                  {healing.addsModifier && castingMod !== undefined
                    ? formatModifier(castingMod)
                    : ''}{' '}
                  PV
                </Chip>
              )}
              {spell.dcJson && castingMod !== undefined && profBonus !== undefined && (
                <Chip tone="blue">🛡 DD {spellSaveDC(castingMod, profBonus)}</Chip>
              )}
              {spell.attackType && castingMod !== undefined && profBonus !== undefined && (
                <Chip tone="red">🎯 {formatModifier(castingMod + profBonus)}</Chip>
              )}
            </div>
          );
        })()}

        <button
          type="button"
          onClick={() => {
            if (isCantrip) cast(0);
            else if (chosenOption) cast(chosenOption.level, false, chosenOption.pool);
          }}
          disabled={casting || (!chosenOption && !isCantrip)}
          className="btn-primary w-full mt-4 py-2.5 disabled:opacity-40"
        >
          {casting
            ? '…'
            : concConflict
              ? '🪄 Lancer et rompre la concentration'
              : isCantrip
                ? '🪄 Lancer le tour de magie'
                : `🪄 Lancer au niveau ${chosenOption ? chosenOption.level : '—'}`}
        </button>

        {/* Ritual cast: no slot consumed, +10 minutes */}
        {spell.ritual && (
          <button
            type="button"
            onClick={() => cast(spell.level, true)}
            disabled={casting}
            className="w-full mt-2 py-2.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-300 hover:bg-purple-200 font-medium text-sm disabled:opacity-40 transition-colors"
          >
            ⚗ Rituel (10 minutes){' '}
            <span className="font-normal text-purple-500">— sans emplacement</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
