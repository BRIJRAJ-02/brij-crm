// Strictest of inputs (spec 0015, AC-329), unit tested on the pure policy: a computed attribute is hidden from a
// member who can't see one of its inputs, through chains, and a lookup across an object a record rule narrows.
import { describe, expect, it } from 'vitest';
import { fieldLevel, roleAccess, type AccessRules, type ComputedInputRule, type MemberPrincipal } from './policy.ts';

const PEOPLE = '00000000-0000-7000-8000-00000000000a';
const COMPANIES = '00000000-0000-7000-8000-00000000000b';
const SALARY = '00000000-0000-7000-8000-0000000000f1';
const BAND = '00000000-0000-7000-8000-0000000000f2';
const BAND_LABEL = '00000000-0000-7000-8000-0000000000f3';
const INDUSTRY = '00000000-0000-7000-8000-0000000000f4';
const COMPANY_INDUSTRY = '00000000-0000-7000-8000-0000000000f5';
const COMPANY_COUNT = '00000000-0000-7000-8000-0000000000f6';
const OWNER = '00000000-0000-7000-8000-0000000000f7';

const member: MemberPrincipal = {
  kind: 'member',
  memberId: '00000000-0000-7000-8000-000000000001',
  role: 'member',
  teamIds: [],
};

const COMPUTED: readonly ComputedInputRule[] = [
  // A formula on People reading Salary, and one reading that formula (a chain).
  { computedId: BAND, computedObjectId: PEOPLE, inputId: SALARY, inputObjectId: PEOPLE, kind: 'formula' },
  { computedId: BAND_LABEL, computedObjectId: PEOPLE, inputId: BAND, inputObjectId: PEOPLE, kind: 'formula' },
  // A lookup of the company's industry, and a rollup over companies.
  {
    computedId: COMPANY_INDUSTRY,
    computedObjectId: PEOPLE,
    inputId: INDUSTRY,
    inputObjectId: COMPANIES,
    kind: 'lookup',
  },
  { computedId: COMPANY_COUNT, computedObjectId: PEOPLE, inputId: INDUSTRY, inputObjectId: COMPANIES, kind: 'rollup' },
];

const field = (attributeId: string, objectId = PEOPLE) => ({ id: attributeId, objectId });

describe('strictest of inputs', () => {
  it('hides a computed attribute, and what builds on it, when an input field is hidden', () => {
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: PEOPLE, attributeId: SALARY },
          level: 'hidden',
        },
      ],
      records: [],
      computed: COMPUTED,
    };
    const access = roleAccess(member, rules);
    expect(fieldLevel(access, field(BAND))).toBe('hidden');
    expect(fieldLevel(access, field(BAND_LABEL))).toBe('hidden');
    expect(fieldLevel(access, field(COMPANY_INDUSTRY))).toBe('write');
  });

  it('hides lookups and rollups of an object the member can’t see', () => {
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: COMPANIES }, level: 'none' },
      ],
      records: [],
      computed: COMPUTED,
    };
    const access = roleAccess(member, rules);
    expect(fieldLevel(access, field(COMPANY_INDUSTRY))).toBe('hidden');
    expect(fieldLevel(access, field(COMPANY_COUNT))).toBe('hidden');
  });

  it('hides a lookup across a record rule, and keeps a rollup, which names no record', () => {
    const rules: AccessRules = {
      levels: [],
      records: [{ subject: { type: 'role', role: 'member' }, objectId: COMPANIES, kind: 'own', attributeId: OWNER }],
      computed: COMPUTED,
    };
    const access = roleAccess(member, rules);
    expect(fieldLevel(access, field(COMPANY_INDUSTRY))).toBe('hidden');
    expect(fieldLevel(access, field(COMPANY_COUNT))).toBe('write');
  });

  it('leaves owners and admins the open policy', () => {
    const access = roleAccess({ ...member, role: 'admin' }, { levels: [], records: [], computed: COMPUTED });
    expect(fieldLevel(access, field(BAND))).toBe('write');
  });
});
