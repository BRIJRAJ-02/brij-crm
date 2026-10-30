// Brief
// Purpose: what the team learned about this record, on its page's Notes tab.
// Main task: write a note ("New note") and find one again (last edited first) to open it.
// Leaves out: writing together in real time (#27), comments (#29), search inside notes (⌘K finds them by title).
import type { MemberSummary, NoteList as NoteListSource } from '@crm/data';
import { useNoteList } from '@crm/data/react';
import { Button, NoteList } from '@crm/ui';
import { useEffect } from 'react';
import { preloadNoteEditor } from './editor.ts';
import { strings } from './strings.ts';
import { useNoteItems } from './useNoteItems.ts';

/** Props for a record's Notes tab. */
export interface NotesTabProps {
  readonly list: NoteListSource;
  readonly members: readonly MemberSummary[];
  /** The person may change the record's object: "New note" shows. */
  readonly canAdd: boolean;
  /** Opens the note window on a note, or on a new one. */
  readonly onOpenNote: (noteId: string) => void;
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
