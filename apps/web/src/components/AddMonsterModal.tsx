/**
 * Modal for searching the bestiary and adding a monster (group) to an encounter.
 * Debounced search calls /api/monsters (DB-filtered). Shows a mini stat preview
 * on selection. Lets the GM set a count for grouped monsters.
 */

import type { MonsterSummary } from '@table-sync/shared';
import { formatCR, MONSTER_SIZE_LABELS_FR } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { Modal, NumberField } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (slug: string, count: number, name: string) => void;
}

export default function AddMonsterModal({ open, onClose, onAdd }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MonsterSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MonsterSummary | null>(null);
  const [count, setCount] = useState(1);

  // Debounced search
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/api/monsters', {
          params: { search: search.trim(), limit: 30 },
        });
        setResults(res.data.monsters || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleAdd = useCallback(() => {
    if (!selected) return;
    onAdd(selected.slug, count, selected.name);
    setSelected(null);
    setSearch('');
    setCount(1);
    onClose();
  }, [selected, count, onAdd, onClose]);

  const handleClose = () => {
    setSelected(null);
    setSearch('');
    setCount(1);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Ajouter un monstre">
      {!selected ? (
        <>
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un monstre… (gobelin, dragon,…)"
            className="input w-full"
          />
          {loading && <p className="text-sm text-ink-400 mt-2">Recherche…</p>}
          {!loading && search.trim() && results.length === 0 && (
            <p className="text-sm text-ink-400 mt-2">Aucun monstre trouvé.</p>
          )}
          <div className="mt-3 max-h-[50vh] overflow-y-auto space-y-1">
            {results.map((m) => (
              <button
                type="button"
                key={m.slug}
                onClick={() => setSelected(m)}
                className="w-full text-left p-3 rounded-lg border border-parchment-200 hover:border-blood-300 hover:bg-blood-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-ink-400 ml-2">{m.type}</span>
                  </div>
                  <div className="text-xs text-ink-500 flex gap-3">
                    <span>🛡 {m.armorClass}</span>
                    <span>❤ {m.hitPoints}</span>
                    <span>FP {formatCR(m.challengeRating)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="card p-4 bg-parchment-50">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="section-title">{selected.name}</h3>
                <p className="text-sm text-ink-500">
                  {selected.type} · {MONSTER_SIZE_LABELS_FR[selected.size] ?? selected.size} · FP{' '}
                  {formatCR(selected.challengeRating)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-ink-400 hover:text-ink-700 text-sm"
              >
                ← Retour
              </button>
            </div>
            <div className="flex gap-4 mt-3 text-sm">
              <span className="px-2 py-1 rounded bg-blood-50 text-blood-700">
                🛡 CA {selected.armorClass}
              </span>
              <span className="px-2 py-1 rounded bg-red-50 text-red-700">
                ❤ PV {selected.hitPoints}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <label className="label" htmlFor="monster-count">
              Quantité (groupe)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCount(Math.max(1, count - 1))}
                className="btn-secondary w-10 h-10 p-0 text-lg"
              >
                −
              </button>
              <NumberField
                id="monster-count"
                min={1}
                max={50}
                value={count}
                onChange={setCount}
                className="input w-20 text-center"
              />
              <button
                type="button"
                onClick={() => setCount(Math.min(50, count + 1))}
                className="btn-secondary w-10 h-10 p-0 text-lg"
              >
                +
              </button>
              <span className="text-sm text-ink-400 ml-2">
                {count > 1 ? `${count} monstres (groupe)` : '1 monstre'}
              </span>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={handleClose} className="btn-secondary flex-1">
              Annuler
            </button>
            <button type="button" onClick={handleAdd} className="btn-primary flex-1">
              + Ajouter
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
