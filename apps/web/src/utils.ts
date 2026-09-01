/* Small helpers shared by the register (group list) and the table of contents (party page). */

import i18next, { appLocale } from './i18n';

export function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  let rest = n;
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out || 'I';
}

/** SQLite timestamps are space-separated; Safari rejects those in Date().
 *  The « depuis/since » prefix reads the active language through the i18next
 *  singleton (keys commun.depuis / commun.since) — signature unchanged for
 *  callers outside this zone. */
export function formatSince(createdAt: string): string {
  const normalized = createdAt.includes(' ') ? createdAt.replace(' ', 'T') : createdAt;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat(appLocale(), { month: 'short', year: 'numeric' });
  return `${i18next.t('commun.depuis')} ${fmt.format(d)}`;
}

/** Neutral creation stamp for finished things — no « depuis », the entity is over.
 *  The prefix (FR « créée », EN « created ») is passed by the caller via t() so it
 *  follows the active language (i18n fragments). */
export function formatCreated(createdAt: string, prefix: string): string {
  const normalized = createdAt.includes(' ') ? createdAt.replace(' ', 'T') : createdAt;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat(appLocale(), { month: 'short', year: 'numeric' });
  return `${prefix} ${fmt.format(d)}`;
}

/** Clipboard write with a legacy fallback — embedded browsers often deny the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Active sheets read first — hidden (secret prep) entries sink below their
 *  « Caché » marker. Stable, so the API's name order holds within each group. */
export function activeCharactersFirst<T extends { hidden: boolean }>(characters: T[]): T[] {
  return [...characters].sort((a, b) => Number(a.hidden) - Number(b.hidden));
}

/**
 * Horodatage de correspondance : la granularité suit la vie d'un fil de
 * séance — « à l'instant », minutes, puis l'heure du jour, puis la date
 * (mois abrégé, année seulement si elle change). Les phrases passent par
 * i18n (commun de la langue active), les valeurs restent brutes.
 */
export function formatMessageTime(createdAt: string): string {
  const normalized = createdAt.includes(' ') ? createdAt.replace(' ', 'T') : createdAt;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return i18next.t('msgs.a.linstant');
  if (diffMs < 3600_000) return i18next.t('msgs.il.y.a.min', { n: Math.floor(diffMs / 60_000) });
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(appLocale(), { hour: '2-digit', minute: '2-digit' }).format(d);
  }
  if (d.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short' }).format(d);
  }
  return new Intl.DateTimeFormat(appLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Decode an image file, matte it on WHITE, downscale the long edge to
 * `maxEdge` and re-encode as a JPEG Blob (illustrations: a card or letter
 * must stay readable zoomed on a 390px screen — 1280px leaves ~3× native
 * margin). The white fillRect happens BEFORE drawImage because JPEG has no
 * alpha channel: without it a transparent PNG would come out black. EXIF
 * orientation is honored by createImageBitmap's default ('from-image').
 *
 * Generalization of the 256px portrait precedent (CharacterDescriptionTab),
 * which keeps its own smaller resolution for a medallion — do not touch it.
 * Returns null when the file cannot be decoded (caller shows an inline error).
 */
export async function downscaleImage(
  file: Blob,
  maxEdge = 1280,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > height && width > maxEdge) {
      height = Math.round((height * maxEdge) / width);
      width = maxEdge;
    } else if (height > maxEdge) {
      width = Math.round((width * maxEdge) / height);
      height = maxEdge;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
    if (!blob) return null;
    return { blob, width, height };
  } catch {
    return null;
  }
}
