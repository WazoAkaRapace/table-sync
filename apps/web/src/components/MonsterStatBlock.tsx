/**
 * Bottom sheet showing a full monster stat block.
 * Fetches the monster by slug on open and renders all capabilities:
 * abilities, saves, skills, senses, traits, actions (with attack/damage badges),
 * and legendary actions.
 */

import type { Monster, MonsterAction } from '@table-sync/shared';
import { abilityModifier, formatCR, formatModifier } from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { appLocale } from '../i18n';
import { monsterSizeLabel } from '../i18n/labels';
import SpellDetailSheet from './SpellDetailSheet';

interface Props {
  open: boolean;
  slug: string | null;
  onClose: () => void;
  /** Fires whenever the GM rolls damage — the result becomes a damage chip. */
  onDamageRolled?: (total: number, source: string) => void;
  /** 'panel' docks inline (desktop side panel); 'modal' (default) is the bottom sheet. */
  variant?: 'modal' | 'panel';
}

/** Light spell row from GET /api/spells/light */
interface SpellLight {
  id: number;
  name: string;
  level: number;
}

/** Normalize a name for matching: lowercase, no accents, no spaces.
 *  Space-insensitive so OCR splits like "déguise ment" still match "déguisement". */
function normalizeSpellName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Extract spell names mentioned in a spellcasting description and match them
 * against the catalog. Returns the catalog entries (deduped, in text order).
 */
function matchSpellsInText(desc: string, catalog: SpellLight[]): SpellLight[] {
  // Remove level/slot markers so spell lists split cleanly
  const cleaned = desc
    .replace(/\d+e?r?\s*niveau\s*\([^)]*\)/gi, ';')
    .replace(/tours?\s+de\s+magie\s*\([^)]*\)/gi, ';')
    .replace(/\d+\s*emplacements?/gi, ';');

  const byName = new Map<string, SpellLight>();
  for (const s of catalog) byName.set(normalizeSpellName(s.name), s);

  const found: SpellLight[] = [];
  const seen = new Set<number>();
  // Join line breaks into spaces first: OCR splits names like "déguise\nment",
  // and matching is space-insensitive so they still match "déguisement".
  const flat = cleaned.replace(/\n/g, ' ');
  // Split on list separators: commas, semicolons, colons, periods, parens
  for (const raw of flat.split(/[,;:.()]/)) {
    const name = raw.replace(/\*/g, '').trim();
    if (!name || name.length < 3) continue;
    const hit = byName.get(normalizeSpellName(name));
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id);
      found.push(hit);
    }
  }
  return found;
}

// French ability key → short label + capitalized save prefix
const ABILITY_INFO: { key: keyof Monster['abilities']; short: string; savePrefix: string }[] = [
  { key: 'for', short: 'FOR', savePrefix: 'For' },
  { key: 'dex', short: 'DEX', savePrefix: 'Dex' },
  { key: 'con', short: 'CON', savePrefix: 'Con' },
  { key: 'int', short: 'INT', savePrefix: 'Int' },
  { key: 'sag', short: 'SAG', savePrefix: 'Sag' },
  { key: 'cha', short: 'CHA', savePrefix: 'Cha' },
];

const SPEED_LABELS: Record<string, string> = {
  walk: '',
  swim: 'nage',
  fly: 'vol',
  climb: 'escalade',
  burrow: 'creusement',
};

