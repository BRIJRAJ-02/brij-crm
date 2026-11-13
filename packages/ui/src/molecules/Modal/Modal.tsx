import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import { Dialog, DialogTrigger, Heading, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { FOOTER_PRESS_ATTRIBUTE, FooterKeysContext, type FooterKeys } from '../../atoms/Button/footer-keys.ts';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { InPopover } from '../Popover/Popover.tsx';
import styles from './Modal.module.css';
import { strings } from './strings.ts';
import { PageEdge } from '../../lib/page-edge.ts';
import { useToastClearance } from '../../provider/toast-clearance.ts';
import { TOUCH_TARGET } from '../../atoms/Button/touch-target.ts';
import { useKeyboardPlatform } from '../../provider/context.ts';

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
 * `dialog` (the default) for a short ask; `form` for a form of several fields
 * (New record, an attribute's settings), wider; `confirm` for one question
 * before an ending action: small, no title bar, the question in the body;
 * `window` for a larger
 * task with a header (import, merge, settings); `palette` for the command
 * palette: near the top, its title for screen readers only, its body flush,
 * and it never animates; `peek` for a page read and written in place (a
 * note): a large panel nearly the window's height, a quiet bar with the
 * context first as a crumb and no title drawn (the page shows its own), and
 * the body a centred writing column; `drawer` for a long list or detail that belongs beside the page rather than
 * over it (a rotation's member table): a full height panel at the end edge with the standard title bar and
 * footer, that slides in from the end. A public page's sheets (spec 0065, the guest menu): `sheet-card` is a bottom
 * sheet on a phone and a floating card centred over the page from 480px wide (a dish); `sheet-side` is a bottom sheet
 * on a phone and a panel at the end edge from 480px wide (a guest's picks). Both name themselves for screen readers
 * only, as `sheet` does, and wear whatever surface the page around them sets.
 */
export type ModalVariant =
  'dialog' | 'form' | 'confirm' | 'window' | 'palette' | 'peek' | 'sheet' | 'drawer' | 'sheet-card' | 'sheet-side';

/** Props for Modal. */
export interface ModalProps {
  /** The heading, which also names the dialog: a question or the task ("Delete 3 records?"). */
  readonly title: string;
  /**
   * One quiet line under the title, opening the body in the secondary colour: what the dialog makes, where the title
   * alone doesn't say it (New list: "A hand-picked set of people, with its own stages and columns."). It is the
   * dialog's description for screen readers. Not for a `confirm`, whose body is already its one line.
   */
  readonly description?: ReactNode;
  /**
   * The body. A `confirm` whose question says it all (Discard your unsaved changes?) leaves it out: no line is
   * drawn and no description is set, so the title and the two buttons are the whole dialog.
   */
  readonly children?: ReactNode;
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
  /**
   * A side pane at the window's end, beside the body: a preview of what the body picks (the form template gallery's
   * big preview, 5 November 2026). It sits on the page's ground, `size-panel` wide, as tall as the body, and scrolls
   * on its own; where the dialog is too narrow for both (below `bp-page-compact`) it is left out, so it must hold
   * nothing the body needs. Only `window` takes it.
   */
  readonly aside?: ReactNode;
  /**
   * A column at the body's start, beside the fields (a month to pick days from, as Cal.com's date overrides put it):
   * it keeps its own width and the fields take the rest; on a narrow screen it stacks above them. Unlike `aside` it is
   * part of the form, so it is never left out. Not for a confirm or the palette.
   */
  readonly lead?: ReactNode;
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
 * ⌘↵ (Ctrl+Enter elsewhere) anywhere in the dialog presses its footer's primary that acts on press (the footer
 * marks it), as a library Form's ⌘↵ sends its submit: so a Save that is not a Form's submit keeps the key it shows.
 * On the document, after the dialog's own controls have had the key: one that used it (a comment's send, a tile's
 * Enter, a Form's submit) prevents or stops it, and the footer leaves it alone. Only a key pressed inside this
 * dialog counts, never one in a dialog opened over it. The control in use commits on blur first, so the value just
 * typed is the one saved; a primary that is off or busy is left unpressed.
 */
function usePressOnKey(foot: HTMLDivElement | null) {
  const platform = useKeyboardPlatform();
  useEffect(() => {
    if (foot === null) return;
    const dialog = foot.closest('[role="dialog"], [role="alertdialog"]');
    if (dialog === null) return;
    const doc = foot.ownerDocument;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
      if (!mod || event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"]') !== dialog) return;
      const pressed = [...foot.querySelectorAll<HTMLButtonElement>(`[${FOOTER_PRESS_ATTRIBUTE}]`)].at(-1);
      if (pressed === undefined || pressed.disabled || pressed.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      const active = doc.activeElement;
      if (active instanceof HTMLElement && active !== pressed) active.blur();
      timer = setTimeout(() => {
        if (pressed.isConnected && !pressed.disabled && pressed.getAttribute('aria-disabled') !== 'true')
          pressed.click();
      }, 0);
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
    };
  }, [foot, platform]);
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
  description,
  children,
  actions,
  hint,
  footerStart,
  variant = 'dialog',
  isWide = false,
  aside,
  lead,
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
  // Toasts rise above this footer when they would cover it: a drawer's or a sheet's Save at the window's foot.
  const keepToastsOff = useToastClearance();
  const isAlert = tone === 'danger';
  // The palette and a peek name themselves for screen readers only: the palette's field and the peek's page
  // (a note's own title) say what they are on screen.
  const isTitleHidden =
    variant === 'palette' ||
    variant === 'peek' ||
    variant === 'sheet' ||
    variant === 'sheet-card' ||
    variant === 'sheet-side';
  // A confirm asks in its body: no title bar, the question over its one line of consequence.
  const isConfirm = variant === 'confirm';
  const bodyId = useId();
  const descriptionId = useId();
  // The line under the title: any dialog but a confirm, whose body is its one line already.
  const hasDescription = description !== undefined && description !== null && !isConfirm;
  // A confirm may be the question alone; any other dialog always has a body.
  const hasBody = children !== undefined && children !== null && children !== false;
  // The footer's submit shows ↵, or ⌘↵ while the dialog holds a long text or an editor, where Enter writes a line
  // (a field turned editable later counts too), and always for a library Form's submit (`submitForm`).
  const [holdsLongText, setHoldsLongText] = useState(false);
  const watchBody = useCallback((body: HTMLDivElement | null) => {
    if (body === null) return;
    const check = () => {
      setHoldsLongText(body.querySelector('textarea, [contenteditable="true"]') !== null);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
    return () => {
      observer.disconnect();
    };
  }, []);
  // The body, alone or beside a window's side pane.
  const body = (
    <InPopover value={false}>
      <div className={styles.body} ref={watchBody} {...(isConfirm ? {} : { id: bodyId })}>
        {isConfirm && (
          <Heading slot="title" className={styles.question}>
            {title}
          </Heading>
        )}
        {/* Opened from a settings page, its content keeps to the dialog, never the page's edges. */}
        {isConfirm ? (
          hasBody && (
            <div className={styles.consequence} id={bodyId}>
              <PageEdge value={false}>{children}</PageEdge>
            </div>
          )
        ) : (
          <>
            {hasDescription && (
              <p className={styles.description} id={descriptionId}>
                {description}
              </p>
            )}
            {lead === undefined ? (
              <PageEdge value={false}>{children}</PageEdge>
            ) : (
              <div className={styles.split}>
                <div className={styles.lead}>{lead}</div>
                <div className={styles.main}>
                  <PageEdge value={false}>{children}</PageEdge>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </InPopover>
  );
  const footerKeys: FooterKeys = {
    close: strings.closeKey,
    submit: holdsLongText ? strings.submitLongKey : strings.submitKey,
    submitForm: strings.submitLongKey,
    // A plain confirm (Sign out) opens on its primary, so Enter answers it; an alert keeps focus on itself.
    ...(isConfirm && !isAlert ? { primary: strings.submitKey } : {}),
    // Any other dialog's primary that acts on press (Save, Done, Start) is pressed by ⌘↵ from anywhere in it, as a
    // Form's submit is sent; never in an alert, whose commit destroys.
    ...(!isConfirm && !isAlert ? { press: strings.submitLongKey } : {}),
  };
  const [foot, setFoot] = useState<HTMLDivElement | null>(null);
  // Both: toasts keep off the footer (its cleanup kept), and ⌘↵ finds the footer's primary. One function, so a render
  // never lets go of the footer only to take it again.
  const footRef = useCallback(
    (element: HTMLDivElement | null) => {
      setFoot(element);
      const release = keepToastsOff(element);
      return () => {
        release?.();
        setFoot(null);
      };
    },
    [keepToastsOff],
  );
  usePressOnKey(foot);
  return (
    <ModalOverlay
      className={styles.scrim}
      data-variant={variant}
      data-alert={isAlert || undefined}
      // A form holding input dims the page fully, as an alert does: it is waiting on an answer, not a glance.
      data-holds-input={(!isDismissable && !isAlert) || undefined}
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
        data-aside={variant === 'window' && aside !== undefined ? '' : undefined}
        data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      >
        <Dialog
          className={styles.dialog}
          role={isAlert ? 'alertdialog' : 'dialog'}
          {...(hasDescription
            ? { 'aria-describedby': descriptionId }
            : isAlert && hasBody
              ? { 'aria-describedby': bodyId }
              : {})}
        >
          {/* Plain boxes, not header and footer: inside a dialog those read as a second banner and
              contentinfo landmark beside the page's own. */}
          {!isConfirm && (
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
                    {isClosable &&
                      (variant === 'sheet-card' || variant === 'sheet-side' ? (
                        // A guest's sheet: round, filling its 36px disc, pressed across 44px.
                        <Button
                          slot="close"
                          variant="ghost"
                          size="lg"
                          icon="x"
                          label={strings.close}
                          isRound
                          touchTarget={TOUCH_TARGET}
                          isDisabled={isBusy}
                        />
                      ) : (
                        <Button slot="close" variant="ghost" icon="x" label={strings.close} isDisabled={isBusy} />
                      ))}
                  </span>
                )}
            </div>
          )}
          {/* A dialog opened from inside a popover is a page of its own: its fields keep their halo. */}
          {/* A window's side pane sits beside the body (the template gallery's preview); without one, the body alone. */}
          {variant === 'window' && aside !== undefined ? (
            <div className={styles.panes}>
              {body}
              <div className={styles.aside}>
                <PageEdge value={false}>{aside}</PageEdge>
              </div>
            </div>
          ) : (
            body
          )}
          {actions !== undefined && (
            <div className={styles.foot} ref={footRef}>
              {footerStart !== undefined ? (
                <div className={styles.footerStart}>{footerStart}</div>
              ) : (
                hint !== undefined && <p className={styles.hint}>{hint}</p>
              )}
              <FooterKeysContext value={footerKeys}>{actions}</FooterKeysContext>
            </div>
          )}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}
