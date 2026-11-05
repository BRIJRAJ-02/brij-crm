// Brief
// Purpose: every note the person may see across the workspace, on `/w/$slug/notes`, so a note is found without knowing its record.
// Main task: find a note (last edited first, its author and record on each row) and open it over its record, or
// start one ("New note": pick its record, and the note opens on it, as in Attio).
// Leaves out: search inside notes (⌘K finds them by title), filters, and a note with no record.
import type { MemberSummary, NoteList as NoteListSource, ObjectSummary } from '@crm/data';
import { useNoteList } from '@crm/data/react';
import { AttributeEditor, Button, Modal, NoteList, TopBar, type FieldAttribute } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { refOf } from '../duplicates/merge/pair.ts';
import { editorSearch, useRecordSearch } from '../records/links.ts';
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
  const [isPicking, setPicking] = useState(false);
  // A note is written on a record the person may change: New note shows only when there is one to pick.
  const writable = useMemo(() => objects.filter((object) => object.access === 'write'), [objects]);
  const state = useNoteList(list);
  const notes = useNoteItems(state.source, members);
  const slugs = useMemo(() => new Map(objects.map((object) => [object.id, object.apiSlug])), [objects]);
  // New note's picker starts where the newest note was written, else on the first object the person may change.
  const newest = state.source.count > 0 ? state.source.getItem(0)?.record?.objectId : undefined;
  const startObjectId = writable.find((object) => object.id === newest)?.id ?? writable[0]?.id ?? '';
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
        topBar: (
          <TopBar title={strings.notes} icon="notebook">
            {writable.length > 0 && (
              <Button variant="primary" icon="plus" onPress={() => setPicking(true)}>
                {strings.newNote}
              </Button>
            )}
          </TopBar>
        ),
        body: (
          <>
            <NoteList
              label={strings.listLabel}
              notes={notes}
              status={state.status === 'unavailable' ? 'no-access' : state.status}
              onRetry={list.retry}
              // The title alone: New note above says how to start one, and nobody else can.
              emptyTitle={strings.noNotes}
              onAction={open}
            />
            <Modal
              title={strings.newNote}
              isOpen={isPicking}
              onOpenChange={setPicking}
              actions={<Button slot="close">{strings.cancel}</Button>}
            >
              {isPicking && (
                <RecordPick
                  slug={slug}
                  objects={writable}
                  startObjectId={startObjectId}
                  onPick={(objectSlug, recordId) => {
                    setPicking(false);
                    void navigate({ href: noteHref(slug, objectSlug, recordId, 'new') });
                  }}
                />
              )}
            </Modal>
          </>
        ),
      }}
    />
  );
}

/** The record picker's attribute: one record, of any object the person may change, named "Record". */
const RECORD_FIELD: FieldAttribute = {
  id: 'new-note-record',
  name: strings.noteRecord,
  type: 'record_reference',
  allowMultiple: false,
  cardinality: 'one',
  isRequired: true,
  isUnique: false,
  isReadOnly: false,
};

/**
 * New note's one field (the foolproof pass, 5 November 2026): the field set's record picker, open at once, with its
 * Search in switcher over the objects the person may change. A pick goes straight to the note, nothing to confirm.
 */
function RecordPick({
  slug,
  objects,
  startObjectId,
  onPick,
}: {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  /** The object Search in starts on. */
  readonly startObjectId: string;
  readonly onPick: (objectSlug: string, recordId: string) => void;
}) {
  const [objectId, setObjectId] = useState(startObjectId);
  const search = useRecordSearch(slug, objectId);
  const slugs = new Map(objects.map((object) => [object.id, object.apiSlug]));
  return (
    <AttributeEditor
      attribute={RECORD_FIELD}
      value={null}
      surface="form"
      autoOpen
      onSearch={editorSearch(search.onSearch)}
      objectSwitcher={{
        objects: objects.map((object) => ({
          id: object.id,
          label: object.pluralName,
          icon: object.icon,
          hue: object.hue,
        })),
        objectId,
        onObjectChange: setObjectId,
      }}
      onCommit={(value) => {
        const ref = refOf(value);
        const objectSlug = ref === undefined ? undefined : slugs.get(ref.objectId);
        if (ref !== undefined && objectSlug !== undefined) onPick(objectSlug, ref.recordId);
      }}
      {...(search.failed ? { error: strings.searchFailed } : {})}
    />
  );
}
