// Onglet « Monstres custom » du pupitre du MD — plan « Contenus
// personnalisés » (PR monstres). Topologie de CustomItemsTab (liste cartes +
// Modal + ConfirmButton) sans le toggle joueur : création MD SEULE. Le
// garde-fou de suppression (Q6a) vit ici — DELETE 409 → modal de
// conséquences listant les rencontres vivantes.
import type { Monster, MonsterSummary } from '@table-sync/shared';
import { formatCR } from '@table-sync/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EMPTY_MONSTER_DRAFT,
  MonsterFields,
  type MonsterDraft,
  monsterDraftFromMonster,
  monsterDraftPayload,
  monsterDraftValid,
} from '../../components/MonsterFields';
import MonsterStatBlock from '../../components/MonsterStatBlock';
import { ConfirmButton, EmptyState, Fab, Modal } from '../../components/ui';
import { monsterSizeLabel } from '../../i18n/labels';
import { Glyph } from '../../components/Glyph';
import { PreviewToggle } from '../../components/PreviewToggle';
import api from '../../api';
import { usePartyContentSync } from './usePartyContentSync';

/** Bloc de stats DÉRIVÉ du draft — l'aperçu embarqué rend la vraie fiche. */
function draftToMonster(draft: MonsterDraft): Monster {
  const payload = monsterDraftPayload(draft);
  const abilities = { ...payload.abilities };
  return {
    slug: 'preview',
    name: draft.nameFr.trim() || '—',
    type: draft.type,
    subtype: null,
    size: draft.size,
    alignment: draft.alignment.trim() || null,
    armorClass: Number(draft.armorClass) || 10,
    armorDesc: draft.armorDesc.trim() || null,
    hitPoints: Number(draft.hitPoints) || 1,
    hitDice: draft.hitDice.trim() || null,
    speed: payload.speed as Monster['speed'],
    abilities: {
      for: abilities.for ?? 10,
      dex: abilities.dex ?? 10,
      con: abilities.con ?? 10,
      int: abilities.int ?? 10,
      sag: abilities.sag ?? 10,
      cha: abilities.cha ?? 10,
    },
    savingThrows: [],
    skills: [],
    languages: draft.languages
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean),
    challengeRating: draft.challengeRating,
    xp: 0,
    senses: draft.senses.trim() || null,
    telepathy: null,
    damageResistances: draft.damageResistances.length ? draft.damageResistances : null,
    damageImmunities: draft.damageImmunities.length ? draft.damageImmunities : null,
    conditionImmunities: draft.conditionImmunities.length ? draft.conditionImmunities : null,
    traits: draft.traits
      .filter((e) => e.name.trim() && e.text.trim())
      .map((e) => ({ name: e.name, desc: e.text })),
    actions: draft.actions
      .filter((e) => e.name.trim() && e.text.trim())
      .map((e) => ({ name: e.name, desc: e.text })),
    legendaryActions: [],
    origin: 'custom',
  };
}

