/**
 * Sorts tab — « Grimoire en ordre de bataille » :
 * bandeau de lanceur (DD/attaque/carac), rail d'emplacements à perles,
 * liste par niveau avec écho d'emplacements et filtre Préparés, grimoire.
 */

import {
  type ABILITY_SHORT_FR,
  abilityModifier,
  type Character,
  type CharacterSpell,
  classesOf,
  computeSpellcastingPools,
  DND_CLASSES,
  findClass,
  formatModifier,
  preparedLimits,
  proficiencyBonus,
  SPELL_SCHOOL_LABELS_FR,
  type Spell,
  type SpellSchool,
  spellDamageAtLevel,
  spellHealingAtLevel,
  spellSaveDC,
} from '@table-sync/shared';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import CastSpellSheet from '../components/CastSpellSheet';
import { BottomSheet, Chip, ErrorMsg } from '../components/ui';
import { abilityShort, classNameLabel, damageType, schoolLabel } from '../i18n/labels';

interface Props {
  character: Character;
  charId: number;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}

type DomainSpell = Spell & { domainLevel: number };

const PAGE_SIZE = 30;

// School identity: a drawn ink-dot on rows (scan level) + matching label tint
// in the expanded detail. Same hues as before, deepened for the parchment ground.
const SCHOOL_DOT: Record<string, string> = {
  abjuration: 'bg-blue-600',
  conjuration: 'bg-amber-500',
  divination: 'bg-purple-600',
  enchantment: 'bg-pink-600',
  evocation: 'bg-red-600',
  illusion: 'bg-gray-500',
  necromancy: 'bg-green-700',
  transmutation: 'bg-orange-600',
};

const SCHOOL_TEXT: Record<string, string> = {
  abjuration: 'text-blue-700',
  conjuration: 'text-amber-700',
  divination: 'text-purple-700',
  enchantment: 'text-pink-700',
  evocation: 'text-red-700',
  illusion: 'text-gray-600',
  necromancy: 'text-green-700',
  transmutation: 'text-orange-700',
};

