/**
 * Pilule or « … de la table » (plan « Contenus personnalisés », 2026-11) :
 * marque un contenu inventé par la table (sort, monstre) dans les listes du
 * grimoire/bestiaire et le titre des fiches. Famille or = magie / contenu de
 * la table — jamais une nouvelle famille visuelle, jamais du sang.
 */
import { Glyph } from './Glyph';

/**
 * @param label clé i18n complète du libellé (ex. t('bestiaire.monstre.de.la.table')).
 * Décoratif sur les lignes qui portent déjà le nom en clair : aria-hidden,
 * le libellé complet reste servi en title aux lecteurs d'écran.
 */
export function TableBadge({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden
      title={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-gold-300 bg-gold-100 px-2 py-0.5 text-[11px] font-semibold text-gold-700 ${className}`}
    >
      <Glyph name="spark" />
      {label}
    </span>
  );
}
