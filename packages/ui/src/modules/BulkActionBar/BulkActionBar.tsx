// The bar that shows while records are selected (spec 0003, the view bars):
// how many, the offer to select every matching record, the actions, and the
// progress of one that is running.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusVisible, useKeyboard } from 'react-aria';
import { Toolbar as AriaToolbar } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { ProgressBar } from '../../atoms/ProgressBar/ProgressBar.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { FloatingBar } from '../../molecules/FloatingBar/FloatingBar.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './BulkActionBar.module.css';
import { strings } from './strings.ts';

/** A bulk action under way: its label ("Deleting 4,500 of 12,345") and how far along, from 0 to 100 when known. */
export interface BulkProgress {
  readonly label: string;
  readonly value?: number;
}

/** Props for BulkActionBar. */
export interface BulkActionBarProps {
  /** How many records are selected. 0 leaves the count and the offer out (a change started with nothing ticked). */
  readonly count: number;
  /** How many records match the view, beyond those on screen. */
  readonly total: number;
  /** `total` is a floor: the view's count stopped at it ("10,000+"). */
  readonly isTotalAtLeast?: boolean;
  /** Every matching record is selected, not only those picked. */
  readonly isAllMatching?: boolean;
  /** Offers "Select all N matching" while only some are selected. Leave it out when no action could follow. */
  readonly onSelectAllMatching?: () => void;
  readonly onClear: () => void;
  /** The actions: Buttons such as Add to list, Edit, Delete, and a note beside them (a Callout in the bar). */
  readonly children: ReactNode;
  /** A bulk action under way: its progress (and Cancel) take the actions' place. */
  readonly progress?: BulkProgress;
  /** Stops the running action: a Cancel button beside its progress. */
  readonly onCancel?: () => void;
  /** The running action is stopping after its current batch: Cancel stays, pending, and reads "Cancelling". */
  readonly isCancelling?: boolean;
  /** The action is counted and waits to be confirmed: Review, beside Cancel, opens its confirm. */
  readonly onReview?: () => void;
  /**
   * `inline` (the default) sits where it is put; `floating` floats centred
   * over the bottom of its nearest positioned container, above the rows: the
   * DataGrid's frame, through its `floatingBar`.
   */
  readonly placement?: 'inline' | 'floating';
  /**
   * False sends it away: it sinks out (at once after a key), inert, keeping
   * what it last said, then calls `onLeft` and draws nothing. Keep it
   * mounted while it leaves, so the exit plays.
   */
  readonly isOpen?: boolean;
  /** Called once it has left, so the owner can stop making room for it (the DataGrid's `floatingBar`). */
  readonly onLeft?: () => void;
  /**
   * A new object asks the bar to take focus once something in it can (Cancel,
   * Review, or the first action), after any closing overlay has gone: a
   * change started from outside the bar (Empty trash, in the top bar).
   */
  readonly focusRequest?: object;
}

/** What the bar shows, kept from its last open moment while it leaves, so its words never change as it goes. */
interface Shown {
  readonly count: number;
  readonly total: number;
  readonly isTotalAtLeast: boolean;
  readonly isAllMatching: boolean;
  readonly hasOffer: boolean;
  readonly progress: BulkProgress | undefined;
  readonly hasCancel: boolean;
  readonly isCancelling: boolean;
  readonly hasReview: boolean;
}

const isSame = (a: Shown, b: Shown): boolean =>
  a.count === b.count &&
  a.total === b.total &&
  a.isTotalAtLeast === b.isTotalAtLeast &&
  a.isAllMatching === b.isAllMatching &&
  a.hasOffer === b.hasOffer &&
  a.progress?.label === b.progress?.label &&
  a.progress?.value === b.progress?.value &&
  a.hasCancel === b.hasCancel &&
  a.isCancelling === b.isCancelling &&
  a.hasReview === b.hasReview;

/**
 * A progress label's words without its numbers ("Deleting of"), so the bar
 * speaks when a running action moves to a new step (counted, running,
 * stopping), never at each tick of its numbers.
 */
