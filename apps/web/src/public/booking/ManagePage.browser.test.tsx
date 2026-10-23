// The guest page when its link opens nothing or its read fails (QA Q76, Q80): a title without a full stop, a way on,
// the tab saying the same as the heading, and Try again that reads once more.
import { BookingProvider } from '@crm/ui/public-booking';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ManagePage } from './ManagePage.tsx';

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.restoreAllMocks();
});

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function show() {
  host = document.createElement('div');
  document.body.append(host);
  const made = createRoot(host);
  root = made;
  act(() => {
    made.render(
      <BookingProvider locale="en-US" timeZone="UTC">
        <ManagePage token="old-token" isWelcome={false} locale="en-US" now={() => Date.now()} />
      </BookingProvider>,
    );
  });
}

describe('ManagePage', () => {
  it('says a link that opens nothing plainly, with a way on, and names the tab the same', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer(404, { code: 'NOT_FOUND', message: 'Not found.' }));
    show();
    await expect
      .element(page.getByRole('heading', { level: 1, name: 'This link doesn’t open a booking' }))
      .toBeVisible();
    await expect
      .element(page.getByText('Open the one in the latest email about this booking.', { exact: false }))
      .toBeVisible();
    expect(document.title).toBe('This link doesn’t open a booking · Timefix');
  });

  it('offers Try again when the read fails, and reads once more', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(answer(500, { code: 'INTERNAL', message: 'Something went wrong.' }))
      .mockResolvedValue(answer(404, { code: 'NOT_FOUND', message: 'Not found.' }));
    show();
    await expect.element(page.getByRole('heading', { level: 1, name: 'This page didn’t load' })).toBeVisible();
    expect(document.title).toBe('This page didn’t load · Timefix');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect
      .element(page.getByRole('heading', { level: 1, name: 'This link doesn’t open a booking' }))
      .toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('puts focus on the booking’s heading once Try again reads it, as the button it pressed is gone', async () => {
    const booking = {
      state: 'confirmed',
      publicKey: 'intro',
      title: 'Intro call',
      hostName: 'Ada Host',
      start: '2099-11-02T09:00:00.000Z',
      end: '2099-11-02T09:30:00.000Z',
      timeZone: 'UTC',
      location: { type: 'video' },
      visitorName: 'Grace Hopper',
      visitorEmail: 'grace@example.com',
      guests: [],
      workspaceSlug: 'acme',
      canChange: false,
      canMove: false,
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(answer(500, { code: 'INTERNAL', message: 'Something went wrong.' }))
      .mockResolvedValue(answer(200, booking));
    show();
    await page.getByRole('button', { name: 'Try again' }).click();
    const heading = page.getByRole('heading', { level: 1, name: 'Your booking' });
    await expect.element(heading).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(heading.element());
    expect(document.title).toBe('Your booking · Timefix');
  });
});
