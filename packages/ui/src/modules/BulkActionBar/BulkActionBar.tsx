// The bar that shows while records are selected (spec 0003, the view bars):
// how many, the offer to select every matching record, the actions, and the
// progress of one that is running.
import { useEffect, useRef, type ReactNode } from 'react';
import { useKeyboard } from 'react-aria';
import { Toolbar as AriaToolbar } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { ProgressBar } from '../../atoms/ProgressBar/ProgressBar.tsx';
import { FloatingBar } from '../../molecules/FloatingBar/FloatingBar.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './BulkActionBar.module.css';
import { strings } from './strings.ts';

/** Props for BulkActionBar. */
export interface BulkActionBarProps {
  /** How many records are selected. */
  readonly count: number;
  /** How many records match the view, beyond those on screen. */
  readonly total: number;
  /** `total` is a floor: the view's count stopped at it ("10,000+"). */
  readonly isTotalAtLeast?: boolean;
  /** Every matching record is selected, not only those picked. */
  readonly isAllMatching?: boolean;
  /** Offers "Select all N matching" while only some are selected. */
  readonly onSelectAllMatching?: () => void;
  readonly onClear: () => void;
  /** The actions: Buttons such as Add to list, Edit, Delete. */
  readonly children: ReactNode;
  /** A bulk action under way: its label ("Deleting 1,234 records") and how far along. */
  readonly progress?: { readonly label: string; readonly value?: number };
  /** Stops the running action: a Cancel button beside its progress. */
  readonly onCancel?: () => void;
  /**
   * `inline` (the default) sits where it is put; `floating` floats centred
   * over the bottom of its nearest positioned container, above the rows: the
   * DataGrid's frame, through its `floatingBar`.
   */
  readonly placement?: 'inline' | 'floating';
}

/**
 * A floating bar while records are selected: the count, "Select all N
 * matching", the actions as a React Aria toolbar, and Clear. While an action
 * runs, its progress (and Cancel) takes the actions' place. Esc inside it
 * clears the selection. When the button in use goes (Select all, or an action
 * giving way to progress), focus moves to the first action, or to Cancel.
 */
export function BulkActionBar({
  count,
  total,
  isTotalAtLeast = false,
  isAllMatching = false,
  onSelectAllMatching,
  onClear,
  children,
  progress,
  onCancel,
  placement = 'inline',
}: BulkActionBarProps) {
  const { locale } = useFormatSettings();
  const actionsRef = useRef<HTMLSpanElement>(null);
  const focusActions = useRef(false);
  const isRunning = progress !== undefined;
  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === 'Escape' && !isRunning) onClear();
      else event.continuePropagation();
    },
  });
  useEffect(() => {
    const actions = actionsRef.current;
    // Focus that fell to the page with the button it was on comes to the actions, or to Cancel.
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (actions === null || (!focusActions.current && !lost)) return;
    focusActions.current = false;
    if (lost || isRunning) actions.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [isAllMatching, isRunning]);
  const number = (value: number) => memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  // The view's count, with its floor marked ("10,000+").
  const matching = `${number(total)}${isTotalAtLeast ? '+' : ''}`;
  // All matching less any left out: the count itself (then a floor too, while the total is one).
  const chosen = count === total ? matching : `${number(count)}${isTotalAtLeast ? '+' : ''}`;
  return (
    // Esc from anywhere in the bar clears the selection.
    <FloatingBar placement={placement} frameProps={keyboardProps}>
      <AriaToolbar className={styles.root} aria-label={strings.label}>
        {/* While an action runs its progress speaks for it: the selection it started from may be gone. */}
        {progress === undefined && (
          <span className={styles.count} role="status">
            {isAllMatching ? strings.allMatching(chosen) : strings.selected(number(count))}
          </span>
        )}
        {progress === undefined &&
          !isAllMatching &&
          onSelectAllMatching !== undefined &&
          (count < total || isTotalAtLeast) && (
            <Button
              variant="ghost"
              onPress={() => {
                focusActions.current = true;
                onSelectAllMatching();
              }}
            >
              {strings.selectAllMatching(matching)}
            </Button>
          )}
        <span ref={actionsRef} className={styles.actions}>
          {progress === undefined ? (
            children
          ) : (
            <>
              <span className={styles.progress}>
                <ProgressBar
                  label={progress.label}
                  {...(progress.value === undefined
                    ? { isIndeterminate: true }
                    : { value: progress.value, showValue: true })}
                />
              </span>
              {onCancel !== undefined && (
                <Button variant="secondary" onPress={onCancel}>
                  {strings.cancel}
                </Button>
              )}
            </>
          )}
        </span>
        <Button variant="ghost" icon="x" label={strings.clear} onPress={onClear} isDisabled={progress !== undefined} />
      </AriaToolbar>
    </FloatingBar>
  );
}
