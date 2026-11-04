// Save and resume on the visitor's side (spec 0063, AC-6319), in a real
// browser. What is worth holding here is the shape of the promise the form
// makes: Finish later keeps what is typed and hands back a link, a stepped
// form keeps itself on Continue, and a form whose page keeps nothing draws no
// Finish later at all rather than a button that does nothing.
import '../styles/index.css';
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';
import type { HostedFill, HostedFormKept } from './use-hosted-form.ts';

const FORM: PublicForm = {
  key: 'half-filled',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about your project',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'q-name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true },
    { id: 'q-company', key: 'company', label: 'Company', answerType: 'short_text', required: false },
  ],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;
let kept: HostedFill[];

beforeEach(() => {
  host = document.createElement('div');
  host.style.inlineSize = '900px';
  document.body.append(host);
  kept = [];
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

/** A page that keeps every fill it is given and hands back a link, as the real one does. */
const saver = () => ({
  onSave: (fill: HostedFill): Promise<HostedFormKept> => {
    kept.push(fill);
    return Promise.resolve({
      resumeToken: 'a'.repeat(43),
      resumeUrl: 'https://forms.example.com/f/half-filled?resume=' + 'a'.repeat(43),
      expiresAt: '2026-12-03T00:00:00.000Z',
    });
  },
});

it('keeps what is typed and offers the ways back, with the day it stops working and no raw link (T23)', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page', ...saver() });
  const name = host.querySelector('input');
  if (name === null) throw new Error('the form drew no input');
  await userEvent.fill(name, 'Ada');

  await userEvent.click(page.getByRole('button', { name: 'Finish later' }));
  await expect.poll(() => kept.length).toBe(1);
  expect(kept[0]?.answers.name).toBe('Ada');

  // A quiet tick and Saved, and the ways back: Copy link carries the link, which never shows raw.
  await expect.element(page.getByText('Saved', { exact: true })).toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  expect(host.textContent).not.toContain('?resume=');
  // The day it stops working, in words, not an ISO timestamp.
  await expect.element(page.getByText(/December/u)).toBeInTheDocument();
  // Closed again by Keep filling it in; Finish later is back, one quiet link.
  await userEvent.click(page.getByRole('button', { name: 'Keep filling it in' }));
  await expect.element(page.getByRole('button', { name: 'Finish later' })).toBeInTheDocument();
});

it('never opens the ways back on its own: a save as they move on says Saved alone (T23)', async () => {
  const stepped: PublicForm = {
    ...FORM,
    layout: 'conversational',
  };
  drawn = mountHostedForm(host, stepped, { mode: 'page', ...saver() });
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  const name = host.querySelector('input');
  if (name === null) throw new Error('the form drew no input');
  await userEvent.fill(name, 'Ada');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => kept.length).toBe(1);
  await expect.element(page.getByText('Saved', { exact: true })).toBeInTheDocument();
  expect(page.getByRole('button', { name: 'Copy link' }).query()).toBeNull();
});

it('draws no Finish later on a form whose page keeps nothing', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  expect(host.textContent).not.toContain('Finish later');
});

it('keeps nothing in the builder’s preview, which is nobody’s half filled form', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'preview', ...saver() });
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  expect(host.textContent).not.toContain('Finish later');
  expect(kept).toEqual([]);
});

it('keeps a stepped form on Continue, naming the step it opens on (AC-6319)', async () => {
  const stepped: PublicForm = {
    ...FORM,
    layout: 'steps',
    steps: [
      { id: 'who', keys: ['name', 'email'] },
      { id: 'more', title: 'Your company', keys: ['company'] },
    ],
  };
  drawn = mountHostedForm(host, stepped, { mode: 'page', ...saver() });
  // The step layouts arrive as their own chunk, so the first step is drawn a tick after mounting.
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThanOrEqual(2);
  const inputs = host.querySelectorAll('input');
  const name = inputs[0];
  const email = inputs[1];
  if (name === undefined || email === undefined) throw new Error('the first step drew one input');
  await userEvent.fill(name, 'Ada');
  await userEvent.fill(email, 'ada@example.com');
  await userEvent.click(page.getByRole('button', { name: 'Continue' }));

  // Kept as they move on, with the step they are moving to, so the link reopens there and not at the start.
  await expect.poll(() => kept.length).toBe(1);
  expect(kept[0]?.stepId).toBe('more');
  expect(kept[0]?.answers).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
});

it('opens a resumed fill on the step it was left on, with its answers already there', async () => {
  const stepped: PublicForm = {
    ...FORM,
    layout: 'steps',
    steps: [
      { id: 'who', keys: ['name', 'email'] },
      { id: 'more', title: 'Your company', keys: ['company'] },
    ],
  };
  drawn = mountHostedForm(host, stepped, {
    mode: 'page',
    ...saver(),
    prefill: { name: 'Ada', email: 'ada@example.com' },
    resumedStepId: 'more',
  });
  // The second step, not the first: they already answered the first one last time.
  await expect.element(page.getByText('Your company')).toBeInTheDocument();
});
