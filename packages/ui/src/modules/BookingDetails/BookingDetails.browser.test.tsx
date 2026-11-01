// The booking page's details step answering a refusal (Q55), in a real
// browser: an error on a field the form shows goes under it, as before; a
// refusal on nothing it draws an error on (a time zone, a phone the page never
// asked for, the note, the guest list) says the answer's sentence in the line
// above the buttons and keeps what the visitor typed; a guest's error lands on
// the chip that guest came from. Guests are chips (1 November 2026): what is
// still typed goes with the booking, a pasted list splits, a bad address stays
// to fix, and every change is said.
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

  it('puts a guest’s error on the chip that guest came from', async () => {
    const onSubmit = details({
      kind: 'invalid',
      fields: { 'guest-1': 'Give each guest’s email address.' },
      message: 'Give each guest’s email address.',
    });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(guestsBox(), 'grace@example.com,alan@example.c,');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ guests: ['grace@example.com', 'alan@example.c'] }));
    await expect.element(guestsBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => chip('alan@example.c').hasAttribute('data-invalid')).toBe(true);
    await expect.poll(() => chip('grace@example.com').hasAttribute('data-invalid')).toBe(false);
    await expect.poll(() => line().element().textContent).toBe('');
  });
});

const guestsBox = () => page.getByRole('textbox', { name: /^Guests/ });
// Each chip's address, without its avatar's initial.
const chips = () =>
  [...document.querySelectorAll('ul[aria-label="Guests to invite"] > li .ws-guest-chips-text')].map(
    (item) => item.textContent,
  );
const chip = (email: string) => {
  const found = [...document.querySelectorAll('ul[aria-label="Guests to invite"] > li')].find((item) =>
    item.textContent.includes(email),
  );
  if (found === undefined) throw new Error(`no chip for ${email}`);
  return found;
};
const status = () => [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(' ');

describe('guests as chips', () => {
  it('sends an address still being typed when Confirm is pressed, never dropping it', async () => {
    const onSubmit = details({ kind: 'done' });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(guestsBox(), 'grace@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ guests: ['grace@example.com'] }));
  });

  it('carries an address once when it is taken twice, whichever takes it first', async () => {
    const onSubmit = details({ kind: 'done' });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(guestsBox(), 'grace@example.com{Enter}');
    await expect.poll(chips).toEqual(['grace@example.com']);
    // The same address again, still in the field: submit takes it and the blur after it takes it again.
    await userEvent.type(guestsBox(), 'Grace@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ guests: ['grace@example.com'] }));
    await expect.poll(chips).toEqual(['grace@example.com']);
  });

  it('takes an address on Enter without booking, and on leaving the field', async () => {
    const onSubmit = details({ kind: 'done' });
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(guestsBox(), 'grace@example.com{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    await expect.poll(chips).toEqual(['grace@example.com']);
    await expect.element(guestsBox()).toHaveValue('');
    await userEvent.type(guestsBox(), 'alan@example.com');
    await userEvent.click(noteBox());
    await expect.poll(chips).toEqual(['grace@example.com', 'alan@example.com']);
  });

  it('splits a pasted list on commas, new lines and spaces, once each', async () => {
    details({ kind: 'done' });
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    // A paste lands as one change of the whole value, as fill makes it.
    await userEvent.fill(guestsBox(), 'grace@example.com, alan@example.com\nkatherine@example.com grace@example.com ');
    await expect.poll(chips).toEqual(['grace@example.com', 'alan@example.com', 'katherine@example.com']);
  });

  it('keeps an address that isn’t one in the field to fix, saying why', async () => {
    const onSubmit = details({ kind: 'done' });
    await userEvent.fill(nameBox(), 'Ada Lovelace');
    await userEvent.fill(emailBox(), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(guestsBox(), 'grace@example.com, alan@example ');
    await expect.poll(chips).toEqual(['grace@example.com']);
    await expect.element(guestsBox()).toHaveValue('alan@example');
    await expect.element(guestsBox()).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(page.getByRole('button', { name: 'Confirm booking' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(guestsBox(), '.com{Enter}');
    await expect.poll(chips).toEqual(['grace@example.com', 'alan@example.com']);
    await expect.element(guestsBox()).not.toHaveAttribute('aria-invalid');
  });

  it('says each chip added and removed, and removes from the keyboard alone', async () => {
    details({ kind: 'done' });
    await userEvent.click(page.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(guestsBox(), 'grace@example.com alan@example.com{Enter}');
    await expect.poll(status).toContain('Added alan@example.com.');
    // Backspace in the empty field takes the last chip off.
    await userEvent.keyboard('{Backspace}');
    await expect.poll(chips).toEqual(['grace@example.com']);
    await expect.poll(status).toContain('Removed alan@example.com.');
    // Each chip's remove button is reachable by Tab: back from the field to it, and Enter.
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(page.getByRole('button', { name: 'Remove grace@example.com' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(chips).toEqual([]);
    await expect.element(guestsBox()).toHaveFocus();
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
