/**
 * Dialog du journal des modifications — deux modes :
 * — diff (popup de chargement) : entrées nouvelles entre la dernière
 *   version vue et la courante, titre « Nouveautés » ;
 * — full (Mon compte : clic sur la version) : journal complet groupé par
 *   version (fetch no-cache /changelog.json, repli sur l'embarqué).
 *
 * Le stamp localStorage (ts-changelog-seen) est posé par ChangelogPopup à
 * la FERMETURE — ce composant est purement présentationnel.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchFullChangelog, type ChangelogEntry } from '../changelog';
import { Modal } from './ui';

function VersionBlock({ entry, first }: { entry: ChangelogEntry; first: boolean }) {
  return (
    <section className={first ? '' : 'mt-5 border-t border-parchment-200 pt-4'}>
      <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-display text-sm font-bold text-ink-700">{entry.title}</span>
        <span className="font-mono text-[10px] text-gold-600">v{entry.version}</span>
        <span className="font-mono text-[10px] text-ink-400">{entry.date}</span>
      </h3>
      <ul className="mt-2 space-y-1.5">
        {entry.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
            <span
              aria-hidden="true"
              className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold-500"
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChangelogDialog({
  open,
  onClose,
  entries,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  /** Mode diff : entrées pré-calculées. Mode full : ignoré (fetch). */
  entries?: ChangelogEntry[];
  mode: 'diff' | 'full';
}) {
  const { t } = useTranslation();
  const [full, setFull] = useState<ChangelogEntry[] | null>(null);

  useEffect(() => {
    if (open && mode === 'full') {
      setFull(null);
      let alive = true;
      void fetchFullChangelog().then((data) => {
        if (alive) setFull(data);
      });
      return () => {
        alive = false;
      };
    }
  }, [open, mode]);

  const list = mode === 'diff' ? (entries ?? []) : (full ?? []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'diff' ? t('changelog.nouveautes') : t('changelog.journal')}
    >
      {mode === 'diff' && (
        <p className="mb-4 border-b border-parchment-200 pb-3 text-xs italic text-ink-400">
          {t('changelog.mise.a.jour.recue')}
        </p>
      )}
      <div className="max-h-[55vh] overflow-y-auto overscroll-contain pr-1">
        {mode === 'full' && full === null ? (
          <p className="py-6 text-center text-sm text-ink-400">{t('common.loading')}</p>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">{t('changelog.vide')}</p>
        ) : (
          list.map((e, i) => <VersionBlock key={e.version} entry={e} first={i === 0} />)
        )}
      </div>
      {mode === 'diff' && (
        <button type="button" onClick={onClose} className="btn-primary mt-5 w-full">
          {t('changelog.continuer')}
        </button>
      )}
    </Modal>
  );
}
