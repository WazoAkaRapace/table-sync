// Onglet « Sorts custom » du pupitre du MD — plan « Contenus personnalisés »
// (PR3 sorts). Topologie de CustomMonstersTab : liste cartes + Modal +
// ConfirmButton, création MD SEULE (pas de toggle). Le garde-fou de
// suppression (Q7a/position 3) vit ici : DELETE 409 → modal de conséquences
// listant les porteurs, « Supprimer » force la CASCADE (?force=1). L'aperçu
// embarqué (pied de modal) relit le damage_json construit du draft via
// spellDamageAtLevel — la même lecture que la feuille d'incantation joueur.
import {
  buildSpellDamageJson,
  expandSpellSlotTable,
  spellDamageAtLevel,
  spellHealingAtLevel,
} from '@table-sync/shared';
import type { Spell, SpellSchool } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EMPTY_SPELL_DRAFT,
  SpellFields,
  type SpellDraft,
  spellDraftFromSpell,
  spellDraftPayload,
  spellDraftValid,
} from '../../components/SpellFields';
import { TableBadge } from '../../components/TableBadge';
import { Chip, ConfirmButton, EmptyState, Fab, Modal } from '../../components/ui';
import { classNameLabel, schoolLabel } from '../../i18n/labels';
import { Glyph } from '../../components/Glyph';
import { PreviewToggle } from '../../components/PreviewToggle';
import api from '../../api';
import { usePartyContentSync } from './usePartyContentSync';

type SpellRow = Spell & { knownBy?: number };

/** damage_json de l'APERÇU : le raccourci « par cran » y est développé
 * exactement comme le serveur le fera (shared expandSpellSlotTable). */
function draftDamageJson(d: SpellDraft): string | null {
  const build = (dice: string, perSlot: string): Record<string, string> | null => {
    if (dice.trim() === '' && perSlot.trim() === '') return null;
    if (perSlot.trim() !== '' && dice.trim() !== '') {
      return expandSpellSlotTable(d.level, dice.trim(), perSlot.trim());
    }
    return dice.trim() !== '' ? { [String(d.level)]: dice.trim() } : null;
  };
  return buildSpellDamageJson({
    level: d.level,
    damageDice: d.damageDice.trim() || null,
    damageType: d.damageDice.trim() !== '' ? d.damageType : null,
    damageAtSlotLevel: build(d.damageDice, d.upcastDice),
    healDice: d.healDice.trim() || null,
    healAtSlotLevel: build(d.healDice, d.healUpcastDice),
    healAddsModifier: d.healDice.trim() !== '' && d.healAddsModifier,
    dcAbility: d.dcAbility || null,
    dcSuccess: d.dcSuccess || null,
  });
}

/** Fiche de sort en lecture — ce que la ligne de grimoire du joueur montrera. */
function SpellPreview({ draft }: { draft: SpellDraft }) {
  const { t } = useTranslation();
  const damageJson = draftDamageJson(draft);
  const spell = { level: draft.level, damageJson };
  const atNative = spellDamageAtLevel(spell, draft.level, 1);
  const atUp = draft.level < 9 ? spellDamageAtLevel(spell, draft.level + 1, 1) : null;
  const heal = spellHealingAtLevel(spell, draft.level, 1);
  const classesText =
    draft.classes.length === 13
      ? t('sortcustom.classes.toutes')
      : draft.classes.map((c) => classNameLabel(c)).join(' · ');
  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-ink-800">{draft.name.trim() || '—'}</span>
        <TableBadge label={t('sorts.de.la.table')} />
      </div>
      <p className="text-xs text-ink-500">
        {draft.level === 0 ? t('sorts.tour') : t('sorts.niveau.level', { level: draft.level })} ·{' '}
        {schoolLabel(draft.school as SpellSchool)} ·{' '}
        {draft.castingTime.trim() || t('sortcustom.incantation')} ·{' '}
        {draft.rangeText.trim() || t('sortcustom.portee')} ·{' '}
        {draft.duration.trim() || t('sortcustom.duree')}
      </p>
      <p className="text-xs text-ink-400">
        {draft.components.join(' ')}
        {draft.material.trim() ? ` (${draft.material.trim()})` : ''} · {classesText}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {draft.concentration && (
          <Chip tone="orange" soft>
            <span aria-hidden className="text-indigo-500">
              <Glyph name="concentration" />
            </span>{' '}
            {t('sortcustom.concentration')}
          </Chip>
        )}
        {draft.ritual && (
          <Chip tone="orange" soft>
            {t('sortcustom.rituel')}
          </Chip>
        )}
        {atNative.dice && (
          <Chip tone="gold">
            ⚔ {atNative.dice} {atNative.typeFr}
          </Chip>
        )}
        {atUp?.dice && atUp.dice !== atNative.dice && (
          <Chip tone="gold" title={t('sortcustom.upcast')}>
            {t('sorts.niv.level', { level: draft.level + 1 })} : {atUp.dice}
          </Chip>
        )}
        {heal.dice && (
          <Chip tone="green" soft>
            ✚ {heal.dice}
            {heal.addsModifier ? ` ${t('sortcustom.soins.mod')}` : ''}
          </Chip>
        )}
        {draft.dcAbility && draft.dcSuccess && (
          <Chip tone="orange" soft>
            {t('sortcustom.dd.apercu', {
              ability: draft.dcAbility.toUpperCase(),
              effet: t(`sortcustom.dd.effet.${draft.dcSuccess}`),
            })}
          </Chip>
        )}
      </div>
    </div>
  );
}

