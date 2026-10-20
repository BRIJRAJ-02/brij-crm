// Brief
// Purpose: change one field on every ticked record at once (spec 0022, milestone 2).
// Main task: pick the field, the change (Set, Clear, Add, Remove, Replace), the value through the field's own editor, then Apply.
// Leaves out: several fields in one go, relationships (owner decision 3), members (edited nowhere yet) and per record previews.
import {
  bulkOpsFor,
  isEditableHere,
  opTakesValue,
  refusalSummary,
  toFieldAttribute,
  type AttributeDefinition,
  type BulkEditResult,
  type BulkOp,
  type ObjectSummary,
} from '@crm/data';
import { AttributeEditor, Button, Callout, Form, Modal, Radio, RadioGroup, Select, type FormRefusal } from '@crm/ui';
import { useId, useMemo, useState } from 'react';
import { bulkStrings, recordsWord } from './bulk.ts';

/** An attribute the dialog offers, with the changes its type takes (AC-529). */
interface Offered {
  readonly definition: AttributeDefinition;
  readonly ops: readonly BulkOp[];
}

/**
 * The attributes a bulk edit offers (AC-529): those the member may write and
 * the dialog can edit, leaving out the primary, system, archived, file,
 * interaction and relationship attributes (`bulkOpsFor` answers none), and
 * members, which no screen edits yet. In the object's order.
 */
export function offeredAttributes(attributes: readonly AttributeDefinition[]): readonly Offered[] {
  return attributes.flatMap((definition) => {
    if (!isEditableHere(definition)) return [];
    const ops = bulkOpsFor({
      type: definition.type,
      isMulti: definition.isMulti,
      isRequired: definition.isRequired,
      isUnique: definition.isUnique,
      isSystem: definition.isSystem,
      isPrimary: definition.isPrimary,
      isArchived: definition.isArchived || definition.archivedBy !== undefined,
      isReadOnly: definition.readOnly !== undefined,
    });
    return ops.length === 0 ? [] : [{ definition, ops }];
  });
}

/** What the dialog sends: the field, the change and its value. */
export interface BulkEditChoice {
  readonly definition: AttributeDefinition;
  readonly op: BulkOp;
  readonly value?: unknown;
}

/** Props for the bulk edit dialog. */
export interface BulkEditDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  /** How many records it changes, for the title and Apply. */
  readonly count: number;
  /** Sends the edit; the dialog waits for it, and shows a refusal of the whole edit above its fields. */
  readonly onApply: (choice: BulkEditChoice) => Promise<BulkEditResult>;
}

/** "Edit 48 people": a Modal with the field, the change, the value, and Apply. */
export function BulkEditDialog({ isOpen, onOpenChange, object, attributes, count, onApply }: BulkEditDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setBusy(false);
  }
  const records = recordsWord(count, object);
  return (
    <Modal
      title={bulkStrings.editTitle(records)}
      isOpen={isOpen}
      isDismissable={false}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {bulkStrings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
            {isBusy ? bulkStrings.applying : bulkStrings.apply(records)}
          </Button>
        </>
      }
    >
      <BulkEditForm
        formId={formId}
        object={object}
        attributes={attributes}
        count={count}
        records={records}
        isBusy={isBusy}
        onBusyChange={setBusy}
        onApply={onApply}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}

/** Props for the dialog's form. */
interface BulkEditFormProps extends Pick<BulkEditDialogProps, 'object' | 'attributes' | 'count' | 'onApply'> {
  readonly formId: string;
  readonly records: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly onDone: () => void;
}

