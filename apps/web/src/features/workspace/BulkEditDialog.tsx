// Brief
// Purpose: change one or more fields on every ticked record at once (spec 0022, milestone 2; several, 31 Oct 2026).
// Main task: pick a field, the change (Set, Clear, Add, Remove, Replace), the value through the field's own editor, Add field for another, then Apply.
// Leaves out: several fields on a background job (one at a time there), relationships (owner decision 3) and per record previews.
import {
  bulkOpsFor,
  isEditableHere,
  opTakesValue,
  refusalSummary,
  toFieldAttribute,
  withPendingOptions,
  type AttributeDefinition,
  type BulkEditResult,
  type BulkOp,
  type ObjectSummary,
} from '@crm/data';
import {
  AttributeEditor,
  Button,
  Callout,
  FieldGroup,
  Form,
  iconOf,
  InfoTip,
  Modal,
  Radio,
  RadioGroup,
  Select,
  type FormRefusal,
} from '@crm/ui';
import { usePendingOptions } from '@crm/data/react';
import { useParams, useRouteContext } from '@tanstack/react-router';
import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import type { MemberPicker } from '../records/members.ts';
import { withOption, withoutOption } from '../records/option-values.ts';
import { useOptionMaker } from '../records/options.ts';
import { bulkStrings, recordsWord } from './bulk.ts';

/** An attribute the dialog offers, with the changes its type takes (AC-529). */
export interface Offered {
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
  /** Sends the edits, one per field, in order; the dialog waits for them, and shows a refusal above its fields. */
  readonly onApply: (choices: readonly BulkEditChoice[]) => Promise<BulkEditResult>;
  /** One field only: the change runs as a background job, which takes one field (no Add field). */
  readonly isSingle?: boolean;
}

