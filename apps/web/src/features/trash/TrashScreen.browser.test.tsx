// Settings › Trash as a settings Table, in Chromium with the library's styles (5 November 2026): each row's Restore,
// a refused one saying why on its name, Delete forever asking first and naming the record, a row's own action leaving
// the ticks alone, the next block in the table's foot, the block empty state, and no axe violations in either theme.
import '@crm/ui/styles.css';
import type { MemberSummary, ObjectSummary, RestoreSummary, TrashRow, TrashState, TrashView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { TrashScreen } from './TrashScreen.tsx';

const PEOPLE = {
  id: '00000000-0000-7000-8000-00000000000a',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  position: 1,
  isArchived: false,
  access: 'write',
} as unknown as ObjectSummary;
const DEALS = {
  ...PEOPLE,
  id: '00000000-0000-7000-8000-00000000000b',
  apiSlug: 'deals',
  singularName: 'Deal',
  pluralName: 'Deals',
  access: 'read',
} as unknown as ObjectSummary;
const MEMBERS: readonly MemberSummary[] = [{ id: '00000000-0000-7000-8000-000000000001', name: 'Ada Lovelace' }];

/** One trashed record. */
const row = (id: string, name: string, object: ObjectSummary): TrashRow =>
  ({
    id,
    values: {},
    item: {
      recordId: id,
      objectId: object.id,
      display: { objectId: object.id, recordId: id, name },
      deletedAt: '2026-11-01T09:00:00.000Z',
      deletedBy: { type: 'member', id: MEMBERS[0]?.id ?? null },
      expiresAt: '2026-12-01T09:00:00.000Z',
    },
  }) as unknown as TrashRow;

const CY = row('00000000-0000-7000-8000-0000000000c1', 'Cy Lane', PEOPLE);
const BEA = row('00000000-0000-7000-8000-0000000000c2', 'Bea Stone', PEOPLE);
const DEAL = row('00000000-0000-7000-8000-0000000000c3', 'Big deal', DEALS);

/** A view holding `rows` of `count` records, with these refusals on their names. */
function viewOf(rows: readonly TrashRow[], count = rows.length, cellErrors = new Map<string, string>()) {
  const onRangeChange = vi.fn();
  const state: TrashState = {
    source: {
      count,
      getItem: (index: number) => rows[index],
      getKey: (each: TrashRow) => each.id,
      onRangeChange,
    },
    status: 'ready',
    count: { count, atLeast: false },
    cellErrors,
  } as unknown as TrashState;
  const view = {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    retry: () => undefined,
    ready: () => Promise.resolve(),
    row: (id: string) => rows.find((each) => each.id === id),
    indexOf: (id: string) => rows.findIndex((each) => each.id === id),
  } as unknown as TrashView;
  return { view, onRangeChange };
}

const DONE: RestoreSummary = { kind: 'done', restored: 1, refused: 0, refusedIds: [], reasons: [], objectIds: [] };

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

/** Ticks a row: a click on the box's own input, which the styled box covers. */
const tick = (name: RegExp) => {
  (page.getByRole('checkbox', { name }).element() as HTMLElement).click();
};

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** The screen for an owner (who may delete forever), with a fake trash answering restores and purges. */
async function render(view: TrashView) {
  const restore = vi.fn(() => Promise.resolve(DONE));
  const deleteForever = vi.fn(() =>
    Promise.resolve({ kind: 'done', purged: 1, skipped: 0, refused: 0, refusedIds: [], reasons: [] }),
  );
  shown = await renderInApp(
    () => <TrashScreen slug="acme" objects={[PEOPLE, DEALS]} members={MEMBERS} view={view} objectId={undefined} />,
    {
      data: {
        trash: { restore, deleteForever },
        jobs: { get: () => undefined, follow: () => () => undefined },
      } as never,
      pattern: '/w/$slug/settings/trash',
      at: '/w/acme/settings/trash',
      permissions: ['records.purge'],
    },
  );
  return { restore, deleteForever };
}

describe('Settings › Trash', () => {
  it('lists the name, kind, who, when and Restore, one kind filter, and no foot when every row shows', async () => {
    const { onRangeChange, view } = viewOf([CY, BEA]);
    await render(view);
    const table = page.getByRole('grid', { name: 'Trash' });
    await expect.element(table.getByRole('rowheader', { name: /Cy Lane/ })).toBeVisible();
    await expect.element(table.getByRole('row', { name: /Cy Lane/ }).getByText('Person')).toBeVisible();
    await expect.element(table.getByRole('row', { name: /Cy Lane/ }).getByText('Ada Lovelace')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /All kinds/ })).toBeVisible();
    expect(onRangeChange).toHaveBeenCalledWith({ start: 0, end: 2 });
    expect(page.getByRole('button', { name: 'Show more' }).elements()).toHaveLength(0);
  });

  it('says on each row the day it is deleted forever', async () => {
    const { view } = viewOf([CY]);
    await render(view);
    const table = page.getByRole('grid', { name: 'Trash' });
    await expect.element(table.getByRole('columnheader', { name: 'Deleted forever on' })).toBeVisible();
    // 1 December, 30 days after it was deleted, as the row's own date field writes the day.
    await expect.element(table.getByRole('row', { name: /Cy Lane/ }).getByText(/Dec.*1|1.*Dec/)).toBeVisible();
  });

  it('restores from the row, leaving what is ticked alone', async () => {
    const { view } = viewOf([CY, BEA]);
    const { restore } = await render(view);
    tick(/^Select Bea Stone/);
    await page.getByRole('button', { name: 'Restore Cy Lane' }).click();
    expect(restore).toHaveBeenCalledWith('acme', [CY.id]);
    await expect.element(page.getByText('Restored Cy Lane.')).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: /^Select Bea Stone/ })).toBeChecked();
  });

  it('says on the name why a record wasn’t restored', async () => {
    const reasons = new Map([[`${CY.id}:name`, 'Another record now has Email ada@acme.com.']]);
    const { view } = viewOf([CY], 1, reasons);
    await render(view);
    const name = page.getByRole('rowheader', { name: /Cy Lane/ });
    await expect.element(name.getByText('Not restored')).toBeVisible();
    await name.getByRole('button', { name: 'About Cy Lane not restored' }).click();
    await expect.element(page.getByText('Another record now has Email ada@acme.com.').first()).toBeVisible();
  });

  it('asks before deleting one row forever, naming the record, and leaves the ticks alone', async () => {
    const { view } = viewOf([CY, BEA]);
    const { deleteForever } = await render(view);
    tick(/^Select Bea Stone/);
    await page.getByRole('button', { name: 'More for Cy Lane' }).click();
    await page.getByRole('menuitem', { name: 'Delete forever' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete Cy Lane forever?' });
    await expect.element(confirm).toBeVisible();
    expect(deleteForever).not.toHaveBeenCalled();
    await confirm.getByRole('button', { name: 'Delete Cy Lane forever' }).click();
    expect(deleteForever).toHaveBeenCalledWith('acme', [CY.id]);
    await expect.element(page.getByRole('checkbox', { name: /^Select Bea Stone/ })).toBeChecked();
  });

  it('offers a record of a read only object no Restore and no Delete forever', async () => {
    const { view } = viewOf([DEAL]);
    await render(view);
    await expect.element(page.getByRole('row', { name: /Big deal/ }).getByText('View only')).toBeVisible();
    expect(page.getByRole('button', { name: 'Restore Big deal' }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'More for Big deal' }).elements()).toHaveLength(0);
  });

  it('reads the next block from the table’s foot', async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      row(`00000000-0000-7000-8000-0000000d${String(index).padStart(4, '0')}`, `Person ${String(index)}`, PEOPLE),
    );
    const { onRangeChange, view } = viewOf(rows, 150);
    await render(view);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('100 of 150 records');
    });
    await page.getByRole('button', { name: 'Show more' }).click();
    await vi.waitFor(() => {
      expect(onRangeChange).toHaveBeenLastCalledWith({ start: 0, end: 150 });
    });
  });

  it('reads on past 1,000 records, so no record in the trash is out of reach', async () => {
    const { onRangeChange, view } = viewOf([CY], 1200);
    await render(view);
    const more = page.getByRole('button', { name: 'Show more' });
    for (const _press of Array.from({ length: 11 })) await more.click();
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: 0, end: 1200 });
  });

  it('keeps the foot while rows are missing, and asks again for a block that failed', async () => {
    const { onRangeChange, view } = viewOf([CY], 2);
    await render(view);
    await page.getByRole('button', { name: 'Show more' }).click();
    await page.getByRole('button', { name: 'Show more' }).click();
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: 0, end: 2 });
    expect(
      onRangeChange.mock.calls.filter(([range]) => (range as { readonly end: number }).end === 2).length,
    ).toBeGreaterThan(1);
  });

  it('says it is empty in one block, with no filter and no table', async () => {
    const { view } = viewOf([]);
    await render(view);
    await expect.element(page.getByText('The trash is empty')).toBeVisible();
    expect(page.getByRole('grid').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /All kinds/ }).elements()).toHaveLength(0);
  });

  it.each(THEMES)('has no axe violations in %s, a refusal and a view only row among them', async (theme) => {
    const reasons = new Map([[`${CY.id}:name`, 'Another record now has Email ada@acme.com.']]);
    const { view } = viewOf([CY, DEAL], 2, reasons);
    await render(view);
    await expect.element(page.getByText('Not restored')).toBeVisible();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });
});
