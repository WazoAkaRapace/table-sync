import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderMarkdown } from './markdown';
import { Modal } from './ui';

/**
 * Modal d'édition d'une note markdown — le corps JUMEAU de l'onglet Notes
 * de la fiche (CharacterNotesTab) et de l'onglet Notes du carnet du MD
 * (DmNotebookPage). Titre + éditeur à bascule Éditer/Aperçu + astuce de
 * formatage + Enregistrer/Annuler. La CRUD reste chez chaque hôte (les
 * endpoints et le rafraîchissement divergent volontairement) ; ce composant
 * ne possède QUE le rendu.
 */
interface NoteEditorModalProps {
  open: boolean;
  /** Mode « modifier » (vs création) — change le titre du modal et le verbe. */
  editing: boolean;
  onClose: () => void;
  title: string;
  onTitleChange: (value: string) => void;
  content: string;
  onContentChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  /** Placeholder du champ titre (diverge entre fiche et carnet). */
  titlePlaceholder: string;
}

export function NoteEditorModal({
  open,
  editing,
  onClose,
  title,
  onTitleChange,
  content,
  onContentChange,
  saving,
  onSave,
  titlePlaceholder,
}: NoteEditorModalProps) {
  const { t } = useTranslation();
  const [previewMode, setPreviewMode] = useState(false);

  // Les hôtes réarment la bascule à CHAQUE ouverture (création ou édition) —
  // un seul effet ici remplace exactement ce comportement.
  useEffect(() => {
    if (open) setPreviewMode(false);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('notes.modifier.la.note') : t('notes.nouvelle.note')}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label">{t('notes.titre')}</span>
          <input
            className="input"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={titlePlaceholder}
            autoFocus
          />
        </label>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="label">{t('notes.contenu')}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPreviewMode(false)}
                className={`text-xs px-2 py-0.5 rounded ${!previewMode ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-500'}`}
              >
                {t('notes.editer')}
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode(true)}
                className={`text-xs px-2 py-0.5 rounded ${previewMode ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-500'}`}
              >
                {t('notes.apercu')}
              </button>
            </div>
          </div>
          {previewMode ? (
            <div className="input min-h-[180px] overflow-y-auto">
              {content.trim() ? (
                // Note de dépendances (ex-suppression Biome) : renderMarkdown escapes <, > and & in inline() before injecting its own trusted tags — no user HTML reaches the DOM.
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
              ) : (
                <span className="text-ink-400 italic">{t('notes.rien.a.previsualiser')}</span>
              )}
            </div>
          ) : (
            <textarea
              className="input min-h-[180px] resize-y font-mono text-sm"
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder={t('notes.modele.de.contenu')}
            />
          )}
        </div>

        <div className="bg-parchment-50 rounded-lg p-2 border border-parchment-200">
          <p className="text-[11px] text-ink-500">
            <strong>{t('notes.formatage')}</strong>
            {t('notes.gras.italique.code.titre.liste.gt')}
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !title.trim()}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? '…' : editing ? t('common.save') : t('notes.creer')}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost text-ink-700">
            {t('notes.annuler')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
