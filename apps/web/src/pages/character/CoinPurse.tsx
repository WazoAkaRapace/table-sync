import type { Character } from '@table-sync/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberField } from '../../components/ui';
import { coinLabel } from '../../i18n/labels';
import type { CoinsState } from './types';

// ---------- Coin purse (auto-save, distinct colored glyphs) ----------

// Coin fields with distinct CSS-colored glyphs instead of identical emoji
const COIN_FIELDS: {
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

interface CoinPurseProps {
  coins: CoinsState;
  /** Viewer mode: display amounts without inputs. */
  readOnly?: boolean;
  onChange: (key: keyof CoinsState, val: number) => void;
  onBlur: () => void;
}

export function CoinPurse({ coins, readOnly = false, onChange, onBlur }: CoinPurseProps) {
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
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <h2 className="section-title">
          Bourse{' '}
          <span className="text-ink-400 text-sm font-normal">
            ({totalGp} PO{remCp > 0 ? ` ${remCp} PC` : ''})
          </span>
        </h2>
        <span className={`text-ink-400 text-sm chevron ${expanded ? 'is-open' : 'is-closed'}`}>
          ▼
        </span>
      </button>

      <div className={`expand-grid ${expanded ? '' : 'is-collapsed'}`}>
        <div className="expand-inner">
          <div className="mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {COIN_FIELDS.map(({ key, unit, color }) => (
                <label key={key} className="block" htmlFor={t('bourse.coin.key', { key: key })}>
                  <span className="label flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-full border border-parchment-300 shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    {coinLabel(unit)}
                  </span>
                  {readOnly ? (
                    <div
                      className="input bg-parchment-100 text-ink-700 flex items-center justify-between"
                      role="img"
                      aria-label={t('bourse.quantite.de.coinlabel.unit', {
                        coinLabel_unit: coinLabel(unit),
                      })}
                    >
                      <span>{coins[key]}</span>
                      <span className="text-xs text-ink-400">{unit}</span>
                    </div>
                  ) : (
                    <NumberField
                      id={`coin-${key}`}
                      min={0}
                      className="input"
                      value={coins[key]}
                      zeroAsEmpty
                      onChange={(n) => onChange(key, n)}
                      onBlur={onBlur}
                      aria-label={t('bourse.quantite.de.coinlabel.unit', {
                        coinLabel_unit: coinLabel(unit),
                      })}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
