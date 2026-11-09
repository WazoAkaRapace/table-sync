/**
 * Generic JSON-column utilities shared across route modules.
 */

/** Parse a JSON column that's guaranteed to be an array; never throws. */
export function parseJsonArray(raw: any, fallback: any[] = []): any[] {
  if (!raw) return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
