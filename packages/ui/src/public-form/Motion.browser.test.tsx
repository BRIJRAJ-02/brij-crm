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

/** Draws the one at a time form, which opens straight on its first question, focus in it. */
async function started(form: PublicForm = FORM) {
  drawn = mountHostedForm(host, form, { mode: 'page' });
  await expect.poll(() => field()).not.toBeNull();
  await expect.poll(() => host.contains(document.activeElement)).toBe(true);
}
const form = () => host.querySelector<HTMLFormElement>('form:not([aria-hidden])');

it('nudges a required question left empty, then moves on by Enter with focus in the next field', async () => {
  await started();
  await expect.element(page.getByLabelText('Your name')).toHaveFocus();
  await userEvent.click(page.getByRole('button', { name: /OK/ }));
  await expect.poll(() => host.querySelector('[data-invalid]')).not.toBeNull();
  await expect.element(page.getByText('Answer this question.')).toBeInTheDocument();

  await userEvent.fill(page.getByRole('textbox'), 'Ada');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByLabelText('Work email')).toHaveFocus();
  expect(form()?.dataset.enter).toBe('forward');
});

it('goes back with the up arrow, the question coming down from above', async () => {
  await started();
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

it('goes back with the quiet up arrow, keeping what was typed', async () => {
  await started();
  await userEvent.fill(page.getByRole('textbox'), 'Ada');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByLabelText('Work email')).toHaveFocus();
  await userEvent.click(page.getByRole('button', { name: 'Previous question' }));
  await expect.element(page.getByLabelText('Your name')).toHaveValue('Ada');
});

it('opens straight on its first question, the headline small above it, then for screen readers only', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  // No welcome screen and no Start (the owner, 5 November 2026): the first question, its field focused.
  expect(page.getByRole('button', { name: 'Start' }).query()).toBeNull();
  await expect.element(page.getByLabelText('Your name')).toHaveFocus();
  await expect.element(page.getByRole('heading', { name: 'Tell us about your project' })).toBeVisible();
  await expect.element(page.getByText('1 of 2', { exact: true }).first()).toBeVisible();
  // On the next question the headline stays for screen readers only.
  await userEvent.fill(page.getByRole('textbox'), 'Ada');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByLabelText('Work email')).toHaveFocus();
  expect([...host.querySelectorAll('h1')].at(-1)?.getBoundingClientRect().width ?? 0).toBeLessThanOrEqual(1);
  expect(form()?.dataset.enter).toBe('forward');
});

it('picks a lettered choice by its letter and goes on by itself (T42)', async () => {
  await started({
    ...FORM,
    questions: [
      {
        id: 'q-size',
        key: 'size',
        label: 'Team size',
        answerType: 'choice',
        required: true,
        choices: ['1', '2-10', '11+'],
      },
      ...FORM.questions,
    ],
  });
  await expect.element(page.getByText('A', { exact: true })).not.toBeInTheDocument();
  await userEvent.keyboard('b');
  await expect.element(page.getByRole('radio', { name: '2-10' })).toBeChecked();
  await expect.element(page.getByLabelText('Your name')).toHaveFocus();
});

it('keeps the move to a crossfade under reduced motion', async () => {
  const media = globalThis.matchMedia;
  const still = (query: string): MediaQueryList => {
    const real = media.call(globalThis, query);
    if (!query.includes('reduced-motion')) return real;
    const copy = Object.create(real) as MediaQueryList;
    Object.defineProperty(copy, 'matches', { value: true });
    return copy;
  };
  globalThis.matchMedia = still;
  try {
    await started();
    await userEvent.fill(page.getByRole('textbox'), 'Ada');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByLabelText('Work email')).toHaveFocus();
    // The leaving copy fades only: its keyframes carry no transform.
    const ghost = host.querySelector<HTMLElement>('form[aria-hidden]');
    const frames = ghost?.getAnimations()[0]?.effect;
    const keyframes = frames instanceof KeyframeEffect ? frames.getKeyframes() : [];
    expect(keyframes.every((frame) => frame.transform === undefined)).toBe(true);
  } finally {
    globalThis.matchMedia = media;
  }
});
