import type { JSX, ReactNode, Ref } from 'react';
import {
  Button as AriaButton,
  MenuTrigger,
  ToggleButton as AriaToggleButton,
  type PressEvent,
} from 'react-aria-components';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import { Kbd } from '../Kbd/Kbd.tsx';
import { keyShortcuts, type KeyboardPlatform } from '../Kbd/shortcuts.ts';
import { useKeyboardPlatform } from '../../provider/context.ts';
import { Spinner } from '../Spinner/Spinner.tsx';
import styles from './Button.module.css';
import { strings } from './strings.ts';

/** `secondary` (the default) for view controls and Cancel, `primary` for the one action that commits, `ghost` for quiet and undo style actions, `dashed` for "add a condition". */
export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'dashed';

/** `md` is the 26px control height; `lg` matches a 30px input beside it. */
export type ButtonSize = 'md' | 'lg';

interface ButtonLook {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** A trailing icon, such as `chevron-down` on a button that opens a menu. */
  readonly iconRight?: IconName;
  /** Keycaps shown after the label: `ESC`, `⌘↵`, or several. */
  readonly kbd?: string | readonly string[];
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
  readonly label?: never;
}

interface IconOnlyFace {
  readonly children?: never;
  readonly icon: IconName;
  /** The accessible name, required because the icon is the only content. */
  readonly label: string;
}

type ButtonFace = LabelledFace | IconOnlyFace;

/** Props for Button: a label (with an optional icon), or an icon with a `label` for its name. */
export type ButtonProps = ButtonLook &
  ButtonFace & {
    readonly onPress?: (event: PressEvent) => void;
    /** Shows a spinner in place of the icon and ignores presses, while staying focusable. Change the label to the ongoing verb ("Saving"). */
    readonly isPending?: boolean;
    readonly type?: 'button' | 'submit' | 'reset';
  };

/** Props for ToggleButton: a button that stays pressed, such as Bold in a format toolbar. */
export type ToggleButtonProps = Omit<ButtonLook, 'kbd'> &
  ButtonFace & {
    readonly isSelected?: boolean;
    readonly defaultSelected?: boolean;
    readonly onChange?: (isSelected: boolean) => void;
  };

/** The data attributes that pick a look from the CSS module. */
function lookAttributes(look: ButtonLook, face: ButtonFace) {
  return {
    'data-variant': look.variant ?? 'secondary',
    'data-size': look.size ?? 'md',
    'data-icon-only': face.children === undefined || undefined,
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
      {isPending ? <Spinner /> : face.icon !== undefined && <Icon name={face.icon} size="sm" />}
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
  const { onPress, isPending = false, type = 'button', isDisabled, slot, ref } = props;
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
      {...(onPress === undefined ? {} : { onPress })}
      {...(face.label === undefined ? {} : { 'aria-label': face.label })}
      {...shortcutAttribute(props.kbd, platform)}
      {...lookAttributes(props, face)}
    >
      <Face face={face} look={props} isPending={isPending} />
    </AriaButton>
  );
}

/** A button that stays pressed until pressed again, for toggles such as Bold or Show archived. */
export function ToggleButton(props: ToggleButtonProps) {
  const { isSelected, defaultSelected, onChange, isDisabled, slot, ref } = props;
  const face: ButtonFace = props;
  return (
    <AriaToggleButton
      ref={ref}
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

/** Props for SplitButton: the main action, and a menu of its variants. */
export interface SplitButtonProps {
  /** The main action's label ("Save"). */
  readonly children: string;
  readonly onPress?: (event: PressEvent) => void;
  readonly variant?: 'primary' | 'secondary';
  readonly kbd?: string | readonly string[];
  /** The name of the menu half. Defaults to "More options". */
  readonly menuLabel?: string;
  /** The menu the chevron opens: a `Menu` holding the variants (Save as new view). */
  readonly menu: ReactNode;
  readonly isDisabled?: boolean;
  readonly isPending?: boolean;
}

/** A primary action with a menu of its variants beside it: Save, and Save as new view. */
export function SplitButton({
  children,
  onPress,
  variant = 'primary',
  kbd,
  menuLabel = strings.moreOptions,
  menu,
  isDisabled = false,
  isPending = false,
}: SplitButtonProps) {
  const look = { variant, kbd } as const;
  const platform = useKeyboardPlatform();
  return (
    <div className={styles.split}>
      <AriaButton
        className={styles.root}
        isDisabled={isDisabled}
        isPending={isPending}
        data-variant={variant}
        data-size="md"
        data-split="start"
        {...shortcutAttribute(kbd, platform)}
        {...(onPress === undefined ? {} : { onPress })}
      >
        <Face face={{ children }} look={look} isPending={isPending} />
      </AriaButton>
      <MenuTrigger>
        <AriaButton
          className={styles.root}
          isDisabled={isDisabled}
          isPending={isPending}
          aria-label={menuLabel}
          data-variant={variant}
          data-size="md"
          data-split="end"
        >
          <Icon name="chevron-down" size="sm" />
        </AriaButton>
        {menu}
      </MenuTrigger>
    </div>
  );
}
