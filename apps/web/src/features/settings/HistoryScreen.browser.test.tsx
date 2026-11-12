// Settings › Workspace › History in Chromium (spec 0046, AC-4600, AC-4601, AC-4604, AC-4615 to AC-4618): one page of
// the workspace's changes with no tabs (a member's own sign ins moved to Sign in and security on 5 November 2026), a
// member sent on there; rows under Today, Yesterday or their day; a run of the same change one row with its count;
// Who on one line with an avatar; each state of the log in its words; a row read as its whole sentence; and axe in
// light and dark at 1280 and 375 wide.
import '@crm/ui/app.css';
import type { AuditEntryView, AuditLog, AuditLogState, DataLayer } from '@crm/data';
import { isRedirect } from '@tanstack/react-router';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { Route as ChangesRoute } from '../../routes/w.$slug.settings.history.changes.tsx';
import { Route as HistoryIndexRoute } from '../../routes/w.$slug.settings.history.index.tsx';
import { HistoryPending, HistoryScreen } from './HistoryScreen.tsx';
import { WorkspaceChangesPending, WorkspaceChangesTab } from './WorkspaceChangesTab.tsx';

const ADA = {
  kind: 'member',
  memberId: '0199f0a0-0000-7000-8000-0000000000a1',
  name: 'Ada Lovelace',
  state: 'active',
} as const;
const BEA = {
  kind: 'member',
  memberId: '0199f0a0-0000-7000-8000-0000000000b1',
  name: 'Bea Rao',
  state: 'former',
} as const;

const ROWS: readonly AuditEntryView[] = [
  {
    id: '0199f0a0-0000-7000-8000-000000000002',
    at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    actor: ADA,
    action: 'member.role_changed',
    target: { type: 'member', person: BEA },
    params: { from: 'member', to: 'admin' },
    changes: [],
  },
  {
    id: '0199f0a0-0000-7000-8000-000000000001',
    at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    actor: BEA,
    action: 'invitation.created',
    target: {
      type: 'invitation',
      id: '0199f0a0-0000-7000-8000-0000000000c1',
      email: 'grace@example.com',
      isLink: false,
    },
    params: { role: 'member' },
    changes: [],
  },
];

/** A log fixed in one state, with its actions as mocks. */
function logIn(state: AuditLogState) {
  const more = vi.fn();
  const retry = vi.fn();
  const log: AuditLog = {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    more,
    retry,
    retain: () => () => undefined,
    dispose: () => undefined,
  };
  return { log, more, retry };
}

/** A log whose state the test moves by hand, telling the screen each time, as the data layer's does. */
function liveLog(initial: AuditLogState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const more = vi.fn();
  const retry = vi.fn();
  const log: AuditLog = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    more,
    retry,
    retain: () => () => undefined,
    dispose: () => undefined,
  };
  const set = (next: AuditLogState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return { log, more, retry, set };
}

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  delete document.documentElement.dataset.theme;
});

const data = {} as unknown as DataLayer;

/** History with the log in `state` (or a log given), at a clock the test may fix. */
async function renderHistory(log: AuditLog, now?: () => string) {
  shown = await renderInApp(
    () => (
      <HistoryScreen>
        <WorkspaceChangesTab log={log} {...(now === undefined ? {} : { now })} />
      </HistoryScreen>
    ),
    { data, pattern: '/w/$slug/settings/history/changes', at: '/w/acme/settings/history/changes' },
  );
}

/** The first day's table: the one whose header names the columns. */
const firstGrid = () => page.getByRole('grid').first();

/** Every axe violation on the page, in light then dark. */
async function axeBothThemes(): Promise<readonly string[]> {
  const found: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    document.documentElement.dataset.theme = theme;
    // Only the theme's colour transitions: a loading row's shimmer runs forever, and finishing it throws.
    for (const animation of document.getAnimations()) {
      if (animation instanceof CSSTransition) animation.finish();
    }
    const results = await axe.run(document.body, { resultTypes: ['violations'] });
    found.push(...results.violations.map((violation) => `${theme} ${violation.id}: ${violation.help}`));
  }
  return found;
}

