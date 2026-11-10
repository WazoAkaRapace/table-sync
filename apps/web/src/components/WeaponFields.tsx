/**
 * Panneau « Arme » des modals d'objet personnalisé — plan « Armes
 * personnalisées complètes » (2026-11). Une seule surface partagée par le
 * modal MD (GmDashboardPage) et le modal joueur (CharacterInventoryPage) :
 * « Basée sur » (héritage SRD surchargeable), template de dégâts libre,
 * type SRD, bonus magique, propriétés + dés à deux mains, aperçu live.
 *
 * Le draft vit dans le state du modal hôte ; les champs d'arme ne partent
 * dans la payload QUE si category === 'weapon' (l'hôte décide — voir
 * weaponDraftPayload). L'hôte joueur passe `previewCharacter` (rendu chiffré
 * par computeWeaponStats, exactement la grammaire de la fiche) ; le MD passe
 * null (rendu symbolique : FOR/DEX/magie restent des lettres, aucun porteur
 * n'existe encore). L'aperçu est un état, pas une animation (brief § 7).
 */
import type { Character } from '@table-sync/shared';
import {
  DAMAGE_TYPE_LABELS_FR,
  MUNDANE_WEAPONS,
  WEAPON_PROPERTY_LABELS_FR,
  computeWeaponStats,
  parseDamageTemplate,
} from '@table-sync/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MagicBonusField } from './MagicBonusField';
import { appLang } from '../i18n';
import { damageType, weaponPropertyLabel } from '../i18n/labels';
import { Glyph } from './Glyph';
import { Chip } from './ui';

/** Brouillon d'arme édité par le panneau — porté par le state du modal hôte. */
export interface WeaponDraft {
  /** Clé EN de MUNDANE_WEAPONS ('Greatsword') — null = arme libre. */
  baseWeapon: string | null;
  /** Template de dégâts libre (« 4d6+FOR+2 ») — '' = hérite de la base SRD. */
  damageDice: string;
  /** Template à deux mains (armes polyvalentes). */
  twoHandedDice: string;
  /** Clé de DAMAGE_TYPE_LABELS_FR ('Slashing'…) — '' = hérite. */
  damageType: string;
  /** 0–3 (or = magie). */
  magicBonus: number;
  /** Clés de WEAPON_PROPERTY_LABELS_FR. */
  properties: string[];
}

/** Draft vierge — l'hôte le pose à chaque ouverture en création. */
export const EMPTY_WEAPON_DRAFT: WeaponDraft = {
  baseWeapon: null,
  damageDice: '',
  twoHandedDice: '',
  damageType: '',
  magicBonus: 0,
  properties: [],
};

/** Hydrate le draft depuis un item existant (édition MD). */
export function weaponDraftFromItem(item: {
  baseWeapon?: string | null;
  damageDice?: string | null;
  twoHandedDice?: string | null;
  damageType?: string | null;
  magicBonus?: number | null;
  properties?: string[] | null;
}): WeaponDraft {
  return {
    baseWeapon: item.baseWeapon ?? null,
    damageDice: item.damageDice ?? '',
    twoHandedDice: item.twoHandedDice ?? '',
    damageType: item.damageType ?? '',
    magicBonus: item.magicBonus ?? 0,
    properties: item.properties ? [...item.properties] : [],
  };
}

/** Champs d'arme prêts pour la payload POST/PATCH — à n'envoyer que pour
 *  category 'weapon'. Les templates vides deviennent null (héritage SRD) ;
 *  les dés 2M ne partent que si Polyvalente est cochée (même règle API). */
export function weaponDraftPayload(draft: WeaponDraft) {
  const versatile = draft.properties.includes('versatile');
  return {
    damageDice: draft.damageDice.trim() || null,
    damageType: draft.damageType || null,
    twoHandedDice: versatile ? draft.twoHandedDice.trim() || null : null,
    magicBonus: draft.magicBonus,
    baseWeapon: draft.baseWeapon,
    properties: draft.properties,
  };
}

/** Rendu symbolique d'un template (MD sans porteur) : les mots-clés restent
 *  des lettres, les dés et fixes gardent leurs valeurs — « 4d6+FOR+2 ». */
