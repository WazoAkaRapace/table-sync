/*
 * LA TABLE DES MATIÈRES — direction contract (seed a2d2d2c4, surface candidate 4)
 * THESIS: The opened party is a volume's table of contents — reading order is the
 * hierarchy (your character, the table, the annexes), refusing the dashboard of
 * a button-soup header over card grids.
 * OWN-WORLD: volume title over the double head rule, Cinzel roman section
 * numerals, ruled dot-leader rows, one blood-inked door per visitor.
 * STORY: A player lands, reads entry I, and is inside their sheet in one tap;
 * the MD reads the same contents where every row is a door and the annexes
 * carry the code.
 * FIRST VIEWPORT: centered volume title + meta under the head rule, section I
 * with the visitor's character as the expanded entry carrying « Ouvrir → »,
 * sections II–III ruled beneath with staggered register-rise.
 * FORM: table of contents, single measure, mobile-first, light-only.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md
 */

import type { CharacterSummary, PartyDetail, PartyRole } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, LoadingSpinner } from '../components/ui';
import { useSyncEvent } from '../sync';
import { copyText, plural } from '../utils';

// ---------- Small pieces of the contents ----------

function RoleBadge({ role }: { role: PartyRole }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        role === 'gm' ? 'bg-blood-600 text-white' : 'bg-parchment-200 text-ink-700'
      }`}
    >
      {role === 'gm' ? 'MD' : 'Joueur'}
    </span>
  );
}

/** Classe + niveau, race — the identity line under a character name. */
function charMeta(c: CharacterSummary): string {
  const parts: string[] = [];
  if (c.classes && c.classes.length > 1) {
    parts.push(c.classes.map((e) => `${e.classKey} ${e.level}`).join(' / '));
  } else if (c.characterClass) {
    parts.push(c.level ? `${c.characterClass} ${c.level}` : c.characterClass);
  }
  if (c.race) parts.push(c.race);
  return parts.join(' · ');
}

/** Round portrait; the blood ring marks your own seat (section I doors only). */
function Portrait({
  c,
  own = false,
  size = 'md',
}: {
  c: CharacterSummary;
  own?: boolean;
  size?: 'md' | 'sm';
}) {
  const ring = own ? 'border-blood-300' : 'border-parchment-300';
  const box = size === 'sm' ? 'h-10 w-10' : 'h-14 w-14';
  const letter = size === 'sm' ? 'text-base' : 'text-xl';
  if (c.portraitUrl) {
    return (
      <img
        src={c.portraitUrl}
        alt=""
        className={`shrink-0 rounded-full border-2 object-cover ${ring} ${box}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border-2 bg-parchment-100 font-display text-ink-500 ${ring} ${box} ${letter}`}
    >
      {c.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The dotted run between a table-of-contents label and its trailing value. */
function DotLeader() {
  return (
    <span
      aria-hidden="true"
      className="mx-2 min-w-6 flex-1 self-center border-b border-dotted border-parchment-300"
    />
  );
}

function TocHeader({ numeral, title, id }: { numeral: string; title: string; id: string }) {
  return (
    <div className="pb-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="w-8 shrink-0 text-right font-display text-base text-ink-300"
        >
          {numeral}
        </span>
        <h2 id={id} className="section-title">
          {title}
        </h2>
        <span
          aria-hidden="true"
          className="min-w-4 flex-1 self-center border-b border-parchment-200"
        />
      </div>
    </div>
  );
}

/** A ruled annex line that opens somewhere — tool glyph, label, arrow chip. */
function TocLink({ to, label, glyph }: { to: string; label: string; glyph: string }) {
  return (
    <li className="border-b border-parchment-200">
      <Link
        to={to}
        className="group -mx-3 flex items-center gap-3 rounded-lg px-3 py-3.5 transition-colors hover:bg-parchment-100/70"
      >
        <span aria-hidden="true" className="shrink-0 text-lg">
          {glyph}
        </span>
        <span className="text-sm font-medium text-ink-800">{label}</span>
        <DotLeader />
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-parchment-300 text-sm text-ink-500 transition-colors group-hover:border-blood-600 group-hover:text-blood-600"
        >
          →
        </span>
      </Link>
    </li>
  );
}

/**
 * Section II rows: another member's characters. The MD can open any sheet
 * (quiet ink doors); a player sees them listed but locked — the API allows
 * member view, but by design only your own fiche is a door from this page.
 */
function MemberCharacters({
  characters,
  isGM,
  partyId,
}: {
  characters: CharacterSummary[];
  isGM: boolean;
  partyId: string;
}) {
  const { t } = useTranslation();
  if (characters.length === 0) {
    return <p className="mt-1.5 text-xs italic text-ink-400">{t('party.sans.personnage')}</p>;
  }
  if (!isGM) {
    return (
      <ul className="mt-2 list-none space-y-1">
        {characters.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-0.5">
            <Portrait c={c} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink-600">{c.name}</span>
              {charMeta(c) && (
                <span className="mt-0.5 block truncate text-xs text-ink-400">{charMeta(c)}</span>
              )}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-xs text-ink-300"
              title={t('party.seul.son.joueur.peut.ouvrir.cette')}
            >
              🔒
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="mt-2 list-none">
      {characters.map((c) => (
        <li key={c.id}>
          <Link
            to={`/party/${partyId}/character/${c.id}`}
            className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-parchment-100/70"
            aria-label={t('party.ouvrir.la.fiche.de.c.name', { c_name: c.name })}
          >
            <Portrait c={c} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink-800">{c.name}</span>
              {charMeta(c) && (
                <span className="mt-0.5 block truncate text-xs text-ink-400">{charMeta(c)}</span>
              )}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-sm text-ink-300 transition-colors group-hover:text-blood-600"
            >
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------- The volume's table of contents ----------

export default function PartyPage() {
  const { t } = useTranslation();
  const { partyId } = useParams();
  const { user } = useAuth();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 403 from the detail route: the visitor was removed/banned (or never joined).
  const [notMember, setNotMember] = useState(false);
  // Live 'disband' sync event: the MD dissolved the whole party — dedicated copy.
  const [disbanded, setDisbanded] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteCopyFailed, setInviteCopyFailed] = useState(false);
  // Chronique annex: shown only once a GM Assistant campaign is linked.
  const [gmaLinked, setGmaLinked] = useState(false);

  const loadGmaLink = useCallback(async () => {
    if (!partyId) return;
    try {
      const res = await api.get(`/api/parties/${partyId}/gma/link`);
      setGmaLinked(!!res.data?.linked);
    } catch {
      setGmaLinked(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadGmaLink();
  }, [loadGmaLink]);

  const load = useCallback(
    async (silent = false) => {
      if (!partyId) return;
      if (!silent) setLoading(true);
      try {
        const res = await api.get(`/api/parties/${partyId}`);
        setParty(res.data);
        setError('');
        setNotMember(false);
      } catch (err: any) {
        if (err.response?.status === 403) {
          // Kicked live (party:change 'remove'/'ban' reloads into this) or stale link.
          setNotMember(true);
        } else {
          setError(err.response?.data?.error || 'Groupe introuvable');
        }
      } finally {
        setLoading(false);
      }
    },
    [partyId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Real-time sync: refresh when party membership or characters change
  const currentPartyId = Number(partyId);
  useSyncEvent(
    (event) => {
      if (event.partyId !== currentPartyId) return;
      if (event.action === 'disband') {
        // The party row is GONE (cascade) — a reload would only 403.
        setDisbanded(true);
        return;
      }
      if (event.type === 'gma:change') {
        // Link/unlink/resync — only the annex visibility lives on this page.
        loadGmaLink();
        return;
      }
      load(true); // silent — no spinner flash on sync updates
    },
    [currentPartyId],
  );

  function copyInvite() {
    if (!party) return;
    copyText(party.party.inviteCode).then((ok) => {
      setInviteCopied(ok);
      setInviteCopyFailed(!ok);
      setTimeout(() => {
        setInviteCopied(false);
        setInviteCopyFailed(false);
      }, 2000);
    });
  }

  if (loading) return <LoadingSpinner label="Ouverture du groupe…" />;
  if (disbanded) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 pt-10 text-center">
        <h1 className="font-display text-2xl font-bold">{t('party.le.groupe.a.ete.dissous')}</h1>
        <p className="text-sm text-ink-400">{t('party.le.md.a.ferme.la.table')}</p>
        <div>
          <Link to="/parties" className="btn-secondary inline-block">
            {t('party.mes.groupes')}
          </Link>
        </div>
      </div>
    );
  }
  if (notMember) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 pt-10 text-center">
        <h1 className="font-display text-2xl font-bold">{t('party.tu.ne.fais.plus.partie.de')}</h1>
        <p className="text-sm text-ink-400">{t('party.le.md.t.a.retire.de')}</p>
        <div>
          <Link to="/parties" className="btn-secondary inline-block">
            {t('party.mes.groupes')}
          </Link>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3">
        <ErrorMsg message="Le groupe n'a pas pu être ouvert — vérifie la connexion." />
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={() => load()}>
            {t('party.reessayer')}
          </button>
        </div>
      </div>
    );
  }
  if (!party) return <ErrorMsg message="Groupe introuvable" />;

  const isGM = party.members.some((m) => m.userId === user?.id && m.role === 'gm');
  const myCharacters = party.characters.filter((c) => c.ownerId === user?.id);
  const others = party.members.filter((m) => m.userId !== user?.id);
  const charsByOwner = new Map<number, CharacterSummary[]>();
  for (const c of party.characters) {
    if (c.ownerId === user?.id) continue;
    const list = charsByOwner.get(c.ownerId) ?? [];
    list.push(c);
    charsByOwner.set(c.ownerId, list);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Volume title over the head rule */}
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{party.party.name}</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          {plural(party.members.length, 'joueur')} · {plural(party.characters.length, 'personnage')}{' '}
          · {encumbranceLabel(party.party.encumbranceMode)}
        </p>
      </header>
      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      {/* I — Ton personnage : la seule porte en sang de la page */}
      <section className="register-rise pt-6" style={{ animationDelay: '60ms' }}>
        <TocHeader numeral="I" title={t('party.ton.personnage')} id="toc-mine" />
        {myCharacters.length === 0 ? (
          <div className="border-b border-parchment-200 py-5">
            <p className="text-sm text-ink-500">{t('party.tu.n.as.pas.encore.de')}</p>
            <Link to={`/party/${partyId}/create`} className="btn-primary mt-4 inline-block">
              {t('party.creer.mon.personnage')}
            </Link>
          </div>
        ) : (
          <ul className="list-none">
            {myCharacters.map((c) => (
              <li key={c.id} className="border-b border-parchment-200">
                <Link
                  to={`/party/${partyId}/character/${c.id}`}
                  className="-mx-3 flex items-center gap-4 rounded-lg px-3 py-4 transition-colors hover:bg-parchment-100/70"
                  aria-label={t('party.ouvrir.la.fiche.de.c.name', { c_name: c.name })}
                >
                  <Portrait c={c} own />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-display text-xl font-bold leading-tight">
                        {c.name}
                      </span>
                      {c.hidden && (
                        <span
                          className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600"
                          title={t('party.invisible.des.autres.joueurs.le.md')}
                        >
                          {t('party.cache')}
                        </span>
                      )}
                    </span>
                    {charMeta(c) && (
                      <span className="mt-1 block truncate text-sm text-ink-500">
                        {charMeta(c)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-medium text-blood-600">
                    {t('party.ouvrir')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {myCharacters.length > 0 && (
          <div className="pt-3">
            <Link to={`/party/${partyId}/create`} className="btn-ghost inline-block text-ink-500">
              {t('party.nouveau.personnage')}
            </Link>
          </div>
        )}
      </section>

      {/* II — La table : visible de tous, ouvrable par son joueur seul */}
      <section className="register-rise pt-8" style={{ animationDelay: '120ms' }}>
        <TocHeader numeral="II" title={t('party.la.table')} id="toc-table" />
        {others.length === 0 ? (
          <p className="border-b border-parchment-200 py-5 text-sm text-ink-400">
            {t('party.personne.d.autre.a.la.table')}
          </p>
        ) : (
          <ul className="list-none">
            {others.map((m) => (
              <li key={m.userId} className="border-b border-parchment-200 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-semibold text-ink-800">
                      {m.displayName}
                    </span>
                    <span className="shrink-0 text-xs text-ink-400">@{m.username}</span>
                  </p>
                  <RoleBadge role={m.role} />
                </div>
                <MemberCharacters
                  characters={charsByOwner.get(m.userId) ?? []}
                  isGM={isGM}
                  partyId={partyId!}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* III — Outils & annexes */}
      <section className="register-rise pt-8" style={{ animationDelay: '180ms' }}>
        <TocHeader numeral="III" title={t('party.outils.annexes')} id="toc-tools" />
        <ul className="list-none">
          {isGM && <TocLink to={`/party/${partyId}/gm`} label="Table du MD" glyph="🛡" />}
          <TocLink to={`/party/${partyId}/combat`} label="Combat" glyph="⚔" />
          {gmaLinked && <TocLink to={`/party/${partyId}/chronique`} label="Chronique" glyph="📜" />}
          <TocLink to={`/party/${partyId}/npcs`} label="PNJ" glyph="🎭" />
          {isGM && (
            <li className="flex items-center border-b border-parchment-200 py-3.5 pl-3 pr-3">
              <span className="text-sm font-medium text-ink-800">
                {t('party.code.d.invitation')}
              </span>
              <DotLeader />
              <code className="shrink-0 font-mono text-sm font-semibold tracking-[0.2em] text-ink-800">
                {party.party.inviteCode}
              </code>
              <button
                type="button"
                className={`ml-3 shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  inviteCopied
                    ? 'border-blood-600 text-blood-600'
                    : 'border-parchment-300 text-ink-700 hover:border-blood-600 hover:text-blood-600'
                }`}
                onClick={copyInvite}
                aria-label={t('party.copier.le.code.d.invitation.party', {
                  party_party_inviteCode: party.party.inviteCode,
                })}
              >
                {inviteCopied ? 'Copié ✓' : inviteCopyFailed ? 'Copie impossible' : 'Copier'}
              </button>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function encumbranceLabel(mode: string): string {
  switch (mode) {
    case 'variant':
      return 'Variante (kg)';
    case 'standard':
      return 'Standard (kg)';
    case 'slots':
      return 'Emplacements';
    default:
      return mode;
  }
}
