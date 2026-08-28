/**
 * Caractéristiques tab — read-only numbers for play: ability tiles first,
 * then derived stats (AC, initiative, spell DC, perception, speed, hit dice,
 * carry max). Identity & subclass editing lives in the Description tab,
 * weapon mastery in the Compétences tab.
 * Part of the character sheet integration.
 */

import {
  type AbilityKey,
  abilityModifier,
  type Character,
  classesOf,
  computeAC,
  computeEncumbrance,
  computeSpeed,
  fightingStylesOf,
  findClass,
  formatModifier,
  hitDiceByClassOf,
  type InventoryEntry,
  passivePerception,
  proficiencyBonus,
  skillProficiencyLevel,
  spellSaveDC,
  unarmoredDefensesOf,
} from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { BottomSheet } from '../components/ui';
import { abilityLabel, abilityShort } from '../i18n/labels';

interface Props {
  character: Character;
  charId: number;
  entries: InventoryEntry[];
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

// Fields that are directly editable ability scores
const ABILITY_FIELDS: { key: keyof Character; ability: AbilityKey }[] = [
  { key: 'strength', ability: 'strength' },
  { key: 'dexterity', ability: 'dexterity' },
  { key: 'constitution', ability: 'constitution' },
  { key: 'intelligence', ability: 'intelligence' },
  { key: 'wisdom', ability: 'wisdom' },
  { key: 'charisma', ability: 'charisma' },
];

export default function CharacterStatsTab({ character, charId, entries, onSaved, onError }: Props) {
  // Drafts for ability scores (auto-save on blur)
  const [abilityDrafts, setAbilityDrafts] = useState<Record<string, string>>({});
  const [speedDraft, setSpeedDraft] = useState(String(character.speed ?? 9));

  // Portage — max dérivé de FOR × 7,5 kg × multiplicateur (édité dans sa feuille)
  const [portageOpen, setPortageOpen] = useState(false);
  const [multDraft, setMultDraft] = useState('');

  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (const { key } of ABILITY_FIELDS) {
      drafts[key] = String((character[key] as number) ?? 10);
    }
    setAbilityDrafts(drafts);
    setSpeedDraft(String(character.speed ?? 9));
  }, [character]);

  const patchCharacter = useCallback(
    async (payload: Record<string, unknown>, errMsg: string) => {
      try {
        await api.patch(`/api/characters/${charId}`, payload);
        await onSaved();
      } catch {
        onError(errMsg);
      }
    },
    [charId, onSaved, onError],
  );

  const commitAbility = (ability: AbilityKey) => {
    const raw = abilityDrafts[ability];
    if (raw === undefined) return;
    const val = Number(raw);
    const current =
      (character[
        ability === 'strength' ? 'strength' : (`${ability}` as keyof Character)
      ] as number) ?? 10;
    if (!Number.isFinite(val) || val === current) {
      setAbilityDrafts((d) => ({ ...d, [ability]: String(current) }));
      return;
    }
    const clamped = Math.max(1, Math.min(30, Math.round(val)));
    patchCharacter({ [ability]: clamped }, 'Erreur de mise à jour');
  };

  const commitSpeed = () => {
    const val = Number(speedDraft);
    const current = character.speed ?? 9;
    if (!Number.isFinite(val) || val === current) {
      setSpeedDraft(String(current));
      return;
    }
    // Les demi-mètres sont valides (petites races : 7,5 m) — normalise à 1 décimale
    patchCharacter({ speed: Math.max(0, Math.round(val * 10) / 10) }, 'Erreur de mise à jour');
  };

  // Armor-dependent class speed features (Moine / Barbare)
  const speedResult = computeSpeed(character, entries);

  // Derived stats
  const level = character.level ?? 1;
  const classInfo = findClass(character.characterClass);
  const profBonus = proficiencyBonus(level);
  const dexMod = abilityModifier(character.dexterity ?? 10);
  const wisMod = abilityModifier(character.wisdom ?? 10);
  const perceptionLevel = skillProficiencyLevel(character, 'perception');
  const passPerc = passivePerception(wisMod, profBonus, perceptionLevel);

  // Multiclassage : une ligne de lanceur par classe incantatrice — chaque
  // sort suit la caractéristique de SA classe (SRD).
  const castingLines = classesOf(character)
    .map((entry) => {
      const info = findClass(entry.classKey);
      if (!info?.spellcastingAbility) return null;
      const mod = abilityModifier(
        (character[info.spellcastingAbility as keyof Character] as number) ?? 10,
      );
      return {
        name: info.name,
        ability: info.spellcastingAbility,
        mod,
        dc: spellSaveDC(mod, profBonus),
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  // Dés de vie par ligne de classe (le pool garde ses types de dés — SRD)
  const hitDice = hitDiceByClassOf(character);

  // Armor Class — computed from equipped armor, or manual override
  const acResult = computeAC(
    entries,
    dexMod,
    fightingStylesOf(character).has('defense'),
    character,
  );
  // Défenses sans armure candidates (multiclassage : on en choisit UNE — SRD)
  const defenseOptions = unarmoredDefensesOf(character);
  const acOverride = character.armorClassOverride;
  const effectiveAC = acOverride ?? acResult.ac;
  const [acDraft, setAcDraft] = useState('');
  const [editingAC, setEditingAC] = useState(false);

  const capacityMult = character.capacityMultiplier ?? 1;
  const portageMaxKg = computeEncumbrance(
    0,
    character.strength ?? 10,
    'variant',
    0,
    capacityMult,
  ).maxCarryKg;
  const openPortage = () => {
    setMultDraft(String(capacityMult));
    setPortageOpen(true);
  };
  const saveMult = () => {
    setPortageOpen(false);
    const parsed = Number(multDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const newMult = Math.round(parsed * 100) / 100;
    if (newMult === capacityMult) return;
    patchCharacter({ capacityMultiplier: newMult }, 'Erreur de mise à jour');
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: armorClassOverride is a deliberate dep — collapse the inline AC editor when the override changes (e.g. synced from another device).
  useEffect(() => {
    setEditingAC(false);
  }, [character.armorClassOverride]);

  const commitAC = () => {
    const val = acDraft.trim();
    if (val === '' || val === 'auto' || val === '0') {
      patchCharacter({ armorClassOverride: null }, 'Erreur de mise à jour');
    } else {
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) {
        patchCharacter({ armorClassOverride: Math.round(num) }, 'Erreur de mise à jour');
      }
    }
    setEditingAC(false);
  };

  return (
    <div className="space-y-4">
      {/* Ability scores */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">Caractéristiques</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {ABILITY_FIELDS.map(({ key, ability }) => {
            const score = (character[key as keyof Character] as number) ?? 10;
            const mod = abilityModifier(score);
            const draftVal = abilityDrafts[ability] ?? String(score);
            return (
              <div key={ability} className="bg-parchment-100 rounded-xl p-3 text-center">
                <div className="text-xs font-medium text-ink-500 mb-1">{abilityLabel(ability)}</div>
                <div className="text-2xl font-bold tabular-nums text-ink-800 mb-1">
                  {formatModifier(mod)}
                </div>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="block mx-auto w-16 min-h-11 text-center text-sm font-semibold tabular-nums bg-white border border-parchment-300 rounded-md py-1 focus:outline-none focus:border-blood-500"
                  value={draftVal}
                  onChange={(e) => setAbilityDrafts((d) => ({ ...d, [ability]: e.target.value }))}
                  onBlur={() => commitAbility(ability)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  aria-label={`Score de ${abilityLabel(ability)}`}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Derived stats */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">Statistiques dérivées</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Armor Class — computed or overridden */}
          <div className="bg-parchment-100 rounded-xl p-3 text-center">
            <div className="text-xs font-medium text-ink-500 mb-1">Classe d'armure</div>
            {editingAC ? (
              <input
                type="number"
                min={0}
                className="block mx-auto w-14 min-h-11 text-center text-xl font-bold tabular-nums text-ink-800 bg-white border border-parchment-300 rounded-md py-1 focus:outline-none focus:border-blood-500"
                value={acDraft}
                onChange={(e) => setAcDraft(e.target.value)}
                onBlur={commitAC}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditingAC(false);
                }}
                placeholder={String(acResult.ac)}
                aria-label="Classe d'armure"
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAcDraft(acOverride ? String(acOverride) : '');
                  setEditingAC(true);
                }}
                className="w-full min-h-11 flex items-center justify-center gap-1.5 text-2xl font-bold tabular-nums text-ink-800 hover:text-blood-600 transition-colors"
                aria-label="Modifier la classe d'armure"
              >
                {effectiveAC}
                <span className="text-sm font-normal text-ink-500" aria-hidden="true">
                  ✎
                </span>
              </button>
            )}
            <div className="text-[11px] text-ink-500 mt-0.5">
              {acOverride !== null ? (
                <>
                  <span className="font-medium text-blood-600">Manuel</span>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => patchCharacter({ armorClassOverride: null }, 'Erreur')}
                    className="text-blood-600 hover:underline py-1.5"
                  >
                    ↺ Auto
                  </button>
                </>
              ) : (
                acResult.source
              )}
            </div>
          </div>
          <DerivedStat label="Initiative" value={formatModifier(dexMod)} />
          {castingLines.map((l) => (
            <DerivedStat
              key={l.name}
              label={`DD de sort${castingLines.length > 1 ? ` · ${l.name}` : ''}`}
              value={String(l.dc)}
              hint={`Attaque ${formatModifier(l.mod + profBonus)} · ${abilityShort(l.ability)}`}
            />
          ))}
          <DerivedStat label="Perception passive" value={String(passPerc)} />
          <DerivedStat
            label="Vitesse"
            value={`${speedResult.speed} m`}
            editable
            draftValue={speedDraft}
            onChange={setSpeedDraft}
            onBlur={commitSpeed}
            hint={
              speedResult.sources.length > 0
                ? `→ ${speedResult.speed} m · ${speedResult.sources.join(' · ')}`
                : undefined
            }
          />
          {hitDice.length > 0 && hitDice[0].classKey !== '' && (
            <DerivedStat
              label="Dés de vie"
              value={
                hitDice.length === 1
                  ? `d${hitDice[0].die} · ${Math.max(0, hitDice[0].max - hitDice[0].used)}/${hitDice[0].max}`
                  : hitDice
                      .map((d) => `d${d.die} ${Math.max(0, d.max - d.used)}/${d.max}`)
                      .join(' · ')
              }
            />
          )}
          <DerivedStat label="Bonus de maîtrise" value={formatModifier(profBonus)} />
          {/* Portage max — FOR × 7,5 kg × multiplicateur (feuille dédiée) */}
          <div className="bg-parchment-100 rounded-xl p-3 text-center">
            <div className="text-xs font-medium text-ink-500 mb-1">Portage max</div>
            <button
              type="button"
              onClick={openPortage}
              className="w-full min-h-11 flex items-center justify-center gap-1.5 text-2xl font-bold tabular-nums text-ink-800 hover:text-blood-600 transition-colors"
              aria-label="Modifier le multiplicateur de portage"
            >
              {portageMaxKg} kg
              <span className="px-1.5 py-0.5 rounded-full bg-blood-50 border border-blood-200 text-blood-700 text-[11px] font-semibold">
                ×{capacityMult}
              </span>
            </button>
            <div className="text-[11px] text-ink-500 mt-0.5">
              FOR {character.strength ?? 10} × 7,5 kg
            </div>
          </div>
        </div>
        {classInfo && (
          <p className="text-xs text-ink-500">
            Sauvegardes maîtrisées : {classInfo.savingThrows.map((s) => abilityShort(s)).join(', ')}
            {castingLines.length > 0 &&
              ` · Incantation : ${castingLines
                .map((l) => `${l.name} (${abilityShort(l.ability)})`)
                .join(', ')}`}
          </p>
        )}
        {defenseOptions.length > 1 && acOverride === null && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-500">Défense sans armure :</span>
            {defenseOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() =>
                  patchCharacter(
                    { unarmoredDefense: character.unarmoredDefense === o.key ? null : o.key },
                    'Erreur de mise à jour',
                  )
                }
                aria-pressed={character.unarmoredDefense === o.key}
                className={`px-2.5 py-1.5 rounded-full text-xs transition-colors ${
                  character.unarmoredDefense === o.key
                    ? 'bg-blood-600 text-white'
                    : 'bg-parchment-100 text-ink-600 hover:bg-parchment-200'
                }`}
                title={`${o.label}${o.shieldForbidden ? ' — sans bouclier' : ''} · CA ${o.ac}`}
              >
                {o.classKey} <span className="font-mono">{o.ac}</span>
              </button>
            ))}
            <span className="text-[11px] text-ink-400">
              une seule se cumule (SRD) — la meilleure s'applique par défaut
            </span>
          </div>
        )}
      </section>

      {/* Portage sheet — multiplier editor + metric rule help */}
      <BottomSheet
        open={portageOpen}
        onClose={() => setPortageOpen(false)}
        title="Portage maximum"
        mobileOnly={false}
        size="md"
        footer={
          <button type="button" onClick={saveMult} className="btn-primary flex-1">
            Enregistrer
          </button>
        }
      >
        <div className="space-y-4">
          <div className="bg-parchment-100 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold tabular-nums text-ink-800">
              {portageMaxKg} kg
              <span className="ml-2 text-base font-semibold text-ink-600">×{capacityMult}</span>
            </div>
            <div className="text-[11px] text-ink-500 mt-1">
              FOR {character.strength ?? 10} × 7,5 kg × multiplicateur
            </div>
          </div>
          <label className="block">
            <span className="label">Multiplicateur de portage</span>
            <input
              type="number"
              min={1}
              step={0.5}
              className="input"
              value={multDraft}
              onChange={(e) => setMultDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveMult();
              }}
            />
          </label>
          <div className="text-xs text-ink-600 bg-parchment-50 border border-parchment-200 rounded-lg p-3 space-y-1.5">
            <p>
              <strong>×1 (défaut)</strong> : créature de taille M sans capacité spéciale.
            </p>
            <p>
              <strong>×2</strong> : Construction massive (Goliath, Firbolg, Demi-Orc, Bugbear, Orc,
              Loxodon) ou créature de taille G. Le personnage compte comme une catégorie de taille
              supérieure pour le calcul du poids transportable.
            </p>
            <p>
              <strong>×3</strong> : Créature de taille TG.
            </p>
            <p>
              <strong>×4</strong> : Créature de taille Gig.
            </p>
            <p className="text-ink-500">
              Ce multiplicateur s'applique aux trois paliers (encombré, lourdement encombré, max).
              Modifie-le si ton personnage a un trait qui augmente sa capacité de portage. La barre
              d'encombrement du bandeau suit automatiquement.
            </p>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function DerivedStat({
  label,
  value,
  editable,
  draftValue,
  onChange,
  onBlur,
  hint,
}: {
  label: string;
  value: string;
  editable?: boolean;
  draftValue?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
  hint?: string;
}) {
  return (
    <div className="bg-parchment-100 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-ink-500 mb-1">{label}</div>
      {editable ? (
        <input
          type="number"
          min={0}
          step={0.5}
          className="block mx-auto w-16 min-h-11 text-center text-lg font-bold tabular-nums text-ink-800 bg-white border border-parchment-300 rounded-md py-1 focus:outline-none focus:border-blood-500"
          value={draftValue ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <div className="min-h-11 flex items-center justify-center text-xl font-bold tabular-nums text-ink-800">
          {value}
        </div>
      )}
      {hint && (
        <div className="text-[11px] text-ink-500 font-medium leading-tight mt-0.5">{hint}</div>
      )}
    </div>
  );
}
