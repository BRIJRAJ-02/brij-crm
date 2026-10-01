// Pieces every display shares: the empty value, and a row of chips that folds
// the rest into "+N" (the conventions' overflow rule: cells measure, cards
// show 3, stories pass a number).
import type { ReactNode } from 'react';
import { Button as AriaButton, DialogTrigger } from 'react-aria-components';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Popover } from '../molecules/Popover/Popover.tsx';
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

/** Props for ChipRow. */
export interface ChipRowProps {
  /** One element per value, keyed. */
  readonly chips: readonly { readonly key: string; readonly node: ReactNode }[];
  /** How many show before "+N"; all when left out. */
  readonly maxVisible?: number;
  /** The popover's name: the attribute ("Team"). */
  readonly label: string;
}

/** Several values in a row; past `maxVisible`, a "+N" chip opens all of them. */
export function ChipRow({ chips, maxVisible, label }: ChipRowProps) {
  const shown = maxVisible === undefined ? chips : chips.slice(0, maxVisible);
  const rest = chips.length - shown.length;
  return (
    <span className={styles.row}>
      {shown.map((chip) => (
        <span key={chip.key} className={styles.chip}>
          {chip.node}
        </span>
      ))}
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
  /** The type's display. */
  readonly children: ReactNode;
}

/**
 * Where an editor would be, for a value people can't edit: a system value, a
 * computed one, or a read only attribute. The display in a filled box with a
 * lock, and the reason under it outside cells.
 */
export function ReadOnlyValue({ attribute, surface, children }: ReadOnlyValueProps) {
  const reason = attribute.readOnlyReason ?? (attribute.computed === undefined ? strings.readOnly : strings.computed);
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
