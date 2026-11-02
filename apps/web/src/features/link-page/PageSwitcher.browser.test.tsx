// The link page switcher in Chromium (spec 0064, AC-6414 to AC-6416, AC-6442): the pages as tiles with New link page
// at their end; a new page asking only for an address and a name, refused on the field before anything is sent, then
// its Ready panel; Make main page; and delete asking first in a Modal with one line, never offered for the only page.
// Checked with axe in light and dark.
import '@crm/ui/styles.css';
import { DEFAULT_PAGE_THEME, type DataLayer, type LinkPageSummary } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { PageSwitcher } from './PageSwitcher.tsx';

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

const MAIN = '0190a0a0-0000-7000-8000-000000000001';
const SIDE = '0190a0a0-0000-7000-8000-000000000002';

const summary = (id: string, handle: string, name: string, isPrimary: boolean): LinkPageSummary => ({
  id,
  handle,
  name,
  isPrimary,
  isPublic: true,
  bio: '',
  theme: DEFAULT_PAGE_THEME,
});

const TWO = [summary(MAIN, 'ada', '', true), summary(SIDE, 'ada-makes', 'Side project', false)];

/** The switcher with a fake data layer whose page calls are spies. */
async function render(pages: readonly LinkPageSummary[], pages$: Partial<DataLayer['linkPage']['pages']> = {}) {
  const calls = {
    onPick: vi.fn(),
    onChanged: vi.fn(),
    onStartEditing: vi.fn(),
  };
  const data = {
    linkPage: {
      pages: {
        newId: () => '0190a0a0-0000-7000-8000-0000000000ff',
        list: () => Promise.resolve(pages),
        create: vi.fn(() => Promise.resolve(pages)),
        rename: vi.fn(() => Promise.resolve(pages)),
        setPrimary: vi.fn(() => Promise.resolve(pages)),
        remove: vi.fn(() => Promise.resolve(pages.slice(0, 1))),
        ...pages$,
      },
    },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <main>
        <PageSwitcher data={data} slug="acme" pages={pages} current={pages[0]?.id ?? MAIN} {...calls} />
      </main>
    ),
    { data, pattern: '/w/$slug/link-page', at: '/w/acme/link-page' },
  );
  return { data, calls };
}

describe('the link page switcher (spec 0064)', () => {
  it('shows each page as a tile, the main one picked, with New link page at the end (AC-6414)', async () => {
    const { calls } = await render(TWO);
    const group = page.getByRole('radiogroup', { name: 'Your link pages' });
    await expect.element(group).toBeVisible();
    // A page with no name goes by its address; the main page is the one picked.
    await expect.element(page.getByRole('radio', { name: '/ada' })).toBeChecked();
    await page.getByRole('radio', { name: 'Side project' }).click();
    expect(calls.onPick).toHaveBeenCalledWith(SIDE);
    await expect.element(page.getByRole('button', { name: 'New link page' })).toBeEnabled();
    for (const theme of ['light', 'dark'] as const) {
      applyTheme(theme);
      expect(await axeViolations()).toEqual([]);
    }
    resetTheme();
  });

  it('asks only for an address and a name, refuses a kept word on the field, then shows the Ready panel', async () => {
    const create = vi.fn(() => Promise.resolve(TWO));
    const { calls } = await render(TWO, { create });
    await page.getByRole('button', { name: 'New link page' }).click();
    const address = page.getByRole('textbox', { name: 'Address' });
    await expect.element(address).toBeVisible();
    await address.fill('settings');
    await page.getByRole('button', { name: 'Create page' }).click();
    await expect.element(address).toHaveAccessibleDescription(/kept for Timefix/);
    expect(create).not.toHaveBeenCalled();
    await address.fill('Ada Side');
    await page.getByRole('textbox', { name: 'Name' }).fill('Side project');
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => create.mock.calls as unknown[])
      .toEqual([['acme', { id: '0190a0a0-0000-7000-8000-0000000000ff', handle: 'ada-side', name: 'Side project' }]]);
    expect(calls.onChanged).toHaveBeenCalledWith('0190a0a0-0000-7000-8000-0000000000ff');
    await expect.element(page.getByRole('heading', { name: 'Your link page is ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Add to your page' }).click();
    expect(calls.onStartEditing).toHaveBeenCalled();
  });

  it('takes no sixth page: the tile says so (AC-6413)', async () => {
    const five = [0, 1, 2, 3, 4].map((n) =>
      summary(`0190a0a0-0000-7000-8000-00000000001${String(n)}`, `ada-${String(n)}`, `Page ${String(n)}`, n === 0),
    );
    await render(five);
    await expect.element(page.getByRole('button', { name: /New link page/ })).toBeDisabled();
    await expect.element(page.getByText('At the limit')).toBeVisible();
  });

  it('never offers to delete the only page, and asks first before deleting another (AC-6416)', async () => {
    await render(TWO.slice(0, 1));
    await page.getByRole('button', { name: 'Page options' }).click();
    await expect.element(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: 'Delete page' }).query()).toBeNull();
    // The main page is main already.
    expect(page.getByRole('menuitem', { name: 'Make main page' }).query()).toBeNull();
    await userEvent.keyboard('{Escape}');
    shown?.unmount();
    const remove = vi.fn(() => Promise.resolve(TWO.slice(0, 1)));
    const { calls } = await render(TWO, { remove });
    await page.getByRole('button', { name: 'Page options' }).click();
    await page.getByRole('menuitem', { name: 'Delete page' }).click();
    await expect.element(page.getByText(/stays yours and opens your main page/)).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Delete page' }).click();
    await expect.poll(() => remove.mock.calls as unknown[]).toEqual([['acme', MAIN]]);
    expect(calls.onChanged).toHaveBeenCalledWith(MAIN);
  });

  it('makes another page the main one (AC-6415)', async () => {
    const setPrimary = vi.fn(() => Promise.resolve(TWO));
    shown = undefined;
    const data = {
      linkPage: { pages: { setPrimary, newId: () => '' } },
    } as unknown as DataLayer;
    const onChanged = vi.fn();
    shown = await renderInApp(
      () => (
        <main>
          <PageSwitcher
            data={data}
            slug="acme"
            pages={TWO}
            current={SIDE}
            onPick={vi.fn()}
            onChanged={onChanged}
            onStartEditing={vi.fn()}
          />
        </main>
      ),
      { data, pattern: '/w/$slug/link-page', at: '/w/acme/link-page' },
    );
    await page.getByRole('button', { name: 'Page options' }).click();
    await page.getByRole('menuitem', { name: 'Make main page' }).click();
    await expect.poll(() => setPrimary.mock.calls as unknown[]).toEqual([['acme', SIDE]]);
    expect(onChanged).toHaveBeenCalledWith(SIDE);
  });
});
