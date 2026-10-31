// New meeting (spec 0027, AC-709 to AC-711), in Chromium: the day moves in place rather than asking the member to
// close the dialog and draw again (the design pass of 22 October 2026), For first and the one line note that no
// calendar is connected before the guest (31 October 2026), and the guest's zone sits with who it is with.
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
const SHARED = '0190f0f0-0000-7000-8000-0000000000c4';

type Name = 'Work' | 'Team' | 'Holidays' | 'Shared';

/**
 * One Google account: Work (the main one and the default), Team (writable, checked for conflicts), Holidays (read
 * only) and Shared (writable, but nothing switched on: not in use, so the app never shows it).
 */
function calendarsOf(names: readonly Name[]): CalendarListState {
  const off = { isPrimary: false, checkConflicts: false, showInWeek: false, sync: false, isDestination: false };
  const all = [
    { ...off, id: WORK, name: 'Work', canBeDestination: true, isPrimary: true, isDestination: true, hue: 'blue' },
    { ...off, id: TEAM, name: 'Team', canBeDestination: true, checkConflicts: true, hue: 'green' },
    { ...off, id: HOLIDAYS, name: 'Holidays', canBeDestination: false, showInWeek: true, hue: 'orange' },
    { ...off, id: SHARED, name: 'Shared', canBeDestination: true, hue: 'purple' },
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
        calendars: all.filter((calendar) => names.includes(calendar.name as Name)),
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
    const note = page.getByText('Guest emailed only. No calendar event or video link.').element();
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

  it('takes the highlighted row on Tab and goes on to Email, filled with theirs', async () => {
    await open({ people: () => peopleSearch([person('01', 'Grace Hopper', 'grace@navy.example')]) });
    await userEvent.keyboard('gra');
    await expect.element(page.getByRole('listbox', { name: 'People' })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Tab}');
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveValue('Grace Hopper');
    const email = page.getByRole('textbox', { name: 'Email' });
    await expect.element(email).toHaveValue('grace@navy.example');
    await expect.element(email).toHaveFocus();
    await expect.element(page.getByRole('listbox', { name: 'People' })).not.toBeInTheDocument();
  });

  it('leaves a row under a resting pointer alone on Tab, and Shift+Tab picks nothing', async () => {
    await open({ people: () => peopleSearch([person('01', 'Grace Hopper', 'grace@navy.example')]) });
    await userEvent.keyboard('gra');
    const row = page.getByRole('option', { name: /Grace Hopper/ });
    await expect.element(row).toBeVisible();
    await userEvent.hover(row);
    // The pointer highlights it, as the arrows would.
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Tab}');
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveValue('gra');
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveValue('');
    await userEvent.click(page.getByRole('textbox', { name: 'With' }));
    await userEvent.keyboard('{ArrowDown}{Shift>}{Tab}{/Shift}');
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveValue('gra');
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

  it('refuses an 11th guest in the field, keeping what was typed', async () => {
    await open();
    const field = page.getByRole('textbox', { name: 'Also invite' });
    // Each address filled at once, then Enter: typing 11 addresses key by key outran the test's time on a busy CI.
    for (let index = 0; index < 10; index += 1) {
      await userEvent.fill(field, `g${String(index)}@navy.example`);
      await userEvent.keyboard('{Enter}');
    }
    expect(page.getByRole('list', { name: 'Also invite' }).getByRole('listitem').elements()).toHaveLength(10);
    await userEvent.fill(field, 'one.more@navy.example');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Up to 10 guests.')).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Also invite' })).toHaveValue('one.more@navy.example');
    expect(page.getByRole('list', { name: 'Also invite' }).getByRole('listitem').elements()).toHaveLength(10);
  });

  it('holds Also invite still while Book it is out, as the other fields are', async () => {
    let answer: () => void = () => undefined;
    const onBook = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    await open({ onBook });
    await userEvent.fill(page.getByRole('textbox', { name: 'With' }), 'Grace Hopper');
    await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'grace@navy.example');
    await userEvent.click(page.getByRole('textbox', { name: 'Also invite' }));
    await userEvent.keyboard('alan@bletchley.example{Enter}');
    await userEvent.click(page.getByRole('button', { name: /Book it/ }));
    await expect.element(page.getByRole('textbox', { name: 'Also invite' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Remove alan@bletchley.example' })).toBeDisabled();
    expect(onBook).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer();
      await Promise.resolve();
    });
  });

  it('offers Calendar with two calendars in use that take events, starts on the page’s own, and sends only a pick', async () => {
    const teamPage = pageCalendar(TEAM);
    const { onBook } = await open({
      calendars: calendarsOf(['Work', 'Team', 'Holidays', 'Shared']),
      pageDestination: () => teamPage,
    });
    const calendar = page.getByRole('button', { name: /Calendar$/ });
    await expect.element(calendar).toHaveTextContent('Team');
    await userEvent.fill(page.getByRole('textbox', { name: 'With' }), 'Grace Hopper');
    await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'grace@navy.example');
    await userEvent.click(calendar);
    // Only calendars in use that take events: Holidays is read only, and Shared isn't in use.
    const options = page.getByRole('option');
    expect(options.elements().map((option) => option.textContent)).toEqual(['Work', 'Team']);
    await userEvent.click(page.getByRole('option', { name: 'Work' }));
    await userEvent.click(page.getByRole('button', { name: /Book it/ }));
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ calendarId: WORK }));
  });

  it('counts and lists the page’s own calendar even when it isn’t in use, and starts on it', async () => {
    const sharedPage = pageCalendar(SHARED);
    // One calendar in use, and the page's own that isn't: two to choose between.
    await open({ calendars: calendarsOf(['Work', 'Shared']), pageDestination: () => sharedPage });
    const calendar = page.getByRole('button', { name: /Calendar$/ });
    await expect.element(calendar).toHaveTextContent('Shared');
    await userEvent.click(calendar);
    const options = page.getByRole('option');
    expect(options.elements().map((option) => option.textContent)).toEqual(['Work', 'Shared']);
  });

  it('leaves Calendar out with one calendar in use that takes events', async () => {
    const ownless = pageCalendar(undefined);
    // Shared could take events, but isn't in use, so it isn't a choice.
    await open({ calendars: calendarsOf(['Work', 'Holidays', 'Shared']), pageDestination: () => ownless });
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveFocus();
    expect(page.getByRole('button', { name: /Calendar$/ }).elements()).toEqual([]);
  });

  it('warns before booking a colleague in past their meeting limit, and still books', async () => {
    const sam = '0190f0f0-0000-7000-8000-0000000000d1';
    const samsPage = { ...intro, id: '0190f0f0-0000-7000-8000-000000000003', ownerMemberId: sam, scope: 'member' };
    const limitsAt = vi.fn<NonNullable<NewMeetingDialogProps['limitsAt']>>((input) =>
      Promise.resolve(input.memberId === sam ? { day: { limit: 5, count: 5 }, week: { limit: 30, count: 12 } } : {}),
    );
    const { onBook } = await open({
      pages: [intro, samsPage as BookingPageView],
      forPeople: [{ id: sam, name: 'Sam' }],
      limitsAt,
    });
    // For leads the form (31 Oct 2026), yet typing still starts in With.
    const forPicker = page.getByRole('button', { name: /For$/ }).element();
    expect(before(forPicker, page.getByRole('textbox', { name: 'With' }).element())).toBe(true);
    await expect.element(page.getByRole('textbox', { name: 'With' })).toHaveFocus();
    // The member's own time: no limit, no warning.
    await expect.poll(() => limitsAt.mock.calls.length).toBe(1);
    expect(limitsAt).toHaveBeenLastCalledWith({ at: '2026-10-23T09:30:00.000Z' });
    expect(page.getByText(/limit of/).elements()).toEqual([]);
    // For Sam, at his limit that day: said before Book it, politely.
    await userEvent.click(page.getByRole('button', { name: /For$/ }));
    await userEvent.click(page.getByRole('option', { name: 'Sam' }));
    const warning = page.getByRole('status').filter({ hasText: 'Sam is at their limit of 5 meetings that day.' });
    await expect
      .element(warning)
      .toHaveTextContent('Sam is at their limit of 5 meetings that day. Booking anyway goes over it.');
    expect(limitsAt).toHaveBeenLastCalledWith({ memberId: sam, at: '2026-10-23T09:30:00.000Z' });
    // Book it still books.
    await userEvent.fill(page.getByRole('textbox', { name: 'With' }), 'Ada');
    await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Book it' }));
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ forMemberId: sam, pageId: samsPage.id }));
  });

  it('words each of the member’s own limits, and keeps the warning in place as the time moves on that day', async () => {
    const limitsAt = vi.fn<NonNullable<NewMeetingDialogProps['limitsAt']>>(() =>
      Promise.resolve({ day: { limit: 4, count: 6 }, week: { limit: 20, count: 20 } }),
    );
    await open({ limitsAt });
    const words =
      'You’re past your limit of 4 meetings that day and at your limit of 20 meetings that week. Booking anyway goes over both.';
    const warning = page.getByRole('status').filter({ hasText: 'past your limit' });
    await expect.element(warning).toHaveTextContent(words);
    const shown = warning.element();
    // An hour later the same day: read again, and the same warning stays put (it neither blinks nor is said again).
    await act(async () => {
      mounted?.root.render(
        <UiProvider locale="en-GB" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
          <NewMeetingDialog
            span={{ dayKey: '2026-10-23', startMinute: 10 * 60 + 30, endMinute: 11 * 60 + 15 }}
            onSpanChange={() => undefined}
            locale="en-GB"
            hasCalendar={false}
            pages={[intro]}
            newKey={() => 'key'}
            onBook={() => Promise.resolve()}
            onClose={() => undefined}
            limitsAt={limitsAt}
          />
        </UiProvider>,
      );
      await Promise.resolve();
    });
    expect(shown.isConnected).toBe(true);
    await expect.poll(() => limitsAt.mock.calls.length).toBe(2);
    expect(limitsAt).toHaveBeenLastCalledWith({ at: '2026-10-23T10:30:00.000Z' });
    expect(shown.isConnected).toBe(true);
  });

  it('says nothing when the limits can’t be read', async () => {
    const limitsAt = vi.fn<NonNullable<NewMeetingDialogProps['limitsAt']>>(() => Promise.reject(new Error('offline')));
    await open({ limitsAt });
    await expect.poll(() => limitsAt.mock.calls.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(page.getByText(/limit of/).elements()).toEqual([]);
  });
});
