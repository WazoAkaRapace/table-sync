/**
 * Journal des modifications — module client.
 *
 * Deux sources : __CHANGELOG__ (embarqué au build, entrées jusqu'à la
 * version courante) et /changelog.json (complet, no-cache, pour la
 * consultation « Journal »). Le popup de diff au chargement n'utilise QUE
 * l'embarqué : zéro fetch, fonctionne même hors ligne au premier rendu.
 */

export type ChangelogEntry = { sha: string; date: string; title: string; items: string[] };

/** Entrées jusqu'à la version du build incluse (injecté par vite.config.ts). */
declare const __CHANGELOG__: ChangelogEntry[];
export const embeddedChangelog: ChangelogEntry[] = Array.isArray(__CHANGELOG__)
  ? __CHANGELOG__
  : [];

/** Clé localStorage : dernière version VUE (stamp posé à la fermeture du popup). */
export const SEEN_KEY = 'ts-changelog-seen';

function sameVersion(a: string, b: string): boolean {
  const norm = (v: string) => v.replace(/^sha-/, '');
  return norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));
}

/**
 * Entrées nouvelles entre la dernière version vue et la version courante
 * (incluse). Antichronologique : slice de l'index courant à l'index vu.
 * Retourne [] si rien de nouveau, si « vu » est introuvable dans le journal
 * (première utilisation ou journal plus jeune que l'app installée) — dans ce
 * dernier cas on ne montre QUE la version courante si elle diffère.
 */
export function diffEntries(seen: string | null, current: string): ChangelogEntry[] {
  if (!seen || seen === 'dev' || current === 'dev') return [];
  if (sameVersion(seen, current)) return [];
  const curIdx = embeddedChangelog.findIndex((e) => sameVersion(e.sha, current));
  if (curIdx === -1) return [];
  const seenIdx = embeddedChangelog.findIndex((e) => sameVersion(e.sha, seen));
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
