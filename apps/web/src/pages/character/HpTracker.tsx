import type { Character, ConcentrationCheck } from '@table-sync/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { HpBar, NumberField } from '../../components/ui';
import type { SheetActionProps } from './types';

interface HpTrackerProps extends SheetActionProps {
  character: Character;
  charId: number;
  onConcentrationCheck: (check: ConcentrationCheck) => void;
}

export function HpTracker({
  character,
  charId,
  markLocalMutation,
  onSaved,
  onError,
  onConcentrationCheck,
}: HpTrackerProps) {
  const { t } = useTranslation();
  // Empty-while-editing lives inside NumberField — these stay pure numbers.
  const [maxHp, setMaxHp] = useState<number>(character.maxHp);
  const [currentHp, setCurrentHp] = useState<number>(character.currentHp);
  const [tempHp, setTempHp] = useState<number>(character.tempHp);

  useEffect(() => {
    setMaxHp(character.maxHp);
  }, [character.maxHp]);
  useEffect(() => {
    setCurrentHp(character.currentHp);
  }, [character.currentHp]);
  useEffect(() => {
    setTempHp(character.tempHp);
  }, [character.tempHp]);

  const patchFields = async (fields: Record<string, number>) => {
    markLocalMutation();
    try {
      const res = await api.patch(`/api/characters/${charId}`, fields);
      // Losing HP while concentrating requires a CON save — surface it immediately.
      if (res?.data?.concentrationCheck) onConcentrationCheck(res.data.concentrationCheck);
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || 'Erreur');
    }
  };

  // +/− steppers: update the display instantly but debounce the PATCH by 1s.
  // A burst of clicks then produces a single before→after delta server-side,
  // so the concentration check (if any) fires once with the full damage.
  const pendingPatch = useRef<Record<string, number>>({});
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePatch = (field: string, value: number) => {
    pendingPatch.current[field] = value;
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      patchTimer.current = null;
      const fields = pendingPatch.current;
      pendingPatch.current = {};
      patchFields(fields);
    }, 1000);
  };

  // Commit an input on blur: clamp (typed current HP obeys the same ceiling
  // as the +1 stepper) and supersede any pending debounced update for that
  // field. An emptied box never gets here — NumberField rolls it back instead.
  const commit = (
    field: 'currentHp' | 'maxHp' | 'tempHp',
    raw: number,
    setter: (n: number) => void,
  ) => {
    const min = field === 'maxHp' ? 1 : 0;
    let n = Math.max(min, raw);
    // Typed current HP obeys the same ceiling as the +1 stepper.
    if (field === 'currentHp') {
      const max = typeof maxHp === 'number' && maxHp > 0 ? maxHp : character.maxHp;
      if (max > 0) n = Math.min(n, max);
    }
    setter(n);
    delete pendingPatch.current[field];
    if (n !== character[field]) patchFields({ [field]: n });
  };

  // Don't lose a pending debounced change if the user navigates away.
  useEffect(
    () => () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
      const fields = pendingPatch.current;
      if (Object.keys(fields).length > 0) {
        api.patch(`/api/characters/${charId}`, fields).catch(() => {});
      }
    },
    [charId],
  );

  const curNum = currentHp;
  const maxNum = maxHp > 0 ? maxHp : character.maxHp;
  const tempNum = tempHp;
  const hpColor =
    curNum <= 0
      ? 'text-red-600'
      : curNum <= maxNum * 0.3
        ? 'text-red-500'
        : curNum <= maxNum * 0.5
          ? 'text-orange-500'
          : 'text-green-600';

  // Steppers share the state band's grammar: −5/−1 edit +1/+5 with 44px targets.
  // Damage absorbs temp HP first (SRD); only the remainder hits current HP.
  // Both fields ride the same debounced PATCH so a click burst coalesces into
  // one request — and one concentration check, which the server rolls against
  // the TOTAL damage taken (PHB p.203: absorbed by temp HP or not, it counts).
  const damage = (amount: number) => {
    const absorbed = Math.min(tempNum, amount);
    const nextTemp = tempNum - absorbed;
    const nextCur = Math.max(0, curNum - (amount - absorbed));
    setCurrentHp(nextCur);
    setTempHp(nextTemp);
    schedulePatch('currentHp', nextCur);
    schedulePatch('tempHp', nextTemp);
  };
  const heal = (amount: number) => {
    const n = Math.min(maxNum, curNum + amount);
    setCurrentHp(n);
    schedulePatch('currentHp', n);
  };
  const stepTemp = (delta: number) => {
    const n = Math.max(0, tempNum + delta);
    setTempHp(n);
    schedulePatch('tempHp', n);
  };

  return (
    <div className="space-y-3">
      {/* Damage / heal — one line reads the full HP statement: −5 −1 [current] / [max] +1 +5.
        The max is a quiet underlined input (still editable) so current/max stay together.
        Damage buttons eat PV temp first. Measured values are mono (DESIGN.md);
        under 380px the ±5 buttons fold away (−/+ only) to keep the single line
        at full 44px targets. On lg the PV temp group rides to the right of the
        statement (filet between); on mobile it wraps to its own row below. */}
      <div className="flex flex-wrap items-center justify-center gap-y-3 lg:flex-nowrap lg:gap-x-6">
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => damage(5)}
            className="w-11 h-11 max-[379px]:hidden rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold flex items-center justify-center transition-colors"
            aria-label={t('hp.blesser.de.5')}
          >
            −5
          </button>
          <button
            type="button"
            onClick={() => damage(1)}
            className="w-11 h-11 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold flex items-center justify-center transition-colors"
            aria-label={t('hp.blesser.de.1')}
          >
            <span className="max-[379px]:hidden">−1</span>
            <span className="hidden max-[379px]:inline">−</span>
          </button>
          <NumberField
            className={`w-16 text-center text-lg font-bold font-mono bg-white border border-parchment-300 rounded-lg py-1 focus:outline-none focus:border-blood-500 ${hpColor}`}
            value={currentHp}
            min={0}
            onChange={setCurrentHp}
            onBlur={() => commit('currentHp', currentHp, setCurrentHp)}
            aria-label={t('hp.points.de.vie.actuels')}
          />
          <span className="text-ink-400 font-semibold">/</span>
          <NumberField
            className="w-12 text-center text-base font-semibold font-mono text-ink-500 bg-transparent border-b border-dashed border-parchment-400 py-0 focus:outline-none focus:border-blood-500 focus:bg-white"
            value={maxHp}
            min={1}
            onChange={setMaxHp}
            onBlur={() => commit('maxHp', maxHp, setMaxHp)}
            aria-label={t('hp.points.de.vie.maximum')}
          />
          <button
            type="button"
            onClick={() => heal(1)}
            className="w-11 h-11 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold flex items-center justify-center transition-colors"
            aria-label={t('hp.soigner.de.1')}
          >
            <span className="max-[379px]:hidden">+1</span>
            <span className="hidden max-[379px]:inline">+</span>
          </button>
          <button
            type="button"
            onClick={() => heal(5)}
            className="w-11 h-11 max-[379px]:hidden rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold flex items-center justify-center transition-colors"
            aria-label={t('hp.soigner.de.5')}
          >
            +5
          </button>
        </div>

        {/* Filet between the statement and the temp group — desktop only */}
        <span className="hidden lg:block w-px h-8 bg-parchment-300" aria-hidden="true" />

        {/* Temp HP — gains only; damage to it happens through the Blesser buttons,
          which absorb temp first (no minus here). */}
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-xs text-ink-500 font-medium">PV temp</span>
          <NumberField
            className={`w-14 text-center text-sm font-medium font-mono bg-white border border-parchment-300 rounded-lg py-1 focus:outline-none focus:border-blood-500 ${tempNum > 0 ? 'text-blue-700' : 'text-ink-400'}`}
            value={tempHp}
            min={0}
            onChange={setTempHp}
            onBlur={() => commit('tempHp', tempHp, setTempHp)}
            aria-label={t('hp.points.de.vie.temporaires')}
          />
          <button
            type="button"
            onClick={() => stepTemp(1)}
            className="w-10 h-10 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-medium flex items-center justify-center transition-colors"
            aria-label={t('hp.ajouter.1.pv.temp')}
          >
            +
          </button>
        </div>
      </div>

      {/* HP bar — full width, temp HP drawn as a blue overshoot segment */}
      <HpBar current={curNum} max={maxNum} temp={tempNum} size="sm" />
    </div>
  );
}
