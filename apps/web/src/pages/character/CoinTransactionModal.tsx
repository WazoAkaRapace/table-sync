import {
  COIN_BREAK_INTO,
  COIN_BREAK_RATIO,
  type CoinAmounts,
  type CostUnit,
  coinsTotalCp,
  EMPTY_COINS,
  gainCoins,
  spendCoins,
} from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, NumberField } from '../../components/ui';
import { coinLabel } from '../../i18n/labels';
import { COIN_FIELDS, type CoinMode } from './CoinPurse';
import type { CoinsState } from './types';

// ---------- Coin transaction modal (encaisser / dépenser / corriger) ----------
// The moneychanger's sheet: enter a delta per denomination, the shared engine
// makes change (breaking the smallest sufficient higher coin), the ledger
// below shows the purse before → after before anything is committed.

const MODES: CoinMode[] = ['gain', 'spend', 'set'];

function amountsOf(coins: CoinsState): CoinAmounts {
  return {
    cp: coins.copper,
    sp: coins.silver,
    ep: coins.electrum,
    gp: coins.gold,
    pp: coins.platinum,
  };
}

function coinsOf(amounts: CoinAmounts): CoinsState {
  return {
    copper: amounts.cp,
    silver: amounts.sp,
    electrum: amounts.ep,
    gold: amounts.gp,
    platinum: amounts.pp,
  };
}

/** The purse's own denominations, largest first, zeros skipped — the ledger
 * mirrors what the purse actually HOLDS, never a canonical re-breakdown. */
function formatPurse(amounts: CoinAmounts): string {
  const parts = COIN_FIELDS.map(({ unit }) => ({ unit, qty: amounts[unit] }))
    .reverse()
    .filter((p) => p.qty > 0)
    .map((p) => `${p.qty} ${coinLabel(p.unit)}`);
  return parts.length > 0 ? parts.join(' · ') : '0';
}

/** A copper amount the player is SHORT, in everyday coins only (PO → PA → PC —
 * never electrum or platinum, which no one at the table thinks in). */
function formatPlainCp(totalCp: number): string {
  const gp = Math.floor(totalCp / 100);
  const sp = Math.floor((totalCp % 100) / 10);
  const cp = totalCp % 10;
  const parts: string[] = [];
  if (gp > 0) parts.push(`${gp} ${coinLabel('gp')}`);
  if (sp > 0) parts.push(`${sp} ${coinLabel('sp')}`);
  if (cp > 0 || parts.length === 0) parts.push(`${cp} ${coinLabel('cp')}`);
  return parts.join(' · ');
}

interface CoinTransactionModalProps {
  open: boolean;
  /** Verb preselected by the door the player tapped (the chips can switch). */
  initialMode: CoinMode;
  coins: CoinsState;
  onClose: () => void;
  /** Persist the resulting purse; resolves only on success (host closes). */
  onConfirm: (next: CoinsState) => Promise<void>;
}

