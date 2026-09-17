import type {
  CreateNpcPayload,
  GmaEntitiesResponse,
  GmaEntity,
  GmaEntitySessionRef,
  Npc,
  NpcDisposition,
  NpcStatus,
  PatchNpcPayload,
} from '@table-sync/shared';
import { NPC_DISPOSITION_LABELS_FR, NPC_STATUS_LABELS_FR } from '@table-sync/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import {
  ConfirmButton,
  EmptyState,
  ErrorMsg,
  Modal,
  SkeletonCard,
  SkeletonRegion,
} from '../components/ui';
import { appLocale } from '../i18n';
import { useResyncOnReconnect, useSyncEvent } from '../sync';
import { usePartyRole } from '../usePartyRole';
import { parseSqliteDate, toRoman } from '../utils';

// ---------- Status / disposition styling ----------

const STATUS_DOT_CLASS: Record<NpcStatus, string> = {
  alive: 'bg-green-500',
  dead: 'bg-red-500',
  missing: 'bg-yellow-500',
  turned: 'bg-purple-500',
};

const STATUS_TEXT_CLASS: Record<NpcStatus, string> = {
  alive: 'text-green-700',
  dead: 'text-red-700',
  missing: 'text-yellow-700',
  turned: 'text-purple-700',
};

// Les maps partagées restent la source des CLÉS (ordre + exhaustivité) ;
// le libellé affiché passe par i18next — FR = copies verbatim des maps.
const DISPOSITION_OPTIONS: { value: NpcDisposition; labelKey: string }[] = (
  Object.keys(NPC_DISPOSITION_LABELS_FR) as NpcDisposition[]
).map((d) => ({ value: d, labelKey: `pnj.disposition.${d}` }));

const STATUS_OPTIONS: { value: NpcStatus; labelKey: string }[] = (
  Object.keys(NPC_STATUS_LABELS_FR) as NpcStatus[]
).map((s) => ({ value: s, labelKey: `pnj.status.${s}` }));

type ViewFilter = 'all' | 'shared' | 'mine';

// Sentinel for the un-factioned group: a stable map key independent of the
// display language ("Sans faction" / "No faction").
const NO_FACTION = '__no_faction__';

/** Name matching for the link suggestion: accents & case aside, same name. */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sessions across ALL entities réconciliées on one NPC — deduped (the same
    séance may report several sightings) and in chronicle order. */
function mergeGmaSessions(entities: GmaEntity[]): GmaEntitySessionRef[] {
  const seen = new Set<string>();
  const out: GmaEntitySessionRef[] = [];
  for (const e of entities) {
    for (const s of e.sessions) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
  }
  return out.sort((a, b) => a.ordinal - b.ordinal);
}

