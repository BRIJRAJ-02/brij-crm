// Linking a booking to a record by hand (polish F2), against the real bookings and meetings stores and a call
// answered by hand: the chip shows at once in every list, range and page of meetings, stays once the server has
// it, goes back on a refusal (which reaches the screen), and taking the link off is optimistic the same way.
import type { BookingListItem, MeetingListItem } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { describe, expect, it } from 'vitest';
import { createBookingLink } from './link.ts';
import { createMeetingsStore } from './meetings.ts';
import { createBookingsStore } from './store.ts';

const booking = (id: string, linkedRecord?: RecordRefDisplay): BookingListItem => ({
  id,
  pageId: '0199f0a0-0000-7000-8000-000000000001',
  pageTitle: 'Quick chat',
  location: { type: 'video' },
  hostMemberId: '0199f0a0-0000-7000-8000-000000000002',
  startsAt: '2026-11-02T09:00:00.000Z',
  endsAt: '2026-11-02T09:30:00.000Z',
  visitorName: 'Grace',
  visitorEmail: 'grace@example.org',
  visitorTimeZone: 'Europe/London',
  status: 'confirmed',
  guests: [],
  reschedules: 0,
  hostName: 'Ada Lovelace',
  needsHost: false,
  eventFailed: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...(linkedRecord === undefined ? {} : { linkedRecord }),
});

const deal: RecordRefDisplay = {
  objectId: '0199f0a0-0000-7000-8000-0000000000d1',
  recordId: '0199f0a0-0000-7000-8000-0000000000d2',
  name: 'Navy rollout',
  kind: 'other',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every Bookings read held, with booking `a` (linked to `linked` when given) and `b`; the call answered by hand. */
async function held(linked?: RecordRefDisplay) {
  const lists = createBookingsStore({
    api: {
      listAll: () => Promise.resolve([booking('a', linked), booking('b')]),
      calendar: () => Promise.resolve({ bookings: [booking('a', linked)], events: [], busy: [], blocks: [] }),
    },
    onReturn: () => () => undefined,
  });
  const meetings = createMeetingsStore({
    api: {
      page: () =>
        Promise.resolve({ items: [{ kind: 'booking', booking: booking('a', linked) } satisfies MeetingListItem] }),
    },
    onReturn: () => () => undefined,
  });
  const list = lists.view('acme', 'upcoming');
  const range = lists.calendar('acme', '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
  const page = meetings.list('acme', { when: 'upcoming', source: 'all' });
  list.retain();
  range.retain();
  page.retain();
  await settle();
  const sent: (string | null)[] = [];
  type Answer = { readonly linkedRecord?: RecordRefDisplay };
  const answers: { resolve: (answer: Answer) => void; reject: (error: Error) => void }[] = [];
  const link = createBookingLink({
    lists,
    meetings,
    send: (_workspace, _bookingId, recordId) => {
      sent.push(recordId);
      return new Promise<Answer>((resolve, reject) => {
        answers.push({ resolve, reject });
      });
    },
  });
  /** Booking `a`'s linked record everywhere it shows: the list, the range and the page of meetings. */
  const shown = () => {
    const [listed, ranged, paged] = [list.getSnapshot(), range.getSnapshot(), page.getSnapshot()];
    return [
      listed.status === 'ready' ? listed.bookings.find((each) => each.id === 'a')?.linkedRecord?.name : 'unread',
      ranged.status === 'ready' ? ranged.bookings[0]?.linkedRecord?.name : 'unread',
      paged.status === 'ready' && paged.items[0]?.kind === 'booking'
        ? paged.items[0].booking.linkedRecord?.name
        : 'unread',
    ];
  };
  /** Answers the `index`th call (the last by default): what the server links now, or a refusal. */
  const answerWith = (outcome: Answer | Error, index = answers.length - 1) => {
    const answer = answers[index];
    if (answer === undefined) throw new Error('Nothing was sent.');
    if (outcome instanceof Error) answer.reject(outcome);
    else answer.resolve(outcome);
  };
  /** Booking `b`'s linked record in the list. */
  const shownB = () => {
    const listed = list.getSnapshot();
    return listed.status === 'ready' ? listed.bookings.find((each) => each.id === 'b')?.linkedRecord?.name : 'unread';
  };
  return { link, sent, shown, shownB, answerWith };
}

describe('linking a booking to a record by hand (polish F2)', () => {
  it('shows the record at once in every read, before the server answers, and keeps it once it does', async () => {
    const h = await held();
    const linking = h.link('acme', 'a', deal);
    expect(h.shown()).toEqual(['Navy rollout', 'Navy rollout', 'Navy rollout']);
    expect(h.sent).toEqual([deal.recordId]);
    h.answerWith({ linkedRecord: deal });
    await linking;
    expect(h.shown()).toEqual(['Navy rollout', 'Navy rollout', 'Navy rollout']);
  });

  it('puts every read back on a refusal, and hands the refusal on', async () => {
    const h = await held();
    const linking = h.link('acme', 'a', deal);
    h.answerWith(
      Object.assign(new Error('You can’t link a booking to a record you can’t change.'), { code: 'FORBIDDEN' }),
    );
    await expect(linking).rejects.toThrow('can’t change');
    expect(h.shown()).toEqual([undefined, undefined, undefined]);
  });

  it('takes a link off at once, and puts it back when that is refused', async () => {
    const h = await held(deal);
    expect(h.shown()).toEqual(['Navy rollout', 'Navy rollout', 'Navy rollout']);
    const unlinking = h.link('acme', 'a', null);
    expect(h.shown()).toEqual([undefined, undefined, undefined]);
    expect(h.sent).toEqual([null]);
    h.answerWith(new Error('down'));
    await expect(unlinking).rejects.toThrow('down');
    expect(h.shown()).toEqual(['Navy rollout', 'Navy rollout', 'Navy rollout']);
  });

  it('puts back only the refused booking when another link went out meanwhile', async () => {
    const h = await held();
    const linkingA = h.link('acme', 'a', deal);
    const linkingB = h.link('acme', 'b', deal);
    h.answerWith(new Error('down'), 0);
    await expect(linkingA).rejects.toThrow('down');
    expect(h.shown()).toEqual([undefined, undefined, undefined]);
    expect(h.shownB()).toBe('Navy rollout');
    h.answerWith({ linkedRecord: deal }, 1);
    await linkingB;
    expect(h.shownB()).toBe('Navy rollout');
  });

  it('shows the server’s answer once it lands, over what was shown', async () => {
    const h = await held();
    const linking = h.link('acme', 'a', { ...deal, name: '' });
    expect(h.shown()).toEqual(['', '', '']);
    h.answerWith({ linkedRecord: deal });
    await linking;
    expect(h.shown()).toEqual(['Navy rollout', 'Navy rollout', 'Navy rollout']);
  });
});
