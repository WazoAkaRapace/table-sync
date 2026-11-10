// déplacement pur depuis ItemImageViewer.tsx (ratchet R1)

export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const VIEW_1X: View = { scale: 1, x: 0, y: 0 };
