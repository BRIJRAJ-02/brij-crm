import { createContext, useContext } from 'react';

/**
 * The keycaps a dialog's footer gives its buttons when they name none: its close (`slot="close"`) shows `close`, its
 * submit (`type="submit"`) shows `submit`, or `submitForm` when it submits a library Form by `form` (whose ⌘↵ works
 * from every control in it, where Enter submits only from a text field). `primary`, when set (a plain confirm, never
 * a danger one), is the key of a `primary` button that only acts on press: it takes focus as the dialog opens, so
 * Enter presses it.
 */
export interface FooterKeys {
  readonly close: string;
  readonly submit: string;
  readonly submitForm: string;
  readonly primary?: string;
}

/** The footer keys in force: a Modal's footer sets them, so every Cancel says ESC and every submit its key. */
export const FooterKeysContext = createContext<FooterKeys | undefined>(undefined);

/** What a footer gives one button: the keycaps it shows, and whether it takes focus as the dialog opens. */
export interface FooterRole {
  readonly kbd: string | readonly string[] | undefined;
  readonly autoFocus: boolean;
}

/**
 * The keycaps a button shows: its own `kbd` when it names one (an empty list shows none), else the footer's
 * default for its role. A plain confirm's primary also takes focus.
 */
export function useFooterRole(button: {
  readonly kbd: string | readonly string[] | undefined;
  readonly slot: string | null | undefined;
  readonly type: string;
  readonly form: string | undefined;
  readonly variant: string | undefined;
}): FooterRole {
  const keys = useContext(FooterKeysContext);
  if (keys === undefined) return { kbd: button.kbd, autoFocus: false };
  // The commit may close the dialog as it acts (`slot="close"`); it is still the commit, never the dismiss.
  const isCommit = button.variant === 'primary' || button.variant === 'danger-solid';
  const autoFocus = keys.primary !== undefined && button.type !== 'submit' && button.variant === 'primary';
  if (button.kbd !== undefined) return { kbd: button.kbd, autoFocus };
  if (button.type === 'submit') {
    return { kbd: button.form === undefined ? keys.submit : keys.submitForm, autoFocus: false };
  }
  if (button.slot === 'close' && !isCommit) return { kbd: keys.close, autoFocus: false };
  return { kbd: autoFocus ? keys.primary : undefined, autoFocus };
}
