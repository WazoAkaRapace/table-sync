/**
 * Notes tab — free-form notes with simple Markdown-like formatting.
 * Supports: # headers, **bold**, *italic*, - lists, `code`, > quotes, --- dividers.
 */

import type { Character, CharacterNote } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { NoteCard } from '../components/NoteCard';
import { NoteEditorModal } from '../components/NoteEditorModal';
import { SortableGrid } from '../components/SortableGrid';
import { EmptyState } from '../components/ui';
import { useOwnEchoGuard, useResyncOnReconnect, useSyncEvent } from '../sync';

interface Props {
  character: Character;
  charId: number;
  partyId?: string;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

export default function CharacterNotesTab({
  character: _character,
  charId,
  partyId: _partyId,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  // Anti-double « propre écho » : nos écritures reviennent par WS (echo-exempt)
  // — l'onglet agissant recharge déjà localement, l'écho ne doit rien doubler.
  const ownEcho = useOwnEchoGuard();
  const [notes, setNotes] = useState<CharacterNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CharacterNote | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

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
      if (
        event.type === 'character:change' &&
        event.characterId === charId &&
        !ownEcho.isOwnEcho(event)
      )
        load();
    },
    [charId],
  );

  // Rattrapage de reconnexion : onglet à état local — recharge silencieux
  // après un trou de connexion (les événements manqués ne sont pas rejoués).
  useResyncOnReconnect(() => void load());

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setShowModal(true);
  };

  const openEdit = (note: CharacterNote) => {
    setEditing(note);
    setTitle(note.title);
    setContent(note.content ?? '');
    setShowModal(true);
  };

  const save = async () => {
    if (!title.trim()) {
      onError(t('notes.le.titre.est.requis'));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        ownEcho.stamp();
        await api.patch(`/api/character-notes/${editing.id}`, {
          title: title.trim(),
          content: content.trim() || null,
        });
      } else {
        ownEcho.stamp();
        await api.post(`/api/characters/${charId}/notes`, {
          title: title.trim(),
          content: content.trim() || undefined,
        });
      }
      setShowModal(false);
      await load();
      await onSaved();
    } catch {
      onError(t('notes.erreur.lors.de.la.sauvegarde'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      ownEcho.stamp();
      await api.delete(`/api/character-notes/${id}`);
      await load();
      await onSaved();
    } catch {
      onError(t('notes.erreur.lors.de.la.suppression'));
    }
  };

  // Drag-to-reorder: optimistic move, one PATCH per drop carrying the whole
  // order (self-healing, last writer wins). On failure: roll back and say so.
  const reorder = async (nextIds: number[]) => {
    const prev = notes;
    const byId = new Map(notes.map((n) => [n.id, n]));
    setNotes(nextIds.map((id) => byId.get(id)).filter((n) => n !== undefined));
    try {
      ownEcho.stamp();
      await api.patch(`/api/characters/${charId}/notes/order`, { order: nextIds });
    } catch {
      setNotes(prev);
      onError(t('notes.reorganisation.non.enregistree'));
    }
  };

  if (loading) return <p className="text-sm text-ink-400 animate-pulse">{t('notes.chargement')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between" data-tuto="notes-liste">
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
            <NoteCard
              key={note.id}
              note={note}
              showHandle={notes.length > 1}
              onEdit={() => openEdit(note)}
              onRemove={() => remove(note.id)}
            />
          ))}
        </SortableGrid>
      )}

      {/* Add/Edit modal */}
      <NoteEditorModal
        open={showModal}
        editing={editing !== null}
        onClose={() => setShowModal(false)}
        title={title}
        onTitleChange={setTitle}
        content={content}
        onContentChange={setContent}
        saving={saving}
        onSave={save}
        titlePlaceholder={t('notes.mes.quetes.en.cours')}
      />
    </div>
  );
}
