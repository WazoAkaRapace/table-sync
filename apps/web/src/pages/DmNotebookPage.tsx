/*
 * LE CARNET DU MD — direction contract (brief confirmé 2026-09-03)
 * THESIS: chaque contenu parle son dialecte natif du monde — cartes triables
 * pour les notes, registre à cycle de vie pour les quêtes (jumelle du registre
 * des rencontres), grande mesure + points de conduite pour l'horloge ; refuse
 * le dashboard à widgets et le double volet.
 * OWN-WORLD: tête réglée (font-display centré + double règle), onglets maison,
 * le sang porte « maintenant + action primaire » uniquement : « +1 jour » au
 * Calendrier, ordinal de la quête courante ; tout le reste est encre.
 * STORY: le MD prépare (notes, quêtes) et vit le temps de la campagne (jour,
 * semaine, saison, météo, échéances) derrière une porte que les joueurs
 * ne voient pas ; la porte du groupe porte l'horloge en valeur de queue.
 * FIRST VIEWPORT: tête « Carnet du MD » + méta d'horloge sous la double règle,
 * onglets internes, panneau de l'onglet actif ; « +1 jour » unique porte sang.
 * FORM: page-outil à onglets internes (Notes · Quêtes · Calendrier · PNJ),
 * desktop ≥1024 d'abord, mobile dégradé (onglets défilants).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md
 */

import type {
  CampaignCountdown,
  CampaignDay,
  CampaignPayload,
  CampaignSeason,
  CreateDmQuestPayload,
  DmNote,
  DmQuest,
  DmQuestStatus,
  PatchDmQuestPayload,
} from '@table-sync/shared';
import { CAMPAIGN_SEASONS, DM_QUEST_STATUSES } from '@table-sync/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import api from '../api';
import { renderMarkdown } from '../components/markdown';
import { SortableCard, SortableGrid } from '../components/SortableGrid';
import {
  ConfirmButton,
  EmptyState,
  ErrorMsg,
  LoadingSpinner,
  Modal,
  TabButton,
} from '../components/ui';
import { appLocale } from '../i18n';
import { useSyncEvent } from '../sync';
import { toRoman } from '../utils';
import NpcPage from './NpcPage';

type NotebookTab = 'notes' | 'quests' | 'calendar' | 'npcs';

const TABS: NotebookTab[] = ['notes', 'quests', 'calendar', 'npcs'];

type SetCampaign = (updater: (prev: CampaignPayload | null) => CampaignPayload | null) => void;

/** Semaine dérivée — jamais stockée : ⌈jour / 7⌉. */
function weekOf(day: number): number {
  return Math.ceil(day / 7);
}

/** Ordre de lecture du registre des quêtes : en cours, préparation, puis le
 *  registre compact (terminées et échouées coulent ensemble). */
function questTier(status: DmQuestStatus): number {
  if (status === 'active') return 0;
  if (status === 'preparation') return 1;
  return 2;
}

const QUEST_STATUS_GLYPH: Record<DmQuestStatus, string> = {
  active: '🔴',
  preparation: '⚪',
  done: '⚫',
  failed: '⚫',
};

// 🌩️ (U+1F329) et non ⛈️ (U+26C8) pour l'orage : le jumeau à présentation
// emoji native — l'ancien bloc peut rendre en glyphe texte monochrome selon
// la police. Idem ☀️/❄️ ci-dessous : la classe emoji-glyph force la police
// emoji colorée sur la pastille.
const WEATHER_PRESETS: { emoji: string; labelKey: string }[] = [
  { emoji: '☀️', labelKey: 'carnet.cal.meteo.clear' },
  { emoji: '🌧️', labelKey: 'carnet.cal.meteo.rain' },
  { emoji: '🌩️', labelKey: 'carnet.cal.meteo.storm' },
  { emoji: '❄️', labelKey: 'carnet.cal.meteo.snow' },
  { emoji: '🌫️', labelKey: 'carnet.cal.meteo.fog' },
];

interface TabProps {
  campaign: CampaignPayload;
  partyId: string;
  reload: (silent?: boolean) => Promise<void>;
  onError: (msg: string) => void;
  setCampaign: SetCampaign;
}

// ---------- La page ----------