/** The dialog's form: mounted afresh on each opening, so every opening starts empty. */
function BulkEditForm({
  formId,
  object,
  attributes,
  count,
  records,
  isBusy,
  onBusyChange,
  onApply,
  onDone,
}: BulkEditFormProps) {
  const offered = useMemo(() => offeredAttributes(attributes), [attributes]);
  const [attributeId, setAttributeId] = useState<string | undefined>(undefined);
  const chosen = offered.find((each) => each.definition.id === attributeId);
  const [op, setOp] = useState<BulkOp | undefined>(undefined);
  const shownOp = chosen === undefined ? undefined : op !== undefined && chosen.ops.includes(op) ? op : chosen.ops[0];
  const [value, setValue] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [valueError, setValueError] = useState<string | undefined>(undefined);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const definition = chosen?.definition;
  const isCheckbox = definition?.type === 'checkbox';
  // AC-529: a unique attribute can't take one value on several records; the dialog says so before anything is sent.
  const breaksUnique = definition?.isUnique === true && shownOp === 'set' && count > 1;

  const apply = () => {
    if (isBusy) return;
    if (definition === undefined || shownOp === undefined) {
      setFieldError(bulkStrings.needsField);
      return;
    }
    if (breaksUnique) return;
    const sent = isCheckbox ? value === true : value;
    if (opTakesValue(shownOp) && !isCheckbox && (sent === null || (Array.isArray(sent) && sent.length === 0))) {
      setValueError(bulkStrings.needsValue);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    void onApply({ definition, op: shownOp, ...(opTakesValue(shownOp) ? { value: sent } : {}) }).then(
      (result) => {
        onBusyChange(false);
        if (result.kind === 'failed') {
          // Refused whole (a read only field, the network): said here, where it was asked, and nothing changed.
          const error = result.error;
          setRefusals([{ code: error.code, message: refusalSummary(error) }]);
          return;
        }
        onDone();
      },
      () => {
        onBusyChange(false);
        setRefusals([{ code: 'INTERNAL', message: bulkStrings.somethingWrong }]);
      },
    );
  };

  if (offered.length === 0) {
    return (
      <Callout tone="info" isAnnounced>
        {bulkStrings.noFields(object.pluralName)}
      </Callout>
    );
  }

  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      onSubmit={apply}
      label={bulkStrings.editTitle(records)}
      focusesFirstField
    >
      <Select
        label={bulkStrings.field}
        placeholder={bulkStrings.fieldPlaceholder}
        items={offered.map((each) => ({ id: each.definition.id, label: each.definition.title }))}
        value={attributeId ?? null}
        isRequired
        {...(fieldError === undefined ? {} : { error: fieldError })}
        onChange={(id) => {
          setAttributeId(id ?? undefined);
          setOp(undefined);
          setValue(null);
          setFieldError(undefined);
          setValueError(undefined);
        }}
      />
      {chosen !== undefined && definition !== undefined && shownOp !== undefined && (
        <>
          {isCheckbox ? (
            <RadioGroup
              label={bulkStrings.change}
              orientation="horizontal"
              value={value === true ? 'checked' : 'unchecked'}
              onChange={(next) => {
                setOp('set');
                setValue(next === 'checked');
              }}
            >
              <Radio value="checked">{bulkStrings.checked}</Radio>
              <Radio value="unchecked">{bulkStrings.unchecked}</Radio>
            </RadioGroup>
          ) : (
            chosen.ops.length > 1 && (
              <RadioGroup
                label={bulkStrings.change}
                orientation="horizontal"
                value={shownOp}
                onChange={(next) => {
                  setOp(next as BulkOp);
                  setValueError(undefined);
                }}
              >
                {chosen.ops.map((each) => (
                  <Radio key={each} value={each}>
                    {bulkStrings.ops[each]}
                  </Radio>
                ))}
              </RadioGroup>
            )
          )}
          {!isCheckbox && opTakesValue(shownOp) && (
            <AttributeEditor
              key={`${definition.id}:${shownOp === 'set' || shownOp === 'replace' ? 'whole' : 'items'}`}
              attribute={{ ...toFieldAttribute(definition), name: bulkStrings.value, isRequired: true }}
              value={value ?? null}
              surface="form"
              onCommit={(next) => {
                setValue(definition.isMulti && next !== null && !Array.isArray(next) ? [next] : next);
                setValueError(undefined);
              }}
              {...(valueError === undefined ? {} : { error: valueError })}
            />
          )}
          {shownOp === 'clear' && <Callout tone="info">{bulkStrings.clearsValue(definition.title, records)}</Callout>}
          {breaksUnique && (
            <Callout tone="danger" isAnnounced>
              {bulkStrings.uniqueRule(definition.title)}
            </Callout>
          )}
        </>
      )}
    </Form>
  );
}
