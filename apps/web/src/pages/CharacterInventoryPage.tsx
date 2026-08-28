import type {
  CharacterInventory,
  ConcentrationCheck,
  InventoryEntry,
  Item,
  ItemCategory,
  LocationWeight,
  PartyDetail,
  Rarity,
  StorageLocation,
} from '@table-sync/shared';
import { findClass } from '@table-sync/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import CharacterStateBand from '../components/CharacterStateBand';
import ConcentrationAlert from '../components/ConcentrationAlert';
import {
  EMPTY_ITEM_IMAGE,
  ItemImageField,
  type ItemImageValue,
} from '../components/ItemImageField';
import TurnSlash, { combatVibrate, useTurnSlash } from '../components/TurnSlash';
import {
  BottomSheet,
  EmptyState,
  ErrorMsg,
  Fab,
  LoadingSpinner,
  Modal,
  type Toast,
  ToastStack,
} from '../components/ui';
import { useSync, useSyncEvent } from '../sync';
import CharacterDescriptionTab from './CharacterDescriptionTab';
import CharacterFeaturesTab from './CharacterFeaturesTab';
import CharacterNotesTab from './CharacterNotesTab';
import CharacterSkillsTab from './CharacterSkillsTab';
import CharacterSpellsTab from './CharacterSpellsTab';
import CharacterStatsTab from './CharacterStatsTab';
import { CatalogSearch } from './character/CatalogSearch';
import { CategoryGroup } from './character/CategoryGroup';
import { CoinPurse } from './character/CoinPurse';
import { LocationWeightBar } from './character/LocationWeightBar';
import { NewLocationModal } from './character/NewLocationModal';
import { SurvivalPanel } from './character/SurvivalPanel';
import { TransferModal } from './character/TransferModal';
import {
  apiError,
  type CoinsState,
  findCarriedLocation,
  LOCATION_TYPE_ICON,
  type NewLocationPayload,
} from './character/types';
import NpcPage from './NpcPage';

type CharacterTab =
  | 'inventory'
  | 'survival'
  | 'stats'
  | 'spells'
  | 'skills'
  | 'features'
  | 'description'
  | 'npcs'
  | 'notes';

/** Character sheet tabs (shared by the desktop top bar and the mobile bottom dock).
 *  Play-first order: the state tabs a player opens mid-session lead; the bag
 *  and the record tabs follow. */
const CHARACTER_TABS: {
  key: CharacterTab;
  label: string;
  icon: string;
  primary: boolean;
  short?: string;
}[] = [
  { key: 'survival', label: 'Survie', icon: '🩸', primary: true, short: 'Survie' },
  { key: 'stats', label: 'Caractéristiques', icon: '⚔️', primary: true, short: 'Caract.' },
  { key: 'spells', label: 'Sorts', icon: '✨', primary: true, short: 'Sorts' },
  { key: 'skills', label: 'Compétences', icon: '🎯', primary: true, short: 'Comp.' },
  { key: 'inventory', label: 'Inventaire', icon: '🎒', primary: false },
  { key: 'features', label: 'Traits', icon: '📋', primary: false, short: 'Traits' },
  { key: 'description', label: 'Description', icon: '👤', primary: false },
  { key: 'npcs', label: 'PNJ', icon: '🎭', primary: false },
  { key: 'notes', label: 'Notes', icon: '📝', primary: false },
];
const CATALOG_PAGE_SIZE = 30;

// ---------- Main component ----------

