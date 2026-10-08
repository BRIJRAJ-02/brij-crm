// Brief
// Purpose: add one record (a person) without leaving the table.
// Main task: type the name and email, then Create; the row shows in the table at once and takes focus.
// Leaves out: every other attribute (edit those in the table), duplicates checks and templates.
import { isDataError, toFieldAttribute, type AttributeDefinition, type RecordView } from '@crm/data';
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
  /** Makes the record (optimistic: the row is in the table while this waits); rejects with the refusals. */
  readonly onCreate: (values: Readonly<Record<string, unknown>>) => Promise<RecordView>;
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

/** A failure split into the refusals each editor shows, by attribute id, and the rest, shown above the fields. */
function refusalsOf(
  error: unknown,
  editorIds: ReadonlySet<string>,
): { readonly byAttribute: ReadonlyMap<string, string>; readonly other: readonly FormRefusal[] } {
  if (!isDataError(error)) return { byAttribute: new Map(), other: [{ code: 'INTERNAL', message: String(error) }] };
  const refusals = (error.data?.refusals ?? []).map((refusal) => ({
    code: refusal.code,
    message: refusal.message,
    ...(refusal.attributeId === undefined ? {} : { attributeId: refusal.attributeId }),
  }));
  const issues = (error.data?.issues ?? []).map((issue) => {
    const [where, attributeId] = issue.path;
    return {
      code: error.code,
      message: issue.message,
      ...(where === 'values' && typeof attributeId === 'string' ? { attributeId } : {}),
    };
  });
  const all: readonly FormRefusal[] = [...refusals, ...issues];
  const shown = all.length > 0 ? all : [{ code: error.code, message: error.message }];
  const byAttribute = new Map<string, string>();
  const other: FormRefusal[] = [];
  for (const refusal of shown) {
    if (
      refusal.attributeId !== undefined &&
      editorIds.has(refusal.attributeId) &&
      !byAttribute.has(refusal.attributeId)
    ) {
      byAttribute.set(refusal.attributeId, refusal.message);
    } else {
      other.push(refusal);
    }
  }
  return { byAttribute, other };
}

/** "New person": a Modal with a Form of the record's first editors; Create waits for the server, the row shows at once. */
export function NewRecordDialog({ isOpen, onOpenChange, title, editors, onCreate, onCreated }: NewRecordDialogProps) {
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
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.creating : strings.create}
          </Button>
        </>
      }
    >
      <NewRecordForm
        formId={formId}
        label={title}
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
interface NewRecordFormProps extends Pick<NewRecordDialogProps, 'editors' | 'onCreate' | 'onCreated'> {
  readonly formId: string;
  readonly label: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
}

/** The dialog's form: each editor's last committed value, sent on Create; refusals on their editors or above them. */
function NewRecordForm({ formId, label, editors, isBusy, onBusyChange, onCreate, onCreated }: NewRecordFormProps) {
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
    onBusyChange(true);
    setRefusals([]);
    setFieldErrors(new Map());
    onCreate(sent).then(
      (record) => {
        onBusyChange(false);
        onCreated(record);
      },
      (error: unknown) => {
        onBusyChange(false);
        const { byAttribute, other } = refusalsOf(error, new Set(editors.map((editor) => editor.id)));
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
