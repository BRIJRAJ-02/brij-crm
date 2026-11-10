// Unsubscribing from news and offers in Chromium (10 November 2026): the page asks first and sends nothing until
// Unsubscribe is pressed, then says it's done (announced) and offers Subscribe again, which only says to check the
// email; a link that opens nothing says so; the signed up page carries the quiet "Changed your mind? Unsubscribe".
// Keyboard only, and axe is clean in light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set,
// each is shot.
import '@crm/ui/styles.css';
import type { PublicTablePage, TableClient } from '@crm/data/tables';
import { BookingProvider, GuestLook } from '@crm/ui/public-booking';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { NewsConfirm } from './NewsConfirm.tsx';
import { NewsUnsubscribe } from './NewsUnsubscribe.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;

const PAGE: PublicTablePage = {
  key: 'AbCdEfGhIjKlMnOp',
  business: { name: 'Somewhere Nowhere' },
  place: { name: 'Soho', addressLine: '12 Greek Street', city: 'London', phone: '+44 20 7946 0000', timeZone: 'UTC' },
  taking: true,
  partyMin: 1,
  partyMax: 8,
  windowDays: 60,
  cancelCutoffMinutes: 120,
  changeCutoffMinutes: 120,
  hours: { weekly: {}, exceptions: [] },
  today: '2030-01-14',
  areas: [],
};

interface Calls {
  readonly sent: string[];
}

function clientOf(calls: Calls, refuse?: 'NOT_FOUND'): TableClient {
  const answer = <T,>(name: string, value: T) => {
    calls.sent.push(name);
    if (refuse !== undefined)
      return Promise.reject(Object.assign(new Error('gone'), { name: 'DataError', code: refuse }));
    return Promise.resolve(value);
  };
  return {
    unsubscribeNews: () => answer('unsubscribe', { status: 'unsubscribed' as const }),
    resubscribeNews: () => answer('subscribe', { status: 'check_email' as const }),
    confirmNews: () => answer('confirm', { status: 'confirmed' as const, unsubscribeToken: 'nu1.token.sig' }),
  } as unknown as TableClient;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  resetTheme();
});

async function show(width: number, child: ReactNode) {
  await page.viewport(width, width < 600 ? 844 : 900);
  host = document.createElement('div');
  document.body.append(host);
  const made = createRoot(host);
  root = made;
  act(() => {
    made.render(
      <BookingProvider locale="en-GB" timeZone="UTC">
        <GuestLook>{child}</GuestLook>
      </BookingProvider>,
    );
  });
}

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

async function clean(name: string, width: number) {
  for (const theme of THEMES) {
    applyTheme(theme);
    await settle();
    expect(await axeViolations()).toEqual([]);
    await shoot(name, theme, width);
  }
}

describe('unsubscribing from news and offers', () => {
  it('asks first, unsubscribes on the press by keyboard, then subscribes again only by email', async () => {
    const calls: Calls = { sent: [] };
    await show(
      1280,
      <NewsUnsubscribe client={clientOf(calls)} page={PAGE} placeKey={PAGE.key} token="nu1.token.sig" />,
    );
    await expect.element(page.getByRole('heading', { name: 'Unsubscribe from Somewhere Nowhere?' })).toBeVisible();
    // Link scanners open the address too: nothing is sent before the press.
    expect(calls.sent).toEqual([]);
    const button = page.getByRole('button', { name: 'Unsubscribe' });
    (button.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    // A message, as the signed up page is: its heading takes focus, so a second Enter presses nothing.
    await expect.element(page.getByRole('heading', { level: 1, name: 'You’re unsubscribed' })).toHaveFocus();
    await expect.element(page.getByText('Somewhere Nowhere won’t email you news and offers any more.')).toBeVisible();
    expect(calls.sent).toEqual(['unsubscribe']);
    await userEvent.click(page.getByRole('button', { name: 'Subscribe again' }));
    await expect.element(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    expect(calls.sent).toEqual(['unsubscribe', 'subscribe']);
  });

  it('still unsubscribes when the place’s page didn’t load, by the token alone', async () => {
    const calls: Calls = { sent: [] };
    await show(390, <NewsUnsubscribe client={clientOf(calls)} page={undefined} placeKey={PAGE.key} token="nu1.t.s" />);
    await expect.element(page.getByRole('heading', { name: 'Unsubscribe from these emails?' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Unsubscribe' }));
    await expect.element(page.getByText('You won’t get news and offers by email any more.')).toBeVisible();
    expect(calls.sent).toEqual(['unsubscribe']);
    await clean('news-unsubscribed-no-page', 390);
  });

  it('says a link that opens nothing no longer works', async () => {
    const calls: Calls = { sent: [] };
    await show(
      1280,
      <NewsUnsubscribe client={clientOf(calls, 'NOT_FOUND')} page={PAGE} placeKey={PAGE.key} token="nu1.bad" />,
    );
    await userEvent.click(page.getByRole('button', { name: 'Unsubscribe' }));
    await expect.element(page.getByRole('heading', { level: 1, name: 'This link no longer works' })).toBeVisible();
  });

  it('offers the quiet way out on the signed up page', async () => {
    const calls: Calls = { sent: [] };
    await show(1280, <NewsConfirm client={clientOf(calls)} page={PAGE} token="rn1.token.sig" />);
    await userEvent.click(page.getByRole('button', { name: 'Yes, send me news' }));
    await expect.element(page.getByRole('heading', { level: 1, name: 'You’re signed up' })).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Changed your mind? Unsubscribe' }))
      .toHaveAttribute('href', '/r/AbCdEfGhIjKlMnOp/manage#unsubscribe=nu1.token.sig');
    await clean('news-signed-up', 1280);
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px, asking and done`, async () => {
      const calls: Calls = { sent: [] };
      await show(
        width,
        <NewsUnsubscribe client={clientOf(calls)} page={PAGE} placeKey={PAGE.key} token="nu1.token.sig" />,
      );
      await expect.element(page.getByRole('button', { name: 'Unsubscribe' })).toBeVisible();
      await clean('news-unsubscribe', width);
      await userEvent.click(page.getByRole('button', { name: 'Unsubscribe' }));
      await expect.element(page.getByRole('button', { name: 'Subscribe again' })).toBeVisible();
      await clean('news-unsubscribed', width);
      await userEvent.click(page.getByRole('button', { name: 'Subscribe again' }));
      await expect.element(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      await clean('news-check-email', width);
    });
  }
});