export default function DmNotebookPage() {
  const { t } = useTranslation();
  const { partyId } = useParams<{ partyId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Onglet dérivé de l'URL (?tab=) — le bouton précédent du navigateur
  // revient à l'onglet d'avant, sans état local qui diverge.
  const tabParam = searchParams.get('tab') as NotebookTab | null;
  const tab: NotebookTab = tabParam && TABS.includes(tabParam) ? tabParam : 'notes';

  const [campaign, setCampaignState] = useState<CampaignPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);

  const flash = useCallback((kind: 'success' | 'error', msg: string) => {
    setFeedback({ kind, msg });
    setTimeout(() => setFeedback(null), 2500);
  }, []);
  const onError = useCallback((msg: string) => flash('error', msg), [flash]);

  const load = useCallback(
    async (silent = false) => {
      if (!partyId) return;
      if (!silent) setLoading(true);
      try {
        const res = await api.get(`/api/parties/${partyId}/campaign`);
        setCampaignState(res.data.campaign);
        setError('');
        setForbidden(false);
      } catch (err: any) {
        if (err.response?.status === 403) {
          setForbidden(true);
        } else {
          setError(err.response?.data?.error || t('carnet.erreur.chargement'));
        }
      } finally {
        setLoading(false);
      }
    },
    [partyId, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Multi-appareils MD : l'autre écran du MD refait silence sur chaque écriture.
  // Les joueurs reçoivent l'événement mais n'ont ni porte ni écouteur.
  const currentPartyId = Number(partyId);
  useSyncEvent(
    (event) => {
      if (event.type === 'campaign:change' && event.partyId === currentPartyId) {
        load(true);
      }
    },
    [currentPartyId],
  );

  const setCampaign: SetCampaign = useCallback((updater) => {
    setCampaignState((prev) => (prev === null ? prev : updater(prev)));
  }, []);

  function switchTab(next: NotebookTab) {
    setSearchParams(next === 'notes' ? {} : { tab: next }, { replace: true });
  }

  if (loading) return <LoadingSpinner label={t('carnet.chargement')} />;
  if (forbidden) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 pt-10 text-center">
        <h1 className="font-display text-2xl font-bold">{t('carnet.reserve.md')}</h1>
        <p className="text-sm text-ink-400">{t('carnet.reserve.texte')}</p>
        <div>
          <Link to={`/party/${partyId}`} className="btn-secondary inline-block">
            {t('carnet.retour.groupe')}
          </Link>
        </div>
      </div>
    );
  }
  if (error || !campaign) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3">
        <ErrorMsg message={error || t('carnet.erreur.chargement')} />
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={() => load()}>
            {t('carnet.reessayer')}
          </button>
        </div>
      </div>
    );
  }

  const activeQuests = campaign.quests.filter((q) => q.status === 'active').length;
  const tabProps = { campaign, partyId: partyId!, reload: load, onError, setCampaign };

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Tête réglée — la grammaire des pages-outil. La méta est une région
       *  vivante : « +1 jour » et les changements de statut s'y annoncent. */}
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t('carnet.titre')}</h1>
        <p className="mt-1.5 text-sm text-ink-400" role="status">
          {t('carnet.meta', {
            day: campaign.state.day,
            season: t(`carnet.cal.saison.${campaign.state.season}`),
            count: activeQuests,
          })}
        </p>
      </header>
      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      {/* Onglets internes */}
      <nav
        className="mt-2 flex gap-1 overflow-x-auto no-scrollbar border-b border-parchment-200"
        aria-label={t('carnet.onglets')}
      >
        <TabButton active={tab === 'notes'} onClick={() => switchTab('notes')}>
          {t('carnet.tab.notes', { count: campaign.notes.length })}
        </TabButton>
        <TabButton active={tab === 'quests'} onClick={() => switchTab('quests')}>
          {t('carnet.tab.quetes', { count: campaign.quests.length })}
        </TabButton>
        <TabButton active={tab === 'calendar'} onClick={() => switchTab('calendar')}>
          {t('carnet.tab.calendrier')}
        </TabButton>
        <TabButton active={tab === 'npcs'} onClick={() => switchTab('npcs')}>
          {t('carnet.tab.pnj')}
        </TabButton>
      </nav>

      {feedback && (
        <div
          className={`mt-4 rounded-xl px-4 py-2.5 text-sm font-medium ${
            feedback.kind === 'success'
              ? 'border border-green-200 bg-green-50 text-green-800'
              : 'border border-red-200 bg-red-50 text-red-800'
          }`}
          role="status"
        >
          {feedback.msg}
        </div>
      )}

      {/* Un mouvement par changement d'onglet, jamais au rafraîchissement des données */}
      <div key={tab} className="sheet-tab-swap mt-5">
        {tab === 'notes' && <NotesTab {...tabProps} />}
        {tab === 'quests' && <QuestsTab {...tabProps} />}
        {tab === 'calendar' && <CalendarTab {...tabProps} />}
        {tab === 'npcs' && <NpcPage embedded />}
      </div>
    </div>
  );
}

// ---------- Onglet Calendrier : la grande mesure + points de conduite ----------

