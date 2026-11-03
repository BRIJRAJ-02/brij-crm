// Spec 0063 slice 5 on the hosted page, in a real browser through the page's own entry: a jump that shortens a
// Steps form and sends the visitor straight to an ending, a label that recalls an earlier answer as plain text,
// and the ending's own heading and button on the thank you (AC-6313, AC-6315, AC-6316, AC-6317).
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../styles/index.css';
import { mountHostedForm, type HostedFormHandle, type HostedSubmission } from './hosted-form.ts';

/** Picks a choice the way a visitor on a keyboard does: focus its radio, then Space. */
async function pick(name: string) {
  (page.getByRole('radio', { name }).element() as HTMLElement).focus();
  await userEvent.keyboard(' ');
}

const UNDER = { join: 'all' as const, rules: [{ key: 'budget', op: 'is' as const, value: 'Under $1k' }] };

const FORM: PublicForm = {
  key: 'qualify',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about the work',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  layout: 'steps',
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    {
      id: 'budget',
      key: 'budget',
      label: 'Budget, {{name}}?',
      answerType: 'choice',
      required: true,
      choices: ['Under $1k', '$10k'],
      points: [2, 5],
    },
    { id: 'team', key: 'team', label: 'Team size', answerType: 'number', required: true },
  ],
  steps: [
    { id: 's1', keys: ['name'] },
    { id: 's2', keys: ['budget'], jumps: [{ when: UNDER, to: { ending: 'no_fit' } }] },
    { id: 's3', keys: ['team'] },
  ],
  endings: [{ id: 'no_fit', heading: 'Thanks {{name}}, we are not a fit', line: 'You scored {{score}}.' }],
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

describe('jumps, recall and endings on the page (spec 0063, AC-6313, AC-6315, AC-6317)', () => {
  it('recalls the typed name as text, jumps to the ending, and shows the ending’s heading and button', async () => {
    const sent: HostedSubmission[] = [];
    drawn = mountHostedForm(host, FORM, {
      mode: 'page',
      onSubmit: (submission) => {
        sent.push(submission);
        // The server's own answer: the ending's words, with its recalls already read, and its button.
        return Promise.resolve({
          kind: 'done' as const,
          next: {
            kind: 'message' as const,
            text: 'You scored 2.',
            heading: 'Thanks <b>Ada</b>, we are not a fit',
            ending: 'no_fit',
            button: { url: 'https://example.com/guide', label: 'Read the guide' },
          },
        });
      },
    });

    // No total here, and this case is why (AC-6304): step 2 can jump to an ending, so the three steps the form
    // holds are not three steps this visitor will be given. The old line promised "Step 1 of 3" and then handed
    // them two, which is the promise this form cannot keep. Counting up keeps none.
    await expect.element(page.getByText('Step 1').first()).toBeVisible();
    expect(host.textContent).not.toContain('Step 1 of 3');
    await userEvent.fill(page.getByLabelText('Your name'), '<b>Ada</b>');
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));

    // The label recalls the name, and a name holding markup shows its angle brackets as characters.
    await expect.element(page.getByText('Budget, <b>Ada</b>?')).toBeVisible();
    expect(host.querySelector('b')).toBeNull();
    await page.screenshot({ path: '../../.vitest/shots/s5-recall-light.png' });

    // "Under $1k" jumps to the ending, so this step becomes the last and its button sends.
    await pick('Under $1k');
    await expect.element(page.getByText('Step 2 of 2').first()).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Send' }));

    await expect.poll(() => sent.length).toBe(1);
    // Only the answers on the path are sent: the team size was never asked.
    expect(Object.keys(sent[0]?.answers ?? {}).sort()).toEqual(['budget', 'name']);
    await expect.element(page.getByRole('heading', { name: 'Thanks <b>Ada</b>, we are not a fit' })).toBeVisible();
    await expect.element(page.getByText('You scored 2.')).toBeVisible();
    // A real link, so it keeps a link's own middle click and new tab, and an unsafe address is refused by safeHref.
    const button = page.getByRole('link', { name: 'Read the guide' });
    await expect.element(button).toBeVisible();
    expect((button.element() as HTMLAnchorElement).getAttribute('href')).toBe('https://example.com/guide');
    // The answers read-back reads the label as it was asked, never with its braces showing.
    expect(host.textContent).not.toContain('{{name}}');
    await page.screenshot({ path: '../../.vitest/shots/s5-ending-light.png' });
  });

  it('asks every step when no jump matches, and draws the ending in dark', async () => {
    drawn = mountHostedForm(host, { ...FORM, look: { colour: 'dark', corners: 'rounded' } }, { mode: 'page' });
    await userEvent.fill(page.getByLabelText('Your name'), 'Ada');
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));
    await pick('$10k');
    await expect.element(page.getByText('Step 2 of 3').first()).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));
    await expect.element(page.getByLabelText('Team size')).toBeVisible();
    await page.screenshot({ path: '../../.vitest/shots/s5-steps-dark.png' });
  });

  it('shows the ending the path names in a preview, which sends nothing', async () => {
    drawn = mountHostedForm(host, FORM, { mode: 'page' });
    await userEvent.fill(page.getByLabelText('Your name'), 'Ada');
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));
    await pick('Under $1k');
    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    // With nowhere to send, the page reads the ending itself: the same words, the same score.
    await expect.element(page.getByRole('heading', { name: 'Thanks Ada, we are not a fit' })).toBeVisible();
    await expect.element(page.getByText('You scored 2.')).toBeVisible();
  });
});
