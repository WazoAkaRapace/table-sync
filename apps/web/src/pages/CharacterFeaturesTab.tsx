/**
 * Traits tab — free-form character features (class/racial/background/feat/custom)
 * with a {{template}} system that injects computed values from the character's stats.
 */

import {
  type Character,
  type CharacterFeature,
  CLASS_FEATURES,
  CLASS_FEATURES_EN,
  CLASS_SUBCLASSES,
  type ClassFeatureDef,
  classesOf,
  DND_CLASSES,
  effectiveFeatureReset,
  FEATURE_CATEGORY_LABELS_FR,
  type FeatureCategory,
  type FeatureResetType,
  findClass,
  findClassFeature,
  findClassFeatureClass,
  nextClassFeatureGains,
  renderFeatureTemplate,
  TEMPLATE_VARIABLES,
} from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { SortableCard, SortableGrid } from '../components/SortableGrid';
import { ConfirmButton, EmptyState, Modal } from '../components/ui';
import { appLang } from '../i18n';
import { classNameLabel, featureCategoryLabel } from '../i18n/labels';
import { useSyncEvent } from '../sync';

// TEMPLATE_VARIABLES (partagé) reste la source des syntaxes ; la description
// affichée passe par i18next — FR = copies verbatim du catalogue partagé.
const TEMPLATE_VAR_KEYS: Record<string, string> = {
  '{{name}}': 'traits.var.name',
  '{{level}}': 'traits.var.level',
  '{{class}}': 'traits.var.class',
  '{{race}}': 'traits.var.race',
  '{{prof}}': 'traits.var.prof',
  '{{save_dc}}': 'traits.var.save.dc',
  '{{spell_attack}}': 'traits.var.spell.attack',
  '{{str_mod}}': 'traits.var.str.mod',
  '{{dex_mod}}': 'traits.var.dex.mod',
  '{{con_mod}}': 'traits.var.con.mod',
  '{{int_mod}}': 'traits.var.int.mod',
  '{{wis_mod}}': 'traits.var.wis.mod',
  '{{cha_mod}}': 'traits.var.cha.mod',
  '{{save:dex}}': 'traits.var.save.dex',
  '{{save:con}}': 'traits.var.save.con',
  '{{skill:perception}}': 'traits.var.skill.perception',
  '{{skill:athletics}}': 'traits.var.skill.athletics',
  '{{passive_perception}}': 'traits.var.passive.perception',
  '{{initiative}}': 'traits.var.initiative',
  '{{speed}}': 'traits.var.speed',
  '{{max_hp}}': 'traits.var.max.hp',
};

// Affichage EN : le catalogue SRD a sa table anglaise (classFeatures.en.ts),
// les lignes stockées restent FR — on superpose via catalogId.
function featName(f: { title: string; catalogId?: string | null }): string {
  return (
    (appLang() === 'en' && f.catalogId ? CLASS_FEATURES_EN[f.catalogId]?.name : null) ?? f.title
  );
}
function featDesc(f: { description: string | null; catalogId?: string | null }): string | null {
  return (
    (appLang() === 'en' && f.catalogId ? CLASS_FEATURES_EN[f.catalogId]?.description : null) ??
    f.description
  );
}
function defName(d: { id: string; name: string }): string {
  return (appLang() === 'en' ? CLASS_FEATURES_EN[d.id]?.name : null) ?? d.name;
}
function defDesc(d: { id: string; description: string }): string {
  return (appLang() === 'en' ? CLASS_FEATURES_EN[d.id]?.description : null) ?? d.description;
}

