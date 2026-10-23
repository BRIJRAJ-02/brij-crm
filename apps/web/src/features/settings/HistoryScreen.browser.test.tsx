// Settings › History in Chromium (spec 0046, AC-4600, AC-4601, AC-4604, AC-4615
// to AC-4619): an owner gets two tabs, a member none; Workspace changes as a
// member sends them on to Your sign ins; each state of the log says its words;
// a row is read as its whole sentence; and axe passes in light and dark at
// 1280 and 375 wide.
import type { ActivityPage, AuditEntryView, AuditLog, AuditLogState, DataLayer } from '@crm/data';
import { isRedirect } from '@tanstack/react-router';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { Route as ChangesRoute } from '../../routes/w.$slug.settings.history.changes.tsx';
import { Route as HistoryIndexRoute } from '../../routes/w.$slug.settings.history.index.tsx';
import { HistoryScreen } from './HistoryScreen.tsx';
import { SignInsTab } from './SignInsTab.tsx';
import { WorkspaceChangesTab } from './WorkspaceChangesTab.tsx';

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
    for (const animation of document.getAnimations()) animation.finish();
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
      'Only workspace owners and admins can read the audit log.',
    ],
  ] as const)('says its %s state', async (_name, state, words) => {
    await renderHistory('changes', true, <WorkspaceChangesTab log={logIn(state).log} />);
    await expect.poll(() => document.body.textContent).toContain(words);
    if (state.status === 'ready') {
      expect(document.body.textContent).toContain(
        'Invitations, role changes, removals and settings changes show here.',
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
