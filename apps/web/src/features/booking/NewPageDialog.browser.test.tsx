// New booking page in Chromium (spec 0058; the bookings area, 4 November 2026): a title, the type as a short list
// (Just me chosen, Round robin, A page each under More types) and a length; Create page makes the page as a draft on
// the default schedule (AC-17) and goes straight on to its editor, where Publish puts it live. No workspace or team
// link among the types, and nothing shown turned off. Axe clean in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import type { BookingPageView, DataLayer, MemberSummary, RotationView } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { NewPageDialog } from './NewPageDialog.tsx';
import { strings as rotationStrings } from './rotation-strings.ts';
import { strings } from './strings.ts';
import { managedStrings } from './managed-strings.ts';

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

const MADE = {
  id: '0199a6f2-0000-7000-8000-0000000000p1',
  title: 'Intro call',
  slug: 'intro-call',
  description: '',
  durations: [45],
  location: { type: 'video' },
  status: 'live',
  isPrivate: false,
  kind: 'personal',
  scope: 'member',
  publicKey: 'k3x9k3x9k3x9k3x9',
  canChange: true,
  bookingsThisMonth: 0,
  scheduleId: null,
  updatedAt: '2026-10-31T09:00:00.000Z',
} as unknown as BookingPageView;

const MADE_GROUP = '0199a6f2-0000-7000-8000-0000000000g1';
const TEAM: readonly MemberSummary[] = [
  { id: '0199a6f2-0000-7000-8000-0000000000a1', name: 'Brij Raj', email: 'brij@acme.dev' },
  { id: '0199a6f2-0000-7000-8000-0000000000a2', name: 'Grace Hopper', email: 'grace@acme.dev' },
];

async function render(
  rotationList: readonly RotationView[] = [],
  options: { readonly managed?: boolean; readonly people?: readonly MemberSummary[] } = {},
) {
  const create = vi.fn(() => Promise.resolve(MADE));
  const createGroup = vi.fn(() => Promise.resolve({ id: MADE_GROUP } as RotationView));
  const data = {
    preferences: { of: () => held({ status: 'loading' as const }) },
    rotations: {
      view: () => held({ status: 'ready' as const, items: rotationList, pendingIds: new Set<string>() }),
      newId: () => MADE_GROUP,
      create: createGroup,
    },
    members: { list: () => Promise.resolve(options.people ?? TEAM) },
    bookingPages: { newId: () => MADE.id, create },
    // The dialog mints a managed page's id up front, whether or not it offers the choice (no `onManaged` here).
    managedPages: { newId: () => '0199a6f2-0000-7000-8000-00000000mp01' },
  } as unknown as DataLayer;
  const onCreated = vi.fn();
  shown = await renderInApp(
    () => (
      <NewPageDialog
        data={data}
        slug="acme"
        canBookTeams
        isOpen
        onClose={() => undefined}
        onCreated={onCreated}
        {...(options.managed === true ? { onManaged: () => undefined } : {})}
      />
    ),
    { data, pattern: '/w/$slug/captures/links', at: '/w/acme/captures/links' },
  );
  return { create, createGroup, onCreated };
}

/** Axe in both themes, with every entrance settled first. */
async function checkThemes(name: string) {
  for (const theme of THEMES) {
    applyTheme(theme);
    for (const animation of document.getAnimations()) animation.finish();
    expect(await axeViolations(), `${name} in ${theme}`).toEqual([]);
  }
}