function CalendarTab({ campaign, partyId, reload, onError, setCampaign }: TabProps) {
  const { t } = useTranslation();
  const { state, countdowns, days } = campaign;

  const [editingDay, setEditingDay] = useState(false);
  const [dayDraft, setDayDraft] = useState(String(state.day));
  const [weatherDraft, setWeatherDraft] = useState(state.weather ?? '');
  const [noteDraft, setNoteDraft] = useState(state.note ?? '');
  const [showCountdownForm, setShowCountdownForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newTarget, setNewTarget] = useState('');

  useEffect(() => {
    setWeatherDraft(state.weather ?? '');
  }, [state.weather]);

  useEffect(() => {
    setNoteDraft(state.note ?? '');
  }, [state.note]);

  useEffect(() => {
    setDayDraft(String(state.day));
  }, [state.day]);

  async function patchState(partial: Record<string, unknown>) {
    try {
      await api.patch(`/api/parties/${partyId}/campaign`, partial);
      await reload(true);
    } catch {
      onError(t('carnet.cal.err.horloge'));
    }
  }

  /** +1 jour — l'interaction signée : optimiste, le jour qui s'achève est
   *  figé au registre (météo + journal), le nouveau jour démarre clair. */
  async function advance() {
    const prev = campaign;
    const archived: CampaignDay = {
      id: -1, // transitoire : remplacé par la vraie ligne au rechargement
      partyId: state.partyId,
      day: state.day,
      weather: state.weather,
      note: state.note,
    };
    setCampaign((c) =>
      c === null
        ? c
        : {
            ...c,
            state: { ...state, day: state.day + 1, weather: null, note: null },
            days: [archived, ...days.filter((d) => d.day !== archived.day)].slice(0, 30),
          },
    );
    try {
      await api.post(`/api/parties/${partyId}/campaign/advance`, { steps: 1 });
      await reload(true);
    } catch {
      setCampaign(() => prev);
      onError(t('carnet.cal.err.horloge'));
    }
  }

  function commitDay() {
    const parsed = Number(dayDraft);
    setEditingDay(false);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed !== state.day) {
      patchState({ day: parsed });
    } else {
      setDayDraft(String(state.day));
    }
  }

  async function commitWeather(value: string) {
    const trimmed = value.trim();
    if ((state.weather ?? '') === trimmed) return;
    await patchState({ weather: trimmed || null });
  }

  async function commitNote(value: string) {
    const trimmed = value.trim();
    if ((state.note ?? '') === trimmed) return;
    await patchState({ note: trimmed || null });
  }

  /** Retouche a posteriori d'un jour passé (météo et/ou journal). */
  async function patchDay(id: number, patch: { weather?: string | null; note?: string | null }) {
    try {
      await api.patch(`/api/campaign-days/${id}`, patch);
      await reload(true);
    } catch {
      onError(t('carnet.cal.err.horloge'));
    }
  }

  async function createCountdown(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    const target = Number(newTarget);
    if (!label || !Number.isInteger(target) || target < 1) return;
    try {
      await api.post(`/api/parties/${partyId}/campaign/countdowns`, {
        label,
        targetDay: target,
      });
      setShowCountdownForm(false);
      setNewLabel('');
      setNewTarget('');
      await reload(true);
    } catch {
      onError(t('carnet.rebours.err'));
    }
  }

  async function saveCountdown(id: number, label: string, targetDay: number) {
    try {
      await api.patch(`/api/campaign-countdowns/${id}`, { label, targetDay });
      await reload(true);
    } catch {
      onError(t('carnet.rebours.err'));
    }
  }

  async function removeCountdown(id: number) {
    try {
      await api.delete(`/api/campaign-countdowns/${id}`);
      await reload(true);
    } catch {
      onError(t('carnet.rebours.err'));
    }
  }

  return (
    <div className="space-y-5">
      <article className="card p-5 sm:p-6">
        {/* La grande mesure + l'unique porte sang de l'onglet */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="block text-xs font-medium tracking-wide text-ink-400 uppercase">
              {t('carnet.cal.jour')}
            </span>
            {editingDay ? (
              <form
                className="mt-1 flex items-baseline gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  commitDay();
                }}
              >
                <label className="sr-only" htmlFor="carnet-jour-edit">
                  {t('carnet.cal.jour')}
                </label>
                <input
                  id="carnet-jour-edit"
                  className="input w-28 font-display text-3xl"
                  type="number"
                  min={1}
                  value={dayDraft}
                  onChange={(e) => setDayDraft(e.target.value)}
                  onBlur={commitDay}
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingDay(true)}
                className="mt-0.5 block font-display text-6xl leading-none text-ink-900 transition-colors hover:text-blood-700"
                aria-label={t('carnet.cal.modifier.jour')}
                title={t('carnet.cal.modifier.jour')}
              >
                {state.day}
              </button>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              <span>{t('carnet.cal.semaine', { week: weekOf(state.day) })}</span>
              <span aria-hidden="true">·</span>
              <label className="sr-only" htmlFor="carnet-saison">
                {t('carnet.cal.saison.label')}
              </label>
              <select
                id="carnet-saison"
                className="cursor-pointer border-none bg-transparent p-0 text-sm text-ink-500 hover:text-ink-800 focus:text-ink-800"
                value={state.season}
                onChange={(e) => patchState({ season: e.target.value as CampaignSeason })}
              >
                {CAMPAIGN_SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`carnet.cal.saison.${s}`)}
                  </option>
                ))}
              </select>
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => advance()}>
            {t('carnet.cal.plus.un.jour')}
          </button>
        </div>

        {/* Météo du jour — préréglages + texte libre */}
        <div className="mt-5 border-t border-parchment-200 pt-4">
          <label className="label" htmlFor="carnet-meteo">
            {t('carnet.cal.meteo')}
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id="carnet-meteo"
              className="input max-w-xs flex-1"
              value={weatherDraft}
              onChange={(e) => setWeatherDraft(e.target.value)}
              onBlur={() => commitWeather(weatherDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitWeather(weatherDraft);
                }
              }}
              placeholder={t('carnet.cal.meteo.placeholder')}
            />
            <fieldset className="flex min-w-0 items-center gap-1 border-0 p-0">
              <legend className="sr-only">{t('carnet.cal.meteo.presets')}</legend>
              {WEATHER_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.labelKey}
                  className="rounded-full border border-parchment-300 px-2.5 py-1 text-sm hover:border-blood-600"
                  title={t(p.labelKey)}
                  aria-label={t(p.labelKey)}
                  onClick={() => {
                    const value = `${p.emoji} ${t(p.labelKey)}`;
                    setWeatherDraft(value);
                    commitWeather(value);
                  }}
                >
                  <span aria-hidden="true" className="emoji-glyph">
                    {p.emoji}
                  </span>
                </button>
              ))}
            </fieldset>
          </div>
        </div>

        {/* Note du jour — le journal se fige au registre quand le jour s'achève */}
        <div className="mt-5 border-t border-parchment-200 pt-4">
          <label className="label" htmlFor="carnet-note">
            {t('carnet.cal.note')}
          </label>
          <textarea
            id="carnet-note"
            className="input mt-1"
            rows={2}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => commitNote(noteDraft)}
            placeholder={t('carnet.cal.note.placeholder')}
          />
        </div>

        {/* Comptes à rebours — lignes d'annexe à points de conduite */}
        <div className="mt-5 border-t border-parchment-200 pt-4">
          <h2 className="section-title">{t('carnet.rebours.titre')}</h2>
          {countdowns.length === 0 && !showCountdownForm ? (
            <p className="mt-2 text-sm text-ink-400">{t('carnet.rebours.vide')}</p>
          ) : (
            <ul className="mt-2 list-none">
              {countdowns.map((c) => (
                <CountdownRow
                  key={c.id}
                  countdown={c}
                  day={state.day}
                  onSave={(label, target) => saveCountdown(c.id, label, target)}
                  onDelete={() => removeCountdown(c.id)}
                />
              ))}
            </ul>
          )}
          {showCountdownForm ? (
            <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={createCountdown}>
              <label className="sr-only" htmlFor="rebours-label">
                {t('carnet.rebours.label')}
              </label>
              <input
                id="rebours-label"
                className="input max-w-xs flex-1"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('carnet.rebours.label.placeholder')}
              />
              <label className="sr-only" htmlFor="rebours-target">
                {t('carnet.rebours.cible')}
              </label>
              <input
                id="rebours-target"
                className="input w-24 font-mono"
                type="number"
                min={1}
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder={t('carnet.rebours.cible')}
              />
              <button type="submit" className="btn-primary px-3 py-1.5 text-sm">
                {t('carnet.rebours.creer')}
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-sm text-ink-500"
                onClick={() => setShowCountdownForm(false)}
              >
                {t('carnet.rebours.annuler')}
              </button>
            </form>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                className="btn-ghost text-sm text-ink-500"
                onClick={() => setShowCountdownForm(true)}
              >
                {t('carnet.rebours.ajouter')}
              </button>
            </div>
          )}
        </div>

        {/* Jours passés — registre compact inversé, retouchable */}
        {days.length > 0 && (
          <div className="mt-5 border-t border-parchment-200 pt-4">
            <h2 className="section-title">{t('carnet.jours.passes')}</h2>
            <ul className="mt-2 max-h-52 list-none overflow-y-auto pr-1">
              {days.map((d) => (
                <DayLedgerRow key={d.day} day={d} onPatch={(patch) => patchDay(d.id, patch)} />
              ))}
            </ul>
          </div>
        )}
      </article>
    </div>
  );
}

