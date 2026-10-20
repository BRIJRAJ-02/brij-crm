// The Light, Dark or System choice. System is the default and needs no code:
// the tokens CSS follows the OS through prefers-color-scheme. A saved Light or
// Dark choice sets `data-theme` on <html>; apps/web/public/theme-boot.js applies
// it before first paint, and this controller keeps it in step after that.
// Both also colour the phone browser bar (the theme-color metas) with the
// surface of the chosen theme, so the bar matches the page, not the OS.

/** The three choices the ThemeSwitch offers. `system` follows the OS. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** The localStorage key the choice lives under. theme-boot.js reads the same key. */
export const THEME_STORAGE_KEY = 'crm.theme';

/**
 * The `surface` token of each theme, as the theme-color metas need a literal
 * colour (a meta can't read a CSS variable). theme-boot.js and index.html
 * carry the same two values; tests check all three against tokens.json.
 */
export const THEME_SURFACE = { light: '#fdfdff', dark: '#18191c' } as const;

/** Reads any stored value as a choice. Only `light` and `dark` are kept; anything else is `system`. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The part of `Storage` the controller uses. */
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The part of the root element the controller writes `data-theme` on. */
export type ThemeRoot = Pick<Element, 'setAttribute' | 'removeAttribute'>;

/** A `<meta name="theme-color">`: its `media` says which OS theme it was written for. */
export type ThemeBarMeta = Pick<Element, 'getAttribute' | 'setAttribute'>;

/** Listens for storage changes made in other tabs, and returns a function that stops listening. */
export type OnStorage = (handler: (key: string | null, value: string | null) => void) => () => void;

/** What the controller needs from the page, passed in so it can be tested without a browser. */
export interface ThemeControllerDeps {
  /** The browser's localStorage, or `undefined` when it can't be reached. */
  readonly storage: ThemeStorage | undefined;
  /** Usually `document.documentElement`. */
  readonly root: ThemeRoot;
  readonly onStorage: OnStorage;
  /** The page's theme-color metas, recoloured to the chosen theme's surface. */
  readonly barMetas?: readonly ThemeBarMeta[];
}

/** Reads and changes the theme choice, and tells subscribers when it changes. */
export interface ThemeController {
  readonly get: () => ThemeChoice;
  /** Saves the choice (System clears it) and applies it to the page at once. Never throws. */
  readonly set: (choice: ThemeChoice) => void;
  /** Calls `listener` on every change, from this tab or another. Returns an unsubscribe. */
  readonly subscribe: (listener: (choice: ThemeChoice) => void) => () => void;
  /** Stops listening to other tabs. */
  readonly dispose: () => void;
}

/** `localStorage`, or `undefined` when the browser blocks it (reading the property can throw). */
export function safeLocalStorage(win: { readonly localStorage: Storage }): ThemeStorage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

function readChoice(storage: ThemeStorage | undefined): ThemeChoice {
  try {
    return parseThemeChoice(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/**
 * The browser bar colour for a meta: the chosen theme's surface, or under
 * System the surface of the OS theme the meta's `media` names.
 */
export function themeBarColor(choice: ThemeChoice, media: string | null): string {
  if (choice !== 'system') return THEME_SURFACE[choice];
  return media?.includes('dark') === true ? THEME_SURFACE.dark : THEME_SURFACE.light;
}

function applyChoice(root: ThemeRoot, barMetas: readonly ThemeBarMeta[], choice: ThemeChoice): void {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  for (const meta of barMetas) meta.setAttribute('content', themeBarColor(choice, meta.getAttribute('media')));
}

/**
 * Creates the one theme controller the app holds. It applies the saved choice
 * straight away, saves new choices (falling back to this page only when
 * storage is blocked), and follows a choice made in another tab.
 */
export function createThemeController({
  storage,
  root,
  onStorage,
  barMetas = [],
}: ThemeControllerDeps): ThemeController {
  let current = readChoice(storage);
  const listeners = new Set<(choice: ThemeChoice) => void>();
  applyChoice(root, barMetas, current);

  const change = (choice: ThemeChoice) => {
    applyChoice(root, barMetas, choice);
    if (choice === current) return;
    current = choice;
    for (const listener of listeners) listener(choice);
  };

  const stopListening = onStorage((key, value) => {
    // A null key means the other tab cleared all of storage.
    if (key === THEME_STORAGE_KEY || key === null) change(parseThemeChoice(value));
  });

  return {
    get: () => current,
    set: (choice) => {
      try {
        if (choice === 'system') storage?.removeItem(THEME_STORAGE_KEY);
        else storage?.setItem(THEME_STORAGE_KEY, choice);
      } catch {
        // Storage is full or blocked: the choice still applies to this page.
      }
      change(choice);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: stopListening,
  };
}
