/**
 * Panneau « Armure » des modals d'objet personnalisé — plan « Contenus
 * personnalisés » (2026-11, PR armures). Une seule surface partagée par le
 * modal MD (GmDashboardPage) et le modal joueur (CharacterInventoryPage),
 * gabarit exact du panneau Arme (WeaponFields) : « Basée sur » (héritage
 * SRD surchargeable), famille SRD vraie type, CA de base, bonus magique,
 * force min + malus de discrétion, aperçu live.
 *
 * Le draft vit dans le state du modal hôte ; les champs d'armure ne partent
 * dans la payload QUE si category === 'armor' (l'hôte décide — voir
 * armorDraftPayload). L'hôte joueur passe `previewCharacter` (rendu chiffré
 * par computeAC sur le porteur réel) ; le MD passe null (rendu symbolique :
 * « + DEX » reste en lettres, aucun porteur n'existe encore — même
 * asymétrie que les armes). Les malus (force min, discrétion) sont
 * AFFICHÉS, jamais appliqués en silence : helper, pas automation.
 */
import type { Character } from '@table-sync/shared';
import { MUNDANE_ARMORS, computeAC, abilityModifier } from '@table-sync/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { appLang } from '../i18n';
import { Glyph } from './Glyph';
import { Chip } from './ui';

/** Familles SRD — l'ordre du sélecteur de type. */
export const ARMOR_FAMILY_KEYS = ['light', 'medium', 'heavy', 'shield'] as const;
export type ArmorFamilyKey = (typeof ARMOR_FAMILY_KEYS)[number];

/** Brouillon d'armure édité par le panneau — porté par le state du modal hôte. */
export interface ArmorDraft {
  /** Famille SRD vraie type — '' = pas encore choisie (repli heuristique API). */
  armorFamily: ArmorFamilyKey | '';
  /** CA de base en texte libre (8-20) — '' = vide. Bouclier : CA fixe SRD 2. */
  acBase: string;
  /** Force minimale en texte libre — '' = aucune. */
  strMin: string;
  /** Malus de discrétion (indicateur, jamais appliqué automatiquement). */
  stealthDisadvantage: boolean;
  /** 0–3 (or = magie). */
  magicBonus: number;
  /** Clé EN de MUNDANE_ARMORS ('Plate Armor') — null = armure libre. */
  baseArmor: string | null;
}

/** Draft vierge — l'hôte le pose à chaque ouverture en création. */
export const EMPTY_ARMOR_DRAFT: ArmorDraft = {
  armorFamily: '',
  acBase: '',
  strMin: '',
  stealthDisadvantage: false,
  magicBonus: 0,
  baseArmor: null,
};

/** Hydrate le draft depuis un item existant (édition MD). */
export function armorDraftFromItem(item: {
  armorFamily?: string | null;
  acBase?: number | null;
  strMin?: number | null;
  stealthDisadvantage?: boolean | null;
  magicBonus?: number | null;
  baseArmor?: string | null;
}): ArmorDraft {
  const family = ARMOR_FAMILY_KEYS.find((f) => f === item.armorFamily);
  return {
    armorFamily: family ?? '',
    acBase: item.acBase !== null && item.acBase !== undefined ? String(item.acBase) : '',
    strMin: item.strMin !== null && item.strMin !== undefined ? String(item.strMin) : '',
    stealthDisadvantage: !!item.stealthDisadvantage,
    magicBonus: item.magicBonus ?? 0,
    baseArmor: item.baseArmor ?? null,
  };
}

/** Champs d'armure prêts pour la payload POST/PATCH — à n'envoyer que pour
 *  category 'armor'. Un bouclier porte la CA SRD 2 (suivie à part, +2). */
export function armorDraftPayload(draft: ArmorDraft) {
  return {
    armorFamily: draft.armorFamily || null,
    acBase:
      draft.armorFamily === 'shield'
        ? 2
        : draft.acBase.trim() === ''
          ? null
          : Number(draft.acBase),
    strMin: draft.strMin.trim() === '' ? null : Number(draft.strMin),
    stealthDisadvantage: draft.stealthDisadvantage,
    magicBonus: draft.magicBonus,
    baseArmor: draft.baseArmor,
  };
}

