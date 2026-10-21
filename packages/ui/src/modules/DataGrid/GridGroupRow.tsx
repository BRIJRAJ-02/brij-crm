// A group's header line in the grid (13 Oct reference batch 4): a band tinted
// in the group's hue with a chevron that folds it, its title as the status's
// dot and label, and its count. It stays at the grid's start as columns
// scroll sideways.
import type { KeyboardEvent } from 'react';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import type { GridGroup } from './grid-groups.ts';
import styles from './GridGroupRow.module.css';
import { strings } from './strings.ts';

/** Props for GridGroupRow. */
export interface GridGroupRowProps {
  readonly group: GridGroup;
  /** Its line's `aria-rowindex`. */
  readonly rowIndex: number;
  /** Where its line sits under the header, in pixels, as the rows' own `--row-offset`. */
  readonly offset: number;
  /** The grid's columns: the line's one cell spans them all. */
  readonly colCount: number;
  /** Fold or open it; without, the header only names the group. */
  readonly onToggle?: (groupId: string, isCollapsed: boolean) => void;
  /** Up or Down on the header: the grid moves focus to the line before or after. */
  readonly onStep: (direction: -1 | 1) => void;
}

/** The `data-cell` of a group's header (its fold button, or its title when it doesn't fold): the grid finds it by this. */
export function groupCellKey(groupId: string): string {
  return `group:${groupId}`;
}

/** One group's header line: a row holding one cell, with the fold button when the screen folds groups. */
export function GridGroupRow({ group, rowIndex, colCount, offset, onToggle, onStep }: GridGroupRowProps) {
  const isCollapsed = group.isCollapsed === true;
  const title =
    group.hue === undefined ? (
      <span className={styles.title}>{group.title}</span>
    ) : (
      <StatusDot hue={group.hue}>{group.title}</StatusDot>
    );
  const count = (
    <Badge
      count={group.count}
      max={9_999}
      label={strings.groupRows}
      {...(group.isCountAtLeast === true ? { isAtLeast: true } : {})}
    />
  );
  // A stop in the grid's column of lines, reached by Up and Down (never Tab): Up and Down move on, Left folds,
  // Right opens, Enter or Space toggle (the button's own click); the grid's cell keys never see the rest.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Tab') return;
    event.stopPropagation();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      onStep(event.key === 'ArrowUp' ? -1 : 1);
    } else if ((event.key === 'ArrowLeft' && !isCollapsed) || (event.key === 'ArrowRight' && isCollapsed)) {
      event.preventDefault();
      onToggle?.(group.id, !isCollapsed);
    }
  };
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      className={styles.root}
      data-hue={group.hue ?? 'gray'}
      data-collapsed={isCollapsed || undefined}
      style={{ '--row-offset': `${String(offset)}px` }}
    >
      <div role="gridcell" aria-colindex={1} aria-colspan={colCount} className={styles.cell}>
        {onToggle === undefined ? (
          // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- a stop in the grid's own arrow model, as its cells are
          <span className={styles.head} data-cell={groupCellKey(group.id)} tabIndex={-1} onKeyDown={onKeyDown}>
            {title}
            {count}
          </span>
        ) : (
          <button
            type="button"
            className={styles.head}
            aria-expanded={!isCollapsed}
            data-toggles=""
            data-cell={groupCellKey(group.id)}
            tabIndex={-1}
            onClick={() => {
              onToggle(group.id, !isCollapsed);
            }}
            onKeyDown={onKeyDown}
          >
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size="sm" />
            {title}
            {count}
          </button>
        )}
      </div>
    </div>
  );
}
