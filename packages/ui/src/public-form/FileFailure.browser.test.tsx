// A file that didn't upload (forms fix b8): the message says what happened (the form can't take files now, never
// "try again" when trying can't help), the drop area names what it takes, and the form asks once before it sends the
// rest without the file rather than sending in silence.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../styles/index.css';
import { mountHostedForm, type HostedFormHandle, type HostedSubmission } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'cv',
  status: 'live',
  versionNumber: 1,
  headline: 'Apply',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'cv', key: 'cv', label: 'Your CV', answerType: 'file', required: false },
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

describe('a file that didn’t upload (forms fix b8)', () => {
  it('says the form can’t take files, and asks once before sending without it', async () => {
    const sent: HostedSubmission[] = [];
    drawn = mountHostedForm(host, FORM, {
      mode: 'page',
      onUpload: () => Promise.resolve({ kind: 'unavailable' }),
      onRemoveUpload: () => Promise.resolve(),
      onSubmit: (submission) => {
        sent.push(submission);
        return Promise.resolve({ kind: 'done', next: { kind: 'message', text: '' } });
      },
    });
    await expect.element(page.getByText(/PDF, images or Office files/)).toBeVisible();
    await userEvent.fill(page.getByLabelText(/Your name/), 'Ada');
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('No file input.');
    await userEvent.upload(input, new File(['cv'], 'cv.pdf', { type: 'application/pdf' }));
    await expect.element(page.getByText(/can’t take files right now/).first()).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    await expect.element(page.getByText(/Press Send again/).first()).toBeVisible();
    expect(sent).toHaveLength(0);
    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    await expect.poll(() => sent.length).toBe(1);
  });
});
