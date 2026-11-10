import { useTranslation } from 'react-i18next';

/**
 * Grille « bonus magique » 0→3 — plan « Contenus personnalisés » (2026-11).
 * Partagée par les panneaux Arme et Armure (extraction du clone signalé par
 * le ratchet duplication) : mêmes puces or, mêmes cibles 44 px, seules les
 * clés i18n diffèrent (arme.* / armure.*).
 */
export function MagicBonusField({
  value,
  onChange,
  labelKey,
  noneKey,
}: {
  value: number;
  onChange: (bonus: number) => void;
  /** Clé i18n du libellé + aria-label du groupe (ex. 'arme.bonus.magique'). */
  labelKey: string;
  /** Clé i18n de l'option 0 (ex. 'arme.aucun'). */
  noneKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <span className="label">{t(labelKey)}</span>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={t(labelKey)}>
        {[0, 1, 2, 3].map((bonus) => {
          const selected = value === bonus;
          return (
            <button
              key={bonus}
              type="button"
              onClick={() => onChange(bonus)}
              aria-pressed={selected}
              className={`min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                selected
                  ? 'bg-gold-100 border-gold-300 text-gold-700 font-semibold'
                  : 'bg-parchment-100 border-parchment-300 text-ink-600 hover:bg-parchment-200'
              }`}
            >
              {bonus === 0 ? t(noneKey) : `+${bonus}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
