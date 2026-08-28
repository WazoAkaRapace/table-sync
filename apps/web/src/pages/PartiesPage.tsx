/*
 * LE REGISTRE — direction contract (seed 7ab2b22c, assigned surface candidate 6)
 * THESIS: The welcome page is a scribe's party register — ruled entries under a
 * head rule, not a card grid; the most recently opened group (API-ordered via
 * party_members.last_opened_at) is the expanded current entry.
 * OWN-WORLD: parchment ground, ink Cinzel names, Roman ordinals (blood on the
 * current entry, ink on the rest), MD/Joueur stamps, mono invite chips.
 * STORY: A player logs in, sees their table by name, and is inside in one tap;
 * a groupless visitor meets the two ruled entry paths (create / join) inline.
 * FIRST VIEWPORT: centered display title, double head rule, entry I expanded
 * with roster line and GM code stamp, compact entries beneath, quiet foot actions.
 * FORM: ledger register, single measure, mobile-first, light-only.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md
 */

import type { EncumbranceMode, PartyListRow, PartyRole } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, LoadingSpinner, Modal } from '../components/ui';
import { copyText, formatSince, plural, toRoman } from '../utils';

// ---------- Small helpers ----------

function RoleBadge({ role, large = false }: { role: PartyRole; large?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full font-medium ${
        large ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'
      } ${role === 'gm' ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-700'}`}
    >
      {role === 'gm' ? 'MD' : 'Joueur'}
    </span>
  );
}

// ---------- Forms (shared by the virgin page and the foot modals) ----------

/** Server errors are English machine strings — surface French, state-specific copy. */
function joinError(err: any): string {
  const status = err.response?.status;
  if (status === 404) return 'Code invalide — redemande les six lettres à ton MD.';
  if (status === 403) return 'Tu as été banni de ce groupe — demande au MD de te débannir.';
  if (status === 409) return 'Tu fais déjà partie de ce groupe.';
  if (status === 400) return 'Entre les six lettres du code.';
  if (status === 429)
    return err.response?.data?.error || 'Trop d’essais — réessaie dans un instant.';
  return 'Impossible de rejoindre — vérifie la connexion.';
}

function createError(err: any): string {
  const status = err.response?.status;
  if (status === 400) return 'Donne un nom au groupe.';
  if (status === 429)
    return err.response?.data?.error || 'Trop d’essais — réessaie dans un instant.';
  return 'Création impossible — vérifie la connexion.';
}

const MODE_HELPERS: Record<EncumbranceMode, string> = {
  variant: 'Le personnage est ralenti à FOR×2.5 kg, FOR×5 kg, et immobilisé à FOR×7.5 kg.',
  standard: 'Le personnage est immobilisé au-delà de FOR×7.5 kg. Aucun palier intermédiaire.',
  slots: 'Chaque objet compte comme un emplacement, indépendamment de son poids.',
};

function CreatePartyForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<EncumbranceMode>('variant');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/api/parties', { name, encumbranceMode: mode });
      setName('');
      onCreated();
    } catch (err: any) {
      setError(createError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-1 flex-col gap-4">
      <div>
        <label className="label" htmlFor="create-party-name">
          {t('parties.nom.du.groupe')}
        </label>
        <input
          id="create-party-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('parties.les.heros.de.chult')}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="create-party-mode">
          Mode d'encombrement
        </label>
        <select
          id="create-party-mode"
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value as EncumbranceMode)}
        >
          <option value="variant">{t('parties.variante.3.paliers.de.poids.recommande')}</option>
          <option value="standard">{t('parties.standard.un.seul.seuil.max')}</option>
          <option value="slots">{t('parties.emplacements.ignorant.le.poids')}</option>
        </select>
        <p className="mt-1.5 text-xs text-ink-400">{MODE_HELPERS[mode]}</p>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {t('parties.creer.le.groupe')}
      </button>
    </form>
  );
}

function JoinPartyForm({ onJoined }: { onJoined: () => void }) {
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/api/parties/join', { inviteCode });
      setInviteCode('');
      onJoined();
    } catch (err: any) {
      setError(joinError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-1 flex-col gap-4">
      <div>
        <label className="label" htmlFor="join-party-code">
          Code d'invitation
        </label>
        <input
          id="join-party-code"
          className="input text-center font-mono text-xl uppercase tracking-[0.3em]"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="ABCDEF"
          autoComplete="off"
          required
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button type="submit" className="btn-primary" disabled={busy}>
        Rejoindre
      </button>
    </form>
  );
}

// ---------- The register ----------