describe('New booking page', () => {
  it('asks for a title, a type and a length, and makes a draft on the default schedule (AC-17)', async () => {
    const { create, onCreated } = await render();
    const dialog = page.getByRole('dialog', { name: strings.addPage });
    await expect.element(dialog.getByRole('textbox', { name: strings.title })).toHaveFocus();
    // Just me is chosen; Round robin is the one other type, each with one plain line.
    await expect.element(dialog.getByRole('radio', { name: new RegExp(strings.typeMe) })).toBeChecked();
    await expect.element(dialog.getByRole('radio', { name: new RegExp(strings.typeRoundRobin) })).not.toBeChecked();
    await expect.element(dialog.getByText(strings.typeRoundRobinLine)).toBeVisible();
    // Links aren't page types any more, and nothing is offered turned off.
    expect(dialog.getByText(/Workspace link|Team link/).elements()).toHaveLength(0);
    expect(dialog.getByRole('radio', { disabled: true }).elements()).toHaveLength(0);
    // No schedule to pick: the page follows the default.
    expect(dialog.getByText('Schedule', { exact: true }).elements()).toHaveLength(0);
    await checkThemes('new-page');
    await userEvent.fill(dialog.getByRole('textbox', { name: strings.title }), 'Intro call');
    await userEvent.click(dialog.getByRole('radio', { name: strings.minutesShort(45) }), { force: true });
    await userEvent.click(dialog.getByRole('button', { name: strings.createPage }));
    expect(create).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({
        title: 'Intro call',
        isDraft: true,
        settings: { durations: [45], scheduleId: null },
      }),
    );
    // Straight on to the editor: no Ready panel, the live moment comes with Publish.
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(MADE));
  });

  it('keeps A page each under More types, offered only where managed pages can be made', async () => {
    await render([], { managed: true });
    const dialog = page.getByRole('dialog', { name: strings.addPage });
    expect(dialog.getByRole('radio', { name: new RegExp(managedStrings.bookManaged) }).elements()).toHaveLength(0);
    await userEvent.click(dialog.getByRole('button', { name: strings.moreTypes }));
    const managed = dialog.getByRole('radio', { name: new RegExp(managedStrings.bookManaged) });
    await expect.element(managed).toBeInTheDocument();
    // The panel is still opening: settle it, so the press lands on the tile rather than where it was.
    for (const animation of document.getAnimations()) animation.finish();
    await userEvent.click(managed, { force: true });
    await expect.element(managed).toBeChecked();
    // A managed page takes its lengths in its own editor.
    await expect.element(dialog.getByRole('radiogroup', { name: strings.duration })).not.toBeInTheDocument();
    await checkThemes('more-types');
  });

  it('with no group yet, asks who is on it here, and makes the group from them with the page', async () => {
    const { create, createGroup } = await render();
    await userEvent.fill(page.getByRole('textbox', { name: strings.title }), 'Team Link');
    await userEvent.click(page.getByRole('radio', { name: new RegExp(strings.typeRoundRobin) }), { force: true });
    await expect.element(page.getByText(strings.peopleLine)).toBeVisible();
    await checkThemes('people-here');
    // Fewer than two is said on the picker, and nothing is made.
    await userEvent.click(page.getByRole('button', { name: strings.createPage }));
    await expect.element(page.getByText(rotationStrings.needTwo)).toBeVisible();
    expect(createGroup).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: new RegExp(rotationStrings.people) }));
    await userEvent.click(page.getByRole('option', { name: /Brij Raj/ }));
    await userEvent.click(page.getByRole('option', { name: /Grace Hopper/ }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(page.getByRole('button', { name: strings.createPage }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(createGroup).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({
        id: MADE_GROUP,
        settings: expect.objectContaining({ name: 'Team Link', strategy: 'fair' }) as unknown,
        members: TEAM.map((person) => expect.objectContaining({ memberId: person.id, isOn: true }) as unknown),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ kind: 'round_robin', hosts: { fixed: [], rotations: [MADE_GROUP] } }),
    );
  });

  it('alone in the workspace, says round robin needs teammates, with the way to invite them', async () => {
    await render([], { people: [{ id: '0199a6f2-0000-7000-8000-0000000000a1', name: 'Brij Raj' }] });
    await userEvent.click(page.getByRole('radio', { name: new RegExp(strings.typeRoundRobin) }), { force: true });
    await expect.element(page.getByText(strings.needsTeammates)).toBeVisible();
    await expect.element(page.getByRole('link', { name: new RegExp(strings.inviteTeammates) })).toBeVisible();
    await checkThemes('needs-teammates');
  });

  it('books the workspace’s only round robin group without asking to pick it', async () => {
    const SALES = {
      id: '0199a6f2-0000-7000-8000-0000000000r1',
      name: 'Sales team',
      strategy: 'fair',
      windowDays: 30,
      pages: 0,
    } as unknown as RotationView;
    const { create } = await render([SALES]);
    await userEvent.fill(page.getByRole('textbox', { name: strings.title }), 'Sales intro');
    await userEvent.click(page.getByRole('radio', { name: new RegExp(strings.typeRoundRobin) }), { force: true });
    // The picker shows it chosen.
    await expect.element(page.getByLabelText(rotationStrings.rotation).getByText('Sales team')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: strings.createPage }));
    expect(page.getByText(rotationStrings.rotationRequired).elements()).toEqual([]);
    expect(create).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ kind: 'round_robin', isDraft: true, hosts: { fixed: [], rotations: [SALES.id] } }),
    );
  });
});
