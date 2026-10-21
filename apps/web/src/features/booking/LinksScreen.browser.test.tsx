// Captures › Links in Chromium: deleting a booking page asks first (the house
// rule in Modal's README). The card's menu opens the confirm; Esc and Cancel
// change nothing and hand focus back; the commit deletes once and stays busy
// until the server answers while the card has already left; a refusal shows
// inside the confirm with the card back; and with its card gone, focus goes to
// the page's title rather than falling to the page.
import {
  dataError,
  type BookingPageView,
  type CaptureListState,
  type CaptureListView,
  type DataLayer,
} from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { deferred, openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LinksScreen } from './LinksScreen.tsx';

/** A booking page as the list holds it. */
function pageOf(id: string, title: string): BookingPageView {
  return {
    id,
    title,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    description: '',
    durations: [30],
    location: { type: 'video' },
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
 * The held list of pages, deleting as the data layer does: the card leaves at once, comes back on a refusal.
 * `answer` settles each delete when the test says.
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
  const remove = vi.fn((_workspace: string, pageId: string) => {
    const before = items;
    show(items.filter((each) => each.id !== pageId));
    const answer = deferred<{ pageId: string }>();
    answers.push(answer);
    return answer.promise.catch((error: unknown) => {
      show(before);
      throw error;
    });
  });
  return { view, remove, answers };
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function renderLinks(pages: readonly BookingPageView[]) {
  const held = pagesOf(pages);
  const data = { bookingPages: { view: () => held.view, remove: held.remove } } as unknown as DataLayer;
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

const alert = () => openDialog('alertdialog');

/** Opens the card's menu and chooses Delete. */
async function chooseDelete(title: string) {
  await userEvent.click(page.getByRole('button', { name: `More for ${title}` }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Delete' }));
  await expect.poll(alert).not.toBeNull();
}

describe('deleting a booking page', () => {
  it('asks first, naming the page; Esc and Cancel change nothing and give focus back', async () => {
    const held = await renderLinks([pageOf('p1', 'Quick chat'), pageOf('p2', 'Demo')]);
    await chooseDelete('Quick chat');
    expect(alert()?.textContent).toContain('Delete “Quick chat”?');
    expect(alert()?.textContent).toContain(
      'The link stops working, and this can’t be undone. Bookings already made stay.',
    );
    const labels = [...(alert()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
    expect(labels[0]).toMatch(/^Cancel/);
    expect(labels.at(-1)).toBe('Delete page');

    await userEvent.keyboard('{Escape}');
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('More for Quick chat');

    await chooseDelete('Quick chat');
    await userEvent.click(page.getByRole('button', { name: /^Cancel/ }));
    await expect.poll(alert).toBeNull();
    expect(held.remove).not.toHaveBeenCalled();
  });

  it('deletes once, busy until the server answers, then gives focus to the title', async () => {
    const held = await renderLinks([pageOf('p1', 'Quick chat'), pageOf('p2', 'Demo')]);
    await chooseDelete('Quick chat');
    await userEvent.click(page.getByRole('button', { name: 'Delete page' }));
    // The card left at once; the confirm waits, busy, and a second press sends nothing.
    await expect.poll(() => alert()?.textContent).toContain('Deleting');
    await userEvent.click(page.getByRole('button', { name: /Deleting/ }), { force: true });
    expect(held.remove).toHaveBeenCalledTimes(1);
    expect(held.remove).toHaveBeenCalledWith('acme', 'p1');
    expect(document.body.textContent).not.toContain('More for Quick chat');
    held.answers[0]?.resolve({ pageId: 'p1' });
    await expect.poll(alert).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Captures');
  });

  it('keeps a refusal inside the confirm, with the card back, and tries again from there', async () => {
    const held = await renderLinks([pageOf('p1', 'Quick chat')]);
    await chooseDelete('Quick chat');
    await userEvent.click(page.getByRole('button', { name: 'Delete page' }));
    held.answers[0]?.reject(dataError('FORBIDDEN', 'Only its owner can delete it.'));
    await expect.poll(() => alert()?.textContent).toContain('Only its owner can delete it.');
    expect(alert()).not.toBeNull();
    // The last card left and came back while the confirm stayed open over it.
    expect(document.querySelector('[aria-label="More for Quick chat"]')).not.toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Delete page' }));
    expect(held.remove).toHaveBeenCalledTimes(2);
    held.answers[1]?.resolve({ pageId: 'p1' });
    await expect.poll(alert).toBeNull();
  });
});