export function ArmorFields({
  draft,
  onChange,
  previewCharacter = null,
}: {
  draft: ArmorDraft;
  onChange: (draft: ArmorDraft) => void;
  /** Personnage du porteur (modal joueur — rendu chiffré) ; null = symbolique (MD). */
  previewCharacter?: Character | null;
}) {
  const { t } = useTranslation();
  const en = appLang() === 'en';

  const isShield = draft.armorFamily === 'shield';
  const acRaw = draft.acBase.trim();
  const acNum = Number(acRaw);
  const acInvalid =
    !isShield && draft.armorFamily !== '' && (acRaw === '' || !Number.isInteger(acNum) || acNum < 8 || acNum > 20);

  const baseOptions = useMemo(
    () =>
      [...MUNDANE_ARMORS].sort((a, b) =>
        (en ? a.nameEn : a.nameFr).localeCompare(en ? b.nameEn : b.nameFr, en ? 'en' : 'fr'),
      ),
    [en],
  );

  // « Basée sur » : la sélection PRÉ-REMPLIT type/CA/FOR min/malus (D2 :
  // hérite, tout reste éditable) ; « — Libre — » ramène un draft vierge.
  const pickBase = (key: string) => {
    if (key === '') {
      const keepBonus = draft.magicBonus;
      onChange({ ...EMPTY_ARMOR_DRAFT, magicBonus: keepBonus });
      return;
    }
    const a = MUNDANE_ARMORS.find((m) => m.nameEn === key);
    if (!a) return;
    onChange({
      armorFamily: a.armorType,
      acBase: String(a.acBase),
      strMin: a.strMin > 0 ? String(a.strMin) : '',
      stealthDisadvantage: a.stealthDisadvantage,
      magicBonus: draft.magicBonus,
      baseArmor: key,
    });
  };

  // Aperçu live : computeAC sur le porteur réel (grammaire exacte de la
  // fiche), symbolique sinon — un état, pas une animation.
  const canPreview = draft.armorFamily !== '' && (isShield || (acRaw !== '' && !acInvalid));
  const previewAc = useMemo(() => {
    // Bouclier seul ou armure complète : computeAC rend exactement la
    // grammaire de la fiche (« 10 + DEX · Bouclier +3 » / « Cuirasse · 14 +2 »).
    if (!previewCharacter || !canPreview) return null;
    return computeAC(
      [{ item: armorPreviewItem(draft), equipped: true }],
      abilityModifier(previewCharacter.dexterity ?? 10),
      false,
      undefined,
      appLang(),
    );
  }, [draft, previewCharacter, canPreview]);

  const symbolicSuffix = isShield
    ? null
    : draft.armorFamily === 'light'
      ? t('armure.apercu.dex')
      : draft.armorFamily === 'medium'
        ? t('armure.apercu.cap')
        : t('armure.apercu.fixe');

  return (
    <div className="card p-4 space-y-3">
      <div>
        <span className="label" id="armure-type-libelle">
          {t('armure.type')}
        </span>
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2"
          role="group"
          aria-labelledby="armure-type-libelle"
        >
          {ARMOR_FAMILY_KEYS.map((key) => {
            const selected = draft.armorFamily === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ ...draft, armorFamily: key })}
                aria-pressed={selected}
                className={`min-h-11 px-2 rounded-lg border text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-ink-700 border-ink-700 text-parchment-50 font-semibold'
                    : 'bg-parchment-100 border-parchment-300 text-ink-600 hover:bg-parchment-200'
                }`}
              >
                {t(`armure.type.${key}`)}
              </button>
            );
          })}
        </div>
        {/* Chip informative : la règle SRD de la famille choisie, à la saisie. */}
        {draft.armorFamily !== '' && (
          <p className="text-xs text-ink-400 mt-1" role="note">
            {t(`armure.aide.${draft.armorFamily}`)}
          </p>
        )}
      </div>

      <label className="block">
        <span className="label">{t('armure.basee.sur')}</span>
        <select
          className="input"
          value={draft.baseArmor ?? ''}
          onChange={(e) => pickBase(e.target.value)}
        >
          <option value="">{t('armure.basee.libre')}</option>
          {baseOptions.map((a) => (
            <option key={a.nameEn} value={a.nameEn}>
              {en ? a.nameEn : a.nameFr}
            </option>
          ))}
        </select>
      </label>

      {/* Un bouclier porte la CA SRD 2 (suivie à part) — pas de saisie. */}
      {!isShield && (
        <label className="block">
          <span className="label">{t('armure.ca.base')}</span>
          <input
            type="number"
            inputMode="numeric"
            className={`input ${acInvalid ? 'border-orange-400' : ''}`}
            value={draft.acBase}
            onChange={(e) => onChange({ ...draft, acBase: e.target.value })}
            placeholder="14"
            min={8}
            max={20}
            aria-label={t('armure.ca.base')}
            aria-invalid={acInvalid || undefined}
            aria-describedby={acInvalid ? 'armure-ca-erreur' : undefined}
          />
          {acInvalid && (
            <span id="armure-ca-erreur" className="block text-xs text-orange-700 mt-1">
              {t('armure.ca.invalide')}
            </span>
          )}
        </label>
      )}

      <div>
        <span className="label">{t('armure.bonus.magique')}</span>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('armure.bonus.magique')}>
          {[0, 1, 2, 3].map((bonus) => {
            const selected = draft.magicBonus === bonus;
            return (
              <button
                key={bonus}
                type="button"
                onClick={() => onChange({ ...draft, magicBonus: bonus })}
                aria-pressed={selected}
                className={`min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-gold-100 border-gold-300 text-gold-700 font-semibold'
                    : 'bg-parchment-100 border-parchment-300 text-ink-600 hover:bg-parchment-200'
                }`}
              >
                {bonus === 0 ? t('armure.aucun') : `+${bonus}`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <label className="block">
          <span className="label">{t('armure.force.min')}</span>
          <input
            type="number"
            inputMode="numeric"
            className="input"
            value={draft.strMin}
            onChange={(e) => onChange({ ...draft, strMin: e.target.value })}
            placeholder="—"
            aria-label={t('armure.force.min')}
          />
        </label>
        <label className="flex items-center gap-2 min-h-11 pb-1 text-sm text-ink-700">
          <input
            id="armure-malus-discretion"
            type="checkbox"
            className="h-4 w-4 accent-blood-600"
            checked={draft.stealthDisadvantage}
            onChange={(e) => onChange({ ...draft, stealthDisadvantage: e.target.checked })}
          />
          <span>{t('armure.malus.discretion')}</span>
        </label>
      </div>

      <div className="pt-1">
        <span className="label">{t('armure.apercu')}</span>
        {canPreview ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {previewAc ? (
              <Chip
                tone="orange"
                title={`${t('inv.armure.apercu.chiffre', { ac: previewAc.ac })} — ${previewAc.source}`}
              >
                <Glyph name="shield" /> {previewAc.ac}
              </Chip>
            ) : (
              <Chip tone="orange" title={t('armure.apercu')}>
                <Glyph name="shield" /> {isShield ? '+2' : `${acNum} ${symbolicSuffix ?? ''}`}
              </Chip>
            )}
            {draft.magicBonus > 0 && (
              <Chip tone="gold" className="font-semibold">
                <Glyph name="spark" /> +{draft.magicBonus}
              </Chip>
            )}
            {draft.stealthDisadvantage && (
              <Chip tone="amber" title={t('armure.malus.discretion')}>
                <Glyph name="hide" /> {t('armure.discretion.court')}
              </Chip>
            )}
          </div>
        ) : (
          <p className="text-xs text-ink-400">{t('armure.apercu.vide')}</p>
        )}
      </div>
    </div>
  );
}

/** Item factice pour l'aperçu computeAC (le draft n'a pas encore d'identité). */
function armorPreviewItem(draft: ArmorDraft) {
  return {
    category: 'armor' as const,
    acBase:
      draft.armorFamily === 'shield'
        ? 2
        : draft.acBase.trim() === ''
          ? null
          : Number(draft.acBase),
    strMin: draft.strMin.trim() === '' ? null : Number(draft.strMin),
    name: '',
    nameFr: null,
    description: null,
    baseArmor: draft.baseArmor,
    armorFamily: (draft.armorFamily || null) as ArmorFamilyKey | null,
    magicBonus: draft.magicBonus,
  };
}
