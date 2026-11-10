import { NumberField } from '../../components/ui';

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Rangée − / champ / + d'une dénomination de bourse (partagée par
 *  CoinGiveModal et CoinTransactionModal — #107 : une dénomination vidée
 *  compte pour 0). */
export function CoinStepper<U extends string>({
  idPrefix,
  unit,
  coinLabel,
  value,
  onSet,
  onStep,
  t,
}: {
  idPrefix: string;
  unit: U;
  coinLabel: (u: U) => string;
  value: number;
  onSet: (unit: U, n: number) => void;
  onStep: (unit: U, delta: number) => void;
  t: T;
}) {
  return (
    <div className="flex-1 flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onStep(unit, -1)}
        className="w-11 h-11 rounded-lg bg-parchment-200 hover:bg-parchment-300 text-lg font-medium flex items-center justify-center transition-colors"
        aria-label={t('rangee.diminuer.itemname', { itemName: coinLabel(unit) })}
      >
        −
      </button>
      <NumberField
        id={`${idPrefix}-${unit}`}
        min={0}
        className="input w-20 text-center font-mono"
        value={value}
        zeroAsEmpty
        emptyAsZero
        inputMode="numeric"
        onChange={(n) => onSet(unit, Math.max(0, Math.floor(n)))}
        aria-label={t('bourse.quantite.de.coinlabel.unit', {
          coinLabel_unit: coinLabel(unit),
        })}
      />
      <button
        type="button"
        onClick={() => onStep(unit, 1)}
        className="w-11 h-11 rounded-lg bg-parchment-200 hover:bg-parchment-300 text-lg font-medium flex items-center justify-center transition-colors"
        aria-label={t('rangee.augmenter.itemname', { itemName: coinLabel(unit) })}
      >
        +
      </button>
    </div>
  );
}
