// Brief
// Purpose: put one record in a list (spec 0048, AC-4813 to AC-4815).
// Main task: find the record, fill a required list field if there is one, then Add to list.
// Leaves out: optional list fields (edited in the row once added), and making a new record here.
import {
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type EntriesLayer,
  type ListView,
  type ObjectSummary,
  type RecordRefDisplay,
} from '@crm/data';
import {
  AttributeEditor,
  Button,
  Form,
  Modal,
  type AttributeEditorProps,
  type FormRefusal,
  type Toasts,
} from '@crm/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { refsOf } from '../records/details.ts';
import { editorSearch, useRecordSearch } from '../records/links.ts';
import { strings } from './strings.ts';

/** A list value as the editor takes it: the store holds each value in its type's shape already. */
const editorValue = (value: unknown): AttributeEditorProps['value'] => (value === undefined ? null : value);

/** Props for the Add dialog. */
export interface AddEntryModalProps {
  readonly data: DataLayer;
  readonly entries: EntriesLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly list: ListView;
  readonly object: ObjectSummary;
  /** The list's own fields: required ones are asked for here. */
  readonly fields: readonly AttributeDefinition[];
  /** Values the dialog starts with: a board column's option (AC-4815). */
  readonly preset?: Readonly<Record<string, unknown>> | undefined;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/** "Add <singular>" (Modal + Form): a record picker and the list's required fields, nothing else. */
export function AddEntryModal({ isOpen, onClose, list, object, ...rest }: AddEntryModalProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={strings.addTitle(object.singularName, list.name)}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.adding : strings.addToList}
          </Button>
        </>
      }
    >
      {isOpen && (
        <AddEntryForm
          formId={formId}
          isBusy={isBusy}
          onBusyChange={setBusy}
          list={list}
          object={object}
          onDone={onClose}
          {...rest}
        />
      )}
    </Modal>
  );
}

/** The form, mounted afresh with each opening: its entry id is minted once and sent again on a retry. */
function AddEntryForm({
  data,
  entries,
  toasts,
  slug,
  list,
  object,
  fields,
  preset,
  formId,
  isBusy,
  onBusyChange,
  onDone,
}: Omit<AddEntryModalProps, 'isOpen' | 'onClose'> & {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly onDone: () => void;
}) {
  const [id] = useState(() => data.lists.newId());
  const [picked, setPicked] = useState<RecordRefDisplay | undefined>(undefined);
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>(preset ?? {});
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const search = useRecordSearch(slug, object.id);
  // Which results are in the list already (AC-4814), asked for in batches as the picker shows them.
  const [inList, setInList] = useState<ReadonlySet<string>>(new Set());
  const asked = useRef(new Set<string>());
  const waiting = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (flush.current !== undefined) clearTimeout(flush.current);
    },
    [],
  );
  const describeResult = useCallback<NonNullable<AttributeEditorProps['describeResult']>>(
    (shown) => {
      if (list.allowsDuplicates || !('recordId' in shown) || typeof shown.recordId !== 'string') return undefined;
      const display = { recordId: shown.recordId };
      if (inList.has(display.recordId)) return { note: strings.alreadyIn, isLinked: true };
      if (!asked.current.has(display.recordId)) {
        asked.current.add(display.recordId);
        waiting.current.add(display.recordId);
        flush.current ??= setTimeout(() => {
          flush.current = undefined;
          const ids = [...waiting.current];
          waiting.current.clear();
          void entries.membership(slug, list.id, ids).then(
            (found) => {
              if (found.length > 0) setInList((was) => new Set([...was, ...found]));
            },
            () => undefined,
          );
        }, 0);
      }
      return undefined;
    },
    [entries, inList, list.allowsDuplicates, list.id, slug],
  );
  const required = fields.filter((field) => field.isRequired && !field.isSystem && !field.isArchived);

  const add = () => {
    if (isBusy) return;
    if (picked === undefined) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.pick(object.singularName), attributeId: 'record' }]);
      return;
    }
    if (inList.has(picked.recordId)) {
      setRefusals([{ code: 'ENTRY_EXISTS', message: strings.alreadyIn, attributeId: 'record' }]);
      return;
    }
    // A required list field left empty says so on the field, before anything is sent (AC-4813).
    const missing = required.filter((field) => values[field.id] === undefined || values[field.id] === null);
    if (missing.length > 0) {
      setRefusals(
        missing.map((field) => ({
          code: 'VALUE_REQUIRED',
          message: strings.fieldMissing(field.title),
          attributeId: field.id,
        })),
      );
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    void entries.add(slug, list, picked.recordId, values, id).then((outcome) => {
      onBusyChange(false);
      if (outcome.kind === 'refused') {
        setRefusals([
          {
            code: outcome.code,
            message: outcome.message,
            ...(outcome.code === 'ENTRY_EXISTS' ? { attributeId: 'record' } : {}),
          },
        ]);
        return;
      }
      toasts.toast({ tone: 'success', message: strings.added(picked.name, list.name) });
      onDone();
    });
  };

  const recordField = {
    id: 'record',
    name: object.singularName,
    type: 'record_reference' as const,
    allowMultiple: false,
    cardinality: 'one' as const,
    isRequired: true,
    isUnique: false,
    isReadOnly: false,
  };
  const errorOn = (fieldId: string) => refusals.find((refusal) => refusal.attributeId === fieldId)?.message;
  const recordError = errorOn('record');
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.attributeId}
      onSubmit={add}
      label={strings.addTitle(object.singularName, list.name)}
      focusesFirstField
    >
      <AttributeEditor
        attribute={recordField}
        value={picked === undefined ? null : { objectId: picked.objectId, recordId: picked.recordId }}
        display={picked}
        surface="form"
        autoOpen
        onSearch={editorSearch(search.onSearch)}
        describeResult={describeResult}
        onCommit={(value) => {
          const [ref] = refsOf(value);
          setRefusals([]);
          setPicked(ref === undefined ? undefined : search.displayOf(ref.recordId));
        }}
        {...(recordError === undefined ? {} : { error: recordError })}
      />
      {required.map((field) => (
        <AttributeEditor
          key={field.id}
          attribute={toFieldAttribute(field)}
          value={editorValue(values[field.id])}
          surface="form"
          onCommit={(value) => {
            setValues((was) => ({ ...was, [field.id]: value }));
          }}
          {...(errorOn(field.id) === undefined ? {} : { error: errorOn(field.id) })}
        />
      ))}
    </Form>
  );
}
