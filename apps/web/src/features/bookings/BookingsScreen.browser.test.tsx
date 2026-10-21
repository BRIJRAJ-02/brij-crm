// Bookings › Calendar in Chromium: removing closed time and cancelling a
// booking each ask first (the house rule in Modal's README). A card's button
// closes the card (React Aria draws popovers above every dialog) and the
// confirm opens alone; Esc and its dismiss change nothing, open the card again
// and put focus back on that button; the commit runs once and stays busy until
// the server answers, though the change shows behind it at once; a refusal
// shows inside the confirm; and once the change lands, focus goes to the day.
import {
  dataError,
  type BookingListItem,
  type BookingsCalendarHeld,
  type BookingsCalendarState,
  type BookingsState,
  type BookingsView,
  type DataLayer,
  type TimeBlockOccurrence,
} from '@crm/data';
import { createToasts } from '@crm/ui';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { deferred, openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import type { HostBookingActions } from './BookingActions.tsx';
import { BookingsCalendarScreen, BookingsListScreen } from './BookingsScreen.tsx';
import { addDays, dayKeyOf, dayStart, weekOf } from './week.ts';

// Next week, so every booking is still to come: its Wednesday, 10:00 to 11:00, local time.
const week = weekOf(addDays(dayKeyOf(new Date()), 7));
const wednesday = addDays(week, 2);
const at = (hour: number) => {
  const date = dayStart(wednesday);
  date.setHours(hour);
  return date.toISOString();
};

function blockOf(overrides: Partial<TimeBlockOccurrence>): TimeBlockOccurrence {
  return {
    key: 'b1',
    blockId: '0199f0a0-0000-7000-8000-0000000000b1',
    kind: 'block',
    repeat: 'once',
    label: 'Dentist',
    startsAt: at(10),
    endsAt: at(11),
    ...overrides,
  };
}

function bookingOf(): BookingListItem {
  return {
    id: '0199f0a0-0000-7000-8000-0000000000c1',
    pageId: '0199f0a0-0000-7000-8000-0000000000d1',
    hostMemberId: '0199f0a0-0000-7000-8000-0000000000e1',
    startsAt: at(14),
    endsAt: at(15),
    visitorName: 'Ada Lovelace',
    visitorEmail: 'ada@example.com',
    visitorTimeZone: 'Europe/London',
    status: 'confirmed',
    eventFailed: false,
    createdAt: at(9),
    pageTitle: 'Quick chat',
    location: { type: 'video' },
    guests: [],
    reschedules: 0,
  } as unknown as BookingListItem;
}

/** The held week, changed as the data layer would change it (a removal or a cancel shown at once). */
function weekOfItems(blocks: readonly TimeBlockOccurrence[], bookings: readonly BookingListItem[]) {
  let state: BookingsCalendarState = {
    status: 'ready',
    bookings: [...bookings],
    events: [],
    busy: [],
    blocks: [...blocks],
  };
  const listeners = new Set<() => void>();
  const held: BookingsCalendarHeld = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
  const patch = (change: (ready: Extract<BookingsCalendarState, { status: 'ready' }>) => BookingsCalendarState) => {
    if (state.status !== 'ready') return () => undefined;
    const before = state;
    state = change(state);
    for (const listener of listeners) listener();
    return () => {
      state = before;
      for (const listener of listeners) listener();
    };
  };
  return { held, patch };
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The week with these blocks and bookings; removals and cancels show at once and wait for the test's answer. */
async function renderWeek(blocks: readonly TimeBlockOccurrence[], bookings: readonly BookingListItem[] = []) {
  const { held, patch } = weekOfItems(blocks, bookings);
  const removals: ReturnType<typeof deferred<undefined>>[] = [];
  const onRemoveBlock = vi.fn((blockId: string) => {
    const undo = patch((ready) => ({ ...ready, blocks: ready.blocks.filter((turn) => turn.blockId !== blockId) }));
    const answer = deferred<undefined>();
    removals.push(answer);
    return answer.promise.catch((error: unknown) => {
      undo();
      throw error;
    });
  });
  const cancels: ReturnType<typeof deferred<undefined>>[] = [];
  const notify = vi.fn();
  const actions: HostBookingActions = {
    cancel: vi.fn((bookingId: string) => {
      const undo = patch((ready) => ({
        ...ready,
        bookings: ready.bookings.map((booking) =>
          booking.id === bookingId ? { ...booking, status: 'cancelled' as const } : booking,
        ),
      }));
      const answer = deferred<undefined>();
      cancels.push(answer);
      return answer.promise.catch((error: unknown) => {
        undo();
        throw error;
      });
    }),
    move: vi.fn(() => Promise.resolve()),
    moveSlots: vi.fn(),
    guestLink: vi.fn(() => Promise.resolve({ path: '/b/key/manage' })),
    notify,
    assignments: vi.fn(() => Promise.resolve([])),
    reassign: vi.fn(),
    rotations: vi.fn(() => Promise.resolve([])),
  };
  const data = {} as Partial<DataLayer>;
  const toasts = createToasts();
  shown = await renderInApp(
    () => (
      <BookingsCalendarScreen
        slug="acme"
        search={{ week, day: wednesday, tab: 'upcoming', page: 1, per: 25 }}
        week={held}
        objects={[]}
        pages={[]}
        connections={[]}
        locale="en-GB"
        onSearch={() => undefined}
        onRemoveBlock={onRemoveBlock}
        onBlock={() => Promise.resolve({ id: 'x' })}
        onBookAsHost={() => Promise.resolve()}
        newBookingKey={() => 'key'}
        workingStart={() => 9 * 60}
        toasts={toasts}
        actions={actions}
      />
    ),
    { data, toasts, pattern: '/w/$slug/bookings/calendar', at: '/w/acme/bookings/calendar' },
  );
  return { onRemoveBlock, removals, actions, cancels, notify };
}

const alert = () => openDialog('alertdialog');
/** The open card: the week's popover, a plain dialog. */
const card = () => openDialog('dialog');

/** The confirm stands alone: its card closed, so nothing is drawn over it. */
async function confirmAlone() {
  await expect.poll(alert).not.toBeNull();
  await expect.poll(card).toBeNull();
}

/** Opens a block's or booking's card on the week by its name. */
async function openCard(name: RegExp) {
  await userEvent.click(page.getByRole('button', { name }));
  await expect.poll(() => openDialog('dialog')).not.toBeNull();
}

describe('removing closed time', () => {
  it('asks first, naming the block; Esc and Cancel change nothing and give focus back to Remove', async () => {
    const week = await renderWeek([blockOf({})]);
    await openCard(/^Blocked,/);
    await userEvent.click(page.getByRole('button', { name: 'Remove', exact: true }));
    await confirmAlone();
    expect(alert()?.textContent).toContain('Remove the “Dentist” block?');
    expect(alert()?.textContent).toContain('opens for booking again. This can’t be undone.');
    const labels = [...(alert()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
    expect(labels[0]).toMatch(/^Cancel/);
    expect(labels.at(-1)).toBe('Remove block');

    await userEvent.keyboard('{Escape}');
    await expect.poll(alert).toBeNull();
    // The card is back, and focus with it on Remove.
    await expect.poll(card).not.toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Remove');
    await userEvent.keyboard('{Enter}');
    await confirmAlone();
    await userEvent.click(page.getByRole('button', { name: /^Cancel/ }));
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Remove');
    expect(week.onRemoveBlock).not.toHaveBeenCalled();
  });

  it('removes once, busy until the server answers, then focuses the day the block was on', async () => {
    const week = await renderWeek([blockOf({})]);
    await openCard(/^Blocked,/);
    await userEvent.click(page.getByRole('button', { name: 'Remove', exact: true }));
    await confirmAlone();
    await userEvent.click(page.getByRole('button', { name: 'Remove block' }));
    await expect.poll(() => alert()?.textContent).toContain('Removing…');
    await userEvent.click(page.getByRole('button', { name: /Removing/ }), { force: true });
    expect(week.onRemoveBlock).toHaveBeenCalledTimes(1);
    expect(week.onRemoveBlock).toHaveBeenCalledWith(blockOf({}).blockId);
    // The layer took it off the week at once; the confirm waits for the server.
    expect(document.querySelector('button[aria-label^="Blocked,"]')).toBeNull();
    week.removals[0]?.resolve(undefined);
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toMatch(/^Wednesday .*, nothing on$/);
  });

  it('keeps a refusal inside the confirm, with the block back', async () => {
    const week = await renderWeek([blockOf({})]);
    await openCard(/^Blocked,/);
    await userEvent.click(page.getByRole('button', { name: 'Remove', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Remove block' }));
    week.removals[0]?.reject(dataError('NOT_FOUND', 'That block was already removed elsewhere.'));
    await expect.poll(() => alert()?.textContent).toContain('That block was already removed elsewhere.');
    // Back on the week behind the confirm, which stays open.
    await expect.poll(() => document.querySelector('button[aria-label^="Blocked,"]')).not.toBeNull();
    await userEvent.click(page.getByRole('button', { name: /^Cancel/ }));
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Remove');
    expect(week.onRemoveBlock).toHaveBeenCalledTimes(1);
  });

  it('names what goes for a weekly block and a hold', async () => {
    await renderWeek([
      blockOf({ key: 'w1', blockId: '0199f0a0-0000-7000-8000-0000000000b2', repeat: 'weekly', label: undefined }),
    ]);
    await openCard(/^Blocked,/);
    await userEvent.click(page.getByRole('button', { name: 'Remove every Wednesday' }));
    await expect.poll(() => alert()?.textContent).toContain('Remove this weekly block?');
    expect(alert()?.textContent).toContain('Every Wednesday,');
    expect([...(alert()?.querySelectorAll('button') ?? [])].at(-1)?.textContent).toBe('Remove every Wednesday');
    await userEvent.keyboard('{Escape}');
    await expect.poll(alert).toBeNull();
    shown?.unmount();

    await renderWeek([blockOf({ kind: 'hold', label: undefined })]);
    await openCard(/^Held,/);
    await userEvent.click(page.getByRole('button', { name: 'Release', exact: true }));
    await expect.poll(() => alert()?.textContent).toContain('Release this hold?');
    expect(alert()?.textContent).toContain('opens to every booking page again.');
    expect([...(alert()?.querySelectorAll('button') ?? [])].at(-1)?.textContent).toBe('Release hold');
  });
});

describe('cancelling a booking', () => {
  it('asks first, naming the booking; Esc and Keep booking change nothing', async () => {
    const week = await renderWeek([], [bookingOf()]);
    await openCard(/^Quick chat,/);
    await userEvent.click(page.getByRole('button', { name: 'Cancel booking' }));
    await confirmAlone();
    expect(alert()?.textContent).toContain('Cancel Quick chat with Ada Lovelace?');
    const labels = [...(alert()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
    expect(labels[0]).toMatch(/^Keep booking/);
    expect(labels.at(-1)).toBe('Cancel booking');
    await userEvent.keyboard('{Escape}');
    await expect.poll(alert).toBeNull();
    // The card is back, and focus with it on Cancel booking.
    await expect.poll(card).not.toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Cancel booking');
    await userEvent.keyboard('{Enter}');
    await confirmAlone();
    await userEvent.click(page.getByRole('button', { name: /^Keep booking/ }));
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Cancel booking');
    expect(week.actions.cancel).not.toHaveBeenCalled();
  });

  it('stays busy while the booking already shows cancelled, cancels once, and keeps a refusal inside', async () => {
    const week = await renderWeek([], [bookingOf()]);
    await openCard(/^Quick chat,/);
    await userEvent.click(page.getByRole('button', { name: 'Cancel booking' }));
    await userEvent.fill(page.getByRole('textbox', { name: 'Reason' }), 'Ill today');
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking' }));
    await expect.poll(() => alert()?.textContent).toContain('Cancelling…');
    expect(week.actions.cancel).toHaveBeenCalledTimes(1);
    expect(week.actions.cancel).toHaveBeenCalledWith(bookingOf().id, 'Ill today');
    week.cancels[0]?.reject(dataError('INTERNAL', 'Can’t reach Timefix. Check your connection, then try again.'));
    await expect.poll(() => alert()?.textContent).toContain('Can’t reach Timefix.');
    // Tried again from the same confirm, it goes through.
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking' }));
    expect(week.actions.cancel).toHaveBeenCalledTimes(2);
    week.cancels[1]?.resolve(undefined);
    await expect.poll(alert).toBeNull();
    expect(week.notify).toHaveBeenCalledWith('success', 'Cancelled. Ada Lovelace is emailed.');
    // Its Cancel booking went with the cancel: focus goes to the booking, still on the week, drawn cancelled.
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toMatch(/^Quick chat,/);
  });
});

describe('cancelling from the list', () => {
  it('asks inside the booking’s panel, stays busy, then the panel closes and focus goes back to its row', async () => {
    let state: BookingsState = { status: 'ready', bookings: [bookingOf()] };
    const listeners = new Set<() => void>();
    const tell = () => {
      for (const listener of listeners) listener();
    };
    const upcoming: BookingsView = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain: () => () => undefined,
      ready: () => Promise.resolve(),
      reload: () => undefined,
    };
    const none: BookingsState = { status: 'ready', bookings: [] };
    const empty: BookingsView = { ...upcoming, subscribe: () => () => undefined, getSnapshot: () => none };
    const answer = deferred<undefined>();
    const cancel = vi.fn(() => {
      // Shown cancelled at once, as the layer does.
      state = { status: 'ready', bookings: [{ ...bookingOf(), status: 'cancelled' }] };
      tell();
      return answer.promise;
    });
    const actions: HostBookingActions = {
      cancel,
      move: vi.fn(),
      moveSlots: vi.fn(),
      guestLink: vi.fn(),
      notify: vi.fn(),
      assignments: vi.fn(() => Promise.resolve([])),
      reassign: vi.fn(),
      rotations: vi.fn(() => Promise.resolve([])),
    };
    shown = await renderInApp(
      () => (
        <BookingsListScreen
          slug="acme"
          search={{ week, day: wednesday, tab: 'upcoming', page: 1, per: 25 }}
          lists={{ upcoming, past: empty, cancelled: empty }}
          objects={[]}
          pages={[]}
          locale="en-GB"
          actions={actions}
          onSearch={() => undefined}
        />
      ),
      { data: {}, pattern: '/w/$slug/bookings/list', at: '/w/acme/bookings/list' },
    );
    await userEvent.click(page.getByRole('button', { name: 'Quick chat' }));
    await userEvent.click(page.getByRole('button', { name: 'Cancel booking' }));
    await expect.poll(alert).not.toBeNull();
    expect(alert()?.textContent).toContain('Cancel Quick chat with Ada Lovelace?');
    await userEvent.keyboard('{Escape}');
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Cancel booking');
    expect(cancel).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    await expect.poll(alert).not.toBeNull();
    await userEvent.click(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking' }));
    // The booking already shows cancelled in the panel; the confirm stays, busy, until the server answers.
    await expect.poll(() => alert()?.textContent).toContain('Cancelling…');
    expect(cancel).toHaveBeenCalledTimes(1);
    answer.resolve(undefined);
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Quick chat');
  });
});
