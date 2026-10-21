import type { AttributeDefinition } from '@crm/data';
import type { FieldAttribute, TextContext } from '@crm/ui';
import { describe, expect, it } from 'vitest';
import { autoMatch, defaultMatch, importChoices, isFree, matchAttributes, samplesFit } from './matching.ts';
import { columnNames, missingOptions, suggestType } from './missing.ts';
import { EMPTY_ROW, errorRowsCsv, readRows, relationNames } from './rows.ts';

const id = (n: number) => `0192a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const OBJECT = id(99);

function attribute(
  n: number,
  apiSlug: string,
  title: string,
  type: AttributeDefinition['type'],
  extra: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  return {
    id: id(n),
    objectId: OBJECT,
    apiSlug,
    title,
    type,
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    isPrimary: false,
    config: {},
    position: n,
    isArchived: false,
    ...extra,
  };
}

const name = attribute(1, 'name', 'Name', 'personal_name', { isPrimary: true });
const email = attribute(2, 'email_addresses', 'Email addresses', 'email', { isMulti: true, isUnique: true });
const age = attribute(3, 'age', 'Age', 'number');
const created = attribute(4, 'created_at', 'Created at', 'timestamp', { isSystem: true });
const locked = attribute(5, 'score', 'Score', 'number', { readOnly: { reason: 'Admins only.' } });
const company = attribute(6, 'company', 'Company', 'record_reference');
const attributes = [name, email, age, created, locked, company];

const field = (definition: AttributeDefinition): FieldAttribute => ({
  id: definition.id,
  name: definition.title,
  apiSlug: definition.apiSlug,
  type: definition.type,
  allowMultiple: definition.isMulti,
  isRequired: false,
  isUnique: definition.isUnique,
  isReadOnly: false,
});
const fields = new Map(attributes.map((each) => [each.id, field(each)]));
const context = (attr: FieldAttribute): TextContext => ({
  locale: 'en-GB',
  timeZone: 'Europe/London',
  attribute: attr,
});
const reads = (choice: { attribute: AttributeDefinition }, text: string) =>
  readRows([[text]], ['x'], [{ attributeId: choice.attribute.id }], fields, context).ready.length === 1;

describe('importChoices', () => {
  it('offers writable attributes and a name’s parts, never system, read only or (yet) relations', () => {
    const ids = importChoices(attributes).map((choice) => choice.id);
    expect(ids).toEqual([name.id, `${name.id}:first`, `${name.id}:last`, email.id, age.id]);
  });
});

describe('autoMatch', () => {
  const choices = importChoices(attributes);
  it('matches headers by name, API name and synonyms, ignoring case and punctuation', () => {
    const targets = autoMatch(
      ['First Name', 'last_name', 'E-mail', 'AGE', 'Notes'],
      [['Ada'], ['Lovelace'], ['ada@example.com'], ['36'], ['x']],
      choices,
      reads,
    );
    expect(targets).toEqual([
      { attributeId: name.id, part: 'first' },
      { attributeId: name.id, part: 'last' },
      { attributeId: email.id },
      { attributeId: age.id },
      undefined,
    ]);
  });

  it('leaves a column unmatched when most of its sample doesn’t read as the type', () => {
    expect(autoMatch(['Age'], [['old', 'young', '3']], choices, reads)).toEqual([undefined]);
  });

  it('gives one attribute one column, and never a whole name beside its parts', () => {
    const targets = autoMatch(['Email', 'Email', 'First name', 'Name'], [[], [], [], []], choices, reads);
    expect(targets).toEqual([{ attributeId: email.id }, undefined, { attributeId: name.id, part: 'first' }, undefined]);
  });
});

describe('matching helpers', () => {
  it('counts half or more of the filled sample as fitting', () => {
    expect(samplesFit(['1', 'x', ''], (text) => /^\d+$/u.test(text))).toBe(true);
    expect(samplesFit(['1', 'x', 'y'], (text) => /^\d+$/u.test(text))).toBe(false);
    expect(samplesFit(['', ' '], () => false)).toBe(true);
  });

  it('frees a target only when nothing else holds it', () => {
    expect(isFree({ attributeId: age.id }, [{ attributeId: age.id }])).toBe(false);
    expect(isFree({ attributeId: name.id }, [{ attributeId: name.id, part: 'last' }])).toBe(false);
    expect(isFree({ attributeId: name.id, part: 'first' }, [{ attributeId: name.id, part: 'last' }])).toBe(true);
  });

  it('finds records by a unique attribute matched whole, Email addresses first on People', () => {
    const candidates = matchAttributes(attributes, [{ attributeId: email.id }, { attributeId: age.id }]);
    expect(candidates.map((each) => each.id)).toEqual([email.id]);
    expect(defaultMatch({ standardKey: 'people' }, candidates)).toBe(email.id);
    expect(defaultMatch({ standardKey: 'deals' }, candidates)).toBeUndefined();
  });
});

describe('readRows', () => {
  const targets = [
    { attributeId: name.id, part: 'first' as const },
    { attributeId: name.id, part: 'last' as const },
    { attributeId: age.id },
    undefined,
  ];
  const headers = ['First', 'Last', 'Age', 'Ignored'];

  it('joins a name’s parts, reads each cell by its type, and leaves empty cells out', () => {
    const result = readRows(
      [
        ['Ada', 'Lovelace', '36', 'x'],
        ['Grace', '', '', ''],
      ],
      headers,
      targets,
      fields,
      context,
    );
    expect(result.errors).toEqual([]);
    expect(result.ready).toEqual([
      { rowNumber: 2, values: { [name.id]: { firstName: 'Ada', lastName: 'Lovelace' }, [age.id]: '36' } },
      { rowNumber: 3, values: { [name.id]: { firstName: 'Grace' } } },
    ]);
  });

  it('sets aside a row with a cell its type can’t read, and one with nothing to import', () => {
    const result = readRows(
      [
        ['Ada', '', 'old', ''],
        ['', '', '', 'x'],
      ],
      headers,
      targets,
      fields,
      context,
    );
    expect(result.ready).toEqual([]);
    expect(result.errors.map((row) => [row.rowNumber, row.problems.map((problem) => problem.header)])).toEqual([
      [2, ['Age']],
      [3, ['']],
    ]);
    expect(result.errors[1]?.problems[0]?.reason).toBe(EMPTY_ROW);
  });

  it('takes a spreadsheet’s formula guard off before reading', () => {
    const result = readRows([["'-5"]], ['Age'], [{ attributeId: age.id }], fields, context);
    expect(result.ready[0]?.values[age.id]).toBe('-5');
  });

  it('writes the rows with errors as a CSV with an Error column', () => {
    const { errors } = readRows([['Ada', '', 'old', '=x']], headers, targets, fields, context);
    const csv = errorRowsCsv(headers, errors, 'Error');
    expect(csv.startsWith('﻿First,Last,Age,Ignored,Error\r\n')).toBe(true);
    expect(csv).toContain("Ada,,old,'=x,Age: ");
  });
});

describe('milestone 5: relations, missing options and new attributes', () => {
  const linked = attribute(7, 'employer', 'Employer', 'record_reference', {
    isMulti: true,
    relationship: {
      id: id(50),
      cardinality: 'many_to_many',
      side: 'from',
      targetObjectIds: [id(51)],
      farHoldsOne: false,
    },
  });
  const stage = attribute(8, 'stage', 'Stage', 'status', {
    options: [{ id: id(60), label: 'Lead', hue: 'blue', position: 0, isArchived: false }],
  });

  it('offers a relationship that has one, never one without', () => {
    const offered = importChoices([...attributes, linked]).map((choice) => choice.id);
    expect(offered).toContain(linked.id);
    expect(offered).not.toContain(company.id);
  });

  it('reads a relation cell as names, split for a list of links', () => {
    const many = new Map([[linked.id, field(linked)]]);
    const read = readRows([['Acme, Globex; Initech']], ['Employer'], [{ attributeId: linked.id }], many, context);
    expect(read.ready[0]?.values[linked.id]).toEqual({ names: ['Acme', 'Globex', 'Initech'] });
    expect(relationNames('Acme, Inc.', false)).toEqual(['Acme, Inc.']);
  });

  it('lists the labels that name no option, each once, ignoring case', () => {
    const rows = [['Lead'], ['Won'], ['won'], [''], ['Lost']];
    expect(missingOptions(rows, 0, stage)).toEqual(['Won', 'Lost']);
    expect(missingOptions(rows, 0, age)).toEqual([]);
  });

  it('suggests a new attribute’s type from its values, text when unsure', () => {
    expect(suggestType(['ada@example.com', 'bob@example.com'])).toBe('email');
    expect(suggestType(['acme.com', 'www.globex.io'])).toBe('url');
    expect(suggestType(['https://acme.com/about'])).toBe('url');
    expect(suggestType(['1,200', '-3.5', '40'])).toBe('number');
    expect(suggestType(['yes', 'No'])).toBe('checkbox');
    expect(suggestType(['2026-10-21', '21/10/2026'])).toBe('date');
    expect(suggestType(['Acme', '12'])).toBe('text');
    expect(suggestType([])).toBe('text');
  });

  it('collects a relation column’s distinct names across rows', () => {
    expect(columnNames([['Acme'], ['acme'], ['Globex, Acme'], ['']], 0, true)).toEqual(['Acme', 'Globex']);
  });
});
