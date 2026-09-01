import type { User } from '@table-sync/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------- Types ----------

export interface SyncEvent {
  type:
    | 'inventory:change'
    | 'character:change'
    | 'party:change'
    | 'combat:change'
    | 'gma:change'
    | 'message:new';
  partyId: number;
  characterId?: number;
  toCharacterId?: number;
  action?: string;
  itemName?: string;
  actorUserId?: number;
  /** message:new — user-targeted delivery (the recipient); never a party fan-out. */
  targetUserId?: number;
  /** message:new — did the sender write as the GM? Picks the banner's target page. */
  messageFromGM?: boolean;
  /** message:new — display names, so the receiving banner renders without a fetch. */
  messageCharacterName?: string;
  messageSenderName?: string;
  /** Concentration save required — only relevant to the character's owner. */
  concentration?: {
    characterId: number;
    characterName: string;
    damage: number;
    dc: number;
    ownerId?: number;
  };
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface SyncState {
  status: ConnectionStatus;
  /** Register a handler for sync events. Returns an unsubscribe function. */
  subscribe: (handler: (event: SyncEvent) => void) => () => void;
  /** Track local mutations for same-tab dedup. Call right before/after a mutation. */
  markLocalMutation: () => void;
}

const SyncContext = createContext<SyncState>(null!);

// ---------- Helpers ----------

function buildWsUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL || '';
  if (apiBase) {
    // Explicit API URL (e.g. Docker or production)
    const httpUrl = apiBase.replace(/^http/, 'ws');
    return `${httpUrl}/ws`;
  }
  // Dev: same origin (Vite proxy handles /ws)
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

// ---------- Provider ----------

export function SyncProvider({ user, children }: { user: User | null; children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const handlersRef = useRef<Set<(event: SyncEvent) => void>>(new Set());

  // Debounce: coalesce rapid sync events into a bounded number of handler
  // dispatches. Events of the same kind (type + character + party) collapse
  // to the latest, but DIFFERENT kinds are all preserved — e.g. an HP edit
  // emits both character:change (sheet refresh) and combat:change (tracker
  // refresh), and dropping either would leave one view stale.
  const pendingEvents = useRef<SyncEvent[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatchToHandlers = useCallback((event: SyncEvent) => {
    for (const handler of handlersRef.current) {
      try {
        handler(event);
      } catch {}
    }
  }, []);

  const connect = useCallback(
    (token: string) => {
      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect trigger
        wsRef.current.close();
        wsRef.current = null;
      }

      setStatus('connecting');
      const url = buildWsUrl();
      // Auth via subprotocol header keeps the JWT out of URLs and proxy logs.
      const ws = new WebSocket(url, [token]);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        reconnectDelay.current = 1000; // reset backoff
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as SyncEvent;
          // Concentration alerts are one-shot and must not be coalesced away
          // by the debounce below (a follow-up character:change would replace
          // them before the timer fires).
          if (event.concentration) {
            dispatchToHandlers(event);
            return;
          }
          // Collapse same-kind events; keep different kinds side by side
          const last = pendingEvents.current[pendingEvents.current.length - 1];
          const sameKind =
            last &&
            last.type === event.type &&
            last.characterId === event.characterId &&
            last.toCharacterId === event.toCharacterId &&
            last.partyId === event.partyId;
          if (sameKind) {
            pendingEvents.current[pendingEvents.current.length - 1] = event;
          } else {
            pendingEvents.current.push(event);
          }
          if (debounceTimer.current) return; // already scheduled, will pick up latest
          debounceTimer.current = setTimeout(() => {
            debounceTimer.current = null;
            const events = pendingEvents.current;
            pendingEvents.current = [];
            for (const ev of events) dispatchToHandlers(ev);
          }, 300);
        } catch {}
      };

      ws.onclose = () => {
        setStatus('disconnected');
        wsRef.current = null;
        // Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 10s max)
        if (reconnectDelay.current < 10000) {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 10000);
        }
        reconnectTimeout.current = setTimeout(() => {
          const savedToken = localStorage.getItem('dnd-inv-token');
          if (savedToken) connect(savedToken);
        }, reconnectDelay.current);
      };

      ws.onerror = () => {
        // onclose will handle reconnect
      };
    },
    [dispatchToHandlers],
  );

  // Connect on login, disconnect on logout
  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('dnd-inv-token');
      if (token) connect(token);
    } else {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus('disconnected');
    }

    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user, connect]);

  const subscribe = useCallback((handler: (event: SyncEvent) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // markLocalMutation is kept for backward compatibility but is now a no-op.
  // Echo suppression is handled server-side (ws.ts skips the actor).
  const markLocalMutation = useCallback(() => {}, []);

  return (
    <SyncContext.Provider value={{ status, subscribe, markLocalMutation }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}

/** Convenience hook: subscribe to sync events filtered by partyId/characterId. */
export function useSyncEvent(handler: (event: SyncEvent) => void, deps: React.DependencyList = []) {
  const { subscribe } = useSync();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe((event) => handlerRef.current(event));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, ...deps]);
}
