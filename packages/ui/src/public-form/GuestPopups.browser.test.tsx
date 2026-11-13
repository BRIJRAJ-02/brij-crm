// A hosted form's popups wear the form's own look (spec 0074, batch 4, AC-7409, AC-7426): a dropdown opened on a Dark
// form with square corners portals inside the form's themed root, so it is dark and square, and its sheets and dialogs
// take the guest pages' bar height rather than the app's top bar.
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../styles/index.css';
import { mountHostedForm, type HostedFormHandle } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'popups',
  status: 'live',
  versionNumber: 1,
  headline: 'Pick one',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'dark', corners: 'square' },
  offersMeeting: false,
  questions: [
    {
      id: 'q-size',
      key: 'size',
      label: 'Team size',
      answerType: 'dropdown',
      required: false,
      choices: ['Just me', '2 to 10', 'More than 10'],
    },
  ],
};

let host: HTMLElement;
let drawn: HostedFormHandle | undefined;

beforeEach(async () => {
  await page.viewport(1024, 800);
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  drawn?.destroy();
  drawn = undefined;
  host.remove();
});

it('opens a dropdown inside the form’s themed root, dark and square, never on the app’s body', async () => {
  drawn = mountHostedForm(host, FORM, { mode: 'page' });
  await userEvent.click(page.getByRole('button', { name: /Team size/ }));
  const listbox = await page.getByRole('listbox').findElement();
  // Inside the form's own root (its theme and corners), through the popup host at the root's end.
  const root = listbox.closest('[data-frame]');
  expect(root).not.toBeNull();
  expect(root?.getAttribute('data-theme')).toBe('dark');
  expect(listbox.closest('[data-popup-host]')).not.toBeNull();
  // The popover wears the form's square corners and dark colours: what the root sets is what it reads.
  const rootStyle = getComputedStyle(root as Element);
  const listStyle = getComputedStyle(listbox);
  for (const name of ['--radius-md', '--radius-lg', '--surface', '--text']) {
    expect(listStyle.getPropertyValue(name).trim(), name).toBe(rootStyle.getPropertyValue(name).trim());
  }
  // AC-7426: inside the host, the guest pages' bar height, 46px, never the app's 56px top bar.
  const popupHost = listbox.closest('[data-popup-host]');
  const probe = document.createElement('div');
  probe.style.blockSize = 'var(--size-topbar)';
  popupHost?.append(probe);
  expect(probe.getBoundingClientRect().height).toBe(46);
  probe.remove();
});
