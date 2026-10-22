// Settings › Profile, Pages on your profile (owner ask A102) in Chromium: every state (no handle, loading, failed with
// Try again, no Public pages, no access), the person's own Public pages under their sections in the profile's order,
// and the moves a menu makes: each sends the whole order, is said to screen readers, and a refusal says so once with
// a Try again that sends the order again, fitted to the pages there are now.
import {
  dataError,
  type BookingPageView,
  type CaptureListState,
  type CaptureListView,
  type DataLayer,
  type MyProfile,
} from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ProfilePagesSection } from './ProfilePagesSection.tsx';

const ME = '0199f0a0-0000-7000-8000-0000000000aa';
const COLLEAGUE = '0199f0a0-0000-7000-8000-0000000000bb';
const id = (n: number) => `0199f0a0-0000-7000-8000-00000000000${String(n)}`;

const profile: MyProfile = {
  memberId: ME,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  workspaceTimeZone: 'Europe/London',
  handle: 'ada',
  bio: '',
};

/** A page with what the section reads; the rest is never looked at here. */
function pageOf(
  n: number,
  title: string,
  more: {
    readonly section?: string;
    readonly owner?: string;
    readonly isPrivate?: boolean;
    readonly paused?: boolean;
    readonly position?: number;
  } = {},
): BookingPageView {
  return {
    id: id(n),
    title,
    durations: [30],
    status: more.paused === true ? 'paused' : 'live',
    profileSection: more.section ?? null,
    profilePosition: more.position ?? n,
    ownerMemberId: more.owner ?? ME,
    isPrivate: more.isPrivate ?? false,
  } as BookingPageView;
}

/** Sales (Intro call, Product demo), then the pages with none (Coffee chat), then Support (Help session). */
const PAGES: readonly BookingPageView[] = [
  pageOf(1, 'Intro call', { section: 'Sales' }),
  pageOf(2, 'Coffee chat'),
  pageOf(3, 'Product demo', { section: 'Sales' }),
  pageOf(4, 'Help session', { section: 'Support', paused: true }),
  pageOf(5, 'Private chat', { isPrivate: true }),
  pageOf(6, 'Bea’s call', { owner: COLLEAGUE, section: 'Sales' }),
];

/** A held list in this state, which a test may change as the store would. */
function viewOf(state: CaptureListState<BookingPageView>) {
  let snapshot = state;
  const listeners = new Set<() => void>();
  const reload = vi.fn();
  const view: CaptureListView<BookingPageView> = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload,
  };
  const change = (next: CaptureListState<BookingPageView>) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return { view, change, reload };
}

const ready = (items: readonly BookingPageView[]): CaptureListState<BookingPageView> => ({
  status: 'ready',
  items,
  pendingIds: new Set(),
});

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The section for `who`, over a held list in `state`, with `reorderProfile` answering as the test says. */
async function renderSection({
  state = ready(PAGES),
  who = profile,
  permissions = ['booking.manage'],
  reorderProfile = vi.fn(() => Promise.resolve('saved' as const)),
}: {
  readonly state?: CaptureListState<BookingPageView>;
  readonly who?: MyProfile;
  readonly permissions?: readonly string[];
  readonly reorderProfile?: (workspace: string, pageIds: readonly string[]) => Promise<'saved' | 'replaced'>;
} = {}) {
  const { view, change, reload } = viewOf(state);
  const data = { bookingPages: { view: () => view, reorderProfile } } as unknown as DataLayer;
  shown = await renderInApp(() => <ProfilePagesSection data={data} slug="acme" profile={who} />, {
    data,
    pattern: '/w/$slug/settings/account/profile',
    at: '/w/acme/settings/account/profile',
    permissions,
  });
  return { change, reload, reorderProfile };
}

const headings = () => [...document.querySelectorAll('h2, h3, h4')].map((heading) => heading.textContent);
const statusText = () =>
  [...document.querySelectorAll('[role="status"]')].map((region) => region.textContent).join(' ');

