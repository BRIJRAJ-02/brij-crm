// Brief
// Purpose: what the team learned about this record, on its page's Notes tab.
// Main task: write a note ("New note") and find one again (last edited first) to open it.
// Leaves out: writing together in real time (#27), comments (#29), search over notes (#33).
import type { MemberSummary, NoteList as NoteListSource, NoteSummary } from '@crm/data';
import { useNoteList } from '@crm/data/react';
import { Button, NoteList, type ListSource, type NoteListItem } from '@crm/ui';
import { useEffect, useMemo } from 'react';
import { preloadNoteEditor } from './editor.ts';
import { toNoteItem } from './entries.ts';
import { strings } from './strings.ts';

/** Props for a record's Notes tab. */
export interface NotesTabProps {
  readonly list: NoteListSource;
  readonly members: readonly MemberSummary[];
  /** The person may change the record's object: "New note" shows. */
  readonly canAdd: boolean;
  /** Opens the note window on a note, or on a new one. */
  readonly onOpenNote: (noteId: string) => void;
}

/** The list's notes as NoteList's rows, each mapped once per body while the members stay. */
function useNoteItems(source: ReturnType<typeof useNoteList>['source'], members: readonly MemberSummary[]) {
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

/** A record's Notes tab (AC-442): "New note" over its notes, last edited first, 20 at a time as it scrolls, live. */
export function NotesTab({ list, members, canAdd, onOpenNote }: NotesTabProps) {
  const state = useNoteList(list);
  const notes = useNoteItems(state.source, members);
  // The editor's chunk starts loading with the tab, so a note opened from it is ready to type into at once.
  useEffect(() => {
    preloadNoteEditor();
  }, []);
  const newNote = (
    <Button
      variant="primary"
      onPress={() => {
        onOpenNote('new');
      }}
    >
      {strings.newNote}
    </Button>
  );
  // Empty, New note sits in the empty state, under its words (as Attio and Twenty do); with notes, above them.
  const isEmpty = state.status === 'ready' && notes.count === 0;
  return (
    <NoteList
      label={strings.listLabel}
      notes={notes}
      status={state.status === 'unavailable' ? 'no-access' : state.status}
      onRetry={list.retry}
      emptyTitle={strings.noNotes}
      onAction={onOpenNote}
      {...(canAdd ? { emptyActions: newNote } : {})}
      {...(canAdd && !isEmpty ? { toolbar: newNote } : {})}
    />
  );
}
