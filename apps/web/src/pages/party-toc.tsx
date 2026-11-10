import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function DotLeader() {
  return (
    <span
      aria-hidden="true"
      className="mx-2 min-w-6 flex-1 self-center border-b border-dotted border-parchment-300"
    />
  );
}

export function TocHeader({ numeral, title, id }: { numeral: string; title: string; id: string }) {
  return (
    <div className="pb-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="w-8 shrink-0 text-right font-display text-base text-ink-300"
        >
          {numeral}
        </span>
        <h2 id={id} className="section-title">
          {title}
        </h2>
        <span
          aria-hidden="true"
          className="min-w-4 flex-1 self-center border-b border-parchment-200"
        />
      </div>
    </div>
  );
}

/** A ruled annex line that opens somewhere — tool glyph, label, arrow chip.
 *  `badge` counts what waits behind the door (correspondance non lue);
 *  `queue` is a trailing measured value (the carnet's campaign clock). */
export function TocLink({
  to,
  label,
  glyph,
  badge,
  badgeLabel,
  queue,
}: {
  to: string;
  label: string;
  glyph: ReactNode;
  badge?: number;
  badgeLabel?: string;
  queue?: string;
}) {
  return (
    <li className="border-b border-parchment-200">
      <Link
        to={to}
        className="group -mx-3 flex items-center gap-3 rounded-lg px-3 py-3.5 transition-colors hover:bg-parchment-100/70"
      >
        <span aria-hidden="true" className="shrink-0 text-lg">
          {glyph}
        </span>
        <span className="text-sm font-medium text-ink-800">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span
            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blood-600 px-1 text-[10px] font-bold text-white"
            role="status"
            aria-label={badgeLabel}
            title={badgeLabel}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
        <DotLeader />
        {queue && <span className="shrink-0 font-mono text-xs text-ink-500">{queue}</span>}
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-parchment-300 text-sm text-ink-500 transition-colors group-hover:border-blood-500 group-hover:text-blood-500"
        >
          →
        </span>
      </Link>
    </li>
  );
}
