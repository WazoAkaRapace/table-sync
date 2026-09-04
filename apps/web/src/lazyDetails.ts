/**
 * Prose paresseuse — les listes de l'API servent description/higherLevel à
 * null (mode résumé, régime connectivité : la fiche entière re-descend après
 * chaque mutation, la prose des 646 objets / 490 sorts en était le gros du
 * fil). Ce module charge le détail UNE fois par id et le garde pour la
 * session — données SRD immuables, les customs changent rarement.
 */
import type { Item, Spell } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import api from './api';

const itemCache = new Map<number, Item>();
const itemPending = new Map<number, Promise<Item | null>>();

export function fetchItemDetail(itemId: number): Promise<Item | null> {
  const cached = itemCache.get(itemId);
  if (cached) return Promise.resolve(cached);
  let p = itemPending.get(itemId);
  if (!p) {
    p = api
      .get<{ item: Item }>(`/api/items/${itemId}`)
      .then((res) => {
        itemCache.set(itemId, res.data.item);
        itemPending.delete(itemId);
        return res.data.item;
      })
      .catch(() => {
        itemPending.delete(itemId);
        return null;
      });
    itemPending.set(itemId, p);
  }
  return p;
}

/**
 * Description d'un objet embarqué : celle de la ligne si servie, sinon
 * chargement paresseux (activé — typiquement la ligne est dépliée).
 */
export function useItemDescription(
  item: Pick<Item, 'id' | 'description' | 'hasDescription'>,
  enabled: boolean,
): string | null {
  const [lazy, setLazy] = useState<string | null>(null);
  useEffect(() => {
    setLazy(null);
    if (!enabled || item.description != null || item.hasDescription !== true) return;
    let alive = true;
    fetchItemDetail(item.id).then((full) => {
      if (alive) setLazy(full?.description ?? null);
    });
    return () => {
      alive = false;
    };
  }, [item.id, item.description, item.hasDescription, enabled]);
  return item.description ?? lazy;
}

const spellCache = new Map<number, Spell>();
const spellPending = new Map<number, Promise<Spell | null>>();

export function fetchSpellDetail(spellId: number): Promise<Spell | null> {
  const cached = spellCache.get(spellId);
  if (cached) return Promise.resolve(cached);
  let p = spellPending.get(spellId);
  if (!p) {
    p = api
      .get<{ spell: Spell }>(`/api/spells/${spellId}`)
      .then((res) => {
        spellCache.set(spellId, res.data.spell);
        spellPending.delete(spellId);
        return res.data.spell;
      })
      .catch(() => {
        spellPending.delete(spellId);
        return null;
      });
    spellPending.set(spellId, p);
  }
  return p;
}
