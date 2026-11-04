import { createContext, useContext } from 'react';

/**
 * The keycaps a dialog's footer gives its buttons when they name none: its close (`slot="close"`) shows `close`, its
 * submit (`type="submit"`) shows `submit`, or `submitForm` when it submits a library Form by `form` (whose ⌘↵ works
 * from every control in it, where Enter submits only from a text field). `primary`, when set (a plain confirm, never
 * a danger one), is the key of a `primary` button that only acts on press: it takes focus as the dialog opens, so
 * Enter presses it. `press`, when set (any other dialog but an alert), is the key of a `primary` that only acts on
 * press (Save, Done, Start): the Modal presses it on ⌘↵ from anywhere in the dialog, as a Form's submit is sent.
 */
export interface FooterKeys {
  readonly close: string;
  readonly submit: string;
  readonly submitForm: string;
  readonly primary?: string;
  readonly press?: string;
}

/** The footer keys in force: a Modal's footer sets them, so every Cancel says ESC and every submit its key. */
export const FooterKeysContext = createContext<FooterKeys | undefined>(undefined);

/** The attribute that marks the footer's pressed primary, which the Modal presses on ⌘↵. */
export const FOOTER_PRESS_ATTRIBUTE = 'data-footer-press';

/** What a footer gives one button: the keycaps it shows, whether it takes focus as the dialog opens, and whether ⌘↵ presses it. */
export interface FooterRole {
  readonly kbd: string | readonly string[] | undefined;
  readonly autoFocus: boolean;
  readonly isPressedByKey: boolean;
}

/**
 * The keycaps a button shows: its own `kbd` when it names one (an empty list shows none), else the footer's
 * default for its role. A plain confirm's primary also takes focus; any other dialog's onPress primary is pressed by
 * ⌘↵ (never a `danger-solid`, never in an alert, so a key never destroys).
 */
export function useFooterRole(button: {
  readonly kbd: string | readonly string[] | undefined;
  readonly slot: string | null | undefined;
  readonly type: string;
  readonly form: string | undefined;
  readonly variant: string | undefined;
}): FooterRole {
  const keys = useContext(FooterKeysContext);
  if (keys === undefined) return { kbd: button.kbd, autoFocus: false, isPressedByKey: false };
  // The commit may close the dialog as it acts (`slot="close"`); it is still the commit, never the dismiss.
  const isCommit = button.variant === 'primary' || button.variant === 'danger-solid';
  const autoFocus = keys.primary !== undefined && button.type !== 'submit' && button.variant === 'primary';
  if (button.kbd !== undefined) return { kbd: button.kbd, autoFocus, isPressedByKey: false };
  if (button.type === 'submit') {
    return { kbd: button.form === undefined ? keys.submit : keys.submitForm, autoFocus: false, isPressedByKey: false };
  }
  if (button.slot === 'close' && !isCommit) return { kbd: keys.close, autoFocus: false, isPressedByKey: false };
  if (autoFocus) return { kbd: keys.primary, autoFocus, isPressedByKey: false };
  const isPressedByKey = keys.press !== undefined && button.variant === 'primary';
  return { kbd: isPressedByKey ? keys.press : undefined, autoFocus: false, isPressedByKey };
}