export default function CharacterSpellsTab({ character, charId, onSaved, onError }: Props) {
  const { t } = useTranslation();
  const [charSpells, setCharSpells] = useState<CharacterSpell[]>([]);
  const [loadingSpells, setLoadingSpells] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [domainSpells, setDomainSpells] = useState<DomainSpell[]>([]);

  // Catalog browser
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [catalogLevel, setCatalogLevel] = useState<string>('');
  const [catalogSchool, setCatalogSchool] = useState<string>('');
  const [catalogClass, setCatalogClass] = useState<string>(
    // Multiclassage : UNION des listes de sorts des classes de la fiche.
    classesOf(character)
      .map((c) => c.classKey)
      .join(','),
  );
  const [catalogSpells, setCatalogSpells] = useState<Spell[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [addingSpellId, setAddingSpellId] = useState<number | null>(null);

  // Expanded spell detail (by character_spell link id or catalog spell id)
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Casting: the spell currently in the cast sheet, and the row it came from
  // (row id drives the post-cast flash)
  const [castingSpell, setCastingSpell] = useState<Spell | null>(null);
  const [castingRowId, setCastingRowId] = useState<number | null>(null);

  // List filter for prepared-spell classes: all spells or the combat-ready set
  const [listFilter, setListFilter] = useState<string>('all');

  // Post-cast feedback: row flash (row-flash animation, cleared after 1.3 s)
  const [flashRowId, setFlashRowId] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two-step « Oublier » confirm (4 s auto-revert, same pattern as inventory)
  const [confirmForgetId, setConfirmForgetId] = useState<number | null>(null);
  const forgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (forgetTimer.current) clearTimeout(forgetTimer.current);
    },
    [],
  );

  const flashRow = (rowId: number | null) => {
    if (!rowId) return;
    setFlashRowId(rowId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashRowId(null), 1300);
  };

  const armForget = (linkId: number) => {
    setConfirmForgetId(linkId);
    if (forgetTimer.current) clearTimeout(forgetTimer.current);
    forgetTimer.current = setTimeout(() => setConfirmForgetId(null), 4000);
  };

  const cancelForget = () => {
    setConfirmForgetId(null);
    if (forgetTimer.current) clearTimeout(forgetTimer.current);
  };

  // Multiclassage (SRD 5.1) : deux pools — Incantation (table de
  // l'incantateur multiclassé) et Magie de pacte (Occultiste, recharge au
  // repos court). Une fiche mono-classe garde UN rail, sans étiquette.
  const pools = computeSpellcastingPools(character);
  const slots = pools.spellcasting;
  const pactSlots = pools.pact;
  const showSpellRail = slots.some((n) => n > 0);
  const showPactRail = pools.hasPact;
  const railsLabeled = showSpellRail && showPactRail;
  const isCaster = showSpellRail || showPactRail;

  const level = character.level ?? 1;
  const profBonus = proficiencyBonus(level);
  const slotsUsed = character.spellSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const pactUsed = character.pactSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Une ligne de lanceur par classe incantatrice : DD et attaque par classe
  // (chaque sort suit la caractéristique de SA classe — SRD multiclassage).
  const castingLines = classesOf(character)
    .map((entry) => {
      const info = findClass(entry.classKey);
      if (!info?.spellcastingAbility) return null;
      const score = (character[info.spellcastingAbility as keyof Character] as number) ?? 10;
      const mod = abilityModifier(score);
      return {
        name: info.name,
        ability: info.spellcastingAbility,
        mod,
        dc: spellSaveDC(mod, profBonus),
        atk: formatModifier(mod + profBonus),
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const firstCasting = castingLines[0] ?? null;
  const castingMod = firstCasting?.mod ?? 0;
  const modForSpell = (classSource: string | null): number => {
    if (!classSource) return castingMod;
    return castingLines.find((l) => l.name === classSource)?.mod ?? castingMod;
  };
  const isMultiClass = classesOf(character).length > 1;

  // Limites de préparation PAR CLASSE (chacune comme si mono-classe — SRD
  // multiclassage) ; les sorts de domaine restent toujours préparés et hors
  // limite. Chaque segment du filtre porte le compteur de sa classe.
  const limits = preparedLimits(character);
  const domainIds = new Set(domainSpells.map((sp) => sp.id));
  const preparedCountFor = (classKey: string) =>
    charSpells.filter(
      (cs) => cs.prepared && !domainIds.has(cs.spell.id) && cs.classSource === classKey,
    ).length;

  // Fetch character's known spells
  const fetchCharSpells = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await api.get(`/api/characters/${charId}/spells`);
      // API returns { spells: CharacterSpell[] } — extract the array
      const data = res.data?.spells ?? res.data ?? [];
      setCharSpells(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingSpells(false);
    }
  }, [charId]);

  useEffect(() => {
    fetchCharSpells();
  }, [fetchCharSpells]);

  // Always-prepared bonus spells: cleric domain, druid circle terrain,
  // paladin oath (derived — refetched with the character)
  const hasBonusSource = classesOf(character).some((c) => {
    if (c.classKey === 'Clerc') return !!c.subclassKey;
    if (c.classKey === 'Druide') return c.subclassKey === 'terre' && !!character.landCircle;
    if (c.classKey === 'Paladin') return !!c.subclassKey;
    return false;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: character.level is a deliberate extra dep — domain spells are refetched on level-up.
  useEffect(() => {
    if (!hasBonusSource) {
      setDomainSpells([]);
      return;
    }
    let alive = true;
    api
      .get(`/api/characters/${charId}/domain-spells`)
      .then((res) => {
        if (alive) setDomainSpells(res.data.spells ?? []);
      })
      .catch(() => {
        if (alive) setDomainSpells([]);
      });
    return () => {
      alive = false;
    };
  }, [hasBonusSource, charId, character.level]);

  // Debounce search input (same pattern as items catalog)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(catalogSearch), 300);
    return () => clearTimeout(t);
  }, [catalogSearch]);

  // Fetch catalog with filters
  const fetchCatalog = useCallback(
    async (offset = 0) => {
      setCatalogLoading(true);
      setCatalogError(false);
      try {
        const params: Record<string, string | number> = { limit: PAGE_SIZE, offset };
        if (catalogClass) params.class = catalogClass;
        if (catalogLevel !== '') params.level = catalogLevel;
        if (catalogSchool) params.school = catalogSchool;
        if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
        const res = await api.get('/api/spells', { params });
        setCatalogSpells(res.data.spells);
        setCatalogTotal(res.data.total);
        setCatalogOffset(offset);
      } catch {
        setCatalogSpells([]);
        setCatalogTotal(0);
        setCatalogError(true);
      } finally {
        setCatalogLoading(false);
      }
    },
    [catalogClass, catalogLevel, catalogSchool, debouncedSearch],
  );

  // Only fetch when there's a search query or active filters — don't preload all spells
  const hasQuery = !!(
    debouncedSearch.trim() ||
    catalogLevel !== '' ||
    catalogSchool ||
    catalogClass
  );

  useEffect(() => {
    if (hasQuery) {
      fetchCatalog(0);
    } else {
      setCatalogSpells([]);
      setCatalogTotal(0);
    }
  }, [fetchCatalog, hasQuery]);

  const addSpell = async (spellId: number) => {
    setAddingSpellId(spellId);
    // Classe d'origine : le filtre actif du grimoire s'il désigne UNE classe
    // de la fiche, sinon la première classe incantatrice (multiclassage).
    const own = classesOf(character);
    const source =
      own.length === 1
        ? own[0].classKey
        : catalogClass && own.some((c) => c.classKey === catalogClass)
          ? catalogClass
          : (firstCasting?.name ?? own[0]?.classKey ?? null);
    try {
      await api.post(`/api/characters/${charId}/spells`, { spellId, classSource: source });
      await fetchCharSpells();
      await onSaved();
    } catch (err) {
      onError(
        err instanceof Error && err.message.includes('UNIQUE')
          ? t('sorts.sort.deja.connu')
          : t('sorts.erreur.lors.de.l.ajout.du.sort'),
      );
    } finally {
      setAddingSpellId(null);
    }
  };

  const removeSpell = async (linkId: number) => {
    cancelForget();
    try {
      await api.delete(`/api/character-spells/${linkId}`);
      if (expandedId === linkId) setExpandedId(null);
      await fetchCharSpells();
      await onSaved();
    } catch {
      onError(t('sorts.erreur.lors.de.la.suppression'));
    }
  };

  const togglePrepared = async (linkId: number, prepared: boolean) => {
    try {
      await api.patch(`/api/character-spells/${linkId}`, { prepared: !prepared });
      await fetchCharSpells();
    } catch {
      onError(t('sorts.erreur.de.mise.a.jour'));
    }
  };

  const spendSlot = async (spellLevel: number) => {
    // spellLevel is 1-9 (index 0 = level 1)
    const idx = spellLevel - 1;
    const used = [...slotsUsed];
    if (used[idx] >= slots[idx]) return;
    used[idx] = used[idx] + 1;
    try {
      await api.patch(`/api/characters/${charId}`, { spellSlotsUsed: used });
      await onSaved();
    } catch {
      onError(t('sorts.erreur.de.mise.a.jour'));
    }
  };

  const restoreSlot = async (spellLevel: number) => {
    const idx = spellLevel - 1;
    const used = [...slotsUsed];
    if (used[idx] <= 0) return;
    used[idx] = used[idx] - 1;
    try {
      await api.patch(`/api/characters/${charId}`, { spellSlotsUsed: used });
      await onSaved();
    } catch {
      onError(t('sorts.erreur.de.mise.a.jour'));
    }
  };

  const spendPact = async (level: number) => {
    const idx = level - 1;
    const used = [...pactUsed];
    if (used[idx] >= pactSlots[idx]) return;
    used[idx] = used[idx] + 1;
    try {
      await api.patch(`/api/characters/${charId}`, { pactSlotsUsed: used });
      await onSaved();
    } catch {
      onError(t('sorts.erreur.de.mise.a.jour'));
    }
  };

  const restorePact = async (level: number) => {
    const idx = level - 1;
    const used = [...pactUsed];
    if (used[idx] <= 0) return;
    used[idx] = used[idx] - 1;
    try {
      await api.patch(`/api/characters/${charId}`, { pactSlotsUsed: used });
      await onSaved();
    } catch {
      onError(t('sorts.erreur.de.mise.a.jour'));
    }
  };

  const restoreAll = async () => {
    try {
      await api.patch(`/api/characters/${charId}`, {
        spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        pactSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      });
      await onSaved();
    } catch {
      onError(t('sorts.erreur.de.mise.a.jour'));
    }
  };

  /**
   * Cast a spell: consume the CHOSEN slot (level + pool — SRD magie de pacte :
   * les deux pools sont interchangeables et c'est le joueur qui choisit) or
   * none for a ritual/cantrip, and for concentration spells take over the
   * concentration flag (breaking any spell already concentrated on).
   * On success the cast row flashes; on network error the sheet stays open.
   */
  const castSpell = async (castLevel: number, ritual = false, pool?: 'spellcasting' | 'pact') => {
    if (!castingSpell) return;
    const rowId = castingRowId;
    const fields: Record<string, unknown> = {};
    if (castLevel > 0 && !ritual) {
      const spendSpellcasting = () => {
        if (slotsUsed[castLevel - 1] >= (slots[castLevel - 1] ?? 0)) return false;
        const used = [...slotsUsed];
        used[castLevel - 1] = used[castLevel - 1] + 1;
        fields.spellSlotsUsed = used;
        return true;
      };
      const spendPact = () => {
        const pi = pactSlots.findIndex((max, i) => i + 1 >= castLevel && pactUsed[i] < max);
        if (pi < 0) return false;
        const used = [...pactUsed];
        used[pi] = used[pi] + 1;
        fields.pactSlotsUsed = used;
        return true;
      };
      // Pool explicite depuis la feuille d'incantation ; sans précision
      // (appels hérités) : incantation d'abord, pacte en repli.
      const okSpend =
        pool === 'pact'
          ? spendPact()
          : pool === 'spellcasting'
            ? spendSpellcasting()
            : spendSpellcasting() || spendPact();
      if (!okSpend) return;
    }
    if (castingSpell.concentration) fields.concentrating = true;
    let ok = true;
    if (Object.keys(fields).length > 0) {
      try {
        await api.patch(`/api/characters/${charId}`, fields);
        await onSaved();
      } catch {
        ok = false;
        onError(t('sorts.erreur.lors.du.lancement'));
      }
    }
    if (ok) {
      flashRow(rowId);
      setCastingSpell(null);
      setCastingRowId(null);
    }
  };

  const startCast = (spell: Spell, rowId: number | null) => {
    setCastingSpell(spell);
    setCastingRowId(rowId);
  };

  // Group spells by level — prepared spells first, then alphabetical.
  // Domain spells (not already in the spellbook) join as always-prepared rows.
  // « Préparés » keeps cantrips (always castable) plus prepared/domain spells.
  const knownIds = new Set(charSpells.map((cs) => cs.spell.id));
  const domainOnly: CharacterSpell[] = domainSpells
    .filter((sp) => !knownIds.has(sp.id))
    .map((sp) => ({
      id: 1_000_000 + sp.id, // synthetic link id, never in the DB
      characterId: Number(charId),
      spell: sp,
      prepared: true,
      classSource: null,
      sortOrder: 0,
      addedAt: '',
    }));
  const allRows = [...charSpells, ...domainOnly];
  // Filtre « Préparés » PAR CLASSE (multiclassage) : tours de magie, sorts de
  // domaine et sorts préparés de la classe choisie.
  const prepFilterClass = listFilter.startsWith('prep:') ? listFilter.slice(5) : null;
  const visibleRows =
    prepFilterClass !== null
      ? allRows.filter(
          (cs) =>
            cs.spell.level === 0 ||
            domainIds.has(cs.spell.id) ||
            (cs.prepared && (cs.classSource ?? firstCasting?.name) === prepFilterClass),
        )
      : allRows;
  const spellsByLevel = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((lvl) => ({
      level: lvl,
      spells: visibleRows
        .filter((cs) => cs.spell.level === lvl)
        .sort(
          (a, b) =>
            Number(b.prepared) - Number(a.prepared) ||
            (a.spell.name ?? a.spell.name).localeCompare(b.spell.name ?? b.spell.name, 'fr'),
        ),
    }))
    .filter((g) => g.spells.length > 0);

  if (!isCaster && charSpells.length === 0) {
    return (
      <div className="card p-8 text-center space-y-3">
        <p className="text-4xl">✨</p>
        <p className="text-ink-500">{t('sorts.cette.classe.ne.lance.pas.de')}</p>
        <p className="text-xs text-ink-400">{t('sorts.definissez.une.classe.de.lanceur.de')}</p>
      </div>
    );
  }

  // Shared catalog props
  const catalogProps = {
    spells: catalogSpells,
    total: catalogTotal,
    loading: catalogLoading,
    error: catalogError,
    offset: catalogOffset,
    search: catalogSearch,
    level: catalogLevel,
    school: catalogSchool,
    selectedClass: catalogClass,
    addingSpellId,
    knownSpellIds: new Set(charSpells.map((cs) => cs.spell.id)),
    castingMod,
    profBonus,
    isCaster,
    charLevel: level,
    onSearch: setCatalogSearch,
    onLevel: setCatalogLevel,
    onSchool: setCatalogSchool,
    onClass: setCatalogClass,
    onAdd: addSpell,
    onRetry: () => fetchCatalog(catalogOffset),
    onLoadMore: () => fetchCatalog(catalogOffset + PAGE_SIZE),
  };

  return (
    <div className="space-y-4">
      {/* Caster resources: save DC line + slot rail */}
      {isCaster && (
        <section className="card p-4 sm:p-5 space-y-2.5" data-tuto="sorts-emplacements">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title">{t('sorts.emplacements.de.sort')}</h2>
            <button
              type="button"
              onClick={restoreAll}
              className="text-xs text-blood-600 hover:underline px-1.5 py-1.5 -mr-1.5"
            >
              {t('sorts.restaurer.tout')}
            </button>
          </div>
          {castingLines.length > 0 &&
            (castingLines.length === 1 ? (
              <p className="text-xs text-ink-500">
                {t('sorts.dd')}{' '}
                <span className="font-mono font-semibold">{castingLines[0].dc}</span> ·{' '}
                {t('sorts.attaque')}{' '}
                <span className="font-mono font-semibold">{castingLines[0].atk}</span> ·{' '}
                {abilityShort(castingLines[0].ability)}
              </p>
            ) : (
              <p className="text-xs text-ink-500 leading-relaxed">
                {castingLines
                  .map(
                    (l) =>
                      `${classNameLabel(l.name)} : ${t('sorts.dd')} ${l.dc} · ${t('sorts.att')} ${l.atk} · ${abilityShort(l.ability)}`,
                  )
                  .join(' — ')}
              </p>
            ))}
          {showSpellRail && (
            <SlotRail
              slots={slots}
              slotsUsed={slotsUsed}
              onSpend={spendSlot}
              onRestore={restoreSlot}
              label={railsLabeled ? t('sorts.incantation') : null}
            />
          )}
          {showPactRail && (
            <SlotRail
              slots={pactSlots}
              slotsUsed={pactUsed}
              onSpend={spendPact}
              onRestore={restorePact}
              label={railsLabeled ? t('sorts.magie.de.pacte') : null}
              tone="gold"
              note={t('sorts.recharge.au.repos.court')}
            />
          )}
        </section>
      )}

      {/* Two-column layout on desktop: known spells (left) + catalog (right) */}
      <div className="grid lg:grid-cols-[3fr_2fr] gap-4 items-start min-w-0">
        {/* Known spells */}
        <section className="card p-4 sm:p-5 space-y-3 min-w-0" data-tuto="sorts-connus">
          <div className="flex items-center justify-between">
            <h2 className="section-title flex items-center gap-2">
              {t('sorts.sorts.connus')}{' '}
              <span className="text-ink-400 text-sm font-normal">({charSpells.length})</span>
            </h2>
            {/* Mobile: open catalog as bottom sheet */}
            <button
              type="button"
              onClick={() => setCatalogOpen(true)}
              className="btn-primary text-sm px-3 py-1.5 lg:hidden"
            >
              {t('sorts.ajouter')}
            </button>
          </div>

          {limits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setListFilter('all')}
                aria-pressed={listFilter === 'all'}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  listFilter === 'all'
                    ? 'bg-blood-600 text-white'
                    : 'bg-parchment-100 text-ink-600 hover:bg-parchment-200'
                }`}
              >
                {t('sorts.tous')}
              </button>
              {limits.map((l) => {
                const count = preparedCountFor(l.classKey);
                const over = count > l.limit;
                const active = listFilter === `prep:${l.classKey}`;
                return (
                  <button
                    key={l.classKey}
                    type="button"
                    onClick={() => setListFilter(active ? 'all' : `prep:${l.classKey}`)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium tabular-nums transition-colors ${
                      active
                        ? over
                          ? 'bg-red-600 text-white'
                          : 'bg-blood-600 text-white'
                        : over
                          ? 'bg-red-50 text-red-700 border border-red-300'
                          : 'bg-parchment-100 text-ink-600 hover:bg-parchment-200'
                    }`}
                    title={t('sorts.sorts.prepares.de.l.classkey.les', {
                      l_classKey: classNameLabel(l.classKey),
                    })}
                  >
                    {limits.length > 1 ? `${classNameLabel(l.classKey)} ` : ''}
                    {t('sorts.prepares.prepared.limit', { prepared: count, limit: l.limit })}
                  </button>
                );
              })}
            </div>
          )}

          {loadError ? (
            <div className="space-y-2">
              <ErrorMsg message={t('sorts.impossible.de.charger.tes.sorts')} />
              <button
                type="button"
                onClick={() => fetchCharSpells()}
                className="btn-ghost text-blood-600 text-sm px-3 py-1.5"
              >
                {t('sorts.reessayer')}
              </button>
            </div>
          ) : loadingSpells ? (
            <div role="status" aria-label={t('sorts.chargement.des.sorts')} className="space-y-1.5">
              {[0, 1, 2].map((i) => (
                <SpellRowSkeleton key={i} />
              ))}
            </div>
          ) : spellsByLevel.length === 0 ? (
            <p className="text-sm text-ink-400 italic">
              {listFilter === 'prepared' ? (
                t('sorts.aucun.sort.prepare.touchez.une.etoile')
              ) : (
                <>
                  {t('sorts.aucun.sort')}{' '}
                  {typeof window !== 'undefined' && window.innerWidth >= 1024
                    ? t('sorts.parcourez.le.grimoire')
                    : t('sorts.cliquez.sur.ajouter.pour.parcourir.le.grimoire')}
                </>
              )}
            </p>
          ) : (
            <div className="space-y-3">
              {spellsByLevel.map((group) => {
                const maxSlots = slots[group.level - 1] ?? 0;
                const remaining = maxSlots - (slotsUsed[group.level - 1] ?? 0);
                return (
                  <div
                    key={group.level}
                    data-tuto={group.level === 0 ? 'sorts-cantrips' : undefined}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-ink-400 uppercase tracking-wide">
                        {group.level === 0
                          ? t('sorts.tours.de.magie')
                          : t('sorts.niveau.level', { level: group.level })}
                      </span>
                      {group.level === 0
                        ? isCaster && (
                            <span className="text-[11px] text-ink-500">{t('sorts.a.volonte')}</span>
                          )
                        : maxSlots > 0 && (
                            <span className="text-[11px] text-ink-500">
                              <span className="font-mono">
                                {remaining} / {maxSlots}
                              </span>{' '}
                              {t('sorts.emplacements')}
                            </span>
                          )}
                    </div>
                    <ul className="space-y-1.5">
                      {group.spells.map((cs) => {
                        const spell = cs.spell;
                        const isExpanded = expandedId === cs.id;
                        const name = spell.name;
                        const isDomain = domainIds.has(spell.id);
                        const canRemove = !isDomain;
                        const isBonusAction = !!spell.castingTime?.includes('bonus');
                        return (
                          <li
                            key={cs.id}
                            className={`rounded-lg overflow-hidden ${flashRowId === cs.id ? 'row-flash' : ''}`}
                          >
                            <SwipeToReveal
                              reveal={canRemove}
                              onAction={() => removeSpell(cs.id)}
                              actionLabel={t('sorts.oublier.name', { name: name })}
                            >
                              <div className="bg-parchment-50 border border-parchment-200 rounded-lg flex items-center gap-1 pl-2 pr-1.5 py-1 min-h-[52px]">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                                    SCHOOL_DOT[spell.school] ?? 'bg-parchment-400'
                                  }`}
                                  title={schoolLabel(spell.school as SpellSchool) ?? spell.school}
                                  aria-hidden="true"
                                />
                                {isDomain ? (
                                  <span
                                    className="w-11 h-11 flex items-center justify-center text-lg text-gold-600 shrink-0"
                                    title={t('sorts.sort.de.domaine.toujours.prepare.ne')}
                                    role="img"
                                    aria-label={t('sorts.sort.de.domaine.toujours.prepare')}
                                  >
                                    ◆
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => togglePrepared(cs.id, cs.prepared)}
                                    className={`w-11 h-11 flex items-center justify-center text-lg shrink-0 ${
                                      cs.prepared
                                        ? 'text-gold-600 hover:text-gold-700'
                                        : 'text-ink-300 hover:text-ink-500'
                                    }`}
                                    aria-label={
                                      cs.prepared
                                        ? t('sorts.sort.prepare')
                                        : t('sorts.sort.non.prepare')
                                    }
                                    title={
                                      cs.prepared ? t('sorts.prepare') : t('sorts.non.prepare')
                                    }
                                  >
                                    {cs.prepared ? '★' : '☆'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(isExpanded ? null : cs.id)}
                                  className="min-w-0 flex-1 text-left px-1"
                                  aria-expanded={isExpanded}
                                >
                                  <span className="font-medium text-sm text-ink-800 block truncate">
                                    {name}
                                  </span>
                                  <span className="flex items-center gap-1.5 text-xs text-ink-400 min-w-0">
                                    {isMultiClass && cs.classSource && (
                                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-300">
                                        {classNameLabel(cs.classSource)}
                                      </span>
                                    )}
                                    {spell.castingTime && (
                                      <span
                                        className={`truncate ${
                                          isBonusAction ? 'text-blood-600 font-semibold' : ''
                                        }`}
                                      >
                                        {spell.castingTime}
                                      </span>
                                    )}
                                    {spell.concentration && (
                                      <span
                                        className="shrink-0 text-indigo-500 text-[11px]"
                                        title={t('sorts.necessite.de.la.concentration')}
                                      >
                                        🌀
                                      </span>
                                    )}
                                    {spell.ritual && (
                                      <span
                                        className="shrink-0 text-purple-600 text-[11px]"
                                        title={t('sorts.lancable.en.rituel')}
                                      >
                                        ⚗
                                      </span>
                                    )}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startCast(spell, cs.id)}
                                  className="w-11 h-11 shrink-0 rounded-xl bg-parchment-100 hover:bg-gold-100 border border-parchment-200 text-ink-500 hover:text-gold-600 flex items-center justify-center text-base transition-colors"
                                  aria-label={t('sorts.lancer.name', { name: name })}
                                  title={t('sorts.lancer.le.sort')}
                                >
                                  🪄
                                </button>
                              </div>
                              {isExpanded && (
                                <div className="px-3 pb-3 pt-2 border-t border-parchment-200 text-xs text-ink-600 space-y-2 bg-parchment-50">
                                  <p>{spell.description}</p>
                                  {spell.higherLevel && (
                                    <p className="text-ink-400 italic">
                                      <strong>{t('sorts.aux.niveaux.superieurs')}</strong>{' '}
                                      {spell.higherLevel}
                                    </p>
                                  )}
                                  <SpellStatBadges
                                    spell={spell}
                                    castingMod={modForSpell(cs.classSource)}
                                    profBonus={profBonus}
                                    isCaster={isCaster}
                                    charLevel={level}
                                  />
                                  <SpellMetaLine spell={spell} />
                                  {canRemove && (
                                    <div className="flex justify-end pt-1">
                                      {confirmForgetId === cs.id ? (
                                        <span className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={cancelForget}
                                            className="text-[11px] text-ink-400 hover:text-ink-600 px-1.5 py-1.5"
                                          >
                                            {t('sorts.annuler')}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => removeSpell(cs.id)}
                                            className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold pulse-warn"
                                          >
                                            {t('sorts.oublier.definitivement')}
                                          </button>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => armForget(cs.id)}
                                          className="text-[11px] text-blood-600 hover:underline px-1.5 py-1.5"
                                        >
                                          {t('sorts.oublier.ce.sort')}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </SwipeToReveal>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Desktop: catalog panel always visible on the right */}
        <section className="hidden lg:block space-y-3">
          <h2 className="section-title">{t('sorts.grimoire')}</h2>
          <div className="card p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <SpellCatalog {...catalogProps} />
          </div>
        </section>
      </div>

      {/* Mobile: catalog as bottom sheet */}
      <BottomSheet
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        title={t('sorts.grimoire')}
      >
        <SpellCatalog {...catalogProps} />
      </BottomSheet>

      {/* Cast sheet (portal — works above any stacking context) */}
      {castingSpell && (
        <CastSpellSheet
          spell={castingSpell}
          slots={slots}
          slotsUsed={slotsUsed}
          pactSlots={pactSlots}
          pactUsed={pactUsed}
          castingMod={modForSpell(
            charSpells.find((cs) => cs.id === castingRowId)?.classSource ?? null,
          )}
          profBonus={profBonus}
          charLevel={level}
          concentrating={!!character.concentrating}
          onClose={() => {
            setCastingSpell(null);
            setCastingRowId(null);
          }}
          onCast={castSpell}
        />
      )}
    </div>
  );
}

// ---------- Slot rail ----------

/** One pip per slot — filled = available, hollow = spent. Positional, never reordered. */
function SlotPips({ max, remaining }: { max: number; remaining: number }) {
  const pips = [];
  for (let i = 0; i < max; i++) {
    pips.push(
      <span
        key={i}
        className={`h-2.5 w-2.5 rounded-full transition-colors duration-500 ${
          i < remaining ? 'bg-ink-700' : 'border border-parchment-400'
        }`}
      />,
    );
  }
  return (
    <span className="flex gap-1" aria-hidden="true">
      {pips}
    </span>
  );
}

/**
 * Horizontal rail of level beads (Arabic numerals 1-9), each with one pip per
 * slot — filled = available, hollow = spent (levels cap at 4 slots so the pips
 * always fit). Tapping a bead opens a compact correction stepper below the
 * rail; casting updates the pips through the normal slotsUsed prop flow.
 */
function SlotRail({
  slots,
  slotsUsed,
  onSpend,
  onRestore,
  label = null,
  note = null,
  tone = 'default',
}: {
  /** Max slots per level 1-9 (index 0 = level 1). */
  slots: number[];
  slotsUsed: number[];
  onSpend: (level: number) => void;
  onRestore: (level: number) => void;
  /** Rail caption — shown only when the two pools coexist (multiclassage). */
  label?: string | null;
  note?: string | null;
  /** Pact pool rides the gold accent (or = magie). */
  tone?: 'default' | 'gold';
}) {
  const { t } = useTranslation();
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const levels = slots
    .map((max, i) => ({ level: i + 1, max, used: slotsUsed[i] ?? 0 }))
    .filter((l) => l.max > 0);
  const open = levels.find((l) => l.level === openLevel) ?? null;

  return (
    <div className="space-y-2">
      {(label || note) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <span className="text-xs font-semibold text-ink-500 uppercase tracking-wide">
              {label}
            </span>
          )}
          {note && <span className="text-[11px] text-gold-600">{note}</span>}
        </div>
      )}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scroll-smooth-touch">
        {levels.map(({ level: lvl, max, used }) => {
          const remaining = max - used;
          const drained = remaining === 0;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => setOpenLevel(openLevel === lvl ? null : lvl)}
              aria-pressed={openLevel === lvl}
              aria-label={t('sorts.niveau.lvl.remaining.emplacement.remaining.1', {
                lvl: lvl,
                remaining: remaining,
                s: remaining > 1 ? 's' : '',
                max: max,
              })}
              className={`shrink-0 min-w-[56px] min-h-[48px] px-2.5 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-colors ${
                tone === 'gold' ? 'ring-1 ring-gold-300' : ''
              } ${
                openLevel === lvl
                  ? 'bg-parchment-200 ring-1 ring-parchment-400'
                  : 'bg-parchment-100 hover:bg-parchment-200'
              }`}
            >
              <span
                className={`text-sm font-semibold leading-none ${drained ? 'text-ink-300' : 'text-ink-700'}`}
              >
                {lvl}
              </span>
              <SlotPips max={max} remaining={remaining} />
            </button>
          );
        })}
      </div>
      {open && (
        <div className="flex items-center justify-between gap-2 bg-parchment-100 rounded-xl px-3 py-1.5">
          <span className="text-xs font-medium text-ink-600">
            {t('sorts.niveau.level', { level: open.level })} —{' '}
            <span className="font-mono">
              {open.max - open.used} / {open.max}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onRestore(open.level)}
              disabled={open.used <= 0}
              className="w-9 h-9 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-base font-medium flex items-center justify-center transition-colors"
              aria-label={t('sorts.restaurer.un.emplacement.de.niveau.open', {
                open_level: open.level,
              })}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => onSpend(open.level)}
              disabled={open.max - open.used <= 0}
              className="w-9 h-9 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-base font-medium flex items-center justify-center transition-colors"
              aria-label={t('sorts.depenser.un.emplacement.de.niveau.open', {
                open_level: open.level,
              })}
            >
              +
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- Loading skeleton ----------

function SpellRowSkeleton() {
  return (
    <div className="bg-parchment-50 border border-parchment-200 rounded-lg p-3 flex items-center gap-3 animate-pulse">
      <span className="h-2.5 w-2.5 rounded-full bg-parchment-300 shrink-0" />
      <span className="flex-1 space-y-1.5 min-w-0">
        <span className="block h-3 w-1/2 rounded bg-parchment-200" />
        <span className="block h-2 w-1/3 rounded bg-parchment-200" />
      </span>
      <span className="h-8 w-8 rounded-lg bg-parchment-200 shrink-0" />
    </div>
  );
}

// DC success type label KEYS — resolved through t() at render time
const DC_SUCCESS_KEYS: Record<string, string> = {
  none: 'sorts.aucun.effet.en.cas.de.reussite',
  half: 'sorts.moitie.des.degats.en.cas.de.reussite',
  other: 'sorts.effet.reduit.en.cas.de.reussite',
};

/** Parse JSON safely, returning null on failure. */
function safeParse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Damage dice string for a spell based on character level / spell level. */
function computeDamageDice(spell: Spell, charLevel: number): string | null {
  const { dice, typeFr } = spellDamageAtLevel(spell, spell.level, charLevel);
  if (!dice) return null;
  return typeFr ? `${dice} ${damageType(typeFr) ?? typeFr}` : dice;
}

/** Render spell stat badges: save DC, attack bonus, damage — computed from character stats. */
function SpellStatBadges({
  spell,
  castingMod,
  profBonus,
  isCaster,
  charLevel,
}: {
  spell: Spell;
  castingMod: number;
  profBonus: number;
  isCaster: boolean;
  charLevel: number;
}) {
  const { t } = useTranslation();
  if (!isCaster) return null;

  const dc = safeParse<{
    dc_type?: { index?: string; name?: string };
    dc_success?: string;
  }>(spell.dcJson);

  const damageDice = computeDamageDice(spell, charLevel);
  const healing = spellHealingAtLevel(spell, spell.level, charLevel);
  const attackBonus = castingMod + profBonus;
  const dcValue = spellSaveDC(castingMod, profBonus);

  // No relevant data to show
  if (!dc && !spell.attackType && !damageDice && !healing.dice) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {dc && (
        <Chip tone="blue">
          🛡 {t('sorts.dd')} {dcValue}
          {dc.dc_type?.index && (
            <span className="text-blue-500">
              ·{' '}
              {abilityShort(dc.dc_type.index as keyof typeof ABILITY_SHORT_FR) ??
                dc.dc_type.index.toUpperCase()}
            </span>
          )}
          {dc.dc_success && dc.dc_success !== 'none' && (
            <span className="text-blue-400">
              · {DC_SUCCESS_KEYS[dc.dc_success] ? t(DC_SUCCESS_KEYS[dc.dc_success]) : ''}
            </span>
          )}
        </Chip>
      )}
      {spell.attackType && (
        <Chip tone="red">
          🎯 {formatModifier(attackBonus)}
          <span className="text-red-500">
            · {spell.attackType === 'ranged' ? t('sorts.distance') : t('sorts.corps.a.corps')}
          </span>
        </Chip>
      )}
      {damageDice && <Chip tone="orange">⚔ {damageDice}</Chip>}
      {healing.dice && (
        <Chip
          tone="green"
          title={
            healing.addsModifier
              ? t('sorts.points.de.vie.restaures.des.modificateur')
              : t('sorts.points.de.vie.restaures')
          }
        >
          ✚ {healing.dice}
          {healing.addsModifier ? formatModifier(castingMod) : ''} {t('sorts.pv')}
        </Chip>
      )}
    </div>
  );
}

// ---------- Expanded-detail meta line ----------

/** Duration reading: 🌀 replaces the data's "concentration, " prefix. */
function spellDurationLabel(spell: Spell, concLabel: string): string | null {
  if (!spell.duration && !spell.concentration) return null;
  let d = spell.duration ?? '';
  if (spell.concentration && /^concentration,?\s*/i.test(d)) {
    d = d.replace(/^concentration,?\s*/i, '');
    return `🌀 ${d ? d.charAt(0).toUpperCase() + d.slice(1) : concLabel}`;
  }
  if (spell.concentration) return `🌀 ${d || concLabel}`;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** One sober typographic line: school · range · duration · components (+ ritual tint). */
function SpellMetaLine({ spell }: { spell: Spell }) {
  const { t } = useTranslation();
  const parts: Array<[string, React.ReactNode]> = [];
  const schoolText = schoolLabel(spell.school as SpellSchool) ?? spell.school;
  parts.push([
    'school',
    <span key="school" className={`font-medium ${SCHOOL_TEXT[spell.school] ?? 'text-ink-600'}`}>
      {schoolText}
    </span>,
  ]);
  if (spell.rangeText) parts.push(['range', <span key="range">{spell.rangeText}</span>]);
  const duration = spellDurationLabel(spell, t('sorts.concentration'));
  if (duration) parts.push(['duration', <span key="duration">{duration}</span>]);
  if (spell.components.length > 0)
    parts.push(['components', <span key="components">{spell.components.join(', ')}</span>]);
  if (spell.ritual)
    parts.push([
      'ritual',
      <span key="ritual" className="text-purple-700 font-medium">
        {t('sorts.rituel')}
      </span>,
    ]);
  return (
    <p className="text-[11px] text-ink-500 leading-relaxed">
      {parts.map(([k, node], i) => (
        <Fragment key={k}>
          {i > 0 && <span className="text-parchment-400"> · </span>}
          {node}
        </Fragment>
      ))}
      {spell.material && (
        <span className="block text-ink-400 truncate">
          {t('sorts.materiel')} {spell.material}
        </span>
      )}
    </p>
  );
}

// ---------- Spell catalog browser ----------

function SpellCatalog({
  spells,
  total,
  loading,
  error,
  offset,
  search,
  level,
  school,
  selectedClass,
  addingSpellId,
  knownSpellIds,
  castingMod,
  profBonus,
  isCaster,
  charLevel,
  onSearch,
  onLevel,
  onSchool,
  onClass,
  onAdd,
  onRetry,
  onLoadMore,
}: {
  spells: Spell[];
  total: number;
  loading: boolean;
  error: boolean;
  offset: number;
  search: string;
  level: string;
  school: string;
  selectedClass: string;
  addingSpellId: number | null;
  knownSpellIds: Set<number>;
  castingMod: number;
  profBonus: number;
  isCaster: boolean;
  charLevel: number;
  onSearch: (v: string) => void;
  onLevel: (v: string) => void;
  onSchool: (v: string) => void;
  onClass: (v: string) => void;
  onAdd: (id: number) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const [expandedSpellId, setExpandedSpellId] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="space-y-2">
        <input
          type="text"
          className="input"
          placeholder={t('sorts.rechercher.un.sort')}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <select
          className="input py-1.5 text-sm w-full"
          value={selectedClass}
          onChange={(e) => onClass(e.target.value)}
          aria-label={t('sorts.filtrer.par.classe')}
        >
          <option value="">{t('sorts.toutes.classes')}</option>
          {DND_CLASSES.map((c) => (
            <option key={c.name} value={c.name}>
              {classNameLabel(c.name)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select
            className="input py-1.5 text-sm flex-1"
            value={level}
            onChange={(e) => onLevel(e.target.value)}
            aria-label={t('sorts.filtrer.par.niveau')}
          >
            <option value="">{t('sorts.tous.niveaux')}</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
              <option key={l} value={String(l)}>
                {l === 0 ? t('sorts.tours.de.magie') : t('sorts.niveau.level', { level: l })}
              </option>
            ))}
          </select>
          <select
            className="input py-1.5 text-sm flex-1"
            value={school}
            onChange={(e) => onSchool(e.target.value)}
            aria-label={t('sorts.filtrer.par.ecole')}
          >
            <option value="">{t('sorts.toutes.ecoles')}</option>
            {Object.entries(SPELL_SCHOOL_LABELS_FR).map(([key]) => (
              <option key={key} value={key}>
                {schoolLabel(key as SpellSchool)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Results */}
      {error ? (
        <div className="space-y-2 py-2">
          <ErrorMsg message={t('sorts.impossible.de.charger.le.grimoire')} />
          <button
            type="button"
            onClick={onRetry}
            className="btn-ghost text-blood-600 text-sm px-3 py-1.5"
          >
            {t('sorts.reessayer')}
          </button>
        </div>
      ) : loading ? (
        <div role="status" aria-label={t('sorts.chargement.du.grimoire')} className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <SpellRowSkeleton key={i} />
          ))}
        </div>
      ) : spells.length === 0 ? (
        search.trim() || level !== '' || school ? (
          <p className="text-sm text-ink-400 italic text-center py-4">
            {t('sorts.aucun.sort.trouve')}
          </p>
        ) : (
          <div className="text-center py-8 space-y-1">
            <p className="text-3xl">📝</p>
            <p className="text-sm text-ink-400">{t('sorts.recherchez.un.sort')}</p>
            <p className="text-xs text-ink-400">{t('sorts.tapez.le.nom.d.un.sort')}</p>
          </div>
        )
      ) : (
        <>
          <p className="text-xs text-ink-400">{t('sorts.total.sort.s', { total: total })}</p>
          <ul className="space-y-1.5">
            {spells.map((spell) => {
              const isExpanded = expandedSpellId === spell.id;
              const isKnown = knownSpellIds.has(spell.id);
              const name = spell.name;
              return (
                <li
                  key={spell.id}
                  className="bg-parchment-50 rounded-lg border border-parchment-200 overflow-hidden"
                >
                  <div className="flex items-center gap-1 pl-2 pr-1.5 py-1 min-h-[48px]">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        SCHOOL_DOT[spell.school] ?? 'bg-parchment-400'
                      }`}
                      title={schoolLabel(spell.school as SpellSchool) ?? spell.school}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      onClick={() => setExpandedSpellId(isExpanded ? null : spell.id)}
                      className="min-w-0 flex-1 text-left px-1"
                      aria-expanded={isExpanded}
                    >
                      <span className="font-medium text-sm text-ink-800 block truncate">
                        {name}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-ink-400 min-w-0">
                        <span className="shrink-0">
                          {spell.level === 0
                            ? t('sorts.tour')
                            : t('sorts.niv.level', { level: spell.level })}
                        </span>
                        {spell.concentration && (
                          <span
                            className="shrink-0 text-indigo-500 text-[11px]"
                            title={t('sorts.necessite.de.la.concentration')}
                          >
                            🌀
                          </span>
                        )}
                        {spell.ritual && (
                          <span
                            className="shrink-0 text-purple-600 text-[11px]"
                            title={t('sorts.lancable.en.rituel')}
                          >
                            ⚗
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAdd(spell.id)}
                      disabled={isKnown || addingSpellId === spell.id}
                      className="text-xs px-2.5 py-2 rounded-lg bg-blood-600 text-white hover:bg-blood-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-colors"
                    >
                      {isKnown ? '✓' : addingSpellId === spell.id ? '…' : t('sorts.ajouter')}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-2 border-t border-parchment-200 text-xs text-ink-600 space-y-2 bg-parchment-50">
                      <p>{spell.description}</p>
                      {spell.higherLevel && (
                        <p className="text-ink-400 italic">
                          <strong>{t('sorts.aux.niveaux.superieurs')}</strong> {spell.higherLevel}
                        </p>
                      )}
                      <SpellStatBadges
                        spell={spell}
                        castingMod={castingMod}
                        profBonus={profBonus}
                        isCaster={isCaster}
                        charLevel={charLevel}
                      />
                      <SpellMetaLine spell={spell} />
                      {spell.classes.length > 0 && (
                        <p className="text-ink-400">
                          {t('sorts.classes')} {spell.classes.map(classNameLabel).join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {offset + PAGE_SIZE < total && (
            <button
              type="button"
              onClick={onLoadMore}
              className="btn-ghost text-ink-700 w-full text-sm py-2"
            >
              {t('sorts.charger.plus', { remaining: total - offset - PAGE_SIZE })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Swipe-to-reveal row action (mobile pattern) ----------

/**
 * Wraps a row so swiping it left reveals a destructive action on the right.
 * Uses pointer capture once horizontal travel exceeds ~8px, so drags work
 * anywhere on the row (including over its buttons) while plain taps and
 * vertical scrolling pass through untouched. Tapping an open row closes it.
 */
function SwipeToReveal({
  reveal,
  onAction,
  actionLabel,
  children,
}: {
  reveal: boolean;
  onAction: () => void;
  actionLabel: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const WIDTH = 76; // revealed action width in px
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x0: number; base: number; captured: boolean; pid: number } | null>(null);

  if (!reveal) return <>{children}</>;

  const swallowClick = (el: HTMLElement) => {
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', swallow, true), 100);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x0: e.clientX, base: open ? -WIDTH : 0, captured: false, pid: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const delta = e.clientX - d.x0;
    if (!d.captured) {
      if (Math.abs(delta) < 8) return; // taps/vertical scrolls pass through
      d.captured = true;
      setDragging(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    }
    const base = Math.min(0, d.base + delta);
    setDx(Math.max(-WIDTH, base));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d || d.pid !== e.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    if (d.captured) {
      const nowOpen = dx < -WIDTH / 2;
      setOpen(nowOpen);
      setDx(nowOpen ? -WIDTH : 0);
      swallowClick(el); // a drag must not trigger the row's buttons
    } else if (open) {
      // Plain tap on an open row closes it instead of activating content
      setOpen(false);
      setDx(0);
      swallowClick(el);
    }
  };

  return (
    <div className="relative rounded-lg overflow-hidden">
      {/* Drawer: the action travels with the row inside a clipped reveal
          zone — closed, it is fully outside the clip (zero pixels painted,
          no sub-pixel seam at any device pixel ratio). */}
      <div className="absolute inset-y-0 right-0 w-[76px] overflow-hidden">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setDx(0);
            onAction();
          }}
          className={`w-full h-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex flex-col items-center justify-center gap-0.5 ${dragging ? '' : 'transition-transform duration-200'}`}
          style={{ transform: `translateX(${WIDTH + dx}px)` }}
          aria-label={actionLabel}
          tabIndex={open ? 0 : -1}
        >
          <span className="text-base leading-none">🗑</span>
          {t('sorts.oublier')}
        </button>
      </div>
      {/* Row content — draggable anywhere */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative touch-pan-y select-none ${dragging ? '' : 'transition-transform duration-200'}`}
        style={{ transform: `translateX(${dx}px)` }}
        title={t('sorts.glisser.vers.la.gauche.pour.oublier')}
      >
        {children}
      </div>
    </div>
  );
}
