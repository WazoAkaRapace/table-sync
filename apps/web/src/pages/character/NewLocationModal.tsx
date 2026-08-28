import type { StorageType } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui';
import type { NewLocationPayload } from './types';

// ---------- New transport (storage location) modal ----------

interface NewLocationModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: NewLocationPayload) => Promise<void>;
}

export function NewLocationModal({ open, onClose, onCreate }: NewLocationModalProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<StorageType>('mount');
  const [name, setName] = useState('');
  const [strength, setStrength] = useState('10');
  const [multiplier, setMultiplier] = useState('1');
  const [capacityKg, setCapacityKg] = useState('');
  const [ownWeightKg, setOwnWeightKg] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  // Reset fields whenever the modal is (re)opened
  useEffect(() => {
    if (open) {
      setType('mount');
      setName('');
      setStrength('10');
      setMultiplier('1');
      setCapacityKg('');
      setOwnWeightKg('0');
      setSubmitting(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      if (type === 'mount') {
        await onCreate({
          name: trimmed,
          type: 'mount',
          strength: Math.max(1, Math.floor(Number(strength) || 10)),
          multiplier: Math.max(1, Number(multiplier) || 1),
        });
      } else {
        await onCreate({
          name: trimmed,
          type: 'container',
          capacityKg: Math.max(0, Number(capacityKg) || 0),
          ownWeightKg: Math.max(0, Number(ownWeightKg) || 0),
        });
      }
      // onCreate closes the modal on success
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('empl.nouveau.transport')}>
      <form onSubmit={submit} className="space-y-4">
        {/* Type selector — two pills */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('mount')}
            className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
              type === 'mount'
                ? 'bg-blood-600 text-white border-blood-600'
                : 'bg-parchment-100 text-ink-700 border-parchment-300 hover:bg-parchment-200'
            }`}
            aria-pressed={type === 'mount'}
          >
            {t('empl.monture')}
          </button>
          <button
            type="button"
            onClick={() => setType('container')}
            className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
              type === 'container'
                ? 'bg-blood-600 text-white border-blood-600'
                : 'bg-parchment-100 text-ink-700 border-parchment-300 hover:bg-parchment-200'
            }`}
            aria-pressed={type === 'container'}
          >
            📦 Conteneur
          </button>
        </div>

        <label className="block">
          <span className="label">{t('empl.nom')}</span>
          <input
            type="text"
            className="input"
            placeholder={type === 'mount' ? 'Ex. Mulet, Cheval…' : 'Ex. Sac de voyage, Coffre…'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            aria-label={t('empl.nom.du.transport')}
          />
        </label>

        {type === 'mount' ? (
          <>
            <label className="block">
              <span className="label">Force</span>
              <input
                type="number"
                min={1}
                max={30}
                className="input"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                aria-label={t('empl.force.de.la.monture')}
              />
            </label>
            <label className="block">
              <span className="label">Multiplicateur</span>
              <input
                type="number"
                min={1}
                step={0.5}
                className="input"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                aria-label={t('empl.multiplicateur.de.capacite')}
              />
              <span className="text-xs text-ink-400 mt-1 block">
                Bête de somme = 2 (capacité doublée).
              </span>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="label">{t('empl.capacite.kg')}</span>
              <input
                type="number"
                min={0}
                step={0.1}
                className="input"
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
                placeholder="Ex. 30"
                aria-label={t('empl.capacite.du.conteneur.en.kg')}
              />
            </label>
            <label className="block">
              <span className="label">{t('empl.poids.a.vide.kg')}</span>
              <input
                type="number"
                min={0}
                step={0.1}
                className="input"
                value={ownWeightKg}
                onChange={(e) => setOwnWeightKg(e.target.value)}
                aria-label={t('empl.poids.a.vide.du.conteneur.en')}
              />
              <span className="text-xs text-ink-400 mt-1 block">
                {t('empl.ce.poids.s.ajoute.a.ce')}
              </span>
            </label>
          </>
        )}

        <button type="submit" disabled={!name.trim() || submitting} className="btn-primary w-full">
          {submitting ? 'Création…' : 'Créer'}
        </button>
      </form>
    </Modal>
  );
}
