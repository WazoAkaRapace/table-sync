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
  /** Viewer mode: display amounts without the transaction doors. */
  readOnly?: boolean;
  /** Opens the coin modal with the given verb preselected. */
  onOpenExchange: (mode: CoinMode) => void;
}

export function CoinPurse({ coins, readOnly = false, onOpenExchange }: CoinPurseProps) {
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
            {/* Figures at rest — measured values in mono, like every ledger line */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {COIN_FIELDS.map(({ key, unit, color }) => (
                <div
                  key={key}
                  role="img"
                  aria-label={`${t('bourse.quantite.de.coinlabel.unit', {
                    coinLabel_unit: coinLabel(unit),
                  })} : ${coins[key]}`}
                >
                  <span className="label flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-full border border-parchment-300 shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    {coinLabel(unit)}
                  </span>
                  <div className="mt-1 font-mono text-xl text-ink-900 leading-8">{coins[key]}</div>
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
