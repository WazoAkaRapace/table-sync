/**
 * Sortable card grid — shared drag-to-reorder machinery for the Traits and
 * Notes tabs (dnd-kit). Dragging starts ONLY from the grip handle: the rest
 * of the card never captures the pointer, so touch scrolling stays intact,
 * and there is no activation delay. Mouse, touch and keyboard share one
 * gesture (Space lifts, arrows move, Space drops).
 *
 * Each grid is an independent drag arena — the Traits tab mounts one per
 * category section, the Notes tab one for the whole list.
 */
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Handle wiring derived from the hook that produces it (no deep imports). */
type SortableApi = ReturnType<typeof useSortable>;

/** The world's single motion curve — sibling shifts use it, shortened here. */
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * DndContext + SortableContext + the grid container. `ids` is the current
 * order (the source of truth the parent re-renders from); `onReorder`
 * receives the full id list after a drop — the parent persists it or rolls
 * back. `labelOf` powers the French screen-reader announcements.
 */
export function SortableGrid({
  ids,
  onReorder,
  labelOf,
  className,
  children,
}: {
  ids: number[];
  onReorder: (nextIds: number[]) => void;
  labelOf: (id: string | number) => string;
  className?: string;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // 4 px of slack so a click on the grip never becomes a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  // Typed const (tsc 7 doesn't contextually type this through JSX props)
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `${labelOf(active.id)} pris — flèches pour déplacer, Espace pour déposer.`,
    onDragOver: ({ active, over }) =>
      over && active.id !== over.id
        ? `${labelOf(active.id)} avant ${labelOf(over.id)}.`
        : undefined,
    onDragEnd: ({ active }) => `${labelOf(active.id)} déposé.`,
    onDragCancel: ({ active }) => `${labelOf(active.id)} remis en place.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * One card in a SortableGrid. The wrapper only carries layout + the drag
 * translate; the card body comes from the render-prop child so each tab
 * keeps its own markup. The child receives the grip handle (to mount at the
 * far right of the action corner) and whether the card is the one flying.
 */
export function SortableCard({
  id,
  label,
  children,
}: {
  id: number;
  /** French a11y name for the grip (« Déplacer Rage »). */
  label: string;
  children: (handle: ReactNode, isDragging: boolean) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const reducedMotion = usePrefersReducedMotion();

  // Sibling shifts ride the house curve; the flying card follows the pointer
  // with no transition; reduced motion gets no transition at all.
  const eased = transition === null || reducedMotion ? undefined : `transform 200ms ${EASE_OUT}`;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: eased }}
      className={isDragging ? 'relative z-10' : undefined}
    >
      {children(
        <DragHandle
          label={label}
          attributes={attributes}
          listeners={listeners}
          activatorRef={setActivatorNodeRef}
        />,
        isDragging,
      )}
    </div>
  );
}

/** The grip — a drawn six-dot handle, hit area padded well past its glyph. */
function DragHandle({
  label,
  attributes,
  listeners,
  activatorRef,
}: {
  label: string;
  attributes: SortableApi['attributes'];
  listeners: SortableApi['listeners'];
  activatorRef: SortableApi['setActivatorNodeRef'];
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      ref={activatorRef}
      // -m-2 p-3: ~40 px hit area for a glyph the size of ✎/×
      className="-m-2 p-3 rounded-md text-ink-400 hover:text-ink-700 cursor-grab active:cursor-grabbing touch-none"
      title={t('tri.glisser.pour.reordonner')}
      {...attributes}
      {...listeners}
      aria-label={label}
      aria-roledescription="poignée de déplacement"
    >
      <svg viewBox="0 0 10 16" className="w-2.5 h-4" fill="currentColor" aria-hidden="true">
        <circle cx="2.6" cy="3" r="1.6" />
        <circle cx="7.4" cy="3" r="1.6" />
        <circle cx="2.6" cy="8" r="1.6" />
        <circle cx="7.4" cy="8" r="1.6" />
        <circle cx="2.6" cy="13" r="1.6" />
        <circle cx="7.4" cy="13" r="1.6" />
      </svg>
    </button>
  );
}
