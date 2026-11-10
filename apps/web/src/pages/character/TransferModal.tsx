import type { InventoryEntry, StorageLocation } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { EmptyState, LoadingSpinner, Modal, NumberField } from '../../components/ui';
import { usePartyRecipients } from '../../usePartyRecipients';
import { Glyph } from '../../components/Glyph';

// ---------- Transfer modal ----------

interface TransferModalProps {
  open: boolean;
  entry: InventoryEntry | null;
  charId: number;
  partyId?: string;
  onClose: () => void;
  onTransferred: (itemName: string) => void | Promise<void>;
  onError: (msg: string) => void;
}

export function TransferModal({
  open,
  entry,
  charId,
  partyId,
  onClose,
  onTransferred,
  onError,
}: TransferModalProps) {
  const { t } = useTranslation();
  const { loadingParty, others } = usePartyRecipients(open, partyId, charId, onError);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && entry) {
      setQty(entry.quantity);
      setTargetId(null);
    }
  }, [open, entry]);

  if (!entry) return null;

  const maxQty = entry.quantity;
  const itemName = entry.item.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;
    const transferQty = Math.max(1, Math.min(qty, maxQty));
    setSubmitting(true);
    try {
      await api.post(`/api/characters/${charId}/transfer`, {
        toCharacterId: targetId,
        inventoryId: entry.id,
        quantity: transferQty,
      });
      await onTransferred(itemName);
    } catch (err: any) {
      onError(err.response?.data?.error || t('transfert.echec.du.transfert'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('transfert.transferer.itemname', { itemName: itemName })}
    >
      {loadingParty ? (
        <LoadingSpinner label={t('transfert.chargement.du.groupe')} />
      ) : others.length === 0 ? (
        <EmptyState
          icon={<Glyph name="user" />}
          title={t('transfert.aucun.autre.personnage')}
          hint={t('transfert.aucun.destinataire.dans.ce.groupe')}
        />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="give-target">
              Destinataire
            </label>
            <select
              id="give-target"
              className="input"
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value === '' ? null : Number(e.target.value))}
              required
            >
              <option value="">— Choisir —</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.ownerName})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="give-qty">
              {t('transfert.quantite.max', { maxQty })}
            </label>
            <NumberField
              id="give-qty"
              min={1}
              max={maxQty}
              className="input"
              value={qty}
              onChange={setQty}
            />
          </div>
          <button type="submit" disabled={!targetId || submitting} className="btn-primary w-full">
            {submitting ? t('transfert.transfert') : t('transfert.transferer')}
          </button>
        </form>
      )}
    </Modal>
  );
}

// ---------- Container transfer modal ----------
// « Transférer à… » d'un conteneur : le coffre part AVEC son contenu (le
// serveur déplace lieu + lignes, arrivent déséquipées). Même dialecte que le
// transfert d'objet — destinataire du groupe, confirmation verrouillée tant
// que personne n'est choisi — sans quantité : un conteneur ne se coupe pas.

interface ContainerTransferModalProps {
  open: boolean;
  location: StorageLocation | null;
  /** Number of entries currently stored in the container (hint under the title). */
  contentCount: number;
  charId: number;
  partyId?: string;
  onClose: () => void;
  onTransferred: (containerName: string) => void | Promise<void>;
  onError: (msg: string) => void;
}

export function ContainerTransferModal({
  open,
  location,
  contentCount,
  charId,
  partyId,
  onClose,
  onTransferred,
  onError,
}: ContainerTransferModalProps) {
  const { t } = useTranslation();
  const { loadingParty, others } = usePartyRecipients(open, partyId, charId, onError);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setTargetId(null);
  }, [open]);

  if (!location) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;
    setSubmitting(true);
    try {
      await api.post(`/api/characters/${charId}/transfer-container`, {
        toCharacterId: targetId,
        locationId: location.id,
      });
      await onTransferred(location.name);
    } catch (err: any) {
      onError(err.response?.data?.error || t('transfert.echec.du.transfert'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('transfert.conteneur.transferer.itemname', { itemName: location.name })}
    >
      {loadingParty ? (
        <LoadingSpinner label={t('transfert.chargement.du.groupe')} />
      ) : others.length === 0 ? (
        <EmptyState
          icon={<Glyph name="user" />}
          title={t('transfert.aucun.autre.personnage')}
          hint={t('transfert.aucun.destinataire.dans.ce.groupe')}
        />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-ink-500">
            {t('transfert.conteneur.contenu', { count: contentCount })}
          </p>
          <div>
            <label className="label" htmlFor="give-container-target">
              {t('transfert.destinataire')}
            </label>
            <select
              id="give-container-target"
              className="input"
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value === '' ? null : Number(e.target.value))}
              required
            >
              <option value="">— {t('transfert.choisir')} —</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.ownerName})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={!targetId || submitting} className="btn-primary w-full">
            {submitting ? t('transfert.transfert') : t('transfert.transferer')}
          </button>
        </form>
      )}
    </Modal>
  );
}