/** Une ligne d'échéance : libellé · points de conduite · J−N (mono). */
function CountdownRow({
  countdown,
  day,
  onSave,
  onDelete,
}: {
  countdown: CampaignCountdown;
  day: number;
  onSave: (label: string, targetDay: number) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(countdown.label);
  const [target, setTarget] = useState(String(countdown.targetDay));

  useEffect(() => {
    setLabel(countdown.label);
    setTarget(String(countdown.targetDay));
  }, [countdown.label, countdown.targetDay]);

  const remaining = countdown.targetDay - day;

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-2">
        <label className="sr-only" htmlFor={`rebours-edit-label-${countdown.id}`}>
          {t('carnet.rebours.label')}
        </label>
        <input
          id={`rebours-edit-label-${countdown.id}`}
          className="input max-w-xs flex-1"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <label className="sr-only" htmlFor={`rebours-edit-target-${countdown.id}`}>
          {t('carnet.rebours.cible')}
        </label>
        <input
          id={`rebours-edit-target-${countdown.id}`}
          className="input w-24 font-mono"
          type="number"
          min={1}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          onClick={() => {
            const parsed = Number(target);
            if (label.trim() && Number.isInteger(parsed) && parsed >= 1) {
              onSave(label.trim(), parsed);
              setEditing(false);
            }
          }}
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-sm text-ink-500"
          onClick={() => setEditing(false)}
        >
          {t('carnet.rebours.annuler')}
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-baseline gap-2 border-b border-parchment-100 py-2 last:border-b-0">
      <span className="min-w-0 truncate text-sm font-medium text-ink-800">{countdown.label}</span>
      <span
        aria-hidden="true"
        className="mx-1 min-w-6 flex-1 border-b border-dotted border-parchment-300"
      />
      <span
        className={`shrink-0 font-mono text-sm font-semibold ${
          remaining === 0 ? 'text-ink-900' : remaining < 0 ? 'text-ink-400' : 'text-ink-800'
        }`}
      >
        {remaining > 0
          ? t('carnet.rebours.restant', { n: remaining })
          : remaining === 0
            ? t('carnet.rebours.aujourdhui')
            : t('carnet.rebours.depasse', { n: -remaining })}
      </span>
      <button
        type="button"
        className="shrink-0 p-1 text-ink-400 hover:text-blood-600"
        aria-label={t('carnet.rebours.modifier', { label: countdown.label })}
        onClick={() => setEditing(true)}
      >
        ✎
      </button>
      <ConfirmButton
        onConfirm={onDelete}
        className="rounded-full p-1 text-sm text-ink-400 transition-colors hover:text-red-500"
        armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
        title={t('carnet.rebours.supprimer', { label: countdown.label })}
        ariaLabel={t('carnet.rebours.supprimer', { label: countdown.label })}
        confirmChildren={t('carnet.supprimer')}
      >
        ×
      </ConfirmButton>
    </li>
  );
}

