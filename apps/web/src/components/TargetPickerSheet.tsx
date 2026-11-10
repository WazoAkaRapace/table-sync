/**
 * Picker de cible (v2 ciblage) — BottomSheet portaled DEUXIÈME niveau de la
 * feuille d'incantation : « Moi » épinglé en tête (pré-sélectionné), les
 * autres personnages du groupe non cachés (lignes réglées avatar/initiales +
 * nom + classe/niveau en méta), entrée finale « Autre… » (chevron, libellé
 * encre) révélant un champ de nom libre (label htmlForm associé, bouton
 * « Valider » type submit). Pas de recherche : ≤ 6 joueurs, la liste tient
 * à l'écran. Choisir ne lance RIEN — la sélection remonte à la feuille,
 * confirmée au cast (« Lancer sur Kael »).
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TargetableMember } from '../spellEffects';
import { BottomSheet } from './ui';
import { Glyph } from './Glyph';

/** Sélection courante du picker — l'état vit dans la feuille d'incantation. */
export type CastTarget =
  | { kind: 'self' }
  | { kind: 'character'; id: number; name: string }
  | { kind: 'label'; label: string };

/** Pastille avatar/initiales — mêmes lignes réglées que les listes du groupe. */
function Avatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <img
      src={url}
      alt=""
      className="shrink-0 rounded-full border-2 border-parchment-300 object-cover h-11 w-11"
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-parchment-300 bg-parchment-100 font-display text-lg text-ink-500"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function TargetPickerSheet({
  open,
  onClose,
  spellName,
  selfName,
  selfMeta,
  selfPortraitUrl,
  members,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  /** Nom du sort lancé — l'aria verbal (« Cibler Kael avec Hâte »). */
  spellName: string;
  selfName: string;
  selfMeta: string | null;
  selfPortraitUrl: string | null;
  /** Autres membres non cachés du groupe (le parent filtre déjà). */
  members: TargetableMember[];
  /** Sélection courante de la feuille d'incantation. */
  selected: CastTarget;
  onSelect: (target: CastTarget) => void;
}) {
  const { t } = useTranslation();
  // « Autre… » : le chevron révèle le champ ; Valider (submit) remonte le
  // nom libre TRIMMÉ — vide, le champ garde le focus (rien ne se ferme).
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState('');
  const otherInputId = 'target-other-name';
  const otherRef = useRef<HTMLInputElement>(null);

  // Réarmé à chaque ouverture : « Autre » reprend le chevron fermé.
  useEffect(() => {
    if (open) {
      setOtherOpen(false);
      setOtherName('');
    }
  }, [open]);

  useEffect(() => {
    if (otherOpen && open) otherRef.current?.focus();
  }, [otherOpen, open]);

  const choose = (target: CastTarget) => {
    onSelect(target);
    onClose();
  };

  const isSelfSelected = selected.kind === 'self';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('cast.cible.titre', { spell: spellName })}
      mobileOnly={false}
      size="md"
    >
      <div className="space-y-1.5">
        {/* « Moi » — épinglé en tête, le cas dominant : pré-sélectionné. */}
        <button
          type="button"
          onClick={() => choose({ kind: 'self' })}
          className={`flex w-full items-center gap-3 rounded-lg border px-3 min-h-[52px] text-left transition-colors ${
            isSelfSelected
              ? 'border-gold-400 bg-gold-50 ring-1 ring-gold-300'
              : 'border-parchment-200 bg-parchment-50 hover:border-gold-300'
          }`}
          aria-pressed={isSelfSelected}
          aria-label={t('cast.cible.moi.aria', { spell: spellName })}
        >
          <Avatar name={selfName} url={selfPortraitUrl} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink-800">
              {t('cast.cible.moi')} · {selfName}
            </span>
            {selfMeta && <span className="block truncate text-xs text-ink-400">{selfMeta}</span>}
          </span>
          <span
            className={`shrink-0 text-base ${isSelfSelected ? 'text-gold-600' : 'text-ink-300'}`}
            aria-hidden="true"
          >
            {isSelfSelected ? <Glyph name="check" /> : ''}
          </span>
        </button>

        {/* Autres membres du groupe — non cachés, triés par nom. */}
        {members.map((m) => {
          const isSelected = selected.kind === 'character' && selected.id === m.id;
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => choose({ kind: 'character', id: m.id, name: m.name })}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 min-h-[52px] text-left transition-colors ${
                isSelected
                  ? 'border-gold-400 bg-gold-50 ring-1 ring-gold-300'
                  : 'border-parchment-200 bg-parchment-50 hover:border-gold-300'
              }`}
              aria-pressed={isSelected}
              aria-label={t('cast.cible.cibler.avec', { name: m.name, spell: spellName })}
            >
              <Avatar name={m.name} url={m.portraitUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-800">{m.name}</span>
                <span className="block truncate text-xs text-ink-400">{m.meta}</span>
              </span>
              {m.ac !== null && (
                <span
                  className="shrink-0 font-mono text-xs text-ink-500"
                  title={t('cast.cible.ca.title')}
                >
                  <Glyph name="shield" /> {m.ac}
                </span>
              )}
              <span
                className={`shrink-0 text-base ${isSelected ? 'text-gold-600' : 'text-ink-300'}`}
                aria-hidden="true"
              >
                {isSelected ? <Glyph name="check" /> : ''}
              </span>
            </button>
          );
        })}

        {/* « Autre… » — cible sans fiche (PNJ/monstre) : nom libre, aucune CA. */}
        <div className="rounded-lg border border-parchment-200 bg-parchment-50">
          <button
            type="button"
            onClick={() => setOtherOpen((o) => !o)}
            aria-expanded={otherOpen}
            aria-label={t('cast.cible.autre.aria', { spell: spellName })}
            className={`flex w-full items-center gap-3 rounded-lg px-3 min-h-[52px] text-left transition-colors ${
              selected.kind === 'label' ? 'bg-gold-50' : 'hover:bg-parchment-100'
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-parchment-300 bg-parchment-100 text-lg text-ink-400"
            >
              ＋
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink-600">
                {t('cast.cible.autre')}
                {selected.kind === 'label' ? ` · ${selected.label}` : ''}
              </span>
              <span className="block truncate text-xs text-ink-400">
                {t('cast.cible.autre.hint')}
              </span>
            </span>
            <span
              className={`shrink-0 text-ink-400 transition-transform ${otherOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            >
              ›
            </span>
          </button>
          {otherOpen && (
            <form
              className="border-t border-parchment-200 px-3 pb-3 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = otherName.trim();
                if (!trimmed) {
                  otherRef.current?.focus();
                  return;
                }
                choose({ kind: 'label', label: trimmed.slice(0, 60) });
              }}
            >
              <label htmlFor={otherInputId} className="mb-1 block text-xs font-medium text-ink-600">
                {t('cast.cible.autre.nom')}
              </label>
              <div className="flex gap-2">
                <input
                  id={otherInputId}
                  ref={otherRef}
                  type="text"
                  maxLength={60}
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                  placeholder={t('cast.cible.autre.placeholder')}
                  className="input flex-1"
                />
                <button
                  type="submit"
                  className="btn-primary shrink-0 px-3 py-2 text-sm"
                  aria-label={t('cast.cible.autre.valider.aria', { spell: spellName })}
                >
                  {t('cast.cible.autre.valider')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
