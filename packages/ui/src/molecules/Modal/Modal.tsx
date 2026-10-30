import { useId, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import { Dialog, DialogTrigger, Heading, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { InPopover } from '../Popover/Popover.tsx';
import styles from './Modal.module.css';
import { strings } from './strings.ts';
import { PageEdge } from '../../lib/page-edge.ts';

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

/**
 * `dialog` (the default) for a question or a short form; `window` for a larger
 * task with a header (import, merge, settings); `palette` for the command
 * palette: near the top, its title for screen readers only, its body flush,
 * and it never animates; `peek` for a page read and written in place (a
 * note): a large panel nearly the window's height, a quiet bar with the
 * context first as a crumb and no title drawn (the page shows its own), and
 * the body a centred writing column.
 */
export type ModalVariant = 'dialog' | 'window' | 'palette' | 'peek' | 'sheet';

/** Props for Modal. */
export interface ModalProps {
  /** The heading, which also names the dialog: a question or the task ("Delete 3 records?"). */
  readonly title: string;
  readonly children: ReactNode;
  /** The footer's buttons, Cancel first and the primary last. A Button with `slot="close"` closes the modal. */
  readonly actions?: ReactNode;
  /**
   * A quiet line at the start of the footer, before the buttons: what pressing the primary will do beyond the
   * obvious ("It goes to the end of the section. Drag it anywhere afterwards."). Needs `actions`.
   */
  readonly hint?: ReactNode;
  /**
   * A control at the start of the footer, before the buttons: a choice about what the primary does next (New
   * record's "Create more" Switch). Needs `actions`; takes the place of `hint`.
   */
  readonly footerStart?: ReactNode;
  readonly variant?: ModalVariant;
  /**
   * A wider window (`size-dialog-wide` plus a `size-column`, 980px), for a reference laid out as a settings page:
   * a rail of sections beside their content (the marketing site's All features, 23 October 2026). Only `window`
   * takes it.
   */
  readonly isWide?: boolean;
  /** A window's header icon (a peek draws none). */
  readonly icon?: IconName;
  /** A window's header detail after the title: the record or list it works on. A peek shows it first, as a crumb. */
  readonly context?: ReactNode;
  /**
   * Quiet icon buttons in the title bar, before Close, each with its Tooltip
   * (a task's Copy link): actions about the thing the dialog shows, which a
   * footer band holding only them would make heavy.
   */
  readonly headerActions?: ReactNode;
  /**
   * A short word about what the dialog shows, before the header actions, in
   * the secondary colour and announced politely when it changes: a note's
   * "Saving…" or "Saved".
   */
  readonly status?: ReactNode;
  /**
   * `danger` makes it an alert dialog that asks before something destructive; a click outside won't close it, and
   * its body is the dialog's description, so a screen reader says what happens with the question.
   */
  readonly tone?: 'default' | 'danger';
  /**
   * `false` keeps a click outside from closing it: a form with typed input,
   * which only Cancel or Esc should throw away. An alert is never dismissable.
   */
  readonly isDismissable?: boolean;
  /** While it works (a form saving, a confirm's commit): the title bar's close button, a click outside and Esc wait. */
  readonly isBusy?: boolean;
  /**
   * `false` keeps the person on a step until they answer it with the footer's buttons: no close button in the title
   * bar, and Esc and a click outside do nothing. For what can't be shown again (two factor's backup codes, until
   * "I've saved these" is ticked); never for an ordinary form, which Esc should always be able to leave.
   */
  readonly isClosable?: boolean;
  /** For a Modal opened without a ModalTrigger. */
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/**
 * A dialog over the page, which waits for an answer: a confirm, a short form,
 * a larger task. Its title bar holds the title and a close button (an alert
 * asks with its buttons only). It sits at a fixed distance from the top, so a
 * line added inside (an error) grows it downwards and never moves it. It
 * grows from the centre over a scrim; opened from the keyboard it appears at
 * once. Focus stays inside until it closes, then goes
 * back to its trigger. Esc closes it, and so does a click outside unless it
 * asks before something destructive, holds typed input, or is busy saving. A
 * step that must be answered (`isClosable={false}`) has no close button and
 * ignores both, until its caller lets it close.
 */
export function Modal({
  title,
  children,
  actions,
  hint,
  footerStart,
  variant = 'dialog',
  isWide = false,
  icon,
  context,
  headerActions,
  status,
  tone = 'default',
  isDismissable = true,
  isBusy = false,
  isClosable = true,
  isOpen,
  onOpenChange,
}: ModalProps) {
  const { isFocusVisible } = useFocusVisible();
  const isAlert = tone === 'danger';
  // The palette and a peek name themselves for screen readers only: the palette's field and the peek's page
  // (a note's own title) say what they are on screen.
  const isTitleHidden = variant === 'palette' || variant === 'peek' || variant === 'sheet';
  const bodyId = useId();
  return (
    <ModalOverlay
      className={styles.scrim}
      data-variant={variant}
      isDismissable={!isAlert && isDismissable && !isBusy && isClosable}
      isKeyboardDismissDisabled={isBusy || !isClosable}
      data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <AriaModal
        className={styles.root}
        data-variant={variant}
        data-wide={isWide && variant === 'window' ? '' : undefined}
        data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      >
        <Dialog
          className={styles.dialog}
          role={isAlert ? 'alertdialog' : 'dialog'}
          {...(isAlert ? { 'aria-describedby': bodyId } : {})}
        >
          {/* Plain boxes, not header and footer: inside a dialog those read as a second banner and
              contentinfo landmark beside the page's own. */}
          <div className={styles.head}>
            {isAlert ? (
              <span className={styles.alert}>
                <Icon name="triangle-alert" size="md" />
              </span>
            ) : (
              icon !== undefined && variant !== 'peek' && <Icon name={icon} size="sm" tone="muted" />
            )}
            {isTitleHidden ? (
              <VisuallyHidden>
                <Heading slot="title">{title}</Heading>
              </VisuallyHidden>
            ) : (
              <Heading slot="title" className={styles.title}>
                {title}
              </Heading>
            )}
            {context !== undefined && <span className={styles.context}>{context}</span>}
            {/* Every dialog but the palette and an alert has the close button in its title bar, unless it keeps the
                person until they answer (isClosable false). */}
            {variant !== 'palette' &&
              !isAlert &&
              (isClosable || status !== undefined || headerActions !== undefined) && (
                <span className={styles.close}>
                  {status !== undefined && (
                    <span className={styles.status} role="status" aria-live="polite">
                      {status}
                    </span>
                  )}
                  {headerActions}
                  {isClosable && (
                    <Button slot="close" variant="ghost" icon="x" label={strings.close} isDisabled={isBusy} />
                  )}
                </span>
              )}
          </div>
          {/* A dialog opened from inside a popover is a page of its own: its fields keep their halo. */}
          <InPopover value={false}>
            <div className={styles.body} id={bodyId}>
              {/* Opened from a settings page, its content keeps to the dialog, never the page's edges. */}
              <PageEdge value={false}>{children}</PageEdge>
            </div>
          </InPopover>
          {actions !== undefined && (
            <div className={styles.foot}>
              {footerStart !== undefined ? (
                <div className={styles.footerStart}>{footerStart}</div>
              ) : (
                hint !== undefined && <p className={styles.hint}>{hint}</p>
              )}
              {actions}
            </div>
          )}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}