/** Une ligne du registre des jours passés : Jour N · météo, journal en
 *  seconde ligne, retouche inline (✎). */
function DayLedgerRow({
  day,
  onPatch,
}: {
  day: CampaignDay;
  onPatch: (patch: { weather?: string | null; note?: string | null }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [weather, setWeather] = useState(day.weather ?? '');
  const [note, setNote] = useState(day.note ?? '');

  useEffect(() => {
    setWeather(day.weather ?? '');
    setNote(day.note ?? '');
  }, [day.weather, day.note]);

  if (editing) {
    return (
      <li className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-2">
        <span className="text-right font-mono text-sm text-ink-500">
          {t('carnet.jours.passe', { day: day.day })}
        </span>
        <div className="space-y-2">
          <div>
            <label className="sr-only" htmlFor={`jour-edit-meteo-${day.id}`}>
              {t('carnet.cal.meteo')} — {t('carnet.jours.passe', { day: day.day })}
            </label>
            <input
              id={`jour-edit-meteo-${day.id}`}
              className="input"
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              placeholder={t('carnet.cal.meteo.placeholder')}
            />
          </div>
          <div>
            <label className="sr-only" htmlFor={`jour-edit-note-${day.id}`}>
              {t('carnet.cal.note')} — {t('carnet.jours.passe', { day: day.day })}
            </label>
            <textarea
              id={`jour-edit-note-${day.id}`}
              className="input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('carnet.cal.note.placeholder')}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              onClick={async () => {
                await onPatch({
                  weather: weather.trim() || null,
                  note: note.trim() || null,
                });
                setEditing(false);
              }}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-sm text-ink-500"
              onClick={() => setEditing(false)}
            >
              {t('carnet.rebours.annuler')}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="border-b border-parchment-100 last:border-b-0">
      {/* Toute la ligne est la porte d'édition — le ✎ n'est que le rappel */}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-mx-2 grid w-full grid-cols-[5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-parchment-100/70"
        aria-label={t('carnet.jours.modifier', { day: day.day })}
      >
        <span className="text-right font-mono text-ink-500">
          {t('carnet.jours.passe', { day: day.day })}
        </span>
        <span className="min-w-0 truncate text-ink-600">
          {day.weather ?? t('carnet.cal.meteo.inconnue')}
        </span>
        <span aria-hidden="true" className="shrink-0 p-1 text-ink-400">
          ✎
        </span>
        {day.note && (
          <span className="col-start-2 col-end-4 block whitespace-pre-line text-ink-500">
            {day.note}
          </span>
        )}
      </button>
    </li>
  );
}

// ---------- Onglet Quêtes : le registre à cycle de vie ----------

function QuestsTab({ campaign, partyId, reload, onError }: TabProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DmQuest | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [inlineTitle, setInlineTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const ordered = useMemo(
    () =>
      [...campaign.quests].sort(
        (a, b) =>
          questTier(a.status) - questTier(b.status) || a.sortOrder - b.sortOrder || a.id - b.id,
      ),
    [campaign.quests],
  );

  async function createQuest(payload: CreateDmQuestPayload) {
    try {
      await api.post(`/api/parties/${partyId}/dm-quests`, payload);
      await reload(true);
    } catch {
      onError(t('carnet.qu.err'));
    }
  }

  async function patchQuest(id: number, payload: PatchDmQuestPayload) {
    try {
      await api.patch(`/api/dm-quests/${id}`, payload);
      await reload(true);
    } catch {
      onError(t('carnet.qu.err'));
    }
  }

  async function removeQuest(id: number) {
    try {
      await api.delete(`/api/dm-quests/${id}`);
      await reload(true);
    } catch {
      onError(t('carnet.qu.err'));
    }
  }

  async function submitModal(payload: QuestModalPayload) {
    if (editing) {
      await patchQuest(editing.id, payload);
    } else {
      await createQuest({
        title: payload.title,
        body: payload.body ?? undefined,
        ...(payload.status ? { status: payload.status } : {}),
      });
    }
    setShowModal(false);
    setEditing(null);
  }

  return (
    <div>
      {ordered.length === 0 ? (
        /* Page vierge : chemin de création inline sous la double règle */
        <div className="py-6">
          <div className="card p-8">
            <EmptyState icon="🗺️" title={t('carnet.qu.vierge')} hint={t('carnet.qu.vierge.hint')} />
          </div>
          <form
            className="mt-4 flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const title = inlineTitle.trim();
              if (!title || busy) return;
              setBusy(true);
              await createQuest({ title });
              setInlineTitle('');
              setBusy(false);
            }}
          >
            <label className="sr-only" htmlFor="quete-inline">
              {t('carnet.qu.titre')}
            </label>
            <input
              id="quete-inline"
              className="input flex-1"
              value={inlineTitle}
              onChange={(e) => setInlineTitle(e.target.value)}
              placeholder={t('carnet.qu.chemin.placeholder')}
            />
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={busy || !inlineTitle.trim()}
            >
              {t('carnet.qu.creer')}
            </button>
          </form>
        </div>
      ) : (
        <>
          <ol className="list-none">
            {ordered.map((quest, i) => {
              const isLive = quest.status === 'active';
              const isCompact = questTier(quest.status) === 2;
              const isOpen = expanded === quest.id;
              const delay = `${Math.min(i + 1, 5) * 60}ms`;
              return (
                <li
                  key={quest.id}
                  className="register-rise border-b border-parchment-200"
                  style={{ animationDelay: delay }}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : quest.id)}
                    className={`-mx-3 block w-full rounded-lg px-3 text-left transition-colors hover:bg-parchment-100/70 ${
                      isLive ? 'py-5' : isCompact ? 'py-3' : 'py-4'
                    }`}
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-start gap-4">
                      <span
                        aria-hidden="true"
                        className={`w-10 shrink-0 text-right font-display ${
                          isLive
                            ? 'pt-1 text-2xl text-blood-500'
                            : isCompact
                              ? 'pt-0.5 text-base text-ink-300'
                              : 'pt-0.5 text-lg text-ink-400'
                        }`}
                      >
                        {toRoman(i + 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate font-display leading-tight ${
                            isLive
                              ? 'text-2xl font-bold'
                              : isCompact
                                ? 'text-base font-semibold'
                                : 'text-lg font-semibold'
                          }`}
                        >
                          {quest.title}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-400">
                          {QUEST_STATUS_GLYPH[quest.status]} {t(`carnet.qu.status.${quest.status}`)}
                          {isCompact &&
                            ` · ${new Date(`${quest.updatedAt}Z`).toLocaleDateString(appLocale())}`}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`chevron shrink-0 pt-1 text-xs text-ink-300 ${isOpen ? 'is-open' : 'is-closed'}`}
                      >
                        ▼
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 pb-5 pl-14">
                      {quest.body && quest.body.trim() !== '' ? (
                        <div
                          className="prose-sm max-w-none text-sm text-ink-600"
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes <, > and & before injecting its own trusted tags — no user HTML reaches the DOM.
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(quest.body) }}
                        />
                      ) : (
                        <p className="text-sm italic text-ink-400">{t('carnet.qu.sans.notes')}</p>
                      )}
                      <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
                        <legend className="sr-only">{t('carnet.qu.statut')}</legend>
                        {DM_QUEST_STATUSES.map((s) => (
                          <button
                            type="button"
                            key={s}
                            aria-pressed={quest.status === s}
                            onClick={() => patchQuest(quest.id, { status: s })}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                              quest.status === s
                                ? 'bg-ink-800 text-parchment-50'
                                : 'bg-parchment-100 text-ink-500 hover:bg-parchment-200'
                            }`}
                          >
                            {t(`carnet.qu.status.${s}`)}
                          </button>
                        ))}
                      </fieldset>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-xs text-ink-600 hover:bg-parchment-100"
                          onClick={() => {
                            setEditing(quest);
                            setShowModal(true);
                          }}
                        >
                          ✎ {t('carnet.qu.modifier')}
                        </button>
                        <ConfirmButton
                          onConfirm={() => removeQuest(quest.id)}
                          className="text-xs text-ink-400 hover:text-red-600"
                          armedClassName="font-semibold text-red-700"
                          title={t('carnet.qu.supprimer', { title: quest.title })}
                          ariaLabel={t('carnet.qu.supprimer', { title: quest.title })}
                          confirmChildren={t('carnet.qu.confirmer')}
                        >
                          {t('carnet.supprimer')}
                        </ConfirmButton>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-center pt-6">
            <button
              type="button"
              className="btn-ghost text-ink-500"
              onClick={() => {
                setEditing(null);
                setShowModal(true);
              }}
            >
              {t('carnet.qu.nouvelle')}
            </button>
          </div>
        </>
      )}

      <QuestFormModal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditing(null);
        }}
        quest={editing}
        onSubmit={submitModal}
      />
    </div>
  );
}