describe('Pages on your profile', () => {
  it('lists my Public pages under their sections, in the profile’s order, with View profile', async () => {
    await renderSection();
    await expect.poll(headings).toEqual(['Pages on your profile', 'Sales', 'No section', 'Support']);
    // The rows come with the drag wrapper, which loads on demand.
    await expect.poll(() => document.querySelectorAll('[role="row"]').length).toBe(4);
    const rows = [...document.querySelectorAll('[role="row"]')].map((row) => row.textContent);
    expect(rows[0]).toContain('Intro call');
    expect(rows[1]).toContain('Product demo');
    expect(rows[3]).toContain('Paused');
    expect(document.body.textContent).not.toContain('Private chat');
    expect(document.body.textContent).not.toContain('Bea’s call');
    const view = page.getByRole('link', { name: 'View profile' }).element();
    expect(view.getAttribute('href')).toMatch(/\/ada$/);
    expect(view.getAttribute('target')).toBe('_blank');
  });

  it('moves a page within its section from its menu, sends the whole order and says where it went', async () => {
    const { reorderProfile } = await renderSection();
    await userEvent.click(page.getByRole('button', { name: 'More for Intro call' }));
    await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
    expect(page.getByRole('menuitem', { name: 'Move up' }).query()).toBeNull();
    await userEvent.click(page.getByRole('menuitem', { name: 'Move down' }));
    expect(reorderProfile).toHaveBeenCalledWith('acme', [id(3), id(1), id(2), id(4)]);
    await expect.poll(statusText).toContain('Intro call, moved to position 2 of 2.');
  });

  it('moves a whole section from its menu, its pages with it', async () => {
    const { reorderProfile } = await renderSection();
    await userEvent.click(page.getByRole('button', { name: 'Support options' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Move up' }));
    expect(reorderProfile).toHaveBeenCalledWith('acme', [id(1), id(3), id(4), id(2)]);
    await expect.poll(statusText).toContain('Support, moved to position 2 of 3.');
  });

  it('gives a page alone in its section no grip or moves, only Change section, which opens its editor', async () => {
    await renderSection({ state: ready([pageOf(1, 'Intro call'), pageOf(2, 'Coffee chat', { section: 'Sales' })]) });
    await expect.poll(headings).toEqual(['Pages on your profile', 'No section', 'Sales']);
    await expect.element(page.getByRole('button', { name: 'More for Intro call' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Move Intro call' }).query()).toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'More for Intro call' }));
    await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
    expect(page.getByRole('menuitem', { name: 'Move up' }).query()).toBeNull();
    expect(page.getByRole('menuitem', { name: 'Move down' }).query()).toBeNull();
    await userEvent.click(page.getByRole('menuitem', { name: 'Change section' }));
    await expect.poll(() => shown?.router.state.location.pathname).toBe(`/w/acme/captures/links/${id(1)}`);
  });

  it('gives one untitled section no grip or menu of its own', async () => {
    await renderSection({ state: ready([pageOf(1, 'Intro call'), pageOf(2, 'Coffee chat')]) });
    await expect.poll(headings).toEqual(['Pages on your profile']);
    expect(page.getByRole('button', { name: /section/ }).query()).toBeNull();
    expect(page.getByRole('button', { name: /options$/ }).query()).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Move Intro call' })).toBeInTheDocument();
  });

  it('says a refused move once, puts nothing back itself, and Try again sends the order fitted to the pages now', async () => {
    const reorderProfile = vi
      .fn<(workspace: string, pageIds: readonly string[]) => Promise<'saved' | 'replaced'>>()
      .mockRejectedValueOnce(dataError('INTERNAL', 'Something went wrong. Try again in a moment.'))
      .mockResolvedValue('saved');
    const { change, reload } = await renderSection({ reorderProfile });
    await userEvent.click(page.getByRole('button', { name: 'More for Product demo' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Move up' }));
    await expect.poll(() => shown?.toasts.queue.visibleToasts.length).toBe(1);
    const [toast] = shown?.toasts.queue.visibleToasts ?? [];
    expect(toast?.content.tone).toBe('danger');
    expect(toast?.content.message).toBe(
      'The new order didn’t save, so it’s back as it was. Something went wrong. Try again in a moment.',
    );
    expect(reload).toHaveBeenCalledTimes(1);
    // Coffee chat was deleted elsewhere meanwhile, and a new page came.
    change(ready([...PAGES.filter((each) => each.id !== id(2)), pageOf(7, 'Workshop', { position: 9 })]));
    toast?.content.action?.onAction();
    expect(reorderProfile).toHaveBeenLastCalledWith('acme', [id(3), id(1), id(4), id(7)]);
  });
});

describe('Pages on your profile, its other states', () => {
  it('asks for a handle first, with no View profile', async () => {
    const { memberId, name, email, workspaceTimeZone, bio } = profile;
    await renderSection({ who: { memberId, name, email, workspaceTimeZone, bio } });
    await expect.element(page.getByText('Claim a handle first')).toBeInTheDocument();
    expect(page.getByRole('link', { name: 'View profile' }).query()).toBeNull();
  });

  it('shows the rows loading in their card', async () => {
    await renderSection({ state: { status: 'loading' } });
    await expect.poll(() => document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('says the pages didn’t load, and Try again reads them again', async () => {
    const { reload } = await renderSection({
      state: { status: 'error', error: dataError('INTERNAL', 'Something went wrong. Try again in a moment.') },
    });
    await expect.element(page.getByText('Your pages didn’t load')).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says there are no Public pages yet, and links to Links', async () => {
    await renderSection({ state: ready([pageOf(5, 'Private chat', { isPrivate: true })]) });
    await expect.element(page.getByText('No pages on your profile yet')).toBeInTheDocument();
    expect(page.getByRole('link', { name: 'Go to Links' }).element().getAttribute('href')).toContain(
      '/w/acme/captures/links',
    );
  });

  it('says so without booking access, and reads nothing', async () => {
    const view = vi.fn();
    const data = { bookingPages: { view, reorderProfile: vi.fn() } } as unknown as DataLayer;
    shown = await renderInApp(() => <ProfilePagesSection data={data} slug="acme" profile={profile} />, {
      data,
      pattern: '/w/$slug/settings/account/profile',
      at: '/w/acme/settings/account/profile',
      permissions: ['records.export'],
    });
    await expect.element(page.getByText('You can’t arrange booking pages here')).toBeInTheDocument();
    expect(view).not.toHaveBeenCalled();
  });
});
