import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { FocusScope, mergeProps, useFocusVisible, useKeyboard } from 'react-aria';
import { Dialog, Heading } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { ShortcutTooltip } from '../../atoms/Tooltip/ShortcutTooltip.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import styles from './Panel.module.css';
import { strings } from './strings.ts';
import { PageEdge } from '../../lib/page-edge.ts';
import { pathOf, stepOf } from '../../lib/step-keys.ts';

/** How wide a panel is: `md` (`size-panel`, 400px) for a record, `lg` (`size-panel-wide`, 520px) for notes, email and larger tasks. */
export type PanelWidth = 'md' | 'lg';

/** `sheet` runs the page's full height against its end; `floating` sits inset from the edges on `radius-xl`, for the record panel. */
export type PanelVariant = 'sheet' | 'floating';

/** Props for Panel. */
export interface PanelProps {
  /** Its heading, which also names it ("Northwind Traders", "Notifications"). */
  readonly title: string;
  /** Before the title: the record's avatar. */
  readonly leading?: ReactNode;
  /** One quiet line under the title: what the subject belongs to and when (a submission's form and time). */
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  readonly isOpen: boolean;
  /** Called when the close button or Esc asks it to close. */
  readonly onClose: () => void;
  /** Buttons at the end of its header, before the close button. */
  readonly actions?: ReactNode;
  /** A footer under the content, for a form's buttons. */
  readonly footer?: ReactNode;
  /** At the footer's start, away from its other buttons: a destructive action such as Delete. */
  readonly footerStart?: ReactNode;
  readonly width?: PanelWidth;
  readonly variant?: PanelVariant;
  /** The content runs to the edges and fills the height, for Tabs and lists that scroll themselves. */
  readonly isFlush?: boolean;
  /** The content is a column of sections, space-20 apart: a submission's state, its answers, where it came from. */
  readonly isStacked?: boolean;
  /**
   * ↑ and ↓ inside the panel, where nothing else owns the arrows (a field, tabs, a list, a menu): step to the item
   * above or below in the list the panel was opened from (the record panel).
   */
  readonly onStep?: (step: 'previous' | 'next') => void;
}

type Phase = 'open' | 'exiting' | 'closed';

/**
 * Keeps the panel drawn while its exit animation runs, then lets it go. It
 * stays shown from the moment it opens until its exit animation ends (or at
 * once, when there is no animation to wait for).
 */
function usePresence(isOpen: boolean, element: { readonly current: HTMLElement | null }) {
  const [isShown, setShown] = useState(isOpen);
  if (isOpen && !isShown) setShown(true);
  const phase: Phase = isOpen ? 'open' : isShown ? 'exiting' : 'closed';
  useEffect(() => {
    if (phase !== 'exiting') return;
    let cancelled = false;
    const animations = element.current?.getAnimations() ?? [];
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) setShown(false);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, element]);
  return phase;
}

/**
 * A side panel that slides in from the end with the drawer curve and leaves
 * the page usable beside it: a record, notifications, the assistant. Focus
 * moves into it when it opens and returns to where it came from when it
 * closes; Esc closes it.
 */
export function Panel({
  title,
  leading,
  subtitle,
  children,
  isOpen,
  onClose,
  actions,
  footer,
  footerStart,
  width = 'md',
  variant = 'sheet',
  isFlush = false,
  isStacked = false,
  onStep,
}: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const subtitleId = useId();
  const phase = usePresence(isOpen, ref);
  const { isFocusVisible } = useFocusVisible();
  const [openedBy] = useState(() => (isFocusVisible ? 'keyboard' : 'pointer'));
  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === 'Escape') onClose();
      else event.continuePropagation();
    },
  });
  // ↑ and ↓ step through the list, where nothing in the panel owns the arrows. No motion: a key repeated
  // hundreds of times a day swaps the content at once.
  const onStepKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    // A key from an overlay opened inside the panel (a confirm, a date picker) reaches here through React's tree,
    // not the page's: it belongs to that overlay, never to a step.
    if (onStep === undefined || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const step = stepOf(event, pathOf(event.target, event.currentTarget));
    if (step === undefined) return;
    event.preventDefault();
    onStep(step);
  };
  if (phase === 'closed') return null;
  return (
    // A panel the person opened takes focus, as a dialog does, and gives it back after.
    // eslint-disable-next-line jsx-a11y-x/no-autofocus
    <FocusScope autoFocus restoreFocus>
      <section
        ref={ref}
        className={styles.root}
        data-width={width}
        data-variant={variant}
        data-entering={phase === 'open' || undefined}
        data-exiting={phase === 'exiting' || undefined}
        data-opened-by={openedBy}
        {...mergeProps(keyboardProps, { onKeyDown: onStepKey })}
      >
        <Dialog className={styles.dialog} {...(subtitle === undefined ? {} : { 'aria-describedby': subtitleId })}>
          <header className={styles.head}>
            {leading}
            {subtitle === undefined ? (
              <Heading slot="title" className={styles.title}>
                <TruncatedText>{title}</TruncatedText>
              </Heading>
            ) : (
              <span className={styles.heading}>
                <Heading slot="title" className={styles.title}>
                  <TruncatedText>{title}</TruncatedText>
                </Heading>
                <span id={subtitleId} className={styles.subtitle}>
                  {subtitle}
                </span>
              </span>
            )}
            <span className={styles.actions}>
              {actions}
              <ShortcutTooltip content={strings.close} kbd="ESC">
                <Button variant="ghost" icon="x" label={strings.close} onPress={onClose} />
              </ShortcutTooltip>
            </span>
          </header>
          <div className={styles.body} data-flush={isFlush || undefined} data-stacked={isStacked || undefined}>
            {/* Opened from a settings page, its content keeps to the panel, never the page's edges. */}
            <PageEdge value={false}>{children}</PageEdge>
          </div>
          {(footer !== undefined || footerStart !== undefined) && (
            <footer className={styles.foot}>
              {footerStart !== undefined && <span className={styles.footStart}>{footerStart}</span>}
              {footer}
            </footer>
          )}
        </Dialog>
      </section>
    </FocusScope>
  );
}
