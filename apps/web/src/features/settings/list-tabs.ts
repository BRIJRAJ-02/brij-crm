// A list's settings tabs (spec 0048, AC-4829), apart from the screen so a route's loader can ask without loading it.

/** A list's settings tabs. */
export type ListTab = 'general' | 'fields';

/** Whether a route's tab names one. */
export const isListTab = (tab: string): tab is ListTab => tab === 'general' || tab === 'fields';
