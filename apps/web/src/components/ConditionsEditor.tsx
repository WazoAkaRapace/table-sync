/**
 * Bottom sheet for editing conditions on a combatant.
 * Uses the 16 SRD conditions (DND_CONDITIONS_FR) with optional durations.
 *
 * Dessin des lignes = LE picker de l'onglet Survie (emoji, libellé, indice de
 * règle, 🌀 interrompt la concentration, état actif sanguin) — un seul ajout
 * propre au traqueur : l'indicateur de durée en tours par état actif.
 */

import type { CombatantCondition } from '@table-sync/shared';
import { CONCENTRATION_BREAKING_CONDITIONS_FR, DND_CONDITIONS_FR } from '@table-sync/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { conditionHintKey, conditionLabel } from '../i18n/labels';
import { Glyph } from './Glyph';
import { BottomSheet } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  conditions: CombatantCondition[];
  onSave: (conditions: CombatantCondition[]) => void;
  combatantName: string;
}

export const CONDITION_ICONS: Record<string, ReactNode> = {
  Aveuglé: <Glyph name="hide" />,
  Assourdi: <Glyph name="deafened" />,
  Charmé: <Glyph name="charmed" />,
  Effrayé: <Glyph name="frightened" />,
  Empoisonné: <Glyph name="death" />,
  'En feu': <Glyph name="fire" />,
  Entravé: <Glyph name="link" />,
  Étourdi: <Glyph name="spark-outline" />,
  Inconscient: <Glyph name="unconscious" />,
  Invisible: <Glyph name="invisible" />,
  Agrippé: <Glyph name="grappled" />,
  'À terre': <Glyph name="prone" />,
  Paralysé: <Glyph name="paralyzed" />,
  Pétrifié: <Glyph name="petrified" />,
  Possédé: <Glyph name="eye" />,
  Neutralisé: <Glyph name="close" />,
};

export default function ConditionsEditor({
  open,
  onClose,
  conditions,
  onSave,
  combatantName,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CombatantCondition[]>(conditions);

  // Reset draft when modal opens
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setDraft(conditions);
    setLastOpen(true);
  }
  if (!open && lastOpen) setLastOpen(false);

  const toggle = (name: string) => {
    const existing = draft.find((c) => c.name === name);
    if (existing) {
      setDraft(draft.filter((c) => c.name !== name));
    } else {
      setDraft([...draft, { name, duration: null }]); // null = until dispelled
    }
  };

  const setDuration = (name: string, duration: number | null) => {
    setDraft(draft.map((c) => (c.name === name ? { ...c, duration } : c)));
  };

  const activeSet = new Set(draft.map((c) => c.name));

  if (!open) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('conds.conditions.combatantname', { combatantName: combatantName })}
      size="md"
      mobileOnly={false}
      bodyClassName="space-y-1.5"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            {t('conds.annuler')}
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="btn-primary flex-1"
          >
            {t('conds.appliquer')}
          </button>
        </>
      }
    >
      {DND_CONDITIONS_FR.map((cond) => {
        const active = activeSet.has(cond);
        const entry = draft.find((c) => c.name === cond);
        const breaksConcentration = CONCENTRATION_BREAKING_CONDITIONS_FR.includes(cond);
        return (
          <div
            key={cond}
            className={`flex items-center gap-2 rounded-lg border transition-colors ${
              active
                ? 'bg-blood-50 border-blood-200'
                : 'bg-parchment-50 border-parchment-200 hover:border-blood-300'
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(cond)}
              aria-pressed={active}
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
            >
              <span className="text-lg shrink-0" aria-hidden="true">
                {CONDITION_ICONS[cond] ?? <Glyph name="question" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-800">
                  {conditionLabel(cond)}
                </span>
                <span className="block text-xs text-ink-500">{t(conditionHintKey(cond))}</span>
              </span>
              {breaksConcentration && (
                <span
                  className="text-sm shrink-0 text-indigo-600"
                  title={t('survie.interrompt.la.concentration')}
                >
                  <Glyph name="concentration" />
                </span>
              )}
            </button>
            {active && (
              <div className="flex shrink-0 items-center gap-1 pr-3">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={entry?.duration ?? ''}
                  placeholder="∞"
                  onChange={(e) => {
                    const v = e.target.value;
                    setDuration(cond, v === '' ? null : Math.max(1, parseInt(v, 10)));
                  }}
                  className="input w-14 text-center text-sm"
                  title={t('conds.duree.en.tours.vide.jusqu.a')}
                />
                <span className="w-12 text-xs text-ink-400">
                  {entry?.duration == null ? 'tours ∞' : 'tours'}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </BottomSheet>
  );
}
