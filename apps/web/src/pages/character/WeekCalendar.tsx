/**
 * LE CALENDRIEL PARTAGÉ (#159) — la vue semaine.
 *
 * Même composant pour la fiche (onglet Calendrier, tout membre) et le carnet
 * du MD (isGM=true) : sept jours par page, une rangée par jour, feuilletage
 * ‹ › par pas de sept (le passé comme le futur). Le jour courant porte
 * l'or — bord + fond gold-50 —, seul accent du calendrier. Chaque rangée se
 * déplie : journal de table (partagé, éditable par tous), « Ma note » privée
 * (par personnage) et, pour le MD, la zone réglée (météo, note MD, correction
 * libre du jour). « Jour suivant » avance l'horloge (+1, tout membre).
 *
 * Contrat (#159, commit 2bfeda0) : GET /campaign/calendar ne renvoie que les
 * jours EXISTANTS de campaign_days — le client matérialise les manquants.
 * Le jour COURANT lit sa météo et sa note MD dans l'horloge (state), pas au
 * registre : l'avance fige le jour qui s'achève et le nouveau jour démarre
 * clair. La retouche d'un jour passe par PATCH /campaign-days/:id (GM) — l'id
 * vient du GET /campaign du carnet, chargé ici seulement quand isGM.
 */

import type { CampaignCalendarResponse, CampaignSeason } from '@table-sync/shared';
import type { GlyphName } from '../../components/Glyph';
import { Glyph } from '../../components/Glyph';
import { CAMPAIGN_SEASONS } from '@table-sync/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useCampaignInvalidation, useLightDay } from '../../campaignCalendar';
import { ErrorMsg, LoadingSpinner } from '../../components/ui';
import { useResyncOnReconnect } from '../../sync';

/** Semaine artificielle : le jour 1 ouvre la première semaine (1–7). */
export function weekStartOf(day: number): number {
  return day - ((day - 1) % 7);
}

/** Un jour matérialisé de la page courante. */
export interface CalendarRow {
  day: number;
  weather: string | null;
  tableNote: string | null;
  /** Note MD — null pour un lecteur non-MD (et pour le jour courant, qui vit
   *  dans l'horloge : GET /calendar ne la sert que pour les jours au registre). */
  dmNote: string | null;
  /** Ligne du registre campaign_days (id pour la retouche MD), si elle existe. */
  rowId: number | null;
  /** Ce jour est le jour courant de l'horloge. */
  isCurrent: boolean;
}

/** Fusion : plage matérialisée × jours existants × horloge du jour courant.
 *  Le jour COURANT lit sa météo et sa note MD dans l'horloge (c'est ELLE que
 *  l'avance fige au registre — une ligne résiduelle du jour courant ne porte
 *  que le journal de table) ; les autres jours lisent leur ligne. */
function materialize(
  data: CampaignCalendarResponse,
  clock: { day: number; weather: string | null; note: string | null },
  ledger: { day: number; id: number }[],
  from: number,
): CalendarRow[] {
  const byDay = new Map(data.days.map((d) => [d.day, d]));
  const ledgerByDay = new Map(ledger.map((d) => [d.day, d.id]));
  const rows: CalendarRow[] = [];
  // Ordre inversé : le DERNIER jour de la semaine en haut (retour UI
  // 2026-10-10) — le journal se lit comme une chrono décroissante, le jour
  // courant ouvre la liste dès qu'on est en milieu de semaine.
  for (let i = 6; i >= 0; i--) {
    const day = from + i;
    const row = byDay.get(day);
    const isCurrent = day === clock.day;
    rows.push({
      day,
      weather: isCurrent ? clock.weather : (row?.weather ?? null),
      tableNote: row?.tableNote ?? null,
      // clock.note : la note MD du jour courant, servie au MD seul (GET
      // /campaign) — le calendrier d'un joueur ne la porte jamais.
      dmNote: isCurrent ? clock.note : (row?.dmNote ?? null),
      rowId: ledgerByDay.get(day) ?? null,
      isCurrent,
    });
  }
  return rows;
}

// Préréglages météo : rendu en glyphes SVG. L'emoji reste dans la VALEUR
// stockée (compatibilité des données existantes) — seul le rendu le convertit.
const WEATHER_PRESETS: { emoji: string; glyph: GlyphName; labelKey: string }[] = [
  { emoji: '☀️', glyph: 'sun', labelKey: 'carnet.cal.meteo.clear' },
  { emoji: '🌧️', glyph: 'rain', labelKey: 'carnet.cal.meteo.rain' },
  { emoji: '🌩️', glyph: 'storm', labelKey: 'carnet.cal.meteo.storm' },
  { emoji: '❄️', glyph: 'snow', labelKey: 'carnet.cal.meteo.snow' },
  { emoji: '🌫️', glyph: 'fog', labelKey: 'carnet.cal.meteo.fog' },
];

