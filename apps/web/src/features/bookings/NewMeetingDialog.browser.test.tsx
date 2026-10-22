// New meeting (spec 0027, AC-709 to AC-711), in Chromium: the day moves in place rather than asking the member to
// close the dialog and draw again (the design pass of 22 October 2026), the note that nobody is invited yet comes
// first, and the guest's zone sits with who it is with.
import type {
  BookingPageView,
  CalendarListState,
  CalendarsHeld,
  PageDestinationState,
  RecordSearch,
  RecordSearchState,
  SearchResult,
} from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { NewMeetingDialog, type NewMeeting, type NewMeetingDialogProps } from './NewMeetingDialog.tsx';
import type { DrawnSpan } from './span.ts';

const intro = { id: '0190f0f0-0000-7000-8000-000000000002', title: 'Intro call' } as BookingPageView;

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

const PEOPLE = '0190f0f0-0000-7000-8000-0000000000a1';

/** A person as the record search answers one: their chip, and their first email when they have one. */
const person = (id: string, name: string, email?: string): SearchResult => ({
  ref: { objectId: PEOPLE, recordId: `0190f0f0-0000-7000-8000-0000000001${id}`, name, kind: 'person' },
  linked: false,
  ...(email === undefined ? {} : { detail: email }),
});

/** A search over People that answers each query at once, as the data layer's does once its answer is in. */
function peopleSearch(people: readonly SearchResult[]): RecordSearch {
  let state: RecordSearchState = { query: '', status: 'idle', results: [] };
  const listeners = new Set<() => void>();
  return {
    ask: (asked) => {
      const query = asked.trim();
      if (query === state.query) return;
      const lower = query.toLowerCase();
      state = { query, status: 'ready', results: people.filter((each) => each.ref.name.toLowerCase().includes(lower)) };
      queueMicrotask(() => {
        for (const listener of listeners) listener();
      });
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resultOf: () => undefined,
    dispose: () => undefined,
  };
}

const WORK = '0190f0f0-0000-7000-8000-0000000000c1';
const TEAM = '0190f0f0-0000-7000-8000-0000000000c2';
const HOLIDAYS = '0190f0f0-0000-7000-8000-0000000000c3';

/** One Google account: Work (the default), Team (shared, writable) and Holidays (read only). */
function calendarsOf(names: readonly ('Work' | 'Team' | 'Holidays')[]): CalendarListState {
  const all = [
    { id: WORK, name: 'Work', canBeDestination: true, isDestination: true, hue: 'blue' },
    { id: TEAM, name: 'Team', canBeDestination: true, isDestination: false, hue: 'green' },
    { id: HOLIDAYS, name: 'Holidays', canBeDestination: false, isDestination: false, hue: 'orange' },
  ];
  return {
    status: 'ready',
    enabled: true,
    providers: ['google'],
    max: 5,
    destinationId: WORK,
    accounts: [
      {
        id: '0190f0f0-0000-7000-8000-0000000000b1',
        provider: 'google',
        accountEmail: 'ada@acme.dev',
        calendars: all.filter((calendar) => names.includes(calendar.name as 'Work' | 'Team' | 'Holidays')),
      },
    ],
  } as unknown as CalendarListState;
}

/** A page's own "Add events to", already read: one held read with one snapshot, as the data layer keeps them. */
function pageCalendar(calendarId: string | undefined): CalendarsHeld<PageDestinationState> {
  const snapshot: PageDestinationState = {
    status: 'ready',
    destination: {
      ...(calendarId === undefined ? {} : { calendarId }),
      status: calendarId === undefined ? 'default' : 'page',
      isOwner: true,
    },
  };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    reload: () => undefined,
  };
}

