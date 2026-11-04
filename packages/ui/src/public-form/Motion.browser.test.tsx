// Moving through a stepped form in a real browser (T23, 5 November 2026, Typeform's interaction): the next question
// comes in from below and Back from above (`data-enter`), the up arrow goes back from a one line field, focus lands
// in the next field, and a required question left empty is marked to nudge, beside its one line.
import '../styles/index.css';
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'one-at-a-time',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about your project',
  buttonText: 'Send',
  language: 'en',
  layout: 'conversational',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'q-name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true },
  ],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;

beforeEach(() => {
  host = document.createElement('div');
  host.style.inlineSize = '900px';
  document.body.append(host);
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

const field = () => host.querySelector('input');
const form = () => host.querySelector('form');

it('nudges a required question left empty, then moves on by Enter with focus in the next field', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  await expect.poll(() => field()).not.toBeNull();
  // The first question has no entrance of its own: nothing has moved yet.
  expect(form()?.dataset.enter).toBeUndefined();
  await userEvent.click(page.getByRole('button', { name: /OK/ }));
  await expect.poll(() => host.querySelector('[data-invalid]')).not.toBeNull();
  await expect.element(page.getByText('Answer this question.')).toBeInTheDocument();

  await userEvent.fill(page.getByRole('textbox'), 'Ada');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByLabelText('Work email')).toHaveFocus();
  expect(form()?.dataset.enter).toBe('forward');
});

it('goes back with the up arrow, the question coming down from above', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  await expect.poll(() => field()).not.toBeNull();
  await userEvent.fill(page.getByRole('textbox'), 'Ada');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByLabelText('Work email')).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(page.getByLabelText('Your name')).toHaveFocus();
  expect(form()?.dataset.enter).toBe('back');
  await expect.element(page.getByLabelText('Your name')).toHaveValue('Ada');
});

it('offers Try again when the form fails to load', async () => {
  const { mountFormMessage } = await import('./hosted-form.ts');
  drawn = mountFormMessage(host, { mode: 'page', kind: 'failed' });
  await expect.element(page.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
