import type { Item, ItemCategory, Rarity } from '@table-sync/shared';
import { CATEGORY_LABELS_FR } from '@table-sync/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CategoryBadge,
  CostBadge,
  EmptyState,
  LoadingSpinner,
  RarityBadge,
  WeightBadge,
} from '../../components/ui';
import { categoryLabel, rarityLabel } from '../../i18n/labels';

// ---------- Filter option sets ----------

// ---------- Catalog search component ----------

interface CatalogSearchProps {
  search: string;
  setSearch: (s: string) => void;
  category: '' | ItemCategory;
  setCategory: (c: '' | ItemCategory) => void;
  rarity: '' | Rarity;
  setRarity: (r: '' | Rarity) => void;
  items: Item[];
  total: number;
  loading: boolean;
  addingItemId: number | null;
  offset: number;
  /** When true (viewer mode), hide the add buttons — catalog is browse-only. */
  readOnly?: boolean;
  /** Players may create the missing item inline (party setting, GM-gated). */
  canCreateItem?: boolean;
  onCreateItem?: (name: string) => void;
  onAdd: (item: Item) => void;
  onLoadMore: () => void;
}

export function CatalogSearch({
  search,
  setSearch,
  category,
  setCategory,
  rarity,
  setRarity,
  items,
  total,
  loading,
  addingItemId,
  offset,
  readOnly = false,
  canCreateItem = false,
  onCreateItem,
  onAdd,
  onLoadMore,
}: CatalogSearchProps) {
  const { t } = useTranslation();

  // Options localisées au rendu (et non à l'import) : elles suivent le
  // changement de langue du sélecteur sans rechargement.
  const categoryOptions = useMemo(
    () => [
      { value: '' as const, label: t('recherche.toutes.categories') },
      ...(Object.keys(CATEGORY_LABELS_FR) as ItemCategory[])
        .filter((c) => c !== 'custom')
        .map((c) => ({ value: c, label: categoryLabel(c) })),
    ],
    [t],
  );
  const rarityOptions = useMemo(
    () => [
      { value: '' as const, label: t('recherche.toutes.raretes') },
      ...(['common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact'] as Rarity[]).map(
        (r) => ({
          value: r,
          label: rarityLabel(r),
        }),
      ),
    ],
    [t],
  );
  const wanted = search.trim();
  const createCta = canCreateItem && wanted !== '' && !readOnly && onCreateItem && (
    <button
      type="button"
      onClick={() => onCreateItem(wanted)}
      className="btn-secondary w-full text-sm"
    >
      {t('recherche.creer', { name: wanted })}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="card p-3 space-y-3">
        <input
          type="search"
          className="input"
          placeholder={t('recherche.rechercher.un.objet')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('recherche.rechercher.dans.le.catalogue')}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as '' | ItemCategory)}
            aria-label={t('recherche.filtrer.par.categorie')}
          >
            {categoryOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={rarity}
            onChange={(e) => setRarity(e.target.value as '' | Rarity)}
            aria-label={t('recherche.filtrer.par.rarete')}
          >
            {rarityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <div className="card p-4 space-y-3">
          {wanted || category || rarity ? (
            <>
              <EmptyState
                icon="🔍"
                title={t('recherche.aucun.objet.trouve')}
                hint={
                  wanted && canCreateItem
                    ? t('recherche.n.existe.pas.encore', { name: wanted })
                    : t('recherche.modifiez.votre.recherche.ou.vos.filtres')
                }
              />
              {wanted && createCta}
            </>
          ) : (
            <EmptyState
              icon="📝"
              title={t('recherche.recherchez.un.objet')}
              hint={t('recherche.tapez.le.nom.d.un.objet')}
            />
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-ink-400 px-1">
            {t('recherche.total.objets', { total: total })}
          </p>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="card p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{item.name}</span>
                    {item.rarity !== 'none' && <RarityBadge rarity={item.rarity} />}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-ink-500">
                    <WeightBadge weightKg={item.weightKg} />
                    <CostBadge qty={item.costQty} unit={item.costUnit} />
                    <CategoryBadge category={item.category} />
                  </div>
                  {item.aliases && item.aliases.length > 0 && (
                    <p className="text-[11px] text-ink-400 mt-0.5">
                      {t('recherche.aussi', { aliases: item.aliases.join(', ') })}
                    </p>
                  )}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onAdd(item)}
                    disabled={addingItemId === item.id}
                    className="btn-primary text-sm px-3 py-2 shrink-0"
                    aria-label={t('recherche.ajouter.item.name.item.name', {
                      item_name: item.name,
                    })}
                  >
                    {addingItemId === item.id ? '…' : t('inv.ajouter')}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {loading && <LoadingSpinner label={t('recherche.recherche')} />}

          {/* The exact item may still be missing among the hits — creation
              stays one tap away even with results on screen. */}
          {createCta}

          {offset + items.length < total && !loading && (
            <button type="button" onClick={onLoadMore} className="btn-secondary w-full">
              {t('recherche.charger.plus', { n: total - offset - items.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
