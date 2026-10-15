import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  DRAFT_LINK_MAX,
  effectiveColumns,
  effectiveQuery,
  encodeDraft,
  decodeDraftText,
  isSortable,
  sameQuery,
  SORTABLE_TYPES,
  type ViewAttribute,
} from './view-model.ts';
import { AttributeType } from './values/attribute-values.ts';
import type { FilterGroup } from './values/filters.ts';
import { decodeDraft, ViewConfig } from './views.ts';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const attribute = (n: number, extra: Partial<ViewAttribute> = {}): ViewAttribute => ({
  id: id(n),
  type: 'text',
  isSystem: false,
  apiSlug: `a${String(n)}`,
  position: n,
  isArchived: false,
  ...extra,
});

const RECORD_ID = attribute(1, { isSystem: true, apiSlug: 'record_id', position: 0 });
const CREATED_AT = attribute(2, { isSystem: true, apiSlug: 'created_at', type: 'timestamp', position: 1 });
const NAME = attribute(10, { apiSlug: 'name', position: 5 });
const EMAIL = attribute(11, { apiSlug: 'email', type: 'email', position: 6 });
const NOTES = attribute(12, { apiSlug: 'notes', type: 'long_text', position: 7 });
const COMPANY = attribute(13, { apiSlug: 'company', type: 'record_reference', position: 8 });
const OLD = attribute(14, { apiSlug: 'old', position: 9, isArchived: true });
const PEOPLE = [RECORD_ID, CREATED_AT, NAME, EMAIL, NOTES, COMPANY, OLD];
const INDUSTRY = attribute(20, { apiSlug: 'industry', type: 'select', position: 5 });
const COMPANIES = [attribute(21, { isSystem: true, apiSlug: 'created_at', type: 'timestamp' }), INDUSTRY];

describe('isSortable', () => {
  it('sorts every type but long text, and every system attribute', () => {
    const sortable = AttributeType.options.filter((type) => isSortable({ type, isSystem: false }));
    expect(sortable).toEqual(AttributeType.options.filter((type) => type !== 'long_text'));
    expect([...SORTABLE_TYPES].every((type) => (AttributeType.options as readonly string[]).includes(type))).toBe(true);
    expect(isSortable({ type: 'long_text', isSystem: true })).toBe(true);
  });
});

describe('effectiveQuery', () => {
  const where = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });

  it('runs empty sorts as Created at, newest first, and keeps a live filter as it is', () => {
    const filter = where({ attributeId: NAME.id, operator: 'contains', value: 'a' });
    expect(effectiveQuery({ filter, sorts: [] }, PEOPLE)).toEqual({
      status: 'ready',
      filter,
      sorts: [{ attributeId: CREATED_AT.id, direction: 'descending' }],
      skipped: [],
      dropped: false,
    });
  });

  it('leaves out conditions and sorts on archived and unknown attributes, naming only the archived ones', () => {
    const query = effectiveQuery(
      {
        filter: where(
          { attributeId: OLD.id, operator: 'is_empty' },
          { attributeId: id(99), operator: 'is_empty' },
          { attributeId: NAME.id, operator: 'is_not_empty' },
        ),
        sorts: [
          { attributeId: OLD.id, direction: 'ascending' },
          { attributeId: EMAIL.id, direction: 'ascending' },
        ],
      },
      PEOPLE,
    );
    expect(query).toEqual({
      status: 'ready',
      filter: where({ attributeId: NAME.id, operator: 'is_not_empty' }),
      sorts: [{ attributeId: EMAIL.id, direction: 'ascending' }],
      skipped: [OLD.id],
      dropped: true,
    });
  });

  it('removes groups left empty, nested ones too, and an empty top level means no filter', () => {
    const query = effectiveQuery(
      {
        filter: {
          conjunction: 'or',
          conditions: [
            where({ attributeId: OLD.id, operator: 'is_empty' }, where({ attributeId: id(98), operator: 'is_empty' })),
          ],
        },
        sorts: [{ attributeId: NOTES.id, direction: 'ascending' }],
      },
      PEOPLE,
    );
    expect(query).toMatchObject({ status: 'ready', sorts: [{ attributeId: CREATED_AT.id }], dropped: true });
    expect(query).not.toHaveProperty('filter');
  });

  it('follows a through path when the far attributes are in, waits while they load, and drops an unknown far side', () => {
    const through = where({
      operator: 'through',
      path: [COMPANY.id],
      condition: { attributeId: INDUSTRY.id, operator: 'is', value: id(500) },
    });
    const ready = effectiveQuery({ filter: through, sorts: [] }, PEOPLE, () => COMPANIES);
    expect(ready).toMatchObject({ status: 'ready', filter: through, dropped: false });
    expect(effectiveQuery({ filter: through, sorts: [] }, PEOPLE, () => 'pending')).toEqual({ status: 'pending' });
    const unknown = effectiveQuery({ filter: through, sorts: [] }, PEOPLE);
    expect(unknown).toMatchObject({ status: 'ready', dropped: true });
    expect(unknown).not.toHaveProperty('filter');
    const archivedFar = effectiveQuery({ filter: through, sorts: [] }, PEOPLE, () => [
      { ...INDUSTRY, isArchived: true },
    ]);
    expect(archivedFar).toMatchObject({ status: 'ready', skipped: [INDUSTRY.id] });
  });
});

