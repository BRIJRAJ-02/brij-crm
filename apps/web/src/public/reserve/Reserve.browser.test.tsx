// The reservation page in Chromium (spec 0066 B7 lite), in checklabs' order on the booking page's frame: the party, a
// date and a time ("Choose a date"), the Book bar ("Pick a time", then "Continue · {day}, {time}"), then Your details
// over the card with Back, its button "Confirm {day} at {time}". Back keeps what was typed. A phone shows a strip of
// days with the full calendar a press away, and the Book bar only once a time is picked. axe is clean in light and
// dark at a desktop's and a phone's width, on the times and on the details. With VITE_SHOT_DIR set, each is shot.
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
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [
        day,
        [
          { from: '12:00', to: '15:00' },
          { from: '18:00', to: '22:00' },
        ],
      ]),
    ),
    exceptions: [],
  },
  today: TODAY,
  areas: ['Inside', 'Terrace'],
};

function clientOf(sent: PublicReserveInput[]): TableClient {
  return {
    times: (_key: string, query: { readonly date: string }) =>
      Promise.resolve({
        date: query.date,
        times: ['12:00', '12:30', '18:00', '18:30', '19:00', '19:30', '20:00'].map(
          (at) => `${query.date}T${at}:00.000Z`,
        ),
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
  await expect.element(page.getByRole('heading', { name: 'Choose a date' })).toBeInTheDocument();
  return sent;
}

async function shoot(name: string, theme: Theme, width: number) {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}-${String(width)}.png` });
}

/** The times draw in (a short fade and stagger): checks read them once they have landed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 800));

describe('the reservation page (checklabs’ order on the booking frame)', () => {
  it('picks a time, continues to the details, and confirms the day and time', async () => {
    const sent = await show(1280);
    await expect.element(page.getByRole('heading', { level: 1, name: 'Reserve your table' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Pick a time' })).toBeDisabled();
    await expect.element(page.getByText('Lunch', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Dinner', { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /^19:30/ }));
    await userEvent.click(page.getByRole('button', { name: 'Continue · Mon 14 Jan, 19:30' }));
    await expect.element(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    // checklabs' order: Full name, Phone, Email, Special requests; Seating when the place has areas.
    const names = [...document.querySelectorAll('form input[name], form textarea[name]')].map((field) =>
      field.getAttribute('name'),
    );
    expect(names.slice(0, 4)).toEqual(['name', 'phone', 'email', 'note']);
    await expect.element(page.getByText('Terrace', { exact: true })).toBeVisible();
    await userEvent.fill(page.getByRole('textbox', { name: /Full name/ }), 'Ada Lovelace');
    await userEvent.fill(page.getByRole('textbox', { name: /Phone/ }), '07700 900123');
    await userEvent.fill(page.getByRole('textbox', { name: /Email/ }), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Confirm Mon 14 Jan at 19:30' }));
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
      party: 2,
      name: 'Ada Lovelace',
      phone: '07700 900123',
      start: '2030-01-14T19:30:00.000Z',
      marketing: false,
    });
  });

  it('keeps what was typed through Back', async () => {
    await show(1280);
    await userEvent.click(page.getByRole('button', { name: /^18:30/ }));
    await userEvent.click(page.getByRole('button', { name: /^Continue/ }));
    await userEvent.fill(page.getByRole('textbox', { name: /Full name/ }), 'Ada Lovelace');
    await userEvent.fill(page.getByRole('textbox', { name: /Phone/ }), '07700 900123');
    await userEvent.click(page.getByRole('button', { name: 'Back' }));
    await userEvent.click(page.getByRole('button', { name: /^20:00/ }));
    await userEvent.click(page.getByRole('button', { name: 'Continue · Mon 14 Jan, 20:00' }));
    await expect.element(page.getByRole('textbox', { name: /Full name/ })).toHaveValue('Ada Lovelace');
    await expect.element(page.getByRole('textbox', { name: /Phone/ })).toHaveValue('07700 900123');
    expect(page.getByText(/Booking as/).elements()).toHaveLength(0);
  });

  it('shows a strip of days on a phone, and the Book bar only once a time is picked', async () => {
    await show(390);
    expect(page.getByRole('button', { name: /^Continue|^Pick a time$/ }).elements()).toHaveLength(0);
    await expect.element(page.getByRole('button', { name: 'Full calendar' })).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(page.getByRole('button', { name: 'Full calendar' }));
    await expect.element(page.getByRole('button', { name: 'Full calendar' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(page.getByRole('button', { name: /^18:00/ }));
    await expect.element(page.getByRole('button', { name: 'Continue · Mon 14 Jan, 18:00' })).toBeVisible();
  });

  for (const width of [1280, 390]) {
    it(`passes axe in light and dark at ${String(width)}px, on the times and on the details`, async () => {
      await show(width);
      await userEvent.click(page.getByRole('button', { name: /^19:00/ }));
      for (const theme of THEMES) {
        applyTheme(theme);
        await settle();
        expect(await axeViolations()).toEqual([]);
        await shoot('reserve', theme, width);
      }
      await userEvent.click(page.getByRole('button', { name: /^Continue/ }));
      for (const theme of THEMES) {
        applyTheme(theme);
        await settle();
        expect(await axeViolations()).toEqual([]);
        await shoot('reserve-details', theme, width);
      }
    });
  }
});
