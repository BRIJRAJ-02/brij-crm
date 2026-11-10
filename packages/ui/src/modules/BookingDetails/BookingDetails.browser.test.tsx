// The booking page's details step answering a refusal (Q55), in a real
// browser: an error on a field the form shows goes under it, as before; a
// refusal on nothing it draws an error on (a time zone, a phone the page never
// asked for, the note, the guest list) says the answer's sentence in the line
// above the buttons and keeps what the visitor typed; a guest's error lands on
// the row that guest came from. Guests are rows, one email each (9 November
// 2026): blank rows are left out, a repeat goes once, a bad address stays to
// fix, a pasted list fills rows, and a removed row is said.
// The library's layers and tokens first, as every page loads them: the width test reads the sizes they set.
import '../../styles/index.css';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { BookingDetails, type BookingDetailsOutcome, type BookingDetailsProps } from './BookingDetails.tsx';

const mounted: (() => void)[] = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <UiProvider locale="en-US" timeZone="Europe/London" navigate={() => undefined} toasts={createToasts()}>
      {node}
    </UiProvider>,
  );
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
}

/** The details step answering `outcome`, its send counted. */
function details(outcome: BookingDetailsOutcome, props: Partial<BookingDetailsProps> = {}) {
  const onSubmit = vi.fn(() => Promise.resolve(outcome));
  render(<BookingDetails onBack={() => undefined} onSubmit={onSubmit} {...props} />);
  return onSubmit;
}

const form = () => page.getByRole('form', { name: 'Your details' });

describe('the details step’s width', () => {
  it('runs its fields to the same edges as Back and Confirm', async () => {
    await page.viewport(1280, 800);
    render(<BookingDetails onBack={() => undefined} onSubmit={() => Promise.resolve({ kind: 'done' })} />);
    await expect.element(page.getByRole('button', { name: 'Back' })).toBeVisible();
    // The field's drawn box, around the input and its inset.
    const input = page.getByRole('textbox', { name: /Your name/ }).element();
    const name = (input.parentElement ?? input).getBoundingClientRect();
    const back = page.getByRole('button', { name: 'Back' }).element().getBoundingClientRect();
    const confirm = page
      .getByRole('button', { name: /Confirm/ })
      .element()
      .getBoundingClientRect();
    expect(name.left).toBe(back.left);
    expect(name.right).toBe(confirm.right);
  });
});
const line = () => form().getByRole('alert');
const nameBox = () => page.getByRole('textbox', { name: /Your name/ });
const emailBox = () => page.getByRole('textbox', { name: /^Email/ });
const noteBox = () => page.getByRole('textbox', { name: /Anything the host should know/ });

async function fillAndSend() {
  await userEvent.fill(nameBox(), 'Ada Lovelace');
  await userEvent.fill(emailBox(), 'ada@example.com');
  await userEvent.fill(noteBox(), 'Bring the slides.');
  await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
}

describe('a refusal on a field the form does not show', () => {
  it('says the answer’s sentence above the buttons and keeps what was typed', async () => {
    const onSubmit = details({
      kind: 'invalid',
      fields: { timeZone: 'Pick a time zone from the list.' },
      message: 'Pick a time zone from the list.',
    });
    await fillAndSend();
    expect(onSubmit).toHaveBeenCalledOnce();
    await expect.element(line()).toHaveTextContent('Pick a time zone from the list.');
    await expect.element(nameBox()).toHaveValue('Ada Lovelace');
    await expect.element(emailBox()).toHaveValue('ada@example.com');
    await expect.element(noteBox()).toHaveValue('Bring the slides.');
    await expect.element(nameBox()).not.toHaveAttribute('aria-invalid');
    await expect.element(emailBox()).not.toHaveAttribute('aria-invalid');
    // Confirm is free again, so the visitor can send once more.
    await expect.element(page.getByRole('button', { name: 'Confirm booking' })).toBeEnabled();
  });

  it('says it for a phone on a page that never asked for one', async () => {
    details({
      kind: 'invalid',
      fields: { phone: 'Give a number to call you on.' },
      message: 'Give a number to call you on.',
    });
    await fillAndSend();
    await expect.element(line()).toHaveTextContent('Give a number to call you on.');
  });

  it('says it for the note and for the guest list as a whole', async () => {
    details({
      kind: 'invalid',
      fields: { note: 'Keep the note to 2,000 characters.', guests: 'Invite at most 10 guests.' },
      message: 'Keep the note to 2,000 characters.',
    });
    await fillAndSend();
    await expect.element(line()).toHaveTextContent('Keep the note to 2,000 characters.');
  });

  it('falls back to its own sentence when the answer has none', async () => {
    details({ kind: 'invalid', fields: { start: 'Pick a time.' } });
    await fillAndSend();
    await expect.element(line()).toHaveTextContent('That did not go through. Try again in a moment.');
  });
});

