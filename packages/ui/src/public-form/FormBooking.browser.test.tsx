// The hosted form's countdown to a booking page (spec 0023 AC-1059), in a real
// browser through the page's own entry: the sentence said once, the number
// counting down, going on at nought, Book now, Stay here, and a countdown of
// nought going at once.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle, type HostedSubmitOutcome } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'book-after',
  status: 'live',
  versionNumber: 1,
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'email', key: 'email', label: 'Work email', answerType: 'email', required: true },
  ],
};

const URL_TO = '/b/intro-call?p=fb1.token';

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  drawn?.destroy();
  host.remove();
});

/** Draws the form answering a booking hand off after `seconds`, fills it in and sends it. */
async function sendWith(seconds: number) {
  const onRedirect = vi.fn();
  const outcome: HostedSubmitOutcome = {
    kind: 'done',
    next: { kind: 'booking', url: URL_TO, countdownSeconds: seconds, text: 'Thanks, we have it.' },
  };
  drawn = mountHostedForm(host, FORM, { mode: 'page', onSubmit: () => Promise.resolve(outcome), onRedirect });
  await userEvent.fill(page.getByLabelText('Your name'), 'Ada Lovelace');
  await userEvent.fill(page.getByLabelText('Work email'), 'ada@example.com');
  await userEvent.click(page.getByRole('button', { name: 'Send' }));
  return onRedirect;
}

const said = () => host.querySelector('[aria-live="polite"]')?.textContent ?? '';

describe('the countdown to book (AC-1059)', () => {
  it('says it once, counts down, and goes on at nought', async () => {
    const onRedirect = await sendWith(2);
    await expect.element(page.getByRole('heading', { name: 'Thank you. That is with us.' })).toHaveFocus();
    await expect.poll(said).toBe('Taking you to book a time in 2 seconds.');
    await expect.element(page.getByText('Thanks, we have it.')).toBeVisible();
    // A second's tick, on a busy runner: wait past vitest's one second default for it.
    await expect
      .poll(() => host.textContent, { timeout: 3000, interval: 20 })
      .toMatch(/Taking you to book a time in\s*1…/);
    // The sentence never changes as the number does.
    expect(said()).toBe('Taking you to book a time in 2 seconds.');
    await expect.poll(() => onRedirect.mock.calls.length, { timeout: 4000 }).toBe(1);
    expect(onRedirect).toHaveBeenCalledWith(URL_TO);
  });

  it('goes at once with Book now, and only once', async () => {
    const onRedirect = await sendWith(1);
    await userEvent.click(page.getByRole('button', { name: 'Book now' }));
    expect(onRedirect).toHaveBeenCalledWith(URL_TO);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(onRedirect).toHaveBeenCalledTimes(1);
  });

  it('holds while focus is on the buttons', async () => {
    const onRedirect = await sendWith(1);
    await userEvent.tab();
    await expect.element(page.getByRole('button', { name: 'Book now' })).toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it('stops with Stay here, and keeps Book a time for later', async () => {
    const onRedirect = await sendWith(1);
    await userEvent.click(page.getByRole('button', { name: 'Stay here' }));
    await expect.element(page.getByRole('button', { name: 'Book a time' })).toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(onRedirect).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: 'Book a time' }));
    expect(onRedirect).toHaveBeenCalledWith(URL_TO);
  });

  it('goes at once for a countdown of nought', async () => {
    const onRedirect = await sendWith(0);
    await expect.poll(() => onRedirect.mock.calls.length).toBe(1);
    await expect.poll(said).toBe('Taking you to book a time…');
  });
});
