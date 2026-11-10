import type {
  BannedPartyUser,
  CharacterSummary,
  PartyDetail,
  PartyMember,
} from '@table-sync/shared';
import {
  abilityModifier,
  passivePerception,
  proficiencyBonus,
  skillProficiencyLevel,
} from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { GmaAssistantTab } from '../components/GmaAssistantTab';

import {
  EmptyState,
  ErrorMsg,
  Modal,
  SkeletonCard,
  SkeletonRegion,
  TabButton,
} from '../components/ui';
import { appLocale } from '../i18n';
import { useResyncOnReconnect, useSyncEvent } from '../sync';
import { activeCharactersFirst, parseSqliteDate } from '../utils';
import { Glyph } from '../components/Glyph';

import { type RosterOverviewEntry, type Transaction } from './GmDashboardPage-lib';

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

  // Journal SEUL : les écritures d'inventaire (ajustement, don, bourse)
  // écrivent des transactions mais ne bougent NI le roster NI les réglages —
  // ne re-téléchargeons pas le détail de groupe (~150 Ko) pour ça.
  const loadTransactions = useCallback(async () => {
    if (!partyId) return;
    try {
      const txRes = await api.get(`/api/parties/${partyId}/transactions`);
      setTransactions(txRes.data.transactions);
    } catch {
      /* silencieux — le journal garde ses données */
    }
  }, [partyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time sync — CHIRURGICAL (vocabulaire v2) : ce dashboard ne vit que
  // de personnages/inventaire/journal. character:change 'sheet' (notes/sorts/
  // traits, privés) ne touche ni le roster ni le journal → ignoré ; les
  // écritures d'inventaire ne rafraîchissent que le JOURNAL ; 'coins' écrit
  // des transactions sans bouger le résumé. Sur character:change ciblé, seule
  // la fiche du personnage changé est aussi rafraîchie (bump → CharactersTab).
  const currentPartyId = Number(partyId);
  // Rattrapage de reconnexion : page à état local, les événements du trou ne
  // seront jamais rejoués — rechargement silencieux de ce que la page rend.
  useResyncOnReconnect(() => void load(true));
  const [syncedCharacter, setSyncedCharacter] = useState<{ id: number; n: number } | null>(null);
  useSyncEvent(
    (event) => {
      if (event.partyId !== currentPartyId) return;
      if (
        event.type === 'character:change' &&
        event.characterId != null &&
        !event.action?.includes('delete')
      ) {
        if (event.action === 'sheet') return; // données privées de fiche
        if (event.action === 'coins') {
          loadTransactions();
          return;
        }
        load(true); // silent — roster stats (HP, niveaux, repos)
        setSyncedCharacter({ id: event.characterId, n: (syncedCharacter?.n ?? 0) + 1 });
        return;
      }
      if (event.type === 'party:change') {
        // Seuls les événements qui bougent le ROSTER ou les RÉGLAGES : les
        // actions 'custom-item'/'npcs' n'écrivent ni transactions ni membres
        // (l'onglet Objets custom a son propre écouteur sur 'custom-item').
        if (
          event.action === 'stats' ||
          event.action === 'join' ||
          event.action === 'remove' ||
          event.action === 'ban' ||
          event.action === 'unban'
        ) {
          load(true);
        }
        return;
      }
      if (event.type === 'inventory:change') {
        // Chaque geste d'inventaire écrit au journal ET peut bouger la CA /
        // le poids d'une carte (équipement, ration) — la vue d'ensemble est
        // ETaguée, la re-validation inchangée repart en 304.
        loadTransactions();
        if (event.characterId != null) {
          setSyncedCharacter({ id: event.characterId, n: (syncedCharacter?.n ?? 0) + 1 });
        }
      }
    },
    [currentPartyId, syncedCharacter],
  );

  if (loading)
    return (
      // Fantôme de l'onglet Personnages (défaut) : la grille de cartes.
      <SkeletonRegion
        label={t('md.chargement')}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((n) => (
          <SkeletonCard key={n} lines={3} />
        ))}
      </SkeletonRegion>
    );
  if (error) return <ErrorMsg message={error} onRetry={() => void load()} />;
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
        <CharactersTab
          characters={party.characters}
          partyId={partyId!}
          onReload={load}
          syncedCharacter={tab === 'characters' ? syncedCharacter : null}
        />
      )}

      {tab === 'transactions' && <TransactionsTab transactions={transactions} />}

      {tab === 'custom' && <CustomItemsTab partyId={partyId!} party={party} />}

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
        <>
          <RenamePartySection
            key={party.party.id + ':' + party.party.name}
            partyId={partyId!}
            name={party.party.name}
            onRenamed={() => load(true)}
          />
          <DisbandPartySection
            partyId={partyId!}
            name={party.party.name}
            onDone={() => navigate('/parties')}
          />
        </>
      )}
    </div>
  );
}