describe('a refusal on a field the form shows (unchanged)', () => {
  it('goes under that field, with the line left empty', async () => {
    details({
      kind: 'invalid',
      fields: { email: 'Give an email address such as name@example.com.' },
      message: 'Give an email address such as name@example.com.',
    });
    await fillAndSend();
    await expect.element(emailBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(form().getByText('Give an email address such as name@example.com.')).toBeVisible();
    await expect.poll(() => line().element().textContent).toBe('');
    await expect.element(emailBox()).toHaveValue('ada@example.com');
  });

  it('puts a guest’s error on the row that guest came from', async () => {
    const onSubmit = details({
      kind: 'invalid',
      fields: { 'guest-1': 'Give each guest’s email address.' },
      message: 'Give each guest’s email address.',
    });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await addGuest('grace@example.com');
    await addGuest('');
    await addGuest('alan@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ guests: ['grace@example.com', 'alan@example.com'] }),
    );
    // The second address sent came from the third row: the blank one was left out.
    await expect.element(guestRow(3)).toHaveAttribute('aria-invalid', 'true');
    await expect.element(guestRow(1)).not.toHaveAttribute('aria-invalid');
    await expect.poll(() => line().element().textContent).toBe('');
  });
});

/** The row a press on Add guests (or Add another guest) opens, filled with `email`. */
async function addGuest(email: string) {
  const add = page.getByRole('button', { name: /^Add (guests|another guest)$/ });
  await userEvent.click(add);
  if (email !== '') await userEvent.keyboard(email);
}
const guestRow = (row: number) => page.getByRole('textbox', { name: `Guest ${String(row)} email` });
const status = () => [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(' ');

describe('guests, one email a row', () => {
  it('opens a row on Add guests with its own name and the most it takes beside Guests', async () => {
    details({ kind: 'done' });
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await expect.element(guestRow(1)).toHaveFocus();
    await expect.element(page.getByText('(up to 10)')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Add another guest' })).toBeVisible();
  });

  it('sends the filled rows in order, each once, leaving out a blank row', async () => {
    const onSubmit = details({ kind: 'done' });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await addGuest('grace@example.com');
    await addGuest('');
    await addGuest('Grace@example.com');
    await addGuest('alan@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ guests: ['grace@example.com', 'alan@example.com'] }),
    );
  });

  it('keeps an address that isn’t one in its row to fix, saying why, and sends nothing', async () => {
    const onSubmit = details({ kind: 'done' });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await addGuest('alan@example');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await expect.element(guestRow(1)).toHaveAttribute('aria-invalid', 'true');
    await expect.element(guestRow(1)).toHaveValue('alan@example');
  });

  it('fills rows from a pasted list', async () => {
    details({ kind: 'done' });
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    // A paste lands as one change of the whole value, as fill makes it.
    await userEvent.fill(guestRow(1), 'grace@example.com, alan@example.com\nkatherine@example.com');
    await expect.element(guestRow(3)).toHaveValue('katherine@example.com');
  });

  it('removes a row with its ×, says so, and gives focus back to Add guests when none is left', async () => {
    details({ kind: 'done' });
    await addGuest('grace@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Remove grace@example.com' }));
    await expect.poll(status).toContain('Removed grace@example.com.');
    await expect.element(page.getByRole('button', { name: 'Add guests' })).toHaveFocus();
  });
});

describe('the honeypot', () => {
  it('carries no name autofill knows, keeps password managers out, and sends empty', async () => {
    const onSubmit = details({ kind: 'done' });
    await expect.element(nameBox()).toBeVisible();
    const trap = document.querySelector<HTMLInputElement>('[aria-hidden="true"] input');
    expect(trap?.name).toBe('tf-trap');
    expect(trap?.getAttribute('autocomplete')).toBe('off');
    expect(trap?.getAttribute('data-1p-ignore')).toBe('true');
    expect(trap?.getAttribute('data-lpignore')).toBe('true');
    expect(trap?.getAttribute('data-bwignore')).toBe('true');
    await fillAndSend();
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect((onSubmit.mock.calls[0] as readonly unknown[] | undefined)?.[0]).toMatchObject({ trap: '' });
  });
});
