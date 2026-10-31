// The workspace link's screens in Chromium (30 Oct 2026): Booking pages › New offers "Workspace link" to an admin as
// one of three cards and makes it with no schedule or rotation to pick; Captures › Links puts the workspace's own
// links in a Workspace group ahead of members' pages, and stays one ungrouped grid without any; the link's Hosts
// lead with one switch for everyone, including people who join later; the roster rotation's dialog lists everyone
// with their switches and no Add or Remove. Each is axe clean at 390 and 1280, in light and dark. With
// `VITE_WSLINK_SHOTS` set to a folder, each state is also saved there as a screenshot.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import type { BookingPageView, DataLayer, MemberSummary, RotationView } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { HostsCard } from './HostsCard.tsx';
import { LinksScreen } from './LinksScreen.tsx';
import { NewPageDialog } from './NewPageDialog.tsx';
import { RotationDialog } from './RotationDialog.tsx';
import { strings as rotationStrings } from './rotation-strings.ts';
import { strings } from './strings.ts';

const SHOTS: string | undefined = import.meta.env.VITE_WSLINK_SHOTS as string | undefined;
const WIDTHS = [390, 1280] as const;

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** A held list that never changes. */
function held<T>(state: T) {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: vi.fn(),
  };
}

/** A booking page as the list holds it. */
function pageOf(id: string, title: string, over: Partial<BookingPageView> = {}): BookingPageView {
  return {
    id,
    title,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    description: '',
    durations: [30],
    location: { type: 'video' },
    status: 'live',
    isPrivate: false,
    kind: 'personal',
    scope: 'member',
    publicKey: `key${id}`.padEnd(16, 'x'),
    canChange: true,
    bookingsThisMonth: 0,
    scheduleId: null,
    ...over,
  } as unknown as BookingPageView;
}

const PEOPLE: readonly MemberSummary[] = ['Ada Lovelace', 'Maya Patel', 'Sam Lee', 'Kim Park', 'Lee Chan'].map(
  (name, index) => ({
    id: `0199a6f2-0000-7000-8000-00000000000${String(index)}`,
    name,
    email: `p${String(index)}@acme.dev`,
  }),
);

/** "Everyone on the roster", Kim switched off. */
const ROSTER: RotationView = {
  id: '0199a6f2-0000-7000-8000-0000000000e1',
  follows: 'everyone',
  name: 'Everyone on the roster',
  strategy: 'fair',
  windowDays: 30,
  evenGap: 3,
  returning: 'owner',
  pages: 1,
  canChange: true,
  createdAt: '2026-10-30T09:00:00.000Z',
  updatedAt: '2026-10-30T09:00:00.000Z',
  members: PEOPLE.map((person) => ({
    memberId: person.id,
    name: person.name,
    weight: 100,
    priority: 2,
    dailyCap: null,
    weeklyCap: null,
    isOn: person.name !== 'Kim Park',
    hasCalendar: person.name !== 'Lee Chan',
    count: 2,
    upcoming: 0,
  })),
};

/** Axe in both themes at both widths, and a screenshot of each when asked. */
async function checkEverywhere(name: string, target: () => HTMLElement | null = () => document.body) {
  for (const width of WIDTHS) {
    await page.viewport(width, 900);
    for (const theme of THEMES) {
      applyTheme(theme);
      // A dialog still growing in reads as faded: settle every animation before axe measures contrast and size.
      for (const animation of document.getAnimations()) animation.finish();
      expect(await axeViolations(), `${name} at ${String(width)} in ${theme}`).toEqual([]);
      const element = target();
      if (SHOTS !== undefined && element !== null) {
        await page.screenshot({ path: `${SHOTS}/${name}-${String(width)}-${theme}.png`, element });
      }
    }
  }
}

