// The record panel draws at once (spec 0074, batch 5, AC-7413, AC-7425): the record a table already holds comes from
// the store with no read of its own, and each section shows its own Skeleton until its read lands, so nothing waits on
// the slowest. Steps say where the record is in the list, and J steps like ↓.
import '@crm/ui/app.css';
import type { DataLayer, ObjectSummary, RecordState, RecordView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { RecordPeek } from './RecordPeek.tsx';

const OBJECT = {
  id: '0199a6f2-0000-7000-8000-0000000000c1',
  apiSlug: 'companies',
  singularName: 'Company',
  pluralName: 'Companies',
  access: 'write',
} as unknown as ObjectSummary;

const RECORD_ID = '0199a6f2-0000-7000-8000-0000000000a1';
const NEXT_ID = '0199a6f2-0000-7000-8000-0000000000a2';

const RECORD = {
  id: RECORD_ID,
  objectId: OBJECT.id,
  display: { recordId: RECORD_ID, objectId: OBJECT.id, name: 'Northwind Traders', kind: 'company' },
  revision: 1,
  values: {},
  versions: {},
  linkTotals: {},
} as unknown as RecordView;

/** A read that never lands: its section stays on its Skeleton. */
const never = () => new Promise<never>(() => undefined);

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The data layer the panel reads, counting every read it asks for. */
function dataOf() {
  const reads: string[] = [];
  const state: RecordState = {
    status: 'ready',
    record: RECORD,
    isLost: false,
    cellErrors: new Map(),
    referenceDisplays: () => [],
  };
  const subscription = {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retry: () => undefined,
    ready: () => Promise.resolve(),
    retain: () => () => undefined,
  };
  const count =
    <Value,>(name: string, answer: () => Promise<Value>) =>
    () => {
      reads.push(name);
      return answer();
    };
  const data = {
    objects: { list: count('objects.list', () => Promise.resolve([OBJECT])) },
    access: { mine: count('access.mine', () => Promise.resolve({ memberId: 'm1', permissions: [] })) },
    // The store's subscription: served from what the table holds, so it asks the server nothing.
    records: { one: count('records.one', () => Promise.resolve(subscription)) },
    activity: { forRecord: count('activity.forRecord', never) },
    tasks: { forRecord: count('tasks.forRecord', never) },
    notes: { forRecord: count('notes.forRecord', never) },
    comments: { forRecord: count('comments.forRecord', never) },
    files: { forRecord: count('files.forRecord', never) },
    links: { section: count('links.section', never) },
  } as unknown as DataLayer;
  return { data, reads };
}

describe('the record panel', () => {
  it('draws the held record at once, each section on its own Skeleton, with no read of the record', async () => {
    const { data, reads } = dataOf();
    const onOpen = vi.fn();
    shown = await renderInApp(
      () => (
        <RecordPeek
          slug="acme"
          object={OBJECT}
          attributes={[]}
          members={[]}
          recordId={RECORD_ID}
          tab="activity"
          onTabChange={() => undefined}
          steps={{ at: 3, of: 120, next: NEXT_ID }}
          onOpen={onOpen}
          onClose={() => undefined}
        />
      ),
      { data, pattern: '/w/$slug/companies', at: '/w/acme/companies' },
    );
    // The record draws though every section's read is still out (AC-7413).
    const panel = page.getByRole('dialog', { name: 'Northwind Traders' });
    await expect.element(panel).toBeVisible();
    await expect.element(panel.getByText('Companies · 3 of 120')).toBeVisible();
    // The Activity tab waits on its own read, on its Skeleton.
    await expect.element(panel.getByRole('tabpanel')).toBeVisible();
    expect(panel.getByRole('tabpanel').element().querySelector('[aria-busy="true"]')).not.toBeNull();
    // The record came from the store's subscription; nothing read it again (AC-7425).
    expect(reads.filter((read) => read === 'records.one')).toHaveLength(1);
    expect(reads.some((read) => read.startsWith('records.') && read !== 'records.one')).toBe(false);
    // J steps to the next record, as ↓ does (AC-7412).
    panel.getByRole('button', { name: 'Open full page' }).element().focus();
    await userEvent.keyboard('j');
    expect(onOpen).toHaveBeenCalledWith(NEXT_ID);
  });
});
