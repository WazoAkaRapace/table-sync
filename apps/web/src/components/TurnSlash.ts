/**
 * « À toi de jouer » — l'étendard + le battement.
 *
 * useTurnSlash(isMyTurn) tire UNE fois par transition vers ton tour (basculer
 * ou replier l'UI ne le rejoue pas) l'unique effet hors CSS : le signal
 * haptique, calé sur la chorégraphie ([70, 100, 160] — pulsation, silence,
 * bourdon : un battement de cœur). Toute la vue vit dans index.css
 * (`.combat-turn-banner`, `.combat-turn-stamp`, `.combat-turn-beat`) : la
 * carte étendard se déroule en montant au-dessus du dock, le titre se
 * tamponne, puis le corps bat en rythme cardiaque — synchrone de son halo
 * (même chronologie de keyframes, même délai).
 */
import { useEffect, useRef } from 'react';

/** Haptic cue for combat transitions. Degrades silently where unsupported
 *  (iOS Safari) or when the user prefers reduced motion. */
export function combatVibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
    return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/** Un battement de cœur à l'instant où le tour devient le tien (détection
 *  partagée par le widget desktop et la fiche mobile). */
export function useTurnSlash(isMyTurn: boolean): void {
  const wasMyTurn = useRef(false);
  useEffect(() => {
    const becameMyTurn = isMyTurn && !wasMyTurn.current;
    wasMyTurn.current = isMyTurn;
    if (!becameMyTurn) return;
    combatVibrate([70, 100, 160]);
  }, [isMyTurn]);
}