const wordsOf = (label: string | undefined): string =>
  label === undefined ? '' : label.replace(/[\p{N}\s.,'’]+/gu, ' ').trim();

/** Whether focus fell to the page, or sits on something that left (made inert as its bar goes). */
const isFocusLost = (): boolean => {
  const active = document.activeElement;
  return active === null || active === document.body || active.closest('[inert]') !== null;
};

/**
 * A floating bar while records are selected: the count, "Select all N
 * matching", the actions as a React Aria toolbar, and Clear. While an action
 * runs, its progress (with Review once it is counted, and Cancel) takes the
 * actions' place, and its steps are said politely. Esc inside it clears the
 * selection. When the control in use goes (Select all, an action giving way to
 * progress, Review once its confirm went through, a confirm that closed),
 * focus moves to Cancel, Review or the first action once any closing overlay
 * has gone, so it never falls to the page. It rises in and sinks out, at once
 * when opened or closed from the keyboard.
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
  isCancelling = false,
  onReview,
  placement = 'inline',
  isOpen = true,
  onLeft,
  focusRequest,
}: BulkActionBarProps) {
  const { locale } = useFormatSettings();
  // Opened or closed from the keyboard: it comes and goes at once (read each render, so it knows how it was opened).
  const { isFocusVisible } = useFocusVisible();
  const [isMounted, setMounted] = useState(isOpen);
  if (isOpen && !isMounted) setMounted(true);
  const now: Shown = {
    count,
    total,
    isTotalAtLeast,
    isAllMatching,
    hasOffer: onSelectAllMatching !== undefined,
    progress,
    hasCancel: onCancel !== undefined || isCancelling,
    isCancelling,
    hasReview: onReview !== undefined,
  };
  const [kept, setKept] = useState(now);
  if (isOpen && !isSame(kept, now)) setKept(now);
  const shown = isOpen ? now : kept;
  const isRunning = shown.progress !== undefined;

  // The steps of a running action, said when its words change (Counting…, 12,345 people counted, Stopping…).
  const words = wordsOf(shown.progress?.label);
  const [said, setSaid] = useState({ words, text: shown.progress?.label ?? '' });
  if (words !== said.words) setSaid({ words, text: shown.progress?.label ?? '' });

  const actionsRef = useRef<HTMLSpanElement>(null);
  // Focus the bar was asked to take (Select all pressed, `focusRequest`), held until something here can take it.
  const wantsFocus = useRef(false);
  const latest = useRef({ isRunning });
  useLayoutEffect(() => {
    latest.current = { isRunning };
  });
  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === 'Escape' && !isRunning) onClear();
      else event.continuePropagation();
    },
  });

  // Hands focus to Cancel or Review while an action runs, else to the first action, once overlays have closed.
  const takeFocus = () => {
    focusLater(() => {
      if (!wantsFocus.current && !isFocusLost()) return null;
      const found = actionsRef.current?.querySelector<HTMLElement>('button:not([disabled])') ?? null;
      // Still starting, with nothing to take it yet: the next step hands it on.
      if (found !== null || !latest.current.isRunning) wantsFocus.current = false;
      return found;
    });
  };
  const hasCancel = shown.hasCancel;
  const hasReview = shown.hasReview;
  const steps = useRef({ isAllMatching, isRunning, hasCancel, hasReview });
  useEffect(() => {
    const before = steps.current;
    steps.current = { isAllMatching, isRunning, hasCancel, hasReview };
    if (
      before.isAllMatching === isAllMatching &&
      before.isRunning === isRunning &&
      before.hasCancel === hasCancel &&
      before.hasReview === hasReview
    ) {
      return;
    }
    // These are the changes that can take the control in use away; takeFocus reads refs only.
    takeFocus();
  }, [isAllMatching, isRunning, hasCancel, hasReview]);
  useEffect(() => {
    if (focusRequest === undefined) return;
    // A new request object is the only thing that asks.
    wantsFocus.current = true;
    takeFocus();
  }, [focusRequest]);

  if (!isMounted) return null;
  const number = (value: number) => memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  // The view's count, with its floor marked ("10,000+").
  const matching = `${number(shown.total)}${shown.isTotalAtLeast ? '+' : ''}`;
  // All matching less any left out: the count itself (then a floor too, while the total is one).
  const chosen = shown.count === shown.total ? matching : `${number(shown.count)}${shown.isTotalAtLeast ? '+' : ''}`;
  const hasCount = !isRunning && shown.count > 0;
  const value = shown.progress?.value;
  return (
    // Esc from anywhere in the bar clears the selection.
    <FloatingBar
      placement={placement}
      frameProps={keyboardProps}
      isLeaving={!isOpen}
      isInstant={isFocusVisible}
      onLeft={() => {
        setMounted(false);
        onLeft?.();
      }}
    >
      <AriaToolbar className={styles.root} aria-label={strings.label}>
        {/* While an action runs its progress speaks for it: the selection it started from may be gone. */}
        {hasCount && (
          <span className={styles.count} role="status">
            {shown.isAllMatching ? strings.allMatching(chosen) : strings.selected(number(shown.count))}
          </span>
        )}
        {hasCount && !shown.isAllMatching && shown.hasOffer && (shown.count < shown.total || shown.isTotalAtLeast) && (
          <Button
            variant="ghost"
            onPress={() => {
              wantsFocus.current = true;
              onSelectAllMatching?.();
            }}
          >
            {strings.selectAllMatching(matching)}
          </Button>
        )}
        <span ref={actionsRef} className={styles.actions} data-alone={!hasCount || undefined}>
          {shown.progress === undefined ? (
            children
          ) : (
            <>
              <span className={styles.progress}>
                <ProgressBar
                  label={shown.progress.label}
                  {...(value === undefined
                    ? { isIndeterminate: true }
                    : // Counted, the full bar stands for the count: no percentage beside it.
                      { value, showValue: !shown.hasReview })}
                />
              </span>
              {shown.hasReview && (
                <Button variant="primary" onPress={onReview}>
                  {strings.review}
                </Button>
              )}
              {shown.hasCancel && (
                <Button variant="secondary" isPending={shown.isCancelling} onPress={onCancel}>
                  {shown.isCancelling ? strings.cancelling : strings.cancel}
                </Button>
              )}
            </>
          )}
        </span>
        <Button variant="ghost" icon="x" label={strings.clear} onPress={onClear} isDisabled={isRunning} />
        <VisuallyHidden>
          <span role="status">{said.text}</span>
        </VisuallyHidden>
      </AriaToolbar>
    </FloatingBar>
  );
}
