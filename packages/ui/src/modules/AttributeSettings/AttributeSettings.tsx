// AttributeSettings (spec 0012, screens): the one dialog that creates and
// edits an attribute of any object, from settings, the grid's "+" header or
// a column's menu. Presentational: the attribute and the answer's refusals
// come in as props, what the person chose goes out through `onSubmit`, and
// the screen talks to the data layer.
import {
  defaultKindsFor,
  PICKER_TYPES,
  pickerTypeOf,
  toApiSlug,
  type ActorDisplay,
  type AttributeDefault,
  type AttributeType,
  type PickerType,
} from '@crm/contracts/values';
import { useId, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { AttributeEditor, type AttributeEditorProps } from '../../fields/AttributeEditor.tsx';
import { fieldTypeOf, typeLabelOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { arraySource } from '../../lib/list-source.ts';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form, type FormRefusal } from '../../molecules/Form/Form.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import { strings } from './strings.ts';

/** An existing attribute as the dialog edits it. */
export interface AttributeSettingsAttribute {
  readonly type: AttributeType;
  readonly isMulti: boolean;
  readonly title: string;
  readonly apiSlug: string;
  readonly description?: string;
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  readonly defaultValue?: AttributeDefault;
}

/** A setting the dialog shows, by the name the server's refusals give it. */
export type AttributeSettingsField =
  'type' | 'title' | 'apiSlug' | 'description' | 'isRequired' | 'isUnique' | 'isMulti' | 'defaultValue';

/** What the person chose, and which settings they changed (an edit sends only those). */
export interface AttributeSettingsValues {
  readonly type: AttributeType;
  readonly isMulti: boolean;
  readonly title: string;
  /** The API name typed on create; absent when it follows the name (the server derives the same). */
  readonly apiSlug?: string;
  readonly description: string;
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  /** The default, or undefined for none. */
  readonly defaultValue: AttributeDefault | undefined;
  readonly changed: readonly AttributeSettingsField[];
}

/** Props for AttributeSettings. */
export interface AttributeSettingsProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The attribute to edit; a new one is made when absent. */
  readonly attribute?: AttributeSettingsAttribute;
  /** The picker's entries offered on create, by key (`PICKER_TYPES`), in the picker's order; all fifteen when absent. */
  readonly typeKeys?: readonly string[];
  /**
   * Adds "Relationship" last to the picker (#15): choosing it calls
   * `onChoose`, so the screen swaps in its own settings. No entry when absent.
   */
  readonly relationshipEntry?: { readonly label: string; readonly onChoose: () => void };
  /** The workspace's members, offered for a Member attribute's default. */
  readonly members?: readonly ActorDisplay[];
  /** The screen waits for the server: the primary spins and the dialog stays. */
  readonly isBusy?: boolean;
  /** The last answer's refusals: each on the setting it names (`attributeId` is the field), else above them. */
  readonly refusals?: readonly FormRefusal[];
  readonly onSubmit: (values: AttributeSettingsValues) => void;
  /** Shown read only, with this reason on every setting, and Close alone (a system attribute, or a member). */
  readonly readOnlyReason?: string;
}

/** What the member editor's search answers (its list type is the field set's union of display shapes). */
type MemberSource = ReturnType<NonNullable<AttributeEditorProps['onSearch']>>;

/** The key the picker offers Relationship under. */
const RELATIONSHIP = 'relationship';

/** What the default is made of while the person edits it. */
type DefaultKind = 'none' | 'static' | 'current_user' | 'offset';

interface DefaultDraft {
  readonly kind: DefaultKind;
  readonly value: unknown;
  readonly days: string;
}

const NO_DEFAULT: DefaultDraft = { kind: 'none', value: null, days: '0' };
const MAX_DAYS = 3650;

/** A stored default as the dialog edits it. */
function draftOf(fallback: AttributeDefault | undefined): DefaultDraft {
  if (fallback === undefined) return NO_DEFAULT;
  if (fallback.kind === 'static') return { ...NO_DEFAULT, kind: 'static', value: fallback.value };
  if (fallback.kind === 'current_user') return { ...NO_DEFAULT, kind: 'current_user' };
  return { ...NO_DEFAULT, kind: 'offset', days: /^P(\d+)D$/.exec(fallback.duration)?.[1] ?? '0' };
}

