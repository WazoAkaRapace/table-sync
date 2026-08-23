import type { Character, InventoryEntry, StorageLocation } from '@dnd-inventory/shared';
import {
  computeWeaponStats,
  formatModifier,
  isProficientWithArmor,
  proficiencyBonus,
  resolveMagicArmorBase,
  WEAPON_PROPERTY_LABELS_FR,
} from '@dnd-inventory/shared';
import { useEffect, useState } from 'react';
import { ItemVignette } from '../../components/ItemImageViewer';
import { Chip, RarityBadge, WeightBadge } from '../../components/ui';
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
  const itemName = item.nameFr || item.name;

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
            <span className="text-sm font-medium text-red-700">Retirer {itemName} ?</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                className="btn-ghost text-ink-700 text-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="btn-primary text-sm bg-red-600 hover:bg-red-700"
              >
                Retirer
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
                  aria-label={`${entry.equipped ? 'Déséquiper' : 'Équiper'} ${itemName}`}
                  aria-pressed={entry.equipped}
                  title={entry.equipped ? 'Équipé' : 'Non équipé'}
                >
                  {entry.equipped ? '★' : '☆'}
                </button>
              ) : (
                <span
                  className={`shrink-0 mt-0.5 text-lg leading-none ${entry.equipped ? 'text-gold-600' : 'text-ink-400/40'}`}
                  title={entry.equipped ? 'Équipé' : 'Non équipé'}
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
                aria-label={`${itemName}, ${quantity} exemplaire${quantity > 1 ? 's' : ''}${
                  item.hasImage ? ', illustré' : ''
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{itemName}</span>
                  {item.rarity !== 'none' && <RarityBadge rarity={item.rarity} />}
                  {item.hasImage && (
                    <span
                      aria-hidden="true"
                      title="Illustration — touche la ligne pour la voir"
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
                    aria-label={`Diminuer ${itemName}`}
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
                    aria-label={`Quantité de ${itemName}`}
                  />
                  <button
                    type="button"
                    onClick={() => onStep(1)}
                    disabled={busy}
                    className="w-8 h-8 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-50 text-sm font-medium flex items-center justify-center transition-colors"
                    aria-label={`Augmenter ${itemName}`}
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
                    aria-label={`Transférer ${itemName}`}
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
                    aria-label={`Diminuer ${itemName}`}
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
                    aria-label={`Quantité de ${itemName}`}
                  />
                  <button
                    type="button"
                    onClick={() => onStep(1)}
                    disabled={busy}
                    className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-50 text-sm font-medium flex items-center justify-center transition-colors"
                    aria-label={`Augmenter ${itemName}`}
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
                  aria-label={`Transférer ${itemName}`}
                >
                  ↗ Transférer
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
                        Aussi connu sous : {item.aliases.join(', ')}
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
                        editableEntryId={canEdit ? entry.id : undefined}
                      />
                    )}
                    {/* Computed attack & damage from character stats (weapons) */}
                    {item.category === 'weapon' &&
                      (() => {
                        const stats = computeWeaponStats(item, character);
                        if (!stats) return null;
                        const abilityLabel = stats.ability === 'dexterity' ? 'DEX' : 'FOR';
                        const archery =
                          character.fightingStyle === 'archery' && stats.ranged ? 2 : 0;
                        const profBonus = proficiencyBonus(character.level ?? 1);
                        const breakdown =
                          `d20 ${formatModifier(stats.attackBonus - (stats.proficient ? profBonus : 0) - stats.magicBonus - archery)} (${abilityLabel})` +
                          (stats.proficient ? ` + ${profBonus} (maîtrise)` : '') +
                          (archery > 0 ? ` + ${archery} (archerie)` : '') +
                          (stats.magicBonus > 0 ? ` + ${stats.magicBonus} (magique)` : '');
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip
                              tone={stats.proficient ? 'red' : 'amber'}
                              title={
                                stats.proficient
                                  ? `Attaque : ${breakdown}`
                                  : `Attaque : ${breakdown} — non qualifié avec cette arme (pas de bonus de maîtrise)`
                              }
                            >
                              🎯 {formatModifier(stats.attackBonus)}
                              {!stats.proficient && ' ⚠'}
                            </Chip>
                            {stats.damageStr && (
                              <Chip
                                tone="orange"
                                title={`Dégâts : ${stats.damageStr} (${abilityLabel})${stats.magicBonus > 0 ? ` + ${stats.magicBonus} magique` : ''}`}
                              >
                                ⚔ {stats.damageStr}
                                {stats.damageTypeFr ? ` ${stats.damageTypeFr}` : ''}
                              </Chip>
                            )}
                            {stats.versatileDamageStr && (
                              <Chip tone="orange" soft title="Dégâts à deux mains">
                                {stats.versatileDamageStr} · deux mains
                              </Chip>
                            )}
                            {stats.magicBonus > 0 && (
                              <Chip tone="gold" className="font-semibold">
                                ✨ +{stats.magicBonus}
                              </Chip>
                            )}
                            {stats.presumedBase && (
                              <span className="text-[10px] text-ink-400 italic">base présumée</span>
                            )}
                          </div>
                        );
                      })()}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                      {item.category === 'armor' &&
                        entry.equipped &&
                        !isProficientWithArmor(item, character) && (
                          <span className="font-semibold text-amber-600">
                            ⚠ armure non maîtrisée
                          </span>
                        )}
                      {item.acBase !== null && <span>🛡 CA : {item.acBase}</span>}
                      {item.acBase === null &&
                        item.category === 'armor' &&
                        (() => {
                          const magic = resolveMagicArmorBase(item);
                          if (magic.shield) return <span>🛡 Bouclier (+2 à la CA)</span>;
                          if (!magic.base) return null;
                          return (
                            <span>
                              🛡 CA : {magic.base.acBase}
                              {magic.magicBonus > 0 && ` +${magic.magicBonus}`} · base{' '}
                              {magic.base.nameFr}
                            </span>
                          );
                        })()}
                      {item.strMin !== null && <span>💪 FOR min. : {item.strMin}</span>}
                      {item.stealthDisadvantage && <span>🤫 Désavantage Discrétion</span>}
                      {item.properties &&
                        item.properties.filter((p) => p !== 'monk').length > 0 && (
                          <span>
                            Propriétés :{' '}
                            {item.properties
                              .filter((p) => p !== 'monk')
                              .map((p) => WEAPON_PROPERTY_LABELS_FR[p] ?? p)
                              .join(', ')}
                          </span>
                        )}
                    </div>
                    {entry.notes && (
                      <p className="text-xs text-ink-500 italic">Note : {entry.notes}</p>
                    )}
                    {/* Move to another storage location */}
                    {canMove && canEdit && (
                      <label className="flex items-center gap-2 pt-1 text-sm text-ink-600">
                        <span className="shrink-0">Déplacer vers :</span>
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
                          aria-label={`Déplacer ${itemName} vers un autre emplacement`}
                        >
                          <option value="" disabled>
                            — Choisir —
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
                          aria-label={`Retirer ${itemName}`}
                        >
                          Retirer du sac
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
