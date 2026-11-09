import type { CharacterNote } from '@table-sync/shared';
import { useTranslation } from 'react-i18next';
import { appLocale } from '../i18n';
import { parseSqliteDate } from '../utils';
import { Glyph } from './Glyph';
import { renderMarkdown } from './markdown';
import { SortableCard } from './SortableGrid';
import { ConfirmButton } from './ui';

/**
 * Carte d'une note — JUMEALE de l'onglet Notes de la fiche et de l'onglet
 * Notes du carnet du MD. Le seul écart volontaire entre les deux sites est
 * la visibilité du handle de drag (le carnet le masque pendant une
 * recherche) — passé en prop, le rendu reste unique.
 */
interface NoteCardProps {
  note: Pick<CharacterNote, 'id' | 'title' | 'content' | 'updatedAt'>;
  /** Afficher le handle de drag (site : fiche → >1 note ; carnet → hors recherche). */
  showHandle: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

export function NoteCard({ note, showHandle, onEdit, onRemove }: NoteCardProps) {
  const { t } = useTranslation();
  return (
    <SortableCard id={note.id} label={t('notes.deplacer.note.title', { note_title: note.title })}>
      {(handle, isDragging) => (
        <div className={`card p-4 flex flex-col gap-2 ${isDragging ? 'card-dragging' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display font-semibold text-ink-800">{note.title}</h3>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onEdit}
                className="text-ink-400 hover:text-blood-500 text-sm p-1"
                aria-label={t('notes.modifier.note.title', { note_title: note.title })}
              >
                <Glyph name="edit" />
              </button>
              <ConfirmButton
                onConfirm={onRemove}
                className="text-ink-400 hover:text-red-700 text-sm p-1 rounded-full transition-colors"
                armedClassName="bg-red-600 hover:brightness-90 text-white! px-2.5 py-1 font-semibold"
                title={t('notes.supprimer.note.title', { note_title: note.title })}
                ariaLabel={t('notes.supprimer.note.title', { note_title: note.title })}
                confirmChildren={t('notes.supprimer')}
              >
                ×
              </ConfirmButton>
              {showHandle && handle}
            </div>
          </div>
          {note.content && (
            <div
              className="text-sm text-ink-600 prose-sm max-w-none"
              // Note de dépendances (ex-suppression Biome) : renderMarkdown escapes <, > and & in inline() before injecting its own trusted tags — no user HTML reaches the DOM.
              dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
            />
          )}
          <span className="text-[10px] text-ink-400 mt-auto">
            {t('notes.modifie.le', {
              date: parseSqliteDate(note.updatedAt).toLocaleDateString(appLocale()),
            })}
          </span>
        </div>
      )}
    </SortableCard>
  );
}
