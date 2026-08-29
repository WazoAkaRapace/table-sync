/**
 * Modal for adding player characters (PJ) to an encounter (GM only).
 * Multi-select: tick several characters then add them in one go,
 * or use the select-all toggle to bring the whole party into the fight.
 */

import type { CharacterSummary } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  characters: CharacterSummary[];
  onAdd: (characterIds: number[]) => void;
}

export default function AddPlayerModal({ open, onClose, characters, onAdd }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Fresh selection each time the modal opens
  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  const allSelected = characters.length > 0 && selected.size === characters.length;

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(characters.map((c) => c.id)));
  };

  const handleAdd = () => {
    if (selected.size === 0) return;
    onAdd([...selected]);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('ajoutjoueur.ajouter.des.personnages')}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-ink-500">
          {selected.size === 0
            ? t('ajoutjoueur.selectionne.un.personnage')
            : t('ajoutjoueur.n.selectionne.s', {
                n: selected.size,
                s: selected.size > 1 ? 's' : '',
              })}
        </span>
        <button
          type="button"
          onClick={toggleAll}
          disabled={characters.length === 0}
          className="text-sm font-medium text-blood-600 hover:text-blood-700 disabled:opacity-40"
        >
          {allSelected ? t('ajoutjoueur.tout.deselectionner') : t('ajoutjoueur.tout.selectionner')}
        </button>
      </div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {characters.map((c) => (
          <label
            key={c.id}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer select-none transition-colors ${
              selected.has(c.id)
                ? 'border-blood-400 bg-blood-50'
                : 'border-parchment-200 hover:border-blood-300 hover:bg-blood-50'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={() => toggle(c.id)}
              className="w-4 h-4 accent-blood-600"
            />
            <span className="font-medium">{c.name}</span>
            {c.characterClass && (
              <span className="text-sm text-ink-400 ml-auto">
                {c.classes && c.classes.length > 1
                  ? c.classes.map((e) => `${e.classKey} ${e.level}`).join(' / ')
                  : `${c.characterClass ?? ''} N${c.level}`}
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          {t('ajoutjoueur.annuler')}
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={selected.size === 0}
          className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('ajoutjoueur.ajouter')}
          {selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>
    </Modal>
  );
}
