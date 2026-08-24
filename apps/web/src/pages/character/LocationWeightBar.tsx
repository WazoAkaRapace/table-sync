import type { LocationWeight } from '@table-sync/shared';

// ---------- Per-location weight bar (compact) ----------

interface LocationWeightBarProps {
  weight: LocationWeight;
}

export function LocationWeightBar({ weight }: LocationWeightBarProps) {
  const { itemsWeightKg, ownWeightKg, maxCapacityKg, pct } = weight;
  if (maxCapacityKg === null) return null;
  const totalWeight = itemsWeightKg + (ownWeightKg || 0);
  const fillClass =
    pct >= 100
      ? 'bg-red-500'
      : pct >= 75
        ? 'bg-orange-500'
        : pct >= 50
          ? 'bg-yellow-500'
          : 'bg-green-500';

  return (
    <div
      className="mt-2 space-y-1"
      role="progressbar"
      aria-valuenow={Math.round(totalWeight * 100) / 100}
      aria-valuemin={0}
      aria-valuemax={maxCapacityKg}
    >
      <div className="flex items-baseline justify-between text-xs text-ink-500">
        <span>
          {totalWeight.toFixed(1)} / {maxCapacityKg.toFixed(1)} kg
        </span>
        <span className="font-medium">{Math.round(pct)}%</span>
      </div>
      <div className="relative h-2 bg-parchment-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${fillClass} transition-all duration-300 rounded-full`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
