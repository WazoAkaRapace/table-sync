import type { Character, InventoryEntry, StorageLocation } from '@table-sync/shared';
import {
  computeWeaponStats,
  formatModifier,
  isProficientWithArmor,
  proficiencyBonus,
  resolveMagicArmorBase,
} from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ItemVignette } from '../../components/ItemImageViewer';
import { Chip, RarityBadge, WeightBadge } from '../../components/ui';
import { abilityShort, weaponPropertyLabel } from '../../i18n/labels';
import { LOCATION_TYPE_ICON } from './types';

// ---------- Inventory row ----------

interface InventoryRowProps {
  entry: InventoryEntry;
  character: Character;
  busy: boolean;
  expanded: boolean;
  flashed: boolean;
  confirmingDelete: boolean;
  locations: StorageLocation[];
  activeLocationId: number | null;
  canEdit: boolean;
  onToggleExpand: () => void;
  onStep: (delta: number) => void;
  onSetQuantity: (n: number) => void;
  onToggleEquipped: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onTransfer: () => void;
  onMoveLocation: (locationId: number) => void;
}

export function InventoryRow({
  entry,
  character,
  busy,
  expanded,
  flashed,
  confirmingDelete,
  locations,
  activeLocationId,
  canEdit,
  onToggleExpand,
  onStep,
  onSetQuantity,
  onToggleEquipped,
  onConfirmDelete,
  onCancelDelete,
  onTransfer,
  onMoveLocation,
}: InventoryRowProps) {
  const { t } = useTranslation();
  const { item, quantity } = entry;
  // Empty waterskins weigh only the leather (~0.268 kg), not the full 2.268 kg.
  // The backend applies this override to the encumbrance total; mirror it here so
  // the per-row display stays consistent with the aggregate.
  const EMPTY_WATERSKIN_KG = 0.268;
  const isEmptyWater = !!(entry.notes?.includes('empty') && item.survivalTags?.includes('water'));
  const effectiveWeightKg = isEmptyWater ? EMPTY_WATERSKIN_KG : item.weightKg;
  const totalWeight = effectiveWeightKg !== null ? effectiveWeightKg * quantity : null;
  const hasDetails =
    !!item.description ||
    item.damageDice ||
    item.acBase !== null ||
    item.strMin !== null ||
    item.stealthDisadvantage ||
    (item.properties && item.properties.length > 0) ||
    !!entry.notes ||
    item.hasImage; // un objet réduit à son image (carte sans texte) reste dépliable
  const itemName = item.name;

  // Locations available to move this item to (everything except the active one)
  const otherLocations = locations.filter((l) => l.id !== activeLocationId);
  const canMove = otherLocations.length > 0;
  // Row is expandable if it has details OR if there's a move action to reveal
  const canExpand = hasDetails || (canMove && canEdit);

  const [draftQty, setDraftQty] = useState<string>(String(quantity));
  useEffect(() => {
    setDraftQty(String(quantity));
  }, [quantity]);

  const commitDraft = () => {
    const parsed = Number(draftQty);
    if (!Number.isFinite(parsed)) {
      setDraftQty(String(quantity));
      return;
    }
    const next = Math.floor(parsed);
    if (next !== quantity) onSetQuantity(next);
    else setDraftQty(String(quantity));
  };

  return (
    <li
      className={`card overflow-hidden ${flashed ? 'row-flash' : ''} ${
        entry.equipped ? 'ring-1 ring-gold-400/40' : ''
      } ${confirmingDelete ? 'ring-2 ring-red-500 pulse-warn' : ''}`}
    >
      <div className="p-3 sm:p-4">
        {/* Confirm-delete state */}
        {confirmingDelete ? (
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm font-medium text-red-700">
              {t('rangee.retirer.itemname.confirm', { itemName: itemName })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                className="btn-ghost text-ink-700 text-sm"
              >
                {t('rangee.annuler')}
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="btn-primary text-sm bg-red-600 hover:bg-red-700"
              >
                {t('rangee.retirer')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Row 1: star toggle + item name (full width on mobile) */}
            <div className="flex items-start gap-2 sm:gap-3">
              {/* Equipped toggle — star icon */}
              {canEdit ? (
                <button
                  type="button"
                  onClick={onToggleEquipped}
                  disabled={busy}
                  className={`shrink-0 mt-0.5 text-lg leading-none transition-colors ${
                    entry.equipped ? 'text-gold-600' : 'text-ink-400/40 hover:text-ink-400'
                  }`}
                  aria-label={t('rangee.equip.desequip.itemname', {
                    entry_equipped: entry.equipped ? t('rangee.desequiper') : t('rangee.equiper'),
                    itemName: itemName,
                  })}
                  aria-pressed={entry.equipped}
                  title={entry.equipped ? t('rangee.equipe') : t('rangee.non.equipe')}
                >
                  {entry.equipped ? '★' : '☆'}
                </button>
              ) : (
                <span
                  className={`shrink-0 mt-0.5 text-lg leading-none ${entry.equipped ? 'text-gold-600' : 'text-ink-400/40'}`}
                  title={entry.equipped ? t('rangee.equipe') : t('rangee.non.equipe')}
                >
                  {entry.equipped ? '★' : '☆'}
                </span>
              )}

              {/* Main content — click to expand details */}
              <button
                type="button"
                onClick={canExpand ? onToggleExpand : undefined}
                className="min-w-0 flex-1 text-left"
                aria-expanded={expanded}
                aria-label={t('rangee.itemname.quantity.exemplaire.quantity.1.s', {
                  itemName: itemName,
                  quantity: quantity,
                  s: quantity > 1 ? t('commun.pluriel.s') : '',
                  illus: item.hasImage ? `, ${t('rangee.illustre')}` : '',
                })}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{itemName}</span>
                  {item.rarity !== 'none' && <RarityBadge rarity={item.rarity} />}
                  {item.hasImage && (
                    <span
                      aria-hidden="true"
                      title={t('rangee.illustration.touche.la.ligne.pour.la')}
                      className="ml-0.5 text-sm text-ink-400"
                    >
                      🗺
                    </span>
                  )}
                  {canExpand && (
                    <span
                      className={`text-ink-400 text-xs chevron ${expanded ? 'is-open' : 'is-closed'}`}
                    >
                      ▼
                    </span>
                  )}
                </div>
              </button>

              {/* On desktop, stepper stays inline on the right */}
              {canEdit ? (
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onStep(-1)}
                    disabled={busy}
                    className="w-8 h-8 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-50 text-sm font-medium flex items-center justify-center transition-colors"
                    aria-label={t('rangee.diminuer.itemname', { itemName: itemName })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    className="w-10 h-8 text-center text-sm bg-white border border-parchment-300 rounded-md focus:outline-none focus:border-blood-500"
                    value={draftQty}
                    disabled={busy}
                    onChange={(e) => setDraftQty(e.target.value)}
                    onBlur={commitDraft}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    aria-label={t('rangee.quantite.de.itemname', { itemName: itemName })}
                  />
                  <button
                    type="button"
                    onClick={() => onStep(1)}
                    disabled={busy}
                    className="w-8 h-8 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-50 text-sm font-medium flex items-center justify-center transition-colors"
                    aria-label={t('rangee.augmenter.itemname', { itemName: itemName })}
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="hidden sm:inline text-sm text-ink-500 shrink-0">× {quantity}</span>
              )}
            </div>

            {/* Row 2 (mobile only): weight info + transfer + stepper side by side */}
            <div className="flex items-center justify-between gap-2 mt-1.5 sm:hidden pl-7">
              <div className="flex items-center gap-2 text-xs text-ink-500 min-w-0">
                <WeightBadge weightKg={effectiveWeightKg} />
                {totalWeight !== null && quantity > 1 && (
                  <span className="text-ink-400">
                    × {quantity} = {totalWeight.toFixed(1)} kg
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={onTransfer}
                    disabled={busy}
                    className="text-ink-400 hover:text-blood-600 text-xs underline"
                    aria-label={t('rangee.transferer.itemname', { itemName: itemName })}
                  >
                    ↗
                  </button>
                )}
              </div>
              {canEdit ? (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onStep(-1)}
                    disabled={busy}
                    className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-50 text-sm font-medium flex items-center justify-center transition-colors"
                    aria-label={t('rangee.diminuer.itemname', { itemName: itemName })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    className="w-8 h-7 text-center text-sm bg-white border border-parchment-300 rounded-md focus:outline-none focus:border-blood-500"
                    value={draftQty}
                    disabled={busy}
                    onChange={(e) => setDraftQty(e.target.value)}
                    onBlur={commitDraft}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    aria-label={t('rangee.quantite.de.itemname', { itemName: itemName })}
                  />
                  <button
                    type="button"
                    onClick={() => onStep(1)}
                    disabled={busy}
                    className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-50 text-sm font-medium flex items-center justify-center transition-colors"
                    aria-label={t('rangee.augmenter.itemname', { itemName: itemName })}
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="text-sm text-ink-500 shrink-0">× {quantity}</span>
              )}
            </div>

            {/* Desktop: weight info + transfer stays under the name */}
            <div className="hidden sm:flex items-center gap-3 mt-1 ml-7 text-xs text-ink-500">
              <WeightBadge weightKg={effectiveWeightKg} />
              {totalWeight !== null && quantity > 1 && (
                <span className="text-ink-400">
                  × {quantity} = {totalWeight.toFixed(1)} kg
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={onTransfer}
                  disabled={busy}
                  className="text-ink-400 hover:text-blood-600 underline"
                  aria-label={t('rangee.transferer.itemname', { itemName: itemName })}
                >
                  {t('rangee.transferer')}
                </button>
              )}
            </div>

            {/* Expanded: details + secondary actions (progressive disclosure) */}
            {canExpand && (
              <div className={`expand-grid mt-3 ${expanded ? '' : 'is-collapsed'}`}>
                <div className="expand-inner">
                  <div className="border-t border-parchment-200 pt-3 space-y-2">
                    {item.description && (
                      <p className="text-sm text-ink-700 whitespace-pre-line">{item.description}</p>
                    )}
                    {item.aliases && item.aliases.length > 0 && (
                      <p className="text-xs text-ink-400">
                        {t('rangee.aussi.connu.sous', { aliases: item.aliases.join(', ') })}
                      </p>
                    )}
                    {/* Illustration en châssis — montée à l'ouverture seulement
                        (zéro requête tant que la ligne est repliée) ; la
                        description est la légende, l'image est la pièce.
                        Ligne éditable → la visionneuse gagne les outils
                        d'annotation (dessin/notes sur l'exemplaire). */}
                    {expanded && item.hasImage && (
                      <ItemVignette
                        itemId={item.id}
                        name={itemName}
                        imageRev={item.imageRev}
                        editableEntryId={canEdit ? entry.id : undefined}
                      />
                    )}
                    {/* Computed attack & damage from character stats (weapons) */}
                    {item.category === 'weapon' &&
                      (() => {
                        const stats = computeWeaponStats(item, character);
                        if (!stats) return null;
                        const abilityLabel = abilityShort(stats.ability);
                        const archery =
                          character.fightingStyle === 'archery' && stats.ranged ? 2 : 0;
                        const profBonus = proficiencyBonus(character.level ?? 1);
                        const breakdown =
                          `d20 ${formatModifier(stats.attackBonus - (stats.proficient ? profBonus : 0) - stats.magicBonus - archery)} (${abilityLabel})` +
                          (stats.proficient ? ` + ${profBonus} (${t('rangee.maitrise')})` : '') +
                          (archery > 0 ? ` + ${archery} (${t('rangee.archerie')})` : '') +
                          (stats.magicBonus > 0
                            ? ` + ${stats.magicBonus} (${t('rangee.magique')})`
                            : '');
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip
                              tone={stats.proficient ? 'red' : 'amber'}
                              title={
                                stats.proficient
                                  ? t('survie.attaque.breakdown', { breakdown: breakdown })
                                  : t('rangee.attaque.non.qualifie', { breakdown: breakdown })
                              }
                            >
                              🎯 {formatModifier(stats.attackBonus)}
                              {!stats.proficient && ' ⚠'}
                            </Chip>
                            {stats.damageStr && (
                              <Chip
                                tone="orange"
                                title={`${t('rangee.degats', {
                                  damageStr: stats.damageStr,
                                  abilityLabel: abilityLabel,
                                })}${
                                  stats.magicBonus > 0
                                    ? t('rangee.degats.magique', { magicBonus: stats.magicBonus })
                                    : ''
                                }`}
                              >
                                ⚔ {stats.damageStr}
                                {stats.damageTypeFr ? ` ${stats.damageTypeFr}` : ''}
                              </Chip>
                            )}
                            {stats.versatileDamageStr && (
                              <Chip tone="orange" soft title={t('rangee.degats.a.deux.mains')}>
                                {stats.versatileDamageStr} {t('rangee.deux.mains')}
                              </Chip>
                            )}
                            {stats.magicBonus > 0 && (
                              <Chip tone="gold" className="font-semibold">
                                ✨ +{stats.magicBonus}
                              </Chip>
                            )}
                            {stats.presumedBase && (
                              <span className="text-[10px] text-ink-400 italic">
                                {t('rangee.base.presumee')}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                      {item.category === 'armor' &&
                        entry.equipped &&
                        !isProficientWithArmor(item, character) && (
                          <span className="font-semibold text-amber-600">
                            {t('rangee.armure.non.maitrisee')}
                          </span>
                        )}
                      {item.acBase !== null && <span>{t('rangee.ca', { ac: item.acBase })}</span>}
                      {item.acBase === null &&
                        item.category === 'armor' &&
                        (() => {
                          const magic = resolveMagicArmorBase(item);
                          if (magic.shield) return <span>{t('rangee.bouclier.2.a.la.ca')}</span>;
                          if (!magic.base) return null;
                          return (
                            <span>
                              {t('rangee.ca.base', {
                                ac: magic.base.acBase,
                                bonus: magic.magicBonus > 0 ? ` +${magic.magicBonus}` : '',
                                name: magic.base.nameFr,
                              })}
                            </span>
                          );
                        })()}
                      {item.strMin !== null && (
                        <span>{t('rangee.for.min', { min: item.strMin })}</span>
                      )}
                      {item.stealthDisadvantage && (
                        <span>{t('rangee.desavantage.discretion')}</span>
                      )}
                      {item.properties &&
                        item.properties.filter((p) => p !== 'monk').length > 0 && (
                          <span>
                            {t('rangee.proprietes', {
                              properties: item.properties
                                .filter((p) => p !== 'monk')
                                .map((p) => weaponPropertyLabel(p) ?? p)
                                .join(', '),
                            })}
                          </span>
                        )}
                    </div>
                    {entry.notes && (
                      <p className="text-xs text-ink-500 italic">
                        {t('rangee.note', { note: entry.notes })}
                      </p>
                    )}
                    {/* Move to another storage location */}
                    {canMove && canEdit && (
                      <label className="flex items-center gap-2 pt-1 text-sm text-ink-600">
                        <span className="shrink-0">{t('rangee.deplacer.vers')}</span>
                        <select
                          className="input py-1 text-sm flex-1 min-w-0"
                          value=""
                          disabled={busy}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== '') onMoveLocation(Number(val));
                            // Reset so the same target can be re-selected later
                            e.target.value = '';
                          }}
                          aria-label={t('rangee.deplacer.itemname.vers.un.autre.emplacement', {
                            itemName: itemName,
                          })}
                        >
                          <option value="" disabled>
                            {t('rangee.choisir')}
                          </option>
                          {otherLocations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {LOCATION_TYPE_ICON[l.type]} {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {/* Secondary action: remove (destructive, stays in expanded panel) */}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onStep(-1)}
                          disabled={busy}
                          className="btn-ghost text-sm text-red-600 hover:bg-red-50"
                          aria-label={t('rangee.retirer.itemname', { itemName: itemName })}
                        >
                          {t('rangee.retirer.du.sac')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}
