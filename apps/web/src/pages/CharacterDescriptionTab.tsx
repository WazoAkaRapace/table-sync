/**
 * Description tab — identity & class lines (multiclassage SRD 5.1), physical
 * description, portrait, personality traits, backstory, and allies &
 * organizations.
 *
 * Une fiche mono-classe voit un seul stepper de niveau, comme avant ; la
 * complexité multiclassée (feuille guidée, prérequis, styles par classe)
 * n'apparaît qu'avec une deuxième ligne de classe.
 */

import {
  type Character,
  type CharacterClassEntry,
  CLASS_SUBCLASSES,
  classesOf,
  FIGHTING_STYLE_CLASSES,
  FIGHTING_STYLE_LABELS_FR,
  type FightingStyle,
  findClass,
  LAND_CIRCLES,
  multiclassPrereqStatuses,
  type PatchCharacterPayload,
} from '@table-sync/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { useAuth } from '../auth';
import AddClassSheet from '../components/AddClassSheet';
import { BottomSheet, ConfirmButton } from '../components/ui';
import { fightingStyleLabel } from '../i18n/labels';

interface Props {
  character: Character;
  charId: number;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

// Fields that are simple text inputs
const PHYSICAL_FIELDS: Array<{ key: keyof Character; label: string; placeholder?: string }> = [
  { key: 'alignment', label: 'Alignement', placeholder: 'Loyal Bon' },
  { key: 'sex', label: 'Sexe', placeholder: 'M / F' },
  { key: 'age', label: 'Âge', placeholder: '125 ans' },
  { key: 'height', label: 'Taille', placeholder: '1,80 m' },
  { key: 'weight', label: 'Poids', placeholder: '80 kg' },
  { key: 'skin', label: 'Peau', placeholder: 'Pâle' },
  { key: 'eyes', label: 'Yeux', placeholder: 'Bleus' },
  { key: 'hair', label: 'Cheveux', placeholder: 'Noirs, courts' },
];

const PERSONALITY_FIELDS: Array<{ key: keyof Character; label: string; placeholder: string }> = [
  {
    key: 'personalityTraits',
    label: 'Traits de personnalité',
    placeholder: "Je suis animé d'une curiosité insatiable…",
  },
  { key: 'ideals', label: 'Idéaux', placeholder: 'Le savoir est la plus grande richesse.' },
  { key: 'bonds', label: 'Liens', placeholder: 'Je cherche mon maître disparu.' },
  { key: 'flaws', label: 'Défauts', placeholder: 'Je suis incapable de résister à un mystère.' },
];

/** Niveau d'acquisition du style de combat par classe (SRD). */
const STYLE_UNLOCK: Record<string, number> = {
  Guerrier: 1,
  Paladin: 2,
  Rôdeur: 2,
};

/** Libellé de la voie de sous-classe d'une ligne. */
function subclassLabel(entry: CharacterClassEntry): string | null {
  if (!entry.subclassKey) return null;
  if (entry.classKey === 'Druide' && entry.subclassKey === 'terre') return 'Cercle de la Terre';
  const def = (CLASS_SUBCLASSES[entry.classKey] ?? []).find((s) => s.key === entry.subclassKey);
  return def?.label ?? null;
}

export default function CharacterDescriptionTab({ character, charId, onSaved, onError }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = user?.id === character.ownerId;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [raceDraft, setRaceDraft] = useState(character.race ?? '');
  const [bgDraft, setBgDraft] = useState(character.background ?? '');
  const [identityOpen, setIdentityOpen] = useState(false);
  const [addClassOpen, setAddClassOpen] = useState(false);

  const classLines = classesOf(character);
  const totalLevel = classLines.reduce((sum, c) => sum + c.level, 0);
  const prereqIssues = multiclassPrereqStatuses(character);

  useEffect(() => {
    const d: Record<string, string> = {};
    for (const f of PHYSICAL_FIELDS) d[f.key] = (character[f.key] as string) ?? '';
    for (const f of PERSONALITY_FIELDS) d[f.key] = (character[f.key] as string) ?? '';
    d.appearance = character.appearance ?? '';
    d.backstory = character.backstory ?? '';
    d.alliesOrganizations = character.alliesOrganizations ?? '';
    setDrafts(d);
    setRaceDraft(character.race ?? '');
    setBgDraft(character.background ?? '');
  }, [character]);

  const patchCharacter = useCallback(
    async (payload: PatchCharacterPayload, errMsg: string) => {
      try {
        await api.patch(`/api/characters/${charId}`, payload);
        await onSaved();
      } catch {
        onError(errMsg);
      }
    },
    [charId, onSaved, onError],
  );

  /** Remplace l'ensemble des lignes de classe (PATCH atomique côté API). */
  const patchClasses = useCallback(
    (entries: CharacterClassEntry[]) => {
      patchCharacter({ classes: entries }, 'Impossible de mettre à jour les classes');
    },
    [patchCharacter],
  );

  const bumpLevel = (classKey: string, delta: number) => {
    const entries = classLines.map((c) => ({ ...c }));
    const target = entries.find((c) => c.classKey === classKey);
    if (!target) return;
    const next = target.level + delta;
    if (next < 1) return;
    const newTotal = entries.reduce(
      (sum, c) => sum + (c.classKey === classKey ? next : c.level),
      0,
    );
    if (newTotal > 20) return; // somme plafonnée — l'erreur inline reste visible
    target.level = next;
    patchClasses(entries);
  };

  const setSubclass = (classKey: string, key: string | null) => {
    patchClasses(classLines.map((c) => (c.classKey === classKey ? { ...c, subclassKey: key } : c)));
  };

  const setStyle = (classKey: string, style: FightingStyle | null) => {
    patchClasses(
      classLines.map((c) => (c.classKey === classKey ? { ...c, fightingStyle: style } : c)),
    );
  };

  const removeClass = (classKey: string) => {
    if (classLines.length <= 1) return;
    patchClasses(classLines.filter((c) => c.classKey !== classKey));
  };

  const handleAddClass = (entry: CharacterClassEntry) => {
    patchClasses([...classLines, entry]);
  };

  const commitField = (key: string) => {
    const draftVal = drafts[key];
    const currentVal = (character[key as keyof Character] as string) ?? '';
    if (draftVal === undefined || draftVal === currentVal) return;
    patchCharacter({ [key]: draftVal.trim() || null }, 'Erreur de mise à jour');
  };

  const handlePortraitUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Read, resize to max 256x256 via canvas, then encode as base64
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 256;
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        patchCharacter({ portraitUrl: dataUrl }, 'Erreur lors du téléversement');
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const removePortrait = () => {
    patchCharacter({ portraitUrl: null }, 'Erreur de mise à jour');
  };

  const commitRace = () => {
    if (raceDraft === (character.race ?? '')) return;
    patchCharacter({ race: raceDraft.trim() || null }, 'Erreur de mise à jour');
  };

  const commitBackground = () => {
    if (bgDraft === (character.background ?? '')) return;
    patchCharacter({ background: bgDraft.trim() || null }, 'Erreur de mise à jour');
  };

  const closeIdentity = () => {
    commitRace();
    commitBackground();
    setIdentityOpen(false);
  };

  // Ligne résumé : « Guerrier 5 / Magicien 3 » + sous-classes
  const summaryClass =
    classLines.length > 0
      ? classLines.map((c) => `${c.classKey} ${c.level}`).join(' / ')
      : `Niveau ${character.level ?? 1} · classe non définie`;
  const subclassLine = classLines
    .map((c) => {
      const label = subclassLabel(c);
      if (c.classKey === 'Druide' && c.subclassKey === 'terre' && character.landCircle) {
        const terrain = LAND_CIRCLES.find((t) => t.key === character.landCircle)?.label;
        return [label, terrain].filter(Boolean).join(' · ');
      }
      return label;
    })
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4">
      {/* Identity & class — summary card, full editor in bottom sheet */}
      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">{t('desc.identite.classe')}</h2>
          <button
            type="button"
            onClick={() => setIdentityOpen(true)}
            className="btn-secondary text-sm px-3 py-2"
          >
            {t('desc.modifier')}
          </button>
        </div>
        <div className="space-y-1">
          <p className="font-display text-lg font-semibold text-ink-800">
            {classLines.length > 1
              ? classLines.map((c) => (
                  <span key={c.classKey}>
                    {c.classKey} <span className="font-mono">{c.level}</span>
                    {c !== classLines[classLines.length - 1] ? ' / ' : ''}
                  </span>
                ))
              : summaryClass}
          </p>
          {subclassLine && <p className="text-sm text-ink-700">{subclassLine}</p>}
          <p className="text-sm text-ink-500">
            {[character.race, character.background].filter(Boolean).join(' · ') ||
              'Race et historique non définies'}
          </p>
        </div>
      </section>

      {/* Identity editor sheet */}
      <BottomSheet
        open={identityOpen}
        onClose={closeIdentity}
        title={t('desc.identite.classe')}
        mobileOnly={false}
      >
        <div className="space-y-4">
          {/* Lignes de classe (multiclassage SRD) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">
                {t('desc.lignes.de.classe')}
              </p>
              <p className="text-xs text-ink-500">
                Niveau total&nbsp;<span className="font-mono">{totalLevel}</span>/20
              </p>
            </div>
            {totalLevel >= 20 && (
              <p className="text-sm text-orange-600">Niveau total maximal atteint (20).</p>
            )}
            <div className="space-y-3">
              {classLines.map((entry, index) => {
                const name = entry.classKey;
                const info = findClass(name);
                const subclassOptions = CLASS_SUBCLASSES[name] ?? [];
                const issue = prereqIssues.find((p) => p.classKey === name);
                const styleUnlock = STYLE_UNLOCK[name];
                const styleEligible =
                  FIGHTING_STYLE_CLASSES.includes(name) && entry.level >= (styleUnlock ?? 99);
                return (
                  <div
                    key={name}
                    className="rounded-xl border border-parchment-300 bg-parchment-50 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-800 truncate">
                          {name}
                          {index === 0 && (
                            <span className="text-xs font-normal text-ink-400">
                              {t('desc.depart')}
                            </span>
                          )}
                          <span className="text-xs font-normal text-ink-400">
                            {' '}
                            · d{info?.hitDie ?? 8}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="btn-secondary w-11 h-11 text-lg"
                          aria-label={`Retirer un niveau de ${name}`}
                          onClick={() => bumpLevel(name, -1)}
                        >
                          −
                        </button>
                        <span className="font-mono text-lg w-8 text-center">{entry.level}</span>
                        <button
                          type="button"
                          className="btn-secondary w-11 h-11 text-lg"
                          aria-label={`Ajouter un niveau de ${name}`}
                          onClick={() => bumpLevel(name, 1)}
                        >
                          +
                        </button>
                        {classLines.length > 1 && (
                          <button
                            type="button"
                            className="text-xs text-red-500 hover:text-red-700 px-2 h-11"
                            aria-label={`Retirer la classe ${name}`}
                            onClick={() => removeClass(name)}
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    </div>
                    {issue && !issue.satisfied && (
                      <p className="text-xs text-orange-600">
                        ⚠ Prérequis ({issue.details.join(' / ')}) — à valider avec le MD.
                      </p>
                    )}
                    {subclassOptions.length > 0 && (
                      <label className="flex items-center justify-between gap-3">
                        <span className="label mb-0 text-xs">{t('desc.voie.de.classe')}</span>
                        <select
                          className="input py-1.5 text-sm w-auto max-w-[60%]"
                          value={entry.subclassKey ?? ''}
                          onChange={(e) =>
                            setSubclass(name, e.target.value === '' ? null : e.target.value)
                          }
                          aria-label={`Voie de classe de ${name}`}
                        >
                          <option value="">—</option>
                          {subclassOptions.map((s) => (
                            <option key={s.key} value={s.key} disabled={s.level > entry.level}>
                              {s.label}
                              {s.level > entry.level ? ` (niv. ${s.level})` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {name === 'Druide' && entry.subclassKey === 'terre' && (
                      <label className="flex items-center justify-between gap-3">
                        <span className="label mb-0 text-xs">{t('desc.terrain.du.cercle')}</span>
                        <select
                          className="input py-1.5 text-sm w-auto max-w-[60%]"
                          value={character.landCircle ?? ''}
                          onChange={(e) =>
                            patchCharacter(
                              { landCircle: e.target.value === '' ? null : e.target.value },
                              'Erreur de mise à jour',
                            )
                          }
                          aria-label={t('desc.terrain.du.cercle')}
                        >
                          <option value="">—</option>
                          {LAND_CIRCLES.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {styleEligible && (
                      <label className="flex items-center justify-between gap-3">
                        <span className="label mb-0 text-xs">{t('desc.style.de.combat')}</span>
                        <select
                          className="input py-1.5 text-sm w-auto max-w-[60%]"
                          value={entry.fightingStyle ?? ''}
                          onChange={(e) =>
                            setStyle(
                              name,
                              e.target.value === '' ? null : (e.target.value as FightingStyle),
                            )
                          }
                          aria-label={`Style de combat de ${name}`}
                        >
                          <option value="">—</option>
                          {(Object.keys(FIGHTING_STYLE_LABELS_FR) as FightingStyle[]).map((s) => (
                            <option key={s} value={s}>
                              {fightingStyleLabel(s as FightingStyle)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="btn-ghost text-sm px-3 py-2"
              onClick={() => setAddClassOpen(true)}
            >
              {t('desc.ajouter.une.classe')}
            </button>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Race</span>
              <input
                type="text"
                className="input"
                value={raceDraft}
                onChange={(e) => setRaceDraft(e.target.value)}
                onBlur={commitRace}
                placeholder="Haut-elfe"
              />
            </label>
            <label className="block">
              <span className="label">Historique</span>
              <input
                type="text"
                className="input"
                value={bgDraft}
                onChange={(e) => setBgDraft(e.target.value)}
                onBlur={commitBackground}
                placeholder="Sage"
              />
            </label>
          </div>
        </div>
      </BottomSheet>

      {/* Feuille guidée d'ajout de classe (multiclassage) */}
      <AddClassSheet
        open={addClassOpen}
        onClose={() => setAddClassOpen(false)}
        character={character}
        currentClasses={classLines}
        onAdd={handleAddClass}
      />

      {/* Portrait + physical attributes */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">Apparence</h2>

        {/* Portrait */}
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            {character.portraitUrl ? (
              <img
                src={character.portraitUrl}
                alt={character.name}
                className="w-24 h-24 rounded-full object-cover border-2 border-parchment-300 shadow-sm"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-parchment-200 flex items-center justify-center text-3xl text-ink-400 border-2 border-parchment-300">
                👤
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePortraitUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-primary text-sm px-3 py-1.5"
            >
              📷 {character.portraitUrl ? 'Changer' : 'Téléverser'}
            </button>
            {character.portraitUrl && (
              <ConfirmButton
                onConfirm={removePortrait}
                className="text-xs text-red-500 hover:text-red-700"
                armedClassName="font-semibold text-red-700!"
                confirmChildren="Confirmer ?"
                title={t('desc.supprimer.le.portrait')}
                ariaLabel="Supprimer le portrait"
              >
                {t('desc.supprimer')}
              </ConfirmButton>
            )}
          </div>
        </div>

        {/* Physical attributes grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PHYSICAL_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="label">{f.label}</span>
              <input
                type="text"
                className="input"
                value={drafts[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => commitField(f.key)}
              />
            </label>
          ))}
        </div>

        {/* Appearance textarea */}
        <label className="block">
          <span className="label">Description physique</span>
          <textarea
            className="input min-h-[80px] resize-y"
            value={drafts.appearance ?? ''}
            placeholder={t('desc.un.elfe.elance.portant.une.robe')}
            onChange={(e) => setDrafts((d) => ({ ...d, appearance: e.target.value }))}
            onBlur={() => commitField('appearance')}
          />
        </label>
      </section>

      {/* Personality */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">{t('desc.personnalite')}</h2>
        <div className="space-y-3">
          {PERSONALITY_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="label">{f.label}</span>
              <textarea
                className="input min-h-[60px] resize-y"
                value={drafts[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => commitField(f.key)}
              />
            </label>
          ))}
        </div>
      </section>

      {/* Backstory (distinct de l'« Historique » de l'identité — le stat 5e « Sage ») */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">Historique</h2>
        <label className="block">
          <span className="label">{t('desc.histoire.du.personnage')}</span>
          <textarea
            className="input min-h-[120px] resize-y"
            value={drafts.backstory ?? ''}
            placeholder={t('desc.nee.dans.un.village.de.pecheurs')}
            onChange={(e) => setDrafts((d) => ({ ...d, backstory: e.target.value }))}
            onBlur={() => commitField('backstory')}
          />
        </label>
      </section>

      {/* Allies & organizations */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">{t('desc.allies.et.organisations')}</h2>
        <label className="block">
          <span className="label">{t('desc.allies.mentors.guildes.et.factions')}</span>
          <textarea
            className="input min-h-[80px] resize-y"
            value={drafts.alliesOrganizations ?? ''}
            placeholder={t('desc.la.confrerie.du.givre.harshnag.le')}
            onChange={(e) => setDrafts((d) => ({ ...d, alliesOrganizations: e.target.value }))}
            onBlur={() => commitField('alliesOrganizations')}
          />
        </label>
      </section>

      {/* Visibility — the owner's call alone (secret prep) */}
      {isOwner && (
        <section className="card p-4 sm:p-5 space-y-3">
          <h2 className="section-title">{t('desc.visibilite')}</h2>
          <p className="text-sm text-ink-500">
            {character.hidden ? (
              <>
                {t('desc.ce.personnage.est')}
                <strong>{t('desc.cache')}</strong>
                {t('desc.les.autres.joueurs.ne.le.voient')}
              </>
            ) : (
              <>
                Ce personnage est visible de toute la table. Cache-le pour préparer une surprise —
                il disparaît des listes des autres joueurs, quitte les combats en cours, et «{' '}
                <em>{t('desc.ma.fiche')}</em>
                {t('desc.pointe.sur.ton.personnage.actif')}
              </>
            )}
          </p>
          <div>
            <button
              type="button"
              className={character.hidden ? 'btn-primary' : 'btn-secondary'}
              onClick={() =>
                patchCharacter({ hidden: !character.hidden }, 'Impossible de changer la visibilité')
              }
            >
              {character.hidden ? '👁 Révéler à la table' : '🙈 Cacher des autres joueurs'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