describe('Booking pages › New: Everyone on the roster', () => {
  it('makes a workspace link, with no schedule or group to pick', async () => {
    const create = vi.fn(() =>
      Promise.resolve(pageOf('n1', 'Talk to us', { kind: 'round_robin', scope: 'workspace' })),
    );
    const rotations = held({ status: 'ready' as const, items: [] as RotationView[], pendingIds: new Set<string>() });
    const data = {
      preferences: { of: () => held({ status: 'loading' as const }) },
      schedules: { view: () => held({ status: 'ready' as const, schedules: [] }) },
      rotations: { view: () => rotations },
      bookingPages: { newId: () => '0199a6f2-0000-7000-8000-0000000000p1', create },
    } as unknown as DataLayer;
    const onCreated = vi.fn();
    shown = await renderInApp(
      () => (
        <NewPageDialog data={data} slug="acme" canBookTeams isOpen onClose={() => undefined} onCreated={onCreated} />
      ),
      { data, pattern: '/w/$slug/captures/links', at: '/w/acme/captures/links' },
    );
    await userEvent.fill(page.getByRole('textbox', { name: strings.title }), 'Talk to us');
    await userEvent.click(page.getByRole('radio', { name: new RegExp(rotationStrings.bookEveryone) }), { force: true });
    await expect.element(page.getByRole('radio', { name: new RegExp(rotationStrings.bookEveryone) })).toBeChecked();
    // No help lines under the choices (spec 0058, AC-3): what each means is in the tip.
    expect(page.getByText(/on nobody’s profile/).elements()).toHaveLength(0);
    // Nothing else to choose: the hosts are the workspace's, each booked by their own hours.
    expect(page.getByRole('button', { name: new RegExp(rotationStrings.rotation) }).elements()).toHaveLength(0);
    expect(page.getByText('Schedule', { exact: true }).elements()).toHaveLength(0);
    await checkEverywhere('new-everyone', () => document.querySelector('[role="dialog"]'));
    await userEvent.click(page.getByRole('button', { name: strings.createPage }));
    // The Ready panel first (spec 0058, AC-5); Edit page goes on to the editor.
    await userEvent.click(page.getByRole('button', { name: strings.readyEdit }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ kind: 'round_robin', scope: 'workspace', settings: { durations: [30] } }),
    );
    // "Everyone on the roster" was made with the first link: the held groups read it.
    expect(rotations.reload).toHaveBeenCalled();
  });
});

describe('Captures › Links: the Workspace group', () => {
  const render = async (pages: readonly BookingPageView[]) => {
    const data = {
      bookingPages: { view: () => held({ status: 'ready' as const, items: pages, pendingIds: new Set<string>() }) },
    } as unknown as DataLayer;
    shown = await renderInApp(
      () => (
        <main>
          <h1 tabIndex={-1}>Captures</h1>
          <LinksScreen data={data} slug="acme" />
        </main>
      ),
      { data, pattern: '/w/$slug/captures/links', at: '/w/acme/captures/links' },
    );
  };

  it('puts the workspace’s links first, under their own heading, then members’ pages', async () => {
    await render([
      pageOf('1', 'Intro call'),
      pageOf('2', 'Talk to us', { kind: 'round_robin', scope: 'workspace' }),
      pageOf('3', 'Demo', { kind: 'round_robin' }),
    ]);
    const headings = page
      .getByRole('heading', { level: 2 })
      .elements()
      .map((each) => each.textContent);
    expect(headings.slice(0, 2)).toEqual([strings.workspaceGroup, strings.membersGroup]);
    const workspace = page.getByRole('list', { name: strings.workspaceGroup });
    await expect.element(workspace.getByRole('heading', { level: 3, name: 'Talk to us' })).toBeVisible();
    await expect.element(workspace.getByText(strings.workspaceLink, { exact: false })).toBeVisible();
    expect(page.getByRole('list', { name: strings.membersGroup }).getByRole('listitem').elements()).toHaveLength(2);
    await checkEverywhere('links-grouped');
  });

  it('shows a member the workspace link to copy and open, with no editor, switch or menu', async () => {
    await render([
      pageOf('1', 'Intro call'),
      pageOf('2', 'Talk to us', { kind: 'round_robin', scope: 'workspace', canChange: false }),
    ]);
    const workspace = page.getByRole('list', { name: strings.workspaceGroup });
    await expect.element(workspace.getByText(strings.viewOnly)).toBeVisible();
    expect(workspace.getByRole('link', { name: 'Talk to us' }).elements()).toHaveLength(0);
    expect(workspace.getByRole('switch').elements()).toHaveLength(0);
    expect(workspace.getByRole('button', { name: strings.more('Talk to us') }).elements()).toHaveLength(0);
    await expect.element(workspace.getByRole('button', { name: /Copy link/ })).toBeVisible();
    await expect.element(workspace.getByRole('button', { name: strings.openPage('Talk to us') })).toBeVisible();
    await checkEverywhere('links-member');
  });

  it('stays one grid with no headings while the workspace has no link of its own', async () => {
    await render([pageOf('1', 'Intro call'), pageOf('3', 'Demo', { kind: 'round_robin' })]);
    expect(page.getByRole('heading', { level: 2, name: strings.workspaceGroup }).elements()).toHaveLength(0);
    expect(page.getByRole('heading', { level: 2, name: 'Intro call' }).elements()).toHaveLength(1);
  });
});