function gmaDateLabel(value: string | null): string | null {
  if (!value) return null;
  const d = parseSqliteDate(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Failure copy for the GMA link/import actions, attributed honestly: when our
 * API answered, it carries the real cause (including its own GM Assistant
 * translations — those upstream errors DO mention GM Assistant); the fallbacks
 * are OUR side (network to Table Sync, or an API error without a message) and
 * must not blame GM Assistant for them.
 */
function gmaActionErrorMessage(err: any, t: (key: string) => string): string {
  const msg = err?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (!err?.response) return t('pnj.gma.erreur.reseau');
  return t('pnj.gma.erreur.serveur');
}

// ---------- Main component ----------

export default function NpcPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { partyId } = useParams<{ partyId: string }>();
  const { user } = useAuth();

  const [npcs, setNpcs] = useState<Npc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState<'' | NpcDisposition>('');
  const [statusFilter, setStatusFilter] = useState<'' | NpcStatus>('');
  const [view, setView] = useState<ViewFilter>('all');

  // Modal state
  const [editing, setEditing] = useState<Npc | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<Npc | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [detailNpc, setDetailNpc] = useState<Npc | null>(null);

  // GM Assistant (« PNJ repérés ») state
  const [gmaRes, setGmaRes] = useState<GmaEntitiesResponse | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [sheetEntity, setSheetEntity] = useState<GmaEntity | null>(null);
  const [linkingEntity, setLinkingEntity] = useState<GmaEntity | null>(null);
  const [linkTarget, setLinkTarget] = useState<Npc | null>(null);
  const [picking, setPicking] = useState<GmaEntity | null>(null);
  const [originEntity, setOriginEntity] = useState<GmaEntity | null>(null);
  const [busyEntityId, setBusyEntityId] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);

  const flash = useCallback((kind: 'success' | 'error', msg: string) => {
    setFeedback({ kind, msg });
    setTimeout(() => setFeedback(null), 2500);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!partyId) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        // Rôle du MD par la SONDE LÉGÈRE (usePartyRole → /parties/:id/me) :
        // l'ancien `GET /parties/:id` téléchargeait le roster ENTIER (~150 Ko
        // compressés) pour en tirer un booléen isGM — sur chaque montage et
        // chaque party:change/gma:change, page embarquée dans CHAQUE fiche.
        const [npcRes, gmaLinkRes] = await Promise.all([
          api.get<{ npcs: Npc[] }>(`/api/parties/${partyId}/npcs`),
          // 200 for any member (linked or not) — never an error-rate-limit hit
          api.get(`/api/parties/${partyId}/gma/link`).catch(() => null),
        ]);
        setNpcs(npcRes.data.npcs);
        if (gmaLinkRes?.data?.linked) {
          try {
            const ent = await api.get<GmaEntitiesResponse>(`/api/parties/${partyId}/gma/entities`);
            setGmaRes(ent.data);
          } catch {
            setGmaRes(null); // rail absent — never blocks the registry
          }
        } else {
          setGmaRes(null);
        }
      } catch (err: any) {
        setError(err.response?.data?.error || t('pnj.impossible.de.charger.les.pnj'));
      } finally {
        setLoading(false);
      }
    },
    [partyId, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Real-time sync — CHIRURGICAL : le registre ne se réveille que pour SES
  // écritures (action 'npcs' — distincte de 'custom-item' depuis le
  // vocabulaire v2) et le rail GM Assistant (gma:change). Avant, TOUT
  // party:change rechargeait la page : chaque création d'objet custom du
  // groupe re-téléchargeait le registre PNJ entier — page embarquée dans la
  // fiche de chaque joueur. (Vieux clients PWA : le serveur garde le type
  // party:change, eux écoutent large — comportement d'avant.)
  const currentPartyId = Number(partyId);
  // Rattrapage de reconnexion : page à état local — les événements du trou ne
  // seront jamais rejoués, rechargement silencieux du registre + du rail.
  useResyncOnReconnect(() => void load(true));
  useSyncEvent(
    (event) => {
      if (event.partyId !== currentPartyId) return;
      if (
        event.type === 'gma:change' ||
        (event.type === 'party:change' && event.action === 'npcs')
      ) {
        load(true); // silent — no spinner flash on sync updates
      }
    },
    [currentPartyId],
  );

  // Rôle MD : la sonde partagée ['party-role'] (une seule forme de cache pour
  // la fiche, la boîte MD et cette page).
  const roleQuery = usePartyRole(partyId ? Number(partyId) : null);
  const isGM = roleQuery.data?.isGM ?? false;

  // ---------- GM Assistant (« PNJ repérés ») ----------

  /** Unlinked, non-discarded entities = what the rail offers. */
  const railEntities = useMemo(
    () => (gmaRes?.entities ?? []).filter((e) => !e.linkedNpc && !e.discarded),
    [gmaRes],
  );

  /** Discarded entities — the « plus jamais ça » list, restorable. */
  const discardedEntities = useMemo(
    () => (gmaRes?.entities ?? []).filter((e) => e.discarded && !e.linkedNpc),
    [gmaRes],
  );

  /** npcId → linked entities, oldest link first — réconciliation : un PNJ
      peut porter une entrée GMA par séance, toutes nourrissent la même fiche. */
  const gmaByNpcId = useMemo(() => {
    const map = new Map<number, GmaEntity[]>();
    for (const e of gmaRes?.entities ?? []) {
      if (!e.linkedNpc) continue;
      const list = map.get(e.linkedNpc.id) ?? [];
      list.push(e);
      map.set(e.linkedNpc.id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.linkedNpc!.linkedAt.localeCompare(b.linkedNpc!.linkedAt));
    }
    return map;
  }, [gmaRes]);

  const canEditNpc = useCallback(
    (npc: Npc) => isGM || npc.createdBy === user?.id || (npc.isShared && npc.allowMemberEdit),
    [isGM, user?.id],
  );

  /** The local NPC behind the open origin modal (if still in the registry). */
  const originNpc = useMemo(
    () =>
      originEntity?.linkedNpc
        ? (npcs.find((n) => n.id === originEntity.linkedNpc!.id) ?? null)
        : null,
    [originEntity, npcs],
  );

  /** Other entities réconciliées on the same NPC — reachable from the modal. */
  const originSiblings = useMemo(() => {
    if (!originEntity?.linkedNpc) return [];
    return (gmaByNpcId.get(originEntity.linkedNpc.id) ?? []).filter(
      (e) => e.id !== originEntity.id,
    );
  }, [originEntity, gmaByNpcId]);

  /** Same-name suggestion: exactly one registry NPC matches the entity. An
      already-linked match stays suggested — picking it réconcilies (GMA
      re-catalogues the same person every session). */
  const suggestionFor = useCallback(
    (entity: GmaEntity): Npc | null => {
      const key = normalizeName(entity.name);
      if (!key) return null;
      const matches = npcs.filter((n) => normalizeName(n.name) === key);
      return matches.length === 1 ? matches[0] : null;
    },
    [npcs],
  );

  const busyOrIdle = busyEntityId === null;

  const importEntity = async (entity: GmaEntity): Promise<boolean> => {
    if (!partyId || !busyOrIdle) return false;
    setBusyEntityId(entity.id);
    try {
      await api.post(`/api/parties/${partyId}/gma/entities/${entity.id}/import`);
      flash('success', t('pnj.gma.ajoute.toast', { name: entity.name }));
      await load(true);
      return true;
    } catch (err: any) {
      flash('error', gmaActionErrorMessage(err, t));
      return false;
    } finally {
      setBusyEntityId(null);
    }
  };

  const linkEntity = async (entity: GmaEntity, npc: Npc, append: boolean) => {
    if (!partyId || !busyOrIdle) return;
    setBusyEntityId(entity.id);
    try {
      await api.post(`/api/parties/${partyId}/gma/entities/${entity.id}/link`, {
        npcId: npc.id,
        appendDescription: append,
      });
      flash(
        'success',
        append
          ? t('pnj.gma.lie.description.ajoutee.toast', { name: npc.name })
          : t('pnj.gma.lie.toast', { name: npc.name }),
      );
      setLinkingEntity(null);
      setLinkTarget(null);
      await load(true);
    } catch (err: any) {
      flash('error', gmaActionErrorMessage(err, t));
    } finally {
      setBusyEntityId(null);
    }
  };

  const pullEntity = async (entity: GmaEntity, append: boolean) => {
    if (!partyId || !entity.linkedNpc || !busyOrIdle) return;
    setBusyEntityId(entity.id);
    try {
      await api.post(`/api/parties/${partyId}/gma/entities/${entity.id}/pull`, {
        npcId: entity.linkedNpc.id,
        append,
      });
      flash(
        'success',
        append
          ? t('pnj.gma.description.ajoutee.toast', { name: entity.linkedNpc.name })
          : t('pnj.gma.description.reprise.toast', { name: entity.linkedNpc.name }),
      );
      await load(true);
      // Re-open the origin modal on the refreshed entity (load replaced gmaRes)
      setOriginEntity(null);
    } catch (err: any) {
      flash('error', gmaActionErrorMessage(err, t));
    } finally {
      setBusyEntityId(null);
    }
  };

  const unlinkEntity = async (entity: GmaEntity) => {
    if (!partyId || !entity.linkedNpc) return;
    setBusyEntityId(entity.id);
    try {
      await api.delete(`/api/parties/${partyId}/gma/entities/${entity.id}/link`);
      flash('success', t('pnj.gma.delie.toast', { name: entity.linkedNpc.name }));
      setOriginEntity(null);
      await load(true);
    } catch (err: any) {
      flash('error', gmaActionErrorMessage(err, t));
    } finally {
      setBusyEntityId(null);
    }
  };

  /** Écarter : GMA keep reporting it — hide it from the rail, party-wide. */
  const discardEntity = async (entity: GmaEntity) => {
    if (!partyId || !busyOrIdle) return;
    setBusyEntityId(entity.id);
    try {
      await api.post(`/api/parties/${partyId}/gma/entities/${entity.id}/discard`);
      flash('success', t('pnj.gma.ecarte.toast', { name: entity.name }));
      setSheetEntity(null);
      await load(true);
    } catch (err: any) {
      flash('error', gmaActionErrorMessage(err, t));
    } finally {
      setBusyEntityId(null);
    }
  };

  const restoreEntity = async (entity: GmaEntity) => {
    if (!partyId || !busyOrIdle) return;
    setBusyEntityId(entity.id);
    try {
      await api.delete(`/api/parties/${partyId}/gma/entities/${entity.id}/discard`);
      flash('success', t('pnj.gma.restaure.toast', { name: entity.name }));
      await load(true);
    } catch (err: any) {
      flash('error', gmaActionErrorMessage(err, t));
    } finally {
      setBusyEntityId(null);
    }
  };

  // ---------- Filtering & grouping ----------

  // Botte de foin de recherche PRÉCALCULÉE par PNJ : taper ne doit refaire que
  // le filtre, pas reconstruire une chaîne minuscule par PNJ et par frappe
  // (la description peut être longue).
  const haystackById = useMemo(() => {
    const map = new Map<number, string>();
    for (const n of npcs) {
      map.set(
        n.id,
        `${n.name} ${n.role ?? ''} ${n.location ?? ''} ${n.faction ?? ''} ${n.description ?? ''}`.toLowerCase(),
      );
    }
    return map;
  }, [npcs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return npcs
      .filter((n) => {
        if (view === 'shared' && !n.isShared) return false;
        if (view === 'mine' && n.createdBy !== user?.id) return false;
        if (dispositionFilter && n.disposition !== dispositionFilter) return false;
        if (statusFilter && n.status !== statusFilter) return false;
        if (q && !(haystackById.get(n.id) ?? '').includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [npcs, haystackById, search, dispositionFilter, statusFilter, view, user?.id]);

  // Group by faction (or the "Sans faction" bucket)
  const grouped = useMemo(() => {
    const map = new Map<string, Npc[]>();
    for (const n of filtered) {
      const key = n.faction?.trim() || NO_FACTION;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    // Sort factions alphabetically, "Sans faction" last
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === NO_FACTION) return 1;
      if (b === NO_FACTION) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  // ---------- Collapsible faction sections ----------
  // Per-party, persisted — scan the faction heads, open the one you want.
  // Any active search/filter overrides the collapse: a result must never
  // hide inside a folded section.

  const collapsedKey = `dnd-inv-npc-factions-collapsed:${partyId ?? ''}`;
  const [collapsedFactions, setCollapsedFactions] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(collapsedKey) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  // Route param change reuses the component instance — drop the previous
  // party's data (le squelette couvre l'échange : le registre d'un autre
  // groupe ne se rend jamais en décalé) puis reload the right set.
  useEffect(() => {
    if (!partyId) return;
    setNpcs([]);
    setGmaRes(null);
    try {
      setCollapsedFactions(
        new Set(
          JSON.parse(localStorage.getItem(`dnd-inv-npc-factions-collapsed:${partyId}`) ?? '[]'),
        ),
      );
    } catch {
      setCollapsedFactions(new Set());
    }
  }, [partyId]);

  const toggleFaction = (faction: string) => {
    setCollapsedFactions((prev) => {
      const next = new Set(prev);
      if (next.has(faction)) next.delete(faction);
      else next.add(faction);
      try {
        localStorage.setItem(collapsedKey, JSON.stringify([...next]));
      } catch {
        /* stockage indisponible — repli mémoire seule */
      }
      return next;
    });
  };

  const filtersActive = !!search.trim() || !!dispositionFilter || !!statusFilter || view !== 'all';

  // ---------- Mutations ----------

  const openCreate = () => {
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (npc: Npc) => {
    setEditing(npc);
    setShowModal(true);
  };

  const handleSaved = async () => {
    setShowModal(false);
    setEditing(null);
    await load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/api/npcs/${deleting.id}`);
      setDeleting(null);
      await load();
      flash('success', t('pnj.name.supprime', { name: deleting.name }));
    } catch (err: any) {
      flash('error', err.response?.data?.error || t('pnj.erreur.de.suppression'));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ---------- Render guards ----------

  // Squelette SEULEMENT au premier chargement (aucune donnée) : l'en-tête et
  // les filtres — état 100 % local — se posent immédiatement, les cartes
  // fantômes gardent la place du registre. Un rechargement (silencieux via
  // WS/reconnexion, ou après une écriture) ne fait jamais clignoter la page :
  // les données rendues restent en place.
  const initialLoading = loading && npcs.length === 0;
  // (chargement initial raté — non-membre, groupe inconnu : l'erreur porte le
  // message ; une revalidation silencieuse ratée garde les données rendues)
  if (error && npcs.length === 0) return <ErrorMsg message={error} />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2" data-tuto="pnj-liste">
        <div className="flex items-center gap-3">
          {!embedded && <span className="text-sm text-ink-400">{t('pnj.titre')}</span>}
        </div>
        <button type="button" onClick={openCreate} className="btn-primary text-sm">
          {t('pnj.ajouter.un.pnj')}
        </button>
      </div>

      {/* GM Assistant rail — « PNJ repérés » : absent when nothing to offer
          (the discarded management door keeps it alive when all are écartés) */}
      {(railEntities.length > 0 || discardedEntities.length > 0) && (
        <section className="card p-3" data-tuto="pnj-gma">
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            aria-expanded={railOpen}
            className="w-full min-h-11 flex items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span aria-hidden="true">📜</span>
              <span className="text-sm font-semibold text-ink-800 truncate">
                {t('pnj.gma.rail.titre')}
              </span>
              {railEntities.length > 0 && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-parchment-100 text-ink-600 text-xs font-medium tabular-nums">
                  {t('pnj.gma.rail.compte', { count: railEntities.length })}
                </span>
              )}
              {discardedEntities.length > 0 && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-parchment-100 text-ink-400 text-xs font-medium tabular-nums">
                  {t('pnj.gma.ecartes.compte', { count: discardedEntities.length })}
                </span>
              )}
              {gmaRes?.stale && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                  {t('chronique.possiblement.obsolete')}
                </span>
              )}
            </span>
            <span
              className={`text-ink-400 chevron ${railOpen ? 'is-open' : 'is-closed'}`}
              aria-hidden="true"
            >
              ▼
            </span>
          </button>
          <div className={`expand-grid ${railOpen ? '' : 'is-collapsed'}`}>
            <div className="expand-inner">
              <p className="pt-1 pb-2 text-xs text-ink-400">
                {t('pnj.gma.rail.sous.titre', { campaign: gmaRes?.campaignTitle ?? '' })}
              </p>
              <div>
                {railEntities.map((entity) => (
                  <div
                    key={entity.id}
                    className="py-2.5 border-t border-parchment-200 flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-900 truncate">{entity.name}</p>
                      {entity.description && (
                        <p className="mt-0.5 text-xs text-ink-500 line-clamp-2 whitespace-pre-line">
                          {entity.description}
                        </p>
                      )}
                      <GmaSessionOrdinals
                        sessions={entity.sessions}
                        partyId={partyId!}
                        className="mt-1 text-ink-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSheetEntity(entity)}
                      className="shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-lg border border-parchment-300 bg-parchment-50 text-ink-800 text-xl font-medium hover:bg-parchment-100"
                      aria-label={t('pnj.gma.actions.aria', { name: entity.name })}
                      title={t('pnj.gma.actions.aria', { name: entity.name })}
                    >
                      <span aria-hidden="true">＋</span>
                    </button>
                  </div>
                ))}
                {railEntities.length === 0 && discardedEntities.length > 0 && (
                  <p className="py-2.5 border-t border-parchment-200 text-xs text-ink-400">
                    {t('pnj.gma.tout.ecarte')}
                  </p>
                )}
                {discardedEntities.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDiscarded(true)}
                    className="mt-1 w-full min-h-11 text-left text-xs px-2 -mx-2 rounded-lg text-ink-500 hover:bg-parchment-100"
                  >
                    {t('pnj.gma.ecartes.voir', { count: discardedEntities.length })}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Filter bar */}
      <div className="card p-3 space-y-3">
        <input
          type="search"
          className="input"
          placeholder={t('pnj.rechercher.un.pnj')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('pnj.rechercher.un.pnj')}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select
            className="input min-h-11"
            value={dispositionFilter}
            onChange={(e) => setDispositionFilter(e.target.value as '' | NpcDisposition)}
            aria-label={t('pnj.filtrer.par.disposition')}
          >
            <option value="">{t('pnj.toutes.dispositions')}</option>
            {DISPOSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <select
            className="input min-h-11"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | NpcStatus)}
            aria-label={t('pnj.filtrer.par.statut')}
          >
            <option value="">{t('pnj.tous.statuts')}</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <select
            className="input min-h-11 col-span-2 sm:col-span-1"
            value={view}
            onChange={(e) => setView(e.target.value as ViewFilter)}
            aria-label={t('pnj.filtrer.par.visibilite')}
          >
            <option value="all">{t('pnj.tous')}</option>
            <option value="shared">{t('pnj.partages')}</option>
            <option value="mine">{t('pnj.les.miens')}</option>
          </select>
        </div>
      </div>

      {/* Inline feedback */}
      {feedback && (
        <div
          className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
            feedback.kind === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
          role="status"
        >
          {feedback.msg}
        </div>
      )}

      {/* NPC grid grouped by faction — ghost cards while the registry opens,
          then one register-rise for the whole grid (the container mounts once
          per skeleton→registre swap : taper dans les filtres ne rejoue jamais
          l'entrée, les sections restent montées) */}
      {initialLoading ? (
        <SkeletonRegion
          label={t('pnj.chargement.des.pnj')}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <SkeletonCard key={n} />
          ))}
        </SkeletonRegion>
      ) : filtered.length === 0 ? (
        <div className="card p-4">
          <EmptyState
            icon="🎭"
            title={npcs.length === 0 ? t('pnj.aucun') : t('pnj.aucun.resultat')}
            hint={
              npcs.length === 0 ? t('pnj.ajoutez.vos.rencontres') : t('pnj.modifiez.vos.filtres')
            }
          />
        </div>
      ) : (
        <div className="space-y-6 register-rise">
          {grouped.map(([faction, group]) => {
            const label = faction === NO_FACTION ? t('pnj.sans.faction') : faction;
            const isCollapsed = !filtersActive && collapsedFactions.has(faction);
            return (
              <section key={faction}>
                <h2 className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleFaction(faction)}
                    aria-expanded={!isCollapsed}
                    className="w-full min-h-11 flex items-center gap-2 text-left"
                  >
                    <span className="text-blood-600 shrink-0" aria-hidden="true">
                      ⚜
                    </span>
                    <span className="section-title truncate">{label}</span>
                    <span className="text-ink-400 text-sm font-normal tabular-nums shrink-0">
                      ({group.length})
                    </span>
                    <span
                      className={`text-ink-400 chevron ml-auto ${isCollapsed ? 'is-closed' : 'is-open'}`}
                      aria-hidden="true"
                    >
                      ▼
                    </span>
                  </button>
                </h2>
                <div className={`expand-grid ${isCollapsed ? 'is-collapsed' : ''}`}>
                  <div className="expand-inner">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pb-3">
                      {group.map((npc) => (
                        <NpcCard
                          key={npc.id}
                          npc={npc}
                          gma={gmaByNpcId.get(npc.id) ?? []}
                          partyId={partyId!}
                          canEdit={
                            isGM ||
                            npc.createdBy === user?.id ||
                            (npc.isShared && npc.allowMemberEdit)
                          }
                          canDelete={isGM || npc.createdBy === user?.id}
                          onEdit={() => openEdit(npc)}
                          onDelete={() => setDeleting(npc)}
                          onGma={() => {
                            const list = gmaByNpcId.get(npc.id) ?? [];
                            setOriginEntity(list[list.length - 1] ?? null);
                          }}
                          onDetail={() => setDetailNpc(npc)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Create / edit modal */}
      <NpcFormModal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditing(null);
        }}
        partyId={partyId!}
        npc={editing}
        isGM={isGM}
        // Les drapeaux de partage restent au créateur (et au MD)
        canManageSharing={isGM || editing === null || editing.createdBy === user?.id}
        onSaved={handleSaved}
        onError={(msg) => flash('error', msg)}
      />

      {/* Delete confirmation modal */}
      {deleting && (
        <Modal
          open={true}
          onClose={() => !deleteBusy && setDeleting(null)}
          title={t('pnj.supprimer.deleting.name', { deleting_name: deleting.name })}
        >
          <p className="text-sm text-ink-500 mb-4">
            {t('pnj.cette.action.est.irreversible.le.pnj')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
              className="btn-secondary flex-1"
            >
              {t('pnj.annuler')}
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleteBusy}
              className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
            >
              {deleteBusy ? t('pnj.suppression') : t('common.delete')}
            </button>
          </div>
        </Modal>
      )}

      {/* GM Assistant — entity actions (bottom card on mobile, from the ＋ row) */}
      {sheetEntity && (
        <GmaEntitySheetModal
          entity={sheetEntity}
          suggestion={suggestionFor(sheetEntity)}
          partyId={partyId!}
          busy={busyEntityId === sheetEntity.id}
          onImport={async () => {
            if (await importEntity(sheetEntity)) setSheetEntity(null);
          }}
          onLinkSuggestion={(npc) => {
            setLinkingEntity(sheetEntity);
            setLinkTarget(npc);
            setSheetEntity(null);
          }}
          onPickOther={() => {
            setLinkingEntity(sheetEntity);
            setPicking(sheetEntity);
            setSheetEntity(null);
          }}
          onDiscard={() => discardEntity(sheetEntity)}
          onClose={() => setSheetEntity(null)}
        />
      )}

      {/* GM Assistant — discarded entities management (restore) */}
      {showDiscarded && (
        <GmaDiscardedModal
          entities={discardedEntities}
          busyEntityId={busyEntityId}
          onRestore={restoreEntity}
          onClose={() => setShowDiscarded(false)}
        />
      )}

      {/* GM Assistant — link confirm (append proposal) */}
      {linkingEntity && linkTarget && (
        <GmaLinkConfirmModal
          entity={linkingEntity}
          npc={linkTarget}
          mayAppend={!!linkingEntity.description && canEditNpc(linkTarget)}
          reconcileWith={(gmaByNpcId.get(linkTarget.id) ?? []).filter(
            (e) => e.id !== linkingEntity.id,
          )}
          busy={busyEntityId === linkingEntity.id}
          onLink={(append) => linkEntity(linkingEntity, linkTarget, append)}
          onClose={() => {
            setLinkingEntity(null);
            setLinkTarget(null);
          }}
        />
      )}

      {/* GM Assistant — NPC picker (« ce n'est pas lui ? ») */}
      {picking && (
        <GmaNpcPickerModal
          entity={picking}
          npcs={[...npcs].sort((a, b) => a.name.localeCompare(b.name, 'fr'))}
          linkedBy={gmaByNpcId}
          onPick={(npc) => {
            setLinkTarget(npc);
            setPicking(null);
          }}
          onClose={() => {
            setPicking(null);
            setLinkingEntity(null);
          }}
        />
      )}

      {/* GM Assistant — origin sheet (badge tap) */}
      {originEntity?.linkedNpc && originNpc && (
        <GmaOriginModal
          entity={originEntity}
          campaignTitle={gmaRes?.campaignTitle ?? ''}
          npc={originNpc}
          siblings={originSiblings}
          busy={busyEntityId === originEntity.id}
          mayEdit={canEditNpc(originNpc)}
          mayUnlink={
            isGM ||
            originEntity.linkedNpc.linkedByUserId === user?.id ||
            originNpc.createdBy === user?.id
          }
          onPull={(append) => pullEntity(originEntity, append)}
          onUnlink={() => unlinkEntity(originEntity)}
          onSwitchSibling={(sibling) => setOriginEntity(sibling)}
          onClose={() => setOriginEntity(null)}
        />
      )}

      {/* NPC detail (bottom card) — from the card's « Lire la suite ».
          Rendered HERE, page-level: Modal isn't portaled, and a Modal born
          inside article.card would sit in its backdrop-blur containing block. */}
      {detailNpc && (
        <NpcDetailModal
          npc={detailNpc}
          gma={gmaByNpcId.get(detailNpc.id) ?? []}
          partyId={partyId!}
          onClose={() => setDetailNpc(null)}
        />
      )}
    </div>
  );
}

// ---------- NPC card ----------

function NpcCard({
  npc,
  gma,
  partyId,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onGma,
  onDetail,
}: {
  npc: Npc;
  /** GM Assistant entities réconciliées on this NPC — drives the gold badge
      + « Vu en séance » (sessions merged across every sighting). */
  gma: GmaEntity[];
  partyId: string;
  canEdit: boolean;
  /** Supprimer reste au créateur/MD — l'édition de groupe ne l'accorde pas */
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onGma: () => void;
  onDetail: () => void;
}) {
  const { t } = useTranslation();
  const [showSecret, setShowSecret] = useState(false);
  const hasSecret = npc.secret !== null && npc.secret.trim() !== '';
  const groupEditable = npc.isShared && npc.allowMemberEdit;

  // « Lire la suite » only when the clamped description actually truncates
  // (measured — a short card never grows a dead control). ResizeObserver: the
  // same card is ~330px on mobile, ~365px in the desktop grid.
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const [descClamped, setDescClamped] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: npc.description est volontaire — le texte peut changer dans le MÊME nœud clampé sans que sa boîte ne bouge (RO muet), la dépendance force la re-mesure
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const check = () => setDescClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [npc.description]);

  return (
    // min-w-0 : l'article est un item de grille — sans lui, sa largeur
    // min-content (le titre en nowrap) fait déborder la grille ET la page
    <article className="card p-4 min-w-0 flex flex-col gap-2 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="min-w-0 flex-1 text-left"
            aria-label={t('pnj.modifier.npc.name', { npc_name: npc.name })}
          >
            <h3 className="section-title leading-tight truncate">{npc.name}</h3>
          </button>
        ) : (
          // Non-editors get a plain heading — no dead focusable control
          <h3 className="section-title leading-tight truncate min-w-0 flex-1">{npc.name}</h3>
        )}
        <span
          className="shrink-0 text-base"
          title={
            npc.isShared
              ? t('pnj.partage.avec.le.groupe')
              : t('pnj.prive.visible.par.le.createur.et.le.md')
          }
          role="img"
          aria-label={npc.isShared ? t('pnj.partage') : t('pnj.prive')}
        >
          {npc.isShared ? '🔗' : '🔒'}
        </span>
        {groupEditable && (
          <span
            className="shrink-0 text-base"
            title={t('pnj.modifiable.par.le.groupe')}
            role="img"
            aria-label={t('pnj.modifiable.par.le.groupe')}
          >
            ✏️
          </span>
        )}
      </div>

      {/* Role + status + disposition row */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {npc.role && (
          <span className="px-2 py-0.5 rounded-full bg-parchment-100 text-ink-600 font-medium">
            {npc.role}
          </span>
        )}
        <span className="flex items-center gap-1">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT_CLASS[npc.status]}`}
            title={t(`pnj.status.${npc.status}`)}
            aria-hidden="true"
          />
          <span className={`font-medium ${STATUS_TEXT_CLASS[npc.status]}`}>
            {t(`pnj.status.${npc.status}`)}
          </span>
        </span>
        <span className="text-ink-500">· {t(`pnj.disposition.${npc.disposition}`)}</span>
      </div>

      {/* Location */}
      {npc.location && (
        <p className="text-sm text-ink-600 flex items-center gap-1">
          <span aria-hidden="true">📍</span>
          <span className="truncate">{npc.location}</span>
        </p>
      )}

      {/* Description — clamped on the card; the detail bottom card carries all */}
      {npc.description && (
        <p ref={descRef} className="text-sm text-ink-700 whitespace-pre-line line-clamp-4">
          {npc.description}
        </p>
      )}
      {descClamped && (
        <button
          type="button"
          onClick={onDetail}
          className="self-start -ml-2 px-2 py-1.5 rounded-lg text-xs font-medium text-ink-500 hover:bg-parchment-100"
          aria-label={t('pnj.voir.la.fiche.de.name', { npc_name: npc.name })}
        >
          {t('pnj.description.voir.plus')}
        </button>
      )}

      {/* GM Assistant origin — glyph-only door (keeps the header clean),
          followed by « Vu en séance » when the entity has appearances */}
      {gma.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onGma}
            className="inline-flex items-center justify-center h-11 w-11 rounded-md border border-gold-300 bg-gold-100 text-gold-700 hover:bg-gold-300/40"
            title={t('pnj.gma.badge.title')}
            aria-label={t('pnj.gma.badge.aria', { name: npc.name })}
          >
            <span aria-hidden="true">📜</span>
          </button>
          <GmaSessionOrdinals sessions={mergeGmaSessions(gma)} partyId={partyId} />
        </div>
      )}

      {/* Secret (only visible if the API returned it — GM only) */}
      {hasSecret && (
        <div className="mt-1 border-t border-parchment-200 pt-2">
          <button
            type="button"
            onClick={() => setShowSecret((s) => !s)}
            className="text-xs font-medium text-purple-700 hover:underline flex items-center gap-1"
            aria-expanded={showSecret}
          >
            <span aria-hidden="true">🤫</span>
            {t('pnj.secret')}
            <span className={`text-ink-400 chevron ${showSecret ? 'is-open' : 'is-closed'}`}>
              ▼
            </span>
          </button>
          <div className={`expand-grid ${showSecret ? '' : 'is-collapsed'}`}>
            <div className="expand-inner">
              <p className="mt-1 text-sm text-purple-900 bg-purple-50 rounded-lg p-2 whitespace-pre-line">
                {npc.secret}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer: creator + actions */}
      <div className="mt-auto pt-2 flex items-center justify-between gap-2 border-t border-parchment-100">
        <span className="text-xs text-ink-400 truncate">
          {t('pnj.par.name', { name: npc.createdByName })}
        </span>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="text-xs px-2 py-1 rounded-lg text-ink-600 hover:bg-parchment-100"
              aria-label={t('pnj.modifier.npc.name', { npc_name: npc.name })}
            >
              {t('pnj.modifier')}
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-xs px-2 py-1 rounded-lg text-red-600 hover:bg-red-50"
                aria-label={t('pnj.supprimer.npc.name', { npc_name: npc.name })}
              >
                🗑
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// ---------- NPC detail (bottom card from « Lire la suite ») ----------

function NpcDetailModal({
  npc,
  gma,
  partyId,
  onClose,
}: {
  npc: Npc;
  /** GM Assistant entities réconciliées on this NPC (may be empty). */
  gma: GmaEntity[];
  partyId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const hasSecret = npc.secret !== null && npc.secret.trim() !== '';

  return (
    <Modal open={true} onClose={onClose} title={npc.name}>
      <div className="space-y-3">
        {/* Same meta grammar as the card */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {npc.role && (
            <span className="px-2 py-0.5 rounded-full bg-parchment-100 text-ink-600 font-medium">
              {npc.role}
            </span>
          )}
          <span className="flex items-center gap-1">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT_CLASS[npc.status]}`}
              title={t(`pnj.status.${npc.status}`)}
              aria-hidden="true"
            />
            <span className={`font-medium ${STATUS_TEXT_CLASS[npc.status]}`}>
              {t(`pnj.status.${npc.status}`)}
            </span>
          </span>
          <span className="text-ink-500">· {t(`pnj.disposition.${npc.disposition}`)}</span>
        </div>

        {npc.location && (
          <p className="text-sm text-ink-600 flex items-center gap-1">
            <span aria-hidden="true">📍</span>
            <span>{npc.location}</span>
          </p>
        )}

        {gma.length > 0 && (
          <GmaSessionOrdinals sessions={mergeGmaSessions(gma)} partyId={partyId} />
        )}

        {npc.description && (
          <p className="text-sm text-ink-700 whitespace-pre-line">{npc.description}</p>
        )}

        {/* Secret — present only when the API served it (GM alone) */}
        {hasSecret && (
          <p className="text-sm text-purple-900 bg-purple-50 rounded-lg p-2.5 whitespace-pre-line">
            {npc.secret}
          </p>
        )}

        <p className="text-xs text-ink-400 border-t border-parchment-100 pt-2">
          {t('pnj.par.name', { name: npc.createdByName })}
        </p>
      </div>
    </Modal>
  );
}

// ---------- Create / Edit modal ----------

interface NpcFormModalProps {
  open: boolean;
  onClose: () => void;
  partyId: string;
  npc: Npc | null;
  /** Le secret est le champ du MD — jamais montré ni envoyé par un joueur. */
  isGM: boolean;
  /** Créateur (ou MD, ou création) : seul habilité à toucher les drapeaux de partage. */
  canManageSharing: boolean;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}

function NpcFormModal({
  open,
  onClose,
  partyId,
  npc,
  isGM,
  canManageSharing,
  onSaved,
  onError,
}: NpcFormModalProps) {
  const { t } = useTranslation();
  const isEdit = npc !== null;

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [faction, setFaction] = useState('');
  const [disposition, setDisposition] = useState<NpcDisposition>('neutral');
  const [status, setStatus] = useState<NpcStatus>('alive');
  const [description, setDescription] = useState('');
  const [secret, setSecret] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [allowMemberEdit, setAllowMemberEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset / pre-fill whenever the modal opens (or target npc changes)
  useEffect(() => {
    if (!open) return;
    if (npc) {
      setName(npc.name);
      setRole(npc.role ?? '');
      setLocation(npc.location ?? '');
      setFaction(npc.faction ?? '');
      setDisposition(npc.disposition);
      setStatus(npc.status);
      setDescription(npc.description ?? '');
      setSecret(npc.secret ?? '');
      setIsShared(npc.isShared);
      setAllowMemberEdit(npc.isShared && npc.allowMemberEdit);
    } else {
      setName('');
      setRole('');
      setLocation('');
      setFaction('');
      setDisposition('neutral');
      setStatus('alive');
      setDescription('');
      setSecret('');
      setIsShared(true);
      setAllowMemberEdit(false);
    }
    setSubmitting(false);
  }, [open, npc]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSubmitting(true);
    try {
      if (isEdit && npc) {
        const payload: PatchNpcPayload = {
          name: trimmedName,
          role: role.trim() || null,
          location: location.trim() || null,
          faction: faction.trim() || null,
          disposition,
          status,
          description: description.trim() || null,
        };
        // Un éditeur « groupe » ne porte que le contenu — jamais les drapeaux
        if (canManageSharing) {
          payload.isShared = isShared;
          payload.allowMemberEdit = isShared && allowMemberEdit;
        }
        if (isGM) payload.secret = secret.trim() || null;
        await api.patch(`/api/npcs/${npc.id}`, payload);
      } else {
        const payload: CreateNpcPayload = {
          name: trimmedName,
          role: role.trim() || undefined,
          location: location.trim() || undefined,
          faction: faction.trim() || undefined,
          disposition,
          status,
          description: description.trim() || undefined,
          isShared,
          allowMemberEdit: isShared && allowMemberEdit,
        };
        if (isGM) payload.secret = secret.trim() || undefined;
        await api.post(`/api/parties/${partyId}/npcs`, payload);
      }
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('pnj.erreur.lors.de.l.enregistrement'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('pnj.modifier.le.pnj') : t('pnj.nouveau.pnj')}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="npc-name">
            {t('pnj.nom')}
          </label>
          <input
            id="npc-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="npc-role">
              {t('pnj.role')}
            </label>
            <input
              id="npc-role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t('pnj.ex.aubergiste.marchand')}
            />
          </div>
          <div>
            <label className="label" htmlFor="npc-faction">
              {t('pnj.faction')}
            </label>
            <input
              id="npc-faction"
              className="input"
              value={faction}
              onChange={(e) => setFaction(e.target.value)}
              placeholder={t('pnj.ex.ordre.du.gantelet')}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="npc-location">
            {t('pnj.lieu')}
          </label>
          <input
            id="npc-location"
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('pnj.ex.port.de.nyanzaru')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="npc-disposition">
              {t('pnj.disposition')}
            </label>
            <select
              id="npc-disposition"
              className="input"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as NpcDisposition)}
            >
              {DISPOSITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="npc-status">
              {t('pnj.statut')}
            </label>
            <select
              id="npc-status"
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as NpcStatus)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="npc-description">
            {t('pnj.description')}
          </label>
          <textarea
            id="npc-description"
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('pnj.apparence.placeholder')}
          />
        </div>

        {isGM && (
          <div>
            <label className="label" htmlFor="npc-secret">
              {t('pnj.secret')}
            </label>
            <textarea
              id="npc-secret"
              className="input"
              rows={2}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t('pnj.informes.cachees.visibles.par.le.createur')}
            />
            <span className="text-xs text-ink-400 mt-1 block">
              {t('pnj.le.secret.n.est.jamais.partage')}
            </span>
          </div>
        )}

        {canManageSharing ? (
          <>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                className="w-4 h-4 accent-blood-600"
              />
              <span className="text-sm font-medium text-ink-700">
                {t('pnj.partage.avec.le.groupe')}
              </span>
              <span className="text-xs text-ink-400">
                {t('pnj.sinon.visible.par.le.createur.et')}
              </span>
            </label>
            <label
              className={`flex items-center gap-2 select-none pl-6 ${
                isShared ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <input
                type="checkbox"
                checked={isShared && allowMemberEdit}
                onChange={(e) => setAllowMemberEdit(e.target.checked)}
                disabled={!isShared}
                className="w-4 h-4 accent-blood-600"
              />
              <span className="text-sm font-medium text-ink-700">
                {t('pnj.autoriser.le.groupe.a.modifier')}
              </span>
              <span className="text-xs text-ink-400">
                {t('pnj.membres.ne.peuvent.pas.supprimer')}
              </span>
            </label>
          </>
        ) : (
          // Éditeur « groupe » : contenu seulement — la pastille encre des
          // états discrets (idiome « Caché »), le sang est réservé
          <span className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-ink-600 bg-ink-100 rounded-full px-2.5 py-1">
            <span aria-hidden="true">✏️</span>
            {t('pnj.vous.pouvez.modifier.ce.pnj.partage')}
          </span>
        )}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? t('pnj.enregistrement') : isEdit ? t('common.save') : t('pnj.creer.le.pnj')}
        </button>
      </form>
    </Modal>
  );
}

// ---------- GM Assistant: shared bits ----------

/** « Vu en séance — I · III » — the chronicle's own ordinals, doors into it. */
function GmaSessionOrdinals({
  sessions,
  partyId,
  className = '',
}: {
  sessions: GmaEntitySessionRef[];
  partyId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (sessions.length === 0) return null;
  return (
    <p className={`text-xs text-ink-500 flex items-center flex-wrap gap-1 ${className}`}>
      <span>
        {t('pnj.gma.vu.en.seance')} <span aria-hidden="true">—</span>
      </span>
      {sessions.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden="true">·</span>}
          <Link
            to={`/party/${partyId}/chronique?seance=${s.id}`}
            className="font-display text-gold-700 hover:underline"
            title={s.title}
          >
            {toRoman(s.ordinal)}
          </Link>
        </span>
      ))}
    </p>
  );
}

// ---------- GM Assistant: entity actions (bottom card from the rail's ＋) ----------

function GmaEntitySheetModal({
  entity,
  suggestion,
  partyId,
  busy,
  onImport,
  onLinkSuggestion,
  onPickOther,
  onDiscard,
  onClose,
}: {
  entity: GmaEntity;
  /** Registry NPC carrying the same name — the one-tap link target. */
  suggestion: Npc | null;
  partyId: string;
  busy: boolean;
  onImport: () => void;
  onLinkSuggestion: (npc: Npc) => void;
  onPickOther: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal open={true} onClose={busy ? () => {} : onClose} title={entity.name}>
      <div className="space-y-4">
        {entity.description ? (
          <p className="text-sm text-ink-700 whitespace-pre-line">{entity.description}</p>
        ) : (
          <p className="text-sm text-ink-400 italic">{t('pnj.gma.sans.description')}</p>
        )}
        <GmaSessionOrdinals sessions={entity.sessions} partyId={partyId} className="text-ink-400" />
        <div className="flex flex-col gap-2 pt-1">
          {suggestion ? (
            <>
              <button
                type="button"
                onClick={() => onLinkSuggestion(suggestion)}
                disabled={busy}
                className="btn-primary w-full"
              >
                {t('pnj.gma.lier.a', { name: suggestion.name })}
              </button>
              <button
                type="button"
                onClick={onImport}
                disabled={busy}
                className="btn-secondary w-full"
              >
                {busy ? t('pnj.gma.en.cours') : t('pnj.gma.ajouter.au.registre')}
              </button>
              <button
                type="button"
                onClick={onPickOther}
                disabled={busy}
                className="text-xs px-2 py-2 min-h-11 rounded-lg text-ink-500 hover:bg-parchment-100 disabled:opacity-50"
              >
                {t('pnj.gma.autre.pnj')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onImport}
                disabled={busy}
                className="btn-primary w-full"
              >
                {busy ? t('pnj.gma.en.cours') : t('pnj.gma.ajouter.au.registre')}
              </button>
              <button
                type="button"
                onClick={onPickOther}
                disabled={busy}
                className="btn-secondary w-full"
              >
                {t('pnj.gma.lier.a.un.pnj.existant')}
              </button>
            </>
          )}
        </div>
        {/* Écarter — a light, reversible gesture: encre, two-step, not blood */}
        <div className="pt-2 border-t border-parchment-200">
          {busy ? (
            <button type="button" disabled className="btn-ghost w-full min-h-11 text-ink-400">
              {t('pnj.gma.en.cours')}
            </button>
          ) : (
            <ConfirmButton
              onConfirm={onDiscard}
              className="btn-ghost w-full min-h-11 text-ink-500 hover:bg-parchment-100"
              confirmChildren={t('pnj.gma.ecarter.confirm')}
            >
              {t('pnj.gma.ecarter')}
            </ConfirmButton>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------- GM Assistant: discarded entities (restore) ----------

function GmaDiscardedModal({
  entities,
  busyEntityId,
  onRestore,
  onClose,
}: {
  entities: GmaEntity[];
  busyEntityId: string | null;
  onRestore: (entity: GmaEntity) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal open={true} onClose={onClose} title={t('pnj.gma.ecartes.titre')}>
      <div className="space-y-3">
        <p className="text-sm text-ink-500">{t('pnj.gma.ecartes.hint')}</p>
        <ul className="divide-y divide-parchment-200 -mx-1 px-1">
          {entities.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{e.name}</p>
                {e.description && (
                  <p className="mt-0.5 text-xs text-ink-400 line-clamp-1 whitespace-pre-line">
                    {e.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRestore(e)}
                disabled={busyEntityId === e.id}
                className="shrink-0 min-h-11 px-3 rounded-lg border border-parchment-300 bg-parchment-50 text-ink-800 text-sm font-medium hover:bg-parchment-100 disabled:opacity-50"
              >
                {busyEntityId === e.id ? t('pnj.gma.en.cours') : t('pnj.gma.restaurer')}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ---------- GM Assistant: link confirm (append proposal) ----------

function GmaLinkConfirmModal({
  entity,
  npc,
  mayAppend,
  reconcileWith,
  busy,
  onLink,
  onClose,
}: {
  entity: GmaEntity;
  npc: Npc;
  /** Entity has a description AND the actor may edit this NPC's content. */
  mayAppend: boolean;
  /** Other GMA entities already carried by this NPC — the link réconcilies. */
  reconcileWith: GmaEntity[];
  busy: boolean;
  onLink: (append: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const otherNames = reconcileWith.map((e) => `« ${e.name} »`).join(', ');

  return (
    <Modal
      open={true}
      onClose={busy ? () => {} : onClose}
      title={t('pnj.gma.lier.titre', { entity: entity.name, name: npc.name })}
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-600">
          {t('pnj.gma.lier.corps', { entity: entity.name, name: npc.name })}
        </p>
        {reconcileWith.length > 0 && (
          <p className="text-xs text-ink-600 rounded-lg border border-gold-300 bg-gold-100/60 p-2.5">
            {t('pnj.gma.lier.reconciliation', { name: npc.name, names: otherNames })}
          </p>
        )}
        {mayAppend ? (
          <>
            <div className="rounded-lg border border-parchment-200 p-2.5 space-y-2 bg-parchment-50">
              <div>
                <p className="text-xs font-semibold text-ink-500">
                  {t('pnj.gma.description.actuelle')}
                </p>
                <p className="mt-0.5 text-xs text-ink-600 line-clamp-3 whitespace-pre-line">
                  {npc.description || t('pnj.gma.description.vide')}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gold-700">
                  {t('pnj.gma.description.gma')}
                </p>
                <p className="mt-0.5 text-xs text-ink-600 line-clamp-3 whitespace-pre-line">
                  {entity.description}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onLink(true)}
                disabled={busy}
                className="btn-primary w-full"
              >
                {busy ? t('pnj.gma.en.cours') : t('pnj.gma.lier.et.ajouter')}
              </button>
              <button
                type="button"
                onClick={() => onLink(false)}
                disabled={busy}
                className="btn-secondary w-full"
              >
                {t('pnj.gma.lier.seulement')}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onLink(false)}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? t('pnj.gma.en.cours') : t('pnj.gma.lier.seulement')}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---------- GM Assistant: NPC picker ----------

function GmaNpcPickerModal({
  entity,
  npcs,
  linkedBy,
  onPick,
  onClose,
}: {
  entity: GmaEntity;
  npcs: Npc[];
  /** npcId → entities already carried by it — picking one of those
      réconcilies (adds a sighting) rather than being refused. */
  linkedBy: Map<number, GmaEntity[]>;
  onPick: (npc: Npc) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const needle = normalizeName(filter);
  const visible = needle ? npcs.filter((n) => normalizeName(n.name).includes(needle)) : npcs;

  return (
    <Modal open={true} onClose={onClose} title={t('pnj.gma.choisir.le.pnj')}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">
          {t('pnj.gma.choisir.corps', { entity: entity.name })}
        </p>
        {npcs.length > 0 && (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('pnj.rechercher.un.pnj')}
            aria-label={t('pnj.rechercher.un.pnj')}
            className="input w-full"
          />
        )}
        {npcs.length === 0 ? (
          <p className="text-sm text-ink-400">{t('pnj.gma.choisir.vide')}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-ink-400">{t('pnj.aucun.resultat')}</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-parchment-200 -mx-1 px-1">
            {visible.map((n) => {
              const carriedBy = linkedBy.get(n.id) ?? [];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onPick(n)}
                    title={
                      carriedBy.length > 0
                        ? t('pnj.gma.choisir.deja.lie', {
                            names: carriedBy.map((e) => `« ${e.name} »`).join(', '),
                          })
                        : undefined
                    }
                    className="w-full min-h-11 flex items-center justify-between gap-2 px-1 py-2 text-left hover:bg-parchment-100 rounded-lg"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT_CLASS[n.status]}`}
                        title={t(`pnj.status.${n.status}`)}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink-800 truncate">
                          {n.name}
                        </span>
                        {carriedBy.length > 0 && (
                          <span className="block text-xs text-ink-400 truncate">
                            {t('pnj.gma.choisir.deja.lie', {
                              names: carriedBy.map((e) => `« ${e.name} »`).join(', '),
                            })}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-xs text-ink-400 shrink-0" aria-hidden="true">
                      {n.isShared ? '🔗' : '🔒'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ---------- GM Assistant: origin sheet (badge tap) ----------

function GmaOriginModal({
  entity,
  campaignTitle,
  npc,
  siblings,
  busy,
  mayEdit,
  mayUnlink,
  onPull,
  onUnlink,
  onSwitchSibling,
  onClose,
}: {
  entity: GmaEntity;
  campaignTitle: string;
  npc: Npc;
  /** Other GMA entities réconciliées on this NPC — tap to inspect one. */
  siblings: GmaEntity[];
  busy: boolean;
  mayEdit: boolean;
  mayUnlink: boolean;
  onPull: (append: boolean) => void;
  onUnlink: () => void;
  onSwitchSibling: (sibling: GmaEntity) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const link = entity.linkedNpc!;
  const linkedAt = gmaDateLabel(link.linkedAt);
  const lastPullAt = gmaDateLabel(link.lastPullAt);

  return (
    <Modal open={true} onClose={onClose} title={t('pnj.gma.origine.titre')}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          {t('pnj.gma.origine.corps', {
            name: npc.name,
            entity: entity.name,
            campaign: campaignTitle,
          })}
        </p>
        <p className="text-xs text-ink-400">
          {linkedAt && t('pnj.gma.origine.lie.le', { name: link.linkedByName, date: linkedAt })}
          {linkedAt && lastPullAt && ' · '}
          {lastPullAt && t('pnj.gma.origine.derniere.reprise', { date: lastPullAt })}
        </p>

        {siblings.length > 0 && (
          <div>
            <p className="label">{t('pnj.gma.origine.aussi.liees')}</p>
            <ul className="mt-1 divide-y divide-parchment-200">
              {siblings.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSwitchSibling(s)}
                    className="w-full min-h-11 flex items-center gap-3 py-2 text-left group"
                  >
                    <span className="w-8 shrink-0 text-center" aria-hidden="true">
                      📜
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-800 truncate group-hover:text-blood-600">
                        {s.name}
                      </span>
                    </span>
                    <span className="text-ink-300 group-hover:text-blood-600" aria-hidden="true">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {entity.sessions.length > 0 && (
          <div>
            <p className="label">{t('pnj.gma.vu.en.seance')}</p>
            <ul className="mt-1 divide-y divide-parchment-200">
              {entity.sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/party/${npc.partyId}/chronique?seance=${s.id}`}
                    onClick={onClose}
                    className="min-h-11 flex items-center gap-3 py-2 group"
                  >
                    <span className="w-8 text-right font-display text-gold-700" aria-hidden="true">
                      {toRoman(s.ordinal)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-800 truncate group-hover:text-blood-600">
                        {s.title}
                      </span>
                    </span>
                    <span className="text-ink-300 group-hover:text-blood-600" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* GMA-side description changed since the last pull */}
        {link.descriptionUpdated && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {t('pnj.gma.description.mise.a.jour')}
          </p>
        )}

        {entity.description && mayEdit && (
          <div className="space-y-2">
            {link.descriptionUpdated || link.textPulled ? (
              <>
                <p className="text-xs text-ink-400">{t('pnj.gma.reprendre.avertissement')}</p>
                {busy ? (
                  <button type="button" disabled className="btn-secondary w-full">
                    {t('pnj.gma.en.cours')}
                  </button>
                ) : (
                  <ConfirmButton
                    onConfirm={() => onPull(false)}
                    className="btn-secondary w-full"
                    confirmChildren={t('pnj.gma.reprendre.confirm')}
                  >
                    {t('pnj.gma.reprendre.la.description')}
                  </ConfirmButton>
                )}
              </>
            ) : (
              // Linked without ever taking the text — the offer is additive
              <button
                type="button"
                onClick={() => onPull(true)}
                disabled={busy}
                className="btn-secondary w-full"
              >
                {busy ? t('pnj.gma.en.cours') : t('pnj.gma.ajouter.la.description')}
              </button>
            )}
          </div>
        )}

        {mayUnlink &&
          (busy ? (
            <button type="button" disabled className="btn-ghost w-full min-h-11 text-red-600">
              {t('pnj.gma.en.cours')}
            </button>
          ) : (
            <ConfirmButton
              onConfirm={onUnlink}
              className="btn-ghost w-full min-h-11 text-red-600 hover:bg-red-50"
              confirmChildren={t('pnj.gma.delier.confirm')}
            >
              {t('pnj.gma.delier')}
            </ConfirmButton>
          ))}
      </div>
    </Modal>
  );
}
