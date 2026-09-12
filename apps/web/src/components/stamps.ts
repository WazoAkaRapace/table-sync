/**
 * Tampons d'annotation — symboles de carte (monstres, terrain, points
 * d'intérêt) posés sur l'illustration depuis la visionneuse. SVG carrés
 * 1080×1080 servis depuis /stamps (public/ → dist → précache du service
 * worker, donc disponibles hors ligne) ; chaque fichier garde la teinte avec
 * laquelle il a été dessiné. Largeur/hauteur intrinsèques explicites : le
 * composite canvas dessine à destination explicite sans dépendre du décodage
 * (piège Safari sur les SVG sans dimensions).
 */

export type StampKey =
  | 'goblin'
  | 'skull'
  | 'zombie'
  | 'human'
  | 'tree'
  | 'heart'
  | 'volcano'
  | 'wave';

export interface StampDef {
  key: StampKey;
  i18n: string;
}

export const STAMPS: StampDef[] = [
  { key: 'goblin', i18n: 'image.tampon.gobelin' },
  { key: 'skull', i18n: 'image.tampon.squelette' },
  { key: 'zombie', i18n: 'image.tampon.zombie' },
  { key: 'human', i18n: 'image.tampon.humain' },
  { key: 'tree', i18n: 'image.tampon.arbre' },
  { key: 'heart', i18n: 'image.tampon.coeur' },
  { key: 'volcano', i18n: 'image.tampon.volcan' },
  { key: 'wave', i18n: 'image.tampon.vague' },
];

export function stampUrl(key: StampKey): string {
  return `/stamps/${key}.svg`;
}
