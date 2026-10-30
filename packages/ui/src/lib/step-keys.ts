// A panel's ↑ and ↓ (the record panel steps through its list, Twenty's side
// panel): which key steps to the item above or below, and where a key belongs
// to something else (typing, a list or tabs that move with arrows, a menu).
// Plain, so it tests in Node.

/** What the decision reads of a key press. */
export interface StepKey {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
}

/** What the decision reads of the element the key went to, and of each element around it. */
export interface StepTarget {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  readonly role: string | null;
}

/** Roles whose own arrows move inside them: a key there is theirs. */
const ARROW_ROLES = new Set([
  'grid',
  'treegrid',
  'listbox',
  'option',
  'tablist',
  'tab',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radiogroup',
  'radio',
  'slider',
  'spinbutton',
  'combobox',
  'tree',
  'row',
  'gridcell',
]);

/** Tags that take typing or arrows of their own. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** The key's target and each element around it up to `until` (the panel), nearest first, as `stepOf` reads them. */
export function pathOf(target: EventTarget | null, until: Element): readonly StepTarget[] {
  const path: StepTarget[] = [];
  for (let at = target instanceof Element ? target : null; at !== null && at !== until; at = at.parentElement) {
    path.push({
      tagName: at.tagName,
      isContentEditable: at instanceof HTMLElement && at.isContentEditable,
      role: at.getAttribute('role'),
    });
  }
  return path;
}

/**
 * `previous` for ↑ and `next` for ↓ when nothing else owns the key: no
 * modifier, not already handled, and neither the target nor anything around
 * it types or moves with arrows. `path` is the target and its ancestors,
 * nearest first.
 */
export function stepOf(event: StepKey, path: readonly StepTarget[]): 'previous' | 'next' | undefined {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  const step = event.key === 'ArrowUp' ? 'previous' : event.key === 'ArrowDown' ? 'next' : undefined;
  if (step === undefined) return undefined;
  // A tab's panel holding focus itself scrolls with the arrows; a button inside it leaves them to the step.
  const isOwned =
    path[0]?.role === 'tabpanel' ||
    path.some(
      (each) =>
        TYPING_TAGS.has(each.tagName) || each.isContentEditable || (each.role !== null && ARROW_ROLES.has(each.role)),
    );
  return isOwned ? undefined : step;
}
