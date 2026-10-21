import { lazy, Suspense, useRef, type JSX, type ReactNode, type Ref } from 'react';
import {
  Button as AriaButton,
  Link as AriaLink,
  ToggleButton as AriaToggleButton,
  type PressEvent,
} from 'react-aria-components';
import { safeHref } from '../../lib/safe-href.ts';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import { Kbd } from '../Kbd/Kbd.tsx';
import { ProviderMark, type ProviderName } from '../ProviderMark/ProviderMark.tsx';
import { keyShortcuts, type KeyboardPlatform } from '../Kbd/shortcuts.ts';
import { useKeyboardPlatform } from '../../provider/context.ts';
import { Spinner } from '../Spinner/Spinner.tsx';
import styles from './Button.module.css';

/** `secondary` (the default) for view controls and Cancel, `primary` for the one action that commits, `danger` for a control that starts a destructive action (Delete in a bar, Archive in settings), `danger-solid` for the final commit that destroys (Delete in a confirm), `ghost` for quiet and undo style actions, `ghost-danger` for a quiet icon button that deletes at once with an Undo (red only under the pointer or focus), `dashed` for "add a condition". */
export type ButtonVariant = 'secondary' | 'primary' | 'danger' | 'danger-solid' | 'ghost' | 'ghost-danger' | 'dashed';

