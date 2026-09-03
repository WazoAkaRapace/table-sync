import type {
  BannedPartyUser,
  CharacterInventory,
  CharacterSummary,
  PartyDetail,
  PartyMember,
} from '@table-sync/shared';
import {
  abilityModifier,
  computeAC,
  passivePerception,
  proficiencyBonus,
  skillProficiencyLevel,
} from '@table-sync/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { itemImageUrl } from '../api';
import { useAuth } from '../auth';
import { GmaAssistantTab } from '../components/GmaAssistantTab';
import {
  EMPTY_ITEM_IMAGE,
  ItemImageField,
  type ItemImageValue,
} from '../components/ItemImageField';
import { ItemImageViewer } from '../components/ItemImageViewer';
import {
  CategoryBadge,
  ConfirmButton,
  EmptyState,
  ErrorMsg,
  Fab,
  LoadingSpinner,
  Modal,
  TabButton,
  type Toast,
  ToastStack,
} from '../components/ui';
import { appLocale } from '../i18n';
import { useSyncEvent } from '../sync';
import { activeCharactersFirst } from '../utils';

interface Transaction {
  id: number;
  partyId: number;
  characterId: number | null;
  itemId: number | null;
  itemName: string;
  deltaQty: number;
  reason: string;
  actorName: string | null;
  at: string;
}

