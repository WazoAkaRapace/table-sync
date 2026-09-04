import type { User } from '@table-sync/shared';
import { useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ---------- Types ----------

export interface SyncEvent {
  type:
    | 'inventory:change'
    | 'character:change'
    | 'party:change'
    | 'combat:change'
    | 'campaign:change'
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

// ---------- Heartbeat (sonde de vie applicative) ----------
// Le canal est unidirectionnel côté page (le client n'émet jamais après la
// poignée de main) : une coupure silencieuse — Wi-Fi tombé sans FIN, radio
// suspendue par l'OS, reprise d'une PWA iOS — laisse le socket « OPEN »
// pendant de longues minutes et la fiche cesse de suivre sans le dire. Le
// serveur annonce `heartbeat:true` dans son accusé 'connected' et répond
// {type:'pong'} aux {type:'ping'} (ping protocole en parallèle, invisible au
// JS). Sonde TOLÉRANTE au lien lent : seulement si le serveur la comprend,
// seulement quand le canal est calme, jamais en arrière-plan, et il faut 2
// manques consécutifs → fermeture forcée → le chemin de reconnexion (backoff
// + resync globale par invalidation) enchaîne tout seul.
const HEARTBEAT_CHECK_MS = 20_000; // cadence du contrôleur
const HEARTBEAT_IDLE_MS = 45_000; // silence requis avant de sonder
const HEARTBEAT_PONG_MS = 12_000; // fenêtre de réponse (latence haute)
const HEARTBEAT_MAX_MISSES = 2;

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
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const statusRef = useRef<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const handlersRef = useRef<Set<(event: SyncEvent) => void>>(new Set());

  // Heartbeat : dernière trame entrante vue par le JS (événements, 'pong',
  // 'connected' — les pings protocole du serveur sont invisibles à la page),
  // état de la sonde en vol, et drapeau « le serveur répond aux sondes ».
  const lastInboundAt = useRef(0);
  const heartbeatMisses = useRef(0);
  const pongDeadline = useRef<number | null>(null);
  const serverHeartbeat = useRef(false);

  // Debounce: coalesce rapid sync events into a bounded number of handler
  // dispatches. Events of the same kind (type + character + party) collapse
  // to the latest, but DIFFERENT kinds are all preserved — e.g. an HP edit
  // emits both character:change (sheet refresh) and combat:change (tracker
  // refresh), and dropping either would leave one view stale.
  const pendingEvents = useRef<SyncEvent[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateStatus = useCallback((next: ConnectionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

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

      updateStatus('connecting');
      // L'accusé 'connected' de CE socket dira si le serveur répond aux
      // sondes ; d'ici là, on ne sonde pas (vieux serveur = comportement d'avant).
      serverHeartbeat.current = false;
      pongDeadline.current = null;
      heartbeatMisses.current = 0;
      const url = buildWsUrl();
      // Auth via subprotocol header keeps the JWT out of URLs and proxy logs.
      const ws = new WebSocket(url, [token]);
      wsRef.current = ws;

      ws.onopen = () => {
        updateStatus('connected');
        reconnectDelay.current = 1000; // reset backoff
        lastInboundAt.current = Date.now();
      };

      ws.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          lastInboundAt.current = Date.now();
          // Réponse de la sonde : le lien est vivant dans les deux sens.
          if (parsed?.type === 'pong') {
            heartbeatMisses.current = 0;
            pongDeadline.current = null;
            return;
          }
          // L'accusé de connexion annonce si le serveur répondra aux sondes.
          if (parsed?.type === 'connected') {
            serverHeartbeat.current = parsed.heartbeat === true;
          }
          const event = parsed as SyncEvent;
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
        updateStatus('disconnected');
        wsRef.current = null;
        // Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 10s max)
        // + JITTER (×0,5–1,5) : après un restart serveur, toute la table ne
        // doit pas frapper la poignée de main WS dans la même seconde.
        if (reconnectDelay.current < 10000) {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 10000);
        }
        reconnectTimeout.current = setTimeout(
          () => {
            const savedToken = localStorage.getItem('dnd-inv-token');
            if (savedToken) connect(savedToken);
          },
          reconnectDelay.current * (0.5 + Math.random()),
        );
      };

      ws.onerror = () => {
        // onclose will handle reconnect
      };
    },
    [dispatchToHandlers, updateStatus],
  );

  // ---------- Heartbeat : sonde + fermeture forcée ----------
  // Lien mort détecté : on détache les handlers AVANT close() — sur un chemin
  // réellement mort, la poignée de main de fermeture n'est jamais acquittée
  // et le navigateur ne rend la main qu'à son propre timeout. On déclenche
  // donc nous-mêmes la reconnexion (same shape que le onclose naturel) ;
  // backoff remis à la base : c'est un échec DÉTECTÉ, pas subi.
  const forceHeartbeatClose = useCallback(() => {
    heartbeatMisses.current = 0;
    pongDeadline.current = null;
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* déjà morte */
      }
      wsRef.current = null;
    }
    updateStatus('disconnected');
    reconnectDelay.current = 1000;
    reconnectTimeout.current = setTimeout(
      () => {
        const savedToken = localStorage.getItem('dnd-inv-token');
        if (savedToken) connect(savedToken);
      },
      1000 * (0.5 + Math.random()),
    );
  }, [connect, updateStatus]);

  const sendProbe = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
      pongDeadline.current = Date.now() + HEARTBEAT_PONG_MS;
    } catch {
      // Émettre sur un socket mourante throw : ça compte comme un manque
      // immédiat — sinon la boucle sonderait à l'infini sans jamais trancher.
      heartbeatMisses.current++;
      if (heartbeatMisses.current >= HEARTBEAT_MAX_MISSES) forceHeartbeatClose();
    }
  }, [forceHeartbeatClose]);

  // Contrôleur : cadencé, il ne sonde que serveur compatible + onglet
  // visible + canal calme (ou en rattrapage juste après un manqué — le
  // silence n'est pas rafraîchi sans pong, la porte reste ouverte).
  useEffect(() => {
    const id = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !serverHeartbeat.current) return;
      if (document.visibilityState !== 'visible') return; // l'arrière-plan ne sonde pas
      const now = Date.now();
      if (pongDeadline.current !== null) {
        if (now < pongDeadline.current) return; // une sonde est en vol
        pongDeadline.current = null; // manquée
        heartbeatMisses.current++;
        if (heartbeatMisses.current >= HEARTBEAT_MAX_MISSES) {
          forceHeartbeatClose();
          return;
        }
      }
      if (now - lastInboundAt.current >= HEARTBEAT_IDLE_MS) sendProbe();
    }, HEARTBEAT_CHECK_MS);
    return () => clearInterval(id);
  }, [sendProbe, forceHeartbeatClose]);

  // Resynchronisation à la (re)connexion : les événements WS tombés pendant
  // le trou sont perdus (pas de replay par design) — les requêtes ACTIVES se
  // réactualisent, chaque surface rattrape l'état manqué. CombatWidget le
  // faisait seul ; la fiche, le tracker et les messages en bénéficient aussi.
  const prevStatus = useRef<ConnectionStatus>('disconnected');
  useEffect(() => {
    if (prevStatus.current !== 'connected' && status === 'connected') {
      queryClient.invalidateQueries();
    }
    prevStatus.current = status;
  }, [status, queryClient]);

  // Reprise de premier plan : si le socket est tombé pendant l'arrière-plan
  // (l'OS coupe souvent les timers/sockets), on NE SUBIT PAS le backoff en
  // cours — reconnexion immédiate. La resync ci-dessus rattrape les manqués.
  // Socket encore « connecté » mais muet depuis la sieste : sonde immédiate
  // (reprise iOS/PWA — le demi-ouvert se démasque en une fenêtre de pong au
  // lieu d'attendre le contrôleur au ralenti).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (statusRef.current !== 'connected') {
        if (reconnectTimeout.current) {
          clearTimeout(reconnectTimeout.current);
          reconnectTimeout.current = null;
        }
        reconnectDelay.current = 1000;
        const savedToken = localStorage.getItem('dnd-inv-token');
        if (savedToken && user) connect(savedToken);
      } else if (
        serverHeartbeat.current &&
        wsRef.current?.readyState === WebSocket.OPEN &&
        Date.now() - lastInboundAt.current > HEARTBEAT_IDLE_MS
      ) {
        sendProbe();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connect, user, sendProbe]);

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
      updateStatus('disconnected');
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
  }, [user, connect, updateStatus]);

  const subscribe = useCallback((handler: (event: SyncEvent) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // markLocalMutation is kept for backward compatibility but is now a no-op.
  // Echo suppression is handled server-side (ws.ts skips the actor).
  const markLocalMutation = useCallback(() => {}, []);

  // Valeur mémoïsée : un objet inline recréait l'identité à chaque render du
  // provider — chaque flap de connexion re-renderait TOUS les consommateurs
  // (SyncopeIndicator, CombatWidget, fiche, tracker…).
  const contextValue = useMemo(
    () => ({ status, subscribe, markLocalMutation }),
    [status, subscribe, markLocalMutation],
  );

  return <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>;
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