export default function CharacterInventoryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { partyId, charId } = useParams<{ partyId: string; charId: string }>();
  const queryClient = useQueryClient();

  // ---------- Inventory / character state (react-query) ----------
  // ['inventory', charId] is the single source of truth for the sheet: every
  // mutation and every WS sync event invalidates it. Structural sharing keeps
  // `data` referentially stable across refetches when the payload is deep-equal
  // — the old JSON.stringify diff guard, for free.
  const inventoryQuery = useQuery({
    queryKey: ['inventory', Number(charId)],
    enabled: !!charId,
    queryFn: async () => {
      const res = await api.get<CharacterInventory>(`/api/characters/${charId}/inventory`);
      return res.data;
    },
  });
  const data = inventoryQuery.data ?? null;
  const loading = inventoryQuery.isPending;
  const error = inventoryQuery.error
    ? apiError(inventoryQuery.error, "Impossible de charger l'inventaire")
    : '';
  // The in-tab banner is dismissible; remembering WHICH message was dismissed
  // re-arms it automatically when a different error lands.
  const [dismissedError, setDismissedError] = useState('');

  // Party role: the GM can edit any sheet in their party (mirrors the
  // server's isPartyGM check)
  const gmQuery = useQuery({
    queryKey: ['party-role', Number(partyId), user?.id ?? null],
    enabled: !!partyId && !!user,
    queryFn: async () => {
      const res = await api.get<PartyDetail>(`/api/parties/${partyId}`);
      return {
        isGM: res.data.members.some((m) => m.userId === user?.id && m.role === 'gm'),
        playersCreateItems: res.data.party.playersCreateItems,
      };
    },
  });
  const isGM = gmQuery.data?.isGM ?? false;

  // Inline-editable character name lives in the state band; the portage
  // multiplier too (a derived stat of the encumbrance line).
  // Toast system — errors linger longer than successes (noisy table)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(
      () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      kind === 'error' ? 6000 : 2500,
    );
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Row highlight (flash newly added/changed rows)
  const [flashEntryId, setFlashEntryId] = useState<number | null>(null);

  // Per-entry optimistic in-flight flags
  const [busyEntryIds, setBusyEntryIds] = useState<Set<number>>(new Set());

  // Expanded entries (show description + actions)
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Confirm-delete state (per entry)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Coin purse (auto-save on blur)
  const [coins, setCoins] = useState<CoinsState>({
    copper: 0,
    silver: 0,
    electrum: 0,
    gold: 0,
    platinum: 0,
  });
  const [coinsDirty, setCoinsDirty] = useState(false);

  // Catalog (in bottom-sheet on mobile, right column on desktop)
  const [catalogOpen, setCatalogOpen] = useState(false); // mobile sheet
  const [moreOpen, setMoreOpen] = useState(false); // mobile « Plus » tabs sheet
  // Mobile combat: the dock hub doubles as the combat indicator
  const [hubCombat, setHubCombat] = useState<{
    encounterId: number;
    partyId: number;
    status: string;
    round: number;
    needsInitiative: boolean;
    isMyTurn: boolean;
    currentCombatantName: string | null;
    myCombatantId: number | null;
    initiativeBonus: number;
  } | null>(null);
  const [hubInitOpen, setHubInitOpen] = useState(false);
  const [hubInitInput, setHubInitInput] = useState('');
  const [hubInitError, setHubInitError] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState<'' | ItemCategory>('');
  const [catalogRarity, setCatalogRarity] = useState<'' | Rarity>('');
  const [addingItemId, setAddingItemId] = useState<number | null>(null);

  // Custom item creation — players too, when the party allows it (GM setting)
  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [createItemName, setCreateItemName] = useState('');
  const [createItemCategory, setCreateItemCategory] = useState('custom');
  const [createItemWeight, setCreateItemWeight] = useState('');
  const [createItemDesc, setCreateItemDesc] = useState('');
  // Illustration stagée du créateur d'objet — envoyée après le POST (une fois
  // l'id connu), jamais dans le JSON de création.
  const [createItemImage, setCreateItemImage] = useState<ItemImageValue>(EMPTY_ITEM_IMAGE);
  const [creatingItem, setCreatingItem] = useState(false);

  // Transfer modal
  const [transferEntry, setTransferEntry] = useState<InventoryEntry | null>(null);

  // Storage locations: active tab + new-transport modal
  const [activeLocationId, setActiveLocationId] = useState<number | null>(null);
  const [showNewLocationModal, setShowNewLocationModal] = useState(false);
  // Confirm-delete location (per location id)
  const [confirmDeleteLocationId, setConfirmDeleteLocationId] = useState<number | null>(null);

  // First-run tour
  const [showTour, setShowTour] = useState(false);

  // Active tab — the fiche opens on state (Survie), not on the bag
  const [activeTab, setActiveTab] = useState<CharacterTab>('survival');
  // Concentration save popup — page-level because the state band's HP quick-edit
  // (pinned above EVERY tab) must surface it wherever the player stands.
  const [concCheck, setConcCheck] = useState<ConcentrationCheck | null>(null);
  useEffect(() => {
    const seen = localStorage.getItem('dnd-inv-tour-seen');
    if (!seen && !loading) {
      const t = setTimeout(() => setShowTour(true), 800);
      return () => clearTimeout(t);
    }
  }, [loading]);
  const dismissTour = () => {
    setShowTour(false);
    localStorage.setItem('dnd-inv-tour-seen', '1');
  };

  // ---------- Sheet data side-effects ----------
  // Re-sync the coin draft + active location tab whenever fresh sheet data
  // lands. Structural sharing means `data` only changes when the payload
  // really did — same contract as the old diff guards.
  useEffect(() => {
    if (!data) return;
    setCoins({
      copper: data.character.copper,
      silver: data.character.silver,
      electrum: data.character.electrum,
      gold: data.character.gold,
      platinum: data.character.platinum,
    });
    // Default the active tab to the carried location / fall back if deleted
    setActiveLocationId((prev) => {
      const stillExists = prev !== null && data.locations.some((l) => l.id === prev);
      if (stillExists) return prev;
      const carried = findCarriedLocation(data.locations);
      return carried ? carried.id : (data.locations[0]?.id ?? null);
    });
  }, [data]);

  // ---------- Real-time sync: WS events invalidate the sheet query ----------
  const { markLocalMutation } = useSync();
  const currentCharId = Number(charId);
  const currentPartyId = Number(partyId);

  useSyncEvent(
    (event) => {
      // Only react to events for this character or this party
      if (event.partyId !== currentPartyId) return;
      if (event.type === 'inventory:change') {
        // If it involves this character (either as source or transfer target)
        if (event.characterId === currentCharId || event.toCharacterId === currentCharId) {
          queryClient.invalidateQueries({ queryKey: ['inventory', currentCharId] });
          // Notify on incoming transfer
          if (
            event.action === 'transfer' &&
            event.toCharacterId === currentCharId &&
            event.itemName
          ) {
            pushToast(`Objet reçu : ${event.itemName}`);
          }
        }
      } else if (event.type === 'character:change') {
        // The server deliberately echoes our own edits (GM-two-tabs exception)
        // — invalidation is idempotent, so no echo guard is needed.
        if (event.characterId === currentCharId) {
          queryClient.invalidateQueries({ queryKey: ['inventory', currentCharId] });
        }
      }
    },
    [currentCharId, currentPartyId],
  );

  // ---------- Debounced catalog search ----------
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(catalogSearch), 300);
    return () => clearTimeout(t);
  }, [catalogSearch]);

  // ---------- Catalog search (paginated via useInfiniteQuery) ----------
  // Only fetch when there's a search query or active filters — don't show all 599 items
  const hasQuery = !!(debouncedSearch.trim() || catalogCategory || catalogRarity);

  const catalogQuery = useInfiniteQuery({
    queryKey: ['catalog', Number(partyId), debouncedSearch.trim(), catalogCategory, catalogRarity],
    enabled: hasQuery,
    // Catalog is best-effort — fail silently like the old manual fetch
    retry: false,
    // Keep the previous results visible while a new search loads
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = {
        limit: CATALOG_PAGE_SIZE,
        offset: pageParam,
        // Party context: SRD + this party's custom items — never another
        // party's, even ones the user belongs to elsewhere.
        partyId: Number(partyId),
      };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (catalogCategory) params.category = catalogCategory;
      if (catalogRarity) params.rarity = catalogRarity;
      const res = await api.get<{ items: Item[]; total: number; limit: number; offset: number }>(
        '/api/items',
        { params },
      );
      return res.data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.offset + lastPage.items.length < lastPage.total
        ? lastPage.offset + CATALOG_PAGE_SIZE
        : undefined,
  });
  // Unfiltered = empty catalog (the old effect cleared the list too)
  const catalogItems: Item[] = hasQuery
    ? (catalogQuery.data?.pages.flatMap((p) => p.items) ?? [])
    : [];
  const catalogTotal = hasQuery ? (catalogQuery.data?.pages[0]?.total ?? 0) : 0;
  const catalogLoading = catalogQuery.isFetching;
  // Offset of the last loaded page — same display semantics as the manual
  // fetch (drives the « Charger plus (N restants) » count)
  const catalogOffset = hasQuery ? (catalogQuery.data?.pages.at(-1)?.offset ?? 0) : 0;

  // ---------- Mutations ----------
  // All writes go through useMutation; success paths invalidate ['inventory']
  // (refreshInventory below) while toasts keep the err.response?.data?.error
  // message priority via apiError().

  const patchEntryMutation = useMutation({
    mutationFn: (vars: { id: number; patch: Record<string, unknown> }) =>
      api.patch(`/api/inventory/${vars.id}`, vars.patch),
  });
  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/inventory/${id}`),
  });
  const addCatalogItemMutation = useMutation({
    mutationFn: (vars: { itemId: number; storageLocationId: number | null }) =>
      api.post(`/api/characters/${charId}/inventory`, {
        itemId: vars.itemId,
        quantity: 1,
        storageLocationId: vars.storageLocationId,
      }),
  });
  const createLocationMutation = useMutation({
    mutationFn: (payload: NewLocationPayload) =>
      api.post<{ location: StorageLocation }>(`/api/characters/${charId}/locations`, payload),
  });
  const deleteLocationMutation = useMutation({
    mutationFn: (locationId: number) => api.delete(`/api/locations/${locationId}`),
  });
  const saveCoinsMutation = useMutation({
    mutationFn: (coinsPatch: CoinsState) => api.patch(`/api/characters/${charId}`, coinsPatch),
  });

  const withBusy = async (entryId: number, fn: () => Promise<void>) => {
    markLocalMutation(); // Mark as local mutation so sync echo is skipped
    setBusyEntryIds((prev) => new Set(prev).add(entryId));
    try {
      await fn();
    } finally {
      setBusyEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  };

  // Every write path funnels here: invalidate the sheet query (active
  // observers refetch immediately) and flash the touched row when asked.
  const refreshInventory = useCallback(
    async (flashId?: number) => {
      if (!charId) return;
      if (flashId !== undefined) {
        setFlashEntryId(flashId);
        setTimeout(() => setFlashEntryId(null), 1200);
      }
      await queryClient.invalidateQueries({ queryKey: ['inventory', Number(charId)] });
    },
    [charId, queryClient],
  );

  // Stepper: -1 / +1. At 0, enter confirm-delete state instead of silent delete.
  const stepQuantity = async (entry: InventoryEntry, delta: number) => {
    const next = entry.quantity + delta;
    if (next <= 0) {
      // Enter confirm-delete state instead of silent deletion
      setConfirmDeleteId(entry.id);
      // Auto-revert after 4 seconds
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
      confirmDeleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 4000);
      return;
    }
    await withBusy(entry.id, async () => {
      try {
        await patchEntryMutation.mutateAsync({ id: entry.id, patch: { quantity: next } });
        await refreshInventory(entry.id);
      } catch (err) {
        pushToast(apiError(err, 'Erreur de mise à jour'), 'error');
      }
    });
  };

  const setQuantity = async (entry: InventoryEntry, raw: number) => {
    const qty = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
    if (qty <= 0) {
      setConfirmDeleteId(entry.id);
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
      confirmDeleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 4000);
      return;
    }
    await withBusy(entry.id, async () => {
      try {
        await patchEntryMutation.mutateAsync({ id: entry.id, patch: { quantity: qty } });
        await refreshInventory(entry.id);
      } catch (err) {
        pushToast(apiError(err, 'Erreur'), 'error');
      }
    });
  };

  const confirmDelete = async (entry: InventoryEntry) => {
    setConfirmDeleteId(null);
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    await withBusy(entry.id, async () => {
      try {
        await deleteEntryMutation.mutateAsync(entry.id);
        if (expandedId === entry.id) setExpandedId(null);
        await refreshInventory();
        pushToast(`${entry.item.name || entry.item.name} retiré du sac à dos`);
      } catch (err) {
        pushToast(apiError(err, 'Erreur de suppression'), 'error');
      }
    });
  };

  const cancelDelete = (_entryId: number) => {
    setConfirmDeleteId(null);
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
  };

  const toggleEquipped = async (entry: InventoryEntry) => {
    await withBusy(entry.id, async () => {
      try {
        await patchEntryMutation.mutateAsync({
          id: entry.id,
          patch: { equipped: !entry.equipped },
        });
        await refreshInventory(entry.id);
      } catch (err) {
        pushToast(apiError(err, 'Erreur'), 'error');
      }
    });
  };

  const addFromCatalog = async (item: Item) => {
    markLocalMutation();
    setAddingItemId(item.id);
    try {
      // Send the carried location id as null (carried), non-carried as its id
      await addCatalogItemMutation.mutateAsync({
        itemId: item.id,
        storageLocationId: activeLocationId,
      });
      await refreshInventory();
      pushToast(`+1 ${item.name || item.name} ajouté au sac à dos`);
    } catch (err) {
      pushToast(apiError(err, "Impossible d'ajouter l'objet"), 'error');
    } finally {
      setAddingItemId(null);
    }
  };

  // ---------- Custom item creation (players too, party setting) ----------

  function openItemCreator(name: string) {
    setCreateItemName(name);
    setCreateItemCategory('custom');
    setCreateItemWeight('');
    setCreateItemDesc('');
    setCreateItemImage(EMPTY_ITEM_IMAGE);
    // Fold the catalog sheet: the creator modal takes over, and the freshly
    // created item lands in the bag (toast) rather than behind the sheet.
    setCatalogOpen(false);
    setCreateItemOpen(true);
  }

  const submitCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createItemName.trim() || creatingItem) return;
    setCreatingItem(true);
    try {
      const res = await api.post(`/api/parties/${partyId}/items`, {
        name: createItemName.trim(),
        category: createItemCategory,
        weightKg: createItemWeight.trim() === '' ? null : Number(createItemWeight),
        description: createItemDesc.trim() || undefined,
      });
      const created: Item = res.data.item;
      setCreateItemOpen(false);
      // L'illustration part après la création (l'id vient d'exister). Si elle
      // échoue, l'objet reste créé — toast ciblé, jamais de perte silencieuse.
      if (createItemImage.staged) {
        try {
          const form = new FormData();
          form.append('image', createItemImage.staged.blob, 'illustration.jpg');
          await api.put(`/api/items/${created.id}/image`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          pushToast('Illustration non envoyée — réessaie depuis Modifier', 'error');
        }
      }
      setCreateItemImage(EMPTY_ITEM_IMAGE);
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
      pushToast(`« ${created.name || created.name} » créé`);
      // The search was meant to ADD the item — land it in the bag right away.
      addFromCatalog(created);
    } catch (err) {
      pushToast(apiError(err, "Impossible de créer l'objet"), 'error');
    } finally {
      setCreatingItem(false);
    }
  };

  // ---------- Storage location mutations ----------

  const createLocation = async (payload: NewLocationPayload) => {
    markLocalMutation();
    try {
      const res = await createLocationMutation.mutateAsync(payload);
      await refreshInventory();
      // Auto-select the newly created tab
      setActiveLocationId(res.data.location.id);
      pushToast(`Transport ajouté : ${payload.name}`);
      setShowNewLocationModal(false);
    } catch (err) {
      pushToast(apiError(err, "Impossible d'ajouter le transport"), 'error');
    }
  };

  const deleteLocation = async (location: StorageLocation) => {
    markLocalMutation();
    setConfirmDeleteLocationId(null);
    try {
      await deleteLocationMutation.mutateAsync(location.id);
      // Fall back to carried tab before the refresh recomputes active id
      const carried = findCarriedLocation(data?.locations ?? []);
      if (carried) setActiveLocationId(carried.id);
      await refreshInventory();
      pushToast(`${location.name} supprimé — objets replacés sur le personnage`);
    } catch (err) {
      pushToast(apiError(err, 'Erreur de suppression'), 'error');
    }
  };

  const moveEntryToLocation = async (entry: InventoryEntry, locationId: number) => {
    await withBusy(entry.id, async () => {
      try {
        await patchEntryMutation.mutateAsync({
          id: entry.id,
          patch: { storageLocationId: locationId },
        });
        await refreshInventory(entry.id);
        const target = data?.locations.find((l) => l.id === locationId);
        pushToast(
          `${entry.item.name || entry.item.name} déplacé vers ${target?.name ?? "l'emplacement"}`,
        );
      } catch (err) {
        pushToast(apiError(err, 'Erreur lors du déplacement'), 'error');
      }
    });
  };

  // Coin purse: auto-save on blur when dirty
  const saveCoins = useCallback(async () => {
    if (!coinsDirty) return;
    markLocalMutation();
    try {
      await saveCoinsMutation.mutateAsync(coins);
      setCoinsDirty(false);
      await refreshInventory();
      pushToast('Bourse mise à jour');
    } catch (err) {
      pushToast(apiError(err, 'Erreur de sauvegarde'), 'error');
    }
  }, [coins, coinsDirty, pushToast, refreshInventory, markLocalMutation, saveCoinsMutation]);

  const dismissError = () => setDismissedError(error);

  // ---------- Combat indicator hooks ----------
  // MUST stay above the render guards: hooks after a conditional return
  // change the hook count between renders and crash React (#310).
  // The sync listener bumps a counter that re-runs the effect below.
  const [combatRefresh, setCombatRefresh] = useState(0);
  useSyncEvent(
    (event) => {
      if (event.partyId === Number(partyId) && event.type === 'combat:change') {
        setCombatRefresh((n) => n + 1);
      }
    },
    [partyId],
  );

  // Mobile combat: check if this character is in an active/setup encounter.
  // Only setState when the combat status actually changes to avoid re-render loops.
  const hubCombatRef = useRef<string>('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps narrowed on purpose — full data?.character would refetch encounters on every inventory refresh; the hubCombatRef snapshot guard makes extra runs safe, and combatRefresh is a manual bump that works around the server-side echo suppression.
  useEffect(() => {
    if (!user || !data?.character) return;
    let alive = true;
    const load = async () => {
      try {
        const encRes = await api.get(`/api/parties/${partyId}/encounters`);
        const encounters = encRes.data.encounters || [];
        const relevant = encounters.filter(
          (e: any) => e.status === 'active' || e.status === 'setup',
        );
        for (const enc of relevant) {
          const det = await api.get(`/api/encounters/${enc.id}`);
          const detail = det.data.encounter;
          const mine = detail.combatants.find((c: any) => c.characterId === Number(charId));
          if (mine) {
            const current = detail.combatants[detail.turnIndex];
            const dexMod = Math.floor(((data?.character?.dexterity ?? 10) - 10) / 2);
            const next = {
              encounterId: detail.id,
              partyId: detail.partyId,
              status: detail.status,
              round: detail.round,
              needsInitiative: mine.initiative === null,
              isMyTurn: detail.status === 'active' && current?.id === mine.id,
              currentCombatantName: current?.name ?? null,
              myCombatantId: mine.id,
              initiativeBonus: mine.initiativeBonus ?? dexMod,
            };
            // Only update state if the combat snapshot actually changed
            const key = JSON.stringify(next);
            if (alive && key !== hubCombatRef.current) {
              hubCombatRef.current = key;
              setHubCombat(next);
            }
            return;
          }
        }
        if (alive && hubCombatRef.current !== '') {
          hubCombatRef.current = '';
          setHubCombat(null);
        }
      } catch {
        /* silent */
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [user, partyId, charId, data?.character?.ownerId, combatRefresh]);

  // "Your turn" sword-cut on the mobile combat indicator (dock card + hub)
  const turnSlash = useTurnSlash(!!hubCombat?.isMyTurn);

  // Haptic cue the moment the initiative prompt appears
  const needsInitNow = !!hubCombat?.needsInitiative;
  const prevDockNeedsInit = useRef(false);
  useEffect(() => {
    const rising = needsInitNow && !prevDockNeedsInit.current;
    prevDockNeedsInit.current = needsInitNow;
    if (rising) combatVibrate([80, 40, 80]);
  }, [needsInitNow]);

  // "J'ai fini mon tour" — the owner of the current combatant advances the
  // turn from the sheet (thumb zone, no reach for the MD's tracker). One tap,
  // no confirm: the button only exists while the turn is actually theirs and
  // the server re-checks ownership anyway.
  const [endingTurn, setEndingTurn] = useState(false);
  const endMyTurn = async () => {
    if (!hubCombat || endingTurn) return;
    setEndingTurn(true);
    try {
      await api.post(`/api/encounters/${hubCombat.encounterId}/end-my-turn`);
      // combat:change is echo-EXEMPT (a user can be GM in one tab and player
      // in another), so the sync listener already bumps combatRefresh; this
      // manual bump covers the event losing the race.
      setCombatRefresh((n) => n + 1);
    } catch {
      // Most likely the MD advanced the same turn a beat earlier
      pushToast('Le tour a déjà changé', 'error');
      setCombatRefresh((n) => n + 1);
    } finally {
      setEndingTurn(false);
    }
  };

  // ---------- Render guards ----------
  if (loading) return <LoadingSpinner label="Chargement du sac à dos…" />;
  if (error && !data) return <ErrorMsg message={error} />;
  if (!data) return <ErrorMsg message="Personnage introuvable" />;

  const { character, encumbrance, locations, locationWeights } = data;

  // Only the sheet owner or the party GM can edit (the API enforces the same rule)
  const canEdit = data.character.ownerId === user?.id || isGM;

  // Non-casters never open Sorts: Traits takes its dock slot, Sorts moves to the hub
  const isCasterClass =
    !!findClass(character.characterClass) &&
    findClass(character.characterClass)!.spellcasting !== 'none';
  const dockPrimaryList: CharacterTab[] = isCasterClass
    ? ['survival', 'stats', 'spells', 'skills']
    : ['survival', 'stats', 'features', 'skills'];

  // Resolve the active location (fall back to carried, then first)
  const activeLocation: StorageLocation | undefined =
    locations.find((l) => l.id === activeLocationId) ??
    findCarriedLocation(locations) ??
    locations[0];
  const activeLocationResolvedId = activeLocation?.id ?? null;
  const isActiveCarried = activeLocation?.type === 'carried';

  // Filter entries to the active location (each entry has a storageLocationId)
  const entries = data.entries.filter((e) => e.storageLocationId === activeLocationResolvedId);

  // Active location's weight info (for the per-location bar)
  const activeLocationWeight: LocationWeight | undefined = locationWeights.find(
    (lw) => lw.locationId === activeLocationResolvedId,
  );

  // Group entries by category for collapsible sections
  const grouped = groupByCategory(entries);

  // Catalog content (shared between desktop column and mobile bottom-sheet)
  const catalogContent = (
    <CatalogSearch
      search={catalogSearch}
      setSearch={setCatalogSearch}
      category={catalogCategory}
      setCategory={setCatalogCategory}
      rarity={catalogRarity}
      setRarity={setCatalogRarity}
      items={catalogItems}
      total={catalogTotal}
      loading={catalogLoading}
      addingItemId={addingItemId}
      offset={catalogOffset}
      readOnly={!canEdit}
      canCreateItem={canEdit && (isGM || (gmQuery.data?.playersCreateItems ?? false))}
      onCreateItem={openItemCreator}
      onAdd={addFromCatalog}
      onLoadMore={() => catalogQuery.fetchNextPage()}
    />
  );

  return (
    <div className="space-y-4 pb-16 lg:pb-0">
      {/* Bandeau d'état — pinned state masthead above every tab. The sheet's
          arrival: the band rises first, the content settles beneath it. */}
      <div className="sheet-rise">
        <CharacterStateBand
          character={character}
          entries={data.entries}
          encumbrance={encumbrance}
          canEdit={canEdit}
          combat={hubCombat}
          combatHref={
            hubCombat ? `/party/${hubCombat.partyId}/combat?enc=${hubCombat.encounterId}` : null
          }
          onNavigate={(tab) => {
            setActiveTab(tab);
            window.scrollTo(0, 0);
          }}
          onOpenInitiative={() => setHubInitOpen(true)}
          onSaved={refreshInventory}
          onError={(msg) => pushToast(msg, 'error')}
          onNotice={(msg) => pushToast(msg)}
          onConcentrationCheck={setConcCheck}
        />
      </div>

      {/* Concentration save after damage — portaled banner, fed by the band
          (any tab) and the Survie tracker alike. */}
      {concCheck && (
        <ConcentrationAlert
          check={concCheck}
          onDone={() => setConcCheck(null)}
          onBreak={async () => {
            await api.patch(`/api/characters/${Number(charId)}`, { concentrating: false });
            await refreshInventory();
          }}
        />
      )}

      {/* ---------- Tab navigation — desktop top bar (settles 60ms behind the band) ---------- */}
      <div
        className="sheet-rise -mx-4 px-4 sm:mx-0 sm:px-0 hidden lg:block"
        style={{ animationDelay: '60ms' }}
      >
        <div className="flex items-center gap-1 bg-parchment-100 rounded-xl p-1 overflow-x-auto no-scrollbar">
          {CHARACTER_TABS.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'bg-blood-600 text-white shadow-sm'
                  : 'text-ink-900 hover:bg-parchment-200'
              }`}
              aria-pressed={activeTab === tab.key}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Tab navigation — floating mobile dock with sliding indicator ---------- */}
      <div className="lg:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-2rem)]">
        {/* Combat status card — always visible, attached to the top of the dock.
            Initiative pending: expands inline with input + dice. */}
        {hubCombat?.needsInitiative && hubCombat.myCombatantId ? (
          <div
            className={`mb-[-6px] mx-auto w-fit max-w-full rounded-t-xl rounded-b-md shadow-md border border-b-0 overflow-hidden transition-all duration-300 bg-yellow-400 border-yellow-500 ${
              hubInitOpen ? 'max-h-44' : 'max-h-12'
            }`}
          >
            <button
              type="button"
              onClick={() => setHubInitOpen((o) => !o)}
              className="block w-full px-3 py-1.5 text-xs font-semibold text-ink-900"
              aria-expanded={hubInitOpen}
            >
              🎲 Lance ton initiative !
            </button>
            {hubInitOpen && (
              <>
                <div className="px-3 pb-2 pt-1 flex items-center gap-2 bg-yellow-50 border-t border-yellow-300">
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={hubInitInput}
                    onChange={(e) => {
                      setHubInitInput(e.target.value);
                      if (hubInitError) setHubInitError(false);
                    }}
                    placeholder="—"
                    className="input input-compact text-sm py-1"
                    autoFocus
                    aria-label="Ton initiative"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const v = parseInt(hubInitInput, 10);
                      if (Number.isNaN(v)) return;
                      try {
                        await api.patch(
                          `/api/encounters/${hubCombat.encounterId}/combatants/${hubCombat.myCombatantId}/initiative`,
                          { initiative: v },
                        );
                        setHubInitOpen(false);
                        setHubInitInput('');
                        setHubInitError(false);
                        // The combat:change echo is suppressed server-side for the
                        // actor, so the hub card would keep asking for initiative.
                        // Bump the refresh counter to reload the combat status now.
                        setCombatRefresh((n) => n + 1);
                        await refreshInventory();
                      } catch {
                        setHubInitError(true);
                      }
                    }}
                    className="btn-primary text-xs px-3 py-1"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const roll = Math.floor(Math.random() * 20) + 1;
                      setHubInitInput(String(roll + hubCombat.initiativeBonus));
                      if (hubInitError) setHubInitError(false);
                    }}
                    className="btn-secondary text-xs px-2 py-1"
                    title={`d20 + ${hubCombat.initiativeBonus} (DEX)`}
                  >
                    🎲
                  </button>
                </div>
                {hubInitError && (
                  <p className="px-3 pb-2 text-xs text-red-600" role="alert">
                    {t('inv.echec.de.l.enregistrement.reessaie')}
                  </p>
                )}
              </>
            )}
          </div>
        ) : hubCombat?.isMyTurn ? (
          // Your turn: the announce card becomes the action card — the card
          // that opens the turn closes it (header + body grammar mirrors the
          // initiative card above). One tap ends the turn; the link keeps the
          // path to the full tracker. band-rise: the same 0.2 s sentence the
          // Agir line speaks at the instant the turn becomes yours.
          <div className="band-rise relative mb-[-6px] mx-auto w-fit max-w-full rounded-t-xl rounded-b-md shadow-md border border-b-0 bg-blood-600 border-blood-700 combat-turn-glow overflow-hidden">
            <div className="relative px-3 py-1.5 text-xs font-bold text-parchment-50 text-center">
              {t('inv.a.toi.de.jouer')}
              <TurnSlash active={turnSlash} />
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 bg-parchment-50 border-t border-blood-300">
              <button
                type="button"
                onClick={endMyTurn}
                disabled={endingTurn}
                className="btn-primary min-h-[44px] flex-1 px-4 text-sm whitespace-nowrap"
                aria-label={t('inv.terminer.mon.tour.passer.au.combattant')}
              >
                ✓ J'ai fini mon tour
              </button>
              <Link
                to={`/party/${hubCombat.partyId}/combat?enc=${hubCombat.encounterId}`}
                className="btn-secondary min-h-[44px] px-3 text-xs whitespace-nowrap"
              >
                {t('inv.voir.le.combat')}
              </Link>
            </div>
          </div>
        ) : (
          hubCombat && (
            <Link
              to={`/party/${hubCombat.partyId}/combat?enc=${hubCombat.encounterId}`}
              className="relative block mb-[-6px] mx-auto w-fit max-w-full px-3 py-1.5 rounded-t-xl rounded-b-md text-xs font-semibold shadow-md border border-b-0 transition-colors bg-ink-900 text-parchment-200 border-ink-700"
              aria-label={t('inv.combat.en.cours.ouvrir.le.traqueur')}
            >
              {hubCombat.currentCombatantName
                ? `⚔ ${hubCombat.currentCombatantName}`
                : '⚔ Combat en préparation'}
              <TurnSlash active={turnSlash} />
            </Link>
          )
        )}
        {(() => {
          const dockPrimary = dockPrimaryList;
          const primaries = dockPrimary.map((k) => CHARACTER_TABS.find((t) => t.key === k)!);
          const left = primaries.slice(0, 2);
          const right = primaries.slice(2);
          const secondary = CHARACTER_TABS.find(
            (t) => t.key === activeTab && !dockPrimary.includes(t.key),
          );
          // Flex order: [slot][slot][hub][slot][slot] — equal 56px blocks with
          // 4px gaps after an 8px padding. The hub occupies visual slot 2, so
          // right-side tabs skip it; the indicator slides behind the hub only
          // when a secondary tab is selected.
          const activeIdx = primaries.findIndex((p) => p.key === activeTab);
          const indicatorIdx = activeIdx === -1 ? 2 : activeIdx <= 1 ? activeIdx : activeIdx + 1;
          const slot = (tab: (typeof primaries)[number]) => {
            const active = activeTab === tab.key;
            return (
              <button
                type="button"
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative z-10 flex flex-col items-center gap-0.5 w-14 py-1 rounded-full transition-[color,transform] duration-200 active:scale-95 whitespace-nowrap ${
                  active ? 'text-white' : 'text-ink-400 hover:text-ink-700'
                }`}
                aria-pressed={active}
                aria-label={tab.label}
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="text-[9px] font-medium leading-none">
                  {tab.short ?? tab.label}
                </span>
              </button>
            );
          };
          return (
            <div
              className={`dock-rise relative flex items-center gap-1 bg-white/95 backdrop-blur rounded-full shadow-xl border border-parchment-200 px-2 py-1.5 ${
                hubCombat?.isMyTurn ? 'combat-turn-glow' : ''
              }`}
            >
              {/* Sliding active indicator — 8px padding + 60px per block */}
              <span
                className="dock-indicator absolute top-1 bottom-1 left-2 w-14 rounded-full bg-blood-600 shadow-sm"
                style={{ transform: `translateX(${indicatorIdx * 60}px)` }}
                aria-hidden="true"
              />
              {left.map(slot)}
              {/* Center: expandable button — doubles as the combat indicator */}
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                className={`hub-button relative z-10 mx-1 -my-3 w-12 h-12 shrink-0 rounded-full shadow-lg flex items-center justify-center text-xl leading-none active:scale-90 border-4 border-parchment-50 ${
                  moreOpen
                    ? 'bg-ink-900 rotate-90 text-white'
                    : hubCombat?.isMyTurn
                      ? 'bg-blood-700 text-white'
                      : hubCombat?.needsInitiative
                        ? 'bg-yellow-500 text-ink-900 shadow-[0_0_0_3px_rgba(202,138,4,0.5),0_0_18px_rgba(202,138,4,0.5)]'
                        : hubCombat
                          ? 'bg-blood-600 text-white shadow-[0_0_0_2px_rgba(185,28,28,0.3),0_0_12px_rgba(185,28,28,0.25)]'
                          : 'bg-blood-600 hover:bg-blood-700 text-white'
                }`}
                aria-expanded={moreOpen}
                aria-label={
                  hubCombat
                    ? 'Combat en cours'
                    : moreOpen
                      ? 'Fermer les autres onglets'
                      : 'Autres onglets'
                }
              >
                <span
                  key={moreOpen ? 'x' : hubCombat ? 'combat' : secondary ? secondary.key : 'menu'}
                  className="icon-swap"
                  aria-hidden="true"
                >
                  {moreOpen ? '✕' : hubCombat ? '⚔' : secondary ? secondary.icon : '☰'}
                </span>
              </button>
              {right.map(slot)}
              {/* Sword-cut sweeps the full dock bar on the your-turn edge */}
              <TurnSlash active={turnSlash && !moreOpen} />
            </div>
          );
        })()}
      </div>

      {/* Expanding dial: scrim + secondary tab stack above the center button,
          with the same sliding indicator (vertical) behind the active tab */}
      {moreOpen && (
        <>
          <div
            className="scrim-fade lg:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          {(() => {
            const secondaryTabs = CHARACTER_TABS.filter((t) => !dockPrimaryList.includes(t.key));
            const activeIdx = secondaryTabs.findIndex((t) => t.key === activeTab);
            // Compact 2-column grid anchored just above the dock — stays in
            // thumb reach. Cells are w-36 (144px) + 8px gaps; the 5th item
            // spans both columns. No highlight when a dock tab is active.
            const indPos = (idx: number) => {
              const row = Math.floor(idx / 2);
              const span = idx === 4; // 5th item is full-width
              return {
                x: span ? 0 : (idx % 2) * 152,
                y: row * 48,
                w: span ? 296 : 144,
              };
            };
            const p = activeIdx >= 0 ? indPos(activeIdx) : null;
            return (
              <div className="lg:hidden fixed z-50 bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
                <div className="w-[296px] grid grid-cols-2 gap-2">
                  {p && (
                    <span
                      className="dock-indicator absolute top-0 left-0 h-10 rounded-full bg-blood-600 shadow-sm"
                      style={{ width: p.w, transform: `translate(${p.x}px, ${p.y}px)` }}
                      aria-hidden="true"
                    />
                  )}
                  {secondaryTabs.map((tab, i) => {
                    const active = activeTab === tab.key;
                    const span = i === 4;
                    return (
                      <button
                        type="button"
                        key={tab.key}
                        onClick={() => {
                          setActiveTab(tab.key);
                          setMoreOpen(false);
                        }}
                        className={`dial-item relative z-10 ${span ? 'col-span-2 w-full' : 'w-36'} h-10 flex items-center justify-center gap-2 rounded-full border shadow-lg text-sm font-medium whitespace-nowrap transition-[color,border-color,background-color] duration-200 active:scale-95 ${
                          active
                            ? 'bg-transparent text-white border-blood-700'
                            : 'bg-white text-ink-700 border-parchment-200 hover:border-blood-400'
                        }`}
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <span className="text-lg leading-none" aria-hidden="true">
                          {tab.icon}
                        </span>
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ---------- Tab panels — keyed by the active tab, each switch rises into place ---------- */}
      <div key={activeTab} className="sheet-tab-swap space-y-4">
        {/* ---------- Non-inventory tabs (rendered when selected) ---------- */}
        {activeTab === 'survival' && (
          <SurvivalPanel
            character={character}
            charId={Number(charId)}
            entries={data.entries}
            canEdit={canEdit}
            markLocalMutation={markLocalMutation}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
            onNotice={(msg) => pushToast(msg)}
            onConcentrationCheck={setConcCheck}
          />
        )}
        {activeTab === 'stats' && (
          <CharacterStatsTab
            character={character}
            charId={Number(charId)}
            entries={entries}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
          />
        )}
        {activeTab === 'skills' && (
          <CharacterSkillsTab
            character={character}
            charId={Number(charId)}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
          />
        )}
        {activeTab === 'spells' && (
          <CharacterSpellsTab
            character={character}
            charId={Number(charId)}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
          />
        )}
        {activeTab === 'features' && (
          <CharacterFeaturesTab
            character={character}
            charId={Number(charId)}
            partyId={partyId}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
          />
        )}
        {activeTab === 'description' && (
          <CharacterDescriptionTab
            character={character}
            charId={Number(charId)}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
          />
        )}
        {activeTab === 'npcs' && <NpcPage embedded />}
        {activeTab === 'notes' && (
          <CharacterNotesTab
            character={character}
            charId={Number(charId)}
            partyId={partyId}
            onSaved={refreshInventory}
            onError={(msg) => pushToast(msg, 'error')}
          />
        )}

        {/* ---------- Inventory tab content ---------- */}
        {activeTab === 'inventory' && (
          <>
            {/* ---------- Storage location tabs ---------- */}
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                {locations.map((loc) => {
                  const isActive = loc.id === activeLocationResolvedId;
                  const lw = locationWeights.find((w) => w.locationId === loc.id);
                  const pct = lw ? Math.round(lw.pct) : 0;
                  const isConfirming = confirmDeleteLocationId === loc.id;
                  return (
                    <div key={loc.id} className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveLocationId(loc.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-blood-600 text-white'
                            : 'bg-parchment-200 text-ink-700 hover:bg-parchment-300'
                        }`}
                        aria-pressed={isActive}
                      >
                        <span aria-hidden="true">{LOCATION_TYPE_ICON[loc.type]}</span>
                        <span>{loc.name}</span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            isActive ? 'bg-white/25' : 'bg-parchment-100 text-ink-500'
                          }`}
                        >
                          {pct}%
                        </span>
                      </button>
                      {/* Delete button for non-carried locations */}
                      {loc.type !== 'carried' && isActive && canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isConfirming) {
                              deleteLocation(loc);
                            } else {
                              setConfirmDeleteLocationId(loc.id);
                              setTimeout(() => setConfirmDeleteLocationId(null), 4000);
                            }
                          }}
                          onBlur={() => setConfirmDeleteLocationId(null)}
                          className={`ml-1 w-7 h-7 rounded-full flex items-center justify-center text-sm transition-colors ${
                            isConfirming
                              ? 'bg-red-600 text-white hover:bg-red-700'
                              : 'bg-parchment-200 text-ink-500 hover:bg-red-100 hover:text-red-600'
                          }`}
                          aria-label={
                            isConfirming
                              ? `Confirmer la suppression de ${loc.name}`
                              : `Supprimer ${loc.name}`
                          }
                          title={isConfirming ? 'Confirmer ?' : 'Supprimer ce transport'}
                        >
                          {isConfirming ? '✓' : '🗑'}
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Add new transport */}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowNewLocationModal(true)}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-parchment-300 text-ink-500 hover:border-blood-400 hover:text-blood-600 transition-colors"
                    aria-label={t('inv.ajouter.un.transport')}
                    title={t('inv.ajouter.un.transport')}
                  >
                    <span aria-hidden="true">+</span> Transport
                  </button>
                )}
              </div>

              {/* Per-location weight bar (non-carried only — carried uses the header bar) */}
              {!isActiveCarried &&
                activeLocationWeight &&
                activeLocationWeight.maxCapacityKg !== null && (
                  <LocationWeightBar weight={activeLocationWeight} />
                )}
            </div>

            {/* Error toast (non-blocking) */}
            {error && error !== dismissedError && (
              <div className="flex items-start justify-between gap-3">
                <ErrorMsg message={error} />
                <button
                  type="button"
                  onClick={dismissError}
                  className="btn-ghost text-ink-500 text-sm shrink-0"
                  aria-label={t('inv.fermer.l.erreur')}
                >
                  ✕
                </button>
              </div>
            )}

            {/* First-run tour hint */}
            {showTour && data.entries.length === 0 && (
              <div className="card p-4 border-blood-200 bg-blood-50/50">
                <div className="flex items-start gap-3">
                  <span className="text-2xl shrink-0" aria-hidden="true">
                    🎲
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-ink-900">Bienvenue !</p>
                    <p className="text-sm text-ink-700 mt-1">
                      {t('inv.appuie.sur.le.bouton')}
                      <strong>{t('inv.ajouter')}</strong>
                      {t('inv.en.bas.de.l.ecran.pour')}
                    </p>
                    <button
                      type="button"
                      onClick={dismissTour}
                      className="btn-primary text-sm mt-2 px-3 py-1.5"
                    >
                      Compris
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Two-column layout: backpack (3fr) + catalog (2fr) on desktop */}
            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              {/* ---------- LEFT: inventory grouped by category ---------- */}
              <section className="space-y-3">
                <h2 className="section-title">
                  {activeLocation ? activeLocation.name : 'Sac à dos'}{' '}
                  <span className="text-ink-400 text-sm font-normal">({entries.length})</span>
                </h2>

                {entries.length === 0 ? (
                  <div className="card p-4">
                    <EmptyState
                      icon={
                        isActiveCarried
                          ? '🎒'
                          : LOCATION_TYPE_ICON[activeLocation?.type ?? 'carried']
                      }
                      title={isActiveCarried ? 'Sac à dos vide' : 'Aucun objet ici'}
                      hint="Appuie sur + Ajouter pour chercher un objet."
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {grouped.map((group) => (
                      <CategoryGroup
                        key={group.category}
                        category={group.category}
                        entries={group.entries}
                        character={character}
                        busyEntryIds={busyEntryIds}
                        expandedId={expandedId}
                        flashEntryId={flashEntryId}
                        confirmDeleteId={confirmDeleteId}
                        locations={locations}
                        activeLocationId={activeLocationResolvedId}
                        canEdit={canEdit}
                        onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                        onStep={stepQuantity}
                        onSetQuantity={setQuantity}
                        onToggleEquipped={toggleEquipped}
                        onConfirmDelete={confirmDelete}
                        onCancelDelete={cancelDelete}
                        onTransfer={(entry) => setTransferEntry(entry)}
                        onMoveLocation={moveEntryToLocation}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* ---------- RIGHT: catalog (desktop only — mobile uses FAB + bottom sheet) ---------- */}
              <section className="hidden lg:block space-y-3">
                <h2 className="section-title">Catalogue</h2>
                {catalogContent}
              </section>
            </div>

            {/* ---------- Coin purse (auto-save on blur) ---------- */}
            <section className="card p-4 sm:p-5">
              <CoinPurse
                coins={coins}
                readOnly={!canEdit}
                onChange={(key, val) => {
                  setCoins((c) => ({ ...c, [key]: Math.max(0, val) }));
                  setCoinsDirty(true);
                }}
                onBlur={saveCoins}
              />
            </section>
          </>
        )}
      </div>

      {/* ---------- Mobile FAB: open catalog as bottom sheet (inventory tab only) ---------- */}
      {activeTab === 'inventory' && canEdit && (
        <Fab
          onClick={() => setCatalogOpen(true)}
          label="Ajouter un objet au catalogue"
          mobileOnly
          raised
        />
      )}

      {/* ---------- Mobile catalog bottom sheet ---------- */}
      <BottomSheet open={catalogOpen} onClose={() => setCatalogOpen(false)} title="Catalogue">
        {catalogContent}
      </BottomSheet>

      {/* ---------- Transfer modal ---------- */}
      <TransferModal
        open={transferEntry !== null}
        entry={transferEntry}
        charId={Number(charId)}
        partyId={partyId}
        onClose={() => setTransferEntry(null)}
        onTransferred={async (itemName: string) => {
          setTransferEntry(null);
          await refreshInventory();
          pushToast(`${itemName} transféré`);
        }}
        onError={(msg) => pushToast(msg, 'error')}
      />

      {/* ---------- New transport modal ---------- */}
      <NewLocationModal
        open={showNewLocationModal}
        onClose={() => setShowNewLocationModal(false)}
        onCreate={createLocation}
      />

      {/* ---------- Custom item creation modal (players too, party setting) ---------- */}
      <Modal
        open={createItemOpen}
        onClose={() => setCreateItemOpen(false)}
        title={t('inv.creer.un.objet')}
      >
        <form onSubmit={submitCreateItem} className="space-y-3">
          <label className="block">
            <span className="label">Nom *</span>
            <input
              className="input"
              value={createItemName}
              onChange={(e) => setCreateItemName(e.target.value)}
              maxLength={60}
              autoFocus
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('inv.categorie')}</span>
              <select
                className="input"
                value={createItemCategory}
                onChange={(e) => setCreateItemCategory(e.target.value)}
              >
                <option value="custom">{t('inv.personnalise')}</option>
                <option value="weapon">Arme</option>
                <option value="armor">Armure</option>
                <option value="gear">{t('inv.equipement')}</option>
                <option value="magic">{t('inv.objet.magique')}</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Poids (kg)</span>
              <input
                type="number"
                step="0.01"
                min={0}
                className="input"
                value={createItemWeight}
                onChange={(e) => setCreateItemWeight(e.target.value)}
                placeholder="—"
              />
            </label>
          </div>
          <label className="block">
            <span className="label">Description</span>
            <textarea
              className="input"
              rows={3}
              value={createItemDesc}
              onChange={(e) => setCreateItemDesc(e.target.value)}
              placeholder={t('inv.a.quoi.ca.sert')}
            />
          </label>
          {/* L'illustration est le second contenu de l'objet — après la
            description, avant le submit (plan objets-illustrations §5.1). */}
          <ItemImageField value={createItemImage} onChange={setCreateItemImage} />
          <button
            type="submit"
            disabled={creatingItem || !createItemName.trim()}
            className="btn-primary w-full"
          >
            {creatingItem ? '…' : '✨ Créer et ajouter'}
          </button>
          <p className="text-xs text-ink-400">{t('inv.l.objet.rejoint.le.catalogue.du')}</p>
        </form>
      </Modal>

      {/* ---------- Toast stack ---------- */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ---------- Category grouping ----------

interface CategoryGroupData {
  category: ItemCategory;
  entries: InventoryEntry[];
}

function groupByCategory(entries: InventoryEntry[]): CategoryGroupData[] {
  const map = new Map<ItemCategory, InventoryEntry[]>();
  for (const e of entries) {
    const cat = e.item.category;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(e);
  }
  // Sort groups: equipped items float within their category
  const result: CategoryGroupData[] = [];
  for (const [category, items] of map) {
    items.sort((a, b) => {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      const na = (a.item.name || a.item.name).toLowerCase();
      const nb = (b.item.name || b.item.name).toLowerCase();
      return na.localeCompare(nb);
    });
    result.push({ category, entries: items });
  }
  // Sort categories in display order
  const order: ItemCategory[] = [
    'weapon',
    'armor',
    'ammunition',
    'gear',
    'tool',
    'mount',
    'magic',
    'custom',
  ];
  result.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return result;
}
