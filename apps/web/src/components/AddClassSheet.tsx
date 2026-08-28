/**
 * Feuille guidée « ＋ Ajouter une classe » (multiclassage SRD 5.1).
 *
 * Quatre temps en un défilement : choix de la classe → carte des prérequis
 * (✓/⚠, jamais bloquant — la fiche est une aide, pas un verrou) → carte des
 * maîtrises acquises (table SRD) → sous-classe si le palier l'autorise, et
 * niveau de départ. L'action finale est le primaire sang de la feuille.
 */

import {
  type Character,
  type CharacterClassEntry,
  CLASS_SUBCLASSES,
  DND_CLASSES,
  findClass,
  MULTICLASS_PREREQUISITES,
  MULTICLASS_PROFICIENCIES_GAINED,
} from '@table-sync/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  /** Lignes de classe actuelles (source de vérité de la fiche). */
  currentClasses: CharacterClassEntry[];
  onAdd: (entry: CharacterClassEntry) => void;
}

const ABILITY_LABELS: Record<string, string> = {
  strength: 'FOR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'SAG',
  charisma: 'CHA',
};

export default function AddClassSheet({ open, onClose, character, currentClasses, onAdd }: Props) {
  const { t } = useTranslation();
  const totalLevel = currentClasses.reduce((sum, c) => sum + c.level, 0);
  const remaining = 20 - totalLevel;
  const takenKeys = new Set(currentClasses.map((c) => findClass(c.classKey)?.name ?? c.classKey));

  const [classKey, setClassKey] = useState('');
  const [level, setLevel] = useState(1);

  const info = classKey ? findClass(classKey) : null;
  const prereqGroups = info ? (MULTICLASS_PREREQUISITES[info.name] ?? []) : [];
  const prereqSatisfied =
    prereqGroups.length === 0 ||
    prereqGroups.some((group) =>
      group.every((a) => (character[a as keyof Character] as number) >= 13),
    );
  const gained = info ? MULTICLASS_PROFICIENCIES_GAINED[info.name] : null;

  const subclassOptions = useMemo(() => (info ? (CLASS_SUBCLASSES[info.name] ?? []) : []), [info]);

  const reset = () => {
    setClassKey('');
    setLevel(1);
  };

  const close = () => {
    reset();
    onClose();
  };

  const confirm = () => {
    if (!info || remaining < 1) return;
    onAdd({ classKey: info.name, level: Math.min(level, remaining) });
    reset();
    onClose();
  };

  const maxLevel = Math.max(1, Math.min(20, remaining));

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={t('classe.ajouter.une.classe')}
      mobileOnly={false}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">
            Niveau total&nbsp;<span className="font-mono">{totalLevel}</span> →{' '}
            <span className="font-mono">{Math.min(20, totalLevel + (info ? level : 0))}</span> / 20
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={!info || remaining < 1}
            onClick={confirm}
          >
            {t('classe.ajouter')}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* 1 — choix de la classe */}
        <section className="space-y-2">
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">
            Nouvelle classe
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DND_CLASSES.map((c) => {
              const taken = takenKeys.has(c.name);
              const selected = info?.name === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  disabled={taken}
                  onClick={() => {
                    setClassKey(c.name);
                    setLevel(1);
                  }}
                  aria-pressed={selected}
                  className={`text-left rounded-xl border px-3 py-2 min-h-[44px] transition-colors ${
                    selected
                      ? 'border-blood-400 bg-blood-50'
                      : taken
                        ? 'border-parchment-200 bg-parchment-100 opacity-55'
                        : 'border-parchment-300 bg-parchment-50 hover:bg-parchment-100'
                  }`}
                >
                  <span className="block text-sm font-semibold text-ink-800">{c.name}</span>
                  <span className="block text-xs text-ink-500">
                    d{c.hitDie} ·{' '}
                    {c.spellcasting === 'full'
                      ? 'incantation'
                      : c.spellcasting === 'half'
                        ? 'demi-incantation'
                        : c.spellcasting === 'pact'
                          ? 'magie de pacte'
                          : c.spellcasting === 'artificier'
                            ? 'incantation (artificier)'
                            : 'sans incantation'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {info && (
          <>
            {/* 2 — prérequis (⚠ jamais bloquant) */}
            <section className="rounded-xl border border-parchment-300 bg-parchment-50 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">
                {t('classe.prerequis.srd')}
              </p>
              {prereqGroups.length === 0 ? (
                <p className="text-sm text-ink-600">
                  {t('classe.aucun.prerequis.de.caracteristique')}
                </p>
              ) : (
                <ul className="space-y-1">
                  {prereqGroups.map((group) => (
                    <li key={group.join('-')} className="flex items-center gap-2 text-sm">
                      {group.map((a, i) => {
                        const score = character[a as keyof Character] as number;
                        const ok = score >= 13;
                        return (
                          <span key={a} className="flex items-center gap-1">
                            {i > 0 && <span className="text-ink-400">et</span>}
                            <span className={ok ? 'text-ink-700' : 'text-orange-600'}>
                              {ABILITY_LABELS[a]} <span className="font-mono">{score}</span>
                              {!ok && (
                                <span className="text-orange-600">{t('classe.13.requis')}</span>
                              )}
                            </span>
                          </span>
                        );
                      })}
                      {group === prereqGroups[0] && prereqGroups.length > 1 && (
                        <span className="text-ink-400">{t('classe.ou')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!prereqSatisfied && (
                <p className="text-xs text-orange-600">
                  {t('classe.prerequis.non.satisfait.la.fiche.t')}
                </p>
              )}
            </section>

            {/* 3 — maîtrises acquises (table SRD) */}
            <section className="rounded-xl border border-parchment-300 bg-parchment-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">
                {t('classe.maitrises.acquises')}
              </p>
              <ul className="text-sm text-ink-700 space-y-0.5">
                {gained?.linesFr.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-xs text-ink-500">{t('classe.votre.classe.de.depart.garde.ses')}</p>
            </section>

            {/* 4 — niveau de départ + sous-classe */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="label mb-0">{t('classe.niveaux.de.depart')}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary w-11 h-11 text-lg"
                    aria-label={t('classe.retirer.un.niveau')}
                    onClick={() => setLevel((l) => Math.max(1, l - 1))}
                  >
                    −
                  </button>
                  <span className="font-mono text-lg w-8 text-center">
                    {Math.min(level, maxLevel)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary w-11 h-11 text-lg"
                    aria-label={t('classe.ajouter.un.niveau')}
                    onClick={() => setLevel((l) => Math.min(maxLevel, l + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
              <p className="text-sm text-ink-500">
                Sous-classe&nbsp;:{' '}
                {subclassOptions.length === 0 ? (
                  'aucune pour cette classe.'
                ) : Math.min(...subclassOptions.map((s) => s.level)) > level ? (
                  <span className="text-ink-400">
                    à choisir au niveau {Math.min(...subclassOptions.map((s) => s.level))} de cette
                    classe.
                  </span>
                ) : (
                  <span className="text-ink-400">{t('classe.a.choisir.apres.l.ajout.voie')}</span>
                )}
              </p>
            </section>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
