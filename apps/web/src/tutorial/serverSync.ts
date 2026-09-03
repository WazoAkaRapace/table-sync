/**
 * État « visite guidée déjà vue » — double stockage :
 * - serveur (users.tutorial_seen_at / tutorial_tabs_done via PATCH /me) :
 *   suit le COMPTE, pas le navigateur — un joueur expérimenté n'a plus la
 *   visite sur un nouvel appareil ;
 * - localStorage (dnd-inv-tour-seen / dnd-inv-tour-tabs) : repli hors-ligne
 *   et point de départ de la migration des comptes existants.
 *
 * `syncTutorialWithServer` est appelé depuis le /me de AuthProvider AVANT
 * que `loading` passe à false (aucune page n'est montée) : la convergence
 * est effective avant tout déclenchement de visite.
 *
 * Les écritures serveur ne régressent JAMAIS l'état (on pose ou on enrichit,
 * on ne retire que via « Réinitialiser le tutoriel ») et sont best-effort :
 * la visite est un confort, pas une donnée critique.
 */
import type { User } from '@table-sync/shared';
import api from '../api';

/** Clés localStorage du contrat visite guidée (cf. TutorialHost, fixtures e2e). */
const TUTORIAL_SEEN_KEY = 'dnd-inv-tour-seen';
const TUTORIAL_TABS_DONE_KEY = 'dnd-inv-tour-tabs';

function readLocalTabs(): string[] {
  try {
    const raw = localStorage.getItem(TUTORIAL_TABS_DONE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalTabs(tabs: string[]): void {
  try {
    localStorage.setItem(TUTORIAL_TABS_DONE_KEY, JSON.stringify([...new Set(tabs)]));
  } catch {
    /* localStorage bloqué — le serveur reste la source de vérité */
  }
}

/**
 * Convergence au chargement de session (après /me) :
 * - le serveur a vu la visite → drapeau local posé (repli hors-ligne d'accord) ;
 * - le navigateur a vu la visite mais pas le serveur (compte créé avant la
 *   migration) → upload du drapeau local (une seule fois utile, idempotent) ;
 * - listes d'onglets fusionnées en union des deux côtés.
 */
export function syncTutorialWithServer(user: User): void {
  try {
    const localSeen = !!localStorage.getItem(TUTORIAL_SEEN_KEY);
    const serverSeen = !!user.tutorialSeenAt;

    if (serverSeen && !localSeen) {
      localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    } else if (!serverSeen && localSeen) {
      // Migration d'un compte existant : ce navigateur a déjà joué la visite.
      api.patch('/api/auth/me', { tutorialSeenAt: new Date().toISOString() }).catch(() => {});
    }

    const localTabs = readLocalTabs();
    const serverTabs = user.tutorialTabsDone;
    if (serverTabs.some((id) => !localTabs.includes(id))) {
      writeLocalTabs([...localTabs, ...serverTabs]);
    }
    if (localTabs.some((id) => !serverTabs.includes(id))) {
      api
        .patch('/api/auth/me', { tutorialTabsDone: [...new Set([...serverTabs, ...localTabs])] })
        .catch(() => {});
    }
  } catch {
    /* localStorage bloqué : le serveur seul décide, dégradation acceptable */
  }
}

/** Fin de visite (terminée ou passée) : drapeau local + serveur. */
export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
  } catch {
    /* localStorage bloqué — la visite rejouera localement, dégradation acceptable */
  }
  api.patch('/api/auth/me', { tutorialSeenAt: new Date().toISOString() }).catch(() => {});
}

/** Onglet visité : liste locale + serveur (union). */
export function markTutorialTabDone(id: string): void {
  let done: string[] = [];
  try {
    done = readLocalTabs();
    if (!done.includes(id)) {
      done = [...done, id];
      localStorage.setItem(TUTORIAL_TABS_DONE_KEY, JSON.stringify(done));
    }
  } catch {
    /* localStorage bloqué — le serveur garde trace */
  }
  if (done.includes(id)) {
    api.patch('/api/auth/me', { tutorialTabsDone: done }).catch(() => {});
  }
}

/** « Réinitialiser le tutoriel » : réarmement local + serveur (tous appareils). */
export function resetTutorial(): void {
  try {
    localStorage.removeItem(TUTORIAL_SEEN_KEY);
    localStorage.removeItem(TUTORIAL_TABS_DONE_KEY);
  } catch {
    /* localStorage bloqué — le bouton reste sans effet local visible */
  }
  api.patch('/api/auth/me', { tutorialSeenAt: null }).catch(() => {});
}
