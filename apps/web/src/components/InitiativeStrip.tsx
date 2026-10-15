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
 * MOTION (le moment signé du rail) — LA RELÈVE : au passage de tour, la
 *   dent servie QUITTE la tête — soulevée du plan du rail (ombre de vol),
 *   elle survole la file et se pose en queue, seule au-dessus du rang —
 *   PUIS la file cascade : chaque dent glisse d'une place vers la tête,
 *   l'une après l'autre (la nouvelle meneuse première, le filet de manche
 *   avec elles). WAAPI en translate, interruption propre (les vols en cours
 *   s'annulent), retour du défilement à 0. La relève ne vit que sur un vrai
 *   RÉORDONNANCEMENT (signature d'ordre : PV, conditions, largeurs ne
 *   déclenchent RIEN) ; un réordonnancement structurel (arrivée/départ)
 *   glisse tout le monde ensemble, discret. Sous prefers-reduced-motion :
 *   réassise immédiate, le sang arrive sans course (l'état reste lisible).
 * GOTCHA (leçon 2026-10, la « re-distribution fantôme ») : le délai du deal
 *   d'une dent est FIGÉ AU MONTAGE — le recalculer à chaque rendu depuis sa
 *   position changeait animation-delay d'une animation FINIE, et le
 *   navigateur la rejouait alors de zéro : chaque passage de tour
 *   redistribuait TOUTES les dents (l'effet « cartes retirées/réajoutées »).
 *   De même, la relève se mesure en rect du <li> relatif à l'ol (le
 *   offsetLeft de la dent interne change de repère quand son <li> porte une
 *   transform — deal, exit).
 * FORM: lecture seule — aucune interaction sur les dents, la description
 *   verbale vit dans un sr-only par dent (le visuel est aria-hidden).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, and DESIGN.md.
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
/** La clé du filet de manche dans la signature d'ordre et le FLIP. */
const FILET_KEY = '|';
/** La relève, temps 1 : de combien la dent servie se soulève du plan. */
const LIFT_PX = 12;
/** Temps 1-2 — le voyage tête → queue (retours test 2026-10 : ~600 ms pour
 *  LIRE le voyage). */
const TRAVELER_MS = 620;
/** La bande d'un groupe voyage décalée — la tête de bande première. */
const GROUP_STAGGER_MS = 50;
/** Temps 3 — la file démarre quand la voyageuse entame sa descente. */
const CASCADE_BASE_MS = 520;
/** Temps 3 — l'écart de la cascade : une place, l'une après l'autre. */
const CASCADE_STAGGER_MS = 55;
/** Un glissement de la cascade : la dent avance d'une place. */
const SHIFT_MS = 300;
/** Plafond de l'écart : une longue file ne rallonge pas la cascade. */
const CASCADE_MAX_STEPS = 8;
/** Réordonnancement structurel (arrivée/départ) : glissement groupé, discret. */
const RESHUFFLE_MS = 420;
/** L'ombre de la table — posée (la dent courante part du shadow-sm). */
const SHADOW_TABLE = '0 1px 2px 0 rgb(29 26 22 / 0.08)';
/** L'ombre de vol — la carte quitte le plan du rail. */
const SHADOW_FLIGHT = '0 12px 22px -6px rgb(29 26 22 / 0.28)';
/** Rentry — la carte se pose en queue, plain-pied du rang. */
const SHADOW_LANDED = '0 0px 0px 0 rgb(29 26 22 / 0)';

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

/** Un item mesurable du rail : le <li> (la place, en rect relatif à l'ol)
 *  et la carte qui vole (la dent interne ; le filet EST sa propre carte). */
type FlipEntry = { li: HTMLElement; card: HTMLElement };

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

  // ---------- La relève (FLIP en trois temps) ----------
  // Le passage de tour n'est pas un réempilement : la dent servie QUITTE la
  // tête (soulevée du plan du rail, ombre de vol, posée en queue — seule
  // au-dessus du rang), PUIS la file cascade d'une place vers la tête,
  // l'une après l'autre. Le filet de manche cascade avec elles : c'est un
  // item de la file comme les autres. Une mise à jour qui ne réordonne PAS
  // (PV, conditions, largeurs) ne déclenche RIEN — la relève ne vit que sur
  // la SIGNATURE d'ordre, mesurée en rect de CONTENU (<li> relatif à l'ol,
  // scroll compris — le offsetLeft de la dent interne est sans garantie dès
  // qu'un parent porte une transform, voir le GOTCHA d'en-tête).
  const olRef = useRef<HTMLOListElement>(null);
  const flipEls = useRef(new Map<string, FlipEntry>());
  const prevLayout = useRef<{ id: number; sig: string; lefts: Map<string, number> } | null>(null);
  const prevExiting = useRef(false);
  const flights = useRef(new Set<Animation>());
  useLayoutEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    // Coordonnées de contenu : rect du <li> moins rect de l'ol, PLUS le
    // défilement (indépendant de tout offsetParent et de toute transform
    // d'ancêtre — l'entrée de page bandeau/fourreau ne fausse pas la mesure).
    const olX = ol.getBoundingClientRect().left - ol.scrollLeft;
    const lefts = new Map<string, number>();
    flipEls.current.forEach((entry, key) => {
      lefts.set(key, entry.li.getBoundingClientRect().left - olX);
    });
    const sig = items.map((it) => (it.kind === 'round' ? FILET_KEY : it.c.id)).join('›');
    const prev = prevLayout.current;
    prevLayout.current = { id: encounter.id, sig, lefts };
    // Fin de combat : les vols en cours s'arrêtent net — l'exit CSS prend la main.
    if (exiting && !prevExiting.current) flights.current.forEach((a) => a.cancel());
    prevExiting.current = exiting;
    if (
      !prev ||
      prev.id !== encounter.id || // autre rencontre : c'est une arrivée (deal), pas une relève
      prev.sig === sig // ordre inchangé : rien ne bouge (les mesures repartent à jour)
    )
      return;
    ol.scrollTo({ left: 0 }); // la nouvelle tête est au début du contenu (auto en reduced)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Une relève interrompt les vols en cours : on rejoue depuis le mesuré.
    flights.current.forEach((a) => a.cancel());
    flights.current.clear();
    const track = (a: Animation) => {
      flights.current.add(a);
      a.finished.then(() => flights.current.delete(a)).catch(() => {});
    };
    const dxOf = (key: string): number | null => {
      const before = prev.lefts.get(key);
      const now = lefts.get(key);
      // Absent de l'un des deux layouts : une dent qui arrive monte avec
      // SON deal, une dent partie n'a plus de place — ni l'une ni l'autre
      // ne volent.
      return before !== undefined && now !== undefined && before !== now ? before - now : null;
    };

    // La relève ? La TÊTE de l'ancien ordre ferme la FILE du nouveau — la
    // bande entière d'un groupe qui joue ensemble, et une double avance
    // coalescée emmène sa bande d'un coup : on garde le PLUS LONG match.
    const oldOrder = prev.sig.split('›');
    const newOrder = sig.split('›');
    let run = 0;
    const maxRun = Math.min(oldOrder.length, newOrder.length - 1);
    for (let k = 1; k <= maxRun; k++) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (oldOrder[i] !== newOrder[newOrder.length - k + i]) {
          ok = false;
          break;
        }
      }
      if (ok) run = k;
    }

    if (run === 0) {
      // Réordonnancement structurel (arrivée, départ) : pas de récit —
      // tout le monde glisse ensemble, discret.
      flipEls.current.forEach((entry, key) => {
        const dx = dxOf(key);
        if (dx === null) return;
        track(
          entry.card.animate(
            [{ transform: `translate(${dx}px, 0px)` }, { transform: 'translate(0px, 0px)' }],
            { duration: RESHUFFLE_MS, easing: EASE_OUT },
          ),
        );
      });
      return;
    }

    // Temps 1-2 : la bande servie voyage — FLIP ancré à son ANCIENNE place
    // (transform initial dx = ancienne − nouvelle) : soulevée du plan (temps
    // 1, ombre de vol), survol de la file, pose en queue (temps 2). Fill
    // backwards : une dent de bande retardée tient la tête pendant son
    // écart interne. Les dents servies sont les DERNIÈRES du DOM : elles
    // peignent au-dessus du rang sans z-index à gérer. L'allure vit dans le
    // PLACEMENT des keyframes (interpolation linéaire) : un easing PAR
    // keyframe, combiné aux offsets explicites des autres, fausse le
    // découpage des segments en Chromium (le voyage entier se jouait en
    // ~240 ms — constaté en
    // test, repro isolé à l'appui).
    for (let i = 0; i < run; i++) {
      const key = oldOrder[i];
      const entry = flipEls.current.get(key);
      const dx = dxOf(key);
      if (!entry || dx === null) continue;
      track(
        entry.card.animate(
          [
            { transform: `translate(${dx}px, 0px)`, boxShadow: SHADOW_TABLE },
            {
              transform: `translate(${dx}px, -${LIFT_PX * 0.75}px)`,
              boxShadow: SHADOW_FLIGHT,
              offset: 0.1,
            },
            {
              transform: `translate(${dx * 0.94}px, -${LIFT_PX}px)`,
              boxShadow: SHADOW_FLIGHT,
              offset: 0.27,
            },
            {
              transform: `translate(${dx / 2}px, -${LIFT_PX}px)`,
              boxShadow: SHADOW_FLIGHT,
              offset: 0.62,
            },
            {
              transform: `translate(${dx * 0.07}px, -${LIFT_PX * 0.33}px)`,
              boxShadow: SHADOW_TABLE,
              offset: 0.88,
            },
            { transform: 'translate(0px, 0px)', boxShadow: SHADOW_LANDED },
          ],
          { duration: TRAVELER_MS, delay: i * GROUP_STAGGER_MS, fill: 'backwards' },
        ),
      );
    }

    // Temps 3 : la file cascade — la nouvelle meneuse part première, la
    // suite suit, l'écart plafonné (une longue file ne rallonge pas la
    // relève). fill backwards : PENDANT son délai la dent est TENUE à sa
    // keyframe de départ (son ancienne place) — sans lui elle se peint à sa
    // nouvelle place dès le commit puis REMPART en arrière quand son
    // animation démarre (l'à-coup constaté en démo : « les cartes sont
    // déjà à la première place pendant le soulèvement »).
    for (let pos = 0; pos < newOrder.length - run; pos++) {
      const key = newOrder[pos];
      const entry = flipEls.current.get(key);
      const dx = dxOf(key);
      if (!entry || dx === null) continue;
      track(
        entry.card.animate(
          [{ transform: `translate(${dx}px, 0px)` }, { transform: 'translate(0px, 0px)' }],
          {
            duration: SHIFT_MS,
            delay: CASCADE_BASE_MS + Math.min(pos, CASCADE_MAX_STEPS) * CASCADE_STAGGER_MS,
            easing: EASE_OUT,
            fill: 'backwards',
          },
        ),
      );
    }
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
          onAnimationEnd={(e) => {
            // Déplacer un <li> (réordonnancement) REJOUE ses animations CSS
            // finies en Chromium — y compris le deal du montage (fondu
            // compris) : la dent déplacée avait l'air retirée puis
            // réajoutée à chaque passage de tour. Le deal n'appartient
            // qu'au MONTAGE : sa classe se retire dès qu'il a joué. Le
            // retrait d'une classe absente est sans effet (filet, repère).
            (e.target as HTMLElement).classList.remove('rail-deal', 'rail-filet');
          }}
          className="list-none flex h-full gap-1 overflow-x-auto scroll-smooth motion-reduce:scroll-auto"
        >
          {items.map((item, i) => {
            // Le deal, une à une — délai plafonné : une longue liste ne
            // rallonge pas l'arrivée (la queue se pose avec le 7e temps).
            const dealDelay = `${Math.min(i + 1, 7) * 60}ms`;
            return item.kind === 'round' ? (
              // Le filet de manche : l'ordre s'enroule ici — ces dents
              // jouent au tour suivant. Item de la file comme les autres :
              // il cascade avec les dents (FLIP sur le <li>), sa pose à lui
              // est un fondu (rail-filet, index.css).
              <li
                key={`round-${encounter.round}`}
                ref={(el) => {
                  if (el) flipEls.current.set(FILET_KEY, { li: el, card: el });
                  else flipEls.current.delete(FILET_KEY);
                }}
                className="rail-item rail-filet flex shrink-0 flex-col items-center justify-center gap-1 px-0.5"
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
                flipEls={flipEls}
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
  flipEls,
  dealDelay,
}: {
  c: Combatant;
  label: string;
  isCurrent: boolean;
  mine: boolean;
  flipEls: RefObject<Map<string, FlipEntry>>;
  /** Délai du deal (montage du rail) — FIGÉ au premier rendu : le délai
   *  appartient au MONTAGE de la dent, jamais à sa position courante (le
   *  GOTCHA d'en-tête : changer animation-delay rejoue l'animation finie). */
  dealDelay: string;
}) {
  const { t } = useTranslation();
  // Le deal de CETTE dent, décidé une fois pour toutes à son montage.
  const mountDealDelay = useRef(dealDelay).current;
  const liRef = useRef<HTMLLIElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Enregistrement post-refs (effet enfant → tourne AVANT la mesure du
  // parent) : le <li> sert à mesurer la place, la carte à voler.
  useLayoutEffect(() => {
    const key = String(c.id);
    const els = flipEls;
    if (liRef.current && cardRef.current) {
      els.current.set(key, { li: liRef.current, card: cardRef.current });
    }
    return () => {
      els.current.delete(key);
    };
  }, [c.id, flipEls]);
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
    <li
      ref={liRef}
      className="rail-item rail-deal shrink-0"
      style={{ animationDelay: mountDealDelay }}
    >
      <div
        ref={cardRef}
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
