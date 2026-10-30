// Brief
// Purpose: which fields of an object a role or a team sees or may change (spec 0032, AC-846, AC-856), folded under
// "Fields" so the common path stays the grid above it.
// Main task: pick who, then set each field to Visible, Read only or Hidden; the change saves as it is picked.
// Leaves out: nothing it was asked for; the data layer and Undo stay with the Access tab that holds it.
import type { FieldRules, ObjectAccessLevel, RuleField } from '@crm/data';
import { Callout, Disclosure, Select, Table, type TableColumn } from '@crm/ui';
import { useState } from 'react';
import { fieldChoices, fieldState, limitedCount, withField } from './access-grid.ts';
import { strings } from './teams-strings.ts';

/** One subject whose fields can be ruled: its key, its name, what it may do with the object and its field rules. */
export interface FieldSubject {
  readonly key: string;
  readonly name: string;
  readonly level: ObjectAccessLevel;
  readonly fields: FieldRules;
}

/** Props for the Fields fold. */
export interface AccessFieldsProps {
  /** The object's plural name, for the line a subject with no access gets. */
  readonly object: string;
  /** The object's live fields, in their order. */
  readonly fields: readonly RuleField[];
  readonly subjects: readonly FieldSubject[];
  /** One field of one subject set to a state (`visible` takes its rule away). */
  readonly onChange: (subjectKey: string, fields: FieldRules) => void;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'field', label: strings.fieldColumn, isRowHeader: true, isInline: true },
  { id: 'state', label: strings.accessColumn, size: 'fit' },
];

/**
 * The Fields fold: closed until asked for, with a count of the fields any subject limits. One picker says who it is
 * for (Members, then each team), and a row a field says what that subject can do with it.
 */
export function AccessFields({ object, fields, subjects, onChange }: AccessFieldsProps) {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const subject = subjects.find((each) => each.key === chosen) ?? subjects[0];
  if (subject === undefined) return null;
  const total = subjects.reduce((sum, each) => sum + limitedCount(each.fields, fields), 0);
  const canRule = subject.level !== 'none';
  return (
    <Disclosure title={strings.fieldsTitle} {...(total > 0 ? { count: total } : {})}>
      {subjects.length > 1 && (
        <Select
          label={strings.fieldsFor}
          size="sm"
          savesOnPick
          items={subjects.map((each) => ({ id: each.key, label: each.name }))}
          value={subject.key}
          onChange={(id) => {
            if (id !== null) setChosen(id);
          }}
        />
      )}
      {canRule ? (
        <Table
          label={strings.fieldsTable}
          columns={COLUMNS}
          rows={fields}
          getRowId={(field) => field.id}
          renderCell={(field, column) => {
            if (column === 'field') return field.title;
            const state = fieldState(subject.level, subject.fields, field.id);
            return (
              <Select
                label={strings.fieldFor(field.title, subject.name)}
                isLabelHidden
                size="sm"
                savesOnPick
                items={fieldChoices(subject.level, field).map((each) => ({
                  id: each,
                  label: strings.fieldStates[each],
                }))}
                value={state}
                {...(field.isPrimary ? { hint: strings.nameStays } : {})}
                onChange={(id) => {
                  if (id === 'visible' || id === 'read' || id === 'hidden') {
                    onChange(subject.key, withField(subject.fields, field.id, id));
                  }
                }}
              />
            );
          }}
          isScrollable
        />
      ) : (
        <Callout>{strings.fieldsNone(subject.name, object)}</Callout>
      )}
    </Disclosure>
  );
}
