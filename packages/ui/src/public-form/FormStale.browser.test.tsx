// A form published again while a visitor fills it in (late trap #18), in a real browser through the page's own
// entry: the server refuses on a question this page never drew; the page reads the new version and draws it in
// place, keeping every answer already given, and says so, rather than re-enabling the button with nothing said.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle, type HostedSubmitOutcome } from './hosted-form.ts';

const V1: PublicForm = {
  key: 'talk-to-us',
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
const V2: PublicForm = {
  ...V1,
  versionNumber: 2,
  questions: [
    ...V1.questions,
    { id: 'budget', key: 'budget', label: 'Budget', answerType: 'short_text', required: true },
  ],
};

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

describe('a form published again mid fill (late trap #18)', () => {
  it('draws the new version in place, keeps the answers, and says so', async () => {
    const refused: HostedSubmitOutcome = { kind: 'invalid', fields: { budget: 'Answer this question.' } };
    const handle = mountHostedForm(host, V1, {
      mode: 'page',
      onSubmit: () => Promise.resolve(refused),
      onStale: () => {
        handle.update(V2);
        return Promise.resolve(true);
      },
    });
    drawn = handle;
    await userEvent.fill(page.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.fill(page.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    await expect
      .poll(() => host.querySelector('[role="alert"]')?.textContent)
      .toBe(
        'This form was updated while you filled it in. Your answers are kept. Answer any new questions and send again.',
      );
    await expect.element(page.getByLabelText('Budget')).toBeVisible();
    await expect.element(page.getByLabelText('Your name')).toHaveValue('Ada Lovelace');
    await expect.element(page.getByLabelText('Work email')).toHaveValue('ada@example.com');
  });
});
