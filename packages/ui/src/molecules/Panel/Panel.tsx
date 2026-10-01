import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FocusScope, useFocusVisible, useKeyboard } from 'react-aria';
import { Dialog, Heading } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import styles from './Panel.module.css';
import { strings } from './strings.ts';

/** How wide a panel is: `md` (`size-panel`, 400px) for a record, `lg` (`size-panel-wide`, 520px) for notes, email and larger tasks. */
export type PanelWidth = 'md' | 'lg';

/** Props for Panel. */
export interface PanelProps {
  /** Its heading, which also names it ("Northwind Traders", "Notifications"). */
  readonly title: string;
  readonly children: ReactNode;
  readonly isOpen: boolean;
  /** Called when the close button or Esc asks it to close. */
  readonly onClose: () => void;
  /** Buttons at the end of its header, before the close button. */
  readonly actions?: ReactNode;
  /** A footer under the content, for a form's buttons. */
  readonly footer?: ReactNode;
  readonly width?: PanelWidth;
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
export function Panel({ title, children, isOpen, onClose, actions, footer, width = 'md' }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const phase = usePresence(isOpen, ref);
  const { isFocusVisible } = useFocusVisible();
  const [openedBy] = useState(() => (isFocusVisible ? 'keyboard' : 'pointer'));
  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === 'Escape') onClose();
      else event.continuePropagation();
    },
  });
  if (phase === 'closed') return null;
  return (
    // A panel the person opened takes focus, as a dialog does, and gives it back after.
    // eslint-disable-next-line jsx-a11y-x/no-autofocus
    <FocusScope autoFocus restoreFocus>
      <section
        ref={ref}
        className={styles.root}
        data-width={width}
        data-entering={phase === 'open' || undefined}
        data-exiting={phase === 'exiting' || undefined}
        data-opened-by={openedBy}
        {...keyboardProps}
      >
        <Dialog className={styles.dialog}>
          <header className={styles.head}>
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            <span className={styles.actions}>
              {actions}
              <Button variant="ghost" icon="x" label={strings.close} onPress={onClose} />
            </span>
          </header>
          <div className={styles.body}>{children}</div>
          {footer !== undefined && <footer className={styles.foot}>{footer}</footer>}
        </Dialog>
      </section>
    </FocusScope>
  );
}
