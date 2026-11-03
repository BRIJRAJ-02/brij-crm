// What the hosted form tells its page to count (spec 0063, AC-6320, AC-6321),
// measured in a real browser: a start when the first answer is given, and a
// reach for each question the visitor actually has on screen. These are the
// numbers the Analytics tab shows, so the thing worth holding is that each is
// said once however often the form draws, and that a question in a step the
// visitor never got to is never counted as reached.
import '../styles/index.css';
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';
import type { HostedFormCount } from './use-hosted-form.ts';

const QUESTIONS = [
  { id: 'q-name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
  { id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true },
  { id: 'q-company', key: 'company', label: 'Company', answerType: 'short_text', required: false },
] as const;

const FORM: PublicForm = {
  key: 'counted',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about your project',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [...QUESTIONS],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;
let counted: HostedFormCount[];

beforeEach(() => {
  host = document.createElement('div');
  host.style.inlineSize = '900px';
  document.body.append(host);
  counted = [];
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

/** The options every case shares: the counts land in `counted`. */
const options = () => ({ mode: 'page' as const, onCount: (count: HostedFormCount) => counted.push(count) });

/** The ids counted as reached, in the order they were counted. */
const reached = () => counted.flatMap((count) => (count.kind === 'reach' ? [count.questionId] : []));

it('counts a Classic form’s questions as reached once, and no start until one is answered', async () => {
  drawn = mountHostedForm(host, FORM, options());
  await expect.poll(reached).toEqual(['q-name', 'q-email', 'q-company']);
  expect(counted.filter((count) => count.kind === 'start')).toHaveLength(0);

  const name = host.querySelector('input');
  if (name === null) throw new Error('the form drew no input');
  await userEvent.fill(name, 'Ada');

  await expect.poll(() => counted.filter((count) => count.kind === 'start')).toHaveLength(1);
  // A second answer is the same visit still going, not a second start, and no question is reached twice.
  const email = host.querySelectorAll('input')[1];
  if (email === undefined) throw new Error('the form drew one input');
  await userEvent.fill(email, 'ada@example.com');
  await expect.poll(() => counted.filter((count) => count.kind === 'start')).toHaveLength(1);
  expect(reached()).toEqual(['q-name', 'q-email', 'q-company']);
});

it('counts only the step on screen, so a question never reached is never counted (AC-6321)', async () => {
  const stepped: PublicForm = {
    ...FORM,
    layout: 'steps',
    steps: [{ keys: ['name', 'email'] }, { id: 'more', title: 'Your company', keys: ['company'] }],
  };
  drawn = mountHostedForm(host, stepped, options());
  // The first step's two, and not the second step's one: the visitor has not been given it.
  await expect.poll(reached).toEqual(['q-name', 'q-email']);
});

it('says nothing at all in the builder’s preview, which is nobody’s visit', async () => {
  drawn = mountHostedForm(host, FORM, { ...options(), mode: 'preview' });
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  expect(counted).toEqual([]);
});
