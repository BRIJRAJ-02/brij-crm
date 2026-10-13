// Brief
// Purpose: create or edit one attribute of an object, from settings, the table's "+" header or a column's menu.
// Main task: name it, pick one of the fifteen types, set its settings, options, rules and default, then Create or Save.
// Leaves out: relationships (#15), changing a type (#14); an existing attribute's options save as they change.
// Rules (spec 0013) go with Save; their conditions name the object's own attributes, never a relationship.
import {
  isDataError,
  refusalSummary,
  targetDaysOf,
  toActorDisplays,
  toFieldAttribute,
  type AttributeChanges,
  type AttributeDefinition,
  type MemberSummary,
  type NewOption,
  type OptionChanges,
  type PickerAttributeType,
  PICKER_TYPES,
} from '@crm/data';
import {
  AttributeSettings,
  type AttributeSettingsOptionWrites,
  type AttributeSettingsValues,
  type FieldAttribute,
  type FormRefusal,
  type OptionsEditorOption,
  type RuleSettings,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { strings } from './attribute-strings.ts';
import { formRefusals } from './refusals.ts';

/** The settings the server names on its refusals, as the dialog shows them. */
const FIELDS = [
  'title',
  'apiSlug',
  'description',
  'type',
  'isRequired',
  'isUnique',
  'defaultValue',
  'config',
  'options',
] as const;

/** Props for the attribute dialog. */
export interface AttributeDialogProps {
  readonly slug: string;
  readonly objectId: string;
  readonly isOpen: boolean;
  /** The attribute to edit, as the live list holds it now; a new one is made when absent. */
  readonly attribute?: AttributeDefinition | undefined;
  /** The workspace's members, for a Member attribute's default. */
  readonly members: readonly MemberSummary[];
  /** Holds `schema.manage`: anyone else sees the settings read only (the server refuses them anyway). */
  readonly canManage: boolean;
  /** The live options an attribute may hold (`usage.get`), for "N of 500"; nothing shows when unknown. */
  readonly optionsLimit?: number | undefined;
  /** The object's attributes, for a rule's "Only when…" (spec 0013): its own, live, never a system one. */
  readonly objectAttributes?: readonly AttributeDefinition[] | undefined;
  readonly onClose: () => void;
  /** The server agreed: the attribute as it is now, and whether it is new. */
  readonly onSaved: (attribute: AttributeDefinition, isNew: boolean) => void;
}

/** The picker's types, which a create takes. */
const PICKER_KINDS: ReadonlySet<string> = new Set(PICKER_TYPES.map((entry) => entry.type));

/** A type a create takes; the dialog offers no other, so anything else is a broken invariant. */
function pickerTypeOf(type: string): PickerAttributeType {
  if (!PICKER_KINDS.has(type)) throw new Error(`The picker made a type it doesn't offer: ${type}.`);
  return type as PickerAttributeType;
}

/** What an edit sends: only the settings the person changed (`null` clears the description or the default). */
function changesOf(values: AttributeSettingsValues): AttributeChanges {
  const changed = new Set(values.changed);
  return {
    ...(changed.has('title') ? { title: values.title } : {}),
    ...(changed.has('description') ? { description: values.description === '' ? null : values.description } : {}),
    ...(changed.has('isRequired') ? { isRequired: values.isRequired } : {}),
    ...(changed.has('isUnique') ? { isUnique: values.isUnique } : {}),
    ...(changed.has('defaultValue') ? { defaultValue: values.defaultValue ?? null } : {}),
    ...(changed.has('config') ? { config: values.config } : {}),
    ...(changed.has('rules') ? { rules: values.rules } : {}),
  };
}

/**
 * The attributes a rule's condition may name (spec 0013): the object's own
 * live ones. Record references and members wait for their pickers in a
 * condition (no search is wired here yet), and system ones never take part.
 */
function conditionAttributesOf(attributes: readonly AttributeDefinition[]): readonly FieldAttribute[] {
  return attributes
    .filter(
      (each) =>
        !each.isSystem && !each.isArchived && each.type !== 'record_reference' && each.type !== 'actor_reference',
    )
    .map((each) => toFieldAttribute(each));
}

/** An attribute's rules as the dialog edits them: Required When is set apart (milestone 2). */
function rulesOf(attribute: AttributeDefinition): readonly RuleSettings[] {
  return (attribute.validation?.rules ?? []).flatMap((rule): RuleSettings[] =>
    rule.kind === 'required_when'
      ? []
      : [
          {
            id: rule.id,
            kind: rule.kind,
            params: rule.params,
            ...(rule.condition === undefined ? {} : { condition: rule.condition }),
            ...(rule.message === undefined ? {} : { message: rule.message }),
          },
        ],
  );
}

/** An option as the options editor shows it: a stage's target in whole days. */
function editorOption(option: NonNullable<AttributeDefinition['options']>[number]): OptionsEditorOption {
  const days = targetDaysOf(option.targetTimeInStage);
  return {
    id: option.id,
    label: option.label,
    hue: option.hue,
    isArchived: option.isArchived,
    ...(option.outcome === undefined ? {} : { outcome: option.outcome }),
    ...(days === undefined ? {} : { targetDays: days }),
  };
}

/** A draft option as a create sends it. */
function newOptionOf(option: OptionsEditorOption): NewOption {
  return {
    id: option.id,
    label: option.label,
    hue: option.hue,
    ...(option.outcome === undefined ? {} : { outcome: option.outcome }),
    ...(option.targetDays === undefined ? {} : { targetDays: option.targetDays }),
  };
}

/** The words a refused option write shows on its row. */
const refusedWords = (error: unknown): string => (isDataError(error) ? refusalSummary(error) : strings.somethingWrong);

/**
 * The connected AttributeSettings: one id minted per opening (a retry sends
 * the same one), the write through the data layer, server confirmed, and the
 * refusals on the settings they name. An existing attribute's options are
 * written as they change, each server confirmed: a row spins while its write
 * is out and shows its refusal after.
 */
export function AttributeDialog({
  slug,
  objectId,
  isOpen,
  attribute,
  members,
  canManage,
  optionsLimit,
  objectAttributes,
  onClose,
  onSaved,
}: AttributeDialogProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [id, setId] = useState(() => data.attributes.newId());
  // Whether the dialog is open now: an option write refused after it closed says so in a toast instead.
  const openNow = useRef(isOpen);
  useEffect(() => {
    openNow.current = isOpen;
  }, [isOpen]);
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  // Option writes out now, options added and not yet listed, and each option's last refusal (`new` for an add).
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<readonly OptionsEditorOption[]>([]);
  const [optionErrors, setOptionErrors] = useState<Readonly<Partial<Record<string, string>>>>({});
  // Each opening starts afresh, with its own id.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setId(data.attributes.newId());
      setBusy(false);
      setRefusals([]);
      setPending(new Set());
      setAdding([]);
      setOptionErrors({});
    }
  }
  const displays = useMemo(() => toActorDisplays(members), [members]);
  const ruleAttributes = useMemo(
    () => (objectAttributes === undefined ? undefined : conditionAttributesOf(objectAttributes)),
    [objectAttributes],
  );
  const readOnlyReason =
    attribute?.isSystem === true ? strings.systemReason(attribute.title) : canManage ? undefined : strings.memberReason;

  // The options as the live list holds them, then the ones added and not yet listed.
  const listed = useMemo(() => (attribute?.options ?? []).map(editorOption), [attribute?.options]);
  const options = useMemo(
    () => [...listed, ...adding.filter((option) => !listed.some((each) => each.id === option.id))],
    [listed, adding],
  );

  const submit = (values: AttributeSettingsValues) => {
    if (isBusy) return;
    if (attribute !== undefined && values.changed.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setRefusals([]);
    const write =
      attribute === undefined
        ? data.attributes.create(slug, {
            id,
            objectId,
            title: values.title,
            type: pickerTypeOf(values.type),
            isMulti: values.isMulti,
            ...(values.apiSlug === undefined ? {} : { apiSlug: values.apiSlug }),
            ...(values.description === '' ? {} : { description: values.description }),
            ...(values.isRequired ? { isRequired: true } : {}),
            ...(values.isUnique ? { isUnique: true } : {}),
            ...(values.defaultValue === undefined ? {} : { defaultValue: values.defaultValue }),
            ...(Object.keys(values.config).length === 0 ? {} : { config: values.config }),
            ...(values.options.length === 0 ? {} : { options: values.options.map(newOptionOf) }),
            ...(values.rules.length === 0 ? {} : { rules: values.rules }),
          })
        : data.attributes.update(slug, attribute.id, changesOf(values));
    write.then(
      (saved) => {
        setBusy(false);
        onSaved(saved, attribute === undefined);
      },
      (error: unknown) => {
        setBusy(false);
        // A rule's refusal names its setting (`rules.<index>.<setting>`), or the list itself (`rules`).
        const ruleFields = isDataError(error)
          ? (error.data?.refusals ?? []).flatMap((refusal) =>
              refusal.field?.startsWith('rules') === true ? [refusal.field] : [],
            )
          : [];
        setRefusals(formRefusals(error, [...FIELDS, ...ruleFields]));
      },
    );
  };

  /** A refused option write: on its row while the dialog is open, else in a toast, so it is never lost. */
  const optionRefused = (key: string, why: string, label: string) => {
    if (openNow.current) setOptionErrors((before) => ({ ...before, [key]: why }));
    else toasts.toast({ tone: 'danger', message: strings.optionNotSaved(label, why) });
  };

  /** Runs one option write: its row spins until the server answers, and shows the refusal, if any, after. */
  const track = (key: string, write: () => Promise<unknown>, after: () => void = () => undefined) => {
    const label = options.find((option) => option.id === key)?.label ?? '';
    setPending((before) => new Set([...before, key]));
    setOptionErrors(({ [key]: _gone, ...rest }) => rest);
    write().then(
      () => {
        setPending((before) => new Set([...before].filter((each) => each !== key)));
        after();
      },
      (error: unknown) => {
        setPending((before) => new Set([...before].filter((each) => each !== key)));
        optionRefused(key, refusedWords(error), label);
        after();
      },
    );
  };

  const optionWrites: AttributeSettingsOptionWrites | undefined =
    attribute === undefined || readOnlyReason !== undefined
      ? undefined
      : {
          onAdd: (option) => {
            setAdding((before) => [...before, option]);
            setOptionErrors(({ new: _gone, ...rest }) => rest);
            setPending((before) => new Set([...before, option.id]));
            data.options.create(slug, objectId, attribute.id, newOptionOf(option)).then(
              () => {
                setPending((before) => new Set([...before].filter((each) => each !== option.id)));
              },
              (error: unknown) => {
                // Refused: the row leaves, and why shows by Add option.
                setPending((before) => new Set([...before].filter((each) => each !== option.id)));
                setAdding((before) => before.filter((each) => each.id !== option.id));
                // The row went with the refusal: why shows by Add option, naming what was typed.
                optionRefused('new', strings.optionAddRefused(option.label, refusedWords(error)), option.label);
              },
            );
          },
          onChange: (optionId, change: OptionChanges) => {
            track(optionId, () => data.options.update(slug, objectId, optionId, change));
          },
          onMove: (optionId, position) => {
            track(optionId, () => data.options.reorder(slug, objectId, optionId, position));
          },
          onArchive: (optionId) => {
            track(optionId, () => data.options.archive(slug, objectId, optionId));
          },
          onRestore: (optionId) => {
            track(optionId, () => data.options.restore(slug, objectId, optionId));
          },
          pending,
          errors: optionErrors,
        };

  return (
    <AttributeSettings
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      {...(attribute === undefined
        ? {}
        : {
            attribute: {
              type: attribute.type,
              isMulti: attribute.isMulti,
              title: attribute.title,
              apiSlug: attribute.apiSlug,
              ...(attribute.description === undefined ? {} : { description: attribute.description }),
              isRequired: attribute.isRequired,
              isUnique: attribute.isUnique,
              ...(attribute.defaultValue === undefined ? {} : { defaultValue: attribute.defaultValue }),
              config: attribute.config,
              ...(attribute.options === undefined ? {} : { options }),
              rules: rulesOf(attribute),
            },
          })}
      members={displays}
      isBusy={isBusy}
      refusals={refusals}
      onSubmit={submit}
      newOptionId={data.attributes.newId}
      newRuleId={data.attributes.newId}
      {...(ruleAttributes === undefined ? {} : { ruleAttributes })}
      {...(optionsLimit === undefined ? {} : { optionsLimit })}
      // The writes read `openNow` only when the server answers, never while rendering.
      // eslint-disable-next-line react-hooks/refs
      {...(optionWrites === undefined ? {} : { optionWrites })}
      {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
    />
  );
}