/** "Edit 48 people": a Modal with a field, its change and value (Add field for more), and Apply. */
export function BulkEditDialog({
  isOpen,
  onOpenChange,
  object,
  attributes,
  memberPicker,
  count,
  records: named,
  onApply,
  isSingle = false,
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
        isSingle={isSingle}
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
  'object' | 'attributes' | 'memberPicker' | 'count' | 'onApply' | 'isSingle'
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

/** One field to change: which, how, and to what, with what is wrong with it so far. */
export interface EditRow {
  readonly key: number;
  readonly attributeId: string | undefined;
  readonly op: BulkOp | undefined;
  readonly value: unknown;
  readonly fieldError: string | undefined;
  readonly valueError: string | undefined;
}

/** A row with nothing chosen yet. */
const emptyRow = (key: number): EditRow => ({
  key,
  attributeId: undefined,
  op: undefined,
  value: null,
  fieldError: undefined,
  valueError: undefined,
});

/** A change to one row: some of its parts, or worked out from the row as it is when it lands. */
type RowPatch = Partial<Omit<EditRow, 'key'>> | ((row: EditRow) => Partial<Omit<EditRow, 'key'>>);

/** The change a row shows: the one picked, else the first the unique rule allows here. */
export function shownOpOf(row: EditRow, chosen: Offered | undefined, count: number): BulkOp | undefined {
  if (chosen === undefined) return undefined;
  if (row.op !== undefined && chosen.ops.includes(row.op)) return row.op;
  return chosen.ops.find((each) => !breaksUnique(chosen.definition, each, count)) ?? chosen.ops[0];
}

/**
 * What a row sends, or why it can't yet (AC-529): no field, a unique field several records can't share, a checkbox
 * with neither state picked (one Enter must never untick every record), or a change that takes a value with none.
 */
export function checkRow(
  row: EditRow,
  offered: readonly Offered[],
  count: number,
):
  | { readonly kind: 'ok'; readonly choice: BulkEditChoice }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'invalid'; readonly fieldError?: string; readonly valueError?: string } {
  const chosen = offered.find((each) => each.definition.id === row.attributeId);
  const op = shownOpOf(row, chosen, count);
  if (chosen === undefined || op === undefined) return { kind: 'invalid', fieldError: bulkStrings.needsField };
  if (breaksUnique(chosen.definition, op, count)) return { kind: 'blocked' };
  const isCheckbox = chosen.definition.type === 'checkbox';
  if (isCheckbox && row.value === null) return { kind: 'invalid', valueError: bulkStrings.needsChoice };
  const sent = isCheckbox ? row.value === true : row.value;
  if (opTakesValue(op) && !isCheckbox && (sent === null || (Array.isArray(sent) && sent.length === 0))) {
    // Clear is offered only where the field may be empty (never on a required one).
    return {
      kind: 'invalid',
      valueError: chosen.ops.includes('clear') ? bulkStrings.needsValue : bulkStrings.needsValueOnly,
    };
  }
  return {
    kind: 'ok',
    choice: { attributeId: chosen.definition.id, op, ...(opTakesValue(op) ? { value: sent } : {}) },
  };
}

/** The dialog's form: mounted afresh on each opening, so every opening starts with one empty row. */
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
  isSingle = false,
  onBusyChange,
  onBlockedChange,
  onApply,
  onDone,
}: BulkEditFormProps) {
  const offered = useMemo(() => offeredAttributes(attributes), [attributes]);
  const [rows, setRows] = useState<readonly EditRow[]>(() => [emptyRow(0)]);
  const [nextKey, setNextKey] = useState(1);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const change = (key: number, patch: RowPatch) => {
    setRows((held) =>
      held.map((row) => (row.key === key ? { ...row, ...(typeof patch === 'function' ? patch(row) : patch) } : row)),
    );
  };
  // AC-529: a unique field can't take one value on several records; its row says so, and Apply is off.
  const isRuledOut = rows.some((row) => checkRow(row, offered, count).kind === 'blocked');
  useEffect(() => {
    onBlockedChange(isRuledOut);
  }, [isRuledOut, onBlockedChange]);

  const apply = () => {
    if (isBusy || isRuledOut) return;
    const checked = rows.map((row) => ({ row, check: checkRow(row, offered, count) }));
    const invalid = checked.filter(({ check }) => check.kind === 'invalid');
    if (invalid.length > 0) {
      setRows((held) =>
        held.map((row) => {
          const found = checked.find((each) => each.row.key === row.key)?.check;
          return found?.kind === 'invalid'
            ? { ...row, fieldError: found.fieldError, valueError: found.valueError }
            : row;
        }),
      );
      return;
    }
    const choices = checked.flatMap(({ check }) => (check.kind === 'ok' ? [check.choice] : []));
    onBusyChange(true);
    setRefusals([]);
    void onApply(choices).then(
      (result) => {
        onBusyChange(false);
        if (result.kind === 'failed') {
          // Refused whole (a read only field, the network): said here, where it was asked.
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

  const isMany = rows.length > 1;
  // Another row while every row has its field and a field is left to pick (one field at a time on a background job).
  const canAdd = !isSingle && rows.every((row) => row.attributeId !== undefined) && rows.length < offered.length;
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      isDisabled={isBlocked}
      refusals={refusals}
      onSubmit={apply}
      label={bulkStrings.editTitle(records)}
    >
      {rows.map((row, index) => {
        const fields = (
          <EditRowFields
            row={row}
            place={index + 1}
            isLabelHidden={isMany}
            isFirst={index === 0}
            offered={offered}
            taken={rows.flatMap((each) =>
              each.key !== row.key && each.attributeId !== undefined ? [each.attributeId] : [],
            )}
            object={object}
            memberPicker={memberPicker}
            count={count}
            blockedId={blockedId}
            onChange={(patch) => {
              change(row.key, patch);
            }}
          />
        );
        if (!isMany) return <Fragment key={row.key}>{fields}</Fragment>;
        const title = offered.find((each) => each.definition.id === row.attributeId)?.definition.title;
        // Several: each change is a group named by its place, with its Remove at the label's end.
        return (
          <FieldGroup
            key={row.key}
            label={bulkStrings.fieldAt(index + 1)}
            action={
              <Button
                variant="ghost"
                size="sm"
                icon="x"
                label={bulkStrings.removeField(title ?? bulkStrings.fieldAt(index + 1))}
                onPress={() => {
                  setRows((held) => held.filter((each) => each.key !== row.key));
                }}
              />
            }
          >
            {fields}
          </FieldGroup>
        );
      })}
      {canAdd && (
        <Button
          variant="ghost"
          icon="plus"
          onPress={() => {
            setRows((held) => [...held, emptyRow(nextKey)]);
            setNextKey((key) => key + 1);
          }}
        >
          {bulkStrings.addField}
        </Button>
      )}
    </Form>
  );
}

/** One row's controls: the field, the change where it has a choice, and the value through the field's own editor. */
function EditRowFields({
  row,
  place,
  isLabelHidden,
  isFirst,
  offered,
  taken,
  object,
  memberPicker,
  count,
  blockedId,
  onChange,
}: {
  readonly row: EditRow;
  readonly place: number;
  /** Several rows: the group around it names it. */
  readonly isLabelHidden: boolean;
  readonly isFirst: boolean;
  readonly offered: readonly Offered[];
  /** Fields other rows chose: one change per field. */
  readonly taken: readonly string[];
  readonly object: ObjectSummary;
  readonly memberPicker: MemberPicker;
  readonly count: number;
  readonly blockedId: string;
  readonly onChange: (patch: RowPatch) => void;
}) {
  // A field whose every change the unique rule refuses here shows, muted, with the rule: it can't be chosen.
  const items = useMemo(
    () =>
      offered
        .filter(({ definition }) => !taken.includes(definition.id))
        .map(({ definition, ops }) => ({
          id: definition.id,
          label: definition.title,
          icon: iconOf(toFieldAttribute(definition)),
          ...(ops.every((op) => breaksUnique(definition, op, count))
            ? { isDisabled: true, description: bulkStrings.uniqueRule(definition.title) }
            : {}),
        })),
    [offered, taken, count],
  );
  const chosen = offered.find((each) => each.definition.id === row.attributeId);
  const shownOp = shownOpOf(row, chosen, count);
  const { slug = '' } = useParams({ strict: false });
  const makeOption = useOptionMaker(slug, object.id);
  // An option made here shows by its label at once, from the data layer's pending options.
  const { data } = useRouteContext({ from: '__root__' });
  const pendingOptions = usePendingOptions(data.options.pending);
  const definition = chosen?.definition;
  const isCheckbox = definition?.type === 'checkbox';
  const isRuledOut = definition !== undefined && shownOp !== undefined && breaksUnique(definition, shownOp, count);
  // The unique rule is the Change's error, and the line Apply names for why it is off.
  const ruleOut = isRuledOut ? { error: bulkStrings.uniqueRule(definition.title), errorId: blockedId } : {};
  const label = isLabelHidden || !isFirst ? bulkStrings.fieldAt(place) : bulkStrings.field;
  return (
    <>
      {/* The dialog opens on its first choice, the field (the Form's own first field focus would land on React Aria's hidden native select); a row added later takes focus too. */}
      <Select
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        label={label}
        isLabelHidden={isLabelHidden}
        placeholder={bulkStrings.fieldPlaceholder}
        items={items}
        value={row.attributeId ?? null}
        isRequired
        isSearchable={items.length > SEARCH_PAST}
        {...(row.fieldError === undefined ? {} : { error: row.fieldError })}
        onChange={(id) => {
          onChange({
            attributeId: id ?? undefined,
            op: undefined,
            value: null,
            fieldError: undefined,
            valueError: undefined,
          });
        }}
      />
      {chosen !== undefined && definition !== undefined && shownOp !== undefined && (
        <>
          {isCheckbox ? (
            <RadioGroup
              label={bulkStrings.change}
              orientation="horizontal"
              value={row.value === null ? null : row.value === true ? 'checked' : 'unchecked'}
              {...(row.valueError === undefined ? {} : { error: row.valueError })}
              onChange={(next) => {
                onChange({ op: 'set', value: next === 'checked', valueError: undefined });
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
                  onChange({ op: next as BulkOp, valueError: undefined });
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
              attribute={withPendingOptions(
                {
                  ...toFieldAttribute(definition, undefined, object.standardKey ?? object.apiSlug),
                  name: bulkStrings.value,
                  isRequired: true,
                },
                slug,
                pendingOptions,
              )}
              value={row.value ?? null}
              surface="form"
              {...(definition.type === 'actor_reference'
                ? { display: memberPicker.displays, ...memberPicker.extras }
                : {})}
              onCommit={(next) => {
                onChange({
                  value: definition.isMulti && next !== null && !Array.isArray(next) ? [next] : next,
                  valueError: undefined,
                });
              }}
              // "Create "<typed>"" in a select or status, for schema managers: made, then chosen as the value.
              {...(makeOption === undefined
                ? {}
                : {
                    onCreateOption: (optionLabel: string) => {
                      // Chosen at once, from what the row holds when it lands (never a pick made meanwhile
                      // overwritten), and dropped again on a refusal.
                      const optionId = makeOption(definition.id, optionLabel, (refused) => {
                        onChange((held) => ({ value: withoutOption(held.value, refused) }));
                      });
                      if (optionId === undefined) return;
                      onChange((held) => ({
                        value: withOption(held.value, optionId, definition.isMulti),
                        valueError: undefined,
                      }));
                    },
                  })}
              {...(row.valueError === undefined ? {} : { error: row.valueError })}
            />
          )}
        </>
      )}
    </>
  );
}
