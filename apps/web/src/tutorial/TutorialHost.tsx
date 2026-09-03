/**
 * Hôte de la visite guidée — monté une fois par CharacterInventoryPage.
 * Déclenchement (docs/tutorial-script.md §16) : drapeau localStorage
 * `dnd-inv-tour-seen` absent → chaîne Bienvenue → Survie après chargement ;
 * la fin comme l'abandon (« Passer », Échap) écrit le drapeau. Seul un script
 * TERMINÉ enchaîne (Passer arrête tout). Le rejeu passe par « Mon compte →
 * Réinitialiser le tutoriel », qui efface le drapeau.
 */

import type { Character } from '@table-sync/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type EventData, useJoyride } from 'react-joyride';
import {
  buildJoyrideSteps,
  buildTutorialCtx,
  TUTORIAL_SCRIPTS,
  type TutorialCtx,
  type TutorialScriptId,
  type TutorialTab,
} from './scripts';
import { markTutorialSeen, markTutorialTabDone } from './serverSync';
import { TutorialTooltip } from './TutorialTooltip';

function useViewport(): 'mobile' | 'desktop' {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop ? 'desktop' : 'mobile';
}

interface TutorialRunnerProps {
  scriptId: TutorialScriptId;
  ctx: TutorialCtx;
  viewport: 'mobile' | 'desktop';
  onNavigateTab: (tab: TutorialTab) => void;
  onEnd: (scriptId: TutorialScriptId, completed: boolean) => void;
}

/** Un usage du hook = une visite complète ; le key={scriptId} du parent
 *  remonte un runner neuf quand on enchaîne sur le script suivant. */
function TutorialRunner({ scriptId, ctx, viewport, onNavigateTab, onEnd }: TutorialRunnerProps) {
  const { t } = useTranslation();
  const endedRef = useRef(false);
  const script = TUTORIAL_SCRIPTS[scriptId];
  // Le contexte se fige au lancement (§2.3 du document) : une synchro WS qui
  // rafraîchit la fiche en pleine visite ne doit pas reconstruire les étapes.
  const ctxRef = useRef(ctx);

  const steps = useMemo(
    () => buildJoyrideSteps(script, ctxRef.current, { viewport, t, onNavigateTab }),
    [script, viewport, t, onNavigateTab],
  );

  const locale = useMemo(
    () => ({
      back: t('tuto.retour'),
      close: t('tuto.passer'),
      last: t('tuto.terminer'),
      next: t('tuto.suivant'),
      skip: t('tuto.passer'),
    }),
    [t],
  );

  const handleEvent = useCallback(
    (data: EventData) => {
      if (endedRef.current) return;
      if (data.status === 'finished' || data.status === 'skipped') {
        endedRef.current = true;
        onEnd(scriptId, data.status === 'finished');
      }
    },
    [onEnd, scriptId],
  );

  const { Tour, controls, state } = useJoyride({
    run: true,
    steps,
    continuous: true,
    locale,
    tooltipComponent: TutorialTooltip,
    onEvent: handleEvent,
    options: {
      skipBeacon: true,
      spotlightPadding: 8,
      spotlightRadius: 12,
      // Contrat maison : l'overlay ne clique pas, Échap quitte (ci-dessous).
      overlayClickAction: false,
      dismissKeyAction: false,
      zIndex: 100,
      overlayColor: '#292524cc',
      buttons: ['skip', 'back', 'primary'],
    },
    floatingOptions: { hideArrow: true },
  });

  // Échap quitte la visite — le `close` natif de joyride ne fait qu'avancer
  // d'une étape, le contrat dialog maison veut une sortie franche.
  useEffect(() => {
    if (state.status !== 'running') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controls.skip('button_close');
    };
    document.body.addEventListener('keydown', onKey, { passive: true });
    return () => document.body.removeEventListener('keydown', onKey);
  }, [controls, state.status]);

  return Tour;
}

interface TutorialHostProps {
  character: Character;
  canEdit: boolean;
  activeTab: TutorialTab;
  onNavigateTab: (tab: TutorialTab) => void;
}

export const TUTORIAL_SEEN_KEY = 'dnd-inv-tour-seen';
/** Onglets dont la visite propre a déjà été jouée (JSON array d'ids). */
export const TUTORIAL_TABS_DONE_KEY = 'dnd-inv-tour-tabs';

/** Lecture locale (convergée avec le serveur au chargement de session). */
export function readDoneTabs(): string[] {
  try {
    const raw = localStorage.getItem(TUTORIAL_TABS_DONE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function TutorialHost({ character, canEdit, activeTab, onNavigateTab }: TutorialHostProps) {
  const viewport = useViewport();
  const [scriptId, setScriptId] = useState<TutorialScriptId | null>(null);
  const startedRef = useRef(false);
  const prevTabRef = useRef<TutorialTab | null>(null);
  const ctx = useMemo(() => buildTutorialCtx(character, canEdit), [character, canEdit]);

  // Départ : drapeau absent + fiche chargée (le character arrive avec la query).
  // Le drapeau est convergé avec le serveur par AuthProvider AVANT le premier
  // rendu de page (gate loading) — ici, localStorage reflète déjà le compte.
  useEffect(() => {
    if (startedRef.current || !character) return;
    let seen = true;
    try {
      seen = !!localStorage.getItem(TUTORIAL_SEEN_KEY);
    } catch {
      seen = true;
    }
    if (seen) {
      startedRef.current = true;
      return;
    }
    // Le garde ne se lève qu'au déclenchement : un rafraîchissement de la
    // fiche dans les 800 ms annule et relance le minuteur, sans le tuer.
    const timer = setTimeout(() => {
      startedRef.current = true;
      setScriptId('shell');
    }, 800);
    return () => clearTimeout(timer);
  }, [character]);

  // Visite propre d'onglet : le premier passage sur un onglet non vu (une fois
  // la visite d'accueil passée) déclenche son script. Uniquement aux
  // CHANGEMENTS d'onglet — pas au montage — pour qu'un « Passer » sur
  // l'accueil n'enchaîne pas aussitôt sur la Survie déjà affichée.
  useEffect(() => {
    const previous = prevTabRef.current;
    prevTabRef.current = activeTab;
    if (!character || scriptId || previous === null || previous === activeTab) return;
    let seen = false;
    try {
      seen = !!localStorage.getItem(TUTORIAL_SEEN_KEY);
    } catch {
      /* bloqué : ne pas déclencher */
    }
    if (!seen || readDoneTabs().includes(activeTab)) return;
    const timer = setTimeout(() => setScriptId(activeTab), 500);
    return () => clearTimeout(timer);
  }, [character, scriptId, activeTab]);

  const handleEnd = useCallback((ended: TutorialScriptId, completed: boolean) => {
    markTutorialSeen();
    if (ended !== 'shell') markTutorialTabDone(ended);
    const chain = TUTORIAL_SCRIPTS[ended].chain;
    // Seul un script terminé enchaîne ; « Passer » arrête la visite entière.
    setScriptId(completed && chain ? chain : null);
  }, []);

  if (!scriptId) return null;
  return (
    <TutorialRunner
      key={scriptId}
      scriptId={scriptId}
      ctx={ctx}
      viewport={viewport}
      onNavigateTab={onNavigateTab}
      onEnd={handleEnd}
    />
  );
}
