// Spec 0063's batch two in a real browser, through the hosted page's own entry: a Ranking sorted from the keyboard
// (Space on a grip, an arrow, Space) and by dragging, and a Signature signed by typing a name instead, which sends
// a PNG of the name once the visitor pauses. The answers sent are the order and the upload's id.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../styles/index.css';
import type { HostedUploadOutcome } from './files.ts';
import { mountHostedForm, type HostedFormHandle, type HostedSubmission } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'agree',
  status: 'live',
  versionNumber: 1,
  headline: 'Before we start',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    {
      id: 'rank',
      key: 'rank',
      label: 'Rank these by importance',
      answerType: 'ranking',
      required: true,
      choices: ['Price', 'Speed', 'Support'],
    },
    { id: 'sign', key: 'sign', label: 'Sign to agree', answerType: 'signature', required: true },
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

describe('signature and ranking (spec 0063, AC-6307, AC-6308)', () => {
  it('sorts by keyboard, signs by typing, and sends the order and the drawing', async () => {
    const uploads: File[] = [];
    const sent: HostedSubmission[] = [];
    drawn = mountHostedForm(host, FORM, {
      mode: 'page',
      onUpload: (file) => {
        uploads.push(file);
        const outcome: HostedUploadOutcome = {
          kind: 'done',
          file: {
            fileId: '01a19070-abed-72aa-bda5-e28af82c31e3',
            name: file.name,
            size: file.size,
            contentType: file.type,
          },
        };
        return Promise.resolve(outcome);
      },
      onRemoveUpload: () => Promise.resolve(),
      onSubmit: (submission) => {
        sent.push(submission);
        return Promise.resolve({ kind: 'done', next: { kind: 'message', text: '' } });
      },
    });

    // Untouched, a required ranking and signature are asked for.
    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    await expect.element(page.getByText('Answer this question.').first()).toBeVisible();

    // Speed up one place, from the keyboard on its grip.
    const speed = page.getByRole('button', { name: 'Move Speed' });
    await userEvent.click(speed);
    (speed.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');
    await expect
      .poll(() => [...host.querySelectorAll('[data-ranking-row]')].map((row) => row.textContent))
      .toEqual(['1Speed', '2Price', '3Support']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Speed');

    // Sign by typing a name instead: focus lands in the box, and the drawing goes once typing pauses.
    await userEvent.click(page.getByRole('button', { name: 'Type your name instead' }));
    await expect.element(page.getByLabelText('Your full name')).toHaveFocus();
    await userEvent.keyboard('Ada Lovelace');
    await expect.poll(() => uploads.length, { timeout: 3_000 }).toBe(1);
    expect(uploads[0]?.type).toBe('image/png');
    expect(uploads[0]?.size).toBeLessThan(300 * 1024);
    await expect.element(page.getByRole('img', { name: 'Ada Lovelace' })).toBeVisible();
    await page.screenshot({ path: '../../.vitest/shots/b2-light.png' });

    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.answers).toMatchObject({
      rank: ['Speed', 'Price', 'Support'],
      sign: { fileId: '01a19070-abed-72aa-bda5-e28af82c31e3' },
    });
  });

  it('draws in dark, and sorts by dragging a grip', async () => {
    drawn = mountHostedForm(host, { ...FORM, look: { colour: 'dark', corners: 'rounded' } }, { mode: 'page' });
    const grip = page.getByRole('button', { name: 'Move Support' }).element() as HTMLElement;
    const first = host.querySelector('[data-ranking-row]')?.getBoundingClientRect();
    const box = grip.getBoundingClientRect();
    const x = box.left + box.width / 2;
    grip.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: box.top + 4, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: (first?.top ?? 0) + 2, pointerId: 1 }));
    await expect.poll(() => host.querySelector('[data-drop]')?.getAttribute('data-drop')).toBe('before');
    await page.screenshot({ path: '../../.vitest/shots/b2-dark-dragging.png' });
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: (first?.top ?? 0) + 2, pointerId: 1 }));
    await expect.poll(() => host.querySelector('[data-ranking-row]')?.textContent).toBe('1Support');
  });

  it('lets a visitor go Back mid pause and still send, and shows the kept signature on return', async () => {
    const uploads: File[] = [];
    const sent: HostedSubmission[] = [];
    drawn = mountHostedForm(
      host,
      {
        ...FORM,
        layout: 'steps',
        steps: [
          { id: 'one', keys: ['rank'] },
          { id: 'two', keys: ['sign'] },
        ],
      },
      {
        mode: 'page',
        onUpload: (file) => {
          uploads.push(file);
          return Promise.resolve({
            kind: 'done',
            file: {
              fileId: '01a19070-abed-72aa-bda5-e28af82c31e3',
              name: file.name,
              size: file.size,
              contentType: file.type,
            },
          });
        },
        onRemoveUpload: () => Promise.resolve(),
        onSubmit: (submission) => {
          sent.push(submission);
          return Promise.resolve({ kind: 'done', next: { kind: 'message', text: '' } });
        },
      },
    );
    // Keeping the shown order answers: pick a row up and put it down where it was.
    const price = page.getByRole('button', { name: 'Move Price' });
    await expect.element(price).toBeVisible();
    (price.element() as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard(' ');
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));
    // Type a name, then go Back before the pause ends: nothing is sent, and nothing holds the form.
    await userEvent.click(page.getByRole('button', { name: 'Type your name instead' }));
    await userEvent.keyboard('Ada');
    await userEvent.click(page.getByRole('button', { name: 'Back' }));
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));
    expect(uploads.length).toBe(0);
    await userEvent.click(page.getByRole('button', { name: 'Type your name instead' }));
    await userEvent.keyboard('Ada Lovelace');
    await expect.poll(() => uploads.length, { timeout: 3_000 }).toBe(1);
    // Back and on again: the pad says it is signed, and Send goes.
    await userEvent.click(page.getByRole('button', { name: 'Back' }));
    await userEvent.click(page.getByRole('button', { name: 'Continue' }));
    await expect.element(page.getByRole('img', { name: 'Signed' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Send' }));
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.answers).toMatchObject({ rank: ['Price', 'Speed', 'Support'] });
  });
});
