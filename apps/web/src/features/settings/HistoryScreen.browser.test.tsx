// Settings › History in Chromium (spec 0046, AC-4600, AC-4601, AC-4604, AC-4615
// to AC-4619): an owner gets two tabs, a member none; Workspace changes as a
// member sends them on to Your sign ins; each state of the log says its words;
// a row is read as its whole sentence; and axe passes in light and dark at
// 1280 and 375 wide. Your sign ins sits a breath under the tabs, loading and
// loaded alike (Q96).
import '@crm/ui/styles.css';
import type { ActivityPage, AuditEntryView, AuditLog, AuditLogState, DataLayer } from '@crm/data';
import { isRedirect } from '@tanstack/react-router';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { Route as ChangesRoute } from '../../routes/w.$slug.settings.history.changes.tsx';
import { Route as HistoryIndexRoute } from '../../routes/w.$slug.settings.history.index.tsx';
import { HistoryPending, HistoryScreen } from './HistoryScreen.tsx';
import { SignInsPending, SignInsTab } from './SignInsTab.tsx';
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

const activity: ActivityPage = {
  items: [
    { id: '0199f0a0-0000-7000-8000-0000000000d1', at: new Date().toISOString(), kind: 'sign_in', method: 'email_code' },
  ],
};

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  delete document.documentElement.dataset.theme;
});

const data = { account: { activity: () => Promise.resolve(activity) } } as unknown as DataLayer;

async function renderHistory(tab: 'changes' | 'sign-ins', canReadChanges: boolean, body: ReactNode) {
  shown = await renderInApp(
    () => (
      <HistoryScreen slug="acme" tab={tab} canReadChanges={canReadChanges}>
        {body}
      </HistoryScreen>
    ),
    { data, pattern: `/w/$slug/settings/history/${tab}`, at: `/w/acme/settings/history/${tab}` },
  );
}

const signIns = () => <SignInsTab data={data} first={Promise.resolve(activity)} onRetry={() => undefined} />;

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

describe('the tabs (AC-4600, AC-4601)', () => {
  it('gives an owner both tabs, Workspace changes first', async () => {
    await renderHistory(
      'changes',
      true,
      <WorkspaceChangesTab log={logIn({ status: 'ready', entries: ROWS, hasMore: false }).log} />,
    );
    const tabs = page.getByRole('tab');
    await expect
      .poll(() => tabs.elements().map((tab) => tab.textContent))
      .toEqual(['Workspace changes', 'Your sign ins']);
    expect(page.getByRole('tab', { name: 'Workspace changes' }).element().getAttribute('aria-selected')).toBe('true');
  });

  it('puts Your sign ins a breath under the tab bar, loading and loaded alike (Q96)', async () => {
    const gap = () => {
      const heading = page.getByRole('heading', { name: 'Your sign ins' }).element().getBoundingClientRect();
      return heading.top - page.getByRole('tablist').element().getBoundingClientRect().bottom;
    };
    await renderHistory('sign-ins', true, signIns());
    await expect.poll(() => document.body.textContent).toContain('Signed in');
    const loaded = gap();
    expect(loaded).toBeGreaterThanOrEqual(16);
    shown?.unmount();
    shown = await renderInApp(() => <HistoryPending tab="sign-ins" canReadChanges body={<SignInsPending />} />, {
      data,
      pattern: '/w/$slug/settings/history/sign-ins',
      at: '/w/acme/settings/history/sign-ins',
    });
    await expect.element(page.getByRole('heading', { name: 'Your sign ins' })).toBeVisible();
    expect(Math.round(gap())).toBe(Math.round(loaded));
  });

  it('gives a member their sign ins with no tab bar', async () => {
    await renderHistory('sign-ins', false, signIns());
    await expect.poll(() => document.body.textContent).toContain('Signed in');
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
  });

  it('sends a member who opens Workspace changes on to Your sign ins, and opens History on the right tab', async () => {
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
      to: '/w/$slug/settings/history/sign-ins',
      replace: true,
    });
    expect(await thrown(() => changes(as(['audit.read'])))).toBeUndefined();
    const index = HistoryIndexRoute.options.beforeLoad as unknown as (input: unknown) => Promise<void>;
    const owner = await thrown(() => index(as(['audit.read'])));
    expect(isRedirect(owner) ? owner.options.to : undefined).toBe('/w/$slug/settings/history/changes');
    const reader = await thrown(() => index(as([])));
    expect(isRedirect(reader) ? reader.options.to : undefined).toBe('/w/$slug/settings/history/sign-ins');
  });
});

