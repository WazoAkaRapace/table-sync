/*
 * GM Assistant — l'onglet du MD (Table du MD). Trois états en cascade :
 * la clé du compte, la liaison groupe ↔ campagne (existante ou créée depuis
 * le groupe — l'unique écriture lourde, donc une modale qui liste exactement
 * ce qui partira chez GM Assistant), puis la vie de la liaison : rafraîchir
 * les séances, resynchroniser les personnages (lot upsert, suppression
 * uniquement explicite sur un orphelin), délier.
 */
import type {
  GmaAccountStatus,
  GmaCampaignSummary,
  GmaCharacterDiff,
  GmaInitResult,
  GmaLinkStatus,
  GmaSyncCharactersResult,
} from '@table-sync/shared';
import { GMA_PC_FIELD_LABELS_FR } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { Chip, ConfirmButton, Modal } from './ui';

const GMA_APP_URL = 'https://gmassistant.app';

function errMessage(err: any, t: (key: string) => string): string {
  return err?.response?.data?.message || err?.response?.data?.error || t('gma.erreur');
}

function ScopeChip({ scope }: { scope: 'read' | 'full_access' | null }) {
  const { t } = useTranslation();
  if (scope === 'full_access')
    return (
      <Chip tone="blue" soft>
        {t('gma.acces.complet')}
      </Chip>
    );
  if (scope === 'read')
    return (
      <Chip tone="red" soft>
        {t('gma.lecture.seule')}
      </Chip>
    );
  return (
    <Chip tone="amber" soft>
      {t('gma.portee.inconnue')}
    </Chip>
  );
}