interface Props {
  character: Character;
  charId: number;
  partyId?: string;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

const CATEGORY_COLORS: Record<FeatureCategory, string> = {
  class: 'bg-blood-50 text-blood-700 border-blood-200',
  racial: 'bg-green-50 text-green-700 border-green-200',
  background: 'bg-blue-50 text-blue-700 border-blue-200',
  feat: 'bg-purple-50 text-purple-700 border-purple-200',
  custom: 'bg-parchment-100 text-ink-600 border-parchment-300',
};

export default function CharacterFeaturesTab({
  character,
  charId,
  partyId,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const [features, setFeatures] = useState<CharacterFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CharacterFeature | null>(null);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeatureCategory>('class');
  const [description, setDescription] = useState('');
  const [counterMax, setCounterMax] = useState('');
  const [resetShort, setResetShort] = useState(false);
  const [resetLong, setResetLong] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/characters/${charId}/features`);
      const data = res.data?.features ?? res.data ?? [];
      setFeatures(Array.isArray(data) ? data : []);
    } catch {
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  }, [charId]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time sync
  const currentPartyId = partyId ? Number(partyId) : undefined;
  useSyncEvent(
    (event) => {
      if (event.type === 'character:change' && event.characterId === charId) {
        load();
      }
    },
    [charId, currentPartyId],
  );

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setCategory('class');
    setDescription('');
    setCounterMax('');
    setResetShort(false);
    setResetLong(false);
    setShowTemplateHelp(false);
    setShowModal(true);
  };

  // Niveau de la classe qui accorde une capacité du catalogue (multiclassage :
  // chaque classe est évaluée à SON niveau — jamais le niveau total).
  const ownLines = classesOf(character);
  const ownerLevelOf = (catalogId: string | null | undefined): number => {
    const fallback = character.level ?? 1;
    if (!catalogId) return fallback;
    const owner = findClassFeatureClass(catalogId);
    if (!owner) return fallback;
    const line = ownLines.find((c) => findClass(c.classKey)?.name === owner);
    return line?.level ?? fallback;
  };

  const openEdit = (feature: CharacterFeature) => {
    setEditing(feature);
    setTitle(feature.title);
    setCategory(feature.category);
    setDescription(feature.description ?? '');
    setCounterMax(feature.counterMax ? String(feature.counterMax) : '');
    // Cases initialisées sur la recharge EFFECTIVE : choix du joueur s'il y en a
    // un, sinon la règle SRD du catalogue au niveau de la classe qui accorde
    // la capacité (multiclassage)
    const eff = effectiveFeatureReset(feature, ownerLevelOf(feature.catalogId));
    setResetShort(eff === 'short');
    setResetLong(eff === 'short' || eff === 'long');
    setShowTemplateHelp(false);
    setShowModal(true);
  };

  const save = async () => {
    if (!title.trim()) {
      onError(t('traits.le.titre.est.requis'));
      return;
    }
    const cm = counterMax.trim() ? Math.max(0, Number(counterMax)) : null;
    const cmVal = cm !== null && cm > 0 ? cm : null;
    // Un repos court inclut le repos long : court ⇒ les deux. Décochées = manuel.
    let resetType: FeatureResetType | null = !cmVal
      ? null
      : resetShort
        ? 'short'
        : resetLong
          ? 'long'
          : 'none';
    if (cmVal && editing?.catalogId) {
      // Trait de catalogue : le choix du joueur n'est stocké que s'il S'ÉCARTE
      // de la règle SRD — sinon null et le trait continue de suivre le catalogue
      // (y compris ses paliers de niveau, ex. Inspiration bardique au niv. 5).
      const def = findClassFeature(editing.catalogId);
      if (def?.resource) {
        const catalogReset = effectiveFeatureReset(
          { catalogId: editing.catalogId, resetType: null },
          ownerLevelOf(editing.catalogId),
        );
        if (resetType === catalogReset) resetType = null;
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/character-features/${editing.id}`, {
          title: title.trim(),
          category,
          description: description.trim() || null,
          counterMax: cmVal,
          resetType,
        });
      } else {
        await api.post(`/api/characters/${charId}/features`, {
          title: title.trim(),
          category,
          description: description.trim() || undefined,
          counterMax: cmVal ?? undefined,
          resetType,
        });
      }
      setShowModal(false);
      await load();
      await onSaved();
    } catch {
      onError(t('traits.erreur.lors.de.la.sauvegarde'));
    } finally {
      setSaving(false);
    }
  };

  const adjustCounter = async (feature: CharacterFeature, delta: number) => {
    const max = feature.counterMax ?? 0;
    const current = feature.counterCurrent ?? max;
    const next = Math.max(0, Math.min(max, current + delta));
    if (next === current) return;
    try {
      await api.patch(`/api/character-features/${feature.id}`, { counterCurrent: next });
      await load();
    } catch {
      onError(t('traits.erreur.de.mise.a.jour'));
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/character-features/${id}`);
      await load();
      await onSaved();
    } catch {
      onError(t('traits.erreur.lors.de.la.suppression'));
    }
  };

  // Drag-to-reorder within ONE category section: the client sends the group's
  // ids, the server rewrites their sort_order (interleaved values across
  // groups are fine — ordering only matters within a category after
  // grouping). Optimistic move, rollback + message on failure.
  const reorderGroup = async (nextIds: number[]) => {
    const prev = features;
    const moved = new Set(nextIds);
    const byId = new Map(features.map((f) => [f.id, f]));
    const reordered = nextIds.map((id) => byId.get(id)).filter((f) => f !== undefined);
    setFeatures([...features.filter((f) => !moved.has(f.id)), ...reordered]);
    try {
      await api.patch(`/api/characters/${charId}/features/order`, { order: nextIds });
    } catch {
      setFeatures(prev);
      onError(t('traits.reorganisation.non.enregistree'));
    }
  };

  // Catalogue : ajout en 1 clic — le compteur est déduit de la formule SRD côté API
  const addFromCatalog = async (def: ClassFeatureDef) => {
    try {
      await api.post(`/api/characters/${charId}/features`, {
        title: def.name,
        category: 'class',
        description: def.description,
        catalogId: def.id,
      });
      await load();
      await onSaved();
    } catch {
      onError(t('traits.erreur.d.ajout.depuis.le.catalogue'));
    }
  };

  // Group features by category
  const categories = Object.keys(FEATURE_CATEGORY_LABELS_FR) as FeatureCategory[];
  const grouped = categories
    .map((cat) => ({
      category: cat,
      items: features.filter((f) => f.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  const addedCatalogIds = new Set(features.map((f) => f.catalogId).filter(Boolean) as string[]);

  if (loading) {
    return <p className="text-sm text-ink-400 animate-pulse">{t('traits.chargement')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="section-title">
          {t('traits.traits')}{' '}
          <span className="text-ink-400 text-sm font-normal">({features.length})</span>
        </h2>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          {t('traits.ajouter')}
        </button>
      </div>

      {/* Catalogue SRD par classe/niveau — ajout en 1 clic avec compteur pré-rempli */}
      <CatalogCard character={character} addedCatalogIds={addedCatalogIds} onAdd={addFromCatalog} />

      {features.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon="📋"
            title={t('traits.aucun.trait')}
            hint={t('traits.ajoute.tes.capacites.de.classe.traits.raciaux.dons.ou.toute')}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">
                {featureCategoryLabel(group.category)} ({group.items.length})
              </div>
              <SortableGrid
                ids={group.items.map((f) => f.id)}
                onReorder={reorderGroup}
                labelOf={(id) => features.find((f) => f.id === Number(id))?.title ?? ''}
                className="grid gap-3 sm:grid-cols-2"
              >
                {group.items.map((feature) => {
                  const rendered = featDesc(feature)
                    ? renderFeatureTemplate(featDesc(feature) as string, character)
                    : null;
                  return (
                    <SortableCard
                      key={feature.id}
                      id={feature.id}
                      label={t('traits.deplacer.featname.feature', {
                        featName: featName(feature),
                      })}
                    >
                      {(handle, isDragging) => (
                        <div
                          className={`card p-4 flex flex-col gap-2 ${isDragging ? 'card-dragging' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-display font-semibold text-ink-800">
                              {featName(feature)}
                            </h3>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => openEdit(feature)}
                                className="text-ink-400 hover:text-blood-600 text-sm p-1"
                                aria-label={t('traits.modifier.featname.feature', {
                                  featName: featName(feature),
                                })}
                              >
                                ✎
                              </button>
                              <ConfirmButton
                                onConfirm={() => remove(feature.id)}
                                className="text-ink-400 hover:text-red-500 text-sm p-1 rounded-full transition-colors"
                                armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
                                title={t('traits.supprimer.featname.feature', {
                                  featName: featName(feature),
                                })}
                                ariaLabel={t('traits.supprimer.featname.feature', {
                                  featName: featName(feature),
                                })}
                                confirmChildren={t('traits.supprimer')}
                              >
                                ×
                              </ConfirmButton>
                              {group.items.length > 1 && handle}
                            </div>
                          </div>
                          {rendered && (
                            <p className="text-sm text-ink-600 whitespace-pre-line">{rendered}</p>
                          )}

                          {/* Charge counter widget */}
                          {feature.counterMax &&
                            feature.counterMax > 0 &&
                            (() => {
                              const max = feature.counterMax;
                              const current = feature.counterCurrent ?? max;
                              const pct = Math.round((current / max) * 100);
                              const barColor =
                                current === 0
                                  ? 'bg-red-500'
                                  : pct <= 50
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500';
                              return (
                                <div className="flex items-center gap-2 bg-parchment-50 rounded-lg p-2">
                                  <button
                                    type="button"
                                    onClick={() => adjustCounter(feature, -1)}
                                    disabled={current <= 0}
                                    className="w-7 h-7 rounded-md bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-sm font-medium flex items-center justify-center shrink-0"
                                    aria-label={t('traits.diminuer')}
                                  >
                                    −
                                  </button>
                                  <span className="text-sm font-bold text-ink-800 tabular-nums">
                                    {current}
                                    <span className="text-ink-400 font-normal"> / {max}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => adjustCounter(feature, 1)}
                                    disabled={current >= max}
                                    className="w-7 h-7 rounded-md bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-sm font-medium flex items-center justify-center shrink-0"
                                    aria-label={t('traits.augmenter')}
                                  >
                                    +
                                  </button>
                                  <div
                                    className="flex-1 h-2 bg-parchment-200 rounded-full overflow-hidden"
                                    role="progressbar"
                                    aria-valuenow={current}
                                    aria-valuemin={0}
                                    aria-valuemax={max}
                                    aria-valuetext={`${current} / ${max}`}
                                  >
                                    <div
                                      className={`h-full ${barColor} transition-all rounded-full`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })()}

                          {/* Badge de recharge effective : choix du joueur, sinon règle SRD du catalogue */}
                          {(feature.counterMax ?? 0) > 0 &&
                            (() => {
                              const eff = effectiveFeatureReset(
                                feature,
                                ownerLevelOf(feature.catalogId),
                              );
                              if (eff !== 'short' && eff !== 'long') return null;
                              return (
                                <span
                                  className="self-start text-[10px] px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200"
                                  title={
                                    eff === 'short'
                                      ? t('traits.se.recharge.apres.un.repos.court.ou.long')
                                      : t('traits.se.recharge.apres.un.repos.long')
                                  }
                                >
                                  ↻{' '}
                                  {eff === 'short'
                                    ? t('traits.repos.court')
                                    : t('traits.repos.long')}
                                </span>
                              );
                            })()}

                          <span
                            className={`inline-block self-start text-[10px] px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[feature.category]}`}
                          >
                            {featureCategoryLabel(feature.category)}
                          </span>
                        </div>
                      )}
                    </SortableCard>
                  );
                })}
              </SortableGrid>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('traits.modifier.le.trait') : t('traits.nouveau.trait')}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">{t('traits.titre')}</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('traits.recuperation.arcanique')}
              autoFocus
            />
          </label>

          <label className="block">
            <span className="label">{t('traits.categorie')}</span>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as FeatureCategory)}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {featureCategoryLabel(cat)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">{t('traits.description')}</span>
            <textarea
              className="input min-h-[120px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('traits.une.fois.par.jour.lors.d')}
            />
          </label>

          {/* Charge counter (optional) */}
          <label className="block">
            <span className="label">{t('traits.compteur.de.charges.optionnel')}</span>
            <input
              type="number"
              min={0}
              className="input"
              value={counterMax}
              onChange={(e) => setCounterMax(e.target.value)}
              placeholder={t('traits.laisser.vide.pour.aucun.compteur')}
            />
            <p className="text-xs text-ink-400 mt-1">
              {t('traits.pour.les.points.de.ki.utilisations')}
              {counterMax && Number(counterMax) > 0
                ? ` ${t('traits.le.compteur.demarre.au.maximum')}`
                : ''}
            </p>
          </label>

          {/* Recharge aux repos — pour TOUS les traits à compteur : les cases sont
              pré-cochées sur la règle SRD pour un trait du catalogue, et le choix
              du joueur n'est mémorisé que s'il s'en écarte */}
          {counterMax.trim() !== '' && Number(counterMax) > 0 && (
            <div className="bg-parchment-50 rounded-lg p-3 border border-parchment-200 space-y-1.5">
              <span className="text-xs font-medium text-ink-500 block">
                {t('traits.le.compteur.se.restaure.aux.repos')}
              </span>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={resetShort}
                  onChange={(e) => {
                    setResetShort(e.target.checked);
                    if (e.target.checked) setResetLong(true); // court ⇒ long aussi
                  }}
                  className="w-4 h-4 accent-blood-600"
                />
                {t('traits.repos.court.et.donc.long')}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={resetLong}
                  onChange={(e) => {
                    setResetLong(e.target.checked);
                    if (!e.target.checked) setResetShort(false); // pas de court sans long
                  }}
                  className="w-4 h-4 accent-blood-600"
                />
                {t('traits.repos.long.uniquement')}
              </label>
              {editing?.catalogId && (
                <p className="text-[11px] text-ink-400 italic">
                  {t('traits.pre.coche.sur.la.regle.du')}
                </p>
              )}
              {!resetShort && !resetLong && (
                <p className="text-xs text-ink-400">
                  {t('traits.aucune.case.cochee.rechargement.manuel.uniquement')}
                </p>
              )}
            </div>
          )}

          {/* Live preview */}
          {description.trim() && (
            <div className="bg-parchment-100 rounded-lg p-3">
              <span className="text-xs font-medium text-ink-400 block mb-1">
                {t('traits.apercu')}
              </span>
              <p className="text-sm text-ink-700 whitespace-pre-line">
                {renderFeatureTemplate(description, character)}
              </p>
            </div>
          )}

          {/* Template help */}
          <button
            type="button"
            onClick={() => setShowTemplateHelp((s) => !s)}
            className="text-xs text-blood-600 hover:underline"
          >
            {showTemplateHelp ? '▼' : '▶'} {t('traits.variables.de.modele')}
          </button>
          {showTemplateHelp && (
            <div className="bg-parchment-50 rounded-lg p-3 border border-parchment-200">
              <p className="text-xs text-ink-500 mb-2">
                {t('traits.utilisez')}{' '}
                <code className="bg-parchment-200 px-1 rounded">{'{{variable}}'}</code>{' '}
                {t('traits.pour.inserer.une.valeur.calculee.depuis.votre')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {TEMPLATE_VARIABLES.map((v) => (
                  <div key={v.syntax} className="flex items-center gap-2 text-xs">
                    <code className="bg-parchment-200 px-1.5 py-0.5 rounded text-blood-700 font-mono shrink-0">
                      {v.syntax}
                    </code>
                    <span className="text-ink-500">
                      {TEMPLATE_VAR_KEYS[v.syntax] ? t(TEMPLATE_VAR_KEYS[v.syntax]) : v.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !title.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editing ? t('common.save') : t('traits.creer')}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              {t('traits.annuler')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Catalogue SRD (capacités par classe/niveau) ----------

function resetLabel(
  def: ClassFeatureDef,
  character: Character,
  t: (key: string) => string,
): string | null {
  if (!def.resource) return null;
  const owner = findClassFeatureClass(def.id);
  const ownerLevel = owner
    ? (classesOf(character).find((c) => findClass(c.classKey)?.name === owner)?.level ??
      character.level ??
      1)
    : (character.level ?? 1);
  const short =
    def.resource.reset === 'short' ||
    (def.resource.shortFromLevel !== undefined && ownerLevel >= def.resource.shortFromLevel);
  const unit = def.resource.unit === 'PV' ? ` ${t('sorts.pv')}` : '';
  const rest = short ? t('traits.recharge.court') : t('traits.recharge.long');
  return `${unit || t('traits.util')}${rest}`;
}

function CatalogCard({
  character,
  addedCatalogIds,
  onAdd,
}: {
  character: Character;
  addedCatalogIds: Set<string>;
  onAdd: (def: ClassFeatureDef) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ownLines = classesOf(character);
  const charClassName =
    findClass(character.characterClass)?.name ?? ownLines[0]?.classKey ?? 'Guerrier';
  const [cls, setCls] = useState(charClassName);
  const [subFilter, setSubFilter] = useState('base');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    setCls(charClassName);
    setSubFilter('base');
  }, [charClassName]);

  // Multiclassage : le verrou « acquis » se juge au niveau de LA ligne de
  // classe parcourue, pas au niveau total du personnage.
  const ownLine = ownLines.find((c) => findClass(c.classKey)?.name === cls);
  const level = ownLine?.level ?? 0;
  const isOwnClass = level > 0;
  const subclasses = CLASS_SUBCLASSES[cls] ?? [];
  const defs: ClassFeatureDef[] =
    subFilter === 'base'
      ? (CLASS_FEATURES[cls] ?? [])
      : (subclasses.find((s) => s.key === subFilter)?.features ?? []);
  const sorted = [...defs].sort((a, b) => a.level - b.level);

  // Prochaines acquisitions : une par ligne de classe (multiclassage)
  const nextGains = nextClassFeatureGains(character);

  const add = async (def: ClassFeatureDef) => {
    setAddingId(def.id);
    try {
      await onAdd(def);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-semibold text-ink-700 hover:text-blood-700 transition-colors"
          aria-expanded={open}
        >
          <span aria-hidden="true">📚</span>
          {t('traits.catalogue.de.classe')}
          <span className="text-xs font-normal text-ink-400">{open ? '▼' : '▶'}</span>
        </button>
        {nextGains.length > 0 && (
          <span className="text-[11px] text-ink-500 text-right">
            {nextGains
              .map(
                (g) =>
                  `${ownLines.length > 1 ? `${classNameLabel(g.classKey)} ` : ''}${t('traits.niveau.abrege', { level: g.nextLevel })} : ${g.features
                    .map((f) => defName(f))
                    .join(', ')}`,
              )
              .join(' — ')}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink-500">
              {t('traits.classe')}
              <select
                className="input py-1 text-xs w-auto"
                value={cls}
                onChange={(e) => {
                  setCls(e.target.value);
                  setSubFilter('base');
                }}
                aria-label={t('traits.classe.du.catalogue')}
              >
                {DND_CLASSES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {classNameLabel(c.name)}
                  </option>
                ))}
              </select>
            </label>
            {subclasses.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-ink-500">
                {t('traits.voie')}
                <select
                  className="input py-1 text-xs w-auto"
                  value={subFilter}
                  onChange={(e) => setSubFilter(e.target.value)}
                  aria-label={t('traits.sous.classe.du.catalogue')}
                >
                  <option value="base">{t('traits.classe.de.base')}</option>
                  {subclasses.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="divide-y divide-parchment-100 rounded-lg border border-parchment-200 overflow-hidden">
            {sorted.length === 0 && (
              <p className="text-xs text-ink-400 p-3">
                {t('traits.aucune.capacite.cataloguee.ici')}
              </p>
            )}
            {sorted.map((def) => {
              const added = addedCatalogIds.has(def.id);
              const locked = isOwnClass && def.level > level;
              const expanded = expandedId === def.id;
              const reset = resetLabel(def, character, t);
              return (
                <div key={def.id} className="bg-parchment-50/60">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : def.id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      aria-expanded={expanded}
                    >
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          isOwnClass && def.level <= level
                            ? 'bg-green-100 text-green-800'
                            : 'bg-parchment-200 text-ink-500'
                        }`}
                      >
                        {t('traits.niv.level', { level: def.level })}
                      </span>
                      <span className="text-sm font-medium text-ink-800 truncate">
                        {defName(def)}
                      </span>
                      {def.native && (
                        <span className="text-[10px] text-ink-400 italic shrink-0">
                          {t('traits.gere.par.la.fiche')}
                        </span>
                      )}
                      {reset && (
                        <span
                          className="text-[10px] text-blood-600 shrink-0"
                          title={
                            def.resource?.reset === 'short'
                              ? t('traits.recupere.apres.un.repos.court.ou.long')
                              : t('traits.recupere.apres.un.repos.long')
                          }
                        >
                          ↻ {reset}
                        </span>
                      )}
                    </button>
                    {added ? (
                      <span className="text-xs text-green-700 font-semibold shrink-0">
                        {t('traits.ajoute')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add(def)}
                        disabled={locked || addingId === def.id}
                        className={`text-xs px-2 py-1 rounded-lg shrink-0 transition-colors ${
                          locked
                            ? 'bg-parchment-200 text-ink-400 cursor-not-allowed'
                            : 'bg-blood-600 text-white hover:bg-blood-700 disabled:opacity-50'
                        }`}
                        title={
                          locked
                            ? t('traits.necessite.le.niveau', { level: def.level })
                            : t('traits.ajouter.aux.traits')
                        }
                      >
                        {locked
                          ? t('traits.niv.level', { level: def.level })
                          : addingId === def.id
                            ? '…'
                            : t('traits.ajouter')}
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <p className="text-xs text-ink-600 px-3 pb-2.5 leading-relaxed whitespace-pre-line">
                      {renderFeatureTemplate(defDesc(def), character)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-ink-400">{t('traits.le.compteur.se.recharge.via.les')}</p>
        </div>
      )}
    </div>
  );
}
