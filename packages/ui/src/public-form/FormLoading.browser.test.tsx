// The hosted form's loading shape, measured in a real browser (24 October
// 2026): what a visitor sees before the form has been read has to be the
// shape of the form that arrives, or the page moves under them. One component
// owns its styles, so the loading shape keeps its own copy of the Classic
// form's questions column; this holds the two together, so a change to either
// that parts them fails here rather than on a visitor's phone.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mountFormLoading, mountHostedForm, type HostedFormHandle } from './hosted-form.ts';
import '../styles/index.css';

const FORM: PublicForm = {
  key: 'loading-shape',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about your project',
  subheading: 'It takes about a minute.',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'email', key: 'email', label: 'Work email', answerType: 'email', required: true },
    { id: 'company', key: 'company', label: 'Company', answerType: 'short_text', required: false },
  ],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;

beforeEach(() => {
  host = document.createElement('div');
  host.style.inlineSize = '900px';
  document.body.append(host);
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

/** The box of the one element `selector` names inside the host. */
function boxOf(selector: string): DOMRect {
  const found = host.querySelector(selector);
  if (found === null) throw new Error(`nothing matched ${selector}`);
  return found.getBoundingClientRect();
}

/** How the one element `selector` names lays its column out: the gap between rows and where the column starts. */
function columnOf(selector: string): { readonly gap: string; readonly start: string } {
  const found = host.querySelector(selector);
  if (found === null) throw new Error(`nothing matched ${selector}`);
  const style = globalThis.getComputedStyle(found);
  return { gap: style.rowGap, start: style.marginBlockStart };
}

it('stands the questions’ column where the questions’ column will stand', () => {
  drawn = mountFormLoading(host, 'page');
  const ghostCard = boxOf('[data-frame="card"]');
  // The column of question places: the header's sibling.
  const ghostColumn = columnOf('header + *');
  drawn.destroy();
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  const card = boxOf('[data-frame="card"]');
  const column = columnOf('form');

  // The card sits in the same place and is the same width.
  expect(Math.abs(ghostCard.left - card.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(ghostCard.width - card.width)).toBeLessThanOrEqual(1);
  // The two copies of the questions' column rule agree, so the places the questions will take are the places
  // they were drawn in. This is the check that fails if someone changes one copy and not the other.
  expect(ghostColumn).toEqual(column);
  expect(ghostColumn.gap).not.toBe('0px');
});

it('says what it is waiting for, and guesses no look it would have to take back', () => {
  drawn = mountFormLoading(host, 'page');
  const ground = host.querySelector('[data-frame="card"]');
  expect(ground?.getAttribute('aria-busy')).toBe('true');
  expect(ground?.hasAttribute('data-theme')).toBe(false);
  expect(ground?.hasAttribute('data-corners')).toBe(false);
  expect(host.textContent).toContain('Loading the form');
  // No heading stands empty while its words are still coming.
  expect(host.querySelectorAll('h1, h2, h3')).toHaveLength(0);
});
