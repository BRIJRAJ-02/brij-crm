// The view a booking page opens in (owner, 25 Oct 2026): the host's default travels with the page's other facts, a
// visitor's own remembered choice still wins, and the first paint is already the right view, never Month swapped
// for Chat a moment later.
import { BookingProvider } from '@crm/ui/public-booking';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { BookingPage } from './BookingPage.tsx';
import { openedBefore, rememberOpened, saveView } from './prefs.ts';

const KEY = 'abcdefghijklmnop';

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  globalThis.localStorage.clear();
  // The tests run in a frame, which the page would otherwise read as the editor's preview.
  vi.stubGlobal('parent', globalThis);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  globalThis.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** The page's facts, its viewer and its slots, as the API answers them. */
function fakeApi(defaultView: 'month' | 'list' | 'chat', slots: readonly string[] = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/viewer')) return Promise.resolve(answer({ isHost: false, canConnect: false }));
    if (url.includes('/slots'))
      return Promise.resolve(answer({ slots: slots.map((start) => ({ start })), timeZone: 'UTC' }));
    return Promise.resolve(
      answer({
        publicKey: KEY,
        title: 'Intro call',
        description: '',
        hostName: 'Ada',
        durations: [30],
        location: { type: 'video' },
        hostTimeZone: 'UTC',
        windowDays: 30,
        defaultView,
      }),
    );
  });
}

function show() {
  host = document.createElement('div');
  document.body.append(host);
  const made = createRoot(host);
  root = made;
  act(() => {
    made.render(
      <BookingProvider locale="en-US" timeZone="UTC">
        <BookingPage publicKey={KEY} locale="en-US" timeZone="UTC" now={() => Date.now()} onBooked={() => undefined} />
      </BookingProvider>,
    );
  });
}

/** The view the page says it is in: the chosen segment of its view switch (the clock's sits beside it, AC-24). */
function chosenView(): string | undefined {
  return host?.querySelector<HTMLInputElement>('[aria-label="Choose how to view times"] input[type="radio"]:checked')
    ?.value;
}

/** Waits for the page's facts to land and the card to be drawn with them. */
async function loaded() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the view a booking page opens in', () => {
  it('opens in the host’s view, and paints no other view first', async () => {
    fakeApi('chat');
    // This browser has met the page before, so even the shape drawn while the facts come holds Chat's place.
    rememberOpened(globalThis.location.pathname, 'chat');
    show();
    // The very first paint, before any answer has arrived.
    expect(chosenView()).toBe('chat');
    const seen: (string | undefined)[] = [chosenView()];
    await loaded();
    seen.push(chosenView());
    expect(seen).toEqual(['chat', 'chat']);
  });

  it('opens in the host’s view on a first visit, with nothing remembered', async () => {
    fakeApi('list');
    show();
    await loaded();
    expect(chosenView()).toBe('list');
  });

  it('keeps the choice made on this page over the host’s default', async () => {
    fakeApi('chat');
    saveView(globalThis.location.pathname, 'month');
    show();
    await loaded();
    expect(chosenView()).toBe('month');
  });

  it('ignores a choice made on another page, and opens in the host’s view', async () => {
    fakeApi('chat');
    saveView('/someone/else', 'month');
    show();
    await loaded();
    expect(chosenView()).toBe('chat');
  });

  it('remembers the view the page opened in, under an address the store never spells out', async () => {
    fakeApi('chat');
    show();
    await loaded();
    expect(openedBefore(globalThis.location.pathname)).toBe('chat');
    // The address itself is never kept: a link only page's address is its whole secret.
    expect(globalThis.localStorage.getItem('crm.booking.opens')).not.toContain(globalThis.location.pathname);
  });
});

describe('the time zone picker in the rail', () => {
  it('draws with the page and opens on the first press, though its list loads apart', async () => {
    fakeApi('month');
    // The browser never idles here, so the list's code loads only for the press.
    vi.stubGlobal('requestIdleCallback', () => 0);
    vi.stubGlobal('cancelIdleCallback', () => undefined);
    show();
    await loaded();
    const trigger = [...(host?.querySelectorAll('button') ?? [])].find(
      (button) => button.getAttribute('aria-haspopup') === 'listbox',
    );
    expect(trigger?.getAttribute('aria-label')).toBe('Time zone');
    // The stand in, not React Aria's own trigger: the list's code is not in the page's first load.
    expect(trigger?.hasAttribute('data-react-aria-pressable')).toBe(false);
    act(() => trigger?.click());
    await vi.waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Search city or GMT offset');
    });
  });
});

