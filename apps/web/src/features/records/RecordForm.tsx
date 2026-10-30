// A record picker's "Create deal…" (owner flow pass, 30 Oct 2026): the far
// object's full create form, for one that needs more than a name (a deal's
// required Stage), started from what was typed. What it makes is handed back
// for the picker's screen to link.
import type { AttributeDefinition, MemberSummary, ObjectSummary, RecordRefDisplay } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { createEditors } from '../workspace/create-editors.ts';
import { NewRecordDialog } from '../workspace/NewRecordDialog.tsx';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import type { OpenRecordForm } from './links.ts';
import { nameValueOf } from './make.ts';
import { useMemberPicker } from './members.ts';

/** One opening: the far object, its definitions and members, what was typed, and who links the result. */
interface Opening {
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly label: string;
  readonly onMade: (display: RecordRefDisplay) => void;
}

const NO_MEMBERS: readonly MemberSummary[] = [];

/**
 * The full create form a screen's pickers open: `open` reads the far
 * object's definitions and the members (cached by the data layer) and shows
 * the form; `dialog` is what the screen renders, always mounted so the
 * Modal plays its exit.
 */
export function useRecordForm(slug: string): { readonly open: OpenRecordForm; readonly dialog: ReactNode } {
  const { data } = useRouteContext({ from: '__root__' });
  const [opening, setOpening] = useState<Opening>();
  const [isOpen, setOpen] = useState(false);
  const memberPicker = useMemberPicker(opening?.members ?? NO_MEMBERS);
  const editors = useMemo(
    () => (opening === undefined ? undefined : createEditors(opening.object, opening.attributes)),
    [opening],
  );

  const open: OpenRecordForm = (object, label, onMade) => {
    void Promise.all([data.attributes.list(slug, object.id), data.members.list(slug)]).then(
      ([attributes, members]) => {
        setOpening({ object, attributes, members, label, onMade });
        setOpen(true);
      },
      () => undefined,
    );
  };

  if (opening === undefined || editors === undefined) return { open, dialog: null };
  const { object, label, onMade } = opening;
  const primary = opening.attributes.find((attribute) => attribute.id === object.primaryAttributeId);
  const name = nameValueOf(primary, label);
  return {
    open,
    dialog: (
      <NewRecordDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        title={workspaceStrings.newRecord(object.singularName)}
        first={editors.first}
        more={editors.more}
        newId={data.records.newId}
        onCreate={(id, values) => data.records.create(slug, object.id, id, values)}
        singularName={object.singularName}
        objectKey={object.standardKey ?? object.apiSlug}
        memberPicker={memberPicker}
        {...(primary === undefined || name === undefined ? {} : { preset: { [primary.id]: name } })}
        onCreated={(record) => {
          setOpen(false);
          onMade(record.display);
        }}
      />
    ),
  };
}
