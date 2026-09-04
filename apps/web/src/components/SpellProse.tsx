import type { Spell } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSpellDetail } from '../lazyDetails';

/**
 * Prose d'un sort (description + aux niveaux supérieurs) pour une ligne
 * DÉPLIÉE : les listes servent description:null (mode résumé API) — le détail
 * se charge une fois par sort et reste en cache pour la session.
 */
export function SpellProse({ spell }: { spell: Spell }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<Spell | null>(null);
  useEffect(() => {
    setDetail(null);
    if (spell.description != null) return;
    let alive = true;
    fetchSpellDetail(spell.id).then((full) => {
      if (alive) setDetail(full);
    });
    return () => {
      alive = false;
    };
  }, [spell.id, spell.description]);
  const description = spell.description ?? detail?.description ?? null;
  const higherLevel = spell.higherLevel ?? detail?.higherLevel ?? null;
  if (description == null && higherLevel == null) return null;
  return (
    <>
      {description != null && <p>{description}</p>}
      {higherLevel && (
        <p className="text-ink-400 italic">
          <strong>{t('sorts.aux.niveaux.superieurs')}</strong> {higherLevel}
        </p>
      )}
    </>
  );
}
