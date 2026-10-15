/**
 * Rail d'initiative de la fiche joueur — l'ordre du combat sans quitter sa
 * fiche, en lecture seule.
 *
 * THESIS: « qui joue MAINTENANT, qui vient ensuite » — le rail déroule
 *   l'ordre en CERCLE depuis le combattant courant (toujours en tête) ;
 *   le filet de manche marque là où le tour revient au début de l'ordre.
 * OWN-WORLD: le dialecte est celui de l'échelle de la page Combat (dent de
 *   52 px : initiative mono, marque de couleur, nom, compte de conditions,
 *   HpBar quand les PV sont visibles, état apparent sinon) ; la dent courante
 *   porte le sang (« maintenant »), la marque « toi » est un anneau d'encre —
 *   jamais un second élément sang.
 * STORY: le rail vit dans le flux, sous le bandeau « État du personnage », à
 *   la même place sur mobile et desktop ; la carte dockée (mobile) garde
 *   l'acteur courant au pouce quand la page défile.
 * MOTION (le moment signé du rail) : au passage de tour, l'ordre se REASSOIT
 *   autour du nouveau « maintenant » — l'ancienne dent courante voyage en
 *   fin d'ordre, la nouvelle glisse en tête et prend le sang, le filet de
 *   manche tombe à son endroit d'enroulement. FLIP en translateX (coordonnées
 *   de CONTENU — le défilement ne pollue pas la mesure), courbe maison
 *   380 ms, retour domicile du défilement ; sous prefers-reduced-motion :
 *   réassise immédiate, le sang arrive sans course (l'état reste lisible).
 * FORM: lecture seule — aucune interaction sur les dents, la description
 *   verbale vit dans un sr-only par dent (le visuel est aria-hidden).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

import type { Combatant, EncounterDetail } from '@table-sync/shared';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  cardColorDisplay,
  conditionsTitle,
  feelingDot,
  feelingPhraseKey,
  hpVisible,
  numberedCombatantLabels,
} from '../combatDisplay';
import { HpBar } from './ui';

/** La courbe de sortie de la maison (index.css la partage). */
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Réassise — retours test 2026-10 : 640 ms pour LIRE le voyage. */
const RESEAT_MS = 640;
/** L'arc : de combien la dent se soulève à mi-course (on suit celle qui
 *  part vers le fond du rail pendant la réassise). */
const ARC_LIFT = 10;

type RailItem = { kind: 'dent'; c: Combatant; idx: number } | { kind: 'round' };

/**
 * Ordre circulaire : la dent courante (son GROUPE entier) ouvre la marche,
 * les suivants dans l'ordre du tour, le filet de manche au point où l'ordre
 * s'enroule — suivi des combattants déjà servis ce tour-ci (ils joueront au
 * tour suivant). Préparation/terminée : ordre d'initiative tel quel.
 */
function railItems(combatants: Combatant[], turnIndex: number, active: boolean): RailItem[] {
  const plain = (): RailItem[] => combatants.map((c, idx) => ({ kind: 'dent', c, idx }));
  if (!active || combatants.length === 0) return plain();
  const cur = combatants[turnIndex];
  if (!cur) return plain();
  const inTurn = (c: Combatant) =>
    cur.groupId !== null ? c.groupId === cur.groupId : c.id === cur.id;
  const start = combatants.findIndex(inTurn);
  if (start < 0) return plain();
  const items: RailItem[] = [];
  for (let i = 0; i < combatants.length; i++) {
    const idx = (start + i) % combatants.length;
    items.push({ kind: 'dent', c: combatants[idx], idx });
    // Fin de l'ordre d'origine : le tour s'enroule — un filet si la suite
    // existe (des joués plus tôt ce tour-ci attendent le suivant).
    if (idx === combatants.length - 1 && i < combatants.length - 1) {
      items.push({ kind: 'round' });
    }
  }
  return items;
}

