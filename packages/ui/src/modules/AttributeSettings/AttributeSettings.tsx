// AttributeSettings (spec 0012, screens): the one dialog that creates and
// edits an attribute of any object, from settings, the grid's "+" header or
// a column's menu. Presentational: the attribute and the answer's refusals
// come in as props, what the person chose goes out through `onSubmit`, and
// the screen talks to the data layer.
import {
  CURRENCY_CODES,
  defaultKindsFor,
  PICKER_TYPES,
  pickerTypeOf,
  STARTER_STAGES,
  toApiSlug,
  type ActorDisplay,
  type AttributeDefault,
  type AttributeType,
  type PickerType,
} from '@crm/contracts/values';
import { ruleKindFits, ruleKindsFor } from '@crm/contracts/validation';
import { checkRuleSettings, type ConditionAttribute } from '@crm/contracts/values';
import { useId, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { AttributeEditor, type AttributeEditorProps } from '../../fields/AttributeEditor.tsx';
import { fieldTypeOf, typeLabelOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { arraySource } from '../../lib/list-source.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form, type FormRefusal } from '../../molecules/Form/Form.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import type { FilterBuilderProps } from '../FilterBuilder/FilterBuilder.tsx';
import { OptionsEditor, type OptionsEditorChange, type OptionsEditorOption } from '../OptionsEditor/OptionsEditor.tsx';
import type { DialogStep } from '../RelationshipSettings/RelationshipSettings.tsx';
import {
  editorRuleOf,
  ruleOf,
  RulesEditor,
  type RuleSettings,
  type RulesEditorRule,
} from '../RulesEditor/RulesEditor.tsx';
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
  /** The type's settings: a number's `display`, a currency's `defaultCurrency`. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** A select's options or a status attribute's stages, in order, archived ones included. */
  readonly options?: readonly OptionsEditorOption[];
  /** Its validation rules, in order (spec 0013). */
  readonly rules?: readonly RuleSettings[];
}

/** A setting the dialog shows, by the name the server's refusals give it. */
export type AttributeSettingsField =
  | 'type'
  | 'title'
  | 'apiSlug'
  | 'description'
  | 'isRequired'
  | 'isUnique'
  | 'isMulti'
  | 'defaultValue'
  | 'config'
  | 'options'
  | 'rules';

/**
 * An existing attribute's options, written as they change (spec 0012,
 * AC-236): the screen sends each to the server and passes back what is still
 * with it (`pending`) and what was refused (`errors`, by option id).
 */
export interface AttributeSettingsOptionWrites {
  readonly onAdd: (option: OptionsEditorOption) => void;
  readonly onChange: (id: string, change: OptionsEditorChange) => void;
  readonly onMove: (id: string, position: number) => void;
  readonly onArchive: (id: string) => void;
  readonly onRestore: (id: string) => void;
  readonly pending?: ReadonlySet<string>;
  readonly errors?: Readonly<Partial<Record<string, string>>>;
}

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
  /** The type's settings (a number's display, a currency's code); `{}` for a type that takes none. */
  readonly config: Readonly<Record<string, unknown>>;
  /** On create, a select's or status attribute's first options, in order; empty for any other type. */
  readonly options: readonly OptionsEditorOption[];
  /** Its validation rules, in order, as the API takes them (spec 0013); `changed` names `rules` once touched. */
  readonly rules: readonly RuleSettings[];
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
   * `onChoose` with the name typed so far, so the screen swaps in its own
   * settings and keeps the name. No entry when absent.
   */
  readonly relationshipEntry?: {
    readonly label: string;
    readonly onChoose: (draft: { readonly title: string }) => void;
  };
  /** The workspace's members, offered for a Member attribute's default. */
  readonly members?: readonly ActorDisplay[];
  /** The screen waits for the server: the primary spins and the dialog stays. */
  readonly isBusy?: boolean;
  /** The last answer's refusals: each on the setting it names (`attributeId` is the field), else above them. */
  readonly refusals?: readonly FormRefusal[];
  readonly onSubmit: (values: AttributeSettingsValues) => void;
  /** Shown read only, with this reason on every setting, and Close alone (a system attribute, or a member). */
  readonly readOnlyReason?: string;
  /** A new option's id (a UUID v7 the screen mints): a new select's options and a new status's stages need one each. */
  readonly newOptionId?: () => string;
  /** The live options an attribute may hold (`usage.get`'s `optionsPerAttribute`): "N of 500". */
  readonly optionsLimit?: number;
  /** Editing: the options' writes, each sent as it is made. Without it an existing attribute's options are read only. */
  readonly optionWrites?: AttributeSettingsOptionWrites;
  /**
   * The object's own attributes a rule's "Only when…" may name (spec 0013;
   * no relationship is followed). Without them rules take no condition.
   */
  readonly ruleAttributes?: readonly FieldAttribute[];
  /** What a condition's reference operands need (member search, the signed in member). */
  readonly ruleEditorProps?: FilterBuilderProps['editorProps'];
  /** A new rule's id (a UUID v7 the screen mints). */
  readonly newRuleId?: () => string;
  /**
   * Another dialog's step shown in this one's place, in the same Modal
   * (RelationshipSettings' `relationshipStep` once Relationship is chosen,
   * spec 0014): the scrim stays, and focus still goes back to what opened
   * the dialog when it closes. `isBusy` then means the step's write.
   */
  readonly step?: DialogStep;
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
  newOptionId,
  optionsLimit,
  optionWrites,
  ruleAttributes,
  ruleEditorProps,
  newRuleId,
  step,
}: AttributeSettingsProps) {
  const formId = useId();
  const isReadOnly = readOnlyReason !== undefined;
  const title = attribute === undefined ? strings.newTitle : isReadOnly ? strings.viewTitle : strings.editTitle;
  return (
    <Modal
      title={step?.title ?? title}
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its setting.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        step !== undefined ? (
          step.actions
        ) : isReadOnly ? (
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
      {step !== undefined ? (
        step.body
      ) : (
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
          newOptionId={newOptionId}
          optionsLimit={optionsLimit}
          optionWrites={optionWrites}
          ruleAttributes={ruleAttributes}
          ruleEditorProps={ruleEditorProps}
          newRuleId={newRuleId}
        />
      )}
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
  readonly newOptionId: (() => string) | undefined;
  readonly optionsLimit: number | undefined;
  readonly optionWrites: AttributeSettingsOptionWrites | undefined;
  readonly ruleAttributes: readonly FieldAttribute[] | undefined;
  readonly ruleEditorProps: FilterBuilderProps['editorProps'] | undefined;
  readonly newRuleId: (() => string) | undefined;
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
  newOptionId,
  optionsLimit,
  optionWrites,
  ruleAttributes,
  ruleEditorProps,
  newRuleId,
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
  const [config, setConfig] = useState<Readonly<Record<string, unknown>>>(() => attribute?.config ?? {});
  // A new select's options and a new status's stages, kept here until create sends them (AC-230).
  const [drafts, setDrafts] = useState<readonly OptionsEditorOption[]>(() =>
    attribute === undefined && entry?.type === 'status' ? starterStages(newOptionId) : [],
  );
  // Its rules as edited, kept until Save sends them (spec 0013, AC-252).
  const [rules, setRules] = useState<readonly RulesEditorRule[]>(() => (attribute?.rules ?? []).map(editorRuleOf));
  const madeRules = useRef(0);
  const ruleId = () => {
    if (newRuleId !== undefined) return newRuleId();
    madeRules.current += 1;
    return `rule-${String(madeRules.current)}`;
  };
  const [changed, setChanged] = useState<ReadonlySet<AttributeSettingsField>>(new Set());
  // An option row refused what was typed (a label taken): the create waits until it is fixed.
  const [areOptionsInvalid, setOptionsInvalid] = useState(false);
  const [local, setLocal] = useState<readonly FormRefusal[]>([]);
  const touch = (field: AttributeSettingsField) => {
    setChanged((before) => (before.has(field) ? before : new Set([...before, field])));
  };

  const conditionTypes = new Map<string, ConditionAttribute>(
    (ruleAttributes ?? []).map((each) => [each.id, { type: each.type, isSystem: false }]),
  );

  const slugShown = isCreating
    ? (apiSlug ?? (name.trim() === '' ? '' : toApiSlug(name.trim(), 'attribute')))
    : attribute.apiSlug;
  const allowsMultiple = entry?.allowsMultiple ?? attribute?.isMulti ?? false;
  const allowsUnique = entry?.allowsUnique ?? attribute?.isUnique ?? false;
  const hasDefault = defaultKindsFor(type).length > 0;
  const takesOptions = type === 'select' || type === 'status';
  const options = isCreating ? drafts : (attribute.options ?? []);

  // A refusal typed locally wins until the next answer; each lands on its setting, the rest above them.
  const shown = local.length > 0 ? local : refusals;
  const errorOf = (field: AttributeSettingsField) => shown.find((refusal) => refusal.attributeId === field)?.message;

  const chooseType = (key: string | null) => {
    if (key === null || key === typeKey) return;
    if (key === RELATIONSHIP) {
      relationshipEntry?.onChoose({ title: name.trim() });
      return;
    }
    const next = PICKER_TYPES.find((each) => each.key === key);
    if (next === undefined) return;
    setTypeKey(key);
    // A new type starts its own settings: its default, Unique, Allow multiple, its settings and options.
    setDraft(NO_DEFAULT);
    setUnique(false);
    setMulti(next.isMulti);
    setConfig(next.type === 'currency' ? { defaultCurrency: DEFAULT_CURRENCY } : {});
    // A select keeps its options between Select and Multi select; a status starts from the starter stages.
    setDrafts((before) =>
      next.type === 'status' ? starterStages(newOptionId) : next.type === 'select' && type === 'select' ? before : [],
    );
    // Rules the new type can't take go (a length on what is now a number).
    setRules((before) => before.filter((rule) => ruleKindFits(rule.kind, { type: next.type, isMulti: next.isMulti })));
    touch('type');
  };

  const submit = () => {
    if (isBusy || isReadOnly) return;
    const problems: FormRefusal[] = [
      ...(name.trim() === '' ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'title' }] : []),
      ...(draft.kind === 'offset' && daysOf(draft.days) === undefined
        ? [{ code: 'INPUT_INVALID', message: strings.daysInvalid, attributeId: 'offsetDays' }]
        : []),
      ...(isCreating && (type === 'select' || type === 'status') && areOptionsInvalid
        ? [{ code: 'INPUT_INVALID', message: strings.optionsInvalid, attributeId: 'options' }]
        : []),
      // Each rule's settings, checked here as the server will (spec 0013, AC-253), on their own field.
      ...rules.flatMap((rule, index) => {
        const checked = checkRuleSettings(ruleOf(rule), { attribute: { type, isMulti }, attributes: conditionTypes });
        return checked.ok
          ? []
          : checked.problems.map((problem) => ({
              code: 'CONFIG_INVALID',
              message: problem.message,
              attributeId: `rules.${String(index)}.${problem.field}`,
            }));
      }),
    ];
    setLocal(problems);
    if (problems.length > 0) return;
    const fallback = hasDefault ? defaultOf(draft, type) : undefined;
    onSubmit({
      type,
      isMulti,
      title: name.trim(),
      ...(isCreating && apiSlug !== undefined && apiSlug.trim() !== '' ? { apiSlug: apiSlug.trim() } : {}),
      description: description.trim(),
      isRequired,
      isUnique: allowsUnique && isUnique,
      // A default naming an option removed before create names nothing: it goes.
      defaultValue: isCreating && takesOptions ? withinOptions(fallback, drafts) : fallback,
      config: configFor(type, config),
      options: isCreating && takesOptions ? drafts : [],
      rules: rules.map(ruleOf),
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
  const defaultKinds = defaultKindsFor(type);
  const hasDefaultEditor =
    hasDefault &&
    ((!defaultKinds.includes('offset') && !defaultKinds.includes('current_user')) ||
      draft.kind === 'static' ||
      draft.kind === 'offset');
  const ownErrors = [
    'type',
    'isRequired',
    'isUnique',
    'config',
    ...(takesOptions ? ['options'] : []),
    ...(hasDefaultEditor ? ['defaultValue'] : []),
  ];
  const isRuleField = (field: string | undefined) => field === 'rules' || field?.startsWith('rules.') === true;
  const formRefusals = shown.filter(
    (refusal) =>
      refusal.attributeId === undefined ||
      (!ownErrors.includes(refusal.attributeId) && !isRuleField(refusal.attributeId)),
  );
  // A rule's refusals land on its setting; one about the list (the 20 rule limit) under it.
  const ruleErrors = Object.fromEntries(
    shown.flatMap((refusal) =>
      refusal.attributeId?.startsWith('rules.') === true ? [[refusal.attributeId, refusal.message] as const] : [],
    ),
  );
  const listError = shown.find((refusal) => refusal.attributeId === 'rules')?.message;
  const kinds = ruleKindsFor({ type, isMulti });

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
      {/* Said once, above the settings, rather than under each of them. */}
      {readOnlyReason !== undefined && <Callout>{readOnlyReason}</Callout>}
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
        {...(isReadOnly ? { isReadOnly } : {})}
      />
      <Select
        label={strings.type}
        items={items}
        value={typeKey}
        onChange={chooseType}
        {...(isCreating ? {} : { isReadOnly: true, readOnlyReason: strings.typeLater })}
        {...(errorOf('type') === undefined ? {} : { error: errorOf('type') })}
      />
      <TypeSettings
        type={type}
        config={config}
        isReadOnly={isReadOnly}
        error={errorOf('config')}
        onChange={(next) => {
          setConfig(next);
          touch('config');
        }}
      />
      {takesOptions && (
        <OptionsSetting
          isCreating={isCreating}
          kind={type === 'status' ? 'status' : 'select'}
          options={options}
          limit={optionsLimit}
          newId={newOptionId}
          isReadOnly={isReadOnly || (!isCreating && optionWrites === undefined)}
          error={errorOf('options')}
          writes={optionWrites}
          onDrafts={(next) => {
            setDrafts(next);
            touch('options');
          }}
          onInvalidChange={setOptionsInvalid}
        />
      )}
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
        {...(isReadOnly ? { isReadOnly } : {})}
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
          options={options}
          config={config}
          isRequired={isRequired}
          readOnlyReason={readOnlyReason}
          error={errorOf('defaultValue')}
          onChange={(next) => {
            setDraft(next);
            touch('defaultValue');
          }}
        />
      )}
      {(kinds.length > 0 || rules.length > 0) && (
        <>
          <RulesEditor
            label={strings.rules}
            rules={rules}
            kinds={kinds}
            attribute={{ title: name, type }}
            newId={ruleId}
            isReadOnly={isReadOnly}
            hint={strings.rulesSaveOnSave}
            errors={ruleErrors}
            onChange={(next) => {
              setRules(next);
              touch('rules');
              // A setting typed again lets go of the refusal made here; the server's stay until it answers again.
              if (local.some((refusal) => isRuleField(refusal.attributeId))) {
                setLocal(local.filter((refusal) => !isRuleField(refusal.attributeId)));
              }
            }}
            {...(ruleAttributes === undefined ? {} : { conditionAttributes: ruleAttributes })}
            {...(ruleEditorProps === undefined ? {} : { editorProps: ruleEditorProps })}
          />
          {listError !== undefined && <Callout tone="danger">{listError}</Callout>}
        </>
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
  /** A select's options or a status's stages, for the default's editor and its archived note. */
  readonly options: readonly OptionsEditorOption[];
  /** The type's settings as chosen above: the default's editor shows a percent sign or starts in the chosen currency. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly isRequired: boolean;
  readonly readOnlyReason: string | undefined;
  readonly error: string | undefined;
  readonly onChange: (draft: DefaultDraft) => void;
}

/**
 * The default (AC-234), through the type's own form editor. A date also
 * offers "Today plus days", a member "Current user", as a choice (RadioGroup) above the
 * editor.
 */
function DefaultSetting({
  type,
  isMulti,
  draft,
  members,
  options,
  config,
  isRequired,
  readOnlyReason,
  error,
  onChange,
}: DefaultSettingProps) {
  const isReadOnly = readOnlyReason !== undefined;
  const kinds = defaultKindsFor(type);
  const takesOptions = type === 'select' || type === 'status';
  const editorFor = (name: string) => {
    const attribute: FieldAttribute = {
      id: 'defaultValue',
      name,
      type,
      allowMultiple: isMulti,
      isRequired: false,
      isUnique: false,
      isReadOnly,
      // The default is drawn as the value will be: a percent number with its sign, an amount in the chosen currency.
      ...(type === 'number' && config.display === 'percent' ? { isPercent: true } : {}),
      ...(type === 'currency' && typeof config.defaultCurrency === 'string'
        ? { defaultCurrency: config.defaultCurrency }
        : {}),
      ...(takesOptions
        ? {
            options: options.map((option) => ({
              id: option.id,
              label: option.label,
              hue: option.hue,
              archived: option.isArchived,
            })),
          }
        : {}),
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
  // Most types: the editor alone; empty means no default. A default naming an archived option says what new
  // records get meanwhile (AC-236): the engine keeps the default and stands the first live option in, or nothing.
  if (!kinds.includes('offset') && !kinds.includes('current_user')) {
    const note = takesOptions ? archivedDefaultNote(draft, options, isRequired) : undefined;
    return (
      <>
        {editorFor(strings.defaultValue)}
        {note !== undefined && <Callout>{note}</Callout>}
      </>
    );
  }
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

/** The currency a new currency attribute starts with (changeable; one is required). */
const DEFAULT_CURRENCY = 'USD';

/** The starter stages of a new status (AC-230), each with its own id. */
function starterStages(newOptionId: (() => string) | undefined): readonly OptionsEditorOption[] {
  return STARTER_STAGES.map((stage, index) => ({
    id: newOptionId?.() ?? `stage-${String(index)}`,
    label: stage.label,
    hue: stage.hue,
    isArchived: false,
    outcome: stage.outcome,
  }));
}

/** The settings a type takes: a number's display, a currency's default code; `{}` for the rest. */
function configFor(type: AttributeType, config: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (type === 'number') return { display: config.display === 'percent' ? 'percent' : 'plain' };
  if (type === 'currency') {
    return { defaultCurrency: typeof config.defaultCurrency === 'string' ? config.defaultCurrency : DEFAULT_CURRENCY };
  }
  return {};
}

/** A select or status default with any option no longer among `options` dropped (a draft option removed). */
function withinOptions(
  fallback: AttributeDefault | undefined,
  options: readonly OptionsEditorOption[],
): AttributeDefault | undefined {
  if (fallback?.kind !== 'static') return fallback;
  const ids = new Set(options.map((option) => option.id));
  if (Array.isArray(fallback.value)) {
    const kept = (fallback.value as readonly unknown[]).filter((id) => typeof id === 'string' && ids.has(id));
    return kept.length === 0 ? undefined : { kind: 'static', value: kept };
  }
  return typeof fallback.value === 'string' && ids.has(fallback.value) ? fallback : undefined;
}

/**
 * What new records get while the default names an archived option (AC-236):
 * the first live option when the attribute is required, else nothing. None
 * when the default names no archived option.
 */
function archivedDefaultNote(
  draft: DefaultDraft,
  options: readonly OptionsEditorOption[],
  isRequired: boolean,
): string | undefined {
  if (draft.kind !== 'static') return undefined;
  const named: readonly unknown[] = Array.isArray(draft.value) ? (draft.value as readonly unknown[]) : [draft.value];
  const archived = options.filter((option) => option.isArchived && named.includes(option.id));
  if (archived.length === 0) return undefined;
  // A multi default keeps its live options; only a single one stands in or empties.
  if (Array.isArray(draft.value)) return strings.archivedDefaultSome;
  const first = options.find((option) => !option.isArchived);
  return isRequired && first !== undefined ? strings.archivedDefaultFirst(first.label) : strings.archivedDefaultNone;
}

/** Props for the type's own settings. */
interface TypeSettingsProps {
  readonly type: AttributeType;
  readonly config: Readonly<Record<string, unknown>>;
  readonly isReadOnly: boolean;
  readonly error: string | undefined;
  readonly onChange: (config: Readonly<Record<string, unknown>>) => void;
}

/**
 * The type's settings (AC-230): a number shows plain or as a percent (a
 * RadioGroup, a saved setting), a currency needs its default code (a
 * searchable Select). Nothing for the other types.
 */
function TypeSettings({ type, config, isReadOnly, error, onChange }: TypeSettingsProps) {
  const { locale } = useFormatSettings();
  if (type === 'number') {
    return (
      <RadioGroup
        label={strings.numberDisplay}
        orientation="horizontal"
        value={config.display === 'percent' ? 'percent' : 'plain'}
        isReadOnly={isReadOnly}
        onChange={(next) => {
          onChange({ ...config, display: next === 'percent' ? 'percent' : 'plain' });
        }}
      >
        <Radio value="plain">{strings.plain}</Radio>
        <Radio value="percent">{strings.percent}</Radio>
      </RadioGroup>
    );
  }
  if (type !== 'currency') return null;
  const names = memoIntl(`currency-names:${locale}`, () => new Intl.DisplayNames(locale, { type: 'currency' }));
  const code = typeof config.defaultCurrency === 'string' ? config.defaultCurrency : DEFAULT_CURRENCY;
  return (
    <Select
      label={strings.defaultCurrency}
      hint={strings.defaultCurrencyHint}
      isRequired
      isSearchable
      searchLabel={strings.searchCurrencies}
      items={CURRENCY_CODES.map((each) => ({ id: each, label: strings.currencyItem(each, names.of(each) ?? each) }))}
      value={code}
      onChange={(next) => {
        if (next !== null) onChange({ ...config, defaultCurrency: next });
      }}
      {...(isReadOnly ? { isReadOnly } : {})}
      {...(error === undefined ? {} : { error })}
    />
  );
}

/** Props for the options setting. */
interface OptionsSettingProps {
  readonly isCreating: boolean;
  readonly kind: 'select' | 'status';
  readonly options: readonly OptionsEditorOption[];
  readonly limit: number | undefined;
  readonly newId: (() => string) | undefined;
  readonly isReadOnly: boolean;
  readonly error: string | undefined;
  readonly writes: AttributeSettingsOptionWrites | undefined;
  readonly onDrafts: (options: readonly OptionsEditorOption[]) => void;
  readonly onInvalidChange: (isInvalid: boolean) => void;
}

/** A draft option with a change applied; `targetDays: null` takes its target away. */
function changedOption(option: OptionsEditorOption, change: OptionsEditorChange): OptionsEditorOption {
  const { targetDays, ...rest } = change;
  if (targetDays === undefined) return { ...option, ...rest };
  if (targetDays !== null) return { ...option, ...rest, targetDays };
  const { targetDays: _gone, ...without } = option;
  return { ...without, ...rest };
}

/**
 * The options (AC-230, AC-236): before create a draft the dialog keeps (Remove
 * takes one out), after create each change written as it is made (Archive and
 * Restore), which its hint says.
 */
function OptionsSetting({
  isCreating,
  kind,
  options,
  limit,
  newId,
  isReadOnly,
  error,
  writes,
  onDrafts,
  onInvalidChange,
}: OptionsSettingProps) {
  // Without the screen's ids (a story), a counter, so a removed option's id is never handed out again.
  const made = useRef(0);
  const fallbackId = () => {
    made.current += 1;
    return `option-${String(made.current)}`;
  };
  const common = {
    label: kind === 'status' ? strings.stages : strings.options,
    kind,
    options,
    newId: newId ?? fallbackId,
    isReadOnly,
    onInvalidChange,
    ...(limit === undefined ? {} : { limit }),
  };
  if (!isCreating && writes !== undefined) {
    return (
      <OptionsEditor
        {...common}
        hint={strings.optionsSaveAtOnce}
        onAdd={writes.onAdd}
        onChange={writes.onChange}
        onMove={writes.onMove}
        onArchive={writes.onArchive}
        onRestore={writes.onRestore}
        {...(writes.pending === undefined ? {} : { pending: writes.pending })}
        {...(writes.errors === undefined ? {} : { errors: writes.errors })}
      />
    );
  }
  return (
    <>
      <OptionsEditor
        {...common}
        // A new select opens with a blank row to type in; a new status starts with its stages (AC-230).
        startsWithBlank={isCreating && kind === 'select' && options.length === 0}
        onAdd={(option) => {
          onDrafts([...options, option]);
        }}
        onChange={(id, change) => {
          onDrafts(options.map((option) => (option.id === id ? changedOption(option, change) : option)));
        }}
        onMove={(id, position) => {
          const moving = options.find((option) => option.id === id);
          if (moving === undefined) return;
          const rest = options.filter((option) => option.id !== id);
          onDrafts([...rest.slice(0, position), moving, ...rest.slice(position)]);
        }}
        onRemove={(id) => {
          onDrafts(options.filter((option) => option.id !== id));
        }}
      />
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
    </>
  );
}
