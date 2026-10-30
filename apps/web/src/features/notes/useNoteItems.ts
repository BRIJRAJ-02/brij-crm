// A note list's notes as NoteList's rows: shared by a record's Notes tab and
// the workspace's Notes page.
import type { MemberSummary, NoteListState, NoteSummary } from '@crm/data';
import type { ListSource, NoteListItem } from '@crm/ui';
import { useMemo } from 'react';
import { toNoteItem } from './entries.ts';

/** The list's notes as NoteList's rows, each mapped once per body while the members stay. */
export function useNoteItems(
  source: NoteListState['source'],
  members: readonly MemberSummary[],
): ListSource<NoteListItem> {
  const cache = useMemo(() => ({ items: new WeakMap<NoteSummary, NoteListItem>(), members }), [members]);
  return useMemo(
    (): ListSource<NoteListItem> => ({
      count: source.count,
      getItem: (index) => {
        const note = source.getItem(index);
        if (note === undefined) return undefined;
        const held = cache.items.get(note);
        if (held !== undefined) return held;
        const made = toNoteItem(note, cache.members);
        cache.items.set(note, made);
        return made;
      },
      getKey: (item) => item.id,
      onRangeChange: source.onRangeChange,
    }),
    [source, cache],
  );
}
