// Brief
// Purpose: add one record (a person) without leaving the table.
// Main task: type the name and email, then Create; the row shows in the table at once and takes focus.
// Leaves out: every other attribute (edit those in the table), duplicates checks and templates.
import {
  isDataError,
  refusalFor,
  refusalSummary,
  toFieldAttribute,
  type AttributeDefinition,
  type RecordView,
} from '@crm/data';
import { AttributeEditor, Button, Form, Modal, type FormRefusal } from '@crm/ui';
import { useId, useRef, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the new record dialog. */
export interface NewRecordDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** "New person". */
  readonly title: string;
  /** The attributes the dialog asks for, each through its one editor (the name, the email). */
  readonly editors: readonly AttributeDefinition[];
  /** The object's name for one record ("Person"), for the dialog's own messages. */
  readonly singularName: string;
  /** Mints the new record's id, once per opening: a second press after a lost answer sends the same one. */
  readonly newId: () => string;
  /** Makes the record (optimistic: the row is in the table while this waits); rejects with the refusals. */
  readonly onCreate: (id: string, values: Readonly<Record<string, unknown>>) => Promise<RecordView>;
  /** The server made it: close, and focus its row. */
  readonly onCreated: (record: RecordView) => void;
}

/**
 * An attribute as the dialog asks for it: one value, even where the attribute
 * holds several (the first email; more are added in the table). The type's
 * one editor either way, and its single field never grows under the pointer
 * on its way to Create, as the list's chips did when a blur added one.
 */
function askedFor(definition: AttributeDefinition) {
  return { ...toFieldAttribute(definition), allowMultiple: false };
}

/**
 * A failure split into the sentence each editor shows (`refusalFor`, the same
 * words the table's cells and toasts use), and the rest, shown above the fields.
 */
function refusalsOf(
  error: unknown,
  editors: readonly AttributeDefinition[],
): { readonly byAttribute: ReadonlyMap<string, string>; readonly other: readonly FormRefusal[] } {
  if (!isDataError(error)) {
    return { byAttribute: new Map(), other: [{ code: 'INTERNAL', message: strings.somethingWrong }] };
  }
  // Refused as a whole (a limit, a lost connection): above the fields.
  const own = editors.flatMap((editor) => {
    const named =
      (error.data?.refusals ?? []).some((refusal) => refusal.attributeId === editor.id) ||
      (error.data?.issues ?? []).some((issue) => issue.path[0] === 'values' && issue.path[1] === editor.id);
    const message = named ? refusalFor(error, editor.id) : undefined;
    return message === undefined ? [] : [[editor.id, message] as const];
  });
  const editorIds = new Set(editors.map((editor) => editor.id));
  // About an attribute the dialog doesn't show, or about nothing in particular: above the fields.
  const elsewhere = (error.data?.refusals ?? []).filter(
    (refusal) => refusal.attributeId === undefined || !editorIds.has(refusal.attributeId),
  );
  const other: readonly FormRefusal[] =
    own.length === 0 && elsewhere.length === 0
      ? [{ code: error.code, message: refusalSummary(error) }]
      : elsewhere.map((refusal) => ({ code: refusal.code, message: refusal.message }));
  return { byAttribute: new Map(own), other };
}

/** "New person": a Modal with a Form of the record's first editors; Create waits for the server, the row shows at once. */
export function NewRecordDialog({
  isOpen,
  onOpenChange,
  title,
  singularName,
  editors,
  newId,
  onCreate,
  onCreated,
}: NewRecordDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  // Each opening starts idle; the fields start empty because the Modal mounts them afresh.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setBusy(false);
  }
  return (
    <Modal
      title={title}
      isOpen={isOpen}
      // While Create waits, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.creating : strings.create}
          </Button>
        </>
      }
    >
      <NewRecordForm
        formId={formId}
        label={title}
        singularName={singularName}
        newId={newId}
        editors={editors}
        isBusy={isBusy}
        onBusyChange={setBusy}
        onCreate={onCreate}
        onCreated={onCreated}
      />
    </Modal>
  );
}

/** Props for the dialog's form. */
interface NewRecordFormProps extends Pick<
  NewRecordDialogProps,
  'editors' | 'onCreate' | 'onCreated' | 'singularName' | 'newId'
> {
  readonly formId: string;
  readonly label: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
}

/** The dialog's form: each editor's last committed value, sent on Create; refusals on their editors or above them. */
function NewRecordForm({
  formId,
  label,
  singularName,
  newId,
  editors,
  isBusy,
  onBusyChange,
  onCreate,
  onCreated,
}: NewRecordFormProps) {
  // One id per opening (the Modal mounts this afresh), sent again on every press.
  const [id] = useState(newId);
  // What each editor last committed. A ref as well as state, so a submit that a blur's commit runs just before sees it.
  const committed = useRef<Record<string, unknown>>({});
  // The same values in the shape the attribute takes: an attribute that holds several gets a list.
  const sending = useRef<Record<string, unknown>>({});
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  const [fieldErrors, setFieldErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);

  const create = () => {
    if (isBusy) return;
    const sent = Object.fromEntries(Object.entries(sending.current).filter(([, value]) => value !== null));
    // A person needs a name: nothing typed in it is refused here, before a blank row is made.
    const name = editors.find((editor) => editor.type === 'personal_name');
    if (name !== undefined && sent[name.id] === undefined) {
      setRefusals([]);
      setFieldErrors(new Map([[name.id, strings.recordNameMissing(singularName)]]));
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    setFieldErrors(new Map());
    onCreate(id, sent).then(
      (record) => {
        onBusyChange(false);
        onCreated(record);
      },
      (error: unknown) => {
        onBusyChange(false);
        const { byAttribute, other } = refusalsOf(error, editors);
        setFieldErrors(byAttribute);
        setRefusals(other);
      },
    );
  };

  return (
    <Form id={formId} isBusy={isBusy} refusals={refusals} onSubmit={create} label={label}>
      {editors.map((definition) => {
        const error = fieldErrors.get(definition.id);
        return (
          <AttributeEditor
            key={definition.id}
            attribute={askedFor(definition)}
            value={values[definition.id] ?? null}
            surface="form"
            onCommit={(value) => {
              committed.current = { ...committed.current, [definition.id]: value };
              sending.current = {
                ...sending.current,
                [definition.id]: definition.isMulti && value !== null && !Array.isArray(value) ? [value] : value,
              };
              setValues(committed.current);
              if (fieldErrors.has(definition.id)) {
                setFieldErrors(new Map([...fieldErrors].filter(([id]) => id !== definition.id)));
              }
            }}
            {...(error === undefined ? {} : { error })}
          />
        );
      })}
    </Form>
  );
}
