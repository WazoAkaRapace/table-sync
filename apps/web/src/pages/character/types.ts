import type { StorageLocation, StorageType } from '@table-sync/shared';

// ---------- Shared types & helpers for the character sheet modules ----------
// Extracted from CharacterInventoryPage — only the pieces used by several of
// the sheet's components live here. Nothing else is re-exported.

/** Callbacks every survival leaf needs to persist a change and report back. */
export interface SheetActionProps {
  /** No-op kept for compat (echo suppression is server-side), still called before mutations. */
  markLocalMutation: () => void;
  /** Invalidate/refetch the character sheet after a successful write. */
  onSaved: () => Promise<void>;
  /** Surface a French error message (toast) to the player. */
  onError: (msg: string) => void;
}

/** The five coin purse fields (mirrors the character's columns). */
export interface CoinsState {
  copper: number;
  silver: number;
  electrum: number;
  gold: number;
  platinum: number;
}

/** Payload of `POST /api/characters/:id/locations` (new mount or container). */
export interface NewLocationPayload {
  name: string;
  type: StorageType;
  strength?: number;
  multiplier?: number;
  capacityKg?: number;
  ownWeightKg?: number;
}

/** Extract the server's error message, falling back to a French default. */
export function apiError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e.response?.data?.error || fallback;
}

/** Glyph per storage location type (tabs, rows, move menus). */
export const LOCATION_TYPE_ICON: Record<StorageType, string> = {
  carried: '🧍',
  mount: '🐴',
  container: '📦',
};

/** Find the carried location (there should always be exactly one). */
export function findCarriedLocation(locations: StorageLocation[]): StorageLocation | undefined {
  return locations.find((l) => l.type === 'carried');
}