type QuestModalPayload = { title: string; body: string | null; status?: DmQuestStatus };

function QuestFormModal({
  open,
  onClose,
  quest,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  quest: DmQuest | null;
  onSubmit: (payload: QuestModalPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const isEdit = quest !== null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<DmQuestStatus>('preparation');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (quest) {
      setTitle(quest.title);
      setBody(quest.body ?? '');
      setStatus(quest.status);
    } else {
      setTitle('');
      setBody('');
      setStatus('preparation');
    }
    setSaving(false);
  }, [open, quest]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSubmit({
        title: trimmed,
        body: body.trim() || null,
        ...(isEdit ? { status } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('carnet.qu.modifier.titre') : t('carnet.qu.nouvelle')}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="quete-titre">
            {t('carnet.qu.titre')}
          </label>
          <input
            id="quete-titre"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="quete-corps">
            {t('carnet.qu.corps')}
          </label>
          <textarea
            id="quete-corps"
            className="input min-h-[140px] resize-y font-mono text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('carnet.qu.corps.placeholder')}
          />
          <span className="mt-1 block text-xs text-ink-400">
            {t('notes.gras.italique.code.titre.liste.gt')}
          </span>
        </div>
        {isEdit && (
          <div>
            <label className="label" htmlFor="quete-statut">
              {t('carnet.qu.statut')}
            </label>
            <select
              id="quete-statut"
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as DmQuestStatus)}
            >
              {DM_QUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`carnet.qu.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="btn-primary w-full disabled:opacity-50"
        >
          {saving ? '…' : isEdit ? t('common.save') : t('carnet.qu.creer')}
        </button>
      </form>
    </Modal>
  );
}

// ---------- Onglet Notes : cartes triables, la grammaire des notes de fiche ----------

function NotesTab({ campaign, partyId, reload, onError, setCampaign }: TabProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DmNote | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const notes = campaign.notes;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? notes.filter((n) => `${n.title} ${n.content ?? ''}`.toLowerCase().includes(q))
    : notes;

  function openCreate() {
    setEditing(null);
    setTitle('');
    setContent('');
    setPreviewMode(false);
    setShowModal(true);
  }

  function openEdit(note: DmNote) {
    setEditing(note);
    setTitle(note.title);
    setContent(note.content ?? '');
    setPreviewMode(false);
    setShowModal(true);
  }

  async function save() {
    if (!title.trim()) {
      onError(t('notes.le.titre.est.requis'));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/dm-notes/${editing.id}`, {
          title: title.trim(),
          content: content.trim() || null,
        });
      } else {
        await api.post(`/api/parties/${partyId}/dm-notes`, {
          title: title.trim(),
          content: content.trim() || undefined,
        });
      }
      setShowModal(false);
      await reload(true);
    } catch {
      onError(t('notes.erreur.lors.de.la.sauvegarde'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.delete(`/api/dm-notes/${id}`);
      await reload(true);
    } catch {
      onError(t('notes.erreur.lors.de.la.suppression'));
    }
  }

  /** Drag-to-reorder: optimistic move, one PATCH per drop carrying the whole order. */
  async function reorder(nextIds: number[]) {
    const prev = campaign;
    const byId = new Map(notes.map((n) => [n.id, n]));
    const reordered = nextIds.map((id) => byId.get(id)).filter((n) => n !== undefined);
    setCampaign((c) => (c === null ? c : { ...c, notes: reordered }));
    try {
      await api.patch(`/api/parties/${partyId}/dm-notes/order`, { order: nextIds });
    } catch {
      setCampaign(() => prev);
      onError(t('notes.reorganisation.non.enregistree'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          className="input max-w-xs flex-1"
          placeholder={t('carnet.nt.recherche')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('carnet.nt.recherche')}
        />
        <button type="button" onClick={openCreate} className="btn-primary px-3 py-1.5 text-sm">
          {t('notes.ajouter')}
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon="📝" title={t('notes.aucune.note')} hint={t('carnet.nt.vierge.hint')} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon="🔍"
            title={t('carnet.nt.aucun.resultat')}
            hint={t('carnet.nt.modifie.recherche')}
          />
        </div>
      ) : (
        <SortableGrid
          ids={filtered.map((n) => n.id)}
          onReorder={reorder}
          labelOf={(id) => filtered.find((n) => n.id === Number(id))?.title ?? ''}
          className="grid gap-3 sm:grid-cols-2"
        >
          {filtered.map((note) => (
            <SortableCard
              key={note.id}
              id={note.id}
              label={t('notes.deplacer.note.title', { note_title: note.title })}
            >
              {(handle, isDragging) => (
                <div
                  className={`card flex flex-col gap-2 p-4 ${isDragging ? 'card-dragging' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display font-semibold text-ink-800">{note.title}</h3>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(note)}
                        className="p-1 text-sm text-ink-400 hover:text-blood-600"
                        aria-label={t('notes.modifier.note.title', { note_title: note.title })}
                      >
                        ✎
                      </button>
                      <ConfirmButton
                        onConfirm={() => remove(note.id)}
                        className="rounded-full p-1 text-sm text-ink-400 transition-colors hover:text-red-500"
                        armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
                        title={t('notes.supprimer.note.title', { note_title: note.title })}
                        ariaLabel={t('notes.supprimer.note.title', { note_title: note.title })}
                        confirmChildren={t('notes.supprimer')}
                      >
                        ×
                      </ConfirmButton>
                      {q === '' && filtered.length > 1 && handle}
                    </div>
                  </div>
                  {note.content && (
                    <div
                      className="prose-sm max-w-none text-sm text-ink-600"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes <, > and & before injecting its own trusted tags — no user HTML reaches the DOM.
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
                    />
                  )}
                  <span className="mt-auto text-[10px] text-ink-400">
                    {t('notes.modifie.le', {
                      date: new Date(`${note.updatedAt}Z`).toLocaleDateString(appLocale()),
                    })}
                  </span>
                </div>
              )}
            </SortableCard>
          ))}
        </SortableGrid>
      )}

      {/* Add/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('notes.modifier.la.note') : t('notes.nouvelle.note')}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">{t('notes.titre')}</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('carnet.nt.titre.placeholder')}
              autoFocus
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label">{t('notes.contenu')}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPreviewMode(false)}
                  className={`rounded px-2 py-0.5 text-xs ${!previewMode ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-500'}`}
                >
                  {t('notes.editer')}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode(true)}
                  className={`rounded px-2 py-0.5 text-xs ${previewMode ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-500'}`}
                >
                  {t('notes.apercu')}
                </button>
              </div>
            </div>
            {previewMode ? (
              <div className="input min-h-[180px] overflow-y-auto">
                {content.trim() ? (
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes <, > and & before injecting its own trusted tags — no user HTML reaches the DOM.
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                ) : (
                  <span className="italic text-ink-400">{t('notes.rien.a.previsualiser')}</span>
                )}
              </div>
            ) : (
              <textarea
                className="input min-h-[180px] resize-y font-mono text-sm"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('notes.modele.de.contenu')}
              />
            )}
          </div>

          <div className="rounded-lg border border-parchment-200 bg-parchment-50 p-2">
            <p className="text-[11px] text-ink-500">
              <strong>{t('notes.formatage')}</strong>
              {t('notes.gras.italique.code.titre.liste.gt')}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !title.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editing ? t('common.save') : t('notes.creer')}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              {t('notes.annuler')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