function renderSymbolic(expr: string): string | null {
  const parsed = parseDamageTemplate(expr);
  if (!parsed) return null;
  let out = '';
  for (const tok of parsed.tokens) {
    const part =
      tok.kind === 'dice'
        ? `${tok.count}d${tok.faces}`
        : tok.kind === 'fixed'
          ? String(tok.value)
          : tok.kind === 'str'
            ? 'FOR'
            : tok.kind === 'dex'
              ? 'DEX'
              : 'magie';
    out = out === '' || part.startsWith('-') ? `${out}${part}` : `${out}+${part}`;
  }
  return out === '' ? null : out;
}

export function WeaponFields({
  draft,
  onChange,
  previewCharacter = null,
}: {
  draft: WeaponDraft;
  onChange: (draft: WeaponDraft) => void;
  /** Personnage du porteur (modal joueur — rendu chiffré) ; null = symbolique (MD). */
  previewCharacter?: Character | null;
}) {
  const { t } = useTranslation();
  const en = appLang() === 'en';

  // Validation live : erreur inline ORANGE (règle, jamais de rouge) tant que
  // le template ne parse pas — double barrière, l'API revalide à 400.
  const dice = draft.damageDice.trim();
  const diceInvalid = dice !== '' && parseDamageTemplate(dice) === null;
  const versatile = draft.properties.includes('versatile');
  const twoHanded = draft.twoHandedDice.trim();
  const twoHandedInvalid = versatile && twoHanded !== '' && parseDamageTemplate(twoHanded) === null;

  const baseOptions = useMemo(
    () =>
      [...MUNDANE_WEAPONS].sort((a, b) =>
        (en ? a.nameEn : a.nameFr).localeCompare(en ? b.nameEn : b.nameFr, en ? 'en' : 'fr'),
      ),
    [en],
  );
  const base = draft.baseWeapon
    ? MUNDANE_WEAPONS.find((m) => m.nameEn === draft.baseWeapon)
    : undefined;

  // « Basée sur » : la sélection PRÉ-REMPLIT dés/type/propriétés/2M (D2 :
  // hérite, tout reste éditable) ; « — Libre — » ramène un draft vierge.
  const pickBase = (key: string) => {
    if (key === '') {
      onChange({ ...EMPTY_WEAPON_DRAFT });
      return;
    }
    const w = MUNDANE_WEAPONS.find((m) => m.nameEn === key);
    if (!w) return;
    onChange({
      baseWeapon: key,
      damageDice: w.dice,
      damageType: w.damageType,
      twoHandedDice: w.twoHandedDice ?? '',
      magicBonus: draft.magicBonus,
      properties: [...w.properties],
    });
  };

  const toggleProperty = (key: string) => {
    onChange({
      ...draft,
      properties: draft.properties.includes(key)
        ? draft.properties.filter((p) => p !== key)
        : [...draft.properties, key],
    });
  };

  // Aperçu live : computeWeaponStats sur le porteur réel (grammaire exacte de
  // la fiche — dés 2M héritées de la base comprises), symbolique sinon.
  const previewStats = useMemo(() => {
    if (!previewCharacter || dice === '' || parseDamageTemplate(dice) === null) return null;
    return computeWeaponStats(
      {
        category: 'weapon',
        name: '',
        baseWeapon: draft.baseWeapon,
        baseArmor: null,
        armorFamily: null,
        magicBonus: draft.magicBonus,
        damageDice: dice,
        damageType: draft.damageType || null,
        twoHandedDice:
          twoHanded !== '' && parseDamageTemplate(twoHanded) !== null ? twoHanded : null,
        properties: draft.properties,
      },
      previewCharacter,
    );
  }, [draft, dice, twoHanded, previewCharacter]);

  const twoHandedExpr =
    twoHanded !== '' && parseDamageTemplate(twoHanded) !== null
      ? twoHanded
      : (base?.twoHandedDice ?? null);
  const mainLine = previewStats
    ? previewStats.damageStr
    : dice === ''
      ? null
      : renderSymbolic(dice);
  const twoHandedLine = previewStats
    ? previewStats.versatileDamageStr
    : twoHandedExpr === null
      ? null
      : renderSymbolic(twoHandedExpr);
  const typeLabel = draft.damageType ? damageType(DAMAGE_TYPE_LABELS_FR[draft.damageType]) : null;

  return (
    <div className="card p-4 space-y-3">
      <label className="block">
        <span className="label">{t('arme.basee.sur')}</span>
        <select
          className="input"
          value={draft.baseWeapon ?? ''}
          onChange={(e) => pickBase(e.target.value)}
        >
          <option value="">{t('arme.basee.libre')}</option>
          {baseOptions.map((w) => (
            <option key={w.nameEn} value={w.nameEn}>
              {en ? w.nameEn : w.nameFr}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="label">{t('arme.degats')}</span>
        <input
          className={`input ${diceInvalid ? 'border-orange-400' : ''}`}
          value={draft.damageDice}
          onChange={(e) => onChange({ ...draft, damageDice: e.target.value })}
          placeholder="2d6+FOR+2"
          aria-label={t('arme.degats.aria')}
          aria-invalid={diceInvalid || undefined}
          aria-describedby={diceInvalid ? 'arme-degats-erreur' : undefined}
        />
        <span className="block text-xs text-ink-400 mt-1">{t('arme.degats.aide')}</span>
        {diceInvalid && (
          <span id="arme-degats-erreur" className="block text-xs text-orange-700 mt-1">
            {t('arme.degats.invalide')}
          </span>
        )}
      </label>

      <label className="block">
        <span className="label">{t('arme.type.degats')}</span>
        <select
          className="input"
          value={draft.damageType}
          onChange={(e) => onChange({ ...draft, damageType: e.target.value })}
        >
          <option value="">—</option>
          {Object.keys(DAMAGE_TYPE_LABELS_FR).map((key) => (
            <option key={key} value={key}>
              {damageType(DAMAGE_TYPE_LABELS_FR[key])}
            </option>
          ))}
        </select>
      </label>

      <MagicBonusField
        value={draft.magicBonus}
        onChange={(magicBonus) => onChange({ ...draft, magicBonus })}
        label={t('arme.bonus.magique')}
        noneLabel={t('arme.aucun')}
      />

      <div>
        <span className="label">{t('arme.proprietes')}</span>
        <div className="flex flex-wrap gap-2">
          {Object.keys(WEAPON_PROPERTY_LABELS_FR).map((key) => {
            const checked = draft.properties.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleProperty(key)}
                aria-pressed={checked}
                className={`min-h-11 px-3 rounded-full border text-xs font-medium transition-colors ${
                  checked
                    ? 'bg-blood-50 border-blood-300 text-blood-700 font-semibold'
                    : 'bg-parchment-100 border-parchment-300 text-ink-500 hover:bg-parchment-200'
                }`}
              >
                {weaponPropertyLabel(key)}
              </button>
            );
          })}
        </div>
      </div>

      {versatile && (
        <label className="block">
          <span className="label">{t('arme.des.deux.mains')}</span>
          <input
            className={`input ${twoHandedInvalid ? 'border-orange-400' : ''}`}
            value={draft.twoHandedDice}
            onChange={(e) => onChange({ ...draft, twoHandedDice: e.target.value })}
            placeholder="1d10+FOR"
            aria-label={t('arme.des.deux.mains')}
            aria-invalid={twoHandedInvalid || undefined}
            aria-describedby={twoHandedInvalid ? 'arme-deux-mains-erreur' : undefined}
          />
          {twoHandedInvalid && (
            <span id="arme-deux-mains-erreur" className="block text-xs text-orange-700 mt-1">
              {t('arme.degats.invalide')}
            </span>
          )}
        </label>
      )}

      <div className="pt-1">
        <span className="label">{t('arme.apercu')}</span>
        {mainLine ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="orange" title={draft.damageDice}>
              <Glyph name="combat" /> {mainLine}
              {typeLabel ? ` · ${typeLabel}` : ''}
            </Chip>
            {twoHandedLine && (
              <Chip tone="orange" soft title={t('rangee.degats.a.deux.mains')}>
                {twoHandedLine} {t('rangee.deux.mains')}
              </Chip>
            )}
            {draft.magicBonus > 0 && (
              <Chip tone="gold" className="font-semibold">
                <Glyph name="spark" /> +{draft.magicBonus}
              </Chip>
            )}
          </div>
        ) : (
          <p className="text-xs text-ink-400">{t('arme.apercu.vide')}</p>
        )}
      </div>
    </div>
  );
}
