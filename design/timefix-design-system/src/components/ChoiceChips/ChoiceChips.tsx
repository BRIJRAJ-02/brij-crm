import { ToggleButtonGroup, ToggleButton, type Key } from 'react-aria-components';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import type { Hue } from '../Tag/Tag.tsx';
import './ChoiceChips.css';

/** One chip: an id, its words, and an optional hue dot (a select option's colour). */
export interface ChoiceChip {
  readonly id: string;
  readonly label: string;
  readonly dot?: Hue;
  readonly isDisabled?: boolean;
}

/** Props for ChoiceChips. */
export interface ChoiceChipsProps {
  /** Names the group; shown above the chips unless `isLabelHidden`. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly items: readonly ChoiceChip[];
  /** `single` behaves like radios (arrows move, one is always chosen once picked); `multiple` like checkboxes. */
  readonly selectionMode?: 'single' | 'multiple';
  readonly selectedKeys?: Iterable<string>;
  readonly defaultSelectedKeys?: Iterable<string>;
  readonly onSelectionChange?: (keys: ReadonlySet<string>) => void;
  /** `md` 36px on guest pages and forms, `sm` 28px in the app. */
  readonly size?: 'sm' | 'md';
  readonly isDisabled?: boolean;
  /** Something after the chips on their row: a "Clear" ghost button. */
  readonly end?: ReactNode;
  readonly className?: string;
}

/** Pick one or several visible options as pills. A chosen chip turns ink and its check swaps in. */
export function ChoiceChips({ label, isLabelHidden = false, items, selectionMode = 'single', selectedKeys, defaultSelectedKeys, onSelectionChange, size = 'md', isDisabled, end, className }: ChoiceChipsProps) {
  const id = useId();
  return (
    <div className={cx('tf-chips', `tf-chips--${size}`, className)}>
      {!isLabelHidden && <span id={id} className="tf-chips__label">{label}</span>}
      <div className="tf-chips__row">
        <ToggleButtonGroup
          className="tf-chips__group"
          aria-labelledby={isLabelHidden ? undefined : id}
          aria-label={isLabelHidden ? label : undefined}
          selectionMode={selectionMode}
          disallowEmptySelection={selectionMode === 'single'}
          selectedKeys={selectedKeys}
          defaultSelectedKeys={defaultSelectedKeys}
          onSelectionChange={(keys: Set<Key>) => onSelectionChange?.(new Set([...keys].map(String)))}
          isDisabled={isDisabled}
        >
          {items.map((it) => (
            <ToggleButton key={it.id} id={it.id} isDisabled={it.isDisabled} className="tf-chip">
              <span className={cx('tf-chip__mark', it.dot && 'tf-chip__mark--dot')} aria-hidden="true">
                {it.dot && <span className="tf-chip__dot" style={{ '--tf-chip-dot': `var(--dot-${it.dot})` } as CSSProperties} />}
                <svg className="tf-chip__check" viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
              </span>
              {it.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {end}
      </div>
    </div>
  );
}
