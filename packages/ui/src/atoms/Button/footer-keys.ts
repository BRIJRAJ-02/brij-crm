import { createContext, useContext } from 'react';

/**
 * The keycaps a dialog's footer gives its buttons when they name none: its close (`slot="close"`) shows `close`, its
 * submit (`type="submit"`) shows `submit`. A Modal's footer provides them; anywhere else there are none.
 */
export interface FooterKeys {
  readonly close: string;
  readonly submit: string;
}

/** The footer keys in force: a Modal's footer sets them, so every Cancel says ESC and every submit its key. */
export const FooterKeysContext = createContext<FooterKeys | undefined>(undefined);

/**
 * The keycaps a button shows: its own `kbd` when it names one (an empty list shows none), else the footer's
 * default for its role.
 */
export function useFooterKbd(
  kbd: string | readonly string[] | undefined,
  slot: string | undefined,
  type: string,
): string | readonly string[] | undefined {
  const keys = useContext(FooterKeysContext);
  if (kbd !== undefined || keys === undefined) return kbd;
  if (slot === 'close') return keys.close;
  if (type === 'submit') return keys.submit;
  return undefined;
}