describe('Everyone on the roster: its dialog', () => {
  it('lists everyone with their own switches, with no Add or Remove, and sends only who changed', async () => {
    const update = vi.fn(() => Promise.resolve(ROSTER));
    const data = { rotations: { newId: () => 'x', update, create: vi.fn() } } as unknown as DataLayer;
    shown = await renderInApp(
      () => (
        <RotationDialog
          data={data}
          slug="acme"
          people={PEOPLE}
          rotation={ROSTER}
          isOpen
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      ),
      { data, pattern: '/w/$slug/bookings/round-robin', at: '/w/acme/bookings/round-robin' },
    );
    // The count on the dialog's Members row; the table waits in the drawer (spec 0058, AC-12).
    await expect.element(page.getByText(rotationStrings.rosterNote(4, 5))).toBeVisible();
    expect(page.getByRole('row').elements()).toHaveLength(0);
    await checkEverywhere('roster-dialog', () => document.querySelector('[role="dialog"]'));
    await userEvent.click(page.getByRole('button', { name: rotationStrings.editMembersFor(ROSTER.name) }));
    const drawer = page.getByRole('dialog', { name: rotationStrings.members(ROSTER.name) });
    await expect.element(drawer).toBeVisible();
    expect(drawer.getByRole('button', { name: new RegExp(rotationStrings.addMember) }).elements()).toHaveLength(0);
    expect(drawer.getByRole('row').elements()).toHaveLength(PEOPLE.length + 1);
    await checkEverywhere('roster-drawer', () => document.querySelector('[role="dialog"]'));
    // Kim back on, then Done and Save: only Kim is sent.
    const kim = PEOPLE[3];
    const kimSwitch = drawer.getByRole('switch').elements()[3];
    if (kim === undefined || kimSwitch === undefined) throw new Error('Kim’s row is missing.');
    await userEvent.click(kimSwitch, { force: true });
    await userEvent.click(drawer.getByRole('button', { name: rotationStrings.done }));
    // Back on the row that opened it.
    await expect.element(page.getByRole('button', { name: rotationStrings.editMembersFor(ROSTER.name) })).toHaveFocus();
    await userEvent.click(page.getByRole('button', { name: rotationStrings.save }));
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(
      'acme',
      ROSTER.id,
      expect.objectContaining({ members: [expect.objectContaining({ memberId: kim.id, isOn: true })] }),
    );
  });
});

describe('A workspace link’s Hosts', () => {
  it('leads with one switch for everyone, including people who join later; off, the pickers', async () => {
    const link = pageOf('w1', 'Talk to us', {
      kind: 'round_robin',
      scope: 'workspace',
      hosts: { fixed: [], rotations: [ROSTER.id] },
    });
    const update = vi.fn(() => Promise.resolve(link));
    const data = { bookingPages: { update } } as unknown as DataLayer;
    shown = await renderInApp(
      () => (
        <HostsCard
          data={data}
          slug="acme"
          page={link}
          people={PEOPLE}
          rotations={[ROSTER]}
          isLocked={false}
          rescheduleHost="same"
          onRescheduleChange={() => undefined}
          onSaved={() => undefined}
        />
      ),
      { data, pattern: '/w/$slug/captures/links/$pageId', at: '/w/acme/captures/links/w1' },
    );
    const everyone = page.getByRole('switch', { name: rotationStrings.everyoneSwitch });
    await expect.element(everyone).toBeChecked();
    expect(page.getByText(rotationStrings.addFixed).elements()).toHaveLength(0);
    await checkEverywhere('hosts-everyone');
    // Off: nothing is saved until a group is picked; the pickers show.
    await userEvent.click(everyone, { force: true });
    await expect.element(page.getByText(rotationStrings.addFixed).first()).toBeVisible();
    expect(update).not.toHaveBeenCalled();
    await checkEverywhere('hosts-picked');
  });
});
