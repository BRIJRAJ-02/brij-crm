// Brief
// Purpose: the records a note, call or meeting is also on, besides its own, as chips with a picker (the task dialog's Records field).
// Main task: add and remove linked records, shown at once, with a refusal said under the field.
// Leaves out: the note's own record (it can't be unlinked), records the person may not change (not offered).
import { NOTE_RECORDS_MAX, refusalSummary, type DataError, type ObjectSummary, type RecordRefDisplay } from '@crm/data';
import { AttributeEditor, type FieldAttribute } from '@crm/ui';
import { useState } from 'react';
import { editorSearch, useRecordSearch } from '../records/links.ts';
import { strings } from './strings.ts';

/** What a change to the links names: the records added, and the ids of those removed. */
export interface LinksChange {
  readonly add: readonly RecordRefDisplay[];
  readonly remove: readonly string[];
}

/** Props for the linked records field. */
export interface LinksFieldProps {
  readonly slug: string;
  readonly links: readonly RecordRefDisplay[];
  readonly objects: readonly ObjectSummary[];
  /** The object the picker starts on: the page's record's. */
  readonly startObjectId: string;
  readonly isEditable: boolean;
  /** Opens the picker as the field mounts (Link record in a note's More menu). */
  readonly autoOpen: boolean;
  /** Applies a change; answers the refusal, if any, which the field says under itself. */
  readonly onChange: (change: LinksChange) => Promise<DataError | undefined>;
}

/** The linked records field's attribute, through the field set's own record editor (one field design). */
function linksAttribute(readOnlyReason: string | undefined): FieldAttribute {
  return {
    id: 'note-links',
    name: strings.linkedRecords,
    type: 'record_reference',
    allowMultiple: true,
    cardinality: 'many',
    isRequired: false,
    isUnique: false,
    isReadOnly: readOnlyReason !== undefined,
    ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
  };
}

/**
 * The records a note links besides its own (migration 0136), as the task
 * dialog's Records field: chips with Remove, and a picker over the objects
 * the person may change, starting on the page's. Changes show at once; a
 * refusal puts them back and says why under the field.
 */
export function LinksField({ slug, links, objects, startObjectId, isEditable, autoOpen, onChange }: LinksFieldProps) {
  const writable = objects.filter((object) => object.access === 'write');
  const [objectId, setObjectId] = useState(
    writable.find((object) => object.id === startObjectId)?.id ?? writable[0]?.id ?? '',
  );
  const search = useRecordSearch(slug, objectId);
  const [error, setError] = useState<string | undefined>(undefined);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const readOnlyReason = !isEditable ? strings.readOnly : writable.length === 0 ? strings.linkForbidden : undefined;
  const shownError = error ?? (search.failed ? strings.searchFailed : undefined);
  return (
    <AttributeEditor
      attribute={linksAttribute(readOnlyReason)}
      value={links.map((link) => ({ objectId: link.objectId, recordId: link.recordId }))}
      display={links}
      surface="form"
      autoOpen={autoOpen}
      onSearch={editorSearch(search.onSearch)}
      objectSwitcher={{
        objects: writable.map((object) => ({
          id: object.id,
          label: object.pluralName,
          icon: object.icon,
          hue: object.hue,
        })),
        objectId,
        onObjectChange: setObjectId,
      }}
      onCommit={(value) => {
        const next = (Array.isArray(value) ? value : []) as readonly {
          readonly objectId: string;
          readonly recordId: string;
        }[];
        const held = new Set(links.map((link) => link.recordId));
        const nextIds = new Set(next.map((ref) => ref.recordId));
        const added = next.filter((ref) => !held.has(ref.recordId));
        // Linking needs write on the record's object: said under the field, nothing sent.
        if (added.some((ref) => byId.get(ref.objectId)?.access !== 'write')) {
          setError(strings.linkForbidden);
          return;
        }
        // Its own record counts as one of the 20.
        if (next.length + 1 > NOTE_RECORDS_MAX) {
          setError(strings.linksFull(NOTE_RECORDS_MAX));
          return;
        }
        setError(undefined);
        void onChange({
          add: added.map(
            (ref) =>
              search.displayOf(ref.recordId) ?? {
                objectId: ref.objectId,
                recordId: ref.recordId,
                name: '',
                kind: 'other',
              },
          ),
          remove: links.filter((link) => !nextIds.has(link.recordId)).map((link) => link.recordId),
        }).then((failure) => {
          if (failure !== undefined) setError(refusalSummary(failure));
        });
      }}
      {...(shownError === undefined ? {} : { error: shownError })}
    />
  );
}
