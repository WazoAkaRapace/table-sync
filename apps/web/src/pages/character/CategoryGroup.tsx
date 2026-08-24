import type { Character, InventoryEntry, ItemCategory, StorageLocation } from '@table-sync/shared';
import { CATEGORY_LABELS_FR } from '@table-sync/shared';
import { useState } from 'react';
import { InventoryRow } from './InventoryRow';

// ---------- Category group (collapsible) ----------

interface CategoryGroupProps {
  category: ItemCategory;
  entries: InventoryEntry[];
  character: Character;
  busyEntryIds: Set<number>;
  expandedId: number | null;
  flashEntryId: number | null;
  confirmDeleteId: number | null;
  locations: StorageLocation[];
  activeLocationId: number | null;
  canEdit: boolean;
  onToggleExpand: (id: number) => void;
  onStep: (entry: InventoryEntry, delta: number) => void;
  onSetQuantity: (entry: InventoryEntry, n: number) => void;
  onToggleEquipped: (entry: InventoryEntry) => void;
  onConfirmDelete: (entry: InventoryEntry) => void;
  onCancelDelete: (id: number) => void;
  onTransfer: (entry: InventoryEntry) => void;
  onMoveLocation: (entry: InventoryEntry, locationId: number) => void;
}

export function CategoryGroup({
  category,
  entries,
  character,
  busyEntryIds,
  expandedId,
  flashEntryId,
  confirmDeleteId,
  locations,
  activeLocationId,
  canEdit,
  onToggleExpand,
  onStep,
  onSetQuantity,
  onToggleEquipped,
  onConfirmDelete,
  onCancelDelete,
  onTransfer,
  onMoveLocation,
}: CategoryGroupProps) {
  const [collapsed, setCollapsed] = useState(true);
  const EMPTY_WATERSKIN_KG = 0.268;
  const totalWeight = entries.reduce((sum, e) => {
    const isEmptyWater = !!(e.notes?.includes('empty') && e.item.survivalTags?.includes('water'));
    const base = isEmptyWater ? EMPTY_WATERSKIN_KG : e.item.weightKg;
    return sum + (typeof base === 'number' ? base * e.quantity : 0);
  }, 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between mb-1.5 px-1"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2">
          <span
            className={`text-xs text-ink-400 w-4 chevron ${collapsed ? 'is-closed' : 'is-open'}`}
          >
            ▼
          </span>
          <span className="font-display text-sm font-semibold text-ink-700">
            {CATEGORY_LABELS_FR[category]}
          </span>
          <span className="text-xs text-ink-400">({entries.length})</span>
        </span>
        <span className="text-xs text-ink-400">{totalWeight.toFixed(1)} kg</span>
      </button>
      <div className={`expand-grid ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="expand-inner">
          <ul className="space-y-2">
            {entries.map((entry) => (
              <InventoryRow
                key={entry.id}
                entry={entry}
                character={character}
                busy={busyEntryIds.has(entry.id)}
                expanded={expandedId === entry.id}
                flashed={flashEntryId === entry.id}
                confirmingDelete={confirmDeleteId === entry.id}
                locations={locations}
                activeLocationId={activeLocationId}
                canEdit={canEdit}
                onToggleExpand={() => onToggleExpand(entry.id)}
                onStep={(d) => onStep(entry, d)}
                onSetQuantity={(n) => onSetQuantity(entry, n)}
                onToggleEquipped={() => onToggleEquipped(entry)}
                onConfirmDelete={() => onConfirmDelete(entry)}
                onCancelDelete={() => onCancelDelete(entry.id)}
                onTransfer={() => onTransfer(entry)}
                onMoveLocation={(locId) => onMoveLocation(entry, locId)}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