describe('a next times chip’s time (spec 0061, AC-6110)', () => {
  /** A time tomorrow at 09:00 UTC, which a chip on the link page would have carried here. */
  const tomorrow = () => {
    const day = new Date(Date.now() + 86_400_000);
    day.setUTCHours(9, 0, 0, 0);
    return day.toISOString();
  };

  const openAt = (query: string) => {
    globalThis.history.replaceState(null, '', `/b/${KEY}${query}`);
  };

  afterEach(() => {
    globalThis.history.replaceState(null, '', `/b/${KEY}`);
  });

  it('opens the details form on the time the chip named', async () => {
    const start = tomorrow();
    fakeApi('month', [start]);
    openAt(`?at=${encodeURIComponent(start)}&len=30`);
    show();
    await loaded();
    // The slots read waits on the link hash first, so the form can land a few promises after the second read.
    await vi.waitFor(() => expect(host?.textContent).toContain('Your name'));
  });

  it('says a time that has gone since, over the other times, and asks nothing of the visitor', async () => {
    const start = tomorrow();
    // The page's times no longer hold it: somebody booked it between the chip being drawn and this read.
    fakeApi('month', [new Date(Date.parse(start) + 3_600_000).toISOString()]);
    openAt(`?at=${encodeURIComponent(start)}&len=30`);
    show();
    // The reads go through a few more promises since the slots read waits on the link hash: wait for the line.
    await vi.waitFor(() => expect(host?.textContent).toContain('That time was just taken. Here are the others.'));
    expect(host?.textContent).not.toContain('Your name');
  });

  it('says a time already gone by has passed, rather than waiting in silence (critic B-08)', async () => {
    const start = tomorrow();
    fakeApi('month', [start]);
    // Yesterday: before the first read's window, so no answer could ever hold it.
    openAt(`?at=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&len=30`);
    show();
    await vi.waitFor(() => expect(host?.textContent).toContain('That time has passed. Here are the next ones.'));
  });

  it('opens as it always did for an address whose at is no instant', async () => {
    const start = tomorrow();
    fakeApi('month', [start]);
    openAt('?at=whenever');
    show();
    await loaded();
    await loaded();
    expect(host?.textContent).not.toContain('That time was just taken');
    expect(host?.textContent).not.toContain('Your name');
  });
});

describe('the times’ read (4 Nov 2026: the chat view sat on its loading shape for 2 to 3 seconds)', () => {
  it('asks for the first times beside the page’s facts, not after them', async () => {
    const asked: string[] = [];
    // The facts never answer here: the times' read must already be out regardless.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      asked.push(url);
      return new Promise<Response>(() => undefined);
    });
    show();
    await loaded();
    const slots = asked.find((url) => url.includes('/slots'));
    expect(slots).toBeDefined();
    // With no length yet: the page's first, which the server picks.
    expect(slots).not.toContain('duration=');
  });

  it('draws the times from that read, without asking again', async () => {
    const start = new Date(Date.now() + 86_400_000);
    start.setUTCHours(9, 0, 0, 0);
    const api = fakeApi('month', [start.toISOString()]);
    show();
    await loaded();
    await loaded();
    expect(
      api.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/slots')),
    ).toHaveLength(1);
    expect(host?.textContent).toContain('9:00');
  });

  it('holds the chat’s own shape while the times load: a bubble, a day’s times and the prompt box', async () => {
    // The facts answer at once, the times never do.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/slots')) return new Promise<Response>(() => undefined);
      if (url.includes('/viewer')) return Promise.resolve(answer({ isHost: false, canConnect: false }));
      return Promise.resolve(
        answer({
          publicKey: KEY,
          title: 'meeting',
          description: '',
          hostName: 'Ada',
          durations: [30],
          location: { type: 'video' },
          hostTimeZone: 'UTC',
          windowDays: 30,
          defaultView: 'chat',
        }),
      );
    });
    show();
    await loaded();
    expect(chosenView()).toBe('chat');
    // The view on show (the month under it is inert): far more than two bars, the host's name and face, the bubble,
    // the day's label and six times. It comes with the chat's code, fetched beside the page's facts.
    await vi.waitFor(() => {
      const shown = [...(host?.querySelectorAll('[aria-busy="true"]') ?? [])].filter(
        (each) => each.closest('[inert]') === null,
      );
      const shapes = Math.max(0, ...shown.map((each) => each.querySelectorAll('[aria-hidden="true"]').length));
      expect(shapes).toBeGreaterThanOrEqual(9);
    });
  });
});