/** `md` is the 26px control height; `lg` matches a 30px input beside it; `sm` is a chip's 20px, for an icon only Remove beside a chip inside a field. */
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonLook {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** A trailing icon, such as `chevron-down` on a button that opens a menu. */
  readonly iconRight?: IconName;
  /** Keycaps shown after the label: `ESC`, `⌘↵`, or several. */
  readonly kbd?: string | readonly string[];
  /**
   * Fills its row. `true` puts the label at the start and the keycaps at the
   * end (the sidebar's Quick actions); `'center'` keeps the label in the
   * middle (a form's submit, and the other ways to go on under it, on a sign
   * in page).
   */
  readonly isFullWidth?: boolean | 'center';
  /**
   * In a narrow bar (its container under 480px, a phone) the label hides and
   * the icon stands alone. Needs an `icon`, and a `label` so the name stays
   * when the words go: the view bar's View settings.
   */
  readonly isLabelCollapsible?: boolean;
  readonly isDisabled?: boolean;
  /** A slot a parent fills, such as `close` inside a toast or a dialog. */
  readonly slot?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

interface LabelledFace {
  /** The label: a verb in sentence case ("Add to list"). */
  readonly children: string;
  /** A leading icon. */
  readonly icon?: IconName;
  /**
   * A brand's own mark in the icon's place (Continue with Google, Add to
   * Google Calendar), drawn by ProviderMark as the brand publishes it.
   */
  readonly provider?: ProviderName;
  /**
   * A fuller accessible name, when the visible label is a short word its place
   * explains (Captures' "New", named "New form"). It must start with the
   * visible label, so speech input can still say what it sees (WCAG 2.5.3).
   */
  readonly label?: string;
}

interface IconOnlyFace {
  readonly children?: never;
  readonly icon: IconName;
  readonly provider?: never;
  /** The accessible name, required because the icon is the only content. */
  readonly label: string;
}

type ButtonFace = LabelledFace | IconOnlyFace;

/** Props for Button: a label (with an optional icon and a fuller `label` name), or an icon with a `label` for its name. */
export type ButtonProps = ButtonLook &
  ButtonFace & {
    readonly onPress?: (event: PressEvent) => void;
    /**
     * Shows a spinner in place of the icon and ignores presses, while staying focusable. Change the label to the
     * ongoing verb ("Saving"), unless the button must hold its width: then keep it and give a `label`, which React
     * Aria extends with the spinner's "In progress".
     */
    readonly isPending?: boolean;
    readonly type?: 'button' | 'submit' | 'reset';
    /** The `id` of the form it submits when it sits outside it, such as a Modal's footer submitting a Form in its body. */
    readonly form?: string;
    /** The `id` of text that says more about it, such as the line under a disabled button saying when it turns on. */
    readonly 'aria-describedby'?: string;
    /**
     * A disclosure: the button opens and closes the region `controls` names
     * (a guest's Move or Guests panel). Read out as expanded or collapsed, and
     * drawn as a ToggleButton held down while open (a danger button keeps its red).
     */
    readonly isExpanded?: boolean;
    /** The `id` of the region an `isExpanded` button opens. */
    readonly controls?: string;
    /** Takes focus when it mounts: the safe choice a dialog opens on, such as Cancel beside Replace. */
    readonly autoFocus?: boolean;
    /**
     * Shows the whole label in a tooltip when it is cut short: a picker held
     * to a fixed width (a builder's attribute). Measured only as the tooltip
     * is about to open, like TruncatedText.
     */
    readonly tooltipWhenCut?: boolean;
  };

/** Props for ToggleButton: a button that stays pressed, such as Bold in a format toolbar. */
export type ToggleButtonProps = Omit<ButtonLook, 'kbd'> &
  ButtonFace & {
    readonly isSelected?: boolean;
    readonly defaultSelected?: boolean;
    readonly onChange?: (isSelected: boolean) => void;
    /** Its key inside a toggle group (ChoiceChips), which then holds whether it is selected. */
    readonly id?: string;
  };

/** The data attributes that pick a look from the CSS module. */
function lookAttributes(look: ButtonLook, face: ButtonFace) {
  return {
    'data-variant': look.variant ?? 'secondary',
    'data-size': look.size ?? 'md',
    'data-icon-only': face.children === undefined || undefined,
    'data-full-width': look.isFullWidth === 'center' ? 'center' : look.isFullWidth === true ? 'start' : undefined,
    'data-collapsible': look.isLabelCollapsible === true || undefined,
  };
}

function capsOf(kbd: ButtonLook['kbd']): readonly string[] {
  return kbd === undefined ? [] : typeof kbd === 'string' ? [kbd] : kbd;
}

/**
 * The shortcut as aria-keyshortcuts, so screen readers hear it as a shortcut,
 * not as part of the name. React Aria's Button doesn't pass the attribute
 * through, so it goes on the element through Button's `render`.
 */
function shortcutAttribute(kbd: ButtonLook['kbd'], platform: KeyboardPlatform) {
  const caps = capsOf(kbd);
  if (caps.length === 0) return {};
  const shortcut = keyShortcuts(caps, platform);
  return {
    render: (element: JSX.IntrinsicElements['button']) => <button {...element} aria-keyshortcuts={shortcut} />,
  };
}

// Keycaps are for sight; the button states its shortcut through aria-keyshortcuts.
function keycaps(kbd: ButtonLook['kbd'], variant: ButtonVariant): ReactNode {
  const caps = capsOf(kbd);
  if (caps.length === 0) return null;
  return (
    <span className={styles.keys} aria-hidden="true">
      {caps.map((cap) => (
        <Kbd key={cap} tone={variant === 'primary' ? 'onAccent' : 'soft'}>
          {cap}
        </Kbd>
      ))}
    </span>
  );
}

function Face({ face, look, isPending }: { face: ButtonFace; look: ButtonLook; isPending: boolean }) {
  const variant = look.variant ?? 'secondary';
  return (
    <>
      {isPending ? (
        <Spinner />
      ) : face.icon !== undefined ? (
        <Icon name={face.icon} size={look.size === 'sm' ? 'xs' : 'sm'} />
      ) : (
        face.provider !== undefined && <ProviderMark provider={face.provider} size={look.size === 'lg' ? 'md' : 'sm'} />
      )}
      {face.children !== undefined && <span className={styles.label}>{face.children}</span>}
      {keycaps(look.kbd, variant)}
      {look.iconRight !== undefined && <Icon name={look.iconRight} size="sm" />}
    </>
  );
}

/**
 * The one button. Built on React Aria's Button, so it answers to Enter and
 * Space, shows a focus ring only for the keyboard, and scales to 0.97 while
 * pressed. One `primary` per surface.
 */
export function Button(props: ButtonProps) {
  if (props.tooltipWhenCut === true && props.children !== undefined) return <CutButton {...props} />;
  return <PlainButton {...props} />;
}

// A cut label's tooltip loads on its own: Tooltip brings React Aria's overlay code, which the first load
// (the toasts' Buttons) never needs. Until it arrives the plain button stands in, the same element.
const LazyCutButton = lazy(() => import('./CutButton.tsx').then((module) => ({ default: module.CutButton })));

/** A Button whose label shows whole in a tooltip when it is cut short (`tooltipWhenCut`). */
function CutButton(props: ButtonProps & { readonly children: string }) {
  const own = useRef<HTMLButtonElement>(null);
  const { ref } = props;
  const button = (
    <PlainButton
      {...props}
      ref={(element: HTMLButtonElement | null) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref !== undefined && ref !== null) ref.current = element;
      }}
    />
  );
  return (
    <Suspense fallback={button}>
      <LazyCutButton label={props.children} labelClass={styles.label ?? ''} target={own}>
        {button}
      </LazyCutButton>
    </Suspense>
  );
}

