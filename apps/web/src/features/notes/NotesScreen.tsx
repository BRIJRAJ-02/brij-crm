// Brief
// Purpose: every note the person may see across the workspace, on `/w/$slug/notes`, so a note is found without knowing its record.
// Main task: find a note (last edited first, its author and record on each row) and open it over its record.
// Leaves out: search inside notes (⌘K finds them by title), filters, and a note with no record.
import type { MemberSummary, NoteList as NoteListSource, ObjectSummary } from '@crm/data';
import { useNoteList } from '@crm/data/react';
import { NoteList, TopBar } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { preloadNoteEditor } from './editor.ts';
import { findLoaded, logHref, noteHref } from './entries.ts';
import { useNoteItems } from './useNoteItems.ts';
import { strings } from './strings.ts';

/** Props for the Notes page: what its route loaded through the data layer. */
export interface NotesScreenProps {
  readonly slug: string;
  readonly list: NoteListSource;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
}

/**
 * The workspace's notes (the flow pass of 30 Oct 2026): one list, last edited
 * first, 20 at a time as it scrolls, live; a row opens the note's window over
 * its record's Notes tab, where it is written.
 */
export function NotesScreen({ slug, list, objects, members }: NotesScreenProps) {
  const navigate = useNavigate();
  const state = useNoteList(list);
  const notes = useNoteItems(state.source, members);
  const slugs = useMemo(() => new Map(objects.map((object) => [object.id, object.apiSlug])), [objects]);
  // The editor's chunk starts loading with the page, so a note opened from it is ready to type into at once.
  useEffect(() => {
    preloadNoteEditor();
  }, []);
  const open = (noteId: string) => {
    const found = findLoaded(state.source, noteId);
    const record = found?.record;
    const objectSlug = record === undefined ? undefined : slugs.get(record.objectId);
    if (found === undefined || record === undefined || objectSlug === undefined) return;
    // A logged call or meeting opens in its own dialog, a note in its window.
    const href = found.kind === 'note' ? noteHref : logHref;
    void navigate({ href: href(slug, objectSlug, record.recordId, noteId) });
  };
  return (
    <WorkspacePage
      currentPage="notes"
      page={{
        topBar: <TopBar title={strings.notes} icon="notebook" />,
        body: (
          <NoteList
            label={strings.listLabel}
            notes={notes}
            status={state.status === 'unavailable' ? 'no-access' : state.status}
            onRetry={list.retry}
            emptyTitle={strings.noNotes}
            onAction={open}
          />
        ),
      }}
    />
  );
}
