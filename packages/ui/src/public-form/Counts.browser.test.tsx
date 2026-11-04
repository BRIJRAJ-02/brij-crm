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

it('counts nothing but a look until an answer: then the start, and a Classic question once answered (critique c)', async () => {
  drawn = mountHostedForm(host, FORM, options());
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  // A look is not a start, and seeing every question at once reaches none of them.
  expect(counted).toEqual([]);

  const name = host.querySelector('input');
  if (name === null) throw new Error('the form drew no input');
  await userEvent.fill(name, 'Ada');
  await expect.poll(() => counted.filter((count) => count.kind === 'start')).toHaveLength(1);
  // The start comes first, then the furthest answered question.
  expect(counted[0]?.kind).toBe('start');
  await expect.poll(reached).toEqual(['q-name']);

  // A later answer reaches it and those before it, once each; still one start.
  const company = host.querySelectorAll('input')[2];
  if (company === undefined) throw new Error('the form drew too few inputs');
  await userEvent.fill(company, 'Acme');
  await expect.poll(reached).toEqual(['q-name', 'q-email', 'q-company']);
  expect(counted.filter((count) => count.kind === 'start')).toHaveLength(1);
});

it('counts only the step on screen, once the visitor has started, so a question never reached is never counted (AC-6321)', async () => {
  const stepped: PublicForm = {
    ...FORM,
    layout: 'steps',
    steps: [{ keys: ['name', 'email'] }, { id: 'more', title: 'Your company', keys: ['company'] }],
  };
  drawn = mountHostedForm(host, stepped, options());
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  expect(counted).toEqual([]);
  const name = host.querySelector('input');
  if (name === null) throw new Error('the form drew no input');
  await userEvent.fill(name, 'Ada');
  // The first step's two, and not the second step's one: the visitor has not been given it.
  await expect.poll(reached).toEqual(['q-name', 'q-email']);
});

it('says nothing at all in the builder’s preview, which is nobody’s visit', async () => {
  drawn = mountHostedForm(host, FORM, { ...options(), mode: 'preview' });
  await expect.poll(() => host.querySelectorAll('input').length).toBeGreaterThan(0);
  expect(counted).toEqual([]);
});

// How many steps a visitor is promised (spec 0063, AC-6304). A form with jumps
// cannot know its own length: the total it would show is the path the answers
// have taken so far, and a later answer can take a step away. Saying "Step 1 of
// 3" and then giving them two is a promise broken; saying "Step 1" is no promise
// made. Once the steps ahead hold no jump the total is certain, and it returns.
it('always says Step x of y, counting the longest path while a jump ahead may shorten it (critique c)', async () => {
  const plain: PublicForm = {
    ...FORM,
    layout: 'steps',
    steps: [
      { id: 'who', keys: ['name', 'email'] },
      { id: 'more', keys: ['company'] },
    ],
  };
  drawn = mountHostedForm(host, plain, { mode: 'page' });
  await expect
    .poll(() => host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
    .toBe('Step 1 of 2');
  drawn.destroy();

  const jumping: PublicForm = {
    ...FORM,
    layout: 'steps',
    steps: [
      { id: 'who', keys: ['name'] },
      { id: 'more', keys: ['email'], jumps: [{ when: { join: 'all', rules: [] }, to: { ending: 'thanks' } }] },
      { id: 'last', keys: ['company'] },
    ],
  };
  drawn = mountHostedForm(host, jumping, { mode: 'page' });
  // Step 2 can jump past step 3: the total is still the longest path, so it can only shrink, never grow.
  await expect
    .poll(() => host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext'))
    .toBe('Step 1 of 3');
});
