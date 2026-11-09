import type { CoinAmounts } from '@table-sync/shared';
import { coinLabel } from '../../i18n/labels';
import { COIN_FIELDS } from './CoinPurse';

/** Les dénominations de la bourse, plus grandes d'abord, zéros sautés. */
export function formatPurse(amounts: CoinAmounts): string {
  const parts = COIN_FIELDS.map(({ unit }) => ({ unit, qty: amounts[unit] }))
    .reverse()
    .filter((p) => p.qty > 0)
    .map((p) => `${p.qty} ${coinLabel(p.unit)}`);
  return parts.length > 0 ? parts.join(' · ') : '0';
}

/** Un manque en cuivre, en pièces courantes seulement (PO · PA · PC). */
export function formatPlainCp(totalCp: number): string {
  const gp = Math.floor(totalCp / 100);
  const sp = Math.floor((totalCp % 100) / 10);
  const cp = totalCp % 10;
  const parts: string[] = [];
  if (gp > 0) parts.push(`${gp} ${coinLabel('gp')}`);
  if (sp > 0) parts.push(`${sp} ${coinLabel('sp')}`);
  if (cp > 0 || parts.length === 0) parts.push(`${cp} ${coinLabel('cp')}`);
  return parts.join(' · ');
}