export default function InitiativeStrip({
  encounter,
  myCombatantId,
  exiting = false,
}: {
  encounter: EncounterDetail;
  /** Le combattant du joueur qui regarde sa fiche (marque « toi »). */
  myCombatantId: number | null;
  /** Fin de combat : la distribution est rappelée (dents vers le haut),
   *  la page referme la hauteur du fourreau en parallèle. */
  exiting?: boolean;
}) {
  const { t } = useTranslation();
  const combatants = encounter.combatants;
  const labels = useMemo(() => numberedCombatantLabels(combatants), [combatants]);
  const current = encounter.status === 'active' ? combatants[encounter.turnIndex] : undefined;
  // Les groupes de monstres jouent ensemble : toute la bande est courante.
  const isCurrentDent = (c: Combatant) =>
    !!current && (current.groupId !== null ? c.groupId === current.groupId : c.id === current.id);

  const items = useMemo(
    () => railItems(combatants, encounter.turnIndex, encounter.status === 'active'),
    [combatants, encounter.turnIndex, encounter.status],
  );

  const statusLine =
    encounter.status === 'active'
      ? t('combat.tour', { round: encounter.round })
      : encounter.status === 'setup'
        ? t('widget.preparation')
        : t('combat.terminee.tour', { round: encounter.round });

  // ---------- La réassise (FLIP) ----------
  // Les dents changent de place au passage de tour ; leur déplacement
  // s'anime DEPUIS leur ancienne position (mesurée en offsetLeft —
  // coordonnées de contenu, insensible au défilement). Une simple mise à
  // jour (PV, conditions) ne bouge rien : pas de deltas, pas de course.
  const olRef = useRef<HTMLOListElement>(null);
  const dentRefs = useRef(new Map<number, HTMLDivElement>());
  const prevLefts = useRef(new Map<number, number>());
  useLayoutEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    const lefts = new Map<number, number>();
    dentRefs.current.forEach((el, id) => lefts.set(id, el.offsetLeft));
    const prev = prevLefts.current;
    let moved = false;
    if (prev.size > 0) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      dentRefs.current.forEach((el, id) => {
        const before = prev.get(id);
        if (before === undefined || before === lefts.get(id)) return;
        moved = true;
        if (reduced) return;
        const dx = before - (lefts.get(id) ?? 0);
        // L'ARC : la dent se soulève à mi-course — celle qui part vers le
        // fond du rail reste lisible pendant son voyage (WAAPI : trois temps,
        // compositor seul, l'état final est l'identité — aucun nettoyage).
        el.animate(
          [
            { transform: `translateX(${dx}px)` },
            { transform: `translateX(${dx / 2}px) translateY(-${ARC_LIFT}px)`, offset: 0.5 },
            { transform: 'translateX(0) translateY(0)' },
          ],
          { duration: RESEAT_MS, easing: EASE_OUT },
        );
      });
      if (moved) ol.scrollTo({ left: 0 }); // scroll-smooth (auto en reduced)
    }
    prevLefts.current = lefts;
  });

  return (
    <div className={`flex items-stretch gap-1 pb-1 ${exiting ? 'rail-exiting' : ''}`}>
      {/* Repère de manche — l'horloge du combat en tête de rail, rien de
          plus (retours test 2026-10 : le titre de rencontre ne servait pas).
          PAS un lien : la porte vers le traqueur vit à la carte dockée
          (mobile) et à la pilule d'en-tête (desktop). Le deal l'ouvre
          (délai 0), les dents suivent. */}
      <div className="rail-deal flex min-h-[52px] shrink-0 flex-col items-center justify-center rounded-lg border border-parchment-200 bg-parchment-100/60 px-2.5">
        <span className="font-mono text-xs font-semibold text-ink-600">{statusLine}</span>
      </div>
      <nav aria-label={t('combat.ordre.d.initiative')} className="min-w-0 flex-1">
        <ol
          ref={olRef}
          className="list-none flex h-full gap-1 overflow-x-auto scroll-smooth motion-reduce:scroll-auto"
        >
          {items.map((item, i) => {
            // Le deal, une à une — délai plafonné : une longue liste ne
            // rallonge pas l'arrivée (la queue se pose avec le 7e temps).
            const dealDelay = `${Math.min(i + 1, 7) * 60}ms`;
            return item.kind === 'round' ? (
              // Le filet de manche : l'ordre s'enroule ici — ces dents
              // jouent au tour suivant.
              <li
                key={`round-${encounter.round}`}
                className="rail-deal flex shrink-0 flex-col items-center justify-center gap-1 px-0.5"
                style={{ animationDelay: dealDelay }}
                title={t('combat.rail.fin.de.tour')}
              >
                <span aria-hidden="true" className="w-px flex-1 bg-parchment-300" />
                <span className="font-mono text-[10px] text-ink-400">
                  {t('combat.tour', { round: encounter.round + 1 })}
                </span>
                <span aria-hidden="true" className="w-px flex-1 bg-parchment-300" />
              </li>
            ) : (
              <Dent
                key={item.c.id}
                c={item.c}
                label={labels[item.idx] ?? item.c.name}
                isCurrent={isCurrentDent(item.c)}
                mine={item.c.id === myCombatantId}
                dentRefs={dentRefs}
                dealDelay={dealDelay}
              />
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

/** Une dent du rail — lecture seule, verbal en sr-only, titre complet. */
function Dent({
  c,
  label,
  isCurrent,
  mine,
  dentRefs,
  dealDelay,
}: {
  c: Combatant;
  label: string;
  isCurrent: boolean;
  mine: boolean;
  dentRefs: RefObject<Map<number, HTMLDivElement>>;
  /** Délai du deal (montage du rail) — posé sur le <li>, jamais sur la dent
   *  interne que la réassise FLIP transforme. */
  dealDelay: string;
}) {
  const { t } = useTranslation();
  const hp = hpVisible(c);
  const phraseKey = feelingPhraseKey(c);
  const phrase = phraseKey !== null ? t(phraseKey) : null;
  // Indicateur de mort imminente : la vie réelle si visible, sinon
  // le drapeau dérivé serveur — jamais (null ?? 0) (leçon #168).
  const dying =
    !c.defeated &&
    c.type === 'player' &&
    (c.hitPoints !== null ? (c.hitPoints ?? 0) <= 0 : c.dying === true);
  // Description verbale — même grammaire que l'échelle de la page
  // Combat, plus la marque « toi ». Elle sert AUSSI d'info-bulle :
  // le nom d'un combattant de 25+ caractères est tronqué à l'écran,
  // le title le rend entier à la souris.
  const srParts = [
    label,
    c.initiative === null
      ? t('combat.initiative.non.lancee')
      : t('combat.initiative.n', { n: c.initiative }),
  ];
  if (mine) srParts.push(t('band.combat.toi'));
  if (hp) srParts.push(`${c.hitPoints}/${c.maxHitPoints} ${t('combat.pv')}`);
  if (phrase) srParts.push(phrase.toLowerCase());
  if (c.conditions.length > 0)
    srParts.push(t('combat.compteurs.condition', { count: c.conditions.length }));
  if (dying) srParts.push(t('combat.mourant'));
  if (c.defeated) srParts.push(t('combat.vaincu'));
  if (isCurrent) srParts.push(t('combat.tour.en.cours'));
  const dentTitle = srParts.join(' · ');
  return (
    <li className="rail-deal shrink-0" style={{ animationDelay: dealDelay }}>
      <div
        ref={(el) => {
          if (el) dentRefs.current.set(c.id, el);
          else dentRefs.current.delete(c.id);
        }}
        aria-current={isCurrent ? 'true' : undefined}
        title={dentTitle}
        className={`relative flex min-h-[52px] w-auto min-w-24 max-w-44 flex-col justify-center gap-1 rounded-lg border px-2 py-1.5 transition-colors duration-[450ms] motion-reduce:transition-none ${
          isCurrent
            ? 'border-blood-500 bg-blood-600 text-white shadow-sm'
            : `border-parchment-200 bg-parchment-50/80 ${mine ? 'ring-1 ring-ink-400' : ''}`
        } ${c.defeated ? 'opacity-55' : ''}`}
      >
        <span className="sr-only">{srParts.join(', ')}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5" aria-hidden="true">
          <span
            className={`w-5 shrink-0 text-center font-mono text-sm font-bold ${
              isCurrent ? '' : c.initiative === null ? 'text-ink-300' : 'text-ink-500'
            }`}
          >
            {c.initiative ?? '—'}
          </span>
          {c.cardColor && (
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white/85"
              style={{ backgroundColor: cardColorDisplay(c.cardColor) }}
            />
          )}
          <span
            className={`truncate text-xs font-medium lg:text-sm ${c.defeated ? 'line-through' : ''}`}
          >
            {label}
          </span>
          {c.conditions.length > 0 && (
            <span
              className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${
                isCurrent ? 'bg-parchment-50/25' : 'bg-orange-100 text-orange-700'
              }`}
              title={conditionsTitle(c.conditions, t)}
            >
              {c.conditions.length}
            </span>
          )}
          {phrase && (
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white/85 ${feelingDot(c)}`}
              title={t('combat.etat.apparent.phrase', { phrase: phrase })}
            />
          )}
          {c.defeated && (
            <span aria-hidden="true" className="shrink-0 text-xs">
              💀
            </span>
          )}
          {dying && (
            <span aria-hidden="true" className="shrink-0 text-xs" title={t('combat.mourant')}>
              🩸
            </span>
          )}
        </span>
        {hp && (
          <HpBar
            current={c.hitPoints ?? 0}
            max={c.maxHitPoints ?? 1}
            size="xs"
            trackClassName={isCurrent ? 'bg-blood-800/40' : 'bg-parchment-200'}
          />
        )}
      </div>
    </li>
  );
}
