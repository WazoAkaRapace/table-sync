import { useTranslation } from 'react-i18next';

interface DeprivationBoxProps {
  label: string;
  days: number;
  icon: string;
  onStep: (delta: number) => void;
}

export function DeprivationBox({ label, days, icon, onStep }: DeprivationBoxProps) {
  const { t } = useTranslation();
  // Amber at 3+, red at 5+
  const tone =
    days >= 5
      ? 'bg-red-50 border-red-200 text-red-800'
      : days >= 3
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-parchment-100 border-parchment-200 text-ink-700';
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1">
          <span aria-hidden="true">{icon}</span>
          {label}
        </span>
        <span className="text-sm font-semibold">{days} j</span>
      </div>
      <div className="flex items-center gap-1 mt-2">
        <button
          type="button"
          onClick={() => onStep(-1)}
          className="w-7 h-7 rounded-lg bg-white/70 hover:bg-white text-sm font-medium flex items-center justify-center"
          aria-label={t('deprivation.diminuer', { label: label.toLowerCase() })}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          className="w-7 h-7 rounded-lg bg-white/70 hover:bg-white text-sm font-medium flex items-center justify-center"
          aria-label={t('deprivation.augmenter', { label: label.toLowerCase() })}
        >
          +
        </button>
      </div>
      {days >= 3 && (
        <p className="text-xs mt-1.5 italic">
          {days >= 5 ? '⚠ Risque grave d\u2019épuisement' : '⚠ Privation prolongée'}
        </p>
      )}
    </div>
  );
}
