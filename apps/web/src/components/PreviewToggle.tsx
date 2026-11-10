import { useTranslation } from 'react-i18next';

/**
 * Bouton « Masquer/Montrer l'aperçu » des formulaires MD (monstres et sorts
 * personnalisés) — extraction du clone signalé par le ratchet duplication.
 * Cible ≥ 44 px, état reflété par aria-pressed.
 */
export function PreviewToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      className="btn-ghost text-sm text-ink-500 min-h-11 px-3"
    >
      {open ? t('common.apercu.masquer') : t('common.apercu.montrer')}
    </button>
  );
}