/** « joué par » preview line for the init + resync creation rows. */
/** Inline preview of a possibly long, multi-line value (description carries the identity). */
function inlineClip(value: string, max = 72): string {
  const flat = value.replaceAll('\n', ' · ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function CandidateRow({
  name,
  playedBy,
  description,
  checked,
  onToggle,
}: {
  name: string;
  playedBy: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const inputId = `gma-char-${name}-${playedBy}`;
  return (
    <li className="flex items-start gap-2.5 border-b border-parchment-200 py-2 last:border-b-0">
      <input
        id={inputId}
        type="checkbox"
        className="mt-1 h-4 w-4 accent-blood-600"
        checked={checked}
        onChange={onToggle}
      />
      <label htmlFor={inputId} className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-ink-800">{name}</span>
        <span className="mt-0.5 block text-xs text-ink-400">
          {t('gma.joue.par', { playedBy: playedBy })} · {inlineClip(description, 96)}
        </span>
      </label>
    </li>
  );
}

export function GmaAssistantTab({
  partyId,
  partyName,
  characters,
}: {
  partyId: string;
  partyName: string;
  /** Non-hidden sheet summaries — hidden (secret prep) never leaves the app. */
  characters: Array<{ id: number; name: string; ownerName: string | null; hidden: boolean }>;
}) {
  const { t } = useTranslation();
  const [account, setAccount] = useState<GmaAccountStatus | null>(null);
  const [link, setLink] = useState<GmaLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Key entry (first use, replacement, or re-entry after expiry).
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [keyError, setKeyError] = useState('');
  // Campaign picker (link an existing one).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<GmaCampaignSummary[] | null>(null);
  const [pickerError, setPickerError] = useState('');
  // Init (create FROM the group).
  const [initOpen, setInitOpen] = useState(false);
  // Resync diff.
  const [syncOpen, setSyncOpen] = useState(false);
  const [diff, setDiff] = useState<GmaSyncCharactersResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [createIds, setCreateIds] = useState<Set<number>>(new Set());
  const [applyResult, setApplyResult] = useState<GmaSyncCharactersResult | null>(null);
  // Chronique refresh feedback.
  const [refreshNote, setRefreshNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [accRes, linkRes] = await Promise.all([
        api.get('/api/gma/status'),
        api.get(`/api/parties/${partyId}/gma/link`),
      ]);
      setAccount(accRes.data);
      setLink(linkRes.data);
      setError('');
    } catch (err: any) {
      setError(errMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [partyId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleChars = characters.filter((c) => !c.hidden);

  async function saveKey() {
    if (!keyValue.trim()) {
      setKeyError(t('gma.colle.la.cle'));
      return;
    }
    setBusy(true);
    setKeyError('');
    try {
      await api.put('/api/gma/key', { apiKey: keyValue.trim() });
      setKeyValue('');
      setShowKeyForm(false);
      await load();
    } catch (err: any) {
      setKeyError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    try {
      await api.delete('/api/gma/key');
      await load();
    } catch (err: any) {
      setError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  function openPicker() {
    setPickerOpen(true);
    setCampaigns(null);
    setPickerError('');
    api
      .get(`/api/parties/${partyId}/gma/campaigns`)
      .then((res: any) => setCampaigns(res.data.campaigns))
      .catch((err: any) => setPickerError(errMessage(err, t)));
  }

  async function linkCampaign(id: string) {
    setBusy(true);
    setPickerError('');
    try {
      await api.post(`/api/parties/${partyId}/gma/link`, { campaignId: id });
      setPickerOpen(false);
      await load();
    } catch (err: any) {
      setPickerError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function openSync() {
    setSyncOpen(true);
    setApplyResult(null);
    setDiffError('');
    setDiffLoading(true);
    try {
      const res = await api.post(`/api/parties/${partyId}/gma/characters/sync`, { dryRun: true });
      const d = res.data as GmaSyncCharactersResult;
      setDiff(d);
      setCreateIds(new Set(d.toCreate.map((c) => c.characterId)));
    } catch (err: any) {
      setDiffError(errMessage(err, t));
    } finally {
      setDiffLoading(false);
    }
  }

  async function applySync() {
    setBusy(true);
    setDiffError('');
    try {
      const res = await api.post(`/api/parties/${partyId}/gma/characters/sync`, {
        createCharacterIds: [...createIds],
      });
      setApplyResult(res.data);
      // Refresh the diff behind the results (convergence proof).
      const d = await api.post(`/api/parties/${partyId}/gma/characters/sync`, { dryRun: true });
      setDiff(d.data);
      setCreateIds(new Set((d.data as GmaCharacterDiff).toCreate.map((c) => c.characterId)));
    } catch (err: any) {
      setDiffError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrphan(gmaPcId: string) {
    setDiffError('');
    try {
      await api.delete(`/api/parties/${partyId}/gma/characters/${gmaPcId}`);
      const d = await api.post(`/api/parties/${partyId}/gma/characters/sync`, { dryRun: true });
      setDiff(d.data);
    } catch (err: any) {
      setDiffError(errMessage(err, t));
    }
  }

  async function refreshSessions() {
    setBusy(true);
    setRefreshNote('');
    try {
      const res = await api.get(`/api/parties/${partyId}/gma/sessions`, { params: { refresh: 1 } });
      setRefreshNote(t('gma.seances.synchronisees', { count: res.data.sessions.length }));
    } catch (err: any) {
      setRefreshNote(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await api.delete(`/api/parties/${partyId}/gma/link`);
      await load();
    } catch (err: any) {
      setError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-400 animate-pulse">{t('gma.chargement')}</p>;
  if (error) return <div className="card p-4 text-sm text-red-600">{error}</div>;

  const keyed = !!account?.linked;
  const linked = !!link?.linked;
  const keyExpired = linked && !link?.accountOk;
  const pendingDiffCount = diff ? diff.toCreate.length + diff.toUpdate.length : 0;

  return (
    <div className="space-y-4">
      <h3 className="section-title">GM Assistant</h3>
      <p className="text-xs text-ink-400">
        {t('gma.intro.pre')}{' '}
        <a href={GMA_APP_URL} target="_blank" rel="noreferrer" className="underline">
          gmassistant.app
        </a>{' '}
        {t('gma.intro.post')}
      </p>

      {/* ---- Compte : la clé ---- */}
      <div className="card p-4 space-y-3">
        {keyed ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink-800">{account?.account?.email}</span>
            <ScopeChip scope={account?.account?.scope ?? null} />
            <span className="flex-1" />
            <button
              type="button"
              className="btn-ghost text-xs px-2.5 py-1"
              onClick={() => setShowKeyForm((v) => !v)}
              disabled={busy}
            >
              {t('gma.remplacer.la.cle')}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs px-2.5 py-1 text-red-600"
              onClick={removeKey}
              disabled={busy}
            >
              {t('gma.oublier')}
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink-500">{t('gma.cree.un.compte.sur.gmassistant.app')}</p>
        )}

        {(!keyed || showKeyForm) && (
          <div className="space-y-2">
            <label htmlFor="gma-key" className="label">
              {t('gma.cle.api.gm.assistant')}
            </label>
            <input
              id="gma-key"
              type="password"
              className="input font-mono"
              placeholder="gma_…"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              autoComplete="off"
            />
            {keyError && <p className="text-xs text-red-600">{keyError}</p>}
            <button type="button" className="btn-primary" onClick={saveKey} disabled={busy}>
              {busy ? t('gma.verification') : t('gma.connecter')}
            </button>
          </div>
        )}
      </div>

      {/* ---- Liaison ---- */}
      {keyed && !linked && (
        <div className="card p-4 space-y-3">
          <h4 className="font-display text-base font-semibold text-ink-800">
            {t('gma.liaison.du.groupe', { partyName: partyName })}
          </h4>
          <p className="text-sm text-ink-500">{t('gma.deux.chemins.creer.une.campagne.toute')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => setInitOpen(true)}>
              {t('gma.creer.depuis.ce.groupe')}
            </button>
            <button type="button" className="btn-secondary" onClick={openPicker}>
              {t('gma.lier.une.campagne.existante')}
            </button>
          </div>
        </div>
      )}

      {keyed && linked && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-semibold text-ink-900">
              {link?.campaign?.title}
            </span>
            <ScopeChip scope={account?.account?.scope ?? null} />
            <span className="flex-1" />
            <a
              href={GMA_APP_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-400 underline"
            >
              {t('gma.ouvrir.sur.gmassistant.app')}
            </a>
          </div>

          {keyExpired && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {t('gma.cle.expiree.ou.oubliee.la.chronique')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={refreshSessions}
              disabled={busy}
            >
              {t('gma.rafraichir.les.seances')}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={openSync}
              disabled={busy || keyExpired}
            >
              ⇄ {t('gma.resynchroniser.les.personnages')}
              {pendingDiffCount > 0 && (
                <span className="ml-1.5 rounded-full bg-blood-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {pendingDiffCount}
                </span>
              )}
            </button>
            <span className="flex-1" />
            <ConfirmButton
              onConfirm={unlink}
              confirmChildren={t('gma.delier.confirmer')}
              className="btn-ghost text-xs px-2.5 py-1 text-red-600"
            >
              {t('gma.delier.le.groupe')}
            </ConfirmButton>
          </div>
          {refreshNote && <p className="text-xs text-ink-500">{refreshNote}</p>}
          <p className="text-[11px] text-ink-400">{t('gma.delier.ne.supprime.rien.chez.gm')}</p>
        </div>
      )}

      {/* ---- Modales ---- */}
      {initOpen && (
        <InitModal
          partyId={partyId}
          partyName={partyName}
          characters={visibleChars}
          onClose={() => setInitOpen(false)}
          onDone={() => {
            setInitOpen(false);
            load();
          }}
        />
      )}

      {pickerOpen && (
        <Modal
          open
          onClose={() => !busy && setPickerOpen(false)}
          title={t('gma.lier.une.campagne.existante')}
        >
          {campaigns === null && !pickerError && (
            <p className="text-sm text-ink-400 animate-pulse">
              {t('gma.chargement.de.tes.campagnes')}
            </p>
          )}
          {pickerError && <p className="text-sm text-red-600">{pickerError}</p>}
          {campaigns !== null && campaigns.length === 0 && (
            <p className="text-sm text-ink-500">{t('gma.aucune.campagne.sur.ton.compte.gm')}</p>
          )}
          {campaigns !== null && campaigns.length > 0 && (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink-800 transition-colors hover:bg-parchment-100"
                    onClick={() => linkCampaign(c.id)}
                    disabled={busy}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {syncOpen && (
        <Modal
          open
          onClose={() => !busy && setSyncOpen(false)}
          title={t('gma.resynchroniser.les.personnages')}
        >
          {diffLoading && (
            <p className="text-sm text-ink-400 animate-pulse">{t('gma.comparaison')}</p>
          )}
          {diffError && <p className="mb-2 text-sm text-red-600">{diffError}</p>}
          {applyResult && (
            <div className="mb-3 rounded-md bg-parchment-100 px-3 py-2 text-xs text-ink-700">
              {applyResult.created.length > 0 &&
                `${t('gma.resultat.crees', { n: applyResult.created.length })} — `}
              {applyResult.updated.length > 0 &&
                `${t('gma.resultat.mis.a.jour', { n: applyResult.updated.length })} — `}
              {applyResult.failed.length > 0 ? (
                <span className="text-red-600">
                  {t('gma.resultat.echecs', { n: applyResult.failed.length })}{' '}
                  {applyResult.failed.map((f) => `${f.name} (${f.reason})`).join(' · ')}
                </span>
              ) : (
                t('gma.resultat.termine')
              )}
            </div>
          )}
          {diff && (
            <SyncDiffBody
              diff={diff}
              createIds={createIds}
              setCreateIds={setCreateIds}
              onDeleteOrphan={deleteOrphan}
            />
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => setSyncOpen(false)}
              disabled={busy}
            >
              {t('gma.fermer')}
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={applySync}
              disabled={
                busy ||
                !diff ||
                (diff.toCreate.filter((c) => createIds.has(c.characterId)).length === 0 &&
                  diff.toUpdate.length === 0)
              }
            >
              {busy ? t('gma.application') : t('gma.appliquer')}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-400">{t('gma.le.lot.ne.supprime.jamais.rien')}</p>
        </Modal>
      )}
    </div>
  );
}

/** The one-time creation FROM the group — the only heavy write we ever do. */
function InitModal({
  partyId,
  partyName,
  characters,
  onClose,
  onDone,
}: {
  partyId: string;
  partyName: string;
  characters: Array<{ id: number; name: string; ownerName: string | null }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState<Set<number>>(new Set(characters.map((c) => c.id)));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GmaInitResult | null>(null);

  const selected = characters.filter((c) => checked.has(c.id));

  async function create() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/api/parties/${partyId}/gma/init`, {
        characterIds: selected.map((c) => c.id),
      });
      setResult(res.data);
    } catch (err: any) {
      setError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onDone} title={t('gma.campagne.creee')}>
        <p className="text-sm text-ink-700">
          {t('gma.campagne.existe', {
            title: result.campaign.title,
            personnages: t('party.compteurs.personnage', { count: result.created.length }),
          })}
        </p>
        {result.failed.length > 0 && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {t('gma.echecs.a.completer')}{' '}
            {result.failed.map((f) => `${f.name} — ${f.reason}`).join(' · ')}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-400">
          {t('gma.la.chronique.est.disponible.pour.toute')}
        </p>
        <button type="button" className="btn-primary mt-4 w-full" onClick={onDone}>
          {t('gma.termine')}
        </button>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={
        confirming ? t('gma.confirmer.la.creation') : t('gma.creer.la.campagne.depuis.ce.groupe')
      }
    >
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-700">{t('gma.chez.gm.assistant.il.sera.cree')}</p>
          <ul className="space-y-1 rounded-md bg-parchment-100 px-3 py-2 text-sm text-ink-800">
            <li className="font-medium">{t('gma.campagne.ligne', { partyName: partyName })}</li>
            {selected.map((c) => (
              <li key={c.id}>
                {t('gma.perso.ligne', { name: c.name, owner: c.ownerName ?? '—' })}
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              {t('gma.retour')}
            </button>
            <button type="button" className="btn-primary flex-1" onClick={create} disabled={busy}>
              {busy ? t('gma.creation') : t('gma.creer')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            {t('gma.une.campagne.sera.creee', { partyName: partyName })}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-500">
              {t('gma.personnages.selectionnes', { count: selected.length })}
            </span>
            <button
              type="button"
              className="btn-ghost text-xs px-2 py-1"
              onClick={() =>
                setChecked(
                  selected.length === characters.length
                    ? new Set()
                    : new Set(characters.map((c) => c.id)),
                )
              }
            >
              {selected.length === characters.length
                ? t('gma.tout.decocher')
                : t('gma.tout.selectionner')}
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {characters.map((c) => (
              <CandidateRow
                key={c.id}
                name={c.name}
                playedBy={c.ownerName ?? '—'}
                description=""
                checked={checked.has(c.id)}
                onToggle={() =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              />
            ))}
          </ul>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            {t('gma.continuer')}
          </button>
        </div>
      )}
    </Modal>
  );
}

function SyncDiffBody({
  diff,
  createIds,
  setCreateIds,
  onDeleteOrphan,
}: {
  diff: GmaSyncCharactersResult;
  createIds: Set<number>;
  setCreateIds: (ids: Set<number>) => void;
  onDeleteOrphan: (gmaPcId: string) => void;
}) {
  const { t } = useTranslation();
  const quiet =
    diff.toCreate.length === 0 &&
    diff.toUpdate.length === 0 &&
    diff.orphans.length === 0 &&
    diff.gmaOnly.length === 0;
  return (
    <div className="space-y-4 text-sm">
      {quiet && (
        <p className="rounded-md bg-parchment-100 px-3 py-2 text-ink-600">
          {t('gma.personnages.a.jour', {
            personnages: t('party.compteurs.personnage', { count: diff.upToDate }),
          })}
        </p>
      )}
      {diff.toCreate.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            {t('gma.a.creer')}
          </h4>
          <ul>
            {diff.toCreate.map((c) => (
              <CandidateRow
                key={c.characterId}
                name={c.name}
                playedBy={c.playedBy}
                description={c.description}
                checked={createIds.has(c.characterId)}
                onToggle={() =>
                  setCreateIds(
                    new Set(
                      createIds.has(c.characterId)
                        ? [...createIds].filter((id) => id !== c.characterId)
                        : [...createIds, c.characterId],
                    ),
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
      {diff.toUpdate.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            {t('gma.a.mettre.a.jour')}
          </h4>
          <ul className="space-y-1.5">
            {diff.toUpdate.map((u) => (
              <li
                key={u.characterId}
                className="border-b border-parchment-200 py-1.5 last:border-b-0"
              >
                <p className="font-medium text-ink-800">{u.name}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {u.changes.map((ch) => (
                    <li key={ch.field} className="text-xs text-ink-500">
                      {GMA_PC_FIELD_LABELS_FR[ch.field] ?? ch.field} : {inlineClip(ch.from)} →{' '}
                      <span className="font-medium text-ink-800">{inlineClip(ch.to)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.orphans.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-red-500">
            {t('gma.fiches.supprimees.ici')}
          </h4>
          <ul className="space-y-1.5">
            {diff.orphans.map((o) => (
              <li
                key={o.gmaPcId}
                className="flex items-center justify-between gap-3 border-b border-parchment-200 py-1.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-ink-700">
                  {o.nameAtSync}
                  <span className="block text-[11px] text-ink-400">
                    {t('gma.encore.present.chez.gm.assistant')}
                  </span>
                </span>
                <ConfirmButton
                  onConfirm={() => onDeleteOrphan(o.gmaPcId)}
                  confirmChildren={t('gma.supprimer.chez.gm.assistant')}
                  className="btn-ghost shrink-0 text-xs px-2.5 py-1 text-red-600"
                >
                  {t('gma.supprimer')}
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.gmaOnly.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            {t('gma.geres.sur.gm.assistant')}
          </h4>
          <p className="mt-1 text-xs text-ink-400">
            {diff.gmaOnly.map((g) => g.name ?? t('gma.sans.nom')).join(' · ')} —{' '}
            {t('gma.ne.deviennent.pas.des.fiches')}
          </p>
        </section>
      )}
      {!quiet && diff.upToDate > 0 && (
        <p className="text-xs text-ink-400">
          + {t('party.compteurs.personnage', { count: diff.upToDate })} {t('gma.a.jour')}
        </p>
      )}
    </div>
  );
}