describe('the page (AC-4600, AC-4601)', () => {
  it('is one page with no tabs', async () => {
    await renderHistory(logIn({ status: 'ready', entries: ROWS, hasMore: false }).log);
    await expect.element(firstGrid()).toBeVisible();
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Your sign ins');
  });

  it('sends a member who opens it on to their own sign ins, and opens History on the changes', async () => {
    const as = (permissions: readonly string[]) => ({
      context: { data: { access: { mine: () => Promise.resolve({ permissions }) } } },
      params: { slug: 'acme' },
    });
    const thrown = async (run: () => unknown) => {
      try {
        await run();
      } catch (error) {
        return error;
      }
      return undefined;
    };
    const changes = ChangesRoute.options.beforeLoad as unknown as (input: unknown) => Promise<void>;
    const member = await thrown(() => changes(as([])));
    expect(isRedirect(member) ? member.options : undefined).toMatchObject({
      to: '/w/$slug/settings/account/sign-in',
      replace: true,
    });
    expect(await thrown(() => changes(as(['audit.read'])))).toBeUndefined();
    const index = HistoryIndexRoute.options.beforeLoad as unknown as (input: unknown) => Promise<void>;
    const owner = await thrown(() => index(as(['audit.read'])));
    expect(isRedirect(owner) ? owner.options.to : undefined).toBe('/w/$slug/settings/history/changes');
  });
});

