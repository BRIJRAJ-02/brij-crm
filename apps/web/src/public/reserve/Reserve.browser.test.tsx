// The reservation page in Chromium (spec 0066 B7 lite), as checklabs' one page booking form: the day and its times,
// then Your details on the same page, the button named "Confirm {day} at {time}" once a time is picked, and "Choose a
// time first" before any field is checked when it is pressed before. A phone shows a strip of days with the full calendar a press away. axe is
// clean in light and dark at a desktop's and a phone's width. With VITE_SHOT_DIR set, each is photographed.
import '@crm/ui/styles.css';
import type { PublicReserveInput, PublicTablePage, TableClient } from '@crm/data/tables';
import { BookingProvider } from '@crm/ui/public-booking';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES, type Theme } from '../../testing/axe.ts';
import { ReservePage } from './ReservePage.tsx';

const SHOT_DIR = import.meta.env.VITE_SHOT_DIR as string | undefined;
const TODAY = '2030-01-14';

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
  hours: {
    weekly: Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [{ from: '18:00', to: '22:00' }]]),
    ),
    exceptions: [],
  },
  today: TODAY,
};

function clientOf(sent: PublicReserveInput[]): TableClient {
  return {
    times: (_key: string, query: { readonly date: string }) =>
      Promise.resolve({
        date: query.date,
        times: ['18:00', '18:30', '19:00', '19:30', '20:00'].map((at) => `${query.date}T${at}:00.000Z`),
      }),
    reserve: (_key: string, input: PublicReserveInput) => {
      sent.push(input);
      return Promise.resolve({
        visit: {
          lookupCode: 'ABCD2345',
          start: input.start,
          end: input.start,
          party: input.party,
          name: input.name,
          status: 'booked',
        },
        manageToken: 'x'.repeat(32),
      });
    },
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

async function show(width: number) {
  await page.viewport(width, width < 600 ? 844 : 900);
  const sent: PublicReserveInput[] = [];
  host = document.createElement('div');
  document.body.append(host);
  const made = createRoot(host);
  root = made;
  act(() => {
    made.render(
      <BookingProvider locale="en-GB" timeZone="UTC">
        <ReservePage
          client={clientOf(sent)}
          page={PAGE}
          locale="en-GB"
          isEmbedded={false}
          onReserved={() => undefined}
        />
      </BookingProvider>,
    );
  });
  await expect.element(page.getByRole('heading', { name: 'Your details' })).toBeInTheDocument();
  return sent;
}

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

describe('the reservation page (checklabs’ one page form)', () => {
  it('asks for a time first, then confirms the day and time on the same page', async () => {
    const sent = await show(1280);
    // Pressed first, with nothing filled in: the time is asked for before any field.
    await userEvent.click(page.getByRole('button', { name: 'Choose a time to continue' }));
    await expect.element(page.getByText('Choose a time first.')).toBeVisible();
    expect(page.getByText('Give your name.').elements()).toHaveLength(0);
    await userEvent.fill(page.getByRole('textbox', { name: /name/i }), 'Ada Lovelace');
    await userEvent.fill(page.getByRole('textbox', { name: /Email/ }), 'ada@example.com');
    await userEvent.fill(page.getByRole('textbox', { name: /Number to call/ }), '07700 900123');
    await userEvent.click(page.getByRole('button', { name: /^19:30/ }).first());
    await expect.element(page.getByRole('button', { name: /^Confirm .* at 19:30$/ })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /^Confirm / }));
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ party: 2, name: 'Ada Lovelace', start: '2030-01-14T19:30:00.000Z' });
  });

  it('shows a strip of days on a phone, with the full calendar a press away', async () => {
    await show(390);
    await expect.element(page.getByRole('button', { name: 'Full calendar' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Full calendar' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(page.getByRole('button', { name: 'Full calendar' }));
    await expect.element(page.getByRole('button', { name: 'Full calendar' })).toHaveAttribute('aria-expanded', 'true');
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px`, async () => {
      await show(width);
      await userEvent.click(page.getByRole('button', { name: /^19:00/ }).first());
      for (const theme of THEMES) {
        applyTheme(theme);
        // The day's times draw in (a short fade and stagger): axe reads them once they have landed.
        await new Promise((resolve) => setTimeout(resolve, 800));
        expect(await axeViolations()).toEqual([]);
        await shoot('reserve', theme, width);
        // The foot: Your details and the button named for the time.
        document.querySelector('button[type="submit"]')?.scrollIntoView({ block: 'end' });
        await shoot('reserve-foot', theme, width);
        globalThis.scrollTo(0, 0);
      }
    });
  }
});
