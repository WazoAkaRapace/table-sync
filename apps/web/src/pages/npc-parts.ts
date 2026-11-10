import type { GmaEntity, GmaEntitySessionRef, NpcDisposition, NpcStatus } from '@table-sync/shared';
import { NPC_DISPOSITION_LABELS_FR, NPC_STATUS_LABELS_FR } from '@table-sync/shared';
import { appLocale } from '../i18n';
import { parseSqliteDate } from '../utils';

// ---------- Status / disposition styling ----------

export const STATUS_DOT_CLASS: Record<NpcStatus, string> = {
  alive: 'bg-green-500',
  dead: 'bg-red-500',
  missing: 'bg-yellow-500',
  turned: 'bg-purple-500',
};

export const STATUS_TEXT_CLASS: Record<NpcStatus, string> = {
  alive: 'text-green-700',
  dead: 'text-red-700',
  missing: 'text-yellow-700',
  turned: 'text-purple-700',
};

// Les maps partagées restent la source des CLÉS (ordre + exhaustivité) ;
// le libellé affiché passe par i18next — FR = copies verbatim des maps.
export const DISPOSITION_OPTIONS: { value: NpcDisposition; labelKey: string }[] = (
  Object.keys(NPC_DISPOSITION_LABELS_FR) as NpcDisposition[]
).map((d) => ({ value: d, labelKey: `pnj.disposition.${d}` }));

export const STATUS_OPTIONS: { value: NpcStatus; labelKey: string }[] = (
  Object.keys(NPC_STATUS_LABELS_FR) as NpcStatus[]
).map((s) => ({ value: s, labelKey: `pnj.status.${s}` }));

export type ViewFilter = 'all' | 'shared' | 'mine';

// Sentinel for the un-factioned group: a stable map key independent of the
// display language ("Sans faction" / "No faction").
export const NO_FACTION = '__no_faction__';

/** Name matching for the link suggestion: accents & case aside, same name. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sessions across ALL entities réconciliées on one NPC — deduped (the same
    séance may report several sightings) and in chronicle order. */
export function mergeGmaSessions(entities: GmaEntity[]): GmaEntitySessionRef[] {
  const seen = new Set<string>();
  const out: GmaEntitySessionRef[] = [];
  for (const e of entities) {
    for (const s of e.sessions) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
  }
  return out.sort((a, b) => a.ordinal - b.ordinal);
}

export function gmaDateLabel(value: string | null): string | null {
  if (!value) return null;
  const d = parseSqliteDate(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Failure copy for the GMA link/import actions, attributed honestly: when our
 * API answered, it carries the real cause (including its own GM Assistant
 * translations — those upstream errors DO mention GM Assistant); the fallbacks
 * are OUR side (network to Table Sync, or an API error without a message) and
 * must not blame GM Assistant for them.
 */
export function gmaActionErrorMessage(err: any, t: (key: string) => string): string {
  const msg = err?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (!err?.response) return t('pnj.gma.erreur.reseau');
  return t('pnj.gma.erreur.serveur');
}

// ---------- Main component ----------
