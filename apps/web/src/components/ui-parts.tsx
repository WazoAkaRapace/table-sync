// déplacement pur depuis ui.tsx (ratchet R1)
import type { ItemCategory, Rarity } from '@table-sync/shared';
import { useTranslation } from 'react-i18next';
import { categoryLabel, rarityLabel } from '../i18n/labels';

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const cls = `rarity-${rarity}`;
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {rarityLabel(rarity)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: ItemCategory }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-parchment-100 text-ink-500 font-medium">
      {categoryLabel(category)}
    </span>
  );
}

// Weight display convention (DESIGN.md « Poids ») : 1 décimale comme partout
// dans l'app, mais les poids < 0,1 kg gardent 2 décimales — une gemme de
// 0,01 kg ne doit pas s'arrondir à « 0,0 kg ».
export function formatWeightKg(kg: number): string {
  if (kg < 0.1) return kg.toFixed(2);
  return kg.toFixed(1);
}

export function WeightBadge({ weightKg }: { weightKg: number | null }) {
  const { t } = useTranslation();
  if (weightKg === null) return <span className="text-xs text-ink-400">{t('ui.poids')}</span>;
  return <span className="text-xs text-ink-500">{formatWeightKg(weightKg)} kg</span>;
}
