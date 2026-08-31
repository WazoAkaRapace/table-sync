/**
 * Compétences tab — read-first: 18 skills + 6 saving throws are static by
 * default (tapping a skill reveals its modifier breakdown, no mutation);
 * mastery editing sits behind an explicit "✎ Modifier" lock. In edit mode,
 * skill/tool rows cycle ○ → ● (maîtrise) → ◉ (expertise) → ○; when no SRD
 * slot is free the cycle skips ◉ (● → ○) so proficiency stays removable.
 * Expertise doubles the proficiency bonus and is gated by SRD slots
 * (Roublard 1/6 — compétences ou outils de voleur, Barde 3/10, Clerc du
 * Domaine du Savoir 1) — see expertiseSlots() in shared.
 */

import {
  type AbilityKey,
  abilityModifier,
  auraOfProtectionBonus,
  auraRadiusMeters,
  type Character,
  classArmorProficiencies,
  classWeaponProficiencies,
  DND_ABILITIES,
  DND_LANGUAGES,
  DND_SKILLS,
  DND_TOOLS,
  effectiveArmorProficiencies,
  effectiveWeaponProficiencies,
  expertiseSlots,
  expertiseUsed,
  FIGHTING_STYLE_CLASSES,
  FIGHTING_STYLE_LABELS_FR,
  type FightingStyle,
  findClass,
  formatModifier,
  hasAutomaticToolExpertise,
  type PatchCharacterPayload,
  proficiencyBonus,
  type SkillKey,
  skillModifier,
  skillProficiencyLevel,
  TOOL_CATEGORY_LABELS_FR,
  type ToolCategory,
  toolProficiencyLevel,
} from '@table-sync/shared';
import type { TFunction } from 'i18next';
import { type FormEvent, Fragment, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import {
  abilityLabel,
  abilityShort,
  classNameLabel,
  fightingStyleLabel,
  languageLabel,
  mundaneWeaponLabel,
  skillInfoLabel,
  toolCategoryLabel,
  toolInfoLabel,
} from '../i18n/labels';

interface Props {
  character: Character;
  charId: number;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

/** Get the ability score value for a given ability key from the character. */
function abilityScore(character: Character, key: AbilityKey): number {
  return (character[key as keyof Character] as number) ?? 10;
}

/** Read proficiency for a saving throw. */
function saveProficiency(character: Character, ability: AbilityKey): boolean {
  return (character.savingThrowProficiencies ?? []).includes(ability);
}

/** One term of a skill modifier breakdown ("DEX +4", "maîtrise +3"…). */
interface BreakdownSegment {
  text: string;
  className: string;
}

/** Decompose a skill modifier into its colored rule terms (teaches the math). */
function skillBreakdownSegments(
  t: TFunction,
  character: Character,
  ability: AbilityKey,
  prof: number,
  profBonus: number,
): BreakdownSegment[] {
  const mod = abilityModifier(abilityScore(character, ability));
  const segments: BreakdownSegment[] = [
    { text: `${abilityShort(ability)} ${formatModifier(mod)}`, className: 'text-ink-600' },
  ];
  if (prof === 2) {
    segments.push({
      text: t('skills.maitrise.x2', { mod: formatModifier(profBonus * 2) }),
      className: 'text-gold-700',
    });
  } else if (prof === 1) {
    segments.push({
      text: t('skills.maitrise', { mod: formatModifier(profBonus) }),
      className: 'text-blood-600',
    });
  } else {
    segments.push({ text: t('skills.sans.maitrise'), className: 'text-ink-400' });
  }
  return segments;
}

const TOOL_CATEGORIES = Object.keys(TOOL_CATEGORY_LABELS_FR) as ToolCategory[];

export default function CharacterSkillsTab({ character, charId, onSaved, onError }: Props) {
  const { t } = useTranslation();
  const level = character.level ?? 1;
  const profBonus = proficiencyBonus(level);
  const className = findClass(character.characterClass)?.name ?? null;
  const maxExpertise = expertiseSlots(character);
  const usedExpertise = expertiseUsed(character);
  // Paladin niv 6+ : Aura de protection (+CHA min 1) sur toutes les sauvegardes
  const auraOfProtection = auraOfProtectionBonus(character);
  const languages = character.languages ?? [];
  const customLanguages = languages.filter((l) => !DND_LANGUAGES.includes(l));
  const [newLang, setNewLang] = useState('');
  // Lecture par défaut : les rangées sont statiques, l'édition est délibérée
  const [editMode, setEditMode] = useState(false);
  const [expandedSkill, setExpandedSkill] = useState<SkillKey | null>(null);

  const patchSheet = useCallback(
    async (payload: PatchCharacterPayload) => {
      try {
        await api.patch(`/api/characters/${charId}`, payload);
        await onSaved();
      } catch {
        onError(t('skills.erreur.de.mise.a.jour'));
      }
    },
    [charId, onSaved, onError, t],
  );

  const toggleSkill = (skillKey: SkillKey) => {
    const current = skillProficiencyLevel(character, skillKey);
    const profs = [...(character.skillProficiencies ?? [])];
    const expert = [...(character.skillExpertise ?? [])];
    if (current === 0) {
      profs.push(skillKey); // ○ → ●
    } else if (current === 1 && usedExpertise < maxExpertise) {
      // ● → ◉ — only when an SRD slot is free; otherwise the cycle skips
      // ◉ entirely (● → ○) so proficiency stays removable when slots are full
      expert.push(skillKey);
    } else {
      // ◉ → ○ — expertise and proficiency both go
      const e = expert.indexOf(skillKey);
      if (e >= 0) expert.splice(e, 1);
      const p = profs.indexOf(skillKey);
      if (p >= 0) profs.splice(p, 1);
    }
    patchSheet({ skillProficiencies: profs, skillExpertise: expert });
  };

  const toggleTool = (toolKey: string) => {
    const current = toolProficiencyLevel(character, toolKey);
    const tools = [...(character.toolProficiencies ?? [])];
    const expert = [...(character.toolExpertise ?? [])];
    // SRD: only the Rogue's thieves' tools can take expertise (shared slot pool)
    const canExpertise = toolKey === 'thievesTools' && className === 'Roublard';
    if (current === 0) {
      tools.push(toolKey); // ○ → ●
    } else if (current === 1 && canExpertise && usedExpertise < maxExpertise) {
      // ● → ◉ — only when an SRD slot is free; otherwise ● → ○ (skip ◉)
      expert.push(toolKey);
    } else {
      // ● → ○ (non-eligible tools, or no slot free) or ◉ → ○
      const e = expert.indexOf(toolKey);
      if (e >= 0) expert.splice(e, 1);
      const p = tools.indexOf(toolKey);
      if (p >= 0) tools.splice(p, 1);
    }
    patchSheet({ toolProficiencies: tools, toolExpertise: expert });
  };

  const toggleSave = (ability: AbilityKey) => {
    const current = saveProficiency(character, ability);
    const saves = [...(character.savingThrowProficiencies ?? [])];
    if (current) {
      const idx = saves.indexOf(ability);
      if (idx >= 0) saves.splice(idx, 1);
    } else {
      saves.push(ability);
    }
    patchSheet({ savingThrowProficiencies: saves });
  };

  const toggleLanguage = (lang: string) => {
    const next = languages.includes(lang)
      ? languages.filter((l) => l !== lang)
      : [...languages, lang];
    patchSheet({ languages: next });
  };

  const addLanguage = (e: FormEvent) => {
    e.preventDefault();
    const name = newLang.trim();
    if (!name) return;
    if (!languages.some((l) => l.toLowerCase() === name.toLowerCase())) {
      patchSheet({ languages: [...languages, name] });
    }
    setNewLang('');
  };

  // Expertise reminder — edit-mode only: it guides spending SRD slots.
  // In read mode the ◉ dots carry the state on their own.
  let expertiseBanner: string;
  if (maxExpertise > 0 && usedExpertise >= maxExpertise) {
    expertiseBanner = t('skills.expertise.pleine', { used: usedExpertise, max: maxExpertise });
  } else if (maxExpertise > 0) {
    expertiseBanner = `${t('skills.expertise.disponible', {
      used: usedExpertise,
      max: maxExpertise,
    })}${className === 'Roublard' ? t('skills.outils.de.voleur.compris') : ''}`;
  } else if (className === 'Barde') {
    expertiseBanner = t('skills.expertise.barde');
  } else if (className === 'Clerc') {
    expertiseBanner = t('skills.expertise.clerc');
  } else {
    expertiseBanner = t('skills.expertise.non.disponible', {
      className: className ? classNameLabel(className) : t('skills.cette.classe'),
    });
  }

  // Group skills by ability
  const skillsByAbility = DND_ABILITIES.map((abi) => ({
    ability: abi.key,
    label: abi.label,
    skills: DND_SKILLS.filter((s) => s.ability === abi.key),
  })).filter((g) => g.skills.length > 0);

  const masteredTools = DND_TOOLS.filter((t) => toolProficiencyLevel(character, t.key) > 0);
  const knownLanguages = [...DND_LANGUAGES, ...customLanguages].filter((l) =>
    languages.includes(l),
  );

  const profDotClass = (prof: number) =>
    prof === 2 ? 'text-gold-600' : prof === 1 ? 'text-blood-600' : 'text-parchment-300';
  const profDotGlyph = (prof: number) => (prof === 2 ? '◉' : prof === 1 ? '●' : '○');

  return (
    <div className="space-y-4">
      {/* Edit lock — read by default so a stray tap never mutates the sheet */}
      <div className="flex items-center justify-between gap-3">
        {editMode ? (
          <div
            aria-live="polite"
            className="flex-1 min-w-0 space-y-1 rounded-lg border border-gold-400/40 bg-gold-400/10 px-2.5 py-1.5"
          >
            <p className="text-xs text-gold-700 flex items-center gap-2">
              <span className="text-sm leading-none">✎</span>
              <span>{t('skills.mode.edition.touche.une.ligne.pour')}</span>
            </p>
            <p className="text-xs text-ink-600 flex items-center gap-2">
              <span className="text-sm leading-none">⭐</span>
              <span>{expertiseBanner}</span>
            </p>
          </div>
        ) : (
          <p className="flex-1 min-w-0 text-xs text-ink-500">
            {t('skills.lecture.touche.une.competence.pour.voir')}
          </p>
        )}
        <button
          type="button"
          aria-pressed={editMode}
          onClick={() => {
            setEditMode((v) => !v);
            setExpandedSkill(null);
          }}
          className={`shrink-0 text-sm px-3 py-2 ${editMode ? 'btn-primary' : 'btn-secondary'}`}
        >
          {editMode ? t('skills.terminer') : t('skills.modifier')}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <div className="space-y-4">
          {/* Saving throws — the tab's hero: the most-rolled numbers */}
          <section className="card p-4 sm:p-5 space-y-3" data-tuto="skills-sauvegardes">
            <div className="flex items-center justify-between">
              <h2 className="section-title">{t('skills.jets.de.sauvegarde')}</h2>
              <span className="text-xs text-ink-400">
                {t('skills.bonus.de.maitrise')} {formatModifier(profBonus)}
              </span>
            </div>
            {auraOfProtection > 0 && (
              <p className="text-xs text-gold-700 bg-gold-400/10 border border-gold-400/40 rounded-lg px-2.5 py-1.5">
                {t('skills.aura.de.protection', {
                  bonus: auraOfProtection,
                  radius: auraRadiusMeters(level),
                })}
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {DND_ABILITIES.map((abi) => {
                const score = abilityScore(character, abi.key);
                const mod = abilityModifier(score);
                const proficient = saveProficiency(character, abi.key);
                const total = mod + (proficient ? profBonus : 0) + auraOfProtection;
                const tileClass = `px-3 py-2.5 rounded-xl border text-center transition-colors ${
                  proficient
                    ? 'bg-blood-50 border-blood-300'
                    : 'bg-parchment-50 border-parchment-200'
                }`;
                const tileBody = (
                  <>
                    <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-ink-500">
                      {proficient && <span className="text-blood-600">●</span>}
                      <span>{abilityLabel(abi.key)}</span>
                      {auraOfProtection > 0 && <span aria-hidden="true">🛡️</span>}
                    </span>
                    <span className="block mt-0.5 text-xl font-bold tabular-nums text-ink-800">
                      {formatModifier(total)}
                    </span>
                  </>
                );
                return editMode ? (
                  <button
                    type="button"
                    key={abi.key}
                    onClick={() => toggleSave(abi.key)}
                    className={`${tileClass} hover:border-blood-400`}
                    aria-pressed={proficient}
                  >
                    {tileBody}
                  </button>
                ) : (
                  <div key={abi.key} className={tileClass}>
                    {tileBody}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Skills grouped by ability — full-width rows, breakdown on tap */}
          <section className="card p-4 sm:p-5 space-y-3" data-tuto="skills-competences">
            <h2 className="section-title">{t('skills.competences')}</h2>
            {skillsByAbility.map((group) => (
              <div key={group.ability}>
                <div className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1.5">
                  {abilityShort(group.ability as AbilityKey)} —{' '}
                  {abilityLabel(group.ability as AbilityKey)}
                </div>
                <div className="space-y-1.5">
                  {group.skills.map((skill) => {
                    const prof = skillProficiencyLevel(character, skill.key);
                    const total = skillModifier(character, skill.key);
                    const expanded = expandedSkill === skill.key;
                    if (editMode) {
                      return (
                        <button
                          type="button"
                          key={skill.key}
                          onClick={() => toggleSkill(skill.key)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left hover:border-blood-400 ${
                            prof > 0
                              ? 'bg-blood-50 border-blood-300'
                              : 'bg-parchment-50 border-parchment-200'
                          }`}
                          aria-pressed={prof > 0}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs w-4 shrink-0 ${profDotClass(prof)}`}>
                              {profDotGlyph(prof)}
                            </span>
                            <span className="text-sm text-ink-700 truncate">
                              {skillInfoLabel(skill)}
                            </span>
                          </span>
                          <span className="font-bold text-ink-800 shrink-0">
                            {formatModifier(total)}
                          </span>
                        </button>
                      );
                    }
                    return (
                      <div key={skill.key}>
                        <button
                          type="button"
                          onClick={() => setExpandedSkill(expanded ? null : skill.key)}
                          aria-expanded={expanded}
                          aria-controls={`skill-detail-${skill.key}`}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                            prof > 0
                              ? 'bg-blood-50 border-blood-300 hover:border-blood-400'
                              : 'bg-parchment-50 border-parchment-200 hover:border-parchment-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs w-4 shrink-0 ${profDotClass(prof)}`}>
                              {profDotGlyph(prof)}
                            </span>
                            <span className="text-sm text-ink-700 truncate">
                              {skillInfoLabel(skill)}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="font-bold text-ink-800">{formatModifier(total)}</span>
                            <span
                              className={`text-xs text-ink-400 w-4 chevron ${
                                expanded ? 'is-open' : 'is-closed'
                              }`}
                            >
                              ▼
                            </span>
                          </span>
                        </button>
                        <div
                          id={`skill-detail-${skill.key}`}
                          className={`expand-grid ${expanded ? '' : 'is-collapsed'}`}
                        >
                          <div className="expand-inner">
                            <p className="mt-1 mx-2 rounded-md bg-parchment-100 px-2.5 py-1.5 text-xs flex flex-wrap items-center gap-x-1">
                              {skillBreakdownSegments(
                                t,
                                character,
                                skill.ability,
                                prof,
                                profBonus,
                              ).map((seg, i) => (
                                <Fragment key={seg.text}>
                                  {i > 0 && <span className="text-ink-300">·</span>}
                                  <span className={seg.className}>{seg.text}</span>
                                </Fragment>
                              ))}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className="space-y-4">
          {/* Weapon mastery — read mode shows mastered chips, editing follows the tab's ✎ lock */}
          <WeaponMasteryCard character={character} editMode={editMode} patch={patchSheet} />

          {/* Armor mastery — same read/edit pattern as weapons */}
          <ArmorMasteryCard character={character} editMode={editMode} patch={patchSheet} />

          {/* Tools — read mode shows only what is mastered */}
          <section className="card p-4 sm:p-5 space-y-3" data-tuto="skills-outils">
            <h2 className="section-title">{t('skills.outils')}</h2>
            {hasAutomaticToolExpertise(character) && (
              <p className="text-xs text-ink-500 flex items-center gap-2">
                <span className="text-sm leading-none">⭐</span>
                <span>{t('skills.maitrise.des.outils.niv.6.bonus')}</span>
              </p>
            )}
            {editMode ? (
              TOOL_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1.5">
                    {toolCategoryLabel(cat)}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {DND_TOOLS.filter((t) => t.category === cat).map((tool) => {
                      const prof = toolProficiencyLevel(character, tool.key);
                      return (
                        <button
                          type="button"
                          key={tool.key}
                          onClick={() => toggleTool(tool.key)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left hover:border-blood-400 ${
                            prof > 0
                              ? 'bg-blood-50 border-blood-300'
                              : 'bg-parchment-50 border-parchment-200'
                          }`}
                          aria-pressed={prof > 0}
                        >
                          <span className={`text-xs w-4 shrink-0 ${profDotClass(prof)}`}>
                            {profDotGlyph(prof)}
                          </span>
                          <span className="text-sm text-ink-700 truncate">
                            {toolInfoLabel(tool)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : masteredTools.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {masteredTools.map((tool) => {
                  const prof = toolProficiencyLevel(character, tool.key);
                  return (
                    <span
                      key={tool.key}
                      className={`px-3 py-1.5 rounded-full border text-sm text-ink-700 ${
                        prof === 2
                          ? 'bg-gold-400/10 border-gold-400/40'
                          : 'bg-blood-50 border-blood-300'
                      }`}
                    >
                      <span
                        className={`text-xs mr-1 ${
                          prof === 2 ? 'text-gold-700' : 'text-blood-600'
                        }`}
                      >
                        {prof === 2 ? '◉' : '●'}
                      </span>
                      {toolInfoLabel(tool)}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                {t('skills.aucune.maitrise.d.outil.modifier.pour')}
              </p>
            )}
          </section>

          {/* Languages — read mode shows known tongues only */}
          <section className="card p-4 sm:p-5 space-y-3">
            <h2 className="section-title">{t('skills.langues')}</h2>
            {editMode ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {[...DND_LANGUAGES, ...customLanguages].map((lang) => {
                    const known = languages.includes(lang);
                    return (
                      <button
                        type="button"
                        key={lang}
                        onClick={() => toggleLanguage(lang)}
                        className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                          known
                            ? 'bg-blood-50 border-blood-300 text-ink-700'
                            : 'bg-parchment-50 border-parchment-200 hover:border-parchment-300 text-ink-500'
                        }`}
                        aria-pressed={known}
                      >
                        {known && <span className="text-blood-600 text-xs mr-1">●</span>}
                        {languageLabel(lang)}
                      </button>
                    );
                  })}
                </div>
                <form onSubmit={addLanguage} className="flex gap-2">
                  <label htmlFor="new-language" className="sr-only">
                    {t('skills.nouvelle.langue')}
                  </label>
                  <input
                    id="new-language"
                    value={newLang}
                    onChange={(e) => setNewLang(e.target.value)}
                    placeholder={t('skills.autre.langue')}
                    maxLength={40}
                    className="flex-1 px-3 py-2 rounded-lg border bg-parchment-50 border-parchment-200 placeholder:text-ink-400 text-sm text-ink-700"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg border bg-parchment-100 border-parchment-200 hover:border-parchment-300 text-sm font-medium text-ink-600"
                  >
                    {t('skills.ajouter')}
                  </button>
                </form>
              </>
            ) : knownLanguages.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {knownLanguages.map((lang) => (
                  <span
                    key={lang}
                    className="px-3 py-1.5 rounded-full border text-sm text-ink-700 bg-blood-50 border-blood-300"
                  >
                    <span className="text-blood-600 text-xs mr-1">●</span>
                    {languageLabel(lang)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                {t('skills.aucune.langue.modifier.pour.en.ajouter')}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Weapon mastery: read mode lists what is mastered (chips + fighting style);
 *  edit mode shows the simple/martial toggles and the fighting style select. */
function WeaponMasteryCard({
  character,
  editMode,
  patch,
}: {
  character: Character;
  editMode: boolean;
  patch: (payload: PatchCharacterPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const effective = effectiveWeaponProficiencies(character);
  const isCustom = character.weaponProficiencies != null;
  const classDefault = classWeaponProficiencies(character.characterClass);
  const hasFightingStyle = (FIGHTING_STYLE_CLASSES as readonly string[]).includes(
    character.characterClass ?? '',
  );
  const styleLabel = character.fightingStyle ? fightingStyleLabel(character.fightingStyle) : null;

  const toggle = (token: 'simple' | 'martial') => {
    // Materialize the effective list (class defaults when untouched), then flip
    const tokens: string[] = [];
    if (token === 'simple' ? !effective.simple : effective.simple) tokens.push('simple');
    if (token === 'martial' ? !effective.martial : effective.martial) tokens.push('martial');
    tokens.push(...effective.specific);
    patch({ weaponProficiencies: tokens });
  };

  const specificFr = effective.specific.map((nameEn) => mundaneWeaponLabel(nameEn));

  const mastered = [
    effective.simple && t('skills.armes.simples'),
    effective.martial && t('skills.armes.de.guerre'),
    ...specificFr,
  ].filter(Boolean) as string[];

  const chip = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
      active
        ? 'bg-blood-600 text-white border-blood-700'
        : 'bg-parchment-50 text-ink-600 border-parchment-200 hover:border-blood-400'
    }`;

  return (
    <section className="card p-4 sm:p-5 space-y-3" data-tuto="skills-maitrises">
      <div className="flex items-center justify-between">
        <h2 className="section-title">{t('skills.maitrise.d.armes')}</h2>
        {editMode && isCustom && (
          <button
            type="button"
            onClick={() => patch({ weaponProficiencies: null })}
            className="text-xs text-blood-600 hover:underline"
            title={t('skills.revenir.aux.maitrises.par.defaut.de')}
          >
            {t('skills.selon.la.classe')}
          </button>
        )}
      </div>
      {editMode ? (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => toggle('simple')}
              className={chip(effective.simple)}
              aria-pressed={effective.simple}
            >
              <span aria-hidden="true">🗡</span>
              {t('skills.armes.simples')}
            </button>
            <button
              type="button"
              onClick={() => toggle('martial')}
              className={chip(effective.martial)}
              aria-pressed={effective.martial}
            >
              <span aria-hidden="true">⚔️</span>
              {t('skills.armes.de.guerre')}
            </button>
          </div>
          {specificFr.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-400">{t('skills.specifiques')}</span>
              {specificFr.map((fr) => (
                <span
                  key={fr}
                  className="px-2 py-0.5 rounded-full bg-parchment-100 border border-parchment-300 text-xs font-medium text-ink-700"
                >
                  {fr}
                </span>
              ))}
            </div>
          )}
          {hasFightingStyle && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink-700">
                {t('skills.style.de.combat')}
              </span>
              <select
                className="input py-1.5 text-sm w-auto max-w-[60%]"
                value={character.fightingStyle ?? ''}
                onChange={(e) =>
                  patch({
                    fightingStyle: e.target.value === '' ? null : (e.target.value as FightingStyle),
                  })
                }
                aria-label={t('skills.style.de.combat')}
              >
                <option value="">—</option>
                {Object.entries(FIGHTING_STYLE_LABELS_FR).map(([value]) => (
                  <option key={value} value={value}>
                    {fightingStyleLabel(value as FightingStyle)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          {mastered.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {mastered.map((fr) => (
                <span
                  key={fr}
                  className="px-3 py-1.5 rounded-full border text-sm text-ink-700 bg-blood-50 border-blood-300"
                >
                  <span className="text-blood-600 text-xs mr-1">●</span>
                  {fr}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              {t('skills.aucune.maitrise.d.arme.modifier.pour')}
            </p>
          )}
          {styleLabel && (
            <p className="text-sm text-ink-700">
              {t('skills.style.de.combat')}
              <strong>{styleLabel}</strong>
            </p>
          )}
        </>
      )}
      <p className="text-xs text-ink-400">
        {isCustom
          ? t('skills.maitrises.personnalisees')
          : t('skills.selon.la.classe.liste', {
              classLabel: classNameLabel(character.characterClass ?? '—'),
              liste:
                [
                  classDefault.simple && t('skills.footer.armes.simples'),
                  classDefault.martial && t('skills.footer.armes.de.guerre'),
                  classDefault.specific.length > 0 &&
                    t('skills.footer.n.armes.specific.n', { count: classDefault.specific.length }),
                ]
                  .filter(Boolean)
                  .join(' + ') || t('skills.footer.aucune.maitrise'),
            })}
      </p>
    </section>
  );
}

/** Armor mastery: read mode lists trained armor families + shields (chips);
 *  edit mode toggles light/medium/heavy/shields. null = class default (SRD). */
const ARMOR_TOKEN_KEYS: Record<'light' | 'medium' | 'heavy' | 'shields', string> = {
  light: 'skills.armures.legeres',
  medium: 'skills.armures.intermediaires',
  heavy: 'skills.armures.lourdes',
  shields: 'skills.boucliers',
};

function armorTokenLabel(t: TFunction, token: 'light' | 'medium' | 'heavy' | 'shields'): string {
  return t(ARMOR_TOKEN_KEYS[token]);
}

function ArmorMasteryCard({
  character,
  editMode,
  patch,
}: {
  character: Character;
  editMode: boolean;
  patch: (payload: PatchCharacterPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const effective = effectiveArmorProficiencies(character);
  const isCustom = character.armorProficiencies != null;
  const classDefault = classArmorProficiencies(character.characterClass);
  const tokens = ['light', 'medium', 'heavy', 'shields'] as const;

  const toggle = (token: (typeof tokens)[number]) => {
    // Materialize the effective list (class defaults when untouched), then flip
    patch({
      armorProficiencies: tokens.filter((t) => (t === token ? !effective[t] : effective[t])),
    });
  };

  const trained = tokens.filter((tk) => effective[tk]).map((tk) => armorTokenLabel(t, tk));

  const chip = (active: boolean) =>
    `flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
      active
        ? 'bg-blood-600 text-white border-blood-700'
        : 'bg-parchment-50 text-ink-600 border-parchment-200 hover:border-blood-400'
    }`;

  return (
    <section className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="section-title">{t('skills.maitrise.d.armures')}</h2>
        {editMode && isCustom && (
          <button
            type="button"
            onClick={() => patch({ armorProficiencies: null })}
            className="text-xs text-blood-600 hover:underline"
            title={t('skills.revenir.aux.maitrises.par.defaut.de')}
          >
            {t('skills.selon.la.classe')}
          </button>
        )}
      </div>
      {editMode ? (
        <div className="grid grid-cols-2 gap-2">
          {tokens.map((token) => (
            <button
              type="button"
              key={token}
              onClick={() => toggle(token)}
              className={chip(effective[token])}
              aria-pressed={effective[token]}
            >
              <span aria-hidden="true">
                {token === 'light'
                  ? '🪶'
                  : token === 'medium'
                    ? '🧥'
                    : token === 'heavy'
                      ? '⚓'
                      : '🛡️'}
              </span>{' '}
              {armorTokenLabel(t, token)}
            </button>
          ))}
        </div>
      ) : trained.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {trained.map((fr) => (
            <span
              key={fr}
              className="px-3 py-1.5 rounded-full border text-sm text-ink-700 bg-blood-50 border-blood-300"
            >
              <span className="text-blood-600 text-xs mr-1">●</span>
              {fr}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-500">{t('skills.aucune.maitrise.d.armure.modifier.pour')}</p>
      )}
      <p className="text-xs text-ink-400">
        {isCustom
          ? t('skills.maitrises.personnalisees')
          : t('skills.selon.la.classe.liste', {
              classLabel: classNameLabel(character.characterClass ?? '—'),
              liste:
                [
                  classDefault.light && t('skills.footer.armures.legeres'),
                  classDefault.medium && t('skills.footer.armures.intermediaires'),
                  classDefault.heavy && t('skills.footer.armures.lourdes'),
                  classDefault.shields && t('skills.footer.boucliers'),
                ]
                  .filter(Boolean)
                  .join(' + ') || t('skills.footer.aucune.maitrise'),
            })}
      </p>
    </section>
  );
}
