// Brief
// Purpose: what the team learned about this record, on its page's Notes tab.
// Main task: write a note ("Write a note…") or log a call or meeting ("Log activity"), and find one again to open it.
// Leaves out: writing together in real time (#27), comments (#29), search inside notes (⌘K finds them by title).
import type { MemberSummary, NoteList as NoteListSource } from '@crm/data';
import { useNoteList } from '@crm/data/react';
import { Button, NoteList } from '@crm/ui';
import { useEffect } from 'react';
import { preloadNoteEditor } from './editor.ts';
import { findLoaded } from './entries.ts';
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
  /** Opens the Log activity dialog on a call or meeting logged, or on a new one (`new`). */
  readonly onOpenLog: (entry: string) => void;
}

/** A record's Notes tab (AC-442): "New note" over its notes, last edited first, 20 at a time as it scrolls, live. */
export function NotesTab({ list, members, canAdd, onOpenNote, onOpenLog }: NotesTabProps) {
  const state = useNoteList(list);
  const notes = useNoteItems(state.source, members);
  // The editor's chunk starts loading with the tab, so a note opened from it is ready to type into at once.
  useEffect(() => {
    preloadNoteEditor();
  }, []);
  // The tab opens on the note to write (owner, 31 Oct): "Write a note…" fills the row and opens a new note ready to
  // type into; Log activity is the quiet second choice. Empty, the list is one line under them.
  const compose = (
    <>
      <Button
        isFullWidth
        icon="pencil"
        onPress={() => {
          onOpenNote('new');
        }}
      >
        {strings.writeNote}
      </Button>
      <Button
        variant="ghost"
        icon="phone"
        onPress={() => {
          onOpenLog('new');
        }}
      >
        {strings.logActivity}
      </Button>
    </>
  );
  return (
    <NoteList
      label={strings.listLabel}
      notes={notes}
      status={state.status === 'unavailable' ? 'no-access' : state.status}
      onRetry={list.retry}
      emptyTitle={strings.noNotes}
      // A logged call or meeting opens in its own dialog, a note in its window.
      onAction={(id) => {
        const kind = findLoaded(state.source, id)?.kind;
        if (kind === 'call' || kind === 'meeting') onOpenLog(id);
        else onOpenNote(id);
      }}
      emptyLayout={canAdd ? 'row' : 'block'}
      {...(canAdd ? { toolbar: compose } : {})}
    />
  );
}