/**
 * Renommer le groupe — PATCH /api/parties/:id { name }. Répond un 400 si le
 * nom est vide/blanc ; l'événement 'stats' du PATCH rattrape les autres pages
 * de groupe ouvertes. Pas de confirmation : réversible en re-renommant.
 */
function RenamePartySection({
  partyId,
  name,
  onRenamed,
}: {
  partyId: string;
  name: string;
  onRenamed: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function rename() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/parties/${partyId}`, { name: trimmed });
      onRenamed();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.renommage.impossible'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h3 className="section-title">{t('md.renommer.le.groupe')}</h3>
      <label htmlFor="gm-rename-party" className="label mt-3 block">
        {t('md.nom.du.groupe')}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="gm-rename-party"
          className="input"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              rename();
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          onClick={rename}
          disabled={busy || !draft.trim() || draft.trim() === name}
          className="btn-primary shrink-0 disabled:opacity-50"
        >
          {busy ? '…' : t('common.save')}
        </button>
      </div>
      {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
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
          {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
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
              className="btn-primary flex-1 bg-red-600 hover:brightness-90 disabled:opacity-50"
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
  syncedCharacter,
}: {
  characters: CharacterSummary[];
  partyId: string;
  onReload: () => void;
  /** Coup de pouce ciblé : un character:change/inventory:change ne rafraîche
   *  que la vue d'ensemble (une petite requête ETaguée). */
  syncedCharacter: { id: number; n: number } | null;
}) {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<CharacterSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [overview, setOverview] = useState<Record<number, RosterOverviewEntry>>({});

  // UNE requête pour tout le groupe : le serveur rend par personnage les 4
  // chiffres dérivés (CA effective, % de charge, ration, eau pleine) —
  // l'ancienne forme téléchargeait l'inventaire ENTIER de chaque joueur.
  const loadOverview = useCallback(async () => {
    try {
      const res = await api.get<{ overview: RosterOverviewEntry[] }>(
        `/api/parties/${partyId}/roster-overview`,
      );
      const map: Record<number, RosterOverviewEntry> = {};
      for (const o of res.data.overview ?? []) map[o.characterId] = o;
      setOverview(map);
    } catch {
      /* silencieux — les cartes gardent leurs données */
    }
  }, [partyId]);

  // Clé = ids joints (pas l'identité du tableau) : un rechargement du groupe
  // qui ne change PAS le roster ne re-demande pas la vue d'ensemble.
  const rosterKey = characters.map((c) => c.id).join(',');
  useEffect(() => {
    if (characters.length > 0) void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rosterKey résume `characters` — une identité de tableau neuve sans changement de roster ne doit pas re-demander la vue
  }, [rosterKey, loadOverview]);

  // Refetch ciblé (character:change / inventory:change d'un joueur) : la vue
  // d'ensemble est ETaguée — inchangée, la requête repart en 304.
  useEffect(() => {
    if (!syncedCharacter) return;
    void loadOverview();
  }, [syncedCharacter, loadOverview]);

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
        icon={<Glyph name="mage" />}
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
        const ov = overview[c.id];
        const dexMod = abilityModifier(c.dexterity ?? 10);
        const wisMod = abilityModifier(c.wisdom ?? 10);
        const level = c.level ?? 1;
        const prof = proficiencyBonus(level);
        const perceptionLevel = skillProficiencyLevel(c, 'perception');
        const pp = passivePerception(wisMod, prof, perceptionLevel);
        // CA : l'override manuel prime, puis la valeur PRÉCALCULÉE du serveur
        // (roster-overview), puis l'approximation DEX à nu.
        const effectiveAC = c.armorClassOverride ?? ov?.ac ?? 10 + dexMod;
        const weightPct = ov ? Math.min(100, Math.round(ov.weightPct ?? 0)) : 0;
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

        // Rations / eau pleine : comptées côté serveur (mêmes règles — les
        // gourdes « empty » ne comptent pas).
        const foodCount = ov?.foodCount ?? 0;
        const fullWaterCount = ov?.fullWaterCount ?? 0;

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
                className="min-w-0 flex-1 flex items-center gap-2 min-h-11"
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
                className="text-ink-400 hover:text-red-700 text-sm shrink-0 inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-red-50"
                aria-label={t('md.supprimer.c.name', { c_name: c.name })}
                title={t('md.supprimer.le.personnage')}
              >
                <Glyph name="trash" />
              </button>
            </div>

            {/* HP bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span className="inline-flex items-center gap-0.5">
                  <Glyph name="heart" /> {t('md.pv')}
                </span>
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
            {ov?.weightKg != null && ov?.capacityKg != null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
                  <span className="inline-flex items-center gap-0.5">
                    <Glyph name="pack" /> {t('md.sac')}
                  </span>
                  <span>
                    {ov.weightKg.toFixed(1)} / {ov.capacityKg.toFixed(0)} kg ({weightPct}%)
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
              <span className="font-medium inline-flex items-center gap-0.5">
                <Glyph name="shield" /> {t('md.ca')}{' '}
                <span className="text-ink-800 font-bold">{effectiveAC}</span>
              </span>
              <span className="font-medium inline-flex items-center gap-0.5">
                <Glyph name="eye" /> {t('md.pp')}{' '}
                <span className="text-ink-800 font-bold">{pp}</span>
              </span>
              <span className="text-ink-500 inline-flex items-center gap-0.5">
                <Glyph name="food" /> {foodCount}
              </span>
              <span className="text-ink-500 inline-flex items-center gap-0.5">
                <Glyph name="water" /> {fullWaterCount}
              </span>
              {c.exhaustion > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${exhColor}`} />
                  <span className="text-ink-500">{t('md.epuis', { niveau: c.exhaustion })}</span>
                </span>
              )}
              {c.currentHp <= 0 && (
                <span className="text-red-700 font-medium">
                  <Glyph name="water" className="text-blood" /> {c.deathSaveSuccesses}/3{' '}
                  <Glyph name="check" /> · {c.deathSaveFailures}/3 <Glyph name="close" />
                </span>
              )}
            </div>

            {/* Conditions */}
            {c.conditions && c.conditions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {c.conditions.map((cond) => (
                  <span
                    key={cond}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-blood-50 text-blood-500 border border-blood-200"
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
              className="btn-primary flex-1 bg-red-600 hover:brightness-90"
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
  const d = parseSqliteDate(sqliteDate);
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
                  className="rounded px-3 py-2.5 text-xs font-medium text-ink-400 transition-colors hover:bg-parchment-100 hover:text-blood-500"
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
                  className="rounded px-3 py-2.5 text-xs font-medium text-ink-400 transition-colors hover:bg-parchment-100 hover:text-red-700"
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
                  className="shrink-0 rounded px-3 py-2.5 text-xs font-medium text-ink-700 transition-colors hover:bg-parchment-100 hover:text-blood-500"
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
          {actionError && <div className="mb-3 text-sm text-red-700">{actionError}</div>}
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
              className={`btn-primary flex-1 ${actionCopy(pending, t).danger ? 'bg-red-600 hover:brightness-90' : ''}`}
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
        icon={<Glyph name="list" />}
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
              {parseSqliteDate(tx.at).toLocaleString(appLocale(), {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </div>
          </div>
          <span
            className={`shrink-0 text-sm font-mono font-semibold ${
              tx.deltaQty > 0 ? 'text-green-700' : 'text-red-700'
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

import { CustomItemsTab } from './gm/CustomItemsTab';
