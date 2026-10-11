// Pieces every display shares: the empty value, and a row of chips that folds
// the rest into "+N" (the conventions' overflow rule: cells measure, cards
// show 3, stories pass a number).
import { createContext, use, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, DialogTrigger } from 'react-aria-components';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Popover } from '../molecules/Popover/Popover.tsx';
import { chipsThatFit } from './fit.ts';
import styles from './parts.module.css';
import { strings } from './strings.ts';
import type { FieldAttribute, Surface } from './types.ts';

/** An empty value: nothing in a cell, a dash elsewhere, and "Empty" for screen readers everywhere. */
export function EmptyValue({ surface }: { readonly surface: Surface }) {
  return (
    <span className={styles.empty} data-surface={surface}>
      {surface !== 'cell' && <span aria-hidden="true">{strings.emptyMark}</span>}
      <VisuallyHidden>{strings.empty}</VisuallyHidden>
    </span>
  );
}

/**
 * The width a row of chips has to fit in, in pixels: a grid cell provides its
 * own (its column's width less its padding), so a ChipRow inside it folds what
 * won't fit into "+N". Elsewhere there is none, and chips follow `maxVisible`.
 */
export const ChipFitContext = createContext<number | undefined>(undefined);

/** Props for ChipRow. */
export interface ChipRowProps {
  /** One element per value, keyed. */
  readonly chips: readonly { readonly key: string; readonly node: ReactNode }[];
  /** How many show before "+N"; when left out, as many as fit in a grid cell (`ChipFitContext`), else all. */
  readonly maxVisible?: number;
  /** The popover's name: the attribute ("Team"). */
  readonly label: string;
}

/**
 * Several values in a row; past `maxVisible`, a "+N" chip opens all of them.
 * In a grid cell with no `maxVisible`, it measures its chips once per value
 * and width and shows as many whole chips as fit, so values never squash.
 */
export function ChipRow({ chips, maxVisible, label }: ChipRowProps) {
  const available = use(ChipFitContext);
  const rowRef = useRef<HTMLSpanElement>(null);
  const isFitting = maxVisible === undefined && available !== undefined && chips.length > 1;
  // What was measured, for which chips at which width: a new value or width measures again before it paints.
  const signature = `${String(available)}|${chips.map((chip) => chip.key).join('\u0000')}`;
  const [fitted, setFitted] = useState<{ readonly signature: string; readonly count: number } | undefined>(undefined);
  const isMeasuring = isFitting && fitted?.signature !== signature;
  useLayoutEffect(() => {
    if (!isMeasuring) return;
    const row = rowRef.current;
    if (row === null) return;
    const widths = [...row.querySelectorAll<HTMLElement>('[data-chip]')].map((chip) => chip.offsetWidth);
    const more = row.querySelector<HTMLElement>('[data-more-probe]')?.offsetWidth ?? 0;
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    setFitted({ signature, count: chipsThatFit(widths, gap, more, available) });
  }, [isMeasuring, signature, available]);
  const limit = maxVisible ?? (isFitting && !isMeasuring ? fitted?.count : undefined);
  const shown = limit === undefined ? chips : chips.slice(0, limit);
  const rest = chips.length - shown.length;
  return (
    <span ref={rowRef} className={styles.row} data-measuring={isMeasuring || undefined}>
      {/* Keyed by place: a grid cell that scrolls to another record redraws its chips in place. */}
      {shown.map((chip, place) => (
        <span key={place} className={styles.chip} data-chip="" data-last={place === shown.length - 1 || undefined}>
          {chip.node}
        </span>
      ))}
      {isMeasuring && (
        <span className={styles.more} data-more-probe="" aria-hidden="true">
          {strings.more(chips.length)}
        </span>
      )}
      {rest > 0 && (
        <DialogTrigger>
          <AriaButton className={styles.more} aria-label={strings.showMore(rest)}>
            {strings.more(rest)}
          </AriaButton>
          <Popover label={label}>
            <span className={styles.stack}>
              {chips.map((chip) => (
                <span key={chip.key}>{chip.node}</span>
              ))}
            </span>
          </Popover>
        </DialogTrigger>
      )}
    </span>
  );
}

/** Props for ReadOnlyValue. */
export interface ReadOnlyValueProps {
  readonly attribute: FieldAttribute;
  readonly surface: Surface;
  /** Why, from `readOnlyReasonOf`. Defaults to the attribute's own reason, or the field set's. */
  readonly reason?: string;
  /** The type's display. */
  readonly children: ReactNode;
}

/**
 * Where an editor would be, for a value people can't edit: a system value, a
 * computed one, or a read only attribute. The display in a filled box with a
 * lock, and the reason under it outside cells.
 */
export function ReadOnlyValue({ attribute, surface, reason: given, children }: ReadOnlyValueProps) {
  const reason =
    given ?? attribute.readOnlyReason ?? (attribute.computed === undefined ? strings.readOnly : strings.computed);
  return (
    <span className={styles.readOnly} data-surface={surface}>
      <span className={styles.readOnlyBox} role="group" aria-label={attribute.name}>
        <span className={styles.readOnlyValue}>{children}</span>
        <Icon name="lock" size="xs" tone="muted" />
      </span>
      {surface === 'cell' || surface === 'filter' ? (
        <VisuallyHidden>{reason}</VisuallyHidden>
      ) : (
        <span className={styles.reason}>{reason}</span>
      )}
    </span>
  );
}
