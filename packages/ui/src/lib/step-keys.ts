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

/**
 * Roles that take letters of their own (typeahead in a list, a grid's type to edit, a menu's first letter): J and K
 * there are theirs. A tab or a tab's panel takes none, so the letters step from there, as the foot line promises.
 */
const LETTER_ROLES = new Set([
  'grid',
  'treegrid',
  'gridcell',
  'row',
  'listbox',
  'option',
  'tree',
  'treeitem',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'combobox',
  'textbox',
  'searchbox',
  'spinbutton',
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

/** The keys that step, and which way: the arrows, and K and J as a mail inbox has them (spec 0074, AC-7412). */
const STEP_KEYS: Readonly<Record<string, 'previous' | 'next'>> = {
  ArrowUp: 'previous',
  ArrowDown: 'next',
  k: 'previous',
  j: 'next',
};

/**
 * `previous` for ↑ or K and `next` for ↓ or J when nothing else owns the key:
 * no modifier, not already handled, and neither the target nor anything
 * around it types or moves with arrows (a field, a listbox, a grid). `path`
 * is the target and its ancestors, nearest first.
 */
export function stepOf(event: StepKey, path: readonly StepTarget[]): 'previous' | 'next' | undefined {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  // Caps Lock's J is still J; Shift's is refused above.
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const step = Object.hasOwn(STEP_KEYS, key) ? STEP_KEYS[key] : undefined;
  if (step === undefined) return undefined;
  const isLetter = key.length === 1;
  const isTyping = path.some((each) => TYPING_TAGS.has(each.tagName) || each.isContentEditable);
  const isOwned = isLetter
    ? isTyping || path.some((each) => each.role !== null && LETTER_ROLES.has(each.role))
    : // A tab's panel holding focus itself scrolls with the arrows; a button inside it leaves them to the step.
      path[0]?.role === 'tabpanel' || isTyping || path.some((each) => each.role !== null && ARROW_ROLES.has(each.role));
  return isOwned ? undefined : step;
}
