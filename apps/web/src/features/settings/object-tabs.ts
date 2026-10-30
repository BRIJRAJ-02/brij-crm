// An object's settings tabs (spec 0012): plain values with no imports, so the object settings route's loader (in
// the first load) can check a tab without pulling in the settings navigation and every settings page's words.

/** An object's settings tabs, in order. */
export const OBJECT_TABS = ['attributes', 'configuration', 'access'] as const;
/** One of an object's settings tabs. */
export type ObjectTab = (typeof OBJECT_TABS)[number];

/** True when `tab` names one of an object's settings tabs. */
export const isObjectTab = (tab: string): tab is ObjectTab => (OBJECT_TABS as readonly string[]).includes(tab);
