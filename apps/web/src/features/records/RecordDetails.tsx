// Brief
// Purpose: a record's details in the page's sidebar (and, with milestone 4, the side panel's Details tab).
// Main task: read every attribute and edit it in place, saved through the data layer, a refusal said under the value.
// Leaves out: relationship sections that hold many records (spec 0014, milestone 3) and attribute groups (#18).
// Schema managers get a ⋯ at its foot: Add attribute (the attribute dialog here) and Manage attributes (settings),
// and "Create "<typed>"" in a select or status, as a table cell offers it (FieldActionsContext).
import {
  toFieldAttribute,
  type ObjectSummary,
  withPendingOptions,
  type AttributeDefinition,
  type MemberSummary,
  type NameState,
  type RecordRef,
  type RecordRefDisplay,
  type RecordView,
} from '@crm/data';
import { usePendingOptions } from '@crm/data/react';
import { AttributeList, Button, FieldActionsContext, Menu, MenuItem, MenuTrigger, type FieldActions } from '@crm/ui';
import { useParams, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { objectSettingsHref } from '../settings/nav.ts';
import { refsOf } from './details.ts';
import { useLinkEditing } from './links.ts';
import { useMemberPicker } from './members.ts';
import { useRecordForm } from './RecordForm.tsx';
import { strings } from './strings.ts';

/** Props for the record's details. */
export interface RecordDetailsProps {
  /** The attributes Details lists (`detailAttributes`). */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  /** The record as the store shows it; undefined while it loads. */
  readonly record: RecordView | undefined;
  /** Refused values by attribute id, said under each. */
  readonly cellErrors?: ReadonlyMap<string, string>;
  /** How linked records show, from the data layer. */
  readonly referenceDisplays?: (refs: readonly RecordRef[]) => readonly NameState[];
  /** A value changed; left out where nothing may change (read only, deleted, no longer available). */
  readonly onCommit?: (attributeId: string, value: unknown) => void;
  /**
   * For schema managers only (flow pass, 30 October 2026): the object, for the ⋯ at the list's foot with Add
   * attribute and Manage attributes. No ⋯ when absent.
   */
  readonly schemaObject?: ObjectSummary;
}

/** How a linked record shows while its name loads (no name: a skeleton chip) or when it can't be read. */
function displayOf(ref: RecordRef, state: NameState): RecordRefDisplay {
  if (state === 'loading') return { ...ref, name: '', kind: 'other' };
  if (state === 'unknown') return { ...ref, name: strings.unavailableRecord, kind: 'other' };
  return state;
}

/**
 * Details: one untitled section (until #18) of the record's attributes, each
 * shown and edited through the field set's one design for its type. The same
 * component serves the page's sidebar and, from milestone 4, the side panel.
 */
export function RecordDetails({
  attributes,
  members,
  record,
  cellErrors,
  referenceDisplays,
  onCommit,
  schemaObject,
}: RecordDetailsProps) {
  // An Owner edits through a Menu of the workspace's members, "Me" first (spec 0003).
  const memberPicker = useMemberPicker(members);
  const memberDisplays = memberPicker.displays;
  // An option a table's cell just made (spec 0012, AC-238) shows by its label here too, until the attribute lists it.
  const { data } = useRouteContext({ from: '__root__' });
  // The object's API name from the route: a network's editor tells a company from a person by it.
  const { slug = '', object: objectKey } = useParams({ strict: false });
  const pendingOptions = usePendingOptions(data.options.pending);
  const fields = useMemo(
    () =>
      attributes.map((definition) => ({
        definition,
        attribute: withPendingOptions(
          toFieldAttribute(definition, strings.referenceReadOnly, objectKey),
          slug,
          pendingOptions,
        ),
      })),
    [attributes, slug, objectKey, pendingOptions],
  );
  // A record reference edits through its picker and goes as link deltas (spec 0014), never a whole value.
  // "Create deal…" in a picker opens the far object's full form; what it makes is linked here.
  const recordForm = useRecordForm(slug);
  const links = useLinkEditing(slug, recordForm.open);
  const byId = useMemo(() => new Map(attributes.map((definition) => [definition.id, definition])), [attributes]);
  const [isAdding, setAdding] = useState(false);
  const { toasts } = useRouteContext({ from: '__root__' });
  const schemaMenu =
    schemaObject === undefined ? undefined : (
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={strings.detailsActions} />
        <Menu
          label={strings.detailsActions}
          onAction={(key) => {
            if (key === 'add') setAdding(true);
          }}
        >
          <MenuItem id="add" icon="plus">
            {strings.addAttribute}
          </MenuItem>
          <MenuItem id="manage" icon="settings" href={objectSettingsHref(slug, schemaObject)}>
            {strings.manageAttributes}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    );
  // Create an option from a select or status here as in a cell (spec 0012, AC-238): one optimistic write that makes
  // it and sets it on this record, its label shown at once.
  const actions = useMemo<FieldActions | undefined>(
    () =>
      schemaObject === undefined || record === undefined || onCommit === undefined
        ? undefined
        : {
            createOption: (attribute, label) => {
              void data.records.createOption(slug, {
                objectId: schemaObject.id,
                recordId: record.id,
                attributeId: attribute.id,
                label,
              });
            },
          },
    [schemaObject, record, onCommit, data, slug],
  );
  if (record === undefined) return <AttributeList label={strings.details} sections={[]} isLoading />;
  const items = fields.map(({ definition, attribute }) => {
    const value = record.values[definition.id] ?? null;
    const refs = definition.type === 'record_reference' ? refsOf(value) : [];
    const names = refs.length === 0 ? [] : (referenceDisplays?.(refs) ?? []);
    const display =
      definition.type === 'actor_reference'
        ? memberDisplays
        : refs.length === 0
          ? undefined
          : refs.map((ref, index) => displayOf(ref, names[index] ?? 'loading'));
    const error = cellErrors?.get(definition.id);
    return {
      attribute,
      value,
      ...(display === undefined ? {} : { display }),
      ...(error === undefined ? {} : { error }),
    };
  });
  return (
    <FieldActionsContext value={actions}>
      <AttributeList
        // A new record starts its own fold: rows kept open for one record never carry over to the next.
        key={record.id}
        label={strings.details}
        sections={[{ id: 'details', items }]}
        // Filled values first, the empty ones behind Show N empty values (Attio's Show all values).
        emptyValues="fold"
        {...(schemaMenu === undefined ? {} : { actions: schemaMenu })}
        editorProps={(attribute) => {
          const definition = byId.get(attribute.id);
          if (definition?.type === 'actor_reference') return memberPicker.extras;
          return (definition === undefined ? undefined : links.pickerFor(definition, record.id)) ?? {};
        }}
        {...(onCommit === undefined
          ? {}
          : {
              onCommit: (attributeId: string, value: unknown) => {
                const definition = byId.get(attributeId);
                if (definition?.type === 'record_reference') void links.commit(definition, record.id, value);
                else onCommit(attributeId, value);
              },
            })}
      />
      {recordForm.dialog}
      {schemaObject !== undefined && (
        <AttributeDialog
          slug={slug}
          objectId={schemaObject.id}
          isOpen={isAdding}
          members={members}
          canManage
          objectAttributes={attributes}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(attribute) => {
            setAdding(false);
            toasts.toast({ tone: 'success', message: strings.attributeAdded(attribute.title) });
          }}
        />
      )}
    </FieldActionsContext>
  );
}