export function CustomMonstersTab({ partyId }: { partyId: string }) {
  const { t } = useTranslation();
  const [monsters, setMonsters] = useState<MonsterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<MonsterDraft>(EMPTY_MONSTER_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Aperçu embarqué repliable (pied de modal) — recalcule à chaque ouverture. */
  const [previewOpen, setPreviewOpen] = useState(true);
  /** Modal de conséquences : rencontres vivantes qui référencent le monstre. */
  const [blockedBy, setBlockedBy] = useState<{
    name: string;
    encounters: { id: number; name: string; status: string }[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/monsters', {
        params: { partyId, origin: 'custom', limit: 100 },
      });
      setMonsters(res.data.monsters || []);
    } catch {
      setMonsters([]);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  usePartyContentSync(partyId, 'custom-monster', load);

  const openCreate = () => {
    setEditingSlug(null);
    setDraft(EMPTY_MONSTER_DRAFT);
    setError('');
    setPreviewOpen(true);
    setShowModal(true);
  };

  const openEdit = async (slug: string) => {
    setError('');
    try {
      const res = await api.get(`/api/monsters/${slug}`);
      setEditingSlug(slug);
      setDraft(monsterDraftFromMonster(res.data.monster));
      setPreviewOpen(true);
      setShowModal(true);
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const payload = monsterDraftPayload(draft);
    try {
      if (editingSlug) {
        await api.patch(`/api/monsters/${editingSlug}`, payload);
      } else {
        await api.post(`/api/parties/${partyId}/monsters`, payload);
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || t('md.erreur'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: MonsterSummary) => {
    setError('');
    try {
      await api.delete(`/api/monsters/${m.slug}`);
      await load();
    } catch (err: any) {
      if (err.response?.status === 409 && Array.isArray(err.response?.data?.encounters)) {
        // Garde-fou Q6a : le serveur liste les rencontres vivantes — le MD
        // doit les vider d'abord, la suppression reste impossible ici.
        setBlockedBy({ name: m.name, encounters: err.response.data.encounters });
      } else {
        setError(err.response?.data?.error || t('md.erreur'));
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-title">{t('md.monstres.custom.n', { count: monsters.length })}</h3>
        <button type="button" onClick={openCreate} className="btn-primary text-sm px-3 py-1.5">
          {t('md.ajouter')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-400 animate-pulse">{t('md.chargement')}</p>
      ) : monsters.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<Glyph name="spark" />}
            title={t('md.aucun.monstre.custom')}
            hint={t('md.dresse.tes.monstres')}
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {monsters.map((m) => (
            <li key={m.slug} className="card p-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 max-w-full truncate font-medium text-ink-800">
                    {m.name}
                  </span>
                  <span className="text-xs text-ink-400">
                    {m.type.toLowerCase()} · {monsterSizeLabel(m.size)} · FP{' '}
                    {formatCR(m.challengeRating)}
                    {m.xp ? ` (${m.xp.toLocaleString('fr-FR')} PX)` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="text-xs text-ink-500 flex items-center gap-1">
                    <Glyph name="shield" /> {m.armorClass}
                  </span>
                  <span className="text-xs text-ink-500 flex items-center gap-1">
                    <Glyph name="heart" /> {m.hitPoints}
                    {m.hitDice ? ` (${m.hitDice})` : ''}
                  </span>
                  {(m.encounterCount ?? 0) > 0 && (
                    <span className="text-xs text-ink-400">
                      {t('md.dans.rencontres.n', { count: m.encounterCount })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(m.slug)}
                  className="text-ink-400 hover:text-blood-500 text-sm p-1"
                  aria-label={t('md.modifier')}
                >
                  <Glyph name="edit" />
                </button>
                <ConfirmButton
                  onConfirm={() => remove(m)}
                  className="text-ink-400 hover:text-red-700 text-sm p-1 rounded-full transition-colors"
                  armedClassName="bg-red-600 hover:brightness-90 text-white! px-2.5 py-1 font-semibold"
                  title={t('md.supprimer.monstre.name', { name: m.name })}
                  ariaLabel={t('md.supprimer.monstre.name', { name: m.name })}
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

      {monsters.length > 0 && (
        <Fab onClick={openCreate} label={t('md.ajouter.un.monstre.personnalise')} mobileOnly />
      )}

      {/* Create/Edit modal : formulaire + aperçu embarqué (pied de modal). */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingSlug ? t('monstrecustom.modifier') : t('monstrecustom.nouveau')}
      >
        <div className="space-y-3">
          <MonsterFields draft={draft} onChange={setDraft} />
          {editingSlug && (
            <p className="text-xs text-ink-400" role="note">
              {t('md.edition.snapshot.aide')}
            </p>
          )}
          {error && <div className="text-red-700 text-sm">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !monsterDraftValid(draft)}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? '…' : editingSlug ? t('common.save') : t('md.ajouter.au.bestiaire')}
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
              <span className="section-title">{t('monstrecustom.apercu')}</span>
              <PreviewToggle open={previewOpen} onToggle={() => setPreviewOpen((v) => !v)} />
            </div>
            {previewOpen ? (
              // Pas de scroll imbriqué : le bloc vit dans LE scroll de la
              // modale (un max-h interne + overscroll-contain piègeait le
              // doigt sur iPad et tronquait le bloc au ras de l'écran).
              <div className="mt-2 rounded-xl">
                <MonsterStatBlock
                  open={showModal}
                  slug={null}
                  monsterOverride={draftToMonster(draft)}
                  onClose={() => setPreviewOpen(false)}
                  hideClose
                  variant="panel"
                />
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Modal de conséquences : suppression bloquée par des rencontres vivantes. */}
      <Modal
        open={blockedBy !== null}
        onClose={() => setBlockedBy(null)}
        title={t('md.supprimer.monstre.name', { name: blockedBy?.name ?? '' })}
      >
        {blockedBy && (
          <div className="space-y-3">
            <p className="text-sm text-ink-700">{t('md.monstre.utilise.par')}</p>
            <ul className="space-y-1">
              {blockedBy.encounters.map((e) => (
                <li key={e.id} className="text-sm text-ink-600">
                  • {e.name}{' '}
                  <span className="text-xs text-ink-400">
                    (
                    {e.status === 'active'
                      ? t('md.rencontre.en.cours')
                      : t('md.rencontre.preparation')}
                    )
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-orange-800" role="note">
              {t('md.monstre.suppression.bloquee')}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setBlockedBy(null)}
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
