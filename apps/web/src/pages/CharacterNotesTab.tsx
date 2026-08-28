/**
 * Notes tab — free-form notes with simple Markdown-like formatting.
 * Supports: # headers, **bold**, *italic*, - lists, `code`, > quotes, --- dividers.
 */

import type { Character, CharacterNote } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { SortableCard, SortableGrid } from '../components/SortableGrid';
import { ConfirmButton, EmptyState, Modal } from '../components/ui';
import { useSyncEvent } from '../sync';

interface Props {
  character: Character;
  charId: number;
  partyId?: string;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

/** Render simple Markdown to HTML (no external deps). */
function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    // Blank line
    if (!line.trim()) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push('');
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push('<hr class="border-parchment-200 my-2" />');
      continue;
    }
    // Headers
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      const level = h[1].length;
      const cls =
        level === 1
          ? 'font-display text-base font-bold text-ink-800 mt-2'
          : level === 2
            ? 'font-semibold text-ink-700 mt-1.5'
            : 'font-medium text-ink-600 mt-1';
      html.push(`<div class="${cls}">${inline(h[2])}</div>`);
      continue;
    }
    // Blockquote
    if (line.startsWith('> ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(
        `<blockquote class="border-l-2 border-blood-400 pl-2 text-ink-500 italic my-1">${inline(line.slice(2))}</blockquote>`,
      );
      continue;
    }
    // List items
    if (line.match(/^[-*]\s+/)) {
      if (!inList) {
        html.push('<ul class="list-disc list-inside space-y-0.5 my-1">');
        inList = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    // Regular paragraph
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    html.push(`<p>${inline(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

/** Inline formatting: bold, italic, code. */
function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-parchment-200 px-1 rounded text-blood-700 text-[11px]">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export default function CharacterNotesTab({
  character: _character,
  charId,
  partyId: _partyId,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<CharacterNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CharacterNote | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/characters/${charId}/notes`);
      const data = res.data?.notes ?? res.data ?? [];
      setNotes(Array.isArray(data) ? data : []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [charId]);

  useEffect(() => {
    load();
  }, [load]);

  useSyncEvent(
    (event) => {
      if (event.type === 'character:change' && event.characterId === charId) load();
    },
    [charId],
  );

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setPreviewMode(false);
    setShowModal(true);
  };

  const openEdit = (note: CharacterNote) => {
    setEditing(note);
    setTitle(note.title);
    setContent(note.content ?? '');
    setPreviewMode(false);
    setShowModal(true);
  };

  const save = async () => {
    if (!title.trim()) {
      onError('Le titre est requis');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/character-notes/${editing.id}`, {
          title: title.trim(),
          content: content.trim() || null,
        });
      } else {
        await api.post(`/api/characters/${charId}/notes`, {
          title: title.trim(),
          content: content.trim() || undefined,
        });
      }
      setShowModal(false);
      await load();
      await onSaved();
    } catch {
      onError('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/character-notes/${id}`);
      await load();
      await onSaved();
    } catch {
      onError('Erreur lors de la suppression');
    }
  };

  // Drag-to-reorder: optimistic move, one PATCH per drop carrying the whole
  // order (self-healing, last writer wins). On failure: roll back and say so.
  const reorder = async (nextIds: number[]) => {
    const prev = notes;
    const byId = new Map(notes.map((n) => [n.id, n]));
    setNotes(nextIds.map((id) => byId.get(id)).filter((n) => n !== undefined));
    try {
      await api.patch(`/api/characters/${charId}/notes/order`, { order: nextIds });
    } catch {
      setNotes(prev);
      onError(t('notes.reorganisation.non.enregistree'));
    }
  };

  if (loading) return <p className="text-sm text-ink-400 animate-pulse">{t('notes.chargement')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="section-title">
          {t('notes.notes')}
          <span className="text-ink-400 text-sm font-normal">({notes.length})</span>
        </h2>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          {t('notes.ajouter')}
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon="📝" title={t('notes.aucune.note')} hint={t('notes.cree.des.notes')} />
        </div>
      ) : (
        <SortableGrid
          ids={notes.map((n) => n.id)}
          onReorder={reorder}
          labelOf={(id) => notes.find((n) => n.id === Number(id))?.title ?? ''}
          className="grid gap-3 sm:grid-cols-2"
        >
          {notes.map((note) => (
            <SortableCard
              key={note.id}
              id={note.id}
              label={t('notes.deplacer.note.title', { note_title: note.title })}
            >
              {(handle, isDragging) => (
                <div
                  className={`card p-4 flex flex-col gap-2 ${isDragging ? 'card-dragging' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display font-semibold text-ink-800">{note.title}</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(note)}
                        className="text-ink-400 hover:text-blood-600 text-sm p-1"
                        aria-label={t('notes.modifier.note.title', { note_title: note.title })}
                      >
                        ✎
                      </button>
                      <ConfirmButton
                        onConfirm={() => remove(note.id)}
                        className="text-ink-400 hover:text-red-500 text-sm p-1 rounded-full transition-colors"
                        armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
                        title={t('notes.supprimer.note.title', { note_title: note.title })}
                        ariaLabel={t('notes.supprimer.note.title', { note_title: note.title })}
                        confirmChildren="Supprimer ?"
                      >
                        ×
                      </ConfirmButton>
                      {notes.length > 1 && handle}
                    </div>
                  </div>
                  {note.content && (
                    <div
                      className="text-sm text-ink-600 prose-sm max-w-none"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes <, > and & in inline() before injecting its own trusted tags — no user HTML reaches the DOM.
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
                    />
                  )}
                  <span className="text-[10px] text-ink-400 mt-auto">
                    Modifié le {new Date(`${note.updatedAt}Z`).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              )}
            </SortableCard>
          ))}
        </SortableGrid>
      )}

      {/* Add/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Modifier la note' : 'Nouvelle note'}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">Titre *</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('notes.mes.quetes.en.cours')}
              autoFocus
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="label">Contenu</span>
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
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes <, > and & in inline() before injecting its own trusted tags — no user HTML reaches the DOM.
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                ) : (
                  <span className="text-ink-400 italic">{t('notes.rien.a.previsualiser')}</span>
                )}
              </div>
            ) : (
              <textarea
                className="input min-h-[180px] resize-y font-mono text-sm"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  '# Titre\n\n**Gras** et *italique*\n\n- Liste\n- Autre élément\n\n> Citation\n\n`code`'
                }
              />
            )}
          </div>

          <div className="bg-parchment-50 rounded-lg p-2 border border-parchment-200">
            <p className="text-[11px] text-ink-500">
              <strong>Formatage :</strong>
              {t('notes.gras.italique.code.titre.liste.gt')}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !title.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editing ? 'Enregistrer' : 'Créer'}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              {t('notes.annuler')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