/** The dialog open on Friday 23 October, 9:30 to 10:15, with no calendar connected unless calendars are given. */
async function open(more: Partial<NewMeetingDialogProps> = {}) {
  const onSpanChange = vi.fn<(span: DrawnSpan) => void>();
  const onBook = vi.fn<(meeting: NewMeeting) => Promise<void>>(() => Promise.resolve());
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-GB" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
        <NewMeetingDialog
          span={{ dayKey: '2026-10-23', startMinute: 9 * 60 + 30, endMinute: 10 * 60 + 15 }}
          onSpanChange={onSpanChange}
          locale="en-GB"
          hasCalendar={more.calendars !== undefined}
          pages={[intro]}
          newKey={() => 'key'}
          onBook={onBook}
          onClose={() => undefined}
          {...more}
        />
      </UiProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { onSpanChange, onBook };
}

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('New meeting', () => {
  it('moves the day in place, keeping the times', async () => {
    const { onSpanChange } = await open();
    const day = page.getByRole('group', { name: 'Day' });
    await expect.element(day).toBeVisible();
    // The day segment (first in en-GB), then Up: the next day, the same times.
    const [daySegment] = day.getByRole('spinbutton').elements();
    if (daySegment === undefined) throw new Error('no day segment');
    await userEvent.click(daySegment);
    await userEvent.keyboard('{ArrowUp}');
    expect(onSpanChange).toHaveBeenLastCalledWith({ dayKey: '2026-10-24', startMinute: 570, endMinute: 615 });
  });

  it('says nobody is invited yet before the fields, and keeps their zone with who it is with', async () => {
    await open();
    const note = page.getByText(/No calendar is connected/).element();
    const name = page.getByRole('textbox', { name: 'With' }).element();
    const email = page.getByRole('textbox', { name: 'Email' }).element();
    const zone = page.getByRole('button', { name: /Their time zone/ }).element();
    const day = page.getByRole('group', { name: 'Day' }).element();
    expect(before(note, name)).toBe(true);
    expect(before(email, zone)).toBe(true);
    expect(before(zone, day)).toBe(true);
    // The name is still where typing starts.
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveFocus();
  });

  it('offers People as With is typed, and a pick fills the name and email without booking', async () => {
    const { onBook } = await open({
      people: () =>
        peopleSearch([
          person('01', 'Grace Hopper', 'grace@navy.example'),
          person('02', 'Grace Lee', 'grace.lee@acme.example'),
          // Nobody to invite at no address: left out.
          person('03', 'Grace Unknown'),
        ]),
    });
    await userEvent.keyboard('gra');
    const list = page.getByRole('listbox', { name: 'People' });
    await expect.element(list).toBeVisible();
    // Each with their email beside the name; the one with none isn't offered.
    const offered = list.getByRole('option').elements();
    expect(offered).toHaveLength(2);
    expect(offered[0]?.textContent).toContain('Grace Hoppergrace@navy.example');
    expect(offered[1]?.textContent).toContain('Grace Leegrace.lee@acme.example');
    // Nothing is highlighted until the arrows move: Enter alone would still book.
    const name = page.getByRole('textbox', { name: 'With' });
    await expect.element(name).not.toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(name).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    await expect.element(name).toHaveValue('Grace Hopper');
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveValue('grace@navy.example');
    await expect.element(page.getByRole('listbox', { name: 'People' })).not.toBeInTheDocument();
    expect(onBook).not.toHaveBeenCalled();
  });

  it('puts the list away on Esc and keeps the dialog', async () => {
    await open({ people: () => peopleSearch([person('01', 'Grace Hopper', 'grace@navy.example')]) });
    await userEvent.keyboard('gr');
    await expect.element(page.getByRole('listbox', { name: 'People' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('listbox', { name: 'People' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('dialog', { name: 'New meeting' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveValue('gr');
  });

  it('adds each guest as a chip with Enter, and books them all', async () => {
    const { onBook } = await open();
    await userEvent.fill(page.getByRole('textbox', { name: 'With' }), 'Grace Hopper');
    await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'grace@navy.example');
    const add = page.getByRole('textbox', { name: 'Also invite' });
    await userEvent.click(add);
    await userEvent.keyboard('alan@bletchley.example{Enter}');
    await userEvent.keyboard('kat@nasa.example{Enter}');
    // Enter adds the address, and never books on its way.
    expect(onBook).not.toHaveBeenCalled();
    const chips = page.getByRole('list', { name: 'Also invite' });
    await expect.element(chips).toBeVisible();
    expect(
      chips
        .getByRole('listitem')
        .elements()
        .map((chip) => chip.textContent),
    ).toEqual(['alan@bletchley.example', 'kat@nasa.example']);
    await userEvent.click(page.getByRole('button', { name: 'Remove alan@bletchley.example' }));
    await userEvent.click(page.getByRole('button', { name: /Book it/ }));
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ guests: ['kat@nasa.example'] }));
    expect(onBook.mock.calls[0]?.[0]).not.toHaveProperty('calendarId');
  });

  it('offers Calendar with two calendars that take events, starts on the page’s own, and sends only a pick', async () => {
    const teamPage = pageCalendar(TEAM);
    const { onBook } = await open({
      calendars: calendarsOf(['Work', 'Team', 'Holidays']),
      pageDestination: () => teamPage,
    });
    const calendar = page.getByRole('button', { name: /Calendar$/ });
    await expect.element(calendar).toHaveTextContent('Team');
    await userEvent.fill(page.getByRole('textbox', { name: 'With' }), 'Grace Hopper');
    await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'grace@navy.example');
    await userEvent.click(calendar);
    // Only calendars that take events: Holidays is read only.
    const options = page.getByRole('option');
    expect(options.elements().map((option) => option.textContent)).toEqual(['Work', 'Team']);
    await userEvent.click(page.getByRole('option', { name: 'Work' }));
    await userEvent.click(page.getByRole('button', { name: /Book it/ }));
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ calendarId: WORK }));
  });

  it('leaves Calendar out with one calendar that takes events', async () => {
    const ownless = pageCalendar(undefined);
    await open({ calendars: calendarsOf(['Work', 'Holidays']), pageDestination: () => ownless });
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveFocus();
    expect(page.getByRole('button', { name: /Calendar$/ }).elements()).toEqual([]);
  });
});
