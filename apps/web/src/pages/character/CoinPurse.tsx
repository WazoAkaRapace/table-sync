import type { Character } from '@table-sync/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coinLabel } from '../../i18n/labels';
import type { CoinsState } from './types';

// ---------- Coin purse (figures at rest, transactions through the modal) ----------

// Coin fields with distinct CSS-colored glyphs instead of identical emoji
export const COIN_FIELDS: {
  key: keyof Pick<Character, 'copper' | 'silver' | 'electrum' | 'gold' | 'platinum'>;
  unit: 'cp' | 'sp' | 'ep' | 'gp' | 'pp';
  color: string;
}[] = [
  { key: 'copper', unit: 'cp', color: '#b87333' }, // copper
  { key: 'silver', unit: 'sp', color: '#c0c0c0' }, // silver
  { key: 'electrum', unit: 'ep', color: '#a89968' }, // electrum (pale gold-silver)
  { key: 'gold', unit: 'gp', color: '#d4af37' }, // gold
  { key: 'platinum', unit: 'pp', color: '#e5e4e2' }, // platinum (white-silver)
];

/** The three verbs of the coin modal: receive / spend / correct the purse. */
export type CoinMode = 'gain' | 'spend' | 'set';

interface CoinPurseProps {
  coins: CoinsState;
  /** Viewer mode: display amounts without the transaction doors or steppers. */
  readOnly?: boolean;
  /** Opens the coin modal with the given verb preselected. */
  onOpenExchange: (mode: CoinMode) => void;
  /** Quick ±1 on one denomination — minus on the left, plus on the right. */
  onAdjust: (field: keyof CoinsState, delta: 1 | -1) => void;
}

export function CoinPurse({ coins, readOnly = false, onOpenExchange, onAdjust }: CoinPurseProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const totalCp =
    coins.copper +
    coins.silver * 10 +
    coins.electrum * 50 +
    coins.gold * 100 +
    coins.platinum * 1000;
  const totalGp = Math.floor(totalCp / 100);
  const remCp = totalCp % 100;

  return (
    <div data-tuto="inv-bourse">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <h2 className="section-title">
          {t('bourse.titre')}{' '}
          <span className="text-ink-400 text-sm font-normal">
            ({t('bourse.total.po', { gp: totalGp })}
            {remCp > 0 ? t('bourse.total.pc', { cp: remCp }) : ''})
          </span>
        </h2>
        <span className={`text-ink-400 text-sm chevron ${expanded ? 'is-open' : 'is-closed'}`}>
          ▼
        </span>
      </button>

      <div className={`expand-grid ${expanded ? '' : 'is-collapsed'}`}>
        <div className="expand-inner">
          <div className="mt-4">
            {/* Figures at rest — measured values in mono, like every ledger line.
                Quick steppers flank each figure (− left, + right): the modal's
                steppers parked at rest — 44 px under the thumb on the two-column
                grid, 36 px from md where the five-column row needs the figure's
                room back (viewers keep the incumbent grid: no buttons, no squeeze).
                Figures ≥ 1000 drop a size — 4 digits must keep their clearance
                from the steppers on the five-column row. role="img" is dropped
                once buttons live inside, or AT would hide them. */}
            <div
              className={`grid gap-3 ${
                readOnly ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 md:grid-cols-5'
              }`}
            >
              {COIN_FIELDS.map(({ key, unit, color }) => (
                <div key={key}>
                  <span className="label flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-full border border-parchment-300 shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    {coinLabel(unit)}
                  </span>
                  <div className="mt-1 flex items-center gap-1">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => onAdjust(key, -1)}
                        disabled={coins[key] === 0}
                        className="w-11 h-11 md:w-9 md:h-9 rounded-lg bg-parchment-200 hover:bg-parchment-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-lg font-medium flex items-center justify-center transition-all shrink-0"
                        aria-label={t('rangee.diminuer.itemname', { itemName: coinLabel(unit) })}
                      >
                        −
                      </button>
                    )}
                    <div
                      className={`font-mono text-ink-900 leading-8 min-w-0 ${
                        coins[key] >= 1000 ? 'text-lg' : 'text-xl'
                      } ${readOnly ? '' : 'flex-1 text-center'}`}
                    >
                      {coins[key]}
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => onAdjust(key, 1)}
                        className="w-11 h-11 md:w-9 md:h-9 rounded-lg bg-parchment-200 hover:bg-parchment-300 active:scale-95 text-lg font-medium flex items-center justify-center transition-all shrink-0"
                        aria-label={t('rangee.augmenter.itemname', { itemName: coinLabel(unit) })}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!readOnly && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onOpenExchange('gain')}
                >
                  ＋ {t('bourse.encaisser')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onOpenExchange('spend')}
                >
                  − {t('bourse.depenser')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
