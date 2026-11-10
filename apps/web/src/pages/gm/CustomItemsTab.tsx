// Extrait de GmDashboardPage.tsx — gate modularity R1 : le monolithe ne
// regrandit jamais. Onglet « Objets personnalisés » du pupitre du MD.
import { PartyDetail } from '@table-sync/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EMPTY_ITEM_IMAGE,
  ItemImageField,
  type ItemImageValue,
} from '../../components/ItemImageField';
import { ItemImageViewer } from '../../components/ItemImageViewer';
import {
  EMPTY_WEAPON_DRAFT,
  WeaponFields,
  type WeaponDraft,
  weaponDraftFromItem,
  weaponDraftPayload,
} from '../../components/WeaponFields';
import {
  EMPTY_ARMOR_DRAFT,
  ArmorFields,
  type ArmorDraft,
  armorDraftFromItem,
  armorDraftPayload,
} from '../../components/ArmorFields';
import {
  CategoryBadge,
  ConfirmButton,
  EmptyState,
  Fab,
  Modal,
  type Toast,
  ToastStack,
} from '../../components/ui';
import { useSyncEvent } from '../../sync';
import { Glyph } from '../../components/Glyph';
import api, { itemImageUrl, useAccessJwt } from '../../api';

export function CustomItemsTab({
  partyId,
  party,
}: {
  partyId: string;
  /** Le détail du groupe VIENT DU PARENT (déjà chargé + rafraîchi par
   *  party:change) — l'onglet ne re-télécharge plus le roster entier pour
   *  deux booléens et une carte de noms. */
  party: PartyDetail | null;
}) {
  const { t } = useTranslation();
  const [customItems, setCustomItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  // Les mini-châssis et la visionneuse d'illustrations chargent le JWT en
  // clair (?token=) : mémoire d'abord, échange contre le cookie si vide.
  const accessJwt = useAccessJwt();
  // Bascule « les joueurs peuvent créer » : la valeur FAIT FOI via la prop
  // (le PATCH émet party:change → le parent recharge → la prop rattrape) ;
  // l'override local garde l'état optimiste entre le PATCH et ce rattrapage.
  const [playersCreateOverride, setPlayersCreateOverride] = useState<boolean | null>(null);
  const playersCreate = playersCreateOverride ?? party?.party.playersCreateItems ?? null;
  // Carte userId → nom affiché, pour attribuer chaque objet à son auteur.
  const memberNames = useMemo(
    () => new Map((party?.members ?? []).map((m) => [m.userId, m.displayName])),
    [party],
  );
  const [togglingPlayersCreate, setTogglingPlayersCreate] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('custom');
  const [weight, setWeight] = useState('');
  const [desc, setDesc] = useState('');
  // Illustration : stagée ici, envoyée à l'enregistrement (jamais au choix).
  const [imageValue, setImageValue] = useState<ItemImageValue>(EMPTY_ITEM_IMAGE);
  // Panneau d'arme (category 'weapon') : le draft vit ici, hydraté à
  // l'édition, remis à zéro en création.
  const [weaponDraft, setWeaponDraft] = useState<WeaponDraft>(EMPTY_WEAPON_DRAFT);
  // Panneau d'armure (category 'armor') — même vie que le draft d'arme.
  const [armorDraft, setArmorDraft] = useState<ArmorDraft>(EMPTY_ARMOR_DRAFT);
  // Mini-châssis de la liste → visionneuse plein écran (rev capturée à
  // l'ouverture : l'URL change si le fichier a changé entre-temps).
  const [viewingImage, setViewingImage] = useState<{
    id: number;
    name: string;
    rev: string | null;
  } | null>(null);
  // Toast ciblé (échec d'envoi de l'illustration après un enregistrement réussi).
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'error') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const loadCustomItems = useCallback(async () => {
    try {
      const res = await api.get('/api/items', {
        params: { partyId, source: 'custom', limit: 200 },
      });
      setCustomItems(res.data.items || []);
    } catch {
      setCustomItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadCustomItems();
  }, [loadCustomItems]);

  const togglePlayersCreate = async () => {
    if (playersCreate === null || togglingPlayersCreate) return;
    const next = !playersCreate;
    setTogglingPlayersCreate(true);
    try {
      await api.patch(`/api/parties/${partyId}`, { playersCreateItems: next });
      setPlayersCreateOverride(next);
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    } finally {
      setTogglingPlayersCreate(false);
    }
  };

  useSyncEvent(
    (event) => {
      if (event.partyId === Number(partyId) && event.action === 'custom-item') {
        loadCustomItems();
      }
    },
    [partyId],
  );

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCategory('custom');
    setWeight('');
    setDesc('');
    setImageValue(EMPTY_ITEM_IMAGE);
    setWeaponDraft(EMPTY_WEAPON_DRAFT);
    setArmorDraft(EMPTY_ARMOR_DRAFT);
    setError('');
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setName(item.name);
    setCategory(item.category);
    setWeight(item.weightKg !== null ? String(item.weightKg) : '');
    setDesc(item.description || '');
    setImageValue(EMPTY_ITEM_IMAGE); // l'illustration existante s'affiche via son URL
    // Le panneau d'arme repart de l'état réel de l'objet (dés, type, bonus,
    // propriétés, base) — la soumission PATCH les renvoie.
    setWeaponDraft(weaponDraftFromItem(item));
    // Idem armure : famille, CA de base, force min, malus, bonus, base.
    setArmorDraft(armorDraftFromItem(item));
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    if (!name.trim()) {
      setError(t('md.le.nom.est.requis'));
      return;
    }
    setSaving(true);
    setError('');
    const payload: Record<string, unknown> = {
      name: name.trim(),
      category,
      weightKg: weight ? parseFloat(weight) : null,
      description: desc.trim() || null,
    };
    // Champs d'arme : uniquement pour la catégorie Arme (l'API les ignore —
    // et les rejette — sinon). Création comme édition : le modal d'édition
    // hydrate le draft depuis l'item, la payload remplace l'état complet.
    if (category === 'weapon') Object.assign(payload, weaponDraftPayload(weaponDraft));
    // Champs d'armure : uniquement pour la catégorie Armure (l'API les
    // ignore — et les rejette — sinon). Création comme édition : le modal
    // d'édition hydrate le draft depuis l'item, la payload remplace l'état.
    if (category === 'armor') Object.assign(payload, armorDraftPayload(armorDraft));
    try {
      let itemId = editing?.id as number | undefined;
      if (editing) {
        await api.patch(`/api/items/${editing.id}`, payload);
      } else {
        const res = await api.post(`/api/parties/${partyId}/items`, payload);
        itemId = res.data.item.id;
      }
      // Séquencement illustration : l'image part à l'enregistrement. Si elle
      // échoue, l'objet reste créé/sauvegardé — toast ciblé, jamais de perte
      // silencieuse (le MD réessaie depuis Modifier).
      if (itemId != null) {
        try {
          if (imageValue.staged) {
            const form = new FormData();
            form.append('image', imageValue.staged.blob, 'illustration.jpg');
            // L'instance axios force Content-Type: application/json — laisser le
            // navigateur poser la boundary multipart (sinon FST_INVALID_MULTIPART).
            await api.put(`/api/items/${itemId}/image`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
              // Upload sur liaison lente : hors du timeout axios par défaut (15 s).
              timeout: 120_000,
            });
          } else if (imageValue.removed) {
            await api.delete(`/api/items/${itemId}/image`);
          }
        } catch {
          pushToast(t('md.illustration.non.envoyee'));
        }
      }
      setShowModal(false);
      setImageValue(EMPTY_ITEM_IMAGE);
      await loadCustomItems();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/items/${id}`);
      await loadCustomItems();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title">
          {t('md.objets.personnalises')}{' '}
          <span className="text-ink-400 text-sm font-normal">({customItems.length})</span>
        </h3>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          {t('md.ajouter')}
        </button>
      </div>

      {/* Autonomy switch: players create missing items from their inventory
          search; everything lands here for review and later edits. */}
      <div className="card p-3 flex items-start gap-2.5">
        <input
          id="gm-players-create-items"
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-blood-600"
          checked={playersCreate ?? false}
          onChange={togglePlayersCreate}
          disabled={playersCreate === null || togglingPlayersCreate}
        />
        <label htmlFor="gm-players-create-items" className="text-sm font-medium text-ink-700">
          {t('md.les.joueurs.peuvent.creer.des.objets')}
          <span className="mt-0.5 block text-xs font-normal text-ink-400">
            {t('md.depuis.la.recherche.de.leur.inventaire')}
          </span>
        </label>
      </div>

      {loadingItems ? (
        <p className="text-sm text-ink-400 animate-pulse">{t('md.chargement')}</p>
      ) : customItems.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<Glyph name="spark" />}
            title={t('md.aucun.objet.personnalise')}
            hint={t('md.cree.des.objets.non.srd')}
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {customItems.map((item) => (
            <li key={item.id} className="card p-3 flex items-start gap-3">
              {/* Mini-châssis 40px : le MD vérifie une illustration sans ouvrir
                  l'éditeur — et préchauffe le cache de la visionneuse. */}
              {item.hasImage ? (
                <button
                  type="button"
                  onClick={() =>
                    setViewingImage({
                      id: item.id,
                      name: item.name,
                      rev: item.imageRev ?? null,
                    })
                  }
                  className="shrink-0 overflow-hidden rounded-md border border-parchment-200"
                  aria-label={t('md.agrandir.l.illustration.de.item.name', {
                    item_name: item.name,
                  })}
                >
                  <img
                    src={itemImageUrl(item.id, item.imageRev, accessJwt)}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 object-cover"
                  />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 max-w-full truncate font-medium text-ink-800">
                    {item.name}
                  </span>
                  <CategoryBadge category={item.category} />
                  {item.weightKg !== null && (
                    <span className="text-xs text-ink-400">{item.weightKg} kg</span>
                  )}
                  {item.createdBy !== null && (
                    <span className="text-xs text-ink-400">
                      {t('md.par', {
                        name: memberNames.get(item.createdBy) ?? t('md.un.joueur'),
                      })}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-ink-500 mt-1">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="text-ink-400 hover:text-blood-500 text-sm p-1"
                  aria-label={t('md.modifier')}
                >
                  <Glyph name="edit" />
                </button>
                <ConfirmButton
                  onConfirm={() => remove(item.id)}
                  className="text-ink-400 hover:text-red-700 text-sm p-1 rounded-full transition-colors"
                  armedClassName="bg-red-600 hover:brightness-90 text-white! px-2.5 py-1 font-semibold"
                  title={t('md.supprimer.item.name.item.name', {
                    item_name: item.name,
                  })}
                  ariaLabel={t('md.supprimer.item.name.item.name', {
                    item_name: item.name,
                  })}
                  confirmChildren={t('md.supprimer.confirmer')}
                >
                  ×
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Floating + button */}
      {customItems.length > 0 && (
        <Fab onClick={openCreate} label={t('md.ajouter.un.objet.personnalise')} mobileOnly />
      )}

      {/* Create/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('md.modifier.l.objet') : t('md.nouvel.objet.personnalise')}
      >
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('md.nom')}</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('md.epee.du.heros')}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label">{t('md.categorie')}</span>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="custom">{t('md.personnalise')}</option>
                <option value="weapon">{t('md.arme')}</option>
                <option value="armor">{t('md.armure')}</option>
                <option value="gear">{t('md.equipement')}</option>
                <option value="magic">{t('md.objet.magique')}</option>
              </select>
            </label>
          </div>
          {/* Panneau Arme : sous la catégorie, uniquement pour les armes —
            aperçu symbolique (le MD n'a pas de porteur). */}
          {category === 'weapon' && <WeaponFields draft={weaponDraft} onChange={setWeaponDraft} />}
          {/* Panneau Armure : même emplacement, aperçu symbolique (la CA
            reste « + DEX » en lettres — aucun porteur du côté MD). */}
          {category === 'armor' && <ArmorFields draft={armorDraft} onChange={setArmorDraft} />}
          <label className="block">
            <span className="label">{t('md.poids.kg')}</span>
            <input
              type="number"
              step="0.01"
              className="input"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0.5"
            />
          </label>
          <label className="block">
            <span className="label">{t('md.description')}</span>
            <textarea
              className="input"
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('md.une.lame.brillant.d.une.lumiere')}
            />
          </label>
          {/* L'image est le second contenu de l'objet — après la description,
            avant l'erreur et les boutons (plan objets-illustrations §5.1). */}
          <ItemImageField
            value={imageValue}
            onChange={setImageValue}
            existingItemId={editing?.id}
            existingRev={editing?.imageRev ?? undefined}
            existingName={editing ? editing.name : undefined}
          />
          {error && <div className="text-red-700 text-sm">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editing ? t('common.save') : t('md.ajouter.au.catalogue')}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              {t('md.annuler')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Visionneuse plein écran (mini-châssis de la liste) */}
      {viewingImage && (
        <ItemImageViewer
          name={viewingImage.name}
          src={itemImageUrl(viewingImage.id, viewingImage.rev ?? undefined, accessJwt)}
          onClose={() => setViewingImage(null)}
        />
      )}

      {/* Toast ciblé (échec d'envoi de l'illustration après un save réussi) */}
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </div>
  );
}
