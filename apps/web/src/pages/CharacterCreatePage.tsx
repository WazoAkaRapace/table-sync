/*
 * LE REGISTRE — direction contract (création de personnage)
 * THESIS: Creating a character is signing the party's register — six entries,
 * one decision per screen, inked numerals rising — refusing the generic
 * dots-and-Next wizard.
 * OWN-WORLD: PartyPage's table-of-contents grammar — Cinzel roman numerals,
 * dot-leader rules, register-rise arrival, blood-inked selection rows.
 * STORY: A player answers the register's entries one thumb at a time, watches
 * the récap ink the derived numbers live (PV, CA, saves), and walks through
 * the blood door into their new sheet.
 * FIRST VIEWPORT: volume title over the double head rule, numeral strip I–VI
 * with entry I (Identité) as the focused decision, Continuer pinned low.
 * FORM: stepped register, one decision per screen, mobile-first, light-only.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md
 */

import type { AbilityKey, ClassInfo, CreateCharacterPayload, SkillKey } from '@table-sync/shared';
import {
  abilityModifier,
  averageMaxHp,
  classSkillChoices,
  classWeaponProficiencies,
  computeAC,
  DND_ABILITIES,
  DND_BACKGROUNDS,
  DND_CLASSES,
  DND_LANGUAGES,
  DND_RACES,
  DND_SKILLS,
  findClass,
  formatModifier,
  proficiencyBonus,
  STANDARD_ARRAY,
} from '@table-sync/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { NumberField } from '../components/ui';
import { abilityShort } from '../i18n/labels';

/** Marker for the « Autre… » free-text escape on every catalog picker. */
const CUSTOM = '__custom__';

const STEPS = [
  { numeral: 'I', title: 'Identité' },
  { numeral: 'II', title: 'Classe' },
  { numeral: 'III', title: 'Espèce' },
  { numeral: 'IV', title: 'Historique' },
  { numeral: 'V', title: 'Caractéristiques' },
  { numeral: 'VI', title: 'Maîtrises' },
] as const;
const RECAP = STEPS.length; // step index of the signing screen

const DEFAULT_SCORES: Record<AbilityKey, number> = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

/** One-line class teaching: hit die, saves, spellcasting nature. */
function classSummary(cls: ClassInfo): string {
  const saves = cls.savingThrows.map((a) => abilityShort(a)).join(' & ');
  const castAbility = abilityShort(cls.spellcastingAbility ?? 'charisma');
  const cast =
    cls.spellcasting === 'none'
      ? 'aucune magie'
      : cls.spellcasting === 'pact'
        ? `magie de pacte (${castAbility})`
        : cls.spellcasting === 'artificier'
          ? `magie d’artificier (${castAbility})`
          : cls.preparesSpells
            ? `sorts préparés (${castAbility})`
            : `sorts connus (${castAbility})`;
  return `dé de vie d${cls.hitDie} · sauvegardes ${saves} · ${cast}`;
}

function weaponSummary(className: string | null): string {
  const set = classWeaponProficiencies(className);
  if (set.simple && set.martial) return 'armes simples et de guerre';
  if (set.simple) return 'armes simples';
  if (set.specific.length > 0) return 'quelques armes précises (voir la fiche)';
  return 'aucune par défaut (voir la fiche)';
}

/** The dotted run between a register label and its trailing value. */
function DotLeader() {
  return (
    <span
      aria-hidden="true"
      className="mx-2 min-w-6 flex-1 self-center border-b border-dotted border-parchment-300"
    />
  );
}

/** Step heading — the register's numeral grammar (TocHeader dialect). */
function StepHeader({ numeral, title }: { numeral: string; title: string }) {
  return (
    <div className="pb-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="w-8 shrink-0 text-right font-display text-base text-ink-300"
        >
          {numeral}
        </span>
        <h2 className="section-title">{title}</h2>
        <span
          aria-hidden="true"
          className="min-w-4 flex-1 self-center border-b border-parchment-200"
        />
      </div>
    </div>
  );
}

