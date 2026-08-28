/*
 * LA CHRONIQUE — la quatrième page réglée. Les séances de la campagne GM
 * Assistant liée, en entrées réglées dont l'ordinal romain EST le numéro de
 * séance (I, II, III…) ; la plus récente porte l'entrée courante (ordinal en
 * sang), les anciennes se replient en compactes. Toucher une séance ouvre sa
 * lecture : résumé par défaut, styles en pastilles, cachet de synchronisation.
 * Lecture seule, servie du cache — le MD rafraîchit depuis sa Table.
 */
import type { GmaLinkStatus, GmaRecapsResponse, GmaSession } from '@table-sync/shared';
import { gmaMomentTypeLabel, gmaRecapStyleLabel } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { Chip, EmptyState, ErrorMsg, LoadingSpinner } from '../components/ui';
import { useHeaderOverride } from '../headerContext';
import { useSyncEvent } from '../sync';
import { plural, toRoman } from '../utils';

function playedAtLabel(playedAt: string | null): string {
  if (!playedAt) return 'date inconnue';
  const d = new Date(playedAt);
  if (Number.isNaN(d.getTime())) return playedAt;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fetchedAtLabel(fetchedAt: string | null): string | null {
  if (!fetchedAt) return null;
  const d = new Date(fetchedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Enluminure des moments : une identité par type ----------
// Rubrication du grimoire — filet + sceau teintés, voix typographique propre.
// Les accents restent en fil (2px, jamais de remplissage) : l'or garde son
// sens magique, l'encre porte le deuil, rien n'emprunte la palette d'état
// (vert/jaune/orange/rouge des PV et de l'encombrance). Types inconnus
// (enum ouvert côté GM Assistant) → registre neutre.
interface MomentStyle {
  glyph: string;
  ring: string;
  filet: string;
  text: string;
  /** Leading gold flourish — the epic's engraved register. */
  ornament?: boolean;
}

const MOMENT_TYPE_STYLE: Record<string, MomentStyle> = {
  epic: {
    glyph: '⚔',
    ring: 'border-gold-500',
    filet: 'border-l-gold-500',
    text: 'font-display text-[15px] tracking-wide text-ink-900',
    ornament: true,
  },
  funny: {
    glyph: '😄',
    ring: 'border-amber-400',
    filet: 'border-l-amber-400',
    text: 'text-[15px]',
  },
  dramatic: {
    glyph: '🎭',
    ring: 'border-blood-700',
    filet: 'border-l-blood-700',
    text: 'font-body italic text-[15px]',
  },
  tragic: {
    glyph: '🕯',
    ring: 'border-ink-900',
    filet: 'border-l-ink-900',
    text: 'font-body italic text-[15px] text-ink-500',
  },
  intriguing: {
    glyph: '🗝',
    ring: 'border-indigo-400',
    filet: 'border-l-indigo-400',
    text: 'text-[15px]',
  },
  other: {
    glyph: '📌',
    ring: 'border-parchment-300',
    filet: 'border-l-parchment-300',
    text: 'text-[15px]',
  },
};

function momentStyle(type: string | null): MomentStyle {
  return (type && MOMENT_TYPE_STYLE[type]) || MOMENT_TYPE_STYLE.other;
}

export default function ChroniclePage() {
  const { t } = useTranslation();
  const { partyId } = useParams();
  const navigate = useNavigate();
  const [link, setLink] = useState<GmaLinkStatus | null>(null);
  const [sessions, setSessions] = useState<GmaSession[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Reading state: the open session + its recaps.
  const [open, setOpen] = useState<GmaSession | null>(null);
  const [recapsRes, setRecapsRes] = useState<GmaRecapsResponse | null>(null);
  const [recapsLoading, setRecapsLoading] = useState(false);
  const [recapsError, setRecapsError] = useState('');
  const [activeStyle, setActiveStyle] = useState('default');

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!partyId) return;
      if (!silent) setLoading(true);
      try {
        const [linkRes, sessRes] = await Promise.all([
          api.get(`/api/parties/${partyId}/gma/link`),
          api.get(`/api/parties/${partyId}/gma/sessions`).catch(() => null),
        ]);
        setLink(linkRes.data);
        if (sessRes) {
          setSessions(sessRes.data.sessions);
          setStale(sessRes.data.stale);
          setError('');
        } else if ((linkRes.data as GmaLinkStatus).linked) {
          setError('La chronique n’a pas pu être ouverte — vérifie la connexion.');
        }
      } catch (err: any) {
        setError(err.response?.data?.message || 'Erreur');
      } finally {
        setLoading(false);
      }
    },
    [partyId],
  );

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(
    (session: GmaSession) => {
      if (!partyId) return;
      setOpen(session);
      setActiveStyle('default');
      setRecapsRes(null);
      setRecapsError('');
      setRecapsLoading(true);
      api
        .get(`/api/parties/${partyId}/gma/sessions/${session.id}/recap`)
        .then((res: any) => setRecapsRes(res.data))
        .catch((err: any) => setRecapsError(err.response?.data?.message || 'Erreur'))
        .finally(() => setRecapsLoading(false));
    },
    [partyId],
  );

  // Live sync: the MD refreshed/resynced — reopen the current data.
  const currentPartyId = Number(partyId);
  useSyncEvent(
    (event) => {
      if (event.partyId !== currentPartyId || event.type !== 'gma:change') return;
      loadSessions(true);
      if (open) openSession(open);
    },
    [currentPartyId, open, openSession, loadSessions],
  );

  const onBack = useCallback(() => {
    if (open) setOpen(null);
    else navigate(`/party/${partyId}`);
  }, [open, navigate, partyId]);

  useHeaderOverride('Chronique', onBack);

  if (loading) return <LoadingSpinner label="Ouverture de la chronique…" />;
  if (!link?.linked) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <EmptyState
          icon="📜"
          title={t('chronique.pas.de.chronique.pour.ce.groupe')}
          hint="Le MD peut lier le groupe à une campagne GM Assistant depuis sa Table (onglet GM Assistant)."
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3">
        <ErrorMsg message={error} />
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={() => loadSessions()}>
            {t('chronique.reessayer')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Reading view ----------
  if (open) {
    const recaps = recapsRes?.recaps ?? [];
    const active = recaps.find((r) => r.style === activeStyle) ?? recaps[0];
    return (
      <article className="mx-auto w-full max-w-3xl">
        <header className="register-rise pb-5 pt-2 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-300">{t('chronique.seance')}</p>
          <h1 className="mt-1 font-display text-2xl font-bold sm:text-3xl">{open.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-400">
            <span>{playedAtLabel(open.playedAt)}</span>
            {recapsRes?.stale && (
              <Chip tone="amber" soft>
                {t('chronique.possiblement.obsolete')}
              </Chip>
            )}
          </p>
        </header>
        <div aria-hidden="true">
          <div className="border-t-2 border-parchment-400" />
          <div className="mt-[3px] border-t border-parchment-300" />
        </div>

        {recaps.length > 1 && (
          <nav
            className="flex flex-wrap justify-center gap-2 pt-5"
            aria-label={t('chronique.styles.de.resume')}
          >
            {recaps.map((r) => (
              <button
                key={r.style}
                type="button"
                onClick={() => setActiveStyle(r.style)}
                aria-pressed={(active?.style ?? '') === r.style}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  (active?.style ?? '') === r.style
                    ? 'border-blood-600 bg-blood-50 text-blood-700'
                    : 'border-parchment-300 text-ink-500 hover:border-ink-400 hover:text-ink-700'
                }`}
              >
                {gmaRecapStyleLabel(r.style)}
              </button>
            ))}
          </nav>
        )}

        <div className="pt-5">
          {recapsLoading && <p className="text-sm text-ink-400 animate-pulse">Lecture…</p>}
          {recapsError && <ErrorMsg message={recapsError} />}
          {!recapsLoading && !recapsError && !active && (
            <EmptyState
              icon="🖋"
              title={t('chronique.aucun.resume.pour.cette.seance')}
              hint="Les résumés apparaîtront ici dès que le MD en produira un sur GM Assistant."
            />
          )}
          {active && (
            <div className="card p-5 sm:p-7">
              <p className="whitespace-pre-line font-body text-[15px] leading-relaxed text-ink-800">
                {active.text}
              </p>
              {fetchedAtLabel(recapsRes?.fetchedAt ?? null) && (
                <p className="mt-4 text-[11px] text-ink-300">
                  synchronisé à {fetchedAtLabel(recapsRes?.fetchedAt ?? null)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Moments mémorables — enluminure par type : filet rubriqué + sceau
            teinté + voix propre (l'épique est gravé, le tragique s'éteint).
            La couche citation (« » + attributif) reste orthogonale au type. */}
        {(recapsRes?.moments?.length ?? 0) > 0 && (
          <section className="register-rise pt-8" aria-label={t('chronique.moments.memorables')}>
            <div className="flex items-center gap-3">
              <h2 className="section-title text-base">{t('chronique.moments.memorables')}</h2>
              <span
                aria-hidden="true"
                className="min-w-4 flex-1 self-center border-b border-parchment-200"
              />
            </div>
            <ul className="list-none">
              {recapsRes!.moments.map((m) => {
                const style = momentStyle(m.type);
                return (
                  <li
                    key={m.id}
                    className={`border-b border-parchment-200 border-l-2 py-3.5 pl-3 ${style.filet}`}
                  >
                    <div className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-parchment-100 text-base ${style.ring}`}
                      >
                        {style.glyph}
                      </span>
                      <div className="min-w-0 flex-1 self-center">
                        <p className={`leading-relaxed ${style.text}`}>
                          {style.ornament && (
                            <span aria-hidden="true" className="mr-1.5 text-gold-500">
                              ✦
                            </span>
                          )}
                          {m.isQuote ? `« ${m.description} »` : m.description}
                          {m.speaker && <span className="text-ink-400"> — {m.speaker}</span>}
                        </p>
                        {(m.type || m.context) && (
                          <p className="mt-1.5 text-[11px] uppercase tracking-wide text-ink-300">
                            {gmaMomentTypeLabel(m.type)}
                            {m.context ? ` · ${m.context}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </article>
    );
  }

  // ---------- Register view ----------
  const ordered = [...sessions].sort((a, b) => a.order - b.order);
  const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  const older = ordered.slice(0, -1).reverse(); // newest-first under the current entry

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Chronique</h1>
        <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-400">
          <span>{link.campaign?.title}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(ordered.length, 'séance')}</span>
          {stale && (
            <Chip tone="amber" soft>
              {t('chronique.possiblement.obsolete')}
            </Chip>
          )}
        </p>
      </header>
      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      {ordered.length === 0 ? (
        <div className="pt-8">
          <EmptyState
            icon="📜"
            title={t('chronique.aucune.seance.pour.l.instant')}
            hint="Les séances et leurs résumés apparaîtront ici dès que la campagne vivra sur GM Assistant."
          />
        </div>
      ) : (
        <ol className="list-none">
          {latest && (
            <li className="register-rise border-b border-parchment-200 py-6">
              <button
                type="button"
                onClick={() => openSession(latest)}
                className="-mx-3 block w-full rounded-lg px-3 text-left transition-colors hover:bg-parchment-100/70"
                aria-label={t('chronique.lire.le.resume.latest.title', {
                  latest_title: latest.title,
                })}
              >
                <span className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="w-10 shrink-0 text-right font-display text-2xl text-blood-500"
                  >
                    {toRoman(ordered.length)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-2xl font-bold leading-tight">
                      {latest.title}
                    </span>
                    <span className="mt-1 block text-sm text-ink-400">
                      {playedAtLabel(latest.playedAt)}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 pt-1.5 text-sm font-medium text-blood-600"
                  >
                    Lire →
                  </span>
                </span>
              </button>
            </li>
          )}
          {older.map((s, i) => (
            <li
              key={s.id}
              className="register-rise border-b border-parchment-200 py-4"
              style={{ animationDelay: `${Math.min(i, 4) * 60}ms` }}
            >
              <button
                type="button"
                onClick={() => openSession(s)}
                className="-mx-3 block w-full rounded-lg px-3 text-left transition-colors hover:bg-parchment-100/70"
                aria-label={t('chronique.lire.le.resume.s.title', { s_title: s.title })}
              >
                <span className="flex items-baseline gap-4">
                  <span
                    aria-hidden="true"
                    className="w-10 shrink-0 text-right font-display text-lg text-ink-400"
                  >
                    {toRoman(ordered.length - 1 - i)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-medium leading-tight text-ink-800">
                      {s.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-400">
                      {playedAtLabel(s.playedAt)}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-sm text-ink-300 transition-colors"
                  >
                    →
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