export function CustomSpellsTab({ partyId }: { partyId: string }) {
  const { t } = useTranslation();
  const [spells, setSpells] = useState<SpellRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<SpellDraft>(EMPTY_SPELL_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Aperçu embarqué repliable (pied de modal) — recalcule à chaque ouverture. */
  const [previewOpen, setPreviewOpen] = useState(true);
  /** Avertissement d'homonymie SRD (non bloquant, recherche exacte côté client). */
  const [srdConflict, setSrdConflict] = useState(false);
  /** Modal de conséquences : personnages qui connaissent le sort. */
  const [deleteTarget, setDeleteTarget] = useState<{
    spell: SpellRow;
    knownBy: {
      characterId: number;
      name: string;
      className: string | null;
      level: number | null;
    }[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/spells', {
        params: { partyId, source: 'custom', limit: 200 },
      });
      setSpells(res.data.spells || []);
    } catch {
      setSpells([]);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  usePartyContentSync(partyId, 'custom-spell', load);

  // Homonymie SRD : recherche exacte débouncée sur le catalogue global (un
  // custom peut homonymier un SRD — avertissement, jamais un blocage).
  useEffect(() => {
    const name = draft.name.trim();
    if (!showModal || editingId !== null || name.length < 2) {
      setSrdConflict(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api
        .get('/api/spells', { params: { search: name, limit: 10 } })
        .then((res) => {
          if (!alive) return;
          const hits: { name: string }[] = res.data.spells ?? [];
          setSrdConflict(hits.some((s) => s.name.toLowerCase() === name.toLowerCase()));
        })
        .catch(() => {
          if (alive) setSrdConflict(false);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [draft.name, showModal, editingId]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_SPELL_DRAFT);
    setError('');
    setSrdConflict(false);
    setPreviewOpen(true);
    setShowModal(true);
  };

  const openEdit = async (id: number) => {
    setError('');
    try {
      const res = await api.get(`/api/spells/${id}`);
      setEditingId(id);
      setDraft(spellDraftFromSpell(res.data.spell));
      setPreviewOpen(true);
      setShowModal(true);
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const payload = spellDraftPayload(draft);
    try {
      if (editingId) {
        await api.patch(`/api/spells/${editingId}`, payload);
      } else {
        await api.post(`/api/parties/${partyId}/spells`, payload);
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (spell: SpellRow) => {
    setError('');
    try {
      await api.delete(`/api/spells/${spell.id}`);
      await load();
    } catch (err: any) {
      if (err.response?.status === 409 && Array.isArray(err.response?.data?.knownBy)) {
        // Garde-fou Q7a : le serveur liste les porteurs — le MD tranche en
        // connaissance de cause (Supprimer force la CASCADE des liens).
        setDeleteTarget({ spell, knownBy: err.response.data.knownBy });
      } else {
        setError(err.response?.data?.error || t('md.erreur'));
      }
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/spells/${deleteTarget.spell.id}?force=1`);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setDeleteTarget(null);
      setError(err.response?.data?.error || t('md.erreur'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title">{t('md.sorts.custom.n', { count: spells.length })}</h3>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          {t('md.ajouter')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-400 animate-pulse">{t('md.chargement')}</p>
      ) : spells.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<Glyph name="spark" />}
            title={t('md.aucun.sort.custom')}
            hint={t('md.cree.des.sorts.non.srd')}
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {spells.map((s) => (
            <li key={s.id} className="card p-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 max-w-full truncate font-medium text-ink-800">
                    {s.name}
                  </span>
                  <span className="text-xs text-ink-400">
                    {s.level === 0 ? t('sorts.tour') : t('sorts.niv.level', { level: s.level })} ·{' '}
                    {schoolLabel(s.school)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  {s.concentration && (
                    <span className="text-xs text-indigo-500" title={t('sortcustom.concentration')}>
                      <Glyph name="concentration" />
                    </span>
                  )}
                  {s.ritual && (
                    <span className="text-xs text-ink-400">{t('sortcustom.rituel')}</span>
                  )}
                  {(s.knownBy ?? 0) > 0 && (
                    <span className="text-xs text-ink-400">
                      {t('md.connu.par.n', { count: s.knownBy })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(s.id)}
                  className="text-ink-400 hover:text-blood-500 text-sm p-1"
                  aria-label={t('md.modifier')}
                >
                  <Glyph name="edit" />
                </button>
                <ConfirmButton
                  onConfirm={() => remove(s)}
                  className="text-ink-400 hover:text-red-700 text-sm p-1 rounded-full transition-colors"
                  armedClassName="bg-red-600 hover:brightness-90 text-white! px-2.5 py-1 font-semibold"
                  title={t('md.supprimer.sort.name', { name: s.name })}
                  ariaLabel={t('md.supprimer.sort.name', { name: s.name })}
                  confirmChildren={t('md.supprimer.confirmer')}
                >
                  ×
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="text-red-700 text-sm">{error}</div>}

      {spells.length > 0 && (
        <Fab onClick={openCreate} label={t('md.ajouter.un.sort.personnalise')} mobileOnly />
      )}

      {/* Create/Edit modal : formulaire + aperçu embarqué (pied de modal). */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? t('sortcustom.modifier') : t('sortcustom.nouveau')}
      >
        <div className="space-y-3">
          <SpellFields draft={draft} onChange={setDraft} />
          {srdConflict && (
            <p className="text-xs text-orange-700" role="note">
              {t('sortcustom.conflit.srd')}
            </p>
          )}
          {error && <div className="text-red-700 text-sm">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !spellDraftValid(draft)}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editingId ? t('common.save') : t('md.ajouter.au.grimoire')}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost text-ink-700"
            >
              {t('md.annuler')}
            </button>
          </div>
          <div className="pt-2 border-t border-parchment-200">
            <div className="flex items-center justify-between gap-2">
              <span className="section-title">{t('sortcustom.apercu')}</span>
              <PreviewToggle open={previewOpen} onToggle={() => setPreviewOpen((v) => !v)} />
            </div>
            {previewOpen ? (
              // Pas de scroll imbriqué : la fiche vit dans LE scroll de la
              // modale (même correction que l'aperçu monstre).
              <div className="mt-2">
                <SpellPreview draft={draft} />
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Modal de conséquences : suppression avec porteurs (CASCADE forcée). */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('md.supprimer.sort.name', { name: deleteTarget?.spell.name ?? '' })}
      >
        {deleteTarget && (
          <div className="space-y-3">
            <p className="text-sm text-ink-700">{t('md.sort.connu.par')}</p>
            <ul className="space-y-1">
              {deleteTarget.knownBy.map((c) => (
                <li key={c.characterId} className="text-sm text-ink-600">
                  • {c.name}
                  {c.className ? ` (${classNameLabel(c.className)} ${c.level ?? 1})` : ''}
                </li>
              ))}
            </ul>
            <p className="text-sm text-orange-800" role="note">
              {t('md.sort.supprime.fiches')}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={confirmDelete}
                className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
              >
                {t('md.supprimer.confirmer')}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="btn-secondary flex-1"
              >
                {t('md.annuler')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
