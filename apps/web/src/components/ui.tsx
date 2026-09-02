import type { CostUnit, EncumbranceState, ItemCategory, Rarity } from '@table-sync/shared';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import i18next from '../i18n';
import { categoryLabel, coinLabel, encumbranceLabel, rarityLabel } from '../i18n/labels';

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const cls = `rarity-${rarity}`;
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {rarityLabel(rarity)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: ItemCategory }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-parchment-100 text-ink-500 font-medium">
      {categoryLabel(category)}
    </span>
  );
}

export function WeightBadge({ weightKg }: { weightKg: number | null }) {
  const { t } = useTranslation();
  if (weightKg === null) return <span className="text-xs text-ink-400">{t('ui.poids')}</span>;
  return <span className="text-xs text-ink-500">{weightKg} kg</span>;
}

// ---------- Hit-points bar ----------
// Severity tiers shared by every HP display: dead (≤0) dark red, then red /
// amber below 25% / 50%, green above. The fill sits on a parchment track;
// `showText` overlays the numeric value inside the bar.

export function HpBar({
  current,
  max,
  temp = 0,
  size = 'xs',
  showText = false,
  trackClassName = 'bg-parchment-200',
  className = '',
}: {
  current: number;
  max: number;
  /** Temporary HP — drawn as a blue segment beyond current, capped by the track. */
  temp?: number;
  size?: 'xs' | 'sm' | 'md';
  showText?: boolean;
  trackClassName?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, max > 0 ? (current / max) * 100 : 0));
  // Temp segment extends past the fill; when the bar is full (or nearly), it
  // caps the END of the fill instead — full HP + a temp buffer stays visible.
  const tempPct = temp > 0 ? Math.max(0, Math.min(100, max > 0 ? (temp / max) * 100 : 0)) : 0;
  const tempLeft = tempPct > 0 ? Math.min(pct, 100 - tempPct) : 0;
  const tier =
    current <= 0
      ? 'bg-red-700'
      : pct <= 25
        ? 'bg-red-500'
        : pct <= 50
          ? 'bg-yellow-500'
          : 'bg-green-500';
  const height = size === 'md' ? 'h-5' : size === 'sm' ? 'h-4' : 'h-2';
  return (
    <div
      className={`relative ${height} ${trackClassName} rounded-full overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={`${t('ui.hpbar.aria', { current, max })}${
        temp > 0 ? t('ui.hpbar.temp', { temp }) : ''
      }`}
    >
      <div className={`h-full ${tier} transition-all`} style={{ width: `${pct}%` }} />
      {tempPct > 0 && (
        <div
          className="absolute top-0 h-full bg-blue-500 transition-all"
          style={{ left: `${tempLeft}%`, width: `${tempPct}%` }}
        />
      )}
      {showText && (
        <span className="absolute inset-0 flex items-center justify-center text-xs font-mono font-semibold">
          {current}/{max}
        </span>
      )}
    </div>
  );
}

// ---------- Tone chip ----------
// Small inline stat chip (attack, damage, concentration…): tinted surface,
// darker text of the same hue, 1px border. `soft` is the de-emphasized
// variant used for secondary readings of the same stat.

const CHIP_TONES = {
  orange: {
    solid: 'bg-orange-50 text-orange-800 border-orange-200',
    soft: 'bg-orange-50/60 text-orange-700 border-orange-200',
  },
  red: {
    solid: 'bg-red-50 text-red-800 border-red-200',
    soft: 'bg-red-50/60 text-red-700 border-red-200',
  },
  blood: {
    solid: 'bg-blood-50 text-blood-800 border-blood-200',
    soft: 'bg-blood-50/60 text-blood-700 border-blood-200',
  },
  green: {
    solid: 'bg-green-50 text-green-800 border-green-200',
    soft: 'bg-green-50/60 text-green-700 border-green-200',
  },
  blue: {
    solid: 'bg-blue-50 text-blue-800 border-blue-200',
    soft: 'bg-blue-50/60 text-blue-700 border-blue-200',
  },
  amber: {
    solid: 'bg-amber-50 text-amber-800 border-amber-300',
    soft: 'bg-amber-50/60 text-amber-700 border-amber-300',
  },
  gold: {
    solid: 'bg-gold-100 text-gold-700 border-gold-300',
    soft: 'bg-gold-100/60 text-gold-700 border-gold-300',
  },
  indigo: {
    solid: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    soft: 'bg-indigo-50/60 text-indigo-700 border-indigo-200',
  },
} as const;

export function Chip({
  tone = 'orange',
  soft = false,
  title,
  className = '',
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  soft?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const toneCls = CHIP_TONES[tone][soft ? 'soft' : 'solid'];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border ${toneCls} ${className}`}
      title={title}
    >
      {children}
    </span>
  );
}

// ---------- Floating action button ----------

