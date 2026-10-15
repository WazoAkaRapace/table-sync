/**
 * Journal des modifications — module client.
 *
 * Deux sources : __CHANGELOG__ (embarqué au build, entrées jusqu'à la
 * version courante) et /changelog.json (complet, no-cache, pour la
 * consultation « Journal »). Le popup de diff au chargement n'utilise QUE
 * l'embarqué : zéro fetch, fonctionne même hors ligne au premier rendu.
 *
 * Versions : le build porte soit un calver lisible (2026.10.15, release),
 * soit sha-<court> (build de validation main). L'entrée du build est celle
 * dont la version OU le sha correspond à __APP_VERSION__.
 */

export type ChangelogEntry = {
  version: string;
  sha: string | null;
  date: string;
  title: string;
  items: string[];
};

/** Entrées jusqu'à la version du build incluse (injecté par vite.config.ts). */
declare const __CHANGELOG__: ChangelogEntry[];
export const embeddedChangelog: ChangelogEntry[] = Array.isArray(__CHANGELOG__)
  ? __CHANGELOG__
  : [];

/** Clé localStorage : dernière version VUE (stamp posé à la fermeture du popup). */
export const SEEN_KEY = 'ts-changelog-seen';

/** Cette entrée décrit-elle ce build ? (calver exact, ou sha préfixe) */
function isBuildEntry(e: ChangelogEntry, buildVersion: string): boolean {
  if (e.version === buildVersion) return true;
  const sha = buildVersion.replace(/^sha-/, '');
  return e.sha !== null && (e.sha === sha || sha.startsWith(e.sha));
}

/**
 * Entrées nouvelles entre la dernière version vue et la version courante
 * (incluse). « vu » = version ou sha précédemment stampé. Retourne [] si
 * rien de nouveau, si dev, ou si le build n'a pas d'entrée.
 */
export function diffEntries(seen: string | null, current: string): ChangelogEntry[] {
  if (!seen || seen === 'dev' || current === 'dev') return [];
  if (seen === current) return [];
  const curIdx = embeddedChangelog.findIndex((e) => isBuildEntry(e, current));
  if (curIdx === -1) return [];
  const seenIdx = embeddedChangelog.findIndex((e) => isBuildEntry(e, seen));
  if (seenIdx === -1) return [embeddedChangelog[curIdx]];
  if (seenIdx <= curIdx) return []; // « vu » plus récent que courant : rien
  return embeddedChangelog.slice(curIdx, seenIdx);
}

/** Journal complet (fetch no-cache) — consultation « Journal ». */
export async function fetchFullChangelog(): Promise<ChangelogEntry[]> {
  const res = await fetch('/changelog.json', { cache: 'no-store' });
  if (!res.ok) return embeddedChangelog;
  const data = (await res.json()) as ChangelogEntry[];
  return Array.isArray(data) ? data : embeddedChangelog;
}
