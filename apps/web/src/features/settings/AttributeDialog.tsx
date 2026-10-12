// Brief
// Purpose: create or edit one attribute of an object, from settings, the table's "+" header or a column's menu.
// Main task: name it, pick one of the ten types without setup, set its rules and default, then Create or Save.
// Leaves out: types with setup and options (spec 0012, milestone 3), relationships (#15), changing a type (#14).
import {
  toActorDisplays,
  type AttributeChanges,
  type AttributeDefinition,
  type MemberSummary,
  type PickerAttributeType,
  PICKER_TYPES,
} from '@crm/data';
import { AttributeSettings, type AttributeSettingsValues, type FormRefusal } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { strings } from './attribute-strings.ts';
import { formRefusals } from './refusals.ts';

/** The picker's entries this milestone offers: the ten types without setup (spec 0012, step 13). */
export const TYPES_WITHOUT_SETUP: readonly string[] = [
  'text',
  'long_text',
  'date',
  'checkbox',
  'rating',
  'email',
  'phone',
  'link',
  'location',
  'member',
];

/** The settings the server names on its refusals, as the dialog shows them. */
const FIELDS = ['title', 'apiSlug', 'description', 'type', 'isRequired', 'isUnique', 'defaultValue'] as const;

/** Props for the attribute dialog. */
export interface AttributeDialogProps {
  readonly slug: string;
  readonly objectId: string;
  readonly isOpen: boolean;
  /** The attribute to edit; a new one is made when absent. */
  readonly attribute?: AttributeDefinition | undefined;
  /** The workspace's members, for a Member attribute's default. */
  readonly members: readonly MemberSummary[];
  /** Holds `schema.manage`: anyone else sees the settings read only (the server refuses them anyway). */
  readonly canManage: boolean;
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
  };
}

/**
 * The connected AttributeSettings: one id minted per opening (a retry sends
 * the same one), the write through the data layer, server confirmed, and the
 * refusals on the settings they name.
 */
export function AttributeDialog({
  slug,
  objectId,
  isOpen,
  attribute,
  members,
  canManage,
  onClose,
  onSaved,
}: AttributeDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const [id, setId] = useState(() => data.attributes.newId());
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  // Each opening starts afresh, with its own id.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setId(data.attributes.newId());
      setBusy(false);
      setRefusals([]);
    }
  }
  const displays = useMemo(() => toActorDisplays(members), [members]);
  const readOnlyReason =
    attribute?.isSystem === true ? strings.systemReason(attribute.title) : canManage ? undefined : strings.memberReason;

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
          })
        : data.attributes.update(slug, attribute.id, changesOf(values));
    write.then(
      (saved) => {
        setBusy(false);
        onSaved(saved, attribute === undefined);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, FIELDS));
      },
    );
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
            },
          })}
      typeKeys={TYPES_WITHOUT_SETUP}
      members={displays}
      isBusy={isBusy}
      refusals={refusals}
      onSubmit={submit}
      {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
    />
  );
}