export default function PartiesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [parties, setParties] = useState<PartyListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/api/parties');
      setParties(res.data.parties);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function copyCode(partyId: number, code: string) {
    copyText(code).then((ok) => {
      const setter = ok ? setCopiedId : setCopyFailedId;
      setter(partyId);
      setTimeout(() => setter((cur) => (cur === partyId ? null : cur)), 2000);
    });
  }

  if (loading) return <LoadingSpinner label="Ouverture du registre…" />;
  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3">
        <ErrorMsg message="Le registre n'a pas pu être ouvert — vérifie la connexion." />
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={load}>
            {t('parties.reessayer')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Virgin page: the guided choice ----------
  if (parties.length === 0) {
    return (
      <div className="register-rise mx-auto w-full max-w-3xl">
        <header className="pb-6 pt-2 text-center">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Mes groupes</h1>
          <p className="mt-1.5 text-ink-500">
            Bienvenue{user ? `, ${user.displayName}` : ''}. Ton registre est encore vierge —
            ouvre-le d'une de ces deux façons.
          </p>
        </header>

        {/* Ledger double head rule — the same rule the register opens with */}
        <div aria-hidden="true">
          <div className="border-t-2 border-parchment-400" />
          <div className="mt-[3px] border-t border-parchment-300" />
        </div>

        {/* Two ruled entry paths — flat on the parchment, split by a rule, no cards */}
        <div className="grid divide-y divide-parchment-300 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <section className="flex flex-col py-6 sm:py-8 sm:pr-10">
            <h2 className="section-title">{t('parties.creer.un.groupe')}</h2>
            <p className="mt-1 text-sm text-ink-400">{t('parties.tu.animeras.la.table.en.tant')}</p>
            <CreatePartyForm onCreated={load} />
          </section>
          <section className="flex flex-col py-6 sm:py-8 sm:pl-10">
            <h2 className="section-title">{t('parties.rejoindre.avec.un.code')}</h2>
            <p className="mt-1 text-sm text-ink-400">
              {t('parties.ta.table.te.donne.six.lettres')}
            </p>
            <JoinPartyForm onJoined={load} />
          </section>
        </div>

        {/* Closing rule — the register's page ends ruled */}
        <div aria-hidden="true" className="border-b border-parchment-200" />
      </div>
    );
  }

  // ---------- The register with entries ----------
  const [current, ...older] = parties;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Mes groupes</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          {plural(parties.length, 'groupe')} au registre
        </p>
      </header>

      {/* Ledger double head rule */}
      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      <ol className="list-none">
        {/* Entry I — the current (most recent) group, expanded */}
        <li
          className="register-rise border-b border-parchment-200"
          style={{ animationDelay: '60ms' }}
        >
          <Link
            to={`/party/${current.id}`}
            className="-mx-3 block rounded-lg px-3 py-6 transition-colors hover:bg-parchment-100/70"
            aria-label={t('parties.ouvrir.le.groupe.current.name', { current_name: current.name })}
          >
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="w-10 shrink-0 pt-1 text-right font-display text-2xl text-blood-500"
              >
                {toRoman(1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-2xl font-bold leading-tight">{current.name}</h2>
                  <RoleBadge role={current.role} large />
                </div>
                <p className="mt-1.5 text-sm text-ink-400">
                  MD : {current.gmName || '—'} · {plural(current.memberCount, 'joueur')} ·{' '}
                  {plural(current.characterCount, 'personnage')} · {formatSince(current.createdAt)}
                </p>
                {current.characterNames.length > 0 && (
                  <p className="mt-4 border-t border-parchment-200 pt-4 leading-relaxed text-ink-700">
                    {current.characterNames.join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </Link>
          {current.role === 'gm' && (
            <div className="flex flex-wrap items-center gap-2 pb-6 pl-14 text-sm">
              <span className="text-ink-400">Code d'invitation</span>
              <code className="rounded-lg border border-parchment-200 bg-parchment-100 px-2.5 py-1 font-mono font-semibold tracking-[0.2em]">
                {current.inviteCode}
              </code>
              <button
                type="button"
                className="text-blood-600 hover:underline"
                onClick={() => copyCode(current.id, current.inviteCode)}
                aria-label={t('parties.copier.le.code.d.invitation.current', {
                  current_inviteCode: current.inviteCode,
                })}
              >
                {copiedId === current.id
                  ? 'Copié ✓'
                  : copyFailedId === current.id
                    ? 'Copie impossible'
                    : 'Copier'}
              </button>
            </div>
          )}
        </li>

        {/* Older entries — compact ruled rows */}
        {older.map((p, i) => (
          <li
            key={p.id}
            className="register-rise border-b border-parchment-200"
            style={{ animationDelay: `${Math.min(i + 2, 5) * 60}ms` }}
          >
            <Link
              to={`/party/${p.id}`}
              className="-mx-3 flex items-start gap-4 rounded-lg px-3 py-4 transition-colors hover:bg-parchment-100/70"
              aria-label={t('parties.ouvrir.le.groupe.p.name', { p_name: p.name })}
            >
              <span
                aria-hidden="true"
                className="w-10 shrink-0 pt-0.5 text-right font-display text-lg text-ink-400"
              >
                {toRoman(i + 2)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="truncate font-display text-lg font-semibold leading-snug">
                    {p.name}
                  </h2>
                  <RoleBadge role={p.role} />
                </div>
                <p className="mt-0.5 truncate text-sm text-ink-400">
                  MD : {p.gmName || '—'} · {plural(p.characterCount, 'personnage')}
                  {p.role === 'gm' && (
                    <>
                      {' · '}
                      <code className="font-mono font-semibold tracking-[0.15em]">
                        {p.inviteCode}
                      </code>
                    </>
                  )}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>

      {/* Register foot — quiet ruled actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-6">
        <button
          type="button"
          className="btn-ghost text-ink-500"
          onClick={() => setShowCreate(true)}
        >
          {t('parties.nouveau.groupe')}
        </button>
        <span aria-hidden="true" className="text-parchment-400">
          ·
        </span>
        <button type="button" className="btn-ghost text-ink-500" onClick={() => setShowJoin(true)}>
          {t('parties.rejoindre.par.code')}
        </button>
      </div>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t('parties.nouveau.groupe')}
      >
        <CreatePartyForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      </Modal>
      <Modal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        title={t('parties.rejoindre.un.groupe')}
      >
        <JoinPartyForm
          onJoined={() => {
            setShowJoin(false);
            load();
          }}
        />
      </Modal>
    </div>
  );
}
