/**
 * Scripts de la visite guidée — miroir 1:1 de docs/tutorial-script.md.
 * Chaque étape référence un conteneur stable via son attribut `data-tuto`
 * (registre §3 du document) ; le texte vient des clés `tuto.<script>.<id>.*`.
 */

import { type Character, classesOf, computeSpellcastingPools } from '@table-sync/shared';
import type { Step } from 'react-joyride';

export type TutorialScriptId =
  | 'shell'
  | 'survival'
  | 'stats'
  | 'skills'
  | 'spells'
  | 'inventory'
  | 'features'
  | 'description'
  | 'npcs'
  | 'notes';

/** Onglets de la fiche (union identique au CharacterTab de la page). */
export type TutorialTab =
  | 'inventory'
  | 'survival'
  | 'stats'
  | 'spells'
  | 'skills'
  | 'features'
  | 'description'
  | 'npcs'
  | 'notes';

/** Contexte d'une étape — prédicats `when` du document (§2.3). */
export interface TutorialCtx {
  isCaster: boolean;
  isDruid: boolean;
  hasDomainSpells: boolean;
  canEdit: boolean;
}

interface TutorialStepDef {
  id: string;
  /** Valeur de l'attribut data-tuto (les deux vues). */
  target?: string;
  /** Cibles distinctes par vue (ex. dock mobile / barre desktop). */
  targets?: { mobile?: string; desktop?: string };
  /** Carte centrée sans cible (ouverture / fermeture). */
  center?: boolean;
  tab?: TutorialTab;
  viewport?: 'mobile' | 'desktop' | 'both';
  when?: (ctx: TutorialCtx) => boolean;
  /** Éléments fixed (dock, hub) — positionnement strategy fixed + sans scroll. */
  fixed?: boolean;
}

export interface TutorialScriptDef {
  id: TutorialScriptId;
  /** Script enchaîné quand celui-ci se TERMINE (Passer n'enchaîne pas). */
  chain?: TutorialScriptId;
  steps: TutorialStepDef[];
}

const tuto = (id: string): string => `[data-tuto="${id}"]`;

export const TUTORIAL_SCRIPTS: Record<TutorialScriptId, TutorialScriptDef> = {
  shell: {
    id: 'shell',
    chain: 'survival',
    steps: [
      { id: 'bienvenue', center: true },
      { id: 'bandeau', target: tuto('band') },
      { id: 'onglets', targets: { mobile: tuto('dock'), desktop: tuto('tabbar') } },
      { id: 'hub', target: tuto('dock-hub'), viewport: 'mobile', fixed: true },
      { id: 'fin', center: true },
    ],
  },
  survival: {
    id: 'survival',
    steps: [
      { id: 'vitalite', target: tuto('survie-vitalite') },
      { id: 'attaques', target: tuto('survie-attaques') },
      { id: 'des-vie', target: tuto('survie-des-vie') },
      { id: 'etats', target: tuto('survie-etats') },
      { id: 'ressources', target: tuto('survie-ressources') },
      { id: 'repos', target: tuto('survie-repos') },
      { id: 'forme', target: tuto('survie-forme'), when: (c) => c.isDruid },
    ],
  },
  stats: {
    id: 'stats',
    steps: [
      { id: 'scores', target: tuto('stats-caracts') },
      { id: 'derivees', target: tuto('stats-derivees') },
      { id: 'ca', target: tuto('stats-ca') },
      { id: 'portage', target: tuto('stats-portage') },
      { id: 'vitesse', target: tuto('stats-derivees') },
    ],
  },
  skills: {
    id: 'skills',
    steps: [
      { id: 'sauvegardes', target: tuto('skills-sauvegardes') },
      { id: 'competences', target: tuto('skills-competences') },
      { id: 'outils-langues', target: tuto('skills-outils') },
      { id: 'maitrises', target: tuto('skills-maitrises') },
    ],
  },
  spells: {
    id: 'spells',
    steps: [
      { id: 'emplacements', target: tuto('sorts-emplacements'), when: (c) => c.isCaster },
      { id: 'lancer', target: tuto('sorts-connus'), when: (c) => c.isCaster },
      { id: 'concentration', target: tuto('sorts-connus'), when: (c) => c.isCaster },
      { id: 'toujours-prepares', target: tuto('sorts-connus'), when: (c) => c.hasDomainSpells },
      { id: 'grimoire', target: tuto('sorts-connus') },
      { id: 'cantrips', target: tuto('sorts-cantrips'), when: (c) => c.isCaster },
    ],
  },
  inventory: {
    id: 'inventory',
    steps: [
      { id: 'rangements', target: tuto('inv-rangs') },
      { id: 'sac', target: tuto('inv-sac') },
      { id: 'puces', target: tuto('inv-sac') },
      { id: 'transfert', target: tuto('inv-sac') },
      { id: 'bourse', target: tuto('inv-bourse') },
      {
        id: 'catalogue',
        targets: { mobile: tuto('inv-fab'), desktop: tuto('inv-catalogue') },
      },
      { id: 'poids', target: tuto('inv-rangs') },
    ],
  },
  features: {
    id: 'features',
    steps: [
      { id: 'catalogue', target: tuto('traits-catalogue') },
      { id: 'ajout', target: tuto('traits-catalogue') },
      { id: 'compteurs', target: tuto('traits-liste') },
      { id: 'ma-liste', target: tuto('traits-liste') },
    ],
  },
  description: {
    id: 'description',
    steps: [
      { id: 'identite', target: tuto('desc-identite') },
      { id: 'ajouter-classe', target: tuto('desc-identite') },
      { id: 'histoire', target: tuto('desc-apparence') },
    ],
  },
  npcs: {
    id: 'npcs',
    steps: [
      { id: 'figures', target: tuto('pnj-liste') },
      { id: 'ajouter', target: tuto('pnj-liste') },
    ],
  },
  notes: {
    id: 'notes',
    steps: [
      { id: 'libres', target: tuto('notes-liste') },
      { id: 'partout', target: tuto('notes-liste') },
    ],
  },
};