export default function MonsterStatBlock({
  open,
  slug,
  onClose,
  onDamageRolled,
  variant = 'modal',
}: Props) {
  const { t } = useTranslation();
  const [monster, setMonster] = useState<Monster | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !slug) return;
    setLoading(true);
    setMonster(null);
    api
      .get(`/api/monsters/${slug}`)
      .then((res) => setMonster(res.data.monster))
      .catch(() => setMonster(null))
      .finally(() => setLoading(false));
  }, [open, slug]);

  // Detect spellcasting entries (Incantation / Incantation innée)
  const hasSpellcasting =
    !!monster &&
    [...monster.traits, ...monster.actions, ...monster.legendaryActions].some((a) =>
      /incantation/i.test(a.name),
    );

  // Fetch the light spell catalog once when the monster has spellcasting
  const [spellCatalog, setSpellCatalog] = useState<SpellLight[]>([]);
  const [openSpellId, setOpenSpellId] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !hasSpellcasting || spellCatalog.length > 0) return;
    api
      .get('/api/spells/light')
      .then((res) => setSpellCatalog(res.data.spells || []))
      .catch(() => {});
  }, [open, hasSpellcasting, spellCatalog.length]);

  if (!open) return null;

  const header = (
    <div className="flex items-center justify-between p-4 border-b border-parchment-200 shrink-0">
      <h2 className="section-title truncate">
        {monster?.name ?? (loading ? 'Chargement…' : 'Monstre')}
      </h2>
      <button
        type="button"
        onClick={onClose}
        className="btn-ghost text-ink-500 p-1 shrink-0"
        aria-label={t('bestiaire.fermer')}
      >
        ✕
      </button>
    </div>
  );

  const body = (
    <div className="overflow-y-auto p-4 flex-1">
      {loading && (
        <p className="text-sm text-ink-400 text-center py-8">
          {t('bestiaire.chargement.du.stat.block')}
        </p>
      )}
      {!loading && !monster && (
        <p className="text-sm text-ink-400 text-center py-8">Monstre introuvable.</p>
      )}
      {monster && (
        <StatBlockBody
          monster={monster}
          spellCatalog={spellCatalog}
          onOpenSpell={setOpenSpellId}
          onDamageRolled={onDamageRolled}
        />
      )}
    </div>
  );

  // Docked side panel (desktop): inline card, no backdrop, own scroll.
  if (variant === 'panel') {
    return (
      <div className="card rounded-2xl flex flex-col overflow-hidden h-full">
        {header}
        {body}
        <SpellDetailSheet
          open={openSpellId !== null}
          spellId={openSpellId}
          onClose={() => setOpenSpellId(null)}
        />
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="card w-full max-w-md rounded-b-none flex flex-col sheet-enter"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {body}
      </div>

      {/* Spell detail sheet (stacks above the stat block) */}
      <SpellDetailSheet
        open={openSpellId !== null}
        spellId={openSpellId}
        onClose={() => setOpenSpellId(null)}
      />
    </div>,
    document.body,
  );
}