describe('Book by chat does what the details step does (chat parity, 4 Nov 2026)', () => {
  const questions = [
    {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      choices: ['Under 5k', 'Over 5k'],
      required: true,
    },
    { id: 'role', key: 'role', label: 'Your role', answerType: 'short_text', required: false },
  ];

  it('asks the required question, offers guests, a note and the optional ones, then books with them', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(9, 0, 0, 0);
    const start = tomorrow.toISOString();
    const sent: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/viewer')) return Promise.resolve(answer({ isHost: false, canConnect: false }));
      if (url.includes('/slots')) return Promise.resolve(answer({ slots: [{ start }], calendar: 'ok' }));
      if (url.includes('/chat')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
        sent.push(body);
        const said = (body.messages as unknown[]).length;
        if (said === 1)
          return Promise.resolve(
            answer({
              text: 'Thursday 22 Oct at 9:00 AM, 30 min, for Grace Hopper (grace@example.com). Shall I book it?',
              offers: [],
              suggestions: ['Yes, book it', 'Something else'],
              confirm: 'Yes, book it',
              readBack: { start, name: 'Grace Hopper', email: 'grace@example.com' },
              name: 'Grace Hopper',
              duration: 30,
            }),
          );
        return Promise.resolve(
          answer({
            text: 'You’re booked. See you tomorrow at 9:00 AM.',
            offers: [],
            suggestions: [],
            duration: 30,
            booked: { manageToken: 't'.repeat(32), booking: { start } },
          }),
        );
      }
      return Promise.resolve(
        answer({
          publicKey: KEY,
          title: 'Intro call',
          description: '',
          hostName: 'Ada Lovelace',
          durations: [30, 60],
          location: { type: 'video' },
          hostTimeZone: 'UTC',
          windowDays: 30,
          defaultView: 'chat',
          questions,
        }),
      );
    });
    show();
    const box = await vi.waitFor(() => {
      const found = host?.querySelector('textarea');
      if (found === null || found === undefined) throw new Error('No box yet.');
      return found;
    });
    // Two lengths: the greeting carries them as chips, picked to the page's first.
    await vi.waitFor(() => expect(host?.textContent).toContain('60 min'));
    const press = async (name: string) => {
      const button = await vi.waitFor(() => {
        const found = [...(host?.querySelectorAll('button') ?? [])].find((each) => each.textContent === name);
        if (found === undefined) throw new Error(`No ${name} yet.`);
        return found;
      });
      act(() => button.click());
    };
    const type = async (text: string) => {
      await userEvent.fill(box, text);
      await userEvent.keyboard('{Enter}');
    };
    await type('tomorrow at 9, Grace Hopper, grace@example.com');
    // The required question, in the host's voice, answered with a chip.
    // The first turn waits out the fill ticket's settle time (TICKET_SETTLE_MS, B-04).
    await vi.waitFor(() => expect(host?.textContent).toContain('One more thing. Budget?'), { timeout: 5_000 });
    await press('Under 5k');
    // Then one row for the optional things.
    await vi.waitFor(() => expect(host?.textContent).toContain('Anything else before I book it?'));
    await press('Add a guest');
    await vi.waitFor(() => expect(host?.textContent).toContain('Who else is joining?'));
    await type('ada@example.com');
    await vi.waitFor(() => expect(host?.textContent).toContain('Added. Anything else before I book it?'));
    await press('That’s all');
    await press('Yes, book it');
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 5_000 });
    // The page's own lines never reach the server's replay: only what the visitor said to the chat.
    expect(sent[1]?.messages).toEqual([
      { role: 'visitor', text: 'tomorrow at 9, Grace Hopper, grace@example.com' },
      { role: 'visitor', text: 'Yes, book it' },
    ]);
    expect(sent[1]?.answers).toEqual({ budget: 'Under 5k' });
    expect(sent[1]?.guests).toEqual(['ada@example.com']);
  });
});
