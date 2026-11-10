// Bookings › Pages (and Captures › Links) in Chromium, as the owner set them on 9 November 2026: deleting a booking
// page asks nothing; its card leaves at once and a toast offers Undo, which brings it back without a delete ever
// sent; with no Undo the delete is sent once the toast's time is up, and a refusal brings the card back and says why.
// Hiding a page from its card's Live or Hidden menu says so with Undo.
import {
  dataError,
  type BookingPageView,
  type CaptureListState,
  type CaptureListView,
  type DataLayer,
} from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { deferred, emptyCaptureList, openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LinksScreen } from './LinksScreen.tsx';

/** A working day's hours. */
const DAY = ['09:00', '17:00'] as const;

/** A booking page as the list holds it. */
function pageOf(id: string, title: string): BookingPageView {
  return {
    id,
    title,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    description: '',
    durations: [30],
    location: { type: 'video' },
    // Weekdays nine to five: the card's picture tints the days its hours book.
    availability: {
      timeZone: 'Europe/London',
      weekly: { mon: [DAY], tue: [DAY], wed: [DAY], thu: [DAY], fri: [DAY], sat: [], sun: [] },
      overrides: [],
    },
    status: 'live',
    hoursMode: 'mine',
    isPrivate: false,
    kind: 'personal',
    publicKey: `key-${id}`,
    canChange: true,
    bookingsThisMonth: 0,
  } as unknown as BookingPageView;
}

/**
 * The held list of pages, deleting with Undo as the data layer does (`removeLater`): the card leaves at once, the
 * delete is sent (`remove`, the spy) once the wait is up, and the card comes back on Undo or a refusal. `answers`
 * settle each delete sent when the test says.
 */
function pagesOf(pages: readonly BookingPageView[]) {
  let items = pages;
  let snapshot: CaptureListState<BookingPageView> = { status: 'ready', items, pendingIds: new Set() };
  const listeners = new Set<() => void>();
  const show = (next: readonly BookingPageView[]) => {
    items = next;
    snapshot = { status: 'ready', items, pendingIds: new Set() };
    for (const listener of listeners) listener();
  };
  const view: CaptureListView<BookingPageView> = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
  const answers: ReturnType<typeof deferred<{ pageId: string }>>[] = [];
  const remove = vi.fn((_workspace: string, _pageId: string) => {
    const answer = deferred<{ pageId: string }>();
    answers.push(answer);
    return answer.promise;
  });
  const removeLater = (workspace: string, pageId: string, waitMs: number) => {
    const before = items;
    show(items.filter((each) => each.id !== pageId));
    let isWaiting = true;
    const undone = deferred<'undone'>();
    const timer = setTimeout(() => {
      isWaiting = false;
      sent.resolve(remove(workspace, pageId));
    }, waitMs);
    const sent = deferred<Promise<{ pageId: string }>>();
    const done = Promise.race([
      undone.promise,
      sent.promise.then(
        () => 'deleted' as const,
        (error: unknown) => {
          show(before);
          throw error;
        },
      ),
    ]);
    return {
      undo: () => {
        if (!isWaiting) return false;
        isWaiting = false;
        clearTimeout(timer);
        show(before);
        undone.resolve('undone');
        return true;
      },
      done,
    };
  };
  return { view, remove, removeLater, answers };
}

/** The managed pages the screen also reads: none, and one view for every render (a new one would loop). */
const noTemplates = emptyCaptureList<never>();

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function renderLinks(
  pages: readonly BookingPageView[],
  update: (workspace: string, pageId: string, patch: { status?: string }) => Promise<unknown> = () =>
    Promise.resolve({}),
) {
  const held = pagesOf(pages);
  // No managed pages here: these tests are about the member's own cards, and Links reads the templates too.
  const data = {
    bookingPages: { view: () => held.view, removeLater: held.removeLater, update },
    managedPages: { view: () => noTemplates, remove: vi.fn() },
    rotations: { view: () => noTemplates },
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
  return held;
}

/** Opens the card's menu and chooses Delete. */
async function chooseDelete(title: string) {
  await userEvent.click(page.getByRole('button', { name: `More for ${title}` }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete' }));
}

describe('deleting a booking page', () => {
  it('asks nothing: the card leaves, and Undo brings it back with no delete sent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const held = await renderLinks([pageOf('p1', 'Quick chat'), pageOf('p2', 'Demo')]);
      await chooseDelete('Quick chat');
      expect(openDialog('alertdialog')).toBeNull();
      await expect.poll(() => document.querySelector('[aria-label="More for Quick chat"]')).toBeNull();
      await expect.element(page.getByText('Deleted “Quick chat”.')).toBeVisible();
      await userEvent.click(page.getByRole('button', { name: 'Undo' }));
      await expect.poll(() => document.querySelector('[aria-label="More for Quick chat"]')).not.toBeNull();
      vi.advanceTimersByTime(20_000);
      expect(held.remove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes once the Undo has gone, and a refusal brings the card back and says why', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const held = await renderLinks([pageOf('p1', 'Quick chat')]);
      await chooseDelete('Quick chat');
      vi.advanceTimersByTime(10_000);
      expect(held.remove).toHaveBeenCalledTimes(1);
      expect(held.remove).toHaveBeenCalledWith('acme', 'p1');
      held.answers[0]?.reject(dataError('FORBIDDEN', 'Only its owner can delete it.'));
      await expect.element(page.getByText(/Only its owner can delete it\./)).toBeVisible();
      await expect.poll(() => document.querySelector('[aria-label="More for Quick chat"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Opens the card's Live or Hidden menu and picks Hidden. */
async function hide(title: string) {
  await userEvent.click(page.getByRole('button', { name: `Live, status of ${title}` }));
  await userEvent.click(page.getByRole('menuitemradio', { name: /^Hidden/ }));
}

describe('hiding a booking page from its card', () => {
  it('says it is hidden with Undo, and Undo makes it live again', async () => {
    const update = vi.fn(() => Promise.resolve({}));
    await renderLinks([pageOf('p1', 'Quick chat')], update);
    await hide('Quick chat');
    expect(update).toHaveBeenCalledWith('acme', 'p1', { status: 'paused' });
    await expect.element(page.getByText('Quick chat is hidden')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    expect(update).toHaveBeenLastCalledWith('acme', 'p1', { status: 'live' });
    await expect.element(page.getByText('Quick chat is live')).toBeVisible();
  });

  it('says a refusal, and nothing about hidden', async () => {
    const update = vi.fn(() => Promise.reject(dataError('FORBIDDEN', 'Only its owner can change it.')));
    await renderLinks([pageOf('p1', 'Quick chat')], update);
    await hide('Quick chat');
    await expect.element(page.getByText(/Only its owner can change it\./)).toBeVisible();
    expect(document.body.textContent).not.toContain('Quick chat is hidden');
  });
});