function StatBlockBody({
  monster,
  spellCatalog,
  onOpenSpell,
  onDamageRolled,
}: {
  monster: Monster;
  spellCatalog: SpellLight[];
  onOpenSpell: (id: number) => void;
  onDamageRolled?: (total: number, source: string) => void;
}) {
  const { t } = useTranslation();
  const sizeLabel = monsterSizeLabel(monster.size);
  const typeLine = [
    monster.type,
    monster.subtype && `(${monster.subtype})`,
    sizeLabel && `de taille ${sizeLabel}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-4">
      {/* Type line */}
      <p className="text-sm italic text-ink-500">
        {typeLine}
        {monster.alignment && `, ${monster.alignment.toLowerCase()}`}
      </p>

      {/* Core stats: AC, HP, Speed */}
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">🛡 Classe d'armure</span>
          <span className="text-sm">
            {monster.armorClass}
            {monster.armorDesc && <span className="text-ink-400"> ({monster.armorDesc})</span>}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{t('bestiaire.points.de.vie')}</span>
          <span className="text-sm">
            {monster.hitPoints}
            {monster.hitDice && <span className="text-ink-400"> ({monster.hitDice})</span>}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">🏃 Vitesse</span>
          <span className="text-sm">{formatSpeed(monster)}</span>
        </div>
      </div>

      {/* Ability scores grid */}
      <div className="grid grid-cols-6 gap-1 text-center border-y border-parchment-200 py-2">
        {ABILITY_INFO.map(({ key, short }) => {
          const score = monster.abilities[key] ?? 10;
          const mod = abilityModifier(score);
          return (
            <div key={key}>
              <div className="text-xs font-bold text-ink-600">{short}</div>
              <div className="text-sm font-mono">{score}</div>
              <div className="text-xs text-ink-400">({formatModifier(mod)})</div>
            </div>
          );
        })}
      </div>

      {/* Saves, skills, senses, languages, CR */}
      <div className="space-y-1.5 text-sm">
        {monster.savingThrows.length > 0 && (
          <div>
            <span className="font-semibold">{t('bestiaire.jets.de.sauvegarde')}</span>
            <span className="text-ink-600 ml-2">{monster.savingThrows.join(', ')}</span>
          </div>
        )}
        {monster.skills.length > 0 && (
          <div>
            <span className="font-semibold">{t('bestiaire.competences')}</span>
            <span className="text-ink-600 ml-2">
              {monster.skills.map((s) => `${s.name}${s.isExpert ? ' (expert)' : ''}`).join(', ')}
            </span>
          </div>
        )}
        {monster.senses && (
          <div>
            <span className="font-semibold">Sens</span>
            <span className="text-ink-600 ml-2">{monster.senses}</span>
            {monster.telepathy && (
              <span className="text-ink-600">, télépathie {monster.telepathy} m</span>
            )}
          </div>
        )}
        <div>
          <span className="font-semibold">Langues</span>
          <span className="text-ink-600 ml-2">
            {monster.languages.length > 0 ? monster.languages.join(', ') : '—'}
          </span>
        </div>
        <div>
          <span className="font-semibold">Puissance</span>
          <span className="text-ink-600 ml-2">
            {formatCR(monster.challengeRating)} ({monster.xp.toLocaleString(appLocale())} PX)
          </span>
        </div>
      </div>

      {/* Damage modifiers */}
      {(monster.damageResistances?.length ||
        monster.damageImmunities?.length ||
        monster.conditionImmunities?.length) && (
        <div className="space-y-1.5 text-sm">
          {monster.damageResistances && monster.damageResistances.length > 0 && (
            <div>
              <span className="font-semibold">{t('bestiaire.resistances.aux.degats')}</span>
              <span className="text-ink-600 ml-2">{monster.damageResistances.join(', ')}</span>
            </div>
          )}
          {monster.damageImmunities && monster.damageImmunities.length > 0 && (
            <div>
              <span className="font-semibold">{t('bestiaire.immunites.aux.degats')}</span>
              <span className="text-ink-600 ml-2">{monster.damageImmunities.join(', ')}</span>
            </div>
          )}
          {monster.conditionImmunities && monster.conditionImmunities.length > 0 && (
            <div>
              <span className="font-semibold">{t('bestiaire.immunites.aux.etats')}</span>
              <span className="text-ink-600 ml-2">{monster.conditionImmunities.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Traits */}
      {monster.traits.length > 0 && (
        <ActionSection
          title={t('bestiaire.capacites')}
          actions={monster.traits}
          spellCatalog={spellCatalog}
          onOpenSpell={onOpenSpell}
          onDamageRolled={onDamageRolled}
        />
      )}

      {/* Actions */}
      {monster.actions.length > 0 && (
        <ActionSection
          title="Actions"
          actions={monster.actions}
          spellCatalog={spellCatalog}
          onOpenSpell={onOpenSpell}
          onDamageRolled={onDamageRolled}
        />
      )}

      {/* Legendary actions */}
      {monster.legendaryActions.length > 0 && (
        <ActionSection
          title={t('bestiaire.actions.legendaires')}
          actions={monster.legendaryActions}
          spellCatalog={spellCatalog}
          onOpenSpell={onOpenSpell}
          onDamageRolled={onDamageRolled}
        />
      )}
    </div>
  );
}

function ActionSection({
  title,
  actions,
  spellCatalog,
  onOpenSpell,
  onDamageRolled,
}: {
  title: string;
  actions: MonsterAction[];
  spellCatalog: SpellLight[];
  onOpenSpell: (id: number) => void;
  onDamageRolled?: (total: number, source: string) => void;
}) {
  return (
    <div>
      <h3 className="font-display font-semibold text-blood-700 border-b border-blood-200 pb-1 mb-2 text-sm">
        {title}
      </h3>
      <div className="space-y-2">
        {actions.map((action) => (
          <ActionEntry
            key={action.name}
            action={action}
            spellCatalog={spellCatalog}
            onOpenSpell={onOpenSpell}
            onDamageRolled={onDamageRolled}
          />
        ))}
      </div>
    </div>
  );
}

function formatSpeed(monster: Monster): string {
  const parts: string[] = [];
  for (const [mode, value] of Object.entries(monster.speed)) {
    const num = Number(value);
    if (Number.isNaN(num) || num === 0) continue;
    const label = SPEED_LABELS[mode];
    parts.push(label ? `${label} ${num} m` : `${num} m`);
  }
  return parts.length > 0 ? parts.join(', ') : '—';
}

// ---------- Dice rolling ----------

/** Roll a single d20 + bonus for an attack roll */
function rollAttack(bonus: number): { roll: number; natural: number; total: number } {
  const natural = Math.floor(Math.random() * 20) + 1;
  const total = natural + bonus;
  return { roll: total, natural, total };
}

/** Roll a dice formula like "2d6+5" → { total, rolls }. Doubles dice on crit (not flat bonus). */
function rollDamage(formula: string, crit = false): { total: number; rolls: number[] } {
  const match = formula.match(/^(\d+)d(\d+)(?:([+-]\d+))?$/);
  if (!match) return { total: 0, rolls: [] };
  const numDice = parseInt(match[1], 10);
  const dieSize = parseInt(match[2], 10);
  const flatBonus = match[3] ? parseInt(match[3], 10) : 0;
  const diceCount = crit ? numDice * 2 : numDice;
  const rolls: number[] = [];
  let total = flatBonus;
  for (let i = 0; i < diceCount; i++) {
    const r = Math.floor(Math.random() * dieSize) + 1;
    rolls.push(r);
    total += r;
  }
  return { total, rolls };
}

// ---------- Action entry with interactive dice + spell links ----------

function ActionEntry({
  action,
  spellCatalog,
  onOpenSpell,
  onDamageRolled,
}: {
  action: MonsterAction;
  spellCatalog: SpellLight[];
  onOpenSpell: (id: number) => void;
  onDamageRolled?: (total: number, source: string) => void;
}) {
  const { t } = useTranslation();
  const [attackResult, setAttackResult] = useState<{
    roll: number;
    natural: number;
    total: number;
  } | null>(null);
  const [damageResult, setDamageResult] = useState<{ total: number; rolls: number[] } | null>(null);

  // Spellcasting entry: match the spell names mentioned in the description
  const isSpellcasting = /incantation/i.test(action.name);
  const knownSpells =
    isSpellcasting && spellCatalog.length > 0 && action.desc
      ? matchSpellsInText(action.desc, spellCatalog)
      : [];

  const handleAttack = () => {
    if (action.attackBonus == null) return;
    const result = rollAttack(action.attackBonus);
    setAttackResult(result);
    setDamageResult(null); // clear previous damage
    // On a crit, auto-roll double damage
    if (result.natural === 20 && action.damageDice) {
      const critDamage = rollDamage(action.damageDice, true);
      setDamageResult(critDamage);
      if (critDamage.total > 0) onDamageRolled?.(critDamage.total, action.name);
    }
  };

  const handleDamage = () => {
    if (!action.damageDice) return;
    const result = rollDamage(action.damageDice, isCrit);
    setDamageResult(result);
    if (result.total > 0) onDamageRolled?.(result.total, action.name);
  };

  const isCrit = attackResult?.natural === 20;
  const isFumble = attackResult?.natural === 1;

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="font-semibold italic">{action.name}.</span>
        {/* Attack bonus — clickable to roll */}
        {action.attackBonus != null && (
          <button
            type="button"
            onClick={handleAttack}
            className="px-1.5 py-0.5 rounded text-xs font-mono bg-red-100 text-red-700 shrink-0 hover:bg-red-200 active:scale-95 transition-all cursor-pointer"
            title={t('bestiaire.cliquer.pour.lancer.le.jet.d')}
          >
            🎲 +{action.attackBonus}
          </button>
        )}
        {/* Damage dice — clickable to roll */}
        {action.damageDice && (
          <button
            type="button"
            onClick={handleDamage}
            className="px-1.5 py-0.5 rounded text-xs font-mono bg-orange-100 text-orange-700 shrink-0 hover:bg-orange-200 active:scale-95 transition-all cursor-pointer"
            title={t('bestiaire.cliquer.pour.lancer.les.degats')}
          >
            🎲 {action.damageDice}
            {action.damageType ? ` ${action.damageType}` : ''}
          </button>
        )}
      </div>

      {/* Roll results */}
      {(attackResult || damageResult) && (
        <div className="mt-1 flex flex-wrap gap-2 items-center">
          {/* Attack result */}
          {attackResult && (
            <span
              className={`px-2 py-1 rounded-lg text-sm font-bold font-mono ${
                isCrit
                  ? 'bg-green-200 text-green-800'
                  : isFumble
                    ? 'bg-red-200 text-red-800'
                    : 'bg-red-50 text-red-700'
              }`}
            >
              {isCrit && '🎯 Critique ! '}
              {isFumble && '💥 Échec ! '}
              {attackResult.total} à l'attaque
              <span className="text-xs font-normal ml-1 opacity-70">
                (d20: {attackResult.natural})
              </span>
            </span>
          )}
          {/* Damage result */}
          {damageResult && (
            <span
              className={`px-2 py-1 rounded-lg text-sm font-bold font-mono ${
                isCrit ? 'bg-green-200 text-green-800' : 'bg-orange-200 text-orange-800'
              }`}
            >
              {isCrit && '🎯 '}
              {damageResult.total} dégâts{action.damageType ? ` ${action.damageType}` : ''}
              {isCrit && <span className="text-xs font-normal ml-1">×2!</span>}
              <span className="text-xs font-normal ml-1 opacity-70">
                ({damageResult.rolls.join('+')})
              </span>
            </span>
          )}
          {/* Clear button */}
          <button
            type="button"
            onClick={() => {
              setAttackResult(null);
              setDamageResult(null);
            }}
            className="text-xs text-ink-400 hover:text-ink-700"
          >
            ✕
          </button>
        </div>
      )}

      {action.desc && <p className="text-ink-600 mt-0.5">{action.desc}</p>}

      {/* Clickable spell chips for spellcasting entries */}
      {knownSpells.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {knownSpells.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => onOpenSpell(s.id)}
              className="px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 active:scale-95 transition-all"
              title={`Voir le sort : ${s.name}`}
            >
              ✨ {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
