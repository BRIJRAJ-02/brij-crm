// Brief
// Purpose: change one field on every ticked record at once (spec 0022, milestone 2).
// Main task: pick the field, the change (Set, Clear, Add, Remove, Replace), the value through the field's own editor, then Apply.
// Leaves out: several fields in one go, relationships (owner decision 3) and per record previews.
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
import {
  AttributeEditor,
  Button,
  Callout,
  Form,
  iconOf,
  InfoTip,
  Modal,
  Radio,
  RadioGroup,
  Select,
  type FormRefusal,
} from '@crm/ui';
import { useEffect, useId, useMemo, useState } from 'react';
import type { MemberPicker } from '../records/members.ts';
import { bulkStrings, recordsWord } from './bulk.ts';

/** An attribute the dialog offers, with the changes its type takes (AC-529). */
interface Offered {
  readonly definition: AttributeDefinition;
  readonly ops: readonly BulkOp[];
}

/** The most fields the field Select lists before it offers a search, as the builders do. */
const SEARCH_PAST = 15;

/**
 * The attributes a bulk edit offers (AC-529): those the member may write and
 * the dialog can edit, leaving out the primary, system, archived, file,
 * interaction and relationship attributes (`bulkOpsFor` answers none). A
 * member (Owner) is offered, chosen through the member picker. In the
 * object's order.
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

/**
 * Whether a change would give several records one value of a unique field
 * (AC-529): Set, Add and Replace all do once more than one record changes;
 * Remove and Clear never do.
 */
export function breaksUnique(definition: Pick<AttributeDefinition, 'isUnique'>, op: BulkOp, count: number): boolean {
  return definition.isUnique && count > 1 && op !== 'remove' && op !== 'clear';
}

/** What the dialog sends: the field by id, the change and its value. */
export interface BulkEditChoice {
  readonly attributeId: string;
  readonly op: BulkOp;
  readonly value?: unknown;
}

/** Props for the bulk edit dialog. */
export interface BulkEditDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  /** The member picker an Owner's value is chosen with, "Me" first. */
  readonly memberPicker: MemberPicker;
  /** How many records it changes (Set on a unique attribute is refused for more than one). */
  readonly count: number;
  /** The records in words for the title ("48 people", "all 10,000+ matching people"). */
  readonly records?: string;
  /** Sends the edit; the dialog waits for it, and shows a refusal of the whole edit above its fields. */
  readonly onApply: (choice: BulkEditChoice) => Promise<BulkEditResult>;
}

/** "Edit 48 people": a Modal with the field, the change, the value, and Apply. */
export function BulkEditDialog({
  isOpen,
  onOpenChange,
  object,
  attributes,
  memberPicker,
  count,
  records: named,
  onApply,
}: BulkEditDialogProps) {
  const formId = useId();
  // The line that says why Apply is off (the unique rule), named by Apply's aria-describedby.
  const blockedId = useId();
  const [isBusy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setBusy(false);
  }
  const records = named ?? recordsWord(count, object);
  // Nothing to offer: the dialog says so with Close only. A choice the rules refuse (unique) disables Apply.
  const hasFields = useMemo(() => offeredAttributes(attributes).length > 0, [attributes]);
  const [isBlocked, setBlocked] = useState(false);
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
          <Button slot="close" isDisabled={isBusy}>
            {hasFields ? bulkStrings.cancel : bulkStrings.close}
          </Button>
          {hasFields && (
            // The title already names the records, so Apply keeps to one word and its keycap fits on a phone.
            <Button
              variant="primary"
              type="submit"
              form={formId}
              isPending={isBusy}
              isDisabled={isBlocked}
              kbd="⌘↵"
              {...(isBlocked ? { 'aria-describedby': blockedId } : {})}
            >
              {isBusy ? bulkStrings.applying : bulkStrings.apply}
            </Button>
          )}
        </>
      }
    >
      <BulkEditForm
        formId={formId}
        blockedId={blockedId}
        object={object}
        attributes={attributes}
        memberPicker={memberPicker}
        count={count}
        records={records}
        isBusy={isBusy}
        isBlocked={isBlocked}
        onBusyChange={setBusy}
        onBlockedChange={setBlocked}
        onApply={onApply}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}

/** Props for the dialog's form. */
interface BulkEditFormProps extends Pick<
  BulkEditDialogProps,
  'object' | 'attributes' | 'memberPicker' | 'count' | 'onApply'
> {
  readonly formId: string;
  /** The id the unique rule's line takes, so Apply can name it. */
  readonly blockedId: string;
  readonly records: string;
  readonly isBusy: boolean;
  readonly isBlocked: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  /** Whether a rule refuses the choice as it stands (Add, Replace or Set on a unique field for several records). */
  readonly onBlockedChange: (isBlocked: boolean) => void;
  readonly onDone: () => void;
}