/** A register option row: inked with ● when chosen, teaching line beneath. */
function OptionRow({
  selected,
  title,
  meta,
  sub,
  onChoose,
  indent = false,
}: {
  selected: boolean;
  title: string;
  meta?: string;
  /** Ligne secondaire (résumé mécanique sous la description). */
  sub?: string;
  onChoose: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={selected}
      className={`w-full min-h-[3.25rem] rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
        indent ? 'ml-6 w-[calc(100%-1.5rem)]' : ''
      } ${
        selected
          ? 'border-blood-300 bg-blood-50'
          : 'border-parchment-200 bg-parchment-50 hover:border-parchment-300'
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`w-3 shrink-0 text-xs text-blood-600 ${selected ? '' : 'invisible'}`}
        >
          ●
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium text-ink-800">{title}</span>
      </span>
      {meta && <span className="mt-0.5 block pl-5 text-xs leading-snug text-ink-400">{meta}</span>}
      {sub && (
        <span className="mt-0.5 block pl-5 text-[11px] leading-snug text-ink-400/80 italic">
          {sub}
        </span>
      )}
    </button>
  );
}

/** Récap hero tile: one derived number with its teaching decomposition. */
function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-parchment-200 bg-parchment-50 px-2 py-3 text-center">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-400">
        {label}
      </span>
      <span className="mt-0.5 block font-display text-2xl font-bold tabular-nums text-ink-900">
        {value}
      </span>
      <span className="mt-1 block text-[11px] leading-tight text-ink-400">{note}</span>
    </div>
  );
}

export default function CharacterCreatePage() {
  const { t } = useTranslation();
  const { partyId } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  // I — Identité
  const [name, setName] = useState('');
  const [level, setLevel] = useState(1);
  const [secret, setSecret] = useState(false);
  // II — Classe
  const [classChoice, setClassChoice] = useState('Guerrier');
  const [customClass, setCustomClass] = useState('');
  // III — Espèce
  const [raceChoice, setRaceChoice] = useState<string | null>(null); // species name
  const [subraceChoice, setSubraceChoice] = useState<string | null>(null); // subrace name
  const [customRace, setCustomRace] = useState('');
  // IV — Historique
  const [bgChoice, setBgChoice] = useState<string | null>(null);
  const [customBackground, setCustomBackground] = useState('');
  // V — Caractéristiques
  const [freeMode, setFreeMode] = useState(false);
  const [assigned, setAssigned] = useState<Partial<Record<AbilityKey, number>>>({});
  const [pickedValue, setPickedValue] = useState<number | null>(STANDARD_ARRAY[0]);
  const [freeScores, setFreeScores] = useState<Record<AbilityKey, number>>(DEFAULT_SCORES);
  // VI — Maîtrises
  const [skills, setSkills] = useState<SkillKey[]>([]);
  const [langs, setLangs] = useState<string[]>(['Commun']);
  const [customLangs, setCustomLangs] = useState<string[]>([]);
  const [newLang, setNewLang] = useState('');
  // Signing
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  /** Move to an entry — each entry opens at the top of its screen. */
  function goTo(next: number) {
    setStep(next);
    setCreateError('');
    window.scrollTo(0, 0);
  }

  const effectiveClass =
    classChoice === CUSTOM ? customClass.trim() : classChoice === '' ? '' : classChoice;
  const effectiveRace =
    (raceChoice === CUSTOM
      ? customRace.trim()
      : raceChoice === null
        ? ''
        : (subraceChoice ?? raceChoice)) || null;
  const effectiveBackground = (bgChoice === CUSTOM ? customBackground.trim() : bgChoice) || null;

  const cls = useMemo(() => findClass(effectiveClass), [effectiveClass]);
  const skillChoice = useMemo(() => classSkillChoices(effectiveClass), [effectiveClass]);

  const scores = useMemo<Record<AbilityKey, number>>(() => {
    if (freeMode) return freeScores;
    const next = { ...DEFAULT_SCORES };
    for (const [key, value] of Object.entries(assigned)) {
      if (value != null) next[key as AbilityKey] = value;
    }
    return next;
  }, [freeMode, freeScores, assigned]);

  const abilitiesComplete = freeMode || DND_ABILITIES.every((a) => assigned[a.key] != null);
  const pool = STANDARD_ARRAY.filter((v) => !Object.values(assigned).includes(v));

  const hitDie = cls?.hitDie ?? 8;
  const maxHp = averageMaxHp(level, hitDie, scores.constitution);
  const acr = computeAC([], abilityModifier(scores.dexterity), false, {
    constitution: scores.constitution,
    wisdom: scores.wisdom,
    characterClass: effectiveClass || null,
  });
  const profBonus = proficiencyBonus(level);

  function assignTo(ability: AbilityKey) {
    if (pickedValue == null) return;
    const next = { ...assigned, [ability]: pickedValue };
    setAssigned(next);
    setPickedValue(STANDARD_ARRAY.find((v) => !Object.values(next).includes(v)) ?? null);
  }

  function resetScores() {
    setAssigned({});
    setPickedValue(STANDARD_ARRAY[0]);
  }

  function toggleSkill(key: SkillKey) {
    if (skills.includes(key)) setSkills(skills.filter((k) => k !== key));
    else if (skills.length < skillChoice.count) setSkills([...skills, key]);
  }

  function toggleLang(lang: string) {
    if (langs.includes(lang)) setLangs(langs.filter((l) => l !== lang));
    else setLangs([...langs, lang]);
  }

  function addCustomLang(e: React.FormEvent) {
    e.preventDefault();
    const lang = newLang.trim();
    if (!lang) return;
    if (!customLangs.includes(lang)) setCustomLangs([...customLangs, lang]);
    if (!langs.includes(lang)) setLangs([...langs, lang]);
    setNewLang('');
  }

  async function submit() {
    if (!name.trim()) {
      setCreateError('Donne un nom au personnage.');
      return;
    }
    setCreating(true);
    setCreateError('');
    const payload: CreateCharacterPayload = {
      name: name.trim(),
      strength: scores.strength,
      dexterity: scores.dexterity,
      constitution: scores.constitution,
      intelligence: scores.intelligence,
      wisdom: scores.wisdom,
      charisma: scores.charisma,
      maxHp,
      characterClass: effectiveClass || undefined,
      level,
      race: effectiveRace ?? undefined,
      background: effectiveBackground ?? undefined,
      skillProficiencies: skills,
      languages: langs,
      hidden: secret || undefined,
    };
    try {
      const res = await api.post(`/api/parties/${partyId}/characters`, payload);
      navigate(`/party/${partyId}/character/${res.data.character.id}`);
    } catch {
      setCreateError('Création impossible — vérifie la connexion.');
      setCreating(false);
    }
  }

  if (!partyId) return null;

  const current = step === RECAP ? { numeral: '✒', title: 'Récapitulatif' } : STEPS[step];

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      {/* Volume title over the head rule */}
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">
          {t('create.nouveau.personnage')}
        </h1>
        <p className="mt-1.5 text-sm text-ink-400">
          {t('create.six.entrees.au.registre.la.fiche')}
        </p>
      </header>
      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      {/* Numeral strip — the ink rises as entries are answered */}
      <nav
        aria-label={t('create.etapes.de.creation')}
        className="flex border-b border-parchment-200"
      >
        {STEPS.map((s, i) => {
          const state = i === step ? 'current' : i < step ? 'done' : 'todo';
          return (
            <button
              type="button"
              key={s.numeral}
              onClick={() => goTo(i)}
              aria-current={state === 'current' ? 'step' : undefined}
              aria-label={`Étape ${s.numeral} — ${s.title}`}
              title={s.title}
              className={`flex-1 py-2.5 font-display text-sm transition-colors ${
                state === 'current'
                  ? 'border-b-2 border-blood-600 font-bold text-blood-600'
                  : state === 'done'
                    ? 'text-blood-600 hover:bg-parchment-100'
                    : 'text-ink-300 hover:bg-parchment-100'
              }`}
            >
              {s.numeral}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => goTo(RECAP)}
          aria-current={step === RECAP ? 'step' : undefined}
          aria-label={t('create.recapitulatif')}
          title={t('create.recapitulatif')}
          className={`flex-1 py-2.5 font-display text-sm transition-colors ${
            step === RECAP
              ? 'border-b-2 border-blood-600 font-bold text-blood-600'
              : 'text-ink-300 hover:bg-parchment-100'
          }`}
        >
          ✒
        </button>
      </nav>

      <div key={step} className="sheet-tab-swap pt-6">
        <StepHeader numeral={current.numeral} title={current.title} />

        {/* I — Identité */}
        {step === 0 && (
          <div className="card space-y-4 p-4 sm:p-5">
            <div>
              <label className="label" htmlFor="create-name">
                Nom *
              </label>
              <input
                id="create-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Kaelen Vesse"
                maxLength={60}
                autoComplete="off"
              />
            </div>
            <div className="max-w-40">
              <label className="label" htmlFor="create-level">
                Niveau
              </label>
              <NumberField
                id="create-level"
                className="input"
                value={level}
                min={1}
                max={20}
                onChange={setLevel}
              />
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-parchment-200 p-3">
              <input
                id="create-hidden"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-blood-600"
                checked={secret}
                onChange={(e) => setSecret(e.target.checked)}
              />
              <label htmlFor="create-hidden" className="text-sm font-medium text-ink-700">
                {t('create.personnage.secret')}
                <span className="mt-0.5 block text-xs font-normal text-ink-400">
                  Prépare-le à l’abri des regards : invisible des autres joueurs et inactif (ni
                  liste, ni combat). Toi et le MD le voyez toujours.
                </span>
              </label>
            </div>
          </div>
        )}

        {/* II — Classe */}
        {step === 1 && (
          <div className="space-y-2">
            {DND_CLASSES.map((c) => (
              <OptionRow
                key={c.name}
                selected={classChoice === c.name}
                title={c.name}
                meta={c.description}
                sub={classSummary(c)}
                onChoose={() => {
                  setClassChoice(c.name);
                  setSkills([]); // lists differ per class
                }}
              />
            ))}
            <OptionRow
              selected={classChoice === CUSTOM}
              title="Autre…"
              meta="Classe maison ou hors catalogue."
              onChoose={() => setClassChoice(CUSTOM)}
            />
            {classChoice === CUSTOM && (
              <div className="pl-6">
                <label htmlFor="create-custom-class" className="label">
                  Classe
                </label>
                <input
                  id="create-custom-class"
                  className="input"
                  value={customClass}
                  onChange={(e) => setCustomClass(e.target.value)}
                  placeholder="Ma classe maison…"
                  maxLength={40}
                />
              </div>
            )}
          </div>
        )}

        {/* III — Espèce */}
        {step === 2 && (
          <div className="space-y-2">
            {DND_RACES.map((r) => (
              <div key={r.name} className="space-y-2">
                <OptionRow
                  selected={raceChoice === r.name}
                  title={r.name}
                  meta={r.description}
                  onChoose={() => {
                    setRaceChoice(r.name);
                    setSubraceChoice(null);
                  }}
                />
                {raceChoice === r.name &&
                  r.subraces.map((sub) => (
                    <OptionRow
                      key={sub.name}
                      indent
                      selected={subraceChoice === sub.name}
                      title={sub.name}
                      meta={sub.description}
                      onChoose={() => setSubraceChoice(sub.name)}
                    />
                  ))}
              </div>
            ))}
            <OptionRow
              selected={raceChoice === CUSTOM}
              title="Autre…"
              meta="Espèce maison ou hors catalogue."
              onChoose={() => setRaceChoice(CUSTOM)}
            />
            {raceChoice === CUSTOM && (
              <div className="pl-6">
                <label htmlFor="create-custom-race" className="label">
                  {t('create.espece')}
                </label>
                <input
                  id="create-custom-race"
                  className="input"
                  value={customRace}
                  onChange={(e) => setCustomRace(e.target.value)}
                  placeholder={t('create.mon.espece.maison')}
                  maxLength={40}
                />
              </div>
            )}
            <p className="pt-1 text-xs text-ink-400">
              {t('create.les.traits.cites.sont.un.rappel')}
            </p>
          </div>
        )}

        {/* IV — Historique */}
        {step === 3 && (
          <div className="space-y-2">
            {DND_BACKGROUNDS.map((b) => (
              <OptionRow
                key={b.name}
                selected={bgChoice === b.name}
                title={b.name}
                meta={b.description}
                onChoose={() => setBgChoice(b.name)}
              />
            ))}
            <OptionRow
              selected={bgChoice === CUSTOM}
              title="Autre…"
              meta="Historique maison ou hors catalogue."
              onChoose={() => setBgChoice(CUSTOM)}
            />
            {bgChoice === CUSTOM && (
              <div className="pl-6">
                <label htmlFor="create-custom-background" className="label">
                  Historique
                </label>
                <input
                  id="create-custom-background"
                  className="input"
                  value={customBackground}
                  onChange={(e) => setCustomBackground(e.target.value)}
                  placeholder="Mon historique maison…"
                  maxLength={40}
                />
              </div>
            )}
            <p className="pt-1 text-xs text-ink-400">
              {t('create.l.historique.offre.aussi.deux.competences')}
            </p>
          </div>
        )}

        {/* V — Caractéristiques */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex rounded-xl border border-parchment-200 bg-parchment-50 p-1">
              {[
                { id: false, label: 'Tableau standard' },
                { id: true, label: 'Saisie libre' },
              ].map((mode) => (
                <button
                  type="button"
                  key={mode.label}
                  aria-pressed={freeMode === mode.id}
                  onClick={() => setFreeMode(mode.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    freeMode === mode.id
                      ? 'bg-blood-600 text-white'
                      : 'text-ink-600 hover:bg-parchment-100'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {freeMode ? (
              <div className="card grid grid-cols-2 gap-3 p-4 sm:p-5">
                {DND_ABILITIES.map((abi) => (
                  <div key={abi.key}>
                    <label className="label" htmlFor={`create-score-${abi.key}`}>
                      {abi.label}
                    </label>
                    <NumberField
                      id={`create-score-${abi.key}`}
                      className="input"
                      min={1}
                      max={30}
                      value={freeScores[abi.key]}
                      onChange={(n) => setFreeScores({ ...freeScores, [abi.key]: n })}
                    />
                  </div>
                ))}
                <p className="col-span-2 text-xs text-ink-400">
                  Pose les valeurs annoncées à ta table (méthode du MD, jets déjà faits…).
                </p>
              </div>
            ) : (
              <div className="card space-y-4 p-4 sm:p-5">
                <div>
                  <p className="label">{t('create.tableau.standard.a.repartir')}</p>
                  <div className="flex flex-wrap gap-2">
                    {pool.length === 0 && (
                      <span className="text-sm text-ink-400">{t('create.tout.est.pose')}</span>
                    )}
                    {pool.map((v) => (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setPickedValue(v)}
                        aria-pressed={pickedValue === v}
                        className={`min-h-[2.75rem] rounded-full border px-4 py-1.5 font-bold tabular-nums transition-colors ${
                          pickedValue === v
                            ? 'border-blood-600 bg-blood-600 text-white'
                            : 'border-parchment-300 bg-parchment-50 text-ink-700 hover:border-blood-400'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-400">
                    {t('create.touche.une.valeur.puis.la.caracteristique')}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {DND_ABILITIES.map((abi) => {
                    const value = assigned[abi.key];
                    return (
                      <button
                        type="button"
                        key={abi.key}
                        onClick={() => assignTo(abi.key)}
                        disabled={pickedValue == null}
                        aria-label={`${abi.label} (${abilityShort(abi.key)}) — ${
                          value != null
                            ? `${value}, ${formatModifier(abilityModifier(value))}`
                            : 'poser ici'
                        }`}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors disabled:opacity-60 ${
                          value != null
                            ? 'border-blood-300 bg-blood-50'
                            : 'border-dashed border-parchment-300 bg-parchment-50 hover:border-blood-400'
                        }`}
                      >
                        <span className="min-w-0 flex-1 text-sm font-medium text-ink-800">
                          {abi.label}
                          <span className="ml-1.5 text-xs font-normal text-ink-400">
                            {abilityShort(abi.key)}
                          </span>
                        </span>
                        {value != null ? (
                          <>
                            <span className="font-display text-lg font-bold tabular-nums text-ink-900">
                              {value}
                            </span>
                            <span className="w-8 text-right text-sm tabular-nums text-ink-500">
                              {formatModifier(abilityModifier(value))}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm text-ink-300">— poser ici —</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-ghost text-sm text-ink-500"
                    onClick={resetScores}
                  >
                    {t('create.reinitialiser')}
                  </button>
                </div>
                {!abilitiesComplete && (
                  <p className="text-xs text-ink-400">
                    {t('create.pose.les.6.scores.pour.continuer')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* VI — Maîtrises */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="card space-y-3 p-4 sm:p-5">
              <h3 className="section-title text-base">
                Compétences — {skillChoice.count} au choix
                <span className="ml-2 font-body text-sm font-normal tabular-nums text-ink-400">
                  {skills.length}/{skillChoice.count}
                </span>
              </h3>
              <p className="text-xs text-ink-400">
                {skillChoice.anySkill
                  ? 'Cette classe choisit librement parmi les 18 compétences.'
                  : 'Parmi la liste de la classe.'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(skillChoice.anySkill ? DND_SKILLS.map((s) => s.key) : skillChoice.skills).map(
                  (key) => {
                    const label = DND_SKILLS.find((s) => s.key === key)?.label ?? key;
                    const on = skills.includes(key);
                    const full = skills.length >= skillChoice.count;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => toggleSkill(key)}
                        aria-pressed={on}
                        aria-disabled={!on && full}
                        className={`min-h-[2.5rem] rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          on
                            ? 'border-blood-300 bg-blood-50 text-ink-700'
                            : full
                              ? 'border-parchment-200 bg-parchment-100 text-ink-300'
                              : 'border-parchment-200 bg-parchment-50 text-ink-500 hover:border-blood-400'
                        }`}
                      >
                        {on && <span className="mr-1 text-xs text-blood-600">●</span>}
                        {label}
                      </button>
                    );
                  },
                )}
              </div>
              {skills.length >= skillChoice.count && (
                <p className="text-xs text-ink-400">
                  {t('create.plafond.atteint.touche.une.competence.pour')}
                </p>
              )}
            </div>

            <div className="card space-y-3 p-4 sm:p-5">
              <h3 className="section-title text-base">Langues</h3>
              <p className="text-xs text-ink-400">
                Ajoute celles que t’offrent ton espèce et ton historique (le rappel figure sur leurs
                descriptions).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...DND_LANGUAGES, ...customLangs].map((lang) => {
                  const on = langs.includes(lang);
                  return (
                    <button
                      type="button"
                      key={lang}
                      onClick={() => toggleLang(lang)}
                      aria-pressed={on}
                      className={`min-h-[2.5rem] rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        on
                          ? 'border-blood-300 bg-blood-50 text-ink-700'
                          : 'border-parchment-200 bg-parchment-50 text-ink-500 hover:border-blood-400'
                      }`}
                    >
                      {on && <span className="mr-1 text-xs text-blood-600">●</span>}
                      {lang}
                    </button>
                  );
                })}
              </div>
              <form onSubmit={addCustomLang} className="flex gap-2">
                <label htmlFor="create-new-language" className="sr-only">
                  Nouvelle langue
                </label>
                <input
                  id="create-new-language"
                  value={newLang}
                  onChange={(e) => setNewLang(e.target.value)}
                  placeholder="Autre langue…"
                  maxLength={40}
                  className="flex-1 rounded-lg border border-parchment-200 bg-parchment-50 px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-parchment-200 bg-parchment-100 px-3 py-2 text-sm font-medium text-ink-600 hover:border-parchment-300"
                >
                  {t('create.ajouter')}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ✒ — Récapitulatif : l'entrée prête à s'encrer */}
        {step === RECAP && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="PV max"
                value={String(maxHp)}
                note={
                  level > 1
                    ? `${level} niveaux à PV moyens · d${hitDie} + CON`
                    : `d${hitDie} + CON ${formatModifier(abilityModifier(scores.constitution))}`
                }
              />
              <StatTile label="CA" value={String(acr.ac)} note={acr.source} />
              <StatTile label="Vitesse" value="9 m" note="base, sans armure" />
            </div>

            <div className="card space-y-2 p-4 sm:p-5">
              <div className="flex items-center">
                <span className="text-sm font-medium text-ink-700">Classe</span>
                <DotLeader />
                <span className="text-sm text-ink-800">
                  {effectiveClass ? `${effectiveClass} ${level}` : 'sans classe'}
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-sm font-medium text-ink-700">{t('create.espece')}</span>
                <DotLeader />
                <span className="text-sm text-ink-800">{effectiveRace ?? '—'}</span>
              </div>
              <div className="flex items-center">
                <span className="text-sm font-medium text-ink-700">Historique</span>
                <DotLeader />
                <span className="text-sm text-ink-800">{effectiveBackground ?? '—'}</span>
              </div>
              <div className="flex items-center">
                <span className="text-sm font-medium text-ink-700">Sauvegardes</span>
                <DotLeader />
                <span className="flex flex-wrap justify-end gap-1.5">
                  {DND_ABILITIES.map((abi) => {
                    const prof = cls?.savingThrows.includes(abi.key) ?? false;
                    const total = abilityModifier(scores[abi.key]) + (prof ? profBonus : 0);
                    return (
                      <span
                        key={abi.key}
                        className={`rounded-md border px-1.5 py-0.5 text-xs tabular-nums ${
                          prof
                            ? 'border-blood-300 bg-blood-50 text-ink-700'
                            : 'border-parchment-200 bg-parchment-50 text-ink-400'
                        }`}
                      >
                        {prof && <span className="mr-0.5 text-[10px] text-blood-600">●</span>}
                        {abilityShort(abi.key)} {formatModifier(total)}
                      </span>
                    );
                  })}
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-sm font-medium text-ink-700">Armes</span>
                <DotLeader />
                <span className="text-right text-sm text-ink-800">
                  {weaponSummary(effectiveClass || null)}
                </span>
              </div>
              {skills.length > 0 && (
                <div className="flex items-center">
                  <span className="shrink-0 text-sm font-medium text-ink-700">
                    {t('create.competences')}
                  </span>
                  <DotLeader />
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {skills.map((key) => (
                      <span
                        key={key}
                        className="rounded-md border border-parchment-200 bg-parchment-50 px-1.5 py-0.5 text-xs text-ink-700"
                      >
                        {DND_SKILLS.find((s) => s.key === key)?.label ?? key}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div className="flex items-center">
                <span className="shrink-0 text-sm font-medium text-ink-700">Langues</span>
                <DotLeader />
                <span className="flex flex-wrap justify-end gap-1.5">
                  {langs.length === 0 ? (
                    <span className="text-sm text-ink-400">aucune</span>
                  ) : (
                    langs.map((lang) => (
                      <span
                        key={lang}
                        className="rounded-md border border-parchment-200 bg-parchment-50 px-1.5 py-0.5 text-xs text-ink-700"
                      >
                        {lang}
                      </span>
                    ))
                  )}
                </span>
              </div>
            </div>

            <p className="text-center text-xs text-ink-400">
              {t('create.l.equipement.et.les.sorts.t')}
            </p>
            {createError && (
              <p role="alert" className="text-center text-sm text-red-600">
                {createError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Register footer — one thumb, two doors */}
      <div className="sticky bottom-3 mt-6 flex gap-3 rounded-2xl border border-parchment-200 bg-parchment-50/95 p-2 shadow-[0_4px_12px_rgba(42,31,20,0.08)] backdrop-blur-sm">
        {step > 0 && (
          <button type="button" className="btn-secondary flex-1" onClick={() => goTo(step - 1)}>
            ← Retour
          </button>
        )}
        {step < RECAP ? (
          <button
            type="button"
            className="btn-primary flex-[2]"
            disabled={step === 4 && !abilitiesComplete}
            onClick={() => goTo(step + 1)}
          >
            Continuer →
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary flex-[2]"
            disabled={creating}
            onClick={submit}
          >
            {creating ? 'Inscription…' : '✒ Créer le personnage'}
          </button>
        )}
      </div>
    </div>
  );
}