export default function GmDashboardPage() {
  const { t } = useTranslation();
  const { partyId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<
    'characters' | 'transactions' | 'custom' | 'members' | 'assistant' | 'settings'
  >('characters');

  const load = useCallback(
    async (silent = false) => {
      if (!partyId) return;
      if (!silent) setLoading(true);
      try {
        const [partyRes, txRes] = await Promise.all([
          api.get(`/api/parties/${partyId}`),
          api.get(`/api/parties/${partyId}/transactions`),
        ]);
        setParty(partyRes.data);
        setTransactions(txRes.data.transactions);
      } catch (err: any) {
        setError(err.response?.data?.error || t('md.erreur'));
      } finally {
        setLoading(false);
      }
    },
    [partyId, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Real-time sync: refresh when any inventory/character/party change happens in this party
  const currentPartyId = Number(partyId);
  useSyncEvent(
    (event) => {
      if (event.partyId === currentPartyId) {
        load(true); // silent — no spinner flash on sync updates
      }
    },
    [currentPartyId],
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMsg message={error} />;
  if (!party) return <ErrorMsg message={t('md.groupe.introuvable')} />;

  // Zone de danger — tab Réglages visible au MD seulement (l'API vérifie aussi)
  const isGm = party.members.some((m) => m.userId === user?.id && m.role === 'gm');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-ink-400">{party.party.name}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-parchment-200">
        <TabButton active={tab === 'characters'} onClick={() => setTab('characters')}>
          {t('md.personnages.n', { count: party.characters.length })}
        </TabButton>
        <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>
          {t('md.journal.n', { count: transactions.length })}
        </TabButton>
        <TabButton active={tab === 'custom'} onClick={() => setTab('custom')}>
          {t('md.objets.custom')}
        </TabButton>
        <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
          {t('md.joueurs.n', { count: party.members.length })}
        </TabButton>
        <TabButton active={tab === 'assistant'} onClick={() => setTab('assistant')}>
          GM Assistant
        </TabButton>
        {isGm && (
          <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
            {t('md.reglages')}
          </TabButton>
        )}
      </div>

      {tab === 'characters' && (
        <CharactersTab characters={party.characters} partyId={partyId!} onReload={load} />
      )}

      {tab === 'transactions' && <TransactionsTab transactions={transactions} />}

      {tab === 'custom' && <CustomItemsTab partyId={partyId!} />}

      {tab === 'members' && (
        <MembersTab
          members={party.members}
          banned={party.banned}
          characters={party.characters}
          partyId={partyId!}
          onReload={load}
        />
      )}

      {tab === 'assistant' && (
        <GmaAssistantTab
          partyId={partyId!}
          partyName={party.party.name}
          characters={party.characters}
        />
      )}

      {tab === 'settings' && isGm && (
        <DisbandPartySection
          partyId={partyId!}
          name={party.party.name}
          onDone={() => navigate('/parties')}
        />
      )}
    </div>
  );
}

/**
 * Dissoudre le groupe — the irreversible door. DELETE /api/parties/:id
 * cascades through everything party-scoped: membres, bannis, personnages
 * (fiches, sorts, traits, notes, inventaire, rangements), transactions,
 * PNJ, rencontres + combattants et objets personnalisés.
 * Type-the-name confirmation: this is the most destructive button in the app.
 */
function DisbandPartySection({
  partyId,
  name,
  onDone,
}: {
  partyId: string;
  name: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameMatches =
    confirmName.trim().length > 0 && confirmName.trim().toLowerCase() === name.trim().toLowerCase();

  async function disband() {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/parties/${partyId}`);
      onDone();
    } catch {
      setError(t('md.dissolution.impossible'));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-4">
      <h3 className="section-title text-red-700">{t('md.zone.de.danger')}</h3>
      <p className="mt-1 text-xs text-ink-500">{t('md.dissoudre.name.supprime', { name: name })}</p>
      <button
        type="button"
        className="mt-3 rounded border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-600 hover:text-white"
        onClick={() => {
          setConfirmName('');
          setError('');
          setOpen(true);
        }}
      >
        {t('md.dissoudre.le.groupe')}
      </button>

      {open && (
        <Modal
          open={open}
          onClose={() => !busy && setOpen(false)}
          title={t('md.dissoudre.name', { name: name })}
        >
          <p className="mb-3 text-sm text-ink-500">{t('md.tout.le.contenu.du.groupe.sera')}</p>
          <label className="block">
            <span className="label">{t('md.tape.le.nom.du.groupe', { name: name })}</span>
            <input
              className="input"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={name}
              autoFocus
              disabled={busy}
            />
          </label>
          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="btn-secondary flex-1"
            >
              {t('md.annuler')}
            </button>
            <button
              type="button"
              onClick={disband}
              disabled={busy || !nameMatches}
              className="btn-primary flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? t('md.dissolution') : t('md.dissoudre.definitivement')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CharactersTab({
  characters,
  partyId,
  onReload,
}: {
  characters: CharacterSummary[];
  partyId: string;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<CharacterSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [inventories, setInventories] = useState<Record<number, CharacterInventory>>({});

  // Fetch all character inventories in parallel for AC, weight %, food/water counts
  const loadInventories = useCallback(async (chars: CharacterSummary[]) => {
    const results = await Promise.allSettled(
      chars.map((c) => api.get<CharacterInventory>(`/api/characters/${c.id}/inventory`)),
    );
    const map: Record<number, CharacterInventory> = {};
    chars.forEach((c, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') map[c.id] = r.value.data;
    });
    setInventories(map);
  }, []);

  useEffect(() => {
    if (characters.length > 0) loadInventories(characters);
  }, [characters, loadInventories]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/characters/${deleteTarget.id}`);
      setDeleteTarget(null);
      onReload();
    } catch {
      // error handled by parent
    } finally {
      setDeleting(false);
    }
  }

  if (characters.length === 0) {
    return (
      <EmptyState
        icon="🧙"
        title={t('md.aucun.personnage')}
        hint={t('md.les.joueurs.doivent.creer.leurs')}
      />
    );
  }

  // Active sheets read first — hidden (secret prep) cards sink below their marker.
  const ordered = activeCharactersFirst(characters);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ordered.map((c) => {
        const inv = inventories[c.id];
        const entries = inv?.entries || [];
        const dexMod = abilityModifier(c.dexterity ?? 10);
        const wisMod = abilityModifier(c.wisdom ?? 10);
        const level = c.level ?? 1;
        const prof = proficiencyBonus(level);
        const perceptionLevel = skillProficiencyLevel(c, 'perception');
        const pp = passivePerception(wisMod, prof, perceptionLevel);
        const acResult = inv ? computeAC(entries, dexMod, c.fightingStyle === 'defense', c) : null;
        const effectiveAC = c.armorClassOverride ?? acResult?.ac ?? 10 + dexMod;
        const enc = inv?.encumbrance;
        const weightPct = enc ? Math.min(100, Math.round(enc.pct)) : 0;
        const hpPct =
          c.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((c.currentHp / c.maxHp) * 100))) : 0;
        const hpColor =
          c.currentHp <= 0
            ? 'bg-red-500'
            : hpPct < 33
              ? 'bg-orange-500'
              : hpPct < 66
                ? 'bg-yellow-500'
                : 'bg-green-500';

        // Food/water from inventory
        const foodCount = entries.reduce(
          (sum, e) => sum + (e.item.survivalTags?.includes('food') ? e.quantity : 0),
          0,
        );
        const fullWaterCount = entries.reduce((sum, e) => {
          if (!e.item.survivalTags?.includes('water')) return sum;
          if (e.notes?.includes('empty')) return sum;
          return sum + e.quantity;
        }, 0);

        const exhColor =
          c.exhaustion === 0
            ? 'bg-green-500'
            : c.exhaustion <= 2
              ? 'bg-yellow-500'
              : c.exhaustion <= 4
                ? 'bg-orange-500'
                : 'bg-red-500';

        return (
          <div key={c.id} className="card p-4 hover:shadow-md transition-shadow">
            {/* Header: portrait + name + class */}
            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/party/${partyId}/character/${c.id}`}
                className="min-w-0 flex-1 flex items-center gap-2"
              >
                {c.portraitUrl ? (
                  <img
                    src={c.portraitUrl}
                    alt={c.name}
                    className="w-10 h-10 rounded-full object-cover border border-parchment-300 shrink-0"
                  />
                ) : null}
                <div className="min-w-0">
                  <h3 className="font-display font-semibold truncate flex items-center gap-2">
                    <span className="truncate">{c.name}</span>
                    {c.hidden && (
                      <span
                        className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600"
                        title={t('md.cache.des.autres.joueurs.par.son')}
                      >
                        {t('md.cache')}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-ink-400">
                    {c.classes && c.classes.length > 1
                      ? `${c.classes.map((e) => `${e.classKey} ${e.level}`).join('/')} `
                      : c.characterClass
                        ? `${c.characterClass} `
                        : ''}
                    {c.level ? t('md.niv', { niveau: c.level }) : ''}
                    {c.race ? ` · ${c.race}` : ''}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setDeleteTarget(c)}
                className="text-ink-400 hover:text-red-600 text-sm shrink-0 p-1"
                aria-label={t('md.supprimer.c.name', { c_name: c.name })}
                title={t('md.supprimer.le.personnage')}
              >
                🗑
              </button>
            </div>

            {/* HP bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span>{t('md.pv')}</span>
                <span className="font-medium">
                  {c.currentHp}
                  {c.tempHp > 0 ? ` (+${c.tempHp})` : ''} / {c.maxHp}
                </span>
              </div>
              <div className="h-2 bg-parchment-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${hpColor} transition-all rounded-full`}
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            </div>

            {/* Inventory weight bar */}
            {enc && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
                  <span>{t('md.sac')}</span>
                  <span>
                    {enc.totalWeightKg.toFixed(1)} / {enc.maxCarryKg.toFixed(0)} kg ({weightPct}%)
                  </span>
                </div>
                <div className="h-1.5 bg-parchment-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all rounded-full ${
                      weightPct > 100
                        ? 'bg-red-500'
                        : weightPct > 60
                          ? 'bg-orange-400'
                          : 'bg-blue-400'
                    }`}
                    style={{ width: `${Math.min(100, weightPct)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Stats row: CA, PP, food, water */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-medium">
                {t('md.ca')} <span className="text-ink-800 font-bold">{effectiveAC}</span>
              </span>
              <span className="font-medium">
                {t('md.pp')} <span className="text-ink-800 font-bold">{pp}</span>
              </span>
              <span className="text-ink-500">🍖 {foodCount}</span>
              <span className="text-ink-500">💧 {fullWaterCount}</span>
              {c.exhaustion > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${exhColor}`} />
                  <span className="text-ink-500">{t('md.epuis', { niveau: c.exhaustion })}</span>
                </span>
              )}
              {c.currentHp <= 0 && (
                <span className="text-red-600 font-medium">
                  💀 {c.deathSaveSuccesses}/3 ✓ · {c.deathSaveFailures}/3 ✗
                </span>
              )}
            </div>

            {/* Conditions */}
            {c.conditions && c.conditions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {c.conditions.map((cond) => (
                  <span
                    key={cond}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-blood-50 text-blood-700 border border-blood-200"
                  >
                    {cond}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal
          open={!!deleteTarget}
          onClose={() => !deleting && setDeleteTarget(null)}
          title={t('md.supprimer.deletetarget.name', { deleteTarget_name: deleteTarget.name })}
        >
          <p className="text-sm text-ink-500 mb-4">
            {t('md.cette.action.est.irreversible.tout.l')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="btn-secondary flex-1"
            >
              {t('md.annuler')}
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
            >
              {deleting ? t('md.suppression') : t('md.supprimer.bouton')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** SQLite datetime ("2026-05-21 15:30:00") → « mai 2026 » (register's since-format). */
function sinceLabel(sqliteDate: string): string {
  const d = new Date(sqliteDate.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' });
}

type PendingAction =
  | { kind: 'remove'; member: PartyMember }
  | { kind: 'ban'; member: PartyMember }
  | { kind: 'unban'; user: BannedPartyUser };

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function actionCopy(
  p: PendingAction,
  t: Translate,
): {
  title: string;
  body: string;
  cta: string;
  danger: boolean;
} {
  if (p.kind === 'remove') {
    const name = p.member.displayName;
    return {
      title: t('md.retirer.name.title', { name: name }),
      body: t('md.retirer.name.body', { name: name }),
      cta: t('md.retirer'),
      danger: false,
    };
  }
  if (p.kind === 'ban') {
    const name = p.member.displayName;
    return {
      title: t('md.bannir.name.title', { name: name }),
      body: t('md.bannir.name.body', { name: name }),
      cta: t('md.bannir'),
      danger: true,
    };
  }
  const name = p.user.displayName;
  return {
    title: t('md.debannir.name.title', { name: name }),
    body: t('md.debannir.name.body'),
    cta: t('md.debannir'),
    danger: false,
  };
}

function MembersTab({
  members,
  banned,
  characters,
  partyId,
  onReload,
}: {
  members: PartyMember[];
  banned: BannedPartyUser[];
  characters: CharacterSummary[];
  partyId: string;
  onReload: (silent?: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const charCountByOwner = new Map<number, number>();
  for (const c of characters) {
    charCountByOwner.set(c.ownerId, (charCountByOwner.get(c.ownerId) ?? 0) + 1);
  }

  async function confirmAction() {
    if (!pending) return;
    setBusy(true);
    setActionError('');
    try {
      if (pending.kind === 'remove') {
        await api.delete(`/api/parties/${partyId}/members/${pending.member.userId}`);
      } else if (pending.kind === 'ban') {
        await api.post(`/api/parties/${partyId}/bans`, { userId: pending.member.userId });
      } else {
        await api.delete(`/api/parties/${partyId}/bans/${pending.user.userId}`);
      }
      setPending(null);
      await onReload(true);
    } catch (err: any) {
      if (err.response?.status === 404) {
        // Race: someone left (or was banned) between load and confirm.
        setPending(null);
        await onReload(true);
      } else {
        setActionError(t('md.action.impossible.verifie.la.connexion'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-400">{t('md.retirer.libere.le.siege.le.code')}</p>
      <div className="card divide-y divide-parchment-100">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 max-w-full truncate font-medium text-ink-800">
                  {m.displayName}
                </span>
                <span className="min-w-0 max-w-full truncate text-xs text-ink-400">
                  @{m.username}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    m.role === 'gm' ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-700'
                  }`}
                >
                  {m.role === 'gm' ? t('role.md') : t('role.joueur')}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">
                {t('party.compteurs.personnage', { count: charCountByOwner.get(m.userId) ?? 0 })} ·{' '}
                {t('md.a.la.table.depuis', { since: sinceLabel(m.joinedAt) })}
              </p>
            </div>
            {m.role === 'player' && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="rounded px-3 py-2.5 text-xs font-medium text-ink-400 transition-colors hover:bg-parchment-100 hover:text-blood-600"
                  onClick={() => {
                    setActionError('');
                    setPending({ kind: 'remove', member: m });
                  }}
                  aria-label={t('md.retirer.m.displayname.de.la.table', {
                    m_displayName: m.displayName,
                  })}
                >
                  {t('md.retirer')}
                </button>
                <button
                  type="button"
                  className="rounded px-3 py-2.5 text-xs font-medium text-ink-400 transition-colors hover:bg-parchment-100 hover:text-red-600"
                  onClick={() => {
                    setActionError('');
                    setPending({ kind: 'ban', member: m });
                  }}
                  aria-label={t('md.bannir.m.displayname.de.ce.groupe', {
                    m_displayName: m.displayName,
                  })}
                >
                  {t('md.bannir')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {banned.length > 0 && (
        <div>
          <h3 className="section-title">
            {t('md.bannis')}{' '}
            <span className="text-sm font-normal text-ink-400">({banned.length})</span>
          </h3>
          <div className="card divide-y divide-parchment-100">
            {banned.map((u) => (
              <div key={u.userId} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 max-w-full truncate font-medium text-ink-600">
                      {u.displayName}
                    </span>
                    <span className="min-w-0 max-w-full truncate text-xs text-ink-400">
                      @{u.username}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {t('md.banni.depuis', { since: sinceLabel(u.bannedAt) })}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded px-3 py-2.5 text-xs font-medium text-ink-700 transition-colors hover:bg-parchment-100 hover:text-blood-600"
                  onClick={() => {
                    setActionError('');
                    setPending({ kind: 'unban', user: u });
                  }}
                  aria-label={t('md.debannir.u.displayname', { u_displayName: u.displayName })}
                >
                  {t('md.debannir')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <Modal
          open={!!pending}
          onClose={() => !busy && setPending(null)}
          title={actionCopy(pending, t).title}
        >
          <p className="mb-4 text-sm text-ink-500">{actionCopy(pending, t).body}</p>
          {actionError && <div className="mb-3 text-sm text-red-600">{actionError}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
              className="btn-secondary flex-1"
            >
              {t('md.annuler')}
            </button>
            <button
              type="button"
              onClick={confirmAction}
              disabled={busy}
              className={`btn-primary flex-1 ${actionCopy(pending, t).danger ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              {busy ? '…' : actionCopy(pending, t).cta}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TransactionsTab({ transactions }: { transactions: Transaction[] }) {
  const { t } = useTranslation();
  if (transactions.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title={t('md.aucune.transaction')}
        hint={t('md.les.modifications.d.inventaire')}
      />
    );
  }
  const reasonLabels: Record<string, string> = {
    add: t('md.journal.ajout'),
    adjust: t('md.journal.ajustement'),
    remove: t('md.journal.retrait'),
    'transfer-in': t('md.journal.transfert.recu'),
    'transfer-out': t('md.journal.transfert.donne'),
    'consume-food': t('md.journal.repas.consomme'),
    'consume-water': t('md.journal.eau.bue'),
    item: t('md.journal.objet'),
  };
  return (
    <div className="card divide-y divide-parchment-100">
      {transactions.map((tx) => (
        <div key={tx.id} className="p-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 truncate font-medium">{tx.itemName}</span>
              <span className="shrink-0 text-sm text-ink-400">× {Math.abs(tx.deltaQty)}</span>
            </span>
            <div className="truncate text-xs text-ink-400">
              {reasonLabels[tx.reason] || tx.reason}
              {tx.actorName ? ` · ${t('md.par', { name: tx.actorName })}` : ''}
              {' · '}
              {new Date(tx.at).toLocaleString(appLocale(), {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </div>
          </div>
          <span
            className={`shrink-0 text-sm font-mono font-semibold ${
              tx.deltaQty > 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {tx.deltaQty > 0 ? '+' : ''}
            {tx.deltaQty}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomItemsTab({ partyId }: { partyId: string }) {
  const { t } = useTranslation();
  const [customItems, setCustomItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  // Party setting: may players create items themselves? + member names to
  // attribute each item to its author.
  const [playersCreate, setPlayersCreate] = useState<boolean | null>(null);
  const [memberNames, setMemberNames] = useState<Map<number, string>>(new Map());
  const [togglingPlayersCreate, setTogglingPlayersCreate] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('custom');
  const [weight, setWeight] = useState('');
  const [desc, setDesc] = useState('');
  // Illustration : stagée ici, envoyée à l'enregistrement (jamais au choix).
  const [imageValue, setImageValue] = useState<ItemImageValue>(EMPTY_ITEM_IMAGE);
  // Mini-châssis de la liste → visionneuse plein écran (rev capturée à
  // l'ouverture : l'URL change si le fichier a changé entre-temps).
  const [viewingImage, setViewingImage] = useState<{
    id: number;
    name: string;
    rev: string | null;
  } | null>(null);
  // Toast ciblé (échec d'envoi de l'illustration après un enregistrement réussi).
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'error') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const loadCustomItems = useCallback(async () => {
    try {
      const res = await api.get('/api/items', {
        params: { partyId, source: 'custom', limit: 200 },
      });
      setCustomItems(res.data.items || []);
    } catch {
      setCustomItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadCustomItems();
  }, [loadCustomItems]);

  // Party setting + member display names (to attribute items to authors).
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/parties/${partyId}`)
      .then((res: any) => {
        if (cancelled) return;
        setPlayersCreate(!!res.data.party.playersCreateItems);
        setMemberNames(new Map(res.data.members.map((m: any) => [m.userId, m.displayName])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const togglePlayersCreate = async () => {
    if (playersCreate === null || togglingPlayersCreate) return;
    const next = !playersCreate;
    setTogglingPlayersCreate(true);
    try {
      await api.patch(`/api/parties/${partyId}`, { playersCreateItems: next });
      setPlayersCreate(next);
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    } finally {
      setTogglingPlayersCreate(false);
    }
  };

  useSyncEvent(
    (event) => {
      if (event.partyId === Number(partyId) && event.action === 'custom-item') {
        loadCustomItems();
      }
    },
    [partyId],
  );

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCategory('custom');
    setWeight('');
    setDesc('');
    setImageValue(EMPTY_ITEM_IMAGE);
    setError('');
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setName(item.name);
    setCategory(item.category);
    setWeight(item.weightKg !== null ? String(item.weightKg) : '');
    setDesc(item.description || '');
    setImageValue(EMPTY_ITEM_IMAGE); // l'illustration existante s'affiche via son URL
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    if (!name.trim()) {
      setError(t('md.le.nom.est.requis'));
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: name.trim(),
      category,
      weightKg: weight ? parseFloat(weight) : null,
      description: desc.trim() || null,
    };
    try {
      let itemId = editing?.id as number | undefined;
      if (editing) {
        await api.patch(`/api/items/${editing.id}`, payload);
      } else {
        const res = await api.post(`/api/parties/${partyId}/items`, payload);
        itemId = res.data.item.id;
      }
      // Séquencement illustration : l'image part à l'enregistrement. Si elle
      // échoue, l'objet reste créé/sauvegardé — toast ciblé, jamais de perte
      // silencieuse (le MD réessaie depuis Modifier).
      if (itemId != null) {
        try {
          if (imageValue.staged) {
            const form = new FormData();
            form.append('image', imageValue.staged.blob, 'illustration.jpg');
            // L'instance axios force Content-Type: application/json — laisser le
            // navigateur poser la boundary multipart (sinon FST_INVALID_MULTIPART).
            await api.put(`/api/items/${itemId}/image`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
          } else if (imageValue.removed) {
            await api.delete(`/api/items/${itemId}/image`);
          }
        } catch {
          pushToast(t('md.illustration.non.envoyee'));
        }
      }
      setShowModal(false);
      setImageValue(EMPTY_ITEM_IMAGE);
      await loadCustomItems();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/items/${id}`);
      await loadCustomItems();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title">
          {t('md.objets.personnalises')}{' '}
          <span className="text-ink-400 text-sm font-normal">({customItems.length})</span>
        </h3>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          {t('md.ajouter')}
        </button>
      </div>

      {/* Autonomy switch: players create missing items from their inventory
          search; everything lands here for review and later edits. */}
      <div className="card p-3 flex items-start gap-2.5">
        <input
          id="gm-players-create-items"
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-blood-600"
          checked={playersCreate ?? false}
          onChange={togglePlayersCreate}
          disabled={playersCreate === null || togglingPlayersCreate}
        />
        <label htmlFor="gm-players-create-items" className="text-sm font-medium text-ink-700">
          {t('md.les.joueurs.peuvent.creer.des.objets')}
          <span className="mt-0.5 block text-xs font-normal text-ink-400">
            {t('md.depuis.la.recherche.de.leur.inventaire')}
          </span>
        </label>
      </div>

      {loadingItems ? (
        <p className="text-sm text-ink-400 animate-pulse">{t('md.chargement')}</p>
      ) : customItems.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon="✨"
            title={t('md.aucun.objet.personnalise')}
            hint={t('md.cree.des.objets.non.srd')}
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {customItems.map((item) => (
            <li key={item.id} className="card p-3 flex items-start gap-3">
              {/* Mini-châssis 40px : le MD vérifie une illustration sans ouvrir
                  l'éditeur — et préchauffe le cache de la visionneuse. */}
              {item.hasImage ? (
                <button
                  type="button"
                  onClick={() =>
                    setViewingImage({
                      id: item.id,
                      name: item.name,
                      rev: item.imageRev ?? null,
                    })
                  }
                  className="shrink-0 overflow-hidden rounded-md border border-parchment-200"
                  aria-label={t('md.agrandir.l.illustration.de.item.name', {
                    item_name: item.name,
                  })}
                >
                  <img
                    src={itemImageUrl(item.id, item.imageRev)}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 object-cover"
                  />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 max-w-full truncate font-medium text-ink-800">
                    {item.name}
                  </span>
                  <CategoryBadge category={item.category} />
                  {item.weightKg !== null && (
                    <span className="text-xs text-ink-400">{item.weightKg} kg</span>
                  )}
                  {item.createdBy !== null && (
                    <span className="text-xs text-ink-400">
                      {t('md.par', {
                        name: memberNames.get(item.createdBy) ?? t('md.un.joueur'),
                      })}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-ink-500 mt-1">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="text-ink-400 hover:text-blood-600 text-sm p-1"
                  aria-label={t('md.modifier')}
                >
                  ✎
                </button>
                <ConfirmButton
                  onConfirm={() => remove(item.id)}
                  className="text-ink-400 hover:text-red-500 text-sm p-1 rounded-full transition-colors"
                  armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
                  title={t('md.supprimer.item.name.item.name', {
                    item_name: item.name,
                  })}
                  ariaLabel={t('md.supprimer.item.name.item.name', {
                    item_name: item.name,
                  })}
                  confirmChildren={t('md.supprimer.confirmer')}
                >
                  ×
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Floating + button */}
      {customItems.length > 0 && (
        <Fab onClick={openCreate} label={t('md.ajouter.un.objet.personnalise')} mobileOnly />
      )}

      {/* Create/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('md.modifier.l.objet') : t('md.nouvel.objet.personnalise')}
      >
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('md.nom')}</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('md.epee.du.heros')}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label">{t('md.categorie')}</span>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="custom">{t('md.personnalise')}</option>
                <option value="weapon">{t('md.arme')}</option>
                <option value="armor">{t('md.armure')}</option>
                <option value="gear">{t('md.equipement')}</option>
                <option value="magic">{t('md.objet.magique')}</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">{t('md.poids.kg')}</span>
            <input
              type="number"
              step="0.01"
              className="input"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0.5"
            />
          </label>
          <label className="block">
            <span className="label">{t('md.description')}</span>
            <textarea
              className="input"
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('md.une.lame.brillant.d.une.lumiere')}
            />
          </label>
          {/* L'image est le second contenu de l'objet — après la description,
            avant l'erreur et les boutons (plan objets-illustrations §5.1). */}
          <ItemImageField
            value={imageValue}
            onChange={setImageValue}
            existingItemId={editing?.id}
            existingRev={editing?.imageRev ?? undefined}
            existingName={editing ? editing.name : undefined}
          />
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editing ? t('common.save') : t('md.ajouter.au.catalogue')}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              {t('md.annuler')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Visionneuse plein écran (mini-châssis de la liste) */}
      {viewingImage && (
        <ItemImageViewer
          name={viewingImage.name}
          src={itemImageUrl(viewingImage.id, viewingImage.rev ?? undefined)}
          onClose={() => setViewingImage(null)}
        />
      )}

      {/* Toast ciblé (échec d'envoi de l'illustration après un save réussi) */}
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </div>
  );
}