/** The dialog's form: mounted afresh on each opening, so every opening starts empty. */
function BulkEditForm({
  formId,
  blockedId,
  object,
  attributes,
  memberPicker,
  count,
  records,
  isBusy,
  isBlocked,
  onBusyChange,
  onBlockedChange,
  onApply,
  onDone,
}: BulkEditFormProps) {
  const offered = useMemo(() => offeredAttributes(attributes), [attributes]);
  // A field whose every change the unique rule refuses here shows, muted, with the rule: it can't be chosen.
  const items = useMemo(
    () =>
      offered.map(({ definition, ops }) => ({
        id: definition.id,
        label: definition.title,
        icon: iconOf(toFieldAttribute(definition)),
        ...(ops.every((op) => breaksUnique(definition, op, count))
          ? { isDisabled: true, description: bulkStrings.uniqueRule(definition.title) }
          : {}),
      })),
    [offered, count],
  );
  const [attributeId, setAttributeId] = useState<string | undefined>(undefined);
  const chosen = offered.find((each) => each.definition.id === attributeId);
  const [op, setOp] = useState<BulkOp | undefined>(undefined);
  // The change shown: the one picked, else the first the unique rule allows here.
  const shownOp =
    chosen === undefined
      ? undefined
      : op !== undefined && chosen.ops.includes(op)
        ? op
        : (chosen.ops.find((each) => !breaksUnique(chosen.definition, each, count)) ?? chosen.ops[0]);
  const [value, setValue] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [valueError, setValueError] = useState<string | undefined>(undefined);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const definition = chosen?.definition;
  const isCheckbox = definition?.type === 'checkbox';
  // AC-529: a unique field can't take one value on several records; the Change says so before anything is sent.
  const isRuledOut = definition !== undefined && shownOp !== undefined && breaksUnique(definition, shownOp, count);
  useEffect(() => {
    onBlockedChange(isRuledOut);
  }, [isRuledOut, onBlockedChange]);

  const apply = () => {
    if (isBusy) return;
    if (definition === undefined || shownOp === undefined) {
      setFieldError(bulkStrings.needsField);
      return;
    }
    if (isRuledOut) return;
    // A checkbox has no default here: one Enter must never untick every record.
    if (isCheckbox && value === null) {
      setValueError(bulkStrings.needsChoice);
      return;
    }
    const sent = isCheckbox ? value === true : value;
    if (opTakesValue(shownOp) && !isCheckbox && (sent === null || (Array.isArray(sent) && sent.length === 0))) {
      // Clear is offered only where the field may be empty (never on a required one).
      setValueError(chosen?.ops.includes('clear') === true ? bulkStrings.needsValue : bulkStrings.needsValueOnly);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    void onApply({ attributeId: definition.id, op: shownOp, ...(opTakesValue(shownOp) ? { value: sent } : {}) }).then(
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

  // The unique rule is the Change's error, and the line Apply names for why it is off.
  const ruleOut = isRuledOut ? { error: bulkStrings.uniqueRule(definition.title), errorId: blockedId } : {};
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      isDisabled={isBlocked}
      refusals={refusals}
      onSubmit={apply}
      label={bulkStrings.editTitle(records)}
    >
      {/* The dialog opens on its first choice, the field (the Form's own first field focus would land on React Aria's hidden native select). */}
      <Select
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        label={bulkStrings.field}
        placeholder={bulkStrings.fieldPlaceholder}
        items={items}
        value={attributeId ?? null}
        isRequired
        isSearchable={items.length > SEARCH_PAST}
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
              value={value === null ? null : value === true ? 'checked' : 'unchecked'}
              {...(valueError === undefined ? {} : { error: valueError })}
              onChange={(next) => {
                setOp('set');
                setValue(next === 'checked');
                setValueError(undefined);
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
                {...(chosen.ops.includes('add')
                  ? {
                      info: (
                        <InfoTip label={bulkStrings.change} example={bulkStrings.changeExample}>
                          {bulkStrings.changeHelp}
                        </InfoTip>
                      ),
                    }
                  : {})}
                value={shownOp}
                {...ruleOut}
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
          {!isCheckbox && opTakesValue(shownOp) && !isRuledOut && (
            <AttributeEditor
              key={`${definition.id}:${shownOp === 'set' || shownOp === 'replace' ? 'whole' : 'items'}`}
              attribute={{
                ...toFieldAttribute(definition, undefined, object.standardKey ?? object.apiSlug),
                name: bulkStrings.value,
                isRequired: true,
              }}
              value={value ?? null}
              surface="form"
              {...(definition.type === 'actor_reference'
                ? { display: memberPicker.displays, ...memberPicker.extras }
                : {})}
              onCommit={(next) => {
                setValue(definition.isMulti && next !== null && !Array.isArray(next) ? [next] : next);
                setValueError(undefined);
              }}
              {...(valueError === undefined ? {} : { error: valueError })}
            />
          )}
          {shownOp === 'clear' && <Callout tone="info">{bulkStrings.clearsValue(definition.title, records)}</Callout>}
        </>
      )}
    </Form>
  );
}
