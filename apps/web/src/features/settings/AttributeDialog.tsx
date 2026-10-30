// Brief
// Purpose: create or edit one attribute of an object, from settings, the table's "+" header or a column's menu.
// Main task: name it, pick one of the fifteen types, set its settings, options, rules and default, then Create or Save.
// Leaves out: changing a type in place (Wrong type? archives it and starts a new one with its name); an existing
// attribute's options save as they change; Relationship hands over to RelationshipSettings' step in the same Modal,
// and a relationship's side opens RelationshipDialog (spec 0014).
// Rules (spec 0013) go with Save; their conditions name the object's own attributes, never a relationship.
import {
  isDataError,
  refusalSummary,
  targetDaysOf,
  toActorDisplays,
  toFieldAttribute,
  type AttributeChanges,
  type AttributeDefinition,
  type AttributeImpact,
  type MemberSummary,
  type NewAttribute,
  type NewOption,
  type ObjectSummary,
  type OptionChanges,
  type PickerAttributeType,
  PICKER_TYPES,
} from '@crm/data';
import {
  AttributeSettings,
  relationshipStep,
  type AttributeSettingsApiNames,
  type AttributeSettingsDraft,
  type AttributeSettingsOptionWrites,
  type AttributeSettingsValues,
  type FieldAttribute,
  type FormRefusal,
  type OptionsEditorOption,
  type RuleSettings,
} from '@crm/ui';
import { useMatch, useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { strings } from './attribute-strings.ts';
import { defaultArchivedNotice } from './default-notice.ts';
import { emptyRecordsHref } from './impact-lines.ts';
import { moveOptionRecords } from './move-option-records.ts';
import { NewObjectDialog } from './NewObjectDialog.tsx';
import { formRefusals } from './refusals.ts';
import { requiredWhenLine } from './required-when.ts';
import { RelationshipDialog, useRelationshipCreate } from './RelationshipDialog.tsx';

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
  /**
   * The object's table, as "Open <Plural>": linked under Unique when a Save is refused for values records share.
   * Absent where the dialog opens over the table already.
   */
  readonly duplicatesLink?: { readonly label: string; readonly href: string } | undefined;
  /** On create, the type chosen at the start (a picker key, `select` for a board with nothing to group by). */
  readonly initialTypeKey?: string | undefined;
  /** On create, the name and a select's first options to start from (an import's column). */
  readonly initialDraft?: AttributeSettingsDraft | undefined;
  /** On create, the name it starts with (Archive and recreate keeps the old one's). */
  readonly initialTitle?: string | undefined;
  /** Editing: the footer's quiet Archive, which the host answers with its archive confirm. None when absent. */
  readonly onArchive?: (() => void) | undefined;
  /** Editing: "Wrong type? Archive and recreate", which the host answers. None when absent. */
  readonly onRecreate?: (() => void) | undefined;
  readonly onClose: () => void;
  /** The server agreed: the attribute as it is now, and whether it is new. */
  readonly onSaved: (attribute: AttributeDefinition, isNew: boolean) => void;
  /**
   * Makes the attribute somewhere other than the object (a list's own field, spec 0048, AC-4811); the object's
   * `attributes.create` when absent.
   */
  readonly onCreate?: ((input: NewAttribute) => Promise<AttributeDefinition>) | undefined;
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

/**
 * An attribute's rules as the dialog edits them: Required When is set apart (milestone 2). The `rules` input can't
 * carry it, so Save never sends it and the server keeps it (`writeRules`); the dialog says it is there, read only.
 */
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
  duplicatesLink,
  initialTypeKey,
  initialDraft,
  initialTitle,
  onArchive,
  onRecreate,
  onClose,
  onSaved,
  onCreate,
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
  // Relationship chosen in the type picker (spec 0014): its step takes over, with the name typed so far.
  const [relationshipDraft, setRelationshipDraft] = useState<{ readonly title: string } | undefined>(undefined);
  const relationshipFormId = useId();
  // "New object…" in the relationship step (flow pass, 30 October 2026): New object opens over it, and the object
  // made comes back chosen as the related one.
  const [isMakingObject, setMakingObject] = useState(false);
  const [madeObject, setMadeObject] = useState<ObjectSummary | undefined>(undefined);
  // Back from the relationship step: the attribute form comes back with the name that was typed.
  const [backTitle, setBackTitle] = useState<string | undefined>(undefined);
  const workspaceObjects = useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData?.objects;
  const relationship = useRelationshipCreate({
    slug,
    objectId,
    isOpen: isOpen && relationshipDraft !== undefined,
    draftTitle: relationshipDraft?.title,
    onSaved,
    made: madeObject,
  });
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
      setRelationshipDraft(undefined);
      setMakingObject(false);
      setMadeObject(undefined);
      setBackTitle(undefined);
    }
  }
  // An existing attribute's uses and counts (flow pass, 30 October 2026), read as its settings open: "N records" on
  // each option, and what Required and Unique would meet. Settings managers only; a failed read shows nothing.
  const [held, setHeld] = useState<{ readonly id: string; readonly impact: AttributeImpact } | undefined>(undefined);
  const impactFor = isOpen && canManage && attribute !== undefined && !attribute.isSystem ? attribute.id : undefined;
  // Only the read for this opening's attribute counts; another's (or a closed dialog's) shows nothing.
  const impact = held !== undefined && held.id === impactFor ? held.impact : undefined;
  useEffect(() => {
    if (impactFor === undefined) return;
    let isCurrent = true;
    data.attributes.impact(slug, impactFor).then(
      (next) => {
        if (isCurrent) setHeld({ id: impactFor, impact: next });
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, impactFor]);
  const displays = useMemo(() => toActorDisplays(members), [members]);
  const ruleAttributes = useMemo(
    () => (objectAttributes === undefined ? undefined : conditionAttributesOf(objectAttributes)),
    [objectAttributes],
  );
  const rulesNote = requiredWhenLine(attribute, objectAttributes ?? []);
  // On create, the API names the object's attributes hold: an archived one's is said, with Restore it (flow pass).
  const apiNames = useMemo((): AttributeSettingsApiNames | undefined => {
    if (attribute !== undefined || objectAttributes === undefined) return undefined;
    const held = (isArchived: boolean) =>
      new Set(objectAttributes.filter((each) => each.isArchived === isArchived).map((each) => each.apiSlug));
    return {
      live: held(false),
      archived: held(true),
      onRestore: (apiSlug) => {
        const holder = objectAttributes.find((each) => each.isArchived && each.apiSlug === apiSlug);
        if (holder === undefined) return;
        data.attributes.restore(slug, holder.id).then(
          () => {
            onClose();
            toasts.toast({ tone: 'success', message: strings.restored(holder.title) });
          },
          (error: unknown) => {
            toasts.toast({
              tone: 'danger',
              message: strings.restoreFailed(holder.title, isDataError(error) ? error.message : strings.somethingWrong),
            });
          },
        );
      },
    };
  }, [attribute, objectAttributes, data, slug, onClose, toasts]);
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
        ? (onCreate ?? ((input: NewAttribute) => data.attributes.create(slug, input)))({
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
        // Unique refused for values records share names the attribute, not the setting: it lands on Unique.
        setRefusals(
          formRefusals(error, [...FIELDS, ...ruleFields]).map((refusal) =>
            refusal.code === 'UNIQUE_HAS_DUPLICATES' ? { ...refusal, attributeId: 'isUnique' } : refusal,
          ),
        );
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
          onArchive: (optionId, moveTo) => {
            track(optionId, () =>
              data.options.archive(slug, objectId, optionId).then(() => {
                // Its records go where the menu said, as a background bulk edit (spec 0022's path).
                if (moveTo !== undefined) {
                  const to = options.find((option) => option.id === moveTo)?.label ?? '';
                  moveOptionRecords(data, slug, {
                    objectId,
                    attributeId: attribute.id,
                    from: optionId,
                    to: moveTo,
                  }).then(
                    () => {
                      toasts.toast({ tone: 'success', message: strings.recordsMoved(to) });
                    },
                    (error: unknown) => {
                      toasts.toast({ tone: 'danger', message: strings.moveRecordsFailed(to, refusedWords(error)) });
                    },
                  );
                }
                // The default named it (late trap #34): new records quietly stopped getting it. Said once it's done.
                // With Undo: archiving asks nothing first, and restoring brings the default back exactly.
                // Always with Undo (flow pass, 30 October 2026): archiving asks nothing first. The default's
                // notice when it named the option (late trap #34), else plainly what happened.
                const label = options.find((option) => option.id === optionId)?.label ?? '';
                const said = defaultArchivedNotice(attribute, options, optionId) ?? strings.optionArchived(label);
                toasts.toast(
                  {
                    tone: 'info',
                    message: said,
                    action: {
                      label: strings.undo,
                      onAction: () => {
                        track(optionId, () => data.options.restore(slug, objectId, optionId));
                      },
                    },
                  },
                  { timeout: 10_000 },
                );
              }),
            );
          },
          onRestore: (optionId) => {
            track(optionId, () => data.options.restore(slug, objectId, optionId));
          },
          pending,
          errors: optionErrors,
          ...(impact?.optionCounts === undefined ? {} : { recordCounts: impact.optionCounts }),
          canMoveRecords: attribute.type === 'status' || (attribute.type === 'select' && !attribute.isMulti),
        };

  // A side of a two way relationship opens the relationship dialog in edit mode (spec 0014).
  if (attribute?.relationship?.pairedAttributeId !== undefined) {
    return (
      <RelationshipDialog
        slug={slug}
        objectId={objectId}
        isOpen={isOpen}
        attribute={attribute}
        canManage={canManage}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  return (
    <>
      <AttributeSettings
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        {...(initialTypeKey === undefined ? {} : { initialTypeKey })}
        {...(initialDraft === undefined ? {} : { initialDraft })}
        {...(attribute !== undefined
          ? {}
          : backTitle !== undefined
            ? { initialTitle: backTitle }
            : initialTitle === undefined
              ? {}
              : { initialTitle })}
        // The name every record goes by never archives; a system attribute has nothing to archive or recreate.
        {...(attribute === undefined || attribute.isPrimary || attribute.isSystem
          ? {}
          : {
              ...(onArchive === undefined ? {} : { onArchive }),
              ...(onRecreate === undefined ? {} : { onRecreate }),
            })}
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
        {...(rulesNote === undefined ? {} : { rulesNote })}
        {...(apiNames === undefined ? {} : { apiNames })}
        {...(duplicatesLink === undefined ? {} : { duplicatesLink })}
        {...(attribute === undefined || duplicatesLink === undefined || (impact?.emptyCount ?? 0) === 0
          ? {}
          : {
              requiredMeets: {
                label: strings.emptyRecords(impact?.emptyCount ?? 0),
                href: emptyRecordsHref(duplicatesLink.href, attribute.id),
              },
            })}
        {...(duplicatesLink === undefined || (impact?.duplicateCount ?? 0) === 0
          ? {}
          : { uniqueMeets: { label: strings.sharedValues(impact?.duplicateCount ?? 0), href: duplicatesLink.href } })}
        // Relationship chosen in the type picker: its step takes this dialog's place, in the same Modal (spec 0014).
        {...(attribute === undefined && relationshipDraft !== undefined
          ? {
              step: relationshipStep({
                ...relationship,
                formId: relationshipFormId,
                onBack: () => {
                  setBackTitle(relationshipDraft.title);
                  setRelationshipDraft(undefined);
                },
                newObject: { label: strings.newObjectItem, onChoose: () => setMakingObject(true) },
              }),
              isBusy: relationship.isBusy === true,
            }
          : {})}
        // A list's field (`onCreate`) is any type but a relationship (spec 0048, AC-4811).
        {...(attribute === undefined && canManage && onCreate === undefined
          ? { relationshipEntry: { label: strings.relationship, onChoose: setRelationshipDraft } }
          : {})}
        {...(optionsLimit === undefined ? {} : { optionsLimit })}
        // The writes read `openNow` only when the server answers, never while rendering.
        // eslint-disable-next-line react-hooks/refs
        {...(optionWrites === undefined ? {} : { optionWrites })}
        {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
      />
      {relationshipDraft !== undefined && (
        <NewObjectDialog
          isOpen={isMakingObject}
          onOpenChange={setMakingObject}
          objects={workspaceObjects ?? []}
          newId={data.objects.newId}
          onCreate={(input) => data.objects.create(slug, input)}
          onCreated={(object) => {
            setMakingObject(false);
            setMadeObject(object);
            toasts.toast({ tone: 'success', message: strings.objectCreated(object.pluralName) });
          }}
        />
      )}
    </>
  );
}
