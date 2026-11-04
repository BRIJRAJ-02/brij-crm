// A form closed while a visitor fills it in (forms fixes 2): Send is refused as closed, and the alert says the
// owner's own closed message when the form has one, else the language's line. Their answers stay.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'talk-to-us',
  status: 'live',
  versionNumber: 1,
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [{ id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true }],
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

/** Fills the form, sends it into a refusal as closed, and answers the alert's words. */
async function closedAlert(form: PublicForm): Promise<string | null | undefined> {
  drawn = mountHostedForm(host, form, { mode: 'page', onSubmit: () => Promise.resolve({ kind: 'closed' }) });
  await userEvent.fill(page.getByLabelText('Your name'), 'Ada Lovelace');
  await userEvent.click(page.getByRole('button', { name: 'Send' }));
  await expect.poll(() => host.querySelector('[role="alert"]')?.textContent ?? '').not.toBe('');
  await expect.element(page.getByLabelText('Your name')).toHaveValue('Ada Lovelace');
  return host.querySelector('[role="alert"]')?.textContent;
}

describe('a form closed mid fill', () => {
  it('says the owner’s closed message', async () => {
    expect(await closedAlert({ ...FORM, closedMessage: 'Sign ups are full. See you next year.' })).toBe(
      'Sign ups are full. See you next year.',
    );
  });

  it('says the language’s line when the owner wrote none', async () => {
    const line = await closedAlert(FORM);
    expect(line).not.toBe('');
    expect(line).not.toContain('See you next year');
  });
});