/** Whole days from 0 to 3,650, or undefined. */
function daysOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  return days <= MAX_DAYS ? days : undefined;
}

/** The default a draft makes for `type`: undefined for none (an unticked checkbox included). */
function defaultOf(draft: DefaultDraft, type: AttributeType): AttributeDefault | undefined {
  if (draft.kind === 'current_user') return { kind: 'current_user' };
  if (draft.kind === 'offset') {
    const days = daysOf(draft.days);
    return days === undefined ? undefined : { kind: 'offset', duration: `P${String(days)}D` };
  }
  if (draft.kind !== 'static' || draft.value === null) return undefined;
  if (type === 'checkbox' && draft.value === false) return undefined;
  if (Array.isArray(draft.value) && draft.value.length === 0) return undefined;
  return { kind: 'static', value: draft.value };
}

/** The picker's label for an entry: its own for Multi select, Link and Phone (AC-228), else the type's. */
const OWN_LABELS: Readonly<Record<string, string>> = {
  multi_select: strings.multiSelect,
  link: strings.link,
  phone: strings.phone,
};
const pickerLabel = (entry: PickerType) => OWN_LABELS[entry.key] ?? typeLabelOf(entry.type);

/** The settings that land on Form fields by name; the rest are drawn with their own `error`. */
const FORM_FIELDS: ReadonlySet<string> = new Set(['title', 'apiSlug', 'description', 'offsetDays']);

/**
 * AttributeSettings: a Modal with the attribute's name, type, API name,
 * description, rules and default, the type's own editor drawing the default.
 * Create waits for the screen's answer; an edit changes what was changed.
 */
export function AttributeSettings({
  isOpen,
  onOpenChange,
  attribute,
  typeKeys,
  relationshipEntry,
  members = [],
  isBusy = false,
  refusals = [],
  onSubmit,
  readOnlyReason,
}: AttributeSettingsProps) {
  const formId = useId();
  const isReadOnly = readOnlyReason !== undefined;
  const title = attribute === undefined ? strings.newTitle : isReadOnly ? strings.viewTitle : strings.editTitle;
  return (
    <Modal
      title={title}
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its setting.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        isReadOnly ? (
          <Button slot="close" kbd="ESC">
            {strings.close}
          </Button>
        ) : (
          <>
            <Button slot="close" isDisabled={isBusy} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
              {attribute === undefined
                ? isBusy
                  ? strings.creating
                  : strings.create
                : isBusy
                  ? strings.saving
                  : strings.save}
            </Button>
          </>
        )
      }
    >
      <AttributeForm
        formId={formId}
        label={title}
        attribute={attribute}
        typeKeys={typeKeys}
        relationshipEntry={relationshipEntry}
        members={members}
        isBusy={isBusy}
        refusals={refusals}
        onSubmit={onSubmit}
        readOnlyReason={readOnlyReason}
      />
    </Modal>
  );
}

/** Props for the dialog's form, mounted afresh with each opening. */
interface AttributeFormProps {
  readonly formId: string;
  readonly label: string;
  readonly attribute: AttributeSettingsAttribute | undefined;
  readonly typeKeys: readonly string[] | undefined;
  readonly relationshipEntry: AttributeSettingsProps['relationshipEntry'];
  readonly members: readonly ActorDisplay[];
  readonly isBusy: boolean;
  readonly refusals: readonly FormRefusal[];
  readonly onSubmit: (values: AttributeSettingsValues) => void;
  readonly readOnlyReason: string | undefined;
}