describe('Workspace changes', () => {
  it('reads each row as its whole sentence, with the actor in Who and the rest in Change', async () => {
    await renderHistory(logIn({ status: 'ready', entries: ROWS, hasMore: false }).log);
    await expect.element(firstGrid()).toBeVisible();
    const headers = page
      .getByRole('rowheader')
      .elements()
      .map((cell) => cell.textContent);
    expect(headers[0]).toContain('Ada Lovelace changed Bea Rao’s role from Member to Admin');
    expect(
      page.getByRole('row', { name: /Ada Lovelace changed Bea Rao’s role from Member to Admin/ }).elements(),
    ).toHaveLength(1);
    expect(document.body.textContent).toContain('Changed Bea Rao’s role from Member to Admin');
    // A former member keeps their name, with a quiet badge.
    expect(
      page.getByRole('row', { name: /Bea Rao invited grace@example.com as Member/ }).element().textContent,
    ).toContain('Former member');
    expect(document.body.textContent).toContain('2 hours ago');
  });

  it('heads each day’s rows Today, Yesterday or the day, the column labels on the first day only', async () => {
    const at = (iso: string, id: string, actor: typeof ADA | typeof BEA = ADA): AuditEntryView => ({
      id,
      at: iso,
      actor,
      action: 'routing.tested',
      target: { type: 'workspace' },
      params: {},
      changes: [],
    });
    const entries = [
      at('2026-11-05T10:00:00Z', '0199f0a0-0000-7000-8000-000000000011'),
      at('2026-11-04T10:00:00Z', '0199f0a0-0000-7000-8000-000000000012', BEA),
      at('2026-10-20T10:00:00Z', '0199f0a0-0000-7000-8000-000000000013'),
    ];
    await renderHistory(logIn({ status: 'ready', entries, hasMore: false }).log, () => '2026-11-05T12:00:00Z');
    await expect.element(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Yesterday' })).toBeVisible();
    expect(page.getByRole('grid').elements()).toHaveLength(3);
    expect(page.getByRole('grid', { name: 'Workspace changes, Today' }).elements()).toHaveLength(1);
    // The labels head the first table alone; the others continue it.
    expect(
      page
        .getByRole('columnheader')
        .elements()
        .filter((cell) => cell.getClientRects().length > 0),
    ).toHaveLength(3);
  });

  it('collapses a run of the same change by the same person into one row with its count', async () => {
    const saved = (id: string, minutes: number): AuditEntryView => ({
      id,
      at: new Date(Date.parse('2026-11-05T11:00:00Z') - minutes * 60_000).toISOString(),
      actor: ADA,
      action: 'list.updated',
      target: { type: 'list', id: '0199f0a0-0000-7000-8000-0000000000e1', name: 'Sales', isGone: false },
      params: {},
      changes: [],
    });
    const entries = [
      saved('0199f0a0-0000-7000-8000-000000000021', 0),
      saved('0199f0a0-0000-7000-8000-000000000022', 3),
      saved('0199f0a0-0000-7000-8000-000000000023', 6),
    ];
    await renderHistory(logIn({ status: 'ready', entries, hasMore: false }).log, () => '2026-11-05T12:00:00Z');
    await expect.element(firstGrid()).toBeVisible();
    expect(page.getByRole('rowheader').elements()).toHaveLength(1);
    expect(page.getByRole('row', { name: /Ada Lovelace changed the list Sales 3 times/ }).elements()).toHaveLength(1);
  });

  it('names a deleted form once: “Made a form (since deleted)”', async () => {
    const made: AuditEntryView = {
      ...ROWS[0],
      id: '0199f0a0-0000-7000-8000-000000000031',
      action: 'form.created',
      target: { type: 'form', id: '0199f0a0-0000-7000-8000-0000000000f1', isGone: true },
      params: {},
    } as AuditEntryView;
    await renderHistory(logIn({ status: 'ready', entries: [made], hasMore: false }).log);
    await expect.element(firstGrid()).toBeVisible();
    expect(document.body.textContent).toContain('Made a form (since deleted)');
    expect(document.body.textContent).not.toContain('a deleted form');
  });

  it('keeps Who on one line, its avatar before the name', async () => {
    const long = { ...ADA, name: 'Augusta Ada King, Countess of Lovelace' };
    const entries = ROWS.map((row) => ({ ...row, actor: long })) as AuditEntryView[];
    await page.viewport(1280, 800);
    await renderHistory(logIn({ status: 'ready', entries, hasMore: false }).log);
    await expect.element(firstGrid()).toBeVisible();
    const who = page.getByRole('gridcell').elements()[0];
    expect(who?.querySelector('[aria-hidden="true"], img')).not.toBeNull();
    const line = who === undefined ? 0 : Number.parseFloat(getComputedStyle(who).lineHeight);
    // The words' own box, not the cell's: a row is taller than two lines of text (spec 0071's row height).
    const words = document.createRange();
    if (who !== undefined) words.selectNodeContents(who);
    expect(words.getBoundingClientRect().height).toBeLessThan(line * 2);
    expect(who === undefined ? '' : getComputedStyle(who).whiteSpace).toBe('nowrap');
  });

  it('shows Show more while more follow, and reads the next page', async () => {
    const { log, more } = logIn({ status: 'ready', entries: ROWS, hasMore: true });
    await renderHistory(log);
    await userEvent.click(page.getByRole('button', { name: 'Show more' }));
    expect(more).toHaveBeenCalledOnce();
  });

  it.each([
    ['loading', { status: 'loading', entries: [], hasMore: false }, 'Loading'],
    ['empty', { status: 'ready', entries: [], hasMore: false }, 'No changes yet'],
    [
      'forbidden',
      { status: 'forbidden', entries: [], hasMore: false, message: 'x' },
      'Only workspace owners and admins can see workspace changes.',
    ],
  ] as const)('says its %s state', async (_name, state, words) => {
    await renderHistory(logIn(state).log);
    await expect.poll(() => document.body.textContent).toContain(words);
    if (state.status === 'forbidden') expect(page.getByRole('grid').elements()).toHaveLength(0);
  });

  it('says a failed first page with the layer’s words, and Try again reads it again', async () => {
    const { log, retry } = logIn({ status: 'failed', entries: [], hasMore: false, message: 'Can’t reach Timefix.' });
    await renderHistory(log);
    await expect.poll(() => document.body.textContent).toContain('Couldn’t load workspace changes');
    expect(document.body.textContent).toContain('Can’t reach Timefix.');
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the rows when a later page failed, with Try again under them', async () => {
    const { log, retry } = logIn({
      status: 'more-failed',
      entries: ROWS,
      hasMore: true,
      message: 'Can’t reach Timefix.',
    });
    await renderHistory(log);
    await expect.poll(() => document.body.textContent).toContain('Couldn’t load more changes.');
    expect(page.getByRole('row').elements().length).toBeGreaterThan(2);
    expect(page.getByRole('button', { name: 'Show more' }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('Workspace changes, focus and layout', () => {
  it('runs Who, Change, then When', async () => {
    await renderHistory(logIn({ status: 'ready', entries: ROWS, hasMore: false }).log);
    await expect.element(firstGrid()).toBeVisible();
    expect(
      firstGrid()
        .getByRole('columnheader')
        .elements()
        .map((cell) => cell.textContent),
    ).toEqual(['Who', 'Change', 'When']);
  });

  it('fits a phone with no sideways scroll, the sentence wrapping', async () => {
    await page.viewport(390, 800);
    await renderHistory(logIn({ status: 'ready', entries: ROWS, hasMore: false }).log);
    const grid = firstGrid();
    await expect.element(grid).toBeVisible();
    const frame = grid.element().parentElement;
    expect(frame === null ? undefined : frame.scrollWidth <= frame.clientWidth).toBe(true);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    const change = page.getByRole('rowheader').elements()[0];
    expect(change === undefined ? 0 : change.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    await page.viewport(1280, 800);
  });

  it('keeps focus on one button from Show more to Try again, and hands it to the table when the last page came', async () => {
    const { log, more, retry, set } = liveLog({ status: 'ready', entries: ROWS.slice(0, 1), hasMore: true });
    await renderHistory(log);
    const button = page.getByRole('button', { name: 'Show more' });
    await userEvent.click(button);
    expect(more).toHaveBeenCalledOnce();
    const pressed = button.element();
    set({ status: 'more', entries: ROWS.slice(0, 1), hasMore: true });
    set({ status: 'more-failed', entries: ROWS.slice(0, 1), hasMore: true, message: 'Can’t reach Timefix.' });
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    // The same button, now Try again, still holds focus.
    expect(page.getByRole('button', { name: 'Try again' }).element()).toBe(pressed);
    expect(document.activeElement).toBe(pressed);
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    set({ status: 'more', entries: ROWS.slice(0, 1), hasMore: true });
    set({ status: 'ready', entries: ROWS, hasMore: false });
    await expect.poll(() => page.getByRole('button', { name: /Show more|Try again/ }).elements()).toHaveLength(0);
    const grid = firstGrid().element();
    await expect.poll(() => grid.contains(document.activeElement)).toBe(true);
  });

  it('hands focus to the table when Try again on a failed first page gives way to the rows', async () => {
    const { log, retry, set } = liveLog({
      status: 'failed',
      entries: [],
      hasMore: false,
      message: 'Can’t reach Timefix.',
    });
    await renderHistory(log);
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    set({ status: 'loading', entries: [], hasMore: false });
    set({ status: 'ready', entries: ROWS, hasMore: false });
    const grid = firstGrid();
    await expect.element(grid).toBeVisible();
    await expect.poll(() => grid.element().contains(document.activeElement)).toBe(true);
  });
});

describe('while the route loads', () => {
  it('draws Workspace changes as the loaded table, its columns in place, with no tabs', async () => {
    shown = await renderInApp(() => <HistoryPending body={<WorkspaceChangesPending />} />, {
      data,
      pattern: '/w/$slug/settings/history/changes',
      at: '/w/acme/settings/history/changes',
    });
    await expect.element(page.getByRole('grid', { name: 'Workspace changes' })).toBeInTheDocument();
    expect(
      page
        .getByRole('columnheader')
        .elements()
        .map((cell) => cell.textContent),
    ).toEqual(['Who', 'Change', 'When']);
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
  });
});

describe('accessibility', () => {
  it.each([1280, 375])('passes axe in light and dark at %i wide', async (width) => {
    await page.viewport(width, 800);
    await renderHistory(logIn({ status: 'ready', entries: ROWS, hasMore: true }).log);
    await expect.element(firstGrid()).toBeVisible();
    expect(await axeBothThemes()).toEqual([]);
  });
});
