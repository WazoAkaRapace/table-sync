import type {
  BannedPartyUser,
  CharacterInventory,
  CharacterSummary,
  PartyDetail,
  PartyMember,
} from '@dnd-inventory/shared';
import {
  abilityModifier,
  computeAC,
  passivePerception,
  proficiencyBonus,
  skillProficiencyLevel,
} from '@dnd-inventory/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { itemImageUrl } from '../api';
import { useAuth } from '../auth';
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
  type Toast,
  ToastStack,
} from '../components/ui';
import { useSyncEvent } from '../sync';
import { plural } from '../utils';

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
  const { partyId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'characters' | 'transactions' | 'custom' | 'members'>(
    'characters',
  );

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
        setError(err.response?.data?.error || 'Erreur');
      } finally {
        setLoading(false);
      }
    },
    [partyId],
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
  if (!party) return <ErrorMsg message="Groupe introuvable" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-ink-400">{party.party.name}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-parchment-200">
        <TabButton active={tab === 'characters'} onClick={() => setTab('characters')}>
          Personnages ({party.characters.length})
        </TabButton>
        <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>
          Journal ({transactions.length})
        </TabButton>
        <TabButton active={tab === 'custom'} onClick={() => setTab('custom')}>
          Objets custom
        </TabButton>
        <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
          Joueurs ({party.members.length})
        </TabButton>
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

      {/* Danger zone — visible to the GM only (the API enforces it too) */}
      {party.members.some((m) => m.userId === user?.id && m.role === 'gm') && (
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
      setError('Dissolution impossible — vérifie la connexion.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-red-200 bg-red-50/60 p-4">
      <h3 className="section-title text-red-700">Zone de danger</h3>
      <p className="mt-1 text-xs text-ink-500">
        Dissoudre « {name} » supprime définitivement la table et tout ce qui s'y rattache :
        personnages et leurs fiches, combats, PNJ, objets personnalisés, journal. Aucun retour en
        arrière n'est possible.
      </p>
      <button
        type="button"
        className="mt-3 rounded border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-600 hover:text-white"
        onClick={() => {
          setConfirmName('');
          setError('');
          setOpen(true);
        }}
      >
        Dissoudre le groupe…
      </button>

      {open && (
        <Modal
          open={open}
          onClose={() => !busy && setOpen(false)}
          title={`Dissoudre « ${name} » ?`}
        >
          <p className="mb-3 text-sm text-ink-500">
            Tout le contenu du groupe sera supprimé, pour le MD comme pour les joueurs. Cette action
            est définitive.
          </p>
          <label className="block">
            <span className="label">Tape le nom du groupe ({name}) pour confirmer</span>
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
              Annuler
            </button>
            <button
              type="button"
              onClick={disband}
              disabled={busy || !nameMatches}
              className="btn-primary flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Dissolution…' : 'Dissoudre définitivement'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blood-600 text-blood-700'
          : 'border-transparent text-ink-400 hover:text-ink-700'
      }`}
    >
      {children}
    </button>
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
        title="Aucun personnage"
        hint="Les joueurs doivent créer leurs personnages."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {characters.map((c) => {
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
                        title="Caché des autres joueurs par son propriétaire — inactif en combat"
                      >
                        Caché
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-ink-400">
                    {c.classes && c.classes.length > 1
                      ? `${c.classes.map((e) => `${e.classKey} ${e.level}`).join('/')} `
                      : c.characterClass
                        ? `${c.characterClass} `
                        : ''}
                    {c.level ? `Niv. ${c.level}` : ''}
                    {c.race ? ` · ${c.race}` : ''}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setDeleteTarget(c)}
                className="text-ink-400 hover:text-red-600 text-sm shrink-0 p-1"
                aria-label={`Supprimer ${c.name}`}
                title="Supprimer le personnage"
              >
                🗑
              </button>
            </div>

            {/* HP bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span>❤️ PV</span>
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
                  <span>🎒 Sac</span>
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
                🛡 CA <span className="text-ink-800 font-bold">{effectiveAC}</span>
              </span>
              <span className="font-medium">
                👁 PP <span className="text-ink-800 font-bold">{pp}</span>
              </span>
              <span className="text-ink-500">🍖 {foodCount}</span>
              <span className="text-ink-500">💧 {fullWaterCount}</span>
              {c.exhaustion > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${exhColor}`} />
                  <span className="text-ink-500">Épuis. {c.exhaustion}</span>
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
          title={`Supprimer ${deleteTarget.name} ?`}
        >
          <p className="text-sm text-ink-500 mb-4">
            Cette action est irréversible. Tout l'inventaire et la monnaie seront perdus.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="btn-secondary flex-1"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Suppression…' : 'Supprimer'}
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
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

type PendingAction =
  | { kind: 'remove'; member: PartyMember }
  | { kind: 'ban'; member: PartyMember }
  | { kind: 'unban'; user: BannedPartyUser };

function actionCopy(p: PendingAction): {
  title: string;
  body: string;
  cta: string;
  danger: boolean;
} {
  if (p.kind === 'remove') {
    const name = p.member.displayName;
    return {
      title: `Retirer ${name} de la table ?`,
      body: `${name} perd l'accès au groupe et à ses fiches. Ses personnages restent au groupe — visibles depuis la Table du MD et en combat. Il pourra revenir avec le code d'invitation.`,
      cta: 'Retirer',
      danger: false,
    };
  }
  if (p.kind === 'ban') {
    const name = p.member.displayName;
    return {
      title: `Bannir ${name} ?`,
      body: `${name} quitte la table et le code d'invitation ne fonctionnera plus pour lui. Ses personnages restent au groupe. Tu pourras le débannir plus tard.`,
      cta: 'Bannir',
      danger: true,
    };
  }
  const name = p.user.displayName;
  return {
    title: `Débannir ${name} ?`,
    body: `Le code d'invitation fonctionnera à nouveau pour lui. Il ne revient pas à la table pour autant — il devra rejoindre avec le code.`,
    cta: 'Débannir',
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
        setActionError('Action impossible — vérifie la connexion.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-400">
        Retirer libère le siège — le code d'invitation reste valable. Bannir verrouille le code.
      </p>
      <div className="card divide-y divide-parchment-100">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-ink-800">{m.displayName}</span>
                <span className="text-xs text-ink-400">@{m.username}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    m.role === 'gm' ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-700'
                  }`}
                >
                  {m.role === 'gm' ? 'MD' : 'Joueur'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">
                {plural(charCountByOwner.get(m.userId) ?? 0, 'personnage')} · à la table depuis{' '}
                {sinceLabel(m.joinedAt)}
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
                  aria-label={`Retirer ${m.displayName} de la table`}
                >
                  Retirer
                </button>
                <button
                  type="button"
                  className="rounded px-3 py-2.5 text-xs font-medium text-ink-400 transition-colors hover:bg-parchment-100 hover:text-red-600"
                  onClick={() => {
                    setActionError('');
                    setPending({ kind: 'ban', member: m });
                  }}
                  aria-label={`Bannir ${m.displayName} de ce groupe`}
                >
                  Bannir
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {banned.length > 0 && (
        <div>
          <h3 className="section-title">
            Bannis <span className="text-sm font-normal text-ink-400">({banned.length})</span>
          </h3>
          <div className="card divide-y divide-parchment-100">
            {banned.map((u) => (
              <div key={u.userId} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-ink-600">{u.displayName}</span>
                    <span className="text-xs text-ink-400">@{u.username}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    banni depuis {sinceLabel(u.bannedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded px-3 py-2.5 text-xs font-medium text-ink-700 transition-colors hover:bg-parchment-100 hover:text-blood-600"
                  onClick={() => {
                    setActionError('');
                    setPending({ kind: 'unban', user: u });
                  }}
                  aria-label={`Débannir ${u.displayName}`}
                >
                  Débannir
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
          title={actionCopy(pending).title}
        >
          <p className="mb-4 text-sm text-ink-500">{actionCopy(pending).body}</p>
          {actionError && <div className="mb-3 text-sm text-red-600">{actionError}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
              className="btn-secondary flex-1"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={confirmAction}
              disabled={busy}
              className={`btn-primary flex-1 ${actionCopy(pending).danger ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              {busy ? '…' : actionCopy(pending).cta}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TransactionsTab({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="Aucune transaction"
        hint="Les modifications d'inventaire apparaîtront ici."
      />
    );
  }
  const reasonLabels: Record<string, string> = {
    add: 'Ajout',
    adjust: 'Ajustement',
    remove: 'Retrait',
    'transfer-in': 'Transfert reçu',
    'transfer-out': 'Transfert donné',
    'consume-food': 'Repas consommé',
    'consume-water': 'Eau bue',
    item: 'Objet',
  };
  return (
    <div className="card divide-y divide-parchment-100">
      {transactions.map((t) => (
        <div key={t.id} className="p-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="font-medium">{t.itemName}</span>
            <span className="text-sm text-ink-400 ml-2">× {Math.abs(t.deltaQty)}</span>
            <div className="text-xs text-ink-400">
              {reasonLabels[t.reason] || t.reason}
              {t.actorName ? ` · par ${t.actorName}` : ''}
              {' · '}
              {new Date(t.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          </div>
          <span
            className={`text-sm font-mono font-semibold ${t.deltaQty > 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            {t.deltaQty > 0 ? '+' : ''}
            {t.deltaQty}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomItemsTab({ partyId }: { partyId: string }) {
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
  // Mini-châssis de la liste → visionneuse plein écran.
  const [viewingImage, setViewingImage] = useState<{ id: number; name: string } | null>(null);
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
      setError(err.response?.data?.error || 'Erreur');
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
    setName(item.nameFr || item.name);
    setCategory(item.category);
    setWeight(item.weightKg !== null ? String(item.weightKg) : '');
    setDesc(item.description || '');
    setImageValue(EMPTY_ITEM_IMAGE); // l'illustration existante s'affiche via son URL
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Le nom est requis');
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
          pushToast('Illustration non envoyée — réessaie depuis Modifier');
        }
      }
      setShowModal(false);
      setImageValue(EMPTY_ITEM_IMAGE);
      await loadCustomItems();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/items/${id}`);
      await loadCustomItems();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title">
          Objets personnalisés{' '}
          <span className="text-ink-400 text-sm font-normal">({customItems.length})</span>
        </h3>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          + Ajouter
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
          Les joueurs peuvent créer des objets
          <span className="mt-0.5 block text-xs font-normal text-ink-400">
            Depuis la recherche de leur inventaire, un objet introuvable se crée en une touche — il
            rejoint cette liste pour relecture et retouche.
          </span>
        </label>
      </div>

      {loadingItems ? (
        <p className="text-sm text-ink-400 animate-pulse">Chargement…</p>
      ) : customItems.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon="✨"
            title="Aucun objet personnalisé"
            hint="Crée des objets non-SRD : trésors spéciaux, objets de quête, armes uniques…"
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
                  onClick={() => setViewingImage({ id: item.id, name: item.nameFr || item.name })}
                  className="shrink-0 overflow-hidden rounded-md border border-parchment-200"
                  aria-label={`Agrandir l'illustration de ${item.nameFr || item.name}`}
                >
                  <img
                    src={itemImageUrl(item.id)}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 object-cover"
                  />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink-800">{item.nameFr || item.name}</span>
                  <CategoryBadge category={item.category} />
                  {item.weightKg !== null && (
                    <span className="text-xs text-ink-400">{item.weightKg} kg</span>
                  )}
                  {item.createdBy !== null && (
                    <span className="text-xs text-ink-400">
                      par {memberNames.get(item.createdBy) ?? 'un joueur'}
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
                  aria-label="Modifier"
                >
                  ✎
                </button>
                <ConfirmButton
                  onConfirm={() => remove(item.id)}
                  className="text-ink-400 hover:text-red-500 text-sm p-1 rounded-full transition-colors"
                  armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
                  title={`Supprimer ${item.nameFr || item.name}`}
                  ariaLabel={`Supprimer ${item.nameFr || item.name}`}
                  confirmChildren="Supprimer ?"
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
        <Fab onClick={openCreate} label="Ajouter un objet personnalisé" mobileOnly />
      )}

      {/* Create/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? "Modifier l'objet" : 'Nouvel objet personnalisé'}
      >
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Nom *</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Épée du Héros"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label">Catégorie</span>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="custom">Personnalisé</option>
                <option value="weapon">Arme</option>
                <option value="armor">Armure</option>
                <option value="gear">Équipement</option>
                <option value="magic">Objet magique</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">Poids (kg)</span>
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
            <span className="label">Description</span>
            <textarea
              className="input"
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Une lame brillant d'une lumière dorée…"
            />
          </label>
          {/* L'image est le second contenu de l'objet — après la description,
            avant l'erreur et les boutons (plan objets-illustrations §5.1). */}
          <ItemImageField
            value={imageValue}
            onChange={setImageValue}
            existingItemId={editing?.id}
            existingName={editing ? editing.nameFr || editing.name : undefined}
          />
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editing ? 'Enregistrer' : '+ Ajouter au catalogue'}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              Annuler
            </button>
          </div>
        </div>
      </Modal>

      {/* Visionneuse plein écran (mini-châssis de la liste) */}
      {viewingImage && (
        <ItemImageViewer
          name={viewingImage.name}
          src={itemImageUrl(viewingImage.id)}
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
