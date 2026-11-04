// The hosted form on a phone, in Chromium at 390 wide (critique c, 9, 5 November 2026): a 0 to 10 scale keeps one
// row with every number whole, a yes or no is two choices to tap, and a ranking shows no numbers until it is made.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../styles/index.css';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'phone',
  status: 'live',
  versionNumber: 1,
  headline: 'How did we do?',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    {
      id: 'q-score',
      key: 'score',
      label: 'How likely are you to recommend us?',
      answerType: 'scale',
      required: true,
      options: { from: 0, to: 10, lowLabel: 'Not likely', highLabel: 'Very likely' },
    },
    { id: 'q-again', key: 'again', label: 'Would you come again?', answerType: 'yes_no', required: false },
    {
      id: 'q-rank',
      key: 'rank',
      label: 'Rank these',
      answerType: 'ranking',
      required: false,
      choices: ['Price', 'Speed', 'Support'],
    },
  ],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;

beforeEach(async () => {
  await page.viewport(390, 844);
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

it('keeps 0 to 10 on one row at 390, every number whole', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  await expect.element(page.getByText('10', { exact: true })).toBeVisible();
  const points = [...host.querySelectorAll('button')].filter((each) => /^\d+$/.test(each.textContent.trim()));
  expect(points).toHaveLength(11);
  const tops = new Set(points.map((each) => Math.round(each.getBoundingClientRect().top)));
  expect(tops.size).toBe(1);
  // No number is cut: each fits its button.
  for (const point of points) expect(point.scrollWidth).toBeLessThanOrEqual(point.clientWidth + 1);
});

it('asks a yes or no as two choices to tap, and ranks nothing until the visitor does', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  await expect.element(page.getByRole('radio', { name: 'Yes' })).toBeInTheDocument();
  await expect.element(page.getByRole('radio', { name: 'No' })).toBeInTheDocument();
  expect(page.getByRole('switch').query()).toBeNull();
  // The ranking loads on its own; its rows carry the choice alone, no place number yet.
  await expect
    .poll(() => [...host.querySelectorAll('[data-ranking-row]')].map((row) => row.textContent))
    .toEqual(['Price', 'Speed', 'Support']);
});