/** Construit le contexte des prédicats depuis la fiche chargée (§2.3 du document). */
export function buildTutorialCtx(character: Character, canEdit: boolean): TutorialCtx {
  const lines = classesOf(character);
  const isDruid = lines.some((l) => l.classKey === 'druid');
  return {
    isCaster: computeSpellcastingPools(character).spellcasting.some((n) => n > 0),
    isDruid,
    hasDomainSpells: !!character.divineDomain || !!character.landCircle || !!character.sacredOath,
    canEdit,
  };
}

type Translate = (key: string, options?: Record<string, string | number>) => string;

/** Double requestAnimationFrame : laisse le panneau d'onglet remonter avant
 *  que le polling de cible de joyride ne reprenne. */
async function waitForRemount(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface BuildStepsOptions {
  viewport: 'mobile' | 'desktop';
  t: Translate;
  onNavigateTab: (tab: TutorialTab) => void;
}

/**
 * Traduit un script du document en étapes react-joyride : filtre les étapes
 * par vue et par prédicat `when`, branche les crochets `before` de navigation
 * d'onglet, et branche les textes i18n. Les cibles introuvables au moment venu
 * (ex. FAB catalogue en vue MD) sont absorbées par `targetWaitTimeout`.
 */
export function buildJoyrideSteps(
  script: TutorialScriptDef,
  ctx: TutorialCtx,
  { viewport, t, onNavigateTab }: BuildStepsOptions,
): Step[] {
  const steps: Step[] = [];
  for (const def of script.steps) {
    if (def.viewport && def.viewport !== 'both' && def.viewport !== viewport) continue;
    if (def.when && !def.when(ctx)) continue;

    const targetId = def.targets?.[viewport] ?? def.target;
    const step: Step = {
      id: `${script.id}.${def.id}`,
      // Les cartes d'ouverture/fermeture s'ancrent sur body, en placement centré.
      target: def.center ? 'body' : (targetId ?? 'body'),
      placement: def.center ? 'center' : 'bottom',
      title: t(`tuto.${script.id}.${def.id}.titre`),
      content: t(`tuto.${script.id}.${def.id}.texte`),
      isFixed: def.fixed ?? def.center,
      skipScroll: def.fixed,
    };
    if (def.tab) {
      step.before = async () => {
        onNavigateTab(def.tab as TutorialTab);
        await waitForRemount();
      };
    }
    steps.push(step);
  }
  return steps;
}