describe('Workspace changes', () => {
  it('reads each row as its whole sentence, with the actor in Who and the rest in Change', async () => {
    await renderHistory(
      'changes',
      true,
      <WorkspaceChangesTab log={logIn({ status: 'ready', entries: ROWS, hasMore: false }).log} />,
    );
    const table = page.getByRole('grid', { name: 'Workspace changes' });
    await expect.element(table).toBeVisible();
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

  it('shows Show more while more follow, and reads the next page', async () => {
    const { log, more } = logIn({ status: 'ready', entries: ROWS, hasMore: true });
    await renderHistory('changes', true, <WorkspaceChangesTab log={log} />);
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
    await renderHistory('changes', true, <WorkspaceChangesTab log={logIn(state).log} />);
    await expect.poll(() => document.body.textContent).toContain(words);
    if (state.status === 'ready') {
      expect(document.body.textContent).toContain(
        'Invitations, role changes, removals and changes to settings and scheduling show here.',
      );
    }
    if (state.status === 'forbidden') expect(page.getByRole('grid').elements()).toHaveLength(0);
  });

  it('says a failed first page with the layer’s words, and Try again reads it again', async () => {
    const { log, retry } = logIn({ status: 'failed', entries: [], hasMore: false, message: 'Can’t reach Timefix.' });
    await renderHistory('changes', true, <WorkspaceChangesTab log={log} />);
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
    await renderHistory('changes', true, <WorkspaceChangesTab log={log} />);
    await expect.poll(() => document.body.textContent).toContain('Couldn’t load more changes.');
    expect(page.getByRole('row').elements().length).toBeGreaterThan(2);
    expect(page.getByRole('button', { name: 'Show more' }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('Workspace changes, focus and layout', () => {
  it('runs Who, Change, then When', async () => {
    await renderHistory(
      'changes',
      true,
      <WorkspaceChangesTab log={logIn({ status: 'ready', entries: ROWS, hasMore: false }).log} />,
    );
    await expect.element(page.getByRole('grid', { name: 'Workspace changes' })).toBeVisible();
    expect(
      page
        .getByRole('columnheader')
        .elements()
        .map((cell) => cell.textContent),
    ).toEqual(['Who', 'Change', 'When']);
  });

  it('fits a phone with no sideways scroll, the sentence wrapping', async () => {
    await page.viewport(390, 800);
    await renderHistory(
      'changes',
      true,
      <WorkspaceChangesTab log={logIn({ status: 'ready', entries: ROWS, hasMore: false }).log} />,
    );
    const grid = page.getByRole('grid', { name: 'Workspace changes' });
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
    await renderHistory('changes', true, <WorkspaceChangesTab log={log} />);
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
    const grid = page.getByRole('grid', { name: 'Workspace changes' }).element();
    await expect.poll(() => grid.contains(document.activeElement)).toBe(true);
  });

  it('hands focus to the table when Try again on a failed first page gives way to the rows', async () => {
    const { log, retry, set } = liveLog({
      status: 'failed',
      entries: [],
      hasMore: false,
      message: 'Can’t reach Timefix.',
    });
    await renderHistory('changes', true, <WorkspaceChangesTab log={log} />);
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    set({ status: 'loading', entries: [], hasMore: false });
    set({ status: 'ready', entries: ROWS, hasMore: false });
    const grid = page.getByRole('grid', { name: 'Workspace changes' });
    await expect.element(grid).toBeVisible();
    await expect.poll(() => grid.element().contains(document.activeElement)).toBe(true);
  });
});

describe('while the route loads', () => {
  const pending = async (tab: 'changes' | 'sign-ins', canReadChanges: boolean, body: ReactNode) => {
    shown = await renderInApp(() => <HistoryPending tab={tab} canReadChanges={canReadChanges} body={body} />, {
      data,
      pattern: `/w/$slug/settings/history/${tab}`,
      at: `/w/acme/settings/history/${tab}`,
    });
  };

  it('draws the tab bar for an owner, its tabs disabled, with the named tab selected', async () => {
    await pending('sign-ins', true, <SignInsPending />);
    const tabs = page.getByRole('tab');
    await expect
      .poll(() => tabs.elements().map((tab) => tab.textContent))
      .toEqual(['Workspace changes', 'Your sign ins']);
    expect(tabs.elements().map((tab) => tab.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    expect(page.getByRole('tab', { name: 'Your sign ins' }).element().getAttribute('aria-selected')).toBe('true');
  });

  it('draws no tab bar for a member', async () => {
    await pending('sign-ins', false, <SignInsPending />);
    await expect.element(page.getByRole('heading', { name: 'Your sign ins' })).toBeVisible();
    expect(page.getByRole('tablist').elements()).toHaveLength(0);
  });

  it('heads Your sign ins as the loaded section does, so nothing changes when it arrives', async () => {
    await pending('sign-ins', false, <SignInsPending />);
    await expect.element(page.getByRole('heading', { name: 'Your sign ins' })).toBeVisible();
    expect(document.body.textContent).toContain('In every workspace, for the last 90 days.');
    expect(document.body.textContent).not.toContain('Recent activity');
    shown?.unmount();
    shown = undefined;
    await renderHistory('sign-ins', false, signIns());
    await expect.poll(() => document.body.textContent).toContain('Signed in');
    expect(page.getByRole('heading', { name: 'Your sign ins' }).elements()).toHaveLength(1);
    expect(document.body.textContent).toContain('In every workspace, for the last 90 days.');
    expect(document.body.textContent).not.toContain('Recent activity');
  });

  it('draws Workspace changes as the loaded table, its columns in place', async () => {
    await pending('changes', true, <WorkspaceChangesPending />);
    await expect.element(page.getByRole('grid', { name: 'Workspace changes' })).toBeInTheDocument();
    expect(
      page
        .getByRole('columnheader')
        .elements()
        .map((cell) => cell.textContent),
    ).toEqual(['Who', 'Change', 'When']);
  });
});

describe('accessibility', () => {
  it.each([1280, 375])('passes axe in light and dark at %i wide, for an owner and a member', async (width) => {
    await page.viewport(width, 800);
    await renderHistory(
      'changes',
      true,
      <WorkspaceChangesTab log={logIn({ status: 'ready', entries: ROWS, hasMore: true }).log} />,
    );
    await expect.element(page.getByRole('grid', { name: 'Workspace changes' })).toBeVisible();
    expect(await axeBothThemes()).toEqual([]);
    shown?.unmount();
    shown = undefined;
    await renderHistory('sign-ins', false, signIns());
    await expect.poll(() => document.body.textContent).toContain('Signed in');
    expect(await axeBothThemes()).toEqual([]);
  });
});
