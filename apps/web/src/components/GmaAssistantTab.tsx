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
} from '@dnd-inventory/shared';
import { GMA_PC_FIELD_LABELS_FR } from '@dnd-inventory/shared';
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { plural } from '../utils';
import { Chip, ConfirmButton, Modal } from './ui';

const GMA_APP_URL = 'https://gmassistant.app';

function errMessage(err: any): string {
  return err?.response?.data?.message || err?.response?.data?.error || 'Erreur';
}

function ScopeChip({ scope }: { scope: 'read' | 'full_access' | null }) {
  if (scope === 'full_access')
    return (
      <Chip tone="blue" soft>
        Accès complet
      </Chip>
    );
  if (scope === 'read')
    return (
      <Chip tone="red" soft>
        Lecture seule
      </Chip>
    );
  return (
    <Chip tone="amber" soft>
      Portée inconnue
    </Chip>
  );
}

/** « joué par » preview line for the init + resync creation rows. */
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
          joué par {playedBy} · {description}
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
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleChars = characters.filter((c) => !c.hidden);

  async function saveKey() {
    if (!keyValue.trim()) {
      setKeyError('Colle la clé GM Assistant (elle commence par « gma_ »).');
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
      setKeyError(errMessage(err));
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
      setError(errMessage(err));
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
      .catch((err: any) => setPickerError(errMessage(err)));
  }

  async function linkCampaign(id: string) {
    setBusy(true);
    setPickerError('');
    try {
      await api.post(`/api/parties/${partyId}/gma/link`, { campaignId: id });
      setPickerOpen(false);
      await load();
    } catch (err: any) {
      setPickerError(errMessage(err));
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
      setDiffError(errMessage(err));
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
      setDiffError(errMessage(err));
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
      setDiffError(errMessage(err));
    }
  }

  async function refreshSessions() {
    setBusy(true);
    setRefreshNote('');
    try {
      const res = await api.get(`/api/parties/${partyId}/gma/sessions`, { params: { refresh: 1 } });
      setRefreshNote(
        `${plural(res.data.sessions.length, 'séance')} synchronisée${
          res.data.sessions.length > 1 ? 's' : ''
        }`,
      );
    } catch (err: any) {
      setRefreshNote(errMessage(err));
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
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-400 animate-pulse">Chargement…</p>;
  if (error) return <div className="card p-4 text-sm text-red-600">{error}</div>;

  const keyed = !!account?.linked;
  const linked = !!link?.linked;
  const keyExpired = linked && !link?.accountOk;
  const pendingDiffCount = diff ? diff.toCreate.length + diff.toUpdate.length : 0;

  return (
    <div className="space-y-4">
      <h3 className="section-title">GM Assistant</h3>
      <p className="text-xs text-ink-400">
        Relie ce groupe à une campagne{' '}
        <a href={GMA_APP_URL} target="_blank" rel="noreferrer" className="underline">
          gmassistant.app
        </a>{' '}
        pour lire ses résumés de séance dans la Chronique — et y créer les personnages de la table.
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
              Remplacer la clé
            </button>
            <button
              type="button"
              className="btn-ghost text-xs px-2.5 py-1 text-red-600"
              onClick={removeKey}
              disabled={busy}
            >
              Oublier
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink-500">
            Crée un compte sur gmassistant.app, puis une clé API (réglages → Developer). Elle reste
            sur ce serveur, chiffrée — jamais dans le navigateur.
          </p>
        )}

        {(!keyed || showKeyForm) && (
          <div className="space-y-2">
            <label htmlFor="gma-key" className="label">
              Clé API GM Assistant
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
              {busy ? 'Vérification…' : 'Connecter'}
            </button>
          </div>
        )}
      </div>

      {/* ---- Liaison ---- */}
      {keyed && !linked && (
        <div className="card p-4 space-y-3">
          <h4 className="font-display text-base font-semibold text-ink-800">
            Liaison du groupe « {partyName} »
          </h4>
          <p className="text-sm text-ink-500">
            Deux chemins : créer une campagne toute prête depuis ce groupe, ou relier une campagne
            déjà existante sur ton compte.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => setInitOpen(true)}>
              ＋ Créer depuis ce groupe
            </button>
            <button type="button" className="btn-secondary" onClick={openPicker}>
              Lier une campagne existante
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
              Ouvrir sur gmassistant.app ↗
            </a>
          </div>

          {keyExpired && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              Clé expirée ou oubliée — la Chronique sert son dernier cachet. Ressaisis une clé pour
              relancer la synchronisation.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={refreshSessions}
              disabled={busy}
            >
              ↺ Rafraîchir les séances
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={openSync}
              disabled={busy || keyExpired}
            >
              ⇄ Resynchroniser les personnages
              {pendingDiffCount > 0 && (
                <span className="ml-1.5 rounded-full bg-blood-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {pendingDiffCount}
                </span>
              )}
            </button>
            <span className="flex-1" />
            <ConfirmButton
              onConfirm={unlink}
              confirmChildren="Délier ?"
              className="btn-ghost text-xs px-2.5 py-1 text-red-600"
            >
              Délier le groupe
            </ConfirmButton>
          </div>
          {refreshNote && <p className="text-xs text-ink-500">{refreshNote}</p>}
          <p className="text-[11px] text-ink-400">
            Délier ne supprime rien chez GM Assistant — la campagne et ses personnages restent
            là-bas.
          </p>
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
          title="Lier une campagne existante"
        >
          {campaigns === null && !pickerError && (
            <p className="text-sm text-ink-400 animate-pulse">Chargement de tes campagnes…</p>
          )}
          {pickerError && <p className="text-sm text-red-600">{pickerError}</p>}
          {campaigns !== null && campaigns.length === 0 && (
            <p className="text-sm text-ink-500">
              Aucune campagne sur ton compte GM Assistant — crée-en une depuis ce groupe.
            </p>
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
          title="Resynchroniser les personnages"
        >
          {diffLoading && <p className="text-sm text-ink-400 animate-pulse">Comparaison…</p>}
          {diffError && <p className="mb-2 text-sm text-red-600">{diffError}</p>}
          {applyResult && (
            <div className="mb-3 rounded-md bg-parchment-100 px-3 py-2 text-xs text-ink-700">
              {applyResult.created.length > 0 && `${applyResult.created.length} créé(s) — `}
              {applyResult.updated.length > 0 && `${applyResult.updated.length} mis à jour — `}
              {applyResult.failed.length > 0 ? (
                <span className="text-red-600">
                  {applyResult.failed.length} échec(s) :{' '}
                  {applyResult.failed.map((f) => `${f.name} (${f.reason})`).join(' · ')}
                </span>
              ) : (
                'terminé ✓'
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
              Fermer
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
              {busy ? 'Application…' : 'Appliquer'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-400">
            Le lot ne supprime jamais rien chez GM Assistant — les orphelins se suppriment un à un,
            sur confirmation.
          </p>
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
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onDone} title="Campagne créée">
        <p className="text-sm text-ink-700">
          « {result.campaign.title} » existe sur GM Assistant avec{' '}
          {plural(result.created.length, 'personnage')}.
        </p>
        {result.failed.length > 0 && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            Échecs (à compléter à la main sur gmassistant.app) :{' '}
            {result.failed.map((f) => `${f.name} — ${f.reason}`).join(' · ')}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-400">
          La Chronique est disponible pour toute la table (annexes du groupe).
        </p>
        <button type="button" className="btn-primary mt-4 w-full" onClick={onDone}>
          Terminé
        </button>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={confirming ? 'Confirmer la création' : 'Créer la campagne depuis ce groupe'}
    >
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-700">Chez GM Assistant, il sera créé :</p>
          <ul className="space-y-1 rounded-md bg-parchment-100 px-3 py-2 text-sm text-ink-800">
            <li className="font-medium">📜 Campagne « {partyName} » (D&D 5e)</li>
            {selected.map((c) => (
              <li key={c.id}>
                ⚔ {c.name} — joué par {c.ownerName ?? '—'}
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
              Retour
            </button>
            <button type="button" className="btn-primary flex-1" onClick={create} disabled={busy}>
              {busy ? 'Création…' : 'Créer'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Une campagne « {partyName} » sera créée sur ton compte GM Assistant, avec les
            personnages cochés (nom + joué par + classe).
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-500">
              {plural(selected.length, 'personnage')} sélectionné{selected.length > 1 ? 's' : ''}
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
              {selected.length === characters.length ? 'Tout décocher' : 'Tout sélectionner'}
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
            Continuer
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
  const quiet =
    diff.toCreate.length === 0 &&
    diff.toUpdate.length === 0 &&
    diff.orphans.length === 0 &&
    diff.gmaOnly.length === 0;
  return (
    <div className="space-y-4 text-sm">
      {quiet && (
        <p className="rounded-md bg-parchment-100 px-3 py-2 text-ink-600">
          {plural(diff.upToDate, 'personnage')} à jour — rien à faire.
        </p>
      )}
      {diff.toCreate.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">À créer</h4>
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
            À mettre à jour
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
                      {GMA_PC_FIELD_LABELS_FR[ch.field] ?? ch.field} : {ch.from} →{' '}
                      <span className="font-medium text-ink-800">{ch.to}</span>
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
            Fiches supprimées ici
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
                    encore présent chez GM Assistant
                  </span>
                </span>
                <ConfirmButton
                  onConfirm={() => onDeleteOrphan(o.gmaPcId)}
                  confirmChildren="Supprimer chez GM Assistant ?"
                  className="btn-ghost shrink-0 text-xs px-2.5 py-1 text-red-600"
                >
                  Supprimer
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.gmaOnly.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Gérés sur GM Assistant
          </h4>
          <p className="mt-1 text-xs text-ink-400">
            {diff.gmaOnly.map((g) => g.name ?? 'sans nom').join(' · ')} — ils ne deviennent pas des
            fiches ici.
          </p>
        </section>
      )}
      {!quiet && diff.upToDate > 0 && (
        <p className="text-xs text-ink-400">+ {plural(diff.upToDate, 'personnage')} à jour</p>
      )}
    </div>
  );
}
