/**
 * Dialog du journal des modifications — deux modes :
 * — diff (popup de chargement) : entrées nouvelles entre la dernière
 *   version vue et la courante, titre « Nouveautés », lien « tout voir » ;
 * — full (Mon compte) : journal complet groupé par version (fetch
 *   no-cache /changelog.json, repli sur l'embarqué).
 *
 * Le stamp localStorage (ts-changelog-seen) est posé par ChangelogPopup à
 * la FERMETURE — ce composant est purement présentationnel.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchFullChangelog, type ChangelogEntry } from '../changelog';
import { Modal } from './ui';

function VersionBlock({ entry }: { entry: ChangelogEntry }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink-700">
        <span>{entry.title}</span>
        <span className="font-mono text-[10px] font-normal text-ink-400">
          {entry.date} · {entry.sha}
        </span>
      </h3>
      <ul className="mt-1.5 space-y-1">
        {entry.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink-600">
            <span
              aria-hidden="true"
              className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gold-500"
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
        <p className="mb-3 text-xs text-ink-400">{t('changelog.mise.a.jour.recue')}</p>
      )}
      <div className="max-h-[55vh] overflow-y-auto pr-1">
        {mode === 'full' && full === null ? (
          <p className="py-4 text-center text-sm text-ink-400">{t('common.loading')}</p>
        ) : list.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-400">{t('changelog.vide')}</p>
        ) : (
          list.map((e) => <VersionBlock key={e.sha} entry={e} />)
        )}
      </div>
      {mode === 'diff' && (
        <button type="button" onClick={onClose} className="btn-primary mt-4 w-full">
          {t('changelog.continuer')}
        </button>
      )}
    </Modal>
  );
}