describe('effectiveColumns', () => {
  const layout = { columns: [], showNewAttributes: true, pinnedCount: 1 };

  it('shows every non system attribute in order, then Created at, the name first, for a seeded default view', () => {
    const { columns, pinnedCount } = effectiveColumns(layout, PEOPLE, NAME.id);
    expect(columns.map((column) => [column.attributeId, column.isHidden])).toEqual([
      [NAME.id, false],
      [EMAIL.id, false],
      [NOTES.id, false],
      [COMPANY.id, false],
      [RECORD_ID.id, true],
      [CREATED_AT.id, false],
    ]);
    expect(pinnedCount).toBe(1);
  });

  it('keeps a curated order and widths, hides new attributes when the view asks, and puts the name first', () => {
    const { columns, pinnedCount } = effectiveColumns(
      {
        columns: [
          { attributeId: EMAIL.id, width: 240 },
          { attributeId: OLD.id },
          { attributeId: NAME.id, isHidden: true },
        ],
        showNewAttributes: false,
        pinnedCount: 5,
      },
      PEOPLE,
      NAME.id,
    );
    expect(columns.slice(0, 2)).toEqual([
      { attributeId: NAME.id, isHidden: false },
      { attributeId: EMAIL.id, width: 240, isHidden: false },
    ]);
    expect(columns.slice(2).every((column) => column.isHidden)).toBe(true);
    // Five pinned asked, two shown.
    expect(pinnedCount).toBe(2);
  });
});

describe('the draft in the URL', () => {
  const query = {
    filter: {
      conjunction: 'and' as const,
      conditions: [{ attributeId: NAME.id, operator: 'contains' as const, value: 'Zoë ✓' }],
    },
    sorts: [{ attributeId: EMAIL.id, direction: 'ascending' as const }],
  };

  it('round trips through base64url of the canonical JSON, whatever the key order', () => {
    const text = encodeDraft(query);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDraft(text)).toEqual(query);
    const reordered = {
      sorts: query.sorts,
      filter: { conditions: query.filter.conditions, conjunction: 'and' as const },
    };
    expect(encodeDraft(reordered)).toBe(text);
    expect(sameQuery(query, reordered)).toBe(true);
    expect(sameQuery({ filter: { conjunction: 'and', conditions: [] }, sorts: [] }, { sorts: [] })).toBe(true);
  });

  it('refuses text that is not base64url, not JSON, or not a query', () => {
    expect(decodeDraftText('not base64!')).toBeUndefined();
    expect(decodeDraftText(encodeDraft(query).slice(0, 10))).toBeUndefined();
    expect(decodeDraft(btoa('{"sorts":"x"}').replace(/=+$/, ''))).toBeUndefined();
    expect(decodeDraft('')).toBeUndefined();
    expect(DRAFT_LINK_MAX).toBe(6000);
  });

  it('writes canonical JSON with sorted keys and no undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe('{"a":[{"c":2}],"b":1}');
  });
});

describe('ViewConfig', () => {
  it('takes the seeded default and refuses unknown keys, a column twice and too many pins', () => {
    const seeded = { columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [] };
    expect(ViewConfig.safeParse(seeded).success).toBe(true);
    expect(ViewConfig.safeParse({ ...seeded, extra: true }).success).toBe(false);
    expect(ViewConfig.safeParse({ ...seeded, pinnedCount: 6 }).success).toBe(false);
    expect(
      ViewConfig.safeParse({ ...seeded, columns: [{ attributeId: NAME.id }, { attributeId: NAME.id }] }).success,
    ).toBe(false);
  });
});
