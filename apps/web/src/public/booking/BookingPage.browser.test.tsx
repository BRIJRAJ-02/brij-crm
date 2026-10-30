// The view a booking page opens in (owner, 25 Oct 2026): the host's default travels with the page's other facts, a
// visitor's own remembered choice still wins, and the first paint is already the right view, never Month swapped
// for Chat a moment later.
import { BookingProvider } from '@crm/ui/public-booking';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
function fakeApi(defaultView: 'month' | 'list' | 'chat') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/viewer')) return Promise.resolve(answer({ isHost: false, canConnect: false }));
    if (url.includes('/slots')) return Promise.resolve(answer({ slots: [], timeZone: 'UTC' }));
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
