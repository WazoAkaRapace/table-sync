import type {
  CreateNpcPayload,
  Npc,
  NpcDisposition,
  NpcStatus,
  PartyDetail,
  PatchNpcPayload,
} from '@table-sync/shared';
import { NPC_DISPOSITION_LABELS_FR, NPC_STATUS_LABELS_FR } from '@table-sync/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { EmptyState, ErrorMsg, LoadingSpinner, Modal } from '../components/ui';
import { useSyncEvent } from '../sync';

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

// ---------- Main component ----------

export default function NpcPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { partyId } = useParams<{ partyId: string }>();
  const { user } = useAuth();

  const [npcs, setNpcs] = useState<Npc[]>([]);
  const [party, setParty] = useState<PartyDetail | null>(null);
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
        const [npcRes, partyRes] = await Promise.all([
          api.get<{ npcs: Npc[] }>(`/api/parties/${partyId}/npcs`),
          api.get<PartyDetail>(`/api/parties/${partyId}`),
        ]);
        setNpcs(npcRes.data.npcs);
        setParty(partyRes.data);
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

  // Real-time sync
  const currentPartyId = Number(partyId);
  useSyncEvent(
    (event) => {
      if (event.partyId === currentPartyId) {
        load(true); // silent — no spinner flash on sync updates
      }
    },
    [currentPartyId],
  );

  const isGM = useMemo(
    () => !!party && party.members.some((m) => m.userId === user?.id && m.role === 'gm'),
    [party, user],
  );

  // ---------- Filtering & grouping ----------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return npcs
      .filter((n) => {
        if (view === 'shared' && !n.isShared) return false;
        if (view === 'mine' && n.createdBy !== user?.id) return false;
        if (dispositionFilter && n.disposition !== dispositionFilter) return false;
        if (statusFilter && n.status !== statusFilter) return false;
        if (q) {
          const hay =
            `${n.name} ${n.role ?? ''} ${n.location ?? ''} ${n.faction ?? ''} ${n.description ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [npcs, search, dispositionFilter, statusFilter, view, user?.id]);

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

  if (loading) return <LoadingSpinner label={t('pnj.chargement.des.pnj')} />;
  if (error && npcs.length === 0) return <ErrorMsg message={error} />;
  if (!party) return <ErrorMsg message={t('pnj.groupe.introuvable')} />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {!embedded && <span className="text-sm text-ink-400">{t('pnj.titre')}</span>}
        </div>
        <button type="button" onClick={openCreate} className="btn-primary text-sm">
          {t('pnj.ajouter.un.pnj')}
        </button>
      </div>

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
            className="input"
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
            className="input"
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
            className="input col-span-2 sm:col-span-1"
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

      {/* NPC grid grouped by faction */}
      {filtered.length === 0 ? (
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
        <div className="space-y-6">
          {grouped.map(([faction, group]) => (
            <section key={faction}>
              <h2 className="section-title mb-3 flex items-center gap-2">
                <span className="text-blood-600">⚜</span>
                {faction === NO_FACTION ? t('pnj.sans.faction') : faction}
                <span className="text-ink-400 text-sm font-normal">({group.length})</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((npc) => (
                  <NpcCard
                    key={npc.id}
                    npc={npc}
                    canEdit={isGM || npc.createdBy === user?.id}
                    onEdit={() => openEdit(npc)}
                    onDelete={() => setDeleting(npc)}
                  />
                ))}
              </div>
            </section>
          ))}
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
    </div>
  );
}

// ---------- NPC card ----------

function NpcCard({
  npc,
  canEdit,
  onEdit,
  onDelete,
}: {
  npc: Npc;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [showSecret, setShowSecret] = useState(false);
  const hasSecret = npc.secret !== null && npc.secret.trim() !== '';

  return (
    <article className="card p-4 flex flex-col gap-2 hover:shadow-md transition-shadow">
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

      {/* Description */}
      {npc.description && (
        <p className="text-sm text-ink-700 whitespace-pre-line">{npc.description}</p>
      )}

      {/* Secret (only visible if API returned it — i.e. creator or GM) */}
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
            <button
              type="button"
              onClick={onDelete}
              className="text-xs px-2 py-1 rounded-lg text-red-600 hover:bg-red-50"
              aria-label={t('pnj.supprimer.npc.name', { npc_name: npc.name })}
            >
              🗑
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

// ---------- Create / Edit modal ----------

interface NpcFormModalProps {
  open: boolean;
  onClose: () => void;
  partyId: string;
  npc: Npc | null;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}

function NpcFormModal({ open, onClose, partyId, npc, onSaved, onError }: NpcFormModalProps) {
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
          secret: secret.trim() || null,
          isShared,
        };
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
          secret: secret.trim() || undefined,
          isShared,
        };
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
          <span className="text-xs text-ink-400">{t('pnj.sinon.visible.par.le.createur.et')}</span>
        </label>

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? t('pnj.enregistrement') : isEdit ? t('common.save') : t('pnj.creer.le.pnj')}
        </button>
      </form>
    </Modal>
  );
}
