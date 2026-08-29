/**
 * Champ « Illustration » des formulaires d'objet personnalisé (MD et joueur
 * — même composant, même rendu). Valeur contrôlée : l'image choisie part à
 * l'ENREGISTREMENT (jamais au choix), la suppression d'une image existante
 * est différée (flag removed) — le formulaire ne déclenche rien par lui-même.
 *
 * Aperçu = le même châssis parchemin que la ligne d'inventaire dépliée :
 * ce que le MD voit ici est ce que le joueur verra en séance. La ligne mono
 * dessous (JPEG · 1240 × 930 · 214 ko) prouve que la réduction canvas a opéré.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { itemImageUrl } from '../api';
import { appLocale } from '../i18n';
import { downscaleImage } from '../utils';
import { ConfirmButton } from './ui';

export interface StagedImage {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  size: number;
}

/** Contrôle : image stagée (à envoyer) et/ou suppression différée (à appliquer). */
export interface ItemImageValue {
  staged: StagedImage | null;
  removed: boolean;
}

export const EMPTY_ITEM_IMAGE: ItemImageValue = { staged: null, removed: false };

type TranslateFn = ReturnType<typeof useTranslation>['t'];

/** Format mono d'une valeur mesurée : 214 ko, 1,2 Mo (EN : 214 kB, 1.2 MB). */
function formatSize(bytes: number, t: TranslateFn): string {
  return bytes >= 1024 * 1024
    ? t('champ.taille.mo', {
        n: new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1 }).format(
          bytes / (1024 * 1024),
        ),
      })
    : t('champ.taille.ko', { n: String(Math.max(1, Math.round(bytes / 1024))) });
}

export function ItemImageField({
  value,
  onChange,
  existingItemId,
  existingRev,
  existingName,
}: {
  value: ItemImageValue;
  onChange: (v: ItemImageValue) => void;
  /** En édition : id de l'objet existant (aperçu via son URL servie). */
  existingItemId?: number;
  /** Version du fichier existant (Item.imageRev) — rafraîchit l'aperçu
      après un remplacement enregistré sans rouvrir le formulaire. */
  existingRev?: string | null;
  existingName?: string;
}) {
  const { t } = useTranslation();
  const [processing, setProcessing] = useState(false);
  const [fileError, setFileError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Le champ est l'unique consommateur du previewUrl : il le révoque quand la
  // valeur change (remplacement) et au démontage (fermeture du formulaire).
  const previewUrl = value.staged?.previewUrl;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    setFileError('');
    setProcessing(true);
    // ~100-300 ms sur une photo 12MP — le formulaire reste utilisable.
    const result = await downscaleImage(file);
    setProcessing(false);
    if (!result) {
      setFileError(t('champ.fichier.illisible'));
      return;
    }
    onChange({
      staged: {
        blob: result.blob,
        previewUrl: URL.createObjectURL(result.blob),
        width: result.width,
        height: result.height,
        size: result.blob.size,
      },
      removed: false,
    });
  };

  // Desktop : coller (Ctrl+V) une capture d'écran — le MD photographie la
  // lettre depuis un écran aussi souvent qu'il la scanne.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0];
      if (file) {
        e.preventDefault();
        handleFile(file);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const hasStaged = !!value.staged;
  // En édition, l'illustration existante reste en place tant qu'elle n'est
  // ni remplacée ni supprimée (suppression différée → retombe à l'état vide).
  const showsExisting = !hasStaged && !value.removed && existingItemId != null;
  const chassisClasses = 'rounded-lg border border-parchment-300 bg-parchment-50 p-1.5 shadow-sm';

  return (
    <div>
      <span className="label">{t('champ.illustration')}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = ''; // re-choisir le même fichier re-déclenche onChange
        }}
      />

      {hasStaged || showsExisting ? (
        <div className={chassisClasses}>
          {hasStaged && value.staged ? (
            <>
              <img
                src={value.staged.previewUrl}
                alt={t('champ.apercu.de.l.illustration.de.existingname', {
                  existingName: existingName ?? 'l’objet',
                })}
                className="mx-auto max-h-56 w-full object-contain"
              />
              <p className="mt-1.5 text-center font-mono text-xs text-ink-400">
                JPEG · {value.staged.width} × {value.staged.height} ·{' '}
                {formatSize(value.staged.size, t)}
              </p>
            </>
          ) : (
            <img
              src={itemImageUrl(existingItemId as number, existingRev ?? undefined)}
              alt={t('champ.illustration.actuelle.de.existingname.l.objet', {
                existingName: existingName ?? 'l’objet',
              })}
              className="mx-auto max-h-56 w-full object-contain"
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          aria-label={t('champ.ajouter.une.illustration')}
          className={`flex w-full flex-col items-center gap-1 rounded-lg border border-dashed py-5 transition-colors ${
            dragOver
              ? 'border-blood-400 bg-blood-50/40'
              : 'border-parchment-300 bg-parchment-50 hover:border-parchment-400'
          }`}
        >
          <span aria-hidden="true" className="text-2xl text-ink-400">
            🗺
          </span>
          <span className="text-sm font-medium text-ink-700">
            {dragOver ? t('champ.glisse.une.image.ici') : t('champ.ajouter.une.illustration')}
          </span>
          <span className="text-xs text-ink-400">
            {t('champ.une.carte.une.lettre.un.document')}
          </span>
        </button>
      )}

      {processing && (
        <p className="mt-1 animate-pulse text-xs text-ink-400">{t('champ.traitement')}</p>
      )}
      {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}

      {(hasStaged || showsExisting) && (
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
            className="btn-ghost text-xs disabled:opacity-50"
          >
            {t('champ.remplacer')}
          </button>
          <ConfirmButton
            onConfirm={() => {
              // stagée → simple dé-stage ; existante → suppression différée
              onChange({ staged: null, removed: showsExisting });
            }}
            className="btn-ghost text-xs text-red-600 hover:bg-red-50"
            armedClassName="bg-red-600 hover:bg-red-700 text-white!"
            ariaLabel={t('champ.supprimer.l.illustration')}
            confirmChildren={t('champ.supprimer.l.illustration.confirm')}
          >
            {t('champ.supprimer')}
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