export function CoinTransactionModal({
  open,
  initialMode,
  coins,
  onClose,
  onConfirm,
}: CoinTransactionModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CoinMode>('gain');
  const [amounts, setAmounts] = useState<CoinAmounts>({ ...EMPTY_COINS });
  const [submitting, setSubmitting] = useState(false);

  // Fresh draft each time the sheet opens — the purse snapshot is taken
  // exactly when the door opens; a live-sync refresh mid-edit must not
  // clobber the draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `coins` is a deliberate snapshot-at-open, listing it would reset the draft on every WS-driven refetch
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setAmounts(initialMode === 'set' ? amountsOf(coins) : { ...EMPTY_COINS });
  }, [open, initialMode]);

  const switchMode = (nextMode: CoinMode) => {
    if (nextMode === mode) return;
    // « Corriger » edits the purse itself while the other two edit a delta —
    // crossing that boundary resets the draft; gain↔spend keeps it (wrong-direction rescue)
    if (nextMode === 'set') setAmounts(amountsOf(coins));
    else if (mode === 'set') setAmounts({ ...EMPTY_COINS });
    setMode(nextMode);
  };

  const step = (unit: keyof CoinAmounts, delta: number) => {
    setAmounts((a) => ({ ...a, [unit]: Math.max(0, a[unit] + delta) }));
  };

  // Pure preview from the shared engine — nothing touches the sheet until confirm
  const purse = amountsOf(coins);
  const totalEntered = coinsTotalCp(amounts);
  const spend = mode === 'spend' ? spendCoins(purse, amounts) : null;
  const shortfallCp = spend && !spend.ok ? spend.shortfallCp : null;
  const breaks = spend?.ok ? spend.breaks : [];
  const result: CoinAmounts | null =
    mode === 'gain'
      ? gainCoins(purse, amounts)
      : mode === 'set'
        ? amounts
        : spend?.ok
          ? spend.purse
          : null;
  // « Corriger » ne s'arme que si le draft s'écarte de la bourse — une
  // correction identique n'est pas une opération.
  const purseUnchanged = COIN_FIELDS.every(({ unit }) => amounts[unit] === purse[unit]);
  const canSubmit =
    !submitting &&
    result !== null &&
    shortfallCp === null &&
    (mode === 'set' ? !purseUnchanged : totalEntered > 0);

  const breaksText = breaks
    .map((b) => {
      const lower = COIN_BREAK_INTO[b.unit] as CostUnit; // a broken coin always has a target
      return t(b.count === 1 ? 'bourse.cassee' : 'bourse.cassee_other', {
        count: b.count,
        from: coinLabel(b.unit),
        ratio: COIN_BREAK_RATIO[b.unit],
        to: coinLabel(lower),
      });
    })
    .join(' · ');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || result === null) return;
    setSubmitting(true);
    try {
      await onConfirm(coinsOf(result));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('bourse.titre')}>
      <form onSubmit={submit} className="space-y-4">
        <fieldset className="grid grid-cols-3 gap-2" aria-label={t('bourse.mode.choix')}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`h-11 rounded-xl border text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-ink-800 text-parchment-50 border-ink-800'
                  : 'bg-parchment-50 text-ink-600 border-parchment-300 hover:border-parchment-400'
              }`}
            >
              {m === 'gain'
                ? `＋ ${t('bourse.encaisser')}`
                : m === 'spend'
                  ? `− ${t('bourse.depenser')}`
                  : `✎ ${t('bourse.corriger')}`}
            </button>
          ))}
        </fieldset>

        <div className="space-y-2">
          {COIN_FIELDS.map(({ key, unit, color }) => (
            <div key={key} className="flex items-center gap-3">
              <label
                className="label flex items-center gap-1.5 w-16 shrink-0"
                htmlFor={`coin-amt-${unit}`}
              >
                <span
                  className="inline-block w-3 h-3 rounded-full border border-parchment-300 shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                {coinLabel(unit)}
              </label>
              <div className="flex-1 flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => step(unit, -1)}
                  className="w-11 h-11 rounded-lg bg-parchment-200 hover:bg-parchment-300 text-lg font-medium flex items-center justify-center transition-colors"
                  aria-label={t('rangee.diminuer.itemname', { itemName: coinLabel(unit) })}
                >
                  −
                </button>
                <NumberField
                  id={`coin-amt-${unit}`}
                  min={0}
                  className="input w-20 text-center font-mono"
                  value={amounts[unit]}
                  zeroAsEmpty
                  inputMode="numeric"
                  onChange={(n) =>
                    setAmounts((a) => ({ ...a, [unit]: Math.max(0, Math.floor(n)) }))
                  }
                  aria-label={t('bourse.quantite.de.coinlabel.unit', {
                    coinLabel_unit: coinLabel(unit),
                  })}
                />
                <button
                  type="button"
                  onClick={() => step(unit, 1)}
                  className="w-11 h-11 rounded-lg bg-parchment-200 hover:bg-parchment-300 text-lg font-medium flex items-center justify-center transition-colors"
                  aria-label={t('rangee.augmenter.itemname', { itemName: coinLabel(unit) })}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* The ledger — before → after, printed ink; the only live feedback */}
        <div className="pt-3 border-t border-parchment-200 space-y-1" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink-400">{t('bourse.ledger.avant')}</span>
            <span className="font-mono text-sm text-ink-500">{formatPurse(purse)}</span>
          </div>
          {shortfallCp !== null ? (
            <p className="text-sm font-medium text-ink-900 pt-1">
              {t('bourse.manque', { amount: formatPlainCp(shortfallCp) })}
            </p>
          ) : (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-400">
                {mode === 'set' ? t('bourse.ledger.total') : t('bourse.ledger.apres')}
              </span>
              <span className="font-mono text-sm font-semibold text-ink-900">
                {formatPurse(result ?? EMPTY_COINS)}
              </span>
            </div>
          )}
          {mode === 'spend' && breaks.length > 0 && (
            <p className="text-xs text-ink-500 pt-1">
              {t('bourse.monnaie')} — {breaksText}
            </p>
          )}
        </div>

        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          {submitting
            ? t('bourse.cta.encours')
            : mode === 'set'
              ? t('bourse.cta.corriger')
              : `${
                  mode === 'gain' ? t('bourse.cta.encaisser') : t('bourse.cta.depenser')
                }${totalEntered > 0 ? ` ${formatPurse(amounts)}` : ''}`}
        </button>
      </form>
    </Modal>
  );
}