export function Fab({
  onClick,
  label,
  mobileOnly = false,
  raised = false,
  children = '+',
  dataTuto,
}: {
  onClick: () => void;
  label: string;
  mobileOnly?: boolean;
  raised?: boolean;
  children?: React.ReactNode;
  /** Cible de la visite guidée (attribut data-tuto). */
  dataTuto?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-tuto={dataTuto}
      className={`fab-enter fixed ${
        raised
          ? 'bottom-[calc(6rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]'
      } right-5 z-30 w-14 h-14 rounded-full bg-blood-600 text-white shadow-lg flex items-center justify-center text-2xl font-light hover:bg-blood-700 active:scale-95 transition-all ${
        mobileOnly ? 'lg:hidden' : ''
      }`}
    >
      {children}
    </button>
  );
}

// ---------- Numeric field ----------

// The number input every numeric field must use: while focused the box holds a
// free draft (clearing a default to retype it never snaps back mid-keystroke),
// every parsable entry commits clamped to [min, max], and a box left empty (or
// unparsable) rolls back to its last committed value on blur — never coerced
// to the min, never to 0. Hand-rolled `Number(value) || fallback` clamps have
// regressed more than once; route them here.
export function NumberField({
  value,
  onChange,
  min,
  max,
  zeroAsEmpty = false,
  onBlur,
  ...inputProps
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  /** Show a committed 0 as an empty box (coin purse display convention). */
  zeroAsEmpty?: boolean;
} & Omit<React.ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'min' | 'max' | 'type'>) {
  // The draft holds the raw text while the user edits (possibly ''); null when
  // the box mirrors the committed value. An empty draft never reaches onChange,
  // so dropping it on blur restores the previous value for free.
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (n: number) => Math.min(max ?? n, Math.max(min ?? n, n));
  const display = draft ?? (zeroAsEmpty && value === 0 ? '' : String(value));

  return (
    <input
      {...inputProps}
      type="number"
      min={min}
      max={max}
      value={display}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = Number(text);
        if (text !== '' && Number.isFinite(n)) onChange(clamp(n));
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}

export function CostBadge({ qty, unit }: { qty: number | null; unit: CostUnit | null }) {
  if (!qty || !unit) return null;
  return (
    <span className="text-xs text-ink-500">
      {qty} {coinLabel(unit)}
    </span>
  );
}

export function EncumbranceBar({
  encumbrance,
  compact = false,
}: {
  encumbrance: EncumbranceState;
  /** Slim one-line variant for the state band: bar + reading + tier label. */
  compact?: boolean;
}) {
  const { totalWeightKg, coinWeightKg, encumberedKg, heavilyEncumberedKg, maxCarryKg, tier, pct } =
    encumbrance;
  const { t } = useTranslation();
  const barColor = `bar-${tier}`;
  const encPos = Math.min(100, (encumberedKg / maxCarryKg) * 100);
  const heavyPos = Math.min(100, (heavilyEncumberedKg / maxCarryKg) * 100);
  const itemWeightKg = totalWeightKg - coinWeightKg;

  if (compact) {
    return (
      <div
        className="space-y-1"
        role="progressbar"
        aria-valuenow={Math.round(totalWeightKg * 100) / 100}
        aria-valuemin={0}
        aria-valuemax={maxCarryKg}
        aria-valuetext={t('ui.encumbrance.aria', {
          weight: totalWeightKg.toFixed(1),
          max: maxCarryKg,
          tier: encumbranceLabel(tier),
        })}
      >
        <div className="flex items-center gap-2">
          <div className="relative h-1.5 flex-1 bg-parchment-200 rounded-full overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all duration-300 rounded-full`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
            {encPos > 0 && encPos < 100 && (
              <div
                className="absolute top-0 h-full w-0.5 bg-yellow-700/40"
                style={{ left: `${encPos}%` }}
              />
            )}
            {heavyPos > 0 && heavyPos < 100 && (
              <div
                className="absolute top-0 h-full w-0.5 bg-orange-700/40"
                style={{ left: `${heavyPos}%` }}
              />
            )}
          </div>
          <span className="text-[11px] font-mono text-ink-600 shrink-0">
            {totalWeightKg.toFixed(1)} / {maxCarryKg} kg
          </span>
          <span className={`text-[11px] font-medium shrink-0 ${tierColor(tier)}`}>
            {encumbranceLabel(tier)}
          </span>
        </div>
        {tier !== 'unencumbered' && (
          <div className={`text-[11px] px-2 py-1 rounded-lg ${tierBadge(tier)}`}>
            {tierConsequence(tier)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-1.5"
      role="progressbar"
      aria-valuenow={Math.round(totalWeightKg * 100) / 100}
      aria-valuemin={0}
      aria-valuemax={maxCarryKg}
      aria-valuetext={`${totalWeightKg.toFixed(1)} kg sur ${maxCarryKg} kg, ${encumbranceLabel(tier)}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-display text-sm font-semibold text-ink-900">
          {totalWeightKg.toFixed(1)} / {maxCarryKg} kg
        </span>
        <span className={`text-xs font-medium ${tierColor(tier)}`}>{encumbranceLabel(tier)}</span>
      </div>
      <div className="relative h-3 bg-parchment-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300 rounded-full`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {encPos > 0 && encPos < 100 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-yellow-700/40"
            style={{ left: `${encPos}%` }}
          />
        )}
        {heavyPos > 0 && heavyPos < 100 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-orange-700/40"
            style={{ left: `${heavyPos}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-ink-400">
        <span>{t('ui.encombre', { kg: encumberedKg })}</span>
        <span>{t('ui.lourd', { kg: heavilyEncumberedKg })}</span>
        <span>{t('ui.max', { kg: maxCarryKg })}</span>
      </div>
      {coinWeightKg > 0.001 && (
        <div className="text-xs text-ink-400">
          {t('ui.objets.monnaie', {
            items: itemWeightKg.toFixed(1),
            coins: coinWeightKg.toFixed(1),
          })}
        </div>
      )}
      {tier !== 'unencumbered' && (
        <div className={`text-xs mt-1 px-2 py-1 rounded-lg ${tierBadge(tier)}`}>
          {tierConsequence(tier)}
        </div>
      )}
    </div>
  );
}

function tierColor(tier: EncumbranceState['tier']): string {
  switch (tier) {
    case 'unencumbered':
      return 'text-green-700';
    case 'encumbered':
      return 'text-yellow-700';
    case 'heavilyEncumbered':
      return 'text-orange-700';
    case 'overburdened':
      return 'text-red-700 font-semibold';
  }
}

function tierBadge(tier: EncumbranceState['tier']): string {
  switch (tier) {
    case 'encumbered':
      return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
    case 'heavilyEncumbered':
      return 'bg-orange-50 text-orange-800 border border-orange-200';
    case 'overburdened':
      return 'bg-red-50 text-red-800 border border-red-200 font-semibold';
    default:
      return '';
  }
}

function tierConsequence(tier: EncumbranceState['tier']): string {
  switch (tier) {
    case 'encumbered':
      return i18next.t('ui.vitesse.reduite.de.3.m');
    case 'heavilyEncumbered':
      return i18next.t('ui.vitesse.reduite.de.6.m');
    case 'overburdened':
      return i18next.t('ui.immobilise');
    default:
      return '';
  }
}

export function LoadingSpinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-ink-400 animate-pulse">{label ?? t('common.loading')}</div>
    </div>
  );
}

export function ErrorMsg({ message }: { message: string }) {
  return (
    <div
      className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm"
      role="alert"
    >
      {message}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="text-center py-12 px-4">
      <div className="text-4xl mb-2" aria-hidden="true">
        {icon}
      </div>
      <p className="text-ink-700 font-medium">{title}</p>
      {hint && <p className="text-ink-400 text-sm mt-1">{hint}</p>}
    </div>
  );
}

// ---------- Two-step destructive confirm ----------
// First click arms (warn style + 4s auto-revert), second click fires onConfirm.
// Clicks never bubble to a parent card handler.

export function ConfirmButton({
  onConfirm,
  children,
  confirmChildren,
  className = '',
  armedClassName = '',
  title,
  ariaLabel,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  confirmChildren: React.ReactNode;
  className?: string;
  armedClassName?: string;
  title?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    onConfirm();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onBlur={armed ? disarm : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && armed) {
          e.stopPropagation();
          disarm();
        }
      }}
      className={`${className} ${armed ? `pulse-warn ${armedClassName}` : ''}`}
      title={title}
      aria-label={armed && ariaLabel ? `${ariaLabel}${t('ui.confirmer')}` : ariaLabel}
    >
      {armed ? confirmChildren : children}
    </button>
  );
}

// ---------- Toast system ----------

export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] lg:bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-enter pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium max-w-sm ${
            t.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------- Modal with focus trap ----------

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Move focus into modal ONLY when it opens (not on every re-render)
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;

    const modal = modalRef.current;
    if (modal) {
      // Prefer focusing the first input/select, not the ✕ button
      const focusable = modal.querySelector<HTMLElement>(
        'input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }

    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      previousFocus.current?.focus();
    };
  }, [open]);

  // Keydown handler (Escape + Tab trap) — uses a ref so it doesn't re-bind
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="card w-full break-words sm:max-w-md max-h-[85vh] overflow-y-auto rounded-b-none sm:rounded-b-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="section-title min-w-0 flex-1 truncate" title={title}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost shrink-0 text-ink-500 p-1"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Bottom sheet ----------
// Portaled so it escapes any transformed ancestor. `mobileOnly` keeps the
// historical lg:hidden catalog behavior; desktop-capable sheets opt out.

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'lg',
  mobileOnly = true,
  bodyClassName = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
  mobileOnly?: boolean;
  bodyClassName?: string;
}) {
  const { t } = useTranslation();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/40 ${mobileOnly ? 'lg:hidden' : ''}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className={`sheet-enter card w-full ${size === 'md' ? 'max-w-md' : 'max-w-6xl'} max-h-[88vh] rounded-b-none flex flex-col pb-[env(safe-area-inset-bottom)]`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between p-4 border-b border-parchment-200 shrink-0">
          <h2 className="section-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-ink-500 p-1"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <div className={`overflow-y-auto p-4 flex-1 ${bodyClassName}`}>{children}</div>
        {footer && (
          <div className="flex gap-2 p-4 border-t border-parchment-200 shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