function AttributeForm({
  formId,
  label,
  attribute,
  typeKeys,
  relationshipEntry,
  members,
  isBusy,
  refusals,
  onSubmit,
  readOnlyReason,
}: AttributeFormProps) {
  const isCreating = attribute === undefined;
  const isReadOnly = readOnlyReason !== undefined;
  const offered = PICKER_TYPES.filter((entry) => typeKeys === undefined || typeKeys.includes(entry.key));
  const [typeKey, setTypeKey] = useState(() =>
    attribute === undefined
      ? (offered[0]?.key ?? 'text')
      : (pickerTypeOf(attribute.type, attribute.isMulti)?.key ?? attribute.type),
  );
  const entry = PICKER_TYPES.find((each) => each.key === typeKey);
  const type: AttributeType = entry?.type ?? attribute?.type ?? 'text';
  const [name, setName] = useState(attribute?.title ?? '');
  const [apiSlug, setApiSlug] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState(attribute?.description ?? '');
  const [isRequired, setRequired] = useState(attribute?.isRequired ?? false);
  const [isUnique, setUnique] = useState(attribute?.isUnique ?? false);
  const [isMulti, setMulti] = useState(attribute?.isMulti ?? entry?.isMulti ?? false);
  const [draft, setDraft] = useState<DefaultDraft>(() => draftOf(attribute?.defaultValue));
  const [changed, setChanged] = useState<ReadonlySet<AttributeSettingsField>>(new Set());
  const [local, setLocal] = useState<readonly FormRefusal[]>([]);
  const touch = (field: AttributeSettingsField) => {
    setChanged((before) => (before.has(field) ? before : new Set([...before, field])));
  };

  const slugShown = isCreating
    ? (apiSlug ?? (name.trim() === '' ? '' : toApiSlug(name.trim(), 'attribute')))
    : attribute.apiSlug;
  const allowsMultiple = entry?.allowsMultiple ?? attribute?.isMulti ?? false;
  const allowsUnique = entry?.allowsUnique ?? attribute?.isUnique ?? false;
  const hasDefault = defaultKindsFor(type).length > 0;

  // A refusal typed locally wins until the next answer; each lands on its setting, the rest above them.
  const shown = local.length > 0 ? local : refusals;
  const errorOf = (field: AttributeSettingsField) => shown.find((refusal) => refusal.attributeId === field)?.message;

  const chooseType = (key: string | null) => {
    if (key === null || key === typeKey) return;
    if (key === RELATIONSHIP) {
      relationshipEntry?.onChoose();
      return;
    }
    const next = PICKER_TYPES.find((each) => each.key === key);
    if (next === undefined) return;
    setTypeKey(key);
    // A new type starts its own settings: its default, Unique and Allow multiple.
    setDraft(NO_DEFAULT);
    setUnique(false);
    setMulti(next.isMulti);
    touch('type');
  };

  const submit = () => {
    if (isBusy || isReadOnly) return;
    const problems: FormRefusal[] = [
      ...(name.trim() === '' ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'title' }] : []),
      ...(draft.kind === 'offset' && daysOf(draft.days) === undefined
        ? [{ code: 'INPUT_INVALID', message: strings.daysInvalid, attributeId: 'offsetDays' }]
        : []),
    ];
    setLocal(problems);
    if (problems.length > 0) return;
    onSubmit({
      type,
      isMulti,
      title: name.trim(),
      ...(isCreating && apiSlug !== undefined && apiSlug.trim() !== '' ? { apiSlug: apiSlug.trim() } : {}),
      description: description.trim(),
      isRequired,
      isUnique: allowsUnique && isUnique,
      defaultValue: hasDefault ? defaultOf(draft, type) : undefined,
      changed: [...changed],
    });
  };

  const itemOf = (each: PickerType): SelectItem => ({
    id: each.key,
    label: pickerLabel(each),
    icon: fieldTypeOf(each.type).icon,
  });
  // Creating: the offered entries, then Relationship when #15 gives it. Editing: the attribute's own type, which
  // may be one the picker doesn't offer (a personal name, a relationship).
  const items: readonly SelectItem[] = isCreating
    ? [
        ...offered.map(itemOf),
        ...(relationshipEntry === undefined
          ? []
          : [{ id: RELATIONSHIP, label: relationshipEntry.label, icon: fieldTypeOf('record_reference').icon }]),
      ]
    : [entry === undefined ? { id: typeKey, label: typeLabelOf(type), icon: fieldTypeOf(type).icon } : itemOf(entry)];
  // The default's refusal shows on its editor when one is drawn, else above the settings.
  const kinds = defaultKindsFor(type);
  const hasDefaultEditor =
    hasDefault &&
    ((!kinds.includes('offset') && !kinds.includes('current_user')) ||
      draft.kind === 'static' ||
      draft.kind === 'offset');
  const ownErrors = ['type', 'isRequired', 'isUnique', ...(hasDefaultEditor ? ['defaultValue'] : [])];
  const formRefusals = shown.filter(
    (refusal) => refusal.attributeId === undefined || !ownErrors.includes(refusal.attributeId),
  );

  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={formRefusals}
      fieldFor={(refusal) =>
        refusal.attributeId !== undefined && FORM_FIELDS.has(refusal.attributeId) ? refusal.attributeId : undefined
      }
      onSubmit={submit}
      label={label}
      focusesFirstField={!isReadOnly}
    >
      <Field
        label={strings.name}
        name="title"
        autoComplete="off"
        isRequired
        maxLength={100}
        value={name}
        onChange={(next) => {
          setName(next);
          touch('title');
        }}
        {...(isReadOnly ? { isReadOnly, readOnlyReason } : {})}
      />
      <Select
        label={strings.type}
        items={items}
        value={typeKey}
        onChange={chooseType}
        {...(isCreating ? {} : { isReadOnly: true, readOnlyReason: readOnlyReason ?? strings.typeLater })}
        {...(errorOf('type') === undefined ? {} : { error: errorOf('type') })}
      />
      {isCreating ? (
        <Field
          label={strings.apiName}
          name="apiSlug"
          autoComplete="off"
          maxLength={63}
          hint={strings.apiNameHint}
          value={slugShown}
          // Emptied, it follows the name again.
          onChange={(next) => {
            setApiSlug(next === '' ? undefined : next);
          }}
        />
      ) : (
        <Field
          label={strings.apiName}
          value={slugShown}
          isReadOnly
          readOnlyReason={strings.apiNameLocked}
          suffix={<CopyButton value={slugShown} label={strings.copyApiName} isIconOnly variant="ghost" />}
        />
      )}
      <Field
        label={strings.description}
        name="description"
        isMultiline
        maxLength={500}
        showCounter={!isReadOnly}
        hint={strings.descriptionHint}
        value={description}
        onChange={(next) => {
          setDescription(next);
          touch('description');
        }}
        {...(isReadOnly ? { isReadOnly, readOnlyReason } : {})}
      />
      <Checkbox
        label={strings.required}
        description={strings.requiredHint}
        isSelected={isRequired}
        isReadOnly={isReadOnly}
        onChange={(next) => {
          setRequired(next);
          touch('isRequired');
        }}
        {...(errorOf('isRequired') === undefined ? {} : { error: errorOf('isRequired') })}
      />
      {allowsUnique && (
        <Checkbox
          label={strings.unique}
          description={strings.uniqueHint}
          isSelected={isUnique}
          isReadOnly={isReadOnly}
          onChange={(next) => {
            setUnique(next);
            touch('isUnique');
          }}
          {...(errorOf('isUnique') === undefined ? {} : { error: errorOf('isUnique') })}
        />
      )}
      {allowsMultiple && (
        <Checkbox
          label={strings.allowMultiple}
          description={isCreating ? strings.allowMultipleHint : strings.allowMultipleLocked}
          isSelected={isMulti}
          isReadOnly={isReadOnly || !isCreating}
          onChange={(next) => {
            setMulti(next);
            // A default made for one value or several starts again.
            setDraft(NO_DEFAULT);
            touch('isMulti');
          }}
        />
      )}
      {hasDefault && (
        <DefaultSetting
          // Mounted afresh for each type and multiple setting, so its editor starts from the new shape.
          key={`${typeKey}:${String(isMulti)}`}
          type={type}
          isMulti={isMulti}
          draft={draft}
          members={members}
          readOnlyReason={readOnlyReason}
          error={errorOf('defaultValue')}
          onChange={(next) => {
            setDraft(next);
            touch('defaultValue');
          }}
        />
      )}
    </Form>
  );
}

