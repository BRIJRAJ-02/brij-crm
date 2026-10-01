import type { ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import { Dialog, DialogTrigger, Heading, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './Modal.module.css';
import { strings } from './strings.ts';

/** Props for ModalTrigger. */
export interface ModalTriggerProps {
  /** The trigger (a Button), then the Modal it opens. */
  readonly children: ReactNode;
  readonly isOpen?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/** Opens a Modal from the Button before it, and puts focus back on the button when it closes. */
export function ModalTrigger({ children, isOpen, defaultOpen, onOpenChange }: ModalTriggerProps) {
  return (
    <DialogTrigger
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {children}
    </DialogTrigger>
  );
}

/** `dialog` (the default) for a question or a short form; `window` for a larger task with a header (import, merge, settings). */
export type ModalVariant = 'dialog' | 'window';

/** Props for Modal. */
export interface ModalProps {
  /** The heading, which also names the dialog: a question or the task ("Delete 3 records?"). */
  readonly title: string;
  readonly children: ReactNode;
  /** The footer's buttons, Cancel first and the primary last. A Button with `slot="close"` closes the modal. */
  readonly actions?: ReactNode;
  readonly variant?: ModalVariant;
  /** A window's header icon. */
  readonly icon?: IconName;
  /** A window's header detail after the title: the record or list it works on. */
  readonly context?: ReactNode;
  /** `danger` makes it an alert dialog that asks before something destructive; a click outside won't close it. */
  readonly tone?: 'default' | 'danger';
  /** For a Modal opened without a ModalTrigger. */
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/**
 * A dialog over the page, which waits for an answer: a confirm, a short form,
 * a larger task. It grows from the centre over a scrim; opened from the
 * keyboard it appears at once. Focus stays inside until it closes, then goes
 * back to its trigger. Esc closes it, and so does a click outside unless it
 * asks before something destructive.
 */
export function Modal({
  title,
  children,
  actions,
  variant = 'dialog',
  icon,
  context,
  tone = 'default',
  isOpen,
  onOpenChange,
}: ModalProps) {
  const { isFocusVisible } = useFocusVisible();
  const isAlert = tone === 'danger';
  return (
    <ModalOverlay
      className={styles.scrim}
      isDismissable={!isAlert}
      data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <AriaModal
        className={styles.root}
        data-variant={variant}
        data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      >
        <Dialog className={styles.dialog} role={isAlert ? 'alertdialog' : 'dialog'}>
          <header className={styles.head}>
            {isAlert ? (
              <span className={styles.alert}>
                <Icon name="triangle-alert" size="md" />
              </span>
            ) : (
              icon !== undefined && <Icon name={icon} size="sm" tone="muted" />
            )}
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            {context !== undefined && <span className={styles.context}>{context}</span>}
            {variant === 'window' && (
              <span className={styles.close}>
                <Button slot="close" variant="ghost" icon="x" label={strings.close} />
              </span>
            )}
          </header>
          <div className={styles.body}>{children}</div>
          {actions !== undefined && <footer className={styles.foot}>{actions}</footer>}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}
