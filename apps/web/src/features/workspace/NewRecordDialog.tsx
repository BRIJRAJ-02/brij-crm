// Brief
// Purpose: add one record of any object (a person, a project) without leaving the table.
// Main task: fill the name and every required field, open "Add more fields" for the rest, then Create; the row shows at once.
// Leaves out: references and members (edited in the table), duplicate checks and templates.
import {
  isDataError,
  refusalFor,
  refusalSummary,
  toFieldAttribute,
  type AttributeDefinition,
  type RecordView,
} from '@crm/data';
import { AttributeEditor, Button, Disclosure, Form, Modal, type FormRefusal } from '@crm/ui';
import { useId, useRef, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the new record dialog. */
export interface NewRecordDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** "New person". */
  readonly title: string;
  /** The editors asked for first: the primary attribute, then every required one, by position (AC-240). */
  readonly first: readonly AttributeDefinition[];
  /** The rest, by position, behind "Add more fields". */
  readonly more: readonly AttributeDefinition[];
  /** The object's name for one record ("Person"), for the dialog's own messages and its Create. */
  readonly singularName: string;
  /** The object's standard key, else its API name: a network's editor tells a company from a person by it. */
  readonly objectKey?: string;
  /** Mints the new record's id, once per opening: a second press after a lost answer sends the same one. */
  readonly newId: () => string;
  /** Makes the record (optimistic: the row is in the table while this waits); rejects with the refusals. */
  readonly onCreate: (id: string, values: Readonly<Record<string, unknown>>) => Promise<RecordView>;
  /** The server made it: close, and focus its row. */
  readonly onCreated: (record: RecordView) => void;
}

/** The types whose editor is a list of chips: one value here (more are added in the table). */
const LIST_TYPES: readonly string[] = ['email', 'phone', 'url', 'domain'];

/**
 * An attribute as the dialog asks for it, through its one editor, its
 * required check left to Create. A list
 * type asks for one value even where it holds several (its single field
 * never grows under the pointer on its way to Create, as the chips did when
 * a blur added one), and its label says one ("Email address").
 */
function askedFor(definition: AttributeDefinition, objectKey: string | undefined) {
  // Required is checked on Create, never as focus leaves an empty field (a message appearing on blur pushed
  // "Add more fields" and Create down under the pointer); the field still reads as required.
  const attribute = { ...toFieldAttribute(definition, undefined, objectKey), isRequiredOnSubmit: true };
  if (!LIST_TYPES.includes(definition.type)) return attribute;
  const single = { ...attribute, allowMultiple: false };
  return definition.type === 'email' && definition.isMulti ? { ...single, name: strings.emailAddress } : single;
}

/** "YYYY-MM-DD" for today plus `days`, in the browser's time zone (a date default's "Today + N days"). */
function dayFromToday(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * What an editor shows before anything is typed (AC-240, value sourcing): a
 * static default as it is, a date offset as the day it resolves to, and a
 * default naming an archived option as the first live option when the
 * attribute is required, else nothing, as the engine resolves it. A new
 * record left with these gets the same from the server.
 */
function prefillOf(definition: AttributeDefinition): unknown {
  const fallback = definition.defaultValue;
  if (fallback === undefined) return null;
  if (fallback.kind === 'offset') {
    const days = /^P(\d+)D$/.exec(fallback.duration);
    return definition.type === 'date' && days?.[1] !== undefined ? dayFromToday(Number(days[1])) : null;
  }
  if (fallback.kind !== 'static') return null;
  const options = definition.options;
  if (options === undefined || typeof fallback.value !== 'string') return fallback.value;
  const named = options.find((option) => option.id === fallback.value);
  if (named === undefined || !named.isArchived) return fallback.value;
  return definition.isRequired ? (options.find((option) => !option.isArchived)?.id ?? null) : null;
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

/** "New person": a Modal with the record's first editors and "Add more fields"; Create waits, the row shows at once. */
export function NewRecordDialog({
  isOpen,
  onOpenChange,
  title,
  singularName,
  objectKey,
  first,
  more,
  newId,
  onCreate,
  onCreated,
}: NewRecordDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  // Each opening starts idle; the fields start afresh because the Modal mounts them afresh.
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
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
            {isBusy ? strings.creating : strings.createRecord(singularName)}
          </Button>
        </>
      }
    >
      <NewRecordForm
        formId={formId}
        label={title}
        singularName={singularName}
        {...(objectKey === undefined ? {} : { objectKey })}
        newId={newId}
        first={first}
        more={more}
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
  'first' | 'more' | 'onCreate' | 'onCreated' | 'singularName' | 'newId' | 'objectKey'
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
  objectKey,
  newId,
  first,
  more,
  isBusy,
  onBusyChange,
  onCreate,
  onCreated,
}: NewRecordFormProps) {
  const editors = [...first, ...more];
  // One id per opening (the Modal mounts this afresh), sent again on every press.
  const [id] = useState(newId);
  // What each editor shows: its default until the person commits a value (AC-240).
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>(() =>
    Object.fromEntries(editors.map((editor) => [editor.id, prefillOf(editor)])),
  );
  // What the person committed, in the shape the attribute takes: a ref as well, so a submit that a blur's commit
  // runs just before sees it. Untouched fields are left out, so the server applies their defaults itself.
  const sending = useRef<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  // A refusal or a typed value in a hidden field opens "Add more fields", so nothing is out of sight.
  const [isMoreOpen, setMoreOpen] = useState(false);

  const create = () => {
    if (isBusy) return;
    const sent = Object.fromEntries(Object.entries(sending.current).filter(([, value]) => value !== null));
    // A required attribute with nothing typed and no default is refused here, before a blank row is made.
    const missing = first.filter(
      (editor) => editor.isRequired && sent[editor.id] === undefined && editor.defaultValue === undefined,
    );
    if (missing.length > 0) {
      setRefusals([]);
      setFieldErrors(
        new Map(
          missing.map((editor) => [
            editor.id,
            editor.isPrimary ? strings.recordNameMissing(singularName) : strings.valueMissing(editor.title),
          ]),
        ),
      );
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
        if (more.some((editor) => byAttribute.has(editor.id))) setMoreOpen(true);
      },
    );
  };

  const editorFor = (definition: AttributeDefinition) => {
    const error = fieldErrors.get(definition.id);
    return (
      <AttributeEditor
        key={definition.id}
        attribute={askedFor(definition, objectKey)}
        value={values[definition.id] ?? null}
        surface="form"
        onCommit={(value) => {
          sending.current = {
            ...sending.current,
            [definition.id]: definition.isMulti && value !== null && !Array.isArray(value) ? [value] : value,
          };
          setValues((shown) => ({ ...shown, [definition.id]: value }));
          if (fieldErrors.has(definition.id)) {
            setFieldErrors(new Map([...fieldErrors].filter(([key]) => key !== definition.id)));
          }
        }}
        {...(error === undefined ? {} : { error })}
      />
    );
  };

  return (
    <Form id={formId} isBusy={isBusy} refusals={refusals} onSubmit={create} label={label} focusesFirstField>
      {first.map(editorFor)}
      {more.length > 0 && (
        <Disclosure
          variant="fields"
          title={strings.addMoreFields}
          count={more.length}
          isExpanded={isMoreOpen}
          onExpandedChange={setMoreOpen}
        >
          {more.map(editorFor)}
        </Disclosure>
      )}
    </Form>
  );
}
