// The board columns a viewer folded into strips (the CRM flow pass, 31 Oct
// 2026): kept per view in this browser only, never on the view, since folding
// Lost out of the way is one person's habit, not the team's. Storage can be
// missing or throw (a private window, blocked site data): the board then
// starts with every column open.
import { useCallback, useState } from 'react';

/** Where one view's folded columns are kept. */
export const collapsedKey = (viewId: string) => `crm.board.collapsed.${viewId}`;

/** The folded column ids a kept value names; anything unreadable names none. */
export function parseCollapsed(raw: string | null): ReadonlySet<string> {
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The set with one column folded or opened, as a new set. */
export function withCollapsed(held: ReadonlySet<string>, columnId: string, isCollapsed: boolean): ReadonlySet<string> {
  const next = new Set(held);
  if (isCollapsed) next.add(columnId);
  else next.delete(columnId);
  return next;
}

/** Reads a key from this browser's storage, or nothing where storage isn't there. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** One view's folded columns, and folding or opening one; another view starts from its own. */
export function useCollapsedColumns(viewId: string) {
  const [held, setHeld] = useState(() => ({ viewId, ids: parseCollapsed(read(collapsedKey(viewId))) }));
  const current = held.viewId === viewId ? held : { viewId, ids: parseCollapsed(read(collapsedKey(viewId))) };
  if (current !== held) setHeld(current);
  const change = useCallback(
    (columnId: string, isCollapsed: boolean) => {
      setHeld((was) => {
        const ids = withCollapsed(was.ids, columnId, isCollapsed);
        try {
          if (ids.size === 0) window.localStorage.removeItem(collapsedKey(viewId));
          else window.localStorage.setItem(collapsedKey(viewId), JSON.stringify([...ids]));
        } catch {
          // Kept for this visit only.
        }
        return { viewId, ids };
      });
    },
    [viewId],
  );
  return { collapsedIds: current.ids, onCollapsedChange: change };
}
