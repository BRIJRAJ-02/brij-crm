import { ToggleButtonGroup, ToggleButton, type Key } from 'react-aria-components';
import { useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { useSlidingIndicator } from '../Tabs/useSlidingIndicator.ts';
import './SegmentedControl.css';

/** One segment. Give `label`, or only `icon` plus `ariaLabel` for an icon-only control. */
export interface SegmentItem {
  readonly id: string;
  readonly label?: string;
  readonly icon?: ReactNode;
  /** Required when there is no visible label; also shown in a tooltip. */
  readonly ariaLabel?: string;
  readonly isDisabled?: boolean;
}

/** Props for SegmentedControl. */
export interface SegmentedControlProps {
  readonly items: ReadonlyArray<SegmentItem>;
  readonly 'aria-label': string;
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly onSelectionChange?: (key: string) => void;
  /** `md` 36px beside 36px controls (default), `sm` 28px in toolbars. */
  readonly size?: 'sm' | 'md';
  /** `default` is a white raised pill on a grey track; `ink` fills the chosen segment with the primary ink. */
  readonly variant?: 'default' | 'ink';
  /** Stretches to its container, segments share the width. */
  readonly isFullWidth?: boolean;
  readonly isDisabled?: boolean;
}

/** Two to five mutually exclusive choices of how to see the same thing (Table, Board, Calendar; 12h, 24h). A pill slides to the chosen one. */
export function SegmentedControl({ items, selectedKey, defaultSelectedKey, onSelectionChange, size = 'md', variant = 'default', isFullWidth = false, isDisabled, ...rest }: SegmentedControlProps) {
  const [inner, setInner] = useState<string>(defaultSelectedKey ?? items[0]?.id ?? '');
  const key = selectedKey ?? inner;
  const ref = useSlidingIndicator(key);
  const change = (keys: Set<Key>) => {
    const k = [...keys][0];
    if (k === undefined) return;
    setInner(String(k));
    onSelectionChange?.(String(k));
  };
  return (
    <div ref={ref} className={cx('tf-seg', `tf-seg--${size}`, `tf-seg--${variant}`, isFullWidth && 'tf-seg--full')}>
      <span className="tf-seg__pill" aria-hidden="true" />
      <ToggleButtonGroup
        aria-label={rest['aria-label']}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[key]}
        onSelectionChange={change}
        isDisabled={isDisabled}
        className="tf-seg__group"
      >
        {items.map((it) => {
          const iconOnly = it.label === undefined;
          const button = (
            <ToggleButton key={it.id} id={it.id} isDisabled={it.isDisabled} aria-label={iconOnly ? it.ariaLabel : undefined} className={cx('tf-seg__item', iconOnly && 'tf-seg__item--icon')}>
              {it.icon}
              {it.label !== undefined && <span>{it.label}</span>}
            </ToggleButton>
          );
          return iconOnly && it.ariaLabel ? <Tooltip key={it.id} label={it.ariaLabel}>{button}</Tooltip> : button;
        })}
      </ToggleButtonGroup>
    </div>
  );
}