function PlainButton(props: ButtonProps) {
  const { onPress, isPending = false, type = 'button', isDisabled, slot, form, ref } = props;
  const describedBy = props['aria-describedby'];
  const face: ButtonFace = props;
  const platform = useKeyboardPlatform();
  return (
    <AriaButton
      ref={ref}
      type={type}
      className={styles.root}
      isDisabled={isDisabled ?? false}
      isPending={isPending}
      {...(slot === undefined ? {} : { slot })}
      {...(form === undefined ? {} : { form })}
      {...(onPress === undefined ? {} : { onPress })}
      {...(face.label === undefined ? {} : { 'aria-label': face.label })}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      {...(props.isExpanded === undefined ? {} : { 'aria-expanded': props.isExpanded })}
      {...(props.isExpanded === true && props.controls !== undefined ? { 'aria-controls': props.controls } : {})}
      {...(props.isExpanded === true ? { 'data-expanded': '' } : {})}
      {...(props.autoFocus === true ? { autoFocus: true } : {})}
      {...shortcutAttribute(props.kbd, platform)}
      {...lookAttributes(props, face)}
    >
      <Face face={face} look={props} isPending={isPending} />
    </AriaButton>
  );
}

/** Props for ButtonLink: a Button's look and face, and where it goes. */
export type ButtonLinkProps = Omit<ButtonLook, 'kbd' | 'slot' | 'ref'> &
  ButtonFace & {
    /** An `http`, `https`, `mailto` or `tel` address, or a path; anything else draws a disabled button. */
    readonly href: string;
    /** Opens in a new tab: a link out of a page the visitor should keep. */
    readonly isExternal?: boolean;
    /** Saves the address as a file with this name (a calendar's .ics) instead of opening it. */
    readonly download?: string;
  };

/**
 * A link drawn as a Button, for an action that goes somewhere: Join the call,
 * Add to Google Calendar. Same looks, sizes and press, but it is a link, so it
 * opens in a new tab with the browser's own gestures.
 */
export function ButtonLink(props: ButtonLinkProps) {
  const { href, isExternal = false, download, isDisabled } = props;
  const face: ButtonFace = props;
  const safe = safeHref(href);
  return (
    <AriaLink
      className={styles.root}
      {...(safe === undefined ? {} : { href: safe })}
      isDisabled={(isDisabled ?? false) || safe === undefined}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...(download === undefined ? {} : { download })}
      {...(face.label === undefined ? {} : { 'aria-label': face.label })}
      {...lookAttributes(props, face)}
    >
      <Face face={face} look={props} isPending={false} />
    </AriaLink>
  );
}

