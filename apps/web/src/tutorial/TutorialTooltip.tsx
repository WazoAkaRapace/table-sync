/**
 * Bulle maison pour react-joyride — remplace le tooltip par défaut par une
 * carte de l'app (`.card`, boutons de la maison, compteur « 2 / 6 »).
 * Le contrat dialog vient de tooltipProps (role, aria-modal) ; les libellés
 * des boutons passent par les props étalées (aria-label issus du locale).
 */
import { useTranslation } from 'react-i18next';
import type { TooltipRenderProps } from 'react-joyride';

export function TutorialTooltip({
  index,
  size,
  step,
  isLastStep,
  backProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  const { t } = useTranslation();

  return (
    <div
      {...tooltipProps}
      className="card p-4 w-[min(21rem,calc(100vw-2rem))] shadow-2xl space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-widest text-gold-600 uppercase tabular-nums">
          {t('tuto.compteur', { current: index + 1, total: size })}
        </span>
        <button type="button" {...skipProps} className="text-xs text-ink-400 hover:text-ink-700">
          {t('tuto.passer')}
        </button>
      </div>
      {step.title ? (
        <h2 className="font-display text-base leading-snug text-ink-900">{step.title}</h2>
      ) : null}
      <p className="text-sm leading-relaxed text-ink-700">{step.content}</p>
      <div className="flex items-center justify-end gap-2 pt-1">
        {index > 0 && (
          <button type="button" {...backProps} className="btn-secondary text-sm px-3 py-1.5">
            {t('tuto.retour')}
          </button>
        )}
        <button type="button" {...primaryProps} className="btn-primary text-sm px-3 py-1.5">
          {isLastStep ? t('tuto.terminer') : t('tuto.suivant')}
        </button>
      </div>
    </div>
  );
}
