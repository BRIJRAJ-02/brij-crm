// A question's description on the visitor's page (5 November 2026): a quiet line in the secondary colour, under the
// control in Classic and Steps, and under the large heading with One at a time, with a recall read in it.
import '../styles/index.css';
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'described',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about your project',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    {
      id: 'q-budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'short_text',
      required: false,
      description: 'A rough number is fine.',
    },
    { id: 'q-name', key: 'name', label: 'Your name', answerType: 'short_text', required: false },
  ],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;

beforeEach(() => {
  host = document.createElement('div');
  host.style.inlineSize = '600px';
  document.body.append(host);
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

/** The description's line, and the question's field, as drawn. */
const line = () => [...host.querySelectorAll('p')].find((each) => each.textContent === 'A rough number is fine.');

for (const layout of ['classic', 'steps', 'conversational'] as const) {
  it(`draws the description once, quiet, after the question's words (${layout})`, async () => {
    // One at a time opens on its first question when it has no headline (no welcome screen to pass).
    drawn = mountHostedForm(
      host,
      { ...FORM, layout, ...(layout === 'conversational' ? { headline: '' } : {}) },
      { mode: 'page' },
    );
    await expect.poll(() => line(), { timeout: 10_000 }).toBeDefined();
    expect(
      [...host.querySelectorAll('p')].filter((each) => each.textContent === 'A rough number is fine.'),
    ).toHaveLength(1);
    const shown = line();
    if (shown === undefined) throw new Error('No description.');
    // Secondary text, quieter than the form's own headline.
    const headline = host.querySelector('h1, h2');
    expect(getComputedStyle(shown).color).not.toBe(getComputedStyle(headline ?? host).color);
    // After the question's words in reading order.
    const words = [...host.querySelectorAll('label, p')].find((each) => each.textContent.includes('Budget'));
    expect(words?.compareDocumentPosition(shown)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Said by a screen reader as focus enters the answer: the question's group is described by the line.
    const group = host.querySelector('[role="group"][aria-label="Budget"]');
    expect(group?.getAttribute('aria-describedby')).toBe(shown.id);
    // A question with none draws none.
    expect(host.textContent.match(/A rough number is fine\./g)?.length).toBe(1);
  });
}
