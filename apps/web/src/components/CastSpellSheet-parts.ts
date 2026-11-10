// déplacement pur depuis CastSpellSheet.tsx (ratchet R1)
import type { CharacterClassSource, Spell } from '@table-sync/shared';
import type { TargetableMember } from '../spellEffects';
import type { CastTarget } from './TargetPickerSheet';

export interface CastSpellSheetProps {
  spell: Spell;
  /** Max slots per level 1-9 (index 0 = level 1) — Incantation pool. */
  slots: number[];
  slotsUsed: number[];
  /** Pact magic pool (Occultiste) — interchangeable with Incantation (SRD). */
  pactSlots?: number[];
  pactUsed?: number[];
  concentrating: boolean;
  /** For the DD / attack preview chips. */
  castingMod?: number;
  profBonus?: number;
  charLevel?: number;
  /** Fiche du lanceur — manifestations occultes : aperçu Décharge occulte
   *  (rayons par niveau de classe, +CHA de Décharge déchirante, portée de
   *  Lance occulte). Passe la fiche ENTIÈRE : classLevelOf lit les lignes
   *  de classe (multiclassage), pas le seul niveau total. */
  character?: CharacterClassSource & {
    charisma?: number | null;
    level?: number | null;
    name?: string | null;
    portraitUrl?: string | null;
  };
  /** Ids de manifestations connues (invocationIdsOf sur les traits chargés). */
  invocationIds?: string[];
  /** Effets de sort CA actifs (bandeau) — l'annonce part de la CA effective
   *  ACTUELLE, effets déjà posés inclus. */
  activeAcEffects?: Array<{ effectKind: string; acValue: number }>;
  /** CA effective actuelle (override manuel inclus) — base de l'annonce. */
  currentEffectiveAc?: number;
  /** Modificateur de DEX — formules « 13 + DEX » (Armure de mage). */
  dexMod?: number;
  /** Lancers gratuits 1/RL des manifestations free-cast et Arcanum : clé =
   * slug du sort, valeur = { featureId, counterCurrent, label }. */
  freeCasts?: Record<string, { featureId: number; counterCurrent: number; label: string }>;
  /** Autres membres du groupe non cachés, avec CA effective et DEX — picker
   *  de cible (v2 ciblage) pour les 5 sorts ciblables. Bouclier EXCLU
   *  (réaction self, pas de picker). */
  targets?: TargetableMember[];
  onClose: () => void;
  /** Called with the chosen slot level (0 = cantrip, no slot), whether it's
   *  a ritual cast (no slot either) and WHICH pool the slot comes from —
   *  SRD magie de pacte : les deux pools sont interchangeables, LE JOUEUR
   *  choisit (un emplacement de pacte lance le sort au niveau de SON dé).
   *  'free' : lancer sans emplacement (manifestation à volonté / compteur
   *  free-cast / Arcanum) — le parent décrémente le compteur du trait.
   *  target : cible choisie (v2) — self par défaut, fiche du groupe ou
   *  « Autre » à nom libre ; le parent enchaîne PATCH puis POST
   *  spell-effects avec targetCharacterId/targetLabel selon la sélection. */
  onCast: (
    level: number,
    ritual?: boolean,
    pool?: 'spellcasting' | 'pact' | 'free',
    target?: CastTarget,
  ) => Promise<void> | void;
}
