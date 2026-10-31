// Filing the answer types of spec 0063's first batch (AC-6307): each new answer files onto the attribute types
// `FILES_ONTO` names, in the shape each takes, and a multi select refuses a field that holds one choice. `plan`
// does no I/O, so the attributes are written out here.
import type { FormDocument } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { AttributeDef } from '../engine/values.ts';
import { plan } from './process.ts';

const attribute = (id: string, type: AttributeDef['type'], isMulti = false): AttributeDef => ({
  id,
  objectId: '0199f0a0-0000-7000-8000-00000000000b',
  listId: null,
  apiSlug: id,
  objectKey: null,
  title: id,
  type,
  isMulti,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  systemColumn: null,
  archivedAt: null,
  archivedBy: null,
  config: {},
  defaultValue: null,
  relationshipId: null,
  position: 0,
  ruleCount: 0,
  rulesVersion: 0,
});

const ID = {
  date: '0199f0a0-0000-7000-8000-0000000000d1',
  rating: '0199f0a0-0000-7000-8000-0000000000d2',
  number: '0199f0a0-0000-7000-8000-0000000000d3',
  location: '0199f0a0-0000-7000-8000-0000000000d4',
  tags: '0199f0a0-0000-7000-8000-0000000000d5',
  plan: '0199f0a0-0000-7000-8000-0000000000d6',
  text: '0199f0a0-0000-7000-8000-0000000000d7',
};

const ATTRIBUTES = new Map<string, AttributeDef>([
  [ID.date, attribute(ID.date, 'date')],
  [ID.rating, attribute(ID.rating, 'rating')],
  [ID.number, attribute(ID.number, 'number')],
  [ID.location, attribute(ID.location, 'location')],
  [ID.tags, attribute(ID.tags, 'select', true)],
  [ID.plan, attribute(ID.plan, 'select')],
  [ID.text, attribute(ID.text, 'text')],
]);

const OPTIONS = new Map([
  [
    ID.tags,
    [
      { id: 'o1', label: 'Sales' },
      { id: 'o2', label: 'Support' },
    ],
  ],
  [ID.plan, [{ id: 'o3', label: 'Pro' }]],
]);

const question = (key: string, answerType: FormDocument['questions'][number]['answerType'], attributeId: string) => ({
  id: key,
  key,
  label: key,
  answerType,
  required: false,
  update: 'fill' as const,
  filedOn: { objectRole: 'main' as const, attributeId },
});

describe('filing the new answer types (spec 0063, AC-6307)', () => {
  it('files a date, a rating, a scale, an address and a time onto their fields', () => {
    const { planned, refused } = plan(
      {
        questions: [
          question('start', 'date', ID.date),
          question('fit', 'rating', ID.rating),
          question('nps', 'scale', ID.number),
          question('office', 'address', ID.location),
          question('slot', 'time', ID.text),
        ],
      },
      ATTRIBUTES,
      OPTIONS,
      {
        start: '2026-11-02',
        fit: 4,
        nps: 9,
        office: { line1: '1 Main St', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB' },
        slot: '14:30',
      },
    );
    expect(refused).toEqual([]);
    expect(Object.fromEntries(planned.map((each) => [each.questionId, each.value]))).toMatchObject({
      start: '2026-11-02',
      fit: 4,
      nps: '9',
      office: { line1: '1 Main St', locality: 'Leeds', postcode: 'LS1 1AA', countryCode: 'GB' },
      slot: '14:30',
    });
  });

  it('files a multi select’s picks onto a field of several choices and keeps Other off the record', () => {
    const { planned, refused } = plan(
      { questions: [question('teams', 'multi_select', ID.tags)] },
      ATTRIBUTES,
      OPTIONS,
      {
        teams: { picked: ['Sales', 'Support'], other: 'Billing' },
      },
    );
    expect(refused).toEqual([]);
    expect(planned[0]?.value).toEqual(['o1', 'o2']);
  });

  it('refuses a multi select on a field that holds one choice, saying why', () => {
    const { planned, refused } = plan(
      { questions: [question('teams', 'multi_select', ID.plan)] },
      ATTRIBUTES,
      OPTIONS,
      {
        teams: { picked: ['Pro'] },
      },
    );
    expect(planned).toEqual([]);
    expect(refused[0]?.message).toBe(`${ID.plan} holds one choice, and several were picked.`);
  });

  it('refuses a rating filed onto a date field, as a field changed since', () => {
    const { refused } = plan({ questions: [question('fit', 'rating', ID.date)] }, ATTRIBUTES, OPTIONS, { fit: 4 });
    expect(refused[0]?.message).toBe(`${ID.date} no longer takes this kind of answer.`);
  });
});