/** Props for the default's setting. */
interface DefaultSettingProps {
  readonly type: AttributeType;
  readonly isMulti: boolean;
  readonly draft: DefaultDraft;
  readonly members: readonly ActorDisplay[];
  readonly readOnlyReason: string | undefined;
  readonly error: string | undefined;
  readonly onChange: (draft: DefaultDraft) => void;
}

/**
 * The default (AC-234), through the type's own form editor. A date also
 * offers "Today plus days", a member "Current user", as a choice (RadioGroup) above the
 * editor.
 */
function DefaultSetting({ type, isMulti, draft, members, readOnlyReason, error, onChange }: DefaultSettingProps) {
  const isReadOnly = readOnlyReason !== undefined;
  const kinds = defaultKindsFor(type);
  const editorFor = (name: string) => {
    const attribute: FieldAttribute = {
      id: 'defaultValue',
      name,
      type,
      allowMultiple: isMulti,
      isRequired: false,
      isUnique: false,
      isReadOnly,
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
    };
    const chosen = draft.kind === 'static' ? draft.value : null;
    const listed: readonly unknown[] = Array.isArray(chosen) ? (chosen as readonly unknown[]) : [chosen];
    const memberIds = new Set(
      listed.flatMap((each) =>
        typeof each === 'object' && each !== null && 'id' in each && typeof each.id === 'string' ? [each.id] : [],
      ),
    );
    return (
      <AttributeEditor
        attribute={attribute}
        value={chosen as AttributeEditorProps['value']}
        surface="form"
        onCommit={(value) => {
          onChange({ ...draft, kind: value === null ? 'none' : 'static', value });
        }}
        {...(type === 'actor_reference'
          ? {
              display: members.filter((member) => member.id !== null && memberIds.has(member.id)),
              // The member picker's list, matched by name in memory: the members are already here.
              onSearch: (query: string) =>
                arraySource(
                  members.filter((member) => member.name.toLowerCase().includes(query.trim().toLowerCase())),
                  (member) => member.id ?? member.name,
                ) as unknown as MemberSource,
            }
          : {})}
        {...(error === undefined ? {} : { error })}
      />
    );
  };
  // Most types: the editor alone; empty means no default.
  if (!kinds.includes('offset') && !kinds.includes('current_user')) return editorFor(strings.defaultValue);
  const isDate = kinds.includes('offset');
  const choices = isDate
    ? [
        { value: 'none', label: strings.noDefault },
        { value: 'static', label: strings.fixedDate },
        { value: 'offset', label: strings.daysFromToday },
      ]
    : [
        { value: 'none', label: strings.noDefault },
        { value: 'current_user', label: strings.currentUser },
        { value: 'static', label: strings.chosenMember },
      ];
  return (
    <>
      {/* A saved setting, so a RadioGroup (SegmentedControl switches views): its label is the section's. */}
      <RadioGroup
        label={strings.defaultValue}
        orientation="horizontal"
        value={draft.kind}
        isReadOnly={isReadOnly}
        onChange={(next) => {
          if (next === 'none' || next === 'static' || next === 'current_user' || next === 'offset') {
            onChange({ ...draft, kind: next, value: next === draft.kind ? draft.value : null });
          }
        }}
      >
        {choices.map((segment) => (
          <Radio key={segment.value} value={segment.value}>
            {segment.label}
          </Radio>
        ))}
      </RadioGroup>
      {draft.kind === 'static' && editorFor(isDate ? strings.defaultDate : strings.defaultMember)}
      {draft.kind === 'offset' && (
        <Field
          label={strings.days}
          name="offsetDays"
          inputMode="numeric"
          autoComplete="off"
          hint={strings.daysHint}
          value={draft.days}
          onChange={(days) => {
            onChange({ ...draft, days });
          }}
          {...(isReadOnly ? { isReadOnly } : {})}
          {...(error === undefined ? {} : { error })}
        />
      )}
    </>
  );
}
