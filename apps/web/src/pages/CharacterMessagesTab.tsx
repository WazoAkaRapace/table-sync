/**
 * Onglet « Messages » de la fiche — la correspondance secrète de CE
 * personnage avec le MD (le fil est lié au personnage, pas au compte).
 */

import type { Character } from '@table-sync/shared';
import MessageThread from '../components/MessageThread';

interface Props {
  character: Character;
  charId: number;
  onError: (msg: string) => void;
}

export default function CharacterMessagesTab({ character, charId, onError }: Props) {
  return (
    // Mesure de lecture : le fil est de la prose — sur desktop la carte se
    // resserre (≈ le volet MD de la boîte) au lieu d'étirer ses lignes.
    <div className="mx-auto max-w-2xl">
      <MessageThread charId={charId} characterName={character.name} onError={onError} />
    </div>
  );
}
