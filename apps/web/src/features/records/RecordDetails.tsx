// Brief
// Purpose: a record's details in the page's sidebar (and, with milestone 4, the side panel's Details tab).
// Main task: read every attribute and edit it in place, saved through the data layer, a refusal said under the value.
// Leaves out: relationship sections that hold many records (milestone 3) and attribute groups (#18).
import {
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type MemberSummary,
  type NameState,
  type RecordRef,
  type RecordRefDisplay,
  type RecordView,
} from '@crm/data';
import { AttributeList } from '@crm/ui';
import { useMemo } from 'react';
import { refsOf } from './details.ts';
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
}: RecordDetailsProps) {
  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
  const fields = useMemo(
    () =>
      attributes.map((definition) => ({
        definition,
        attribute: toFieldAttribute(definition, strings.referenceReadOnly),
      })),
    [attributes],
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
    <AttributeList
      label={strings.details}
      sections={[{ id: 'details', items }]}
      {...(onCommit === undefined ? {} : { onCommit })}
    />
  );
}