/** A button that stays pressed until pressed again, for toggles such as Bold or Show archived. */
export function ToggleButton(props: ToggleButtonProps) {
  const { isSelected, defaultSelected, onChange, isDisabled, slot, ref, id } = props;
  const face: ButtonFace = props;
  return (
    <AriaToggleButton
      ref={ref}
      {...(id === undefined ? {} : { id })}
      className={styles.root}
      isDisabled={isDisabled ?? false}
      {...(isSelected === undefined ? {} : { isSelected })}
      {...(defaultSelected === undefined ? {} : { defaultSelected })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(slot === undefined ? {} : { slot })}
      {...(face.label === undefined ? {} : { 'aria-label': face.label })}
      {...lookAttributes(props, face)}
    >
      <Face face={face} look={props} isPending={false} />
    </AriaToggleButton>
  );
}

/** Props for SplitHalf: one half of a SplitButton. */
export interface SplitHalfProps {
  /** `start` is the main action, drawn with its label and keycaps; `end` the menu half. */
  readonly half: 'start' | 'end';
  readonly variant: 'primary' | 'secondary';
  readonly kbd?: string | readonly string[] | undefined;
  /** The menu half's name. */
  readonly label?: string;
  readonly onPress?: ((event: PressEvent) => void) | undefined;
  readonly isDisabled: boolean;
  readonly isPending: boolean;
  /** The start half's label, or the end half's chevron. */
  readonly children: ReactNode;
}

/**
 * The frame SplitButton joins its two halves in, and each half (SplitHalf). They live here because they wear
 * Button's own styles; SplitButton itself sits in its own file, so its menu code stays out of the first load.
 */
export function SplitFrame({ children }: { readonly children: ReactNode }) {
  return <div className={styles.split}>{children}</div>;
}

/** One half of a SplitButton, in Button's look: the main action (`start`) or the menu trigger (`end`). */
export function SplitHalf({ half, variant, kbd, label, onPress, isDisabled, isPending, children }: SplitHalfProps) {
  const platform = useKeyboardPlatform();
  return (
    <AriaButton
      className={styles.root}
      isDisabled={isDisabled}
      isPending={isPending}
      data-variant={variant}
      data-size="md"
      data-split={half}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(half === 'start' ? shortcutAttribute(kbd, platform) : {})}
      {...(onPress === undefined ? {} : { onPress })}
    >
      {half === 'start' ? (
        <Face
          face={{ children: typeof children === 'string' ? children : '' }}
          look={{ variant, ...(kbd === undefined ? {} : { kbd }) }}
          isPending={isPending}
        />
      ) : (
        children
      )}
    </AriaButton>
  );
}

/** Props for ButtonGroup: a few icon Buttons that act on one thing, drawn as one control. */
export interface ButtonGroupProps {
  /** What the buttons act on, read as the group's name ("Intro call"). */
  readonly label: string;
  /** Secondary icon Buttons, a CopyButton, a MenuTrigger with its Button (a Tooltip around one is fine). */
  readonly children: ReactNode;
  /**
   * `joined` (the default) draws them as one bordered control; `row` keeps
   * each its own button, spaced and wrapping, for a card's few labelled
   * actions (a booking's Reschedule, Copy guest link, Cancel booking).
   */
  readonly layout?: 'joined' | 'row';
}

/**
 * Buttons joined into one bordered control, the way SplitButton joins its two
 * halves: shared edges, one outer radius, one drop (a list row's Open, Copy
 * link and More). A `group` for screen readers; Tab still stops at each one.
 */
export function ButtonGroup({ label, children, layout = 'joined' }: ButtonGroupProps) {
  return (
    <div className={styles.group} role="group" aria-label={label} data-layout={layout}>
      {children}
    </div>
  );
}