/** Emoji de météo (1ᵉʳ token de la valeur stockée) → glyphe SVG. */
const WEATHER_GLYPH_BY_EMOJI: Record<string, GlyphName> = {
  '☀️': 'sun',
  '☀': 'sun',
  '🌧️': 'rain',
  '🌧': 'rain',
  '🌩️': 'storm',
  '🌩': 'storm',
  '❄️': 'snow',
  '❄': 'snow',
  '🌫️': 'fog',
  '🌫': 'fog',
};

/** Textarea auto-extensible (le journal pousse avec la plume). */
function AutoTextarea({
  id,
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  className = '',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Pousse la hauteur au contenu (bornée par max-h + scroll interne en CSS).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      className={`input min-h-[44px] max-h-64 resize-none overflow-y-auto ${className}`}
      rows={2}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur(); // commit au blur — même geste que le carnet
        }
      }}
    />
  );
}

/** Un jour du calendrier : la rangée résumé + le dépliage. */
function CalendarDayRow({
  row,
  isGM,
  charId,
  partyId,
  expanded,
  onToggle,
  onError,
  onNotice,
  onSaved,
}: {
  row: CalendarRow;
  /** Zone MD servie (le carnet passe true ; la fiche suit la réponse API). */
  isGM: boolean;
  /** Personnage de la note privée (null = pas de note privée, carnet MD). */
  charId: number | null;
  partyId: number;
  expanded: boolean;
  onToggle: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [tableDraft, setTableDraft] = useState(row.tableNote ?? '');
  const [privateDraft, setPrivateDraft] = useState<string | null>(null);
  const [privateLoaded, setPrivateLoaded] = useState(false);
  const [dmDraft, setDmDraft] = useState(row.dmNote ?? '');
  const [weatherDraft, setWeatherDraft] = useState(row.weather ?? '');

  // Les brouillons suivent le serveur SAUF pendant l'édition (le focus garde
  // la main — une synchro WS ne doit pas écraser la plume en cours).
  useEffect(() => {
    if (document.activeElement?.id !== `cal-journal-${row.day}`) setTableDraft(row.tableNote ?? '');
  }, [row.tableNote, row.day]);
  useEffect(() => {
    if (document.activeElement?.id !== `cal-md-${row.day}`) setDmDraft(row.dmNote ?? '');
  }, [row.dmNote, row.day]);
  useEffect(() => {
    if (document.activeElement?.id !== `cal-meteo-${row.day}`) setWeatherDraft(row.weather ?? '');
  }, [row.weather, row.day]);

  // Note privée : chargée à la première ouverture de la rangée (une requête
  // par jour/personnage, pas sept au montage).
  useEffect(() => {
    if (!expanded || privateLoaded || charId === null) return;
    let alive = true;
    setPrivateLoaded(true);
    api
      .get(`/api/parties/${partyId}/campaign/day-note`, {
        params: { characterId: charId, day: row.day },
      })
      .then((res) => {
        if (alive) setPrivateDraft(typeof res.data?.note === 'string' ? res.data.note : '');
      })
      .catch(() => {
        if (alive) setPrivateDraft('');
      });
    return () => {
      alive = false;
    };
  }, [expanded, privateLoaded, charId, row.day, partyId]);

  async function commitTableNote() {
    const note = tableDraft.trim();
    if (note === (row.tableNote ?? '')) return;
    try {
      await api.put(`/api/parties/${partyId}/campaign/table-note`, { day: row.day, note });
      onNotice(t('calendrier.journal.enregistre'));
      onSaved();
    } catch {
      onError(t('calendrier.err.enregistrement'));
      setTableDraft(row.tableNote ?? '');
    }
  }

  async function commitPrivateNote() {
    if (privateDraft === null || charId === null) return;
    const note = privateDraft.trim();
    try {
      await api.put(`/api/parties/${partyId}/campaign/day-note`, {
        characterId: charId,
        day: row.day,
        note,
      });
      onNotice(t('calendrier.ma.note.enregistree'));
    } catch {
      onError(t('calendrier.err.enregistrement'));
    }
  }

  /** Retouche MD d'un jour : sa ligne du registre si elle existe, l'horloge
   *  pour le jour courant, et pour un jour sans ligne la création par
   *  l'upsert du journal (l'id naît alors côté serveur) puis la retouche. */
  async function commitDmDay(patch: { weather?: string | null; note?: string | null }) {
    try {
      if (row.isCurrent) {
        // Le jour courant vit dans l'horloge — PATCH direct (correction sans
        // archivage, même grammaire que le carnet).
        await api.patch(`/api/parties/${partyId}/campaign`, patch);
      } else if (row.rowId !== null) {
        await api.patch(`/api/campaign-days/${row.rowId}`, patch);
      } else {
        // Jour sans registre : la ligne naît par l'upsert du journal (vide ou
        // conservé — la retouche ne doit pas effacer ce que la table a écrit),
        // puis porte la météo/la note MD.
        await api.put(`/api/parties/${partyId}/campaign/table-note`, {
          day: row.day,
          note: row.tableNote ?? '',
        });
        const res = await api.get<{ campaign: { days: { id: number; day: number }[] } }>(
          `/api/parties/${partyId}/campaign`,
        );
        const created = res.data?.campaign?.days.find((d) => d.day === row.day);
        if (created) await api.patch(`/api/campaign-days/${created.id}`, patch);
      }
      onSaved();
    } catch {
      onError(t('calendrier.err.enregistrement'));
    }
  }

  return (
    <li
      className={`rounded-xl border transition-colors ${
        row.isCurrent ? 'border-gold-400 bg-gold-50' : 'border-parchment-200 bg-parchment-50'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={t('calendrier.jour.aria', { day: row.day })}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className={`w-16 shrink-0 font-display text-sm font-semibold ${
            row.isCurrent ? 'text-gold-700' : 'text-ink-800'
          }`}
        >
          {t('carnet.jours.passe', { day: row.day })}
        </span>
        {row.weather ? (
          <span className="emoji-glyph shrink-0 text-base" title={row.weather}>
            <WeatherGlyph weather={row.weather} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm text-ink-500">
          {row.tableNote ?? t('calendrier.jour.vide')}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-ink-400 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          ⌄
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-parchment-200 px-3 py-3">
          {/* Journal de table — partagé, éditable par tous */}
          <div>
            <label className="label" htmlFor={`cal-journal-${row.day}`}>
              {t('calendrier.journal')}
            </label>
            <AutoTextarea
              id={`cal-journal-${row.day}`}
              label={t('calendrier.journal')}
              className="mt-1"
              value={tableDraft}
              onChange={setTableDraft}
              onCommit={commitTableNote}
              placeholder={t('calendrier.journal.placeholder')}
            />
          </div>
          {/* Ma note — privée, par personnage */}
          {charId !== null && (
            <div>
              <label className="label" htmlFor={`cal-privee-${row.day}`}>
                {t('calendrier.ma.note')}
              </label>
              {privateDraft === null ? (
                <div className="input mt-1 min-h-[44px] animate-pulse" aria-hidden="true" />
              ) : (
                <AutoTextarea
                  id={`cal-privee-${row.day}`}
                  label={t('calendrier.ma.note')}
                  className="mt-1"
                  value={privateDraft}
                  onChange={setPrivateDraft}
                  onCommit={commitPrivateNote}
                  placeholder={t('calendrier.ma.note.placeholder')}
                />
              )}
            </div>
          )}
          {/* Zone MD — météo + note MD */}
          {isGM && (
            <div className="space-y-2 rounded-lg border border-parchment-200 bg-parchment-100/60 p-2">
              <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
                {t('calendrier.zone.md')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`cal-meteo-${row.day}`}>
                  {t('carnet.cal.meteo')}
                </label>
                <input
                  id={`cal-meteo-${row.day}`}
                  className="input max-w-xs flex-1"
                  value={weatherDraft}
                  onChange={(e) => setWeatherDraft(e.target.value)}
                  onBlur={() => {
                    const trimmed = weatherDraft.trim();
                    if (trimmed === (row.weather ?? '')) return;
                    commitDmDay({ weather: trimmed || null });
                  }}
                  placeholder={t('carnet.cal.meteo.placeholder')}
                />
                <fieldset className="flex items-center gap-1 border-0 p-0">
                  <legend className="sr-only">{t('carnet.cal.meteo.presets')}</legend>
                  {WEATHER_PRESETS.map((p) => (
                    <button
                      type="button"
                      key={p.labelKey}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-full border border-parchment-300 px-2.5 py-1 text-sm hover:border-blood-500"
                      title={t(p.labelKey)}
                      aria-label={t(p.labelKey)}
                      onClick={() => {
                        const value = `${p.emoji} ${t(p.labelKey)}`;
                        setWeatherDraft(value);
                        if (value !== (row.weather ?? '')) commitDmDay({ weather: value });
                      }}
                    >
                      <Glyph name={p.glyph} />
                    </button>
                  ))}
                </fieldset>
              </div>
              <div>
                <label className="sr-only" htmlFor={`cal-md-${row.day}`}>
                  {t('calendrier.note.md')}
                </label>
                <AutoTextarea
                  id={`cal-md-${row.day}`}
                  label={t('calendrier.note.md')}
                  value={dmDraft}
                  onChange={setDmDraft}
                  onCommit={() => {
                    const trimmed = dmDraft.trim();
                    if (trimmed === (row.dmNote ?? '')) return;
                    commitDmDay({ note: trimmed || null });
                  }}
                  placeholder={t('carnet.cal.note.placeholder')}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export interface WeekCalendarProps {
  partyId: number;
  /** Personnage dont dépend la note privée (null : pas de note privée). */
  charId: number | null;
  /** Zone MD (météo, note MD) — le carnet passe true ; la fiche suit isGM
   *  de la réponse (un joueur qui forcerait l'onglet ne verrait rien). */
  isGM?: boolean;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

export default function WeekCalendar({
  partyId,
  charId,
  isGM = false,
  onError,
  onNotice,
}: WeekCalendarProps) {
  const { t } = useTranslation();
  // Ancrage de la page : null = semaine du jour courant (suit l'horloge) ;
  // un nombre = semaine choisie au feuilletage (l'avance ne la déplace plus).
  const [weekAnchor, setWeekAnchor] = useState<number | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);
  // Correction libre du jour (MD) : brouillon local commité au blur/Entrée.
  const [dayDraft, setDayDraft] = useState<string | null>(null);

  // Invalide ['campaign-calendar'] + ['campaign-day'] sur campaign:change.
  useCampaignInvalidation(partyId);

  const dayQuery = useLightDay(partyId);
  const currentDay = dayQuery.data?.state.day ?? null;
  const anchor = weekAnchor ?? (currentDay !== null ? weekStartOf(currentDay) : 1);
  const from = Math.max(1, anchor);

  const calendarQuery = useQuery({
    queryKey: ['campaign-calendar', partyId, from, from + 6],
    enabled: currentDay !== null,
    queryFn: async () => {
      const res = await api.get<CampaignCalendarResponse>(
        `/api/parties/${partyId}/campaign/calendar`,
        { params: { from, to: from + 6 } },
      );
      return res.data;
    },
  });

  // Registre (ids des lignes campaign_days pour la retouche MD + jour courant
  // de l'horloge côté note MD) — GM seul : la réponse du joueur masque tout.
  const ledgerQuery = useQuery({
    queryKey: ['campaign-ledger', partyId],
    enabled: isGM,
    queryFn: async () => {
      const res = await api.get<{
        campaign: {
          state: { day: number; weather: string | null; note: string | null };
          days: { id: number; day: number }[];
        };
      }>(`/api/parties/${partyId}/campaign`);
      return res.data.campaign;
    },
  });

  const refetchAll = () => {
    void dayQuery.refetch();
    void calendarQuery.refetch();
    if (isGM) void ledgerQuery.refetch();
  };

  // Rattrapage de reconnexion : les requêtes actives se réactualisent déjà,
  // mais la note privée (état local) et les jours du trou veulent le même soin.
  useResyncOnReconnect(refetchAll);

  async function advance() {
    if (advancing || currentDay === null) return;
    setAdvancing(true);
    try {
      await api.post(`/api/parties/${partyId}/campaign/advance`, { steps: 1 });
      onNotice(t('calendrier.jour.avance'));
      refetchAll();
    } catch {
      onError(t('carnet.cal.err.horloge'));
    } finally {
      setAdvancing(false);
    }
  }

  if (calendarQuery.isError) {
    return (
      <section className="card p-4 sm:p-5" data-tuto="calendrier">
        <ErrorMsg message={t('calendrier.err.chargement')} onRetry={refetchAll} />
      </section>
    );
  }
  const data = calendarQuery.data;
  if (dayQuery.isPending || !data) {
    return (
      <section className="card p-4 sm:p-5" data-tuto="calendrier">
        <LoadingSpinner label={t('calendrier.chargement')} />
      </section>
    );
  }

  // La note MD du jour courant vit dans l'horloge (le registre ne la connaît
  // qu'une fois figée) : on l'injecte dans la fusion pour le MD.
  const ledgerDays = ledgerQuery.data?.days ?? [];
  // L'horloge « riche » (météo + note MD du jour courant) : le MD la possède
  // déjà (GET /campaign) ; un joueur n'a que la version masquée du calendrier.
  const clock = ledgerQuery.data?.state ?? {
    day: data.state.day,
    weather: data.state.weather,
    note: null,
  };
  const rows = materialize(data, clock, ledgerDays, from);

  return (
    <section className="card p-4 sm:p-5 space-y-4" data-tuto="calendrier">
      {/* Tête de semaine : feuilletage + jour courant + saison (MD) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost min-h-11 min-w-11 justify-center"
            disabled={from <= 1}
            onClick={() => setWeekAnchor(Math.max(1, from - 7))}
            aria-label={t('calendrier.semaine.precedente')}
          >
            ‹
          </button>
          <span className="min-w-24 text-center font-display text-sm font-semibold text-ink-800">
            {t('carnet.cal.semaine', { week: Math.ceil(from / 7) })}
          </span>
          <button
            type="button"
            className="btn-ghost min-h-11 min-w-11 justify-center"
            onClick={() => setWeekAnchor(from + 7)}
            aria-label={t('calendrier.semaine.suivante')}
          >
            ›
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isGM && (
            <>
              {/* Correction libre du jour — même geste que l'ancien carnet */}
              <label className="sr-only" htmlFor="cal-jour-corrige">
                {t('carnet.cal.modifier.jour')}
              </label>
              <input
                id="cal-jour-corrige"
                className="input !w-20 text-sm font-mono"
                type="number"
                min={1}
                inputMode="numeric"
                value={dayDraft ?? String(data.state.day)}
                onChange={(e) => setDayDraft(e.target.value)}
                onBlur={async () => {
                  if (dayDraft === null) return;
                  const parsed = Number(dayDraft);
                  setDayDraft(null);
                  if (Number.isInteger(parsed) && parsed >= 1 && parsed !== data.state.day) {
                    try {
                      await api.patch(`/api/parties/${partyId}/campaign`, { day: parsed });
                      refetchAll();
                    } catch {
                      onError(t('carnet.cal.err.horloge'));
                    }
                  }
                }}
                title={t('carnet.cal.modifier.jour')}
              />
              <label className="sr-only" htmlFor="cal-saison">
                {t('carnet.cal.saison.label')}
              </label>
              <select
                id="cal-saison"
                className="input !w-auto cursor-pointer text-sm"
                value={data.state.season}
                onChange={async (e) => {
                  try {
                    await api.patch(`/api/parties/${partyId}/campaign`, {
                      season: e.target.value as CampaignSeason,
                    });
                    refetchAll();
                  } catch {
                    onError(t('carnet.cal.err.horloge'));
                  }
                }}
              >
                {CAMPAIGN_SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`carnet.cal.saison.${s}`)}
                  </option>
                ))}
              </select>
            </>
          )}
          {!isGM && (
            <span className="text-xs text-ink-400">
              {t(`carnet.cal.saison.${data.state.season}`)}
            </span>
          )}
          <button type="button" className="btn-primary" onClick={advance} disabled={advancing}>
            {t('calendrier.jour.suivant')}
          </button>
        </div>
      </div>

      <ul className="list-none space-y-2">
        {rows.map((row) => (
          <CalendarDayRow
            key={row.day}
            row={row}
            isGM={isGM && data.isGM}
            charId={charId}
            partyId={partyId}
            expanded={expandedDay === row.day}
            onToggle={() => setExpandedDay((d) => (d === row.day ? null : row.day))}
            onError={onError}
            onNotice={onNotice}
            onSaved={refetchAll}
          />
        ))}
      </ul>
    </section>
  );
}

/** Rangée météo : emoji stocké converti en glyphe ; fallback texte (ancien jeton). */
function WeatherGlyph({ weather }: { weather: string }) {
  const first = weather.trim().split(/\s+/)[0] ?? '';
  const glyph = WEATHER_GLYPH_BY_EMOJI[first];
  if (glyph) return <Glyph name={glyph} />;
  return <span className="text-sm text-ink-500">{weather.trim()}</span>;
}
