// The hosted form's Brand look and its foot, in a real browser (spec 0063, AC-6327, AC-6328):
//   - a form whose read names a kit wears its logo, on our own origin and nothing else's;
//   - a plain form's read names none, so the page draws no logo and asks for no picture at all;
//   - "Powered by Timefix" sits under the form in every mode and every layout, and nothing takes it away.
// The look's own colours come from the page's brand stylesheet (`FormParts.module.css`), which is the served file,
// so they are not drawn here; what this holds is the markup the page makes of what the read said.
// The stylesheet FIRST, before anything that pulls a CSS module. `styles/index.css` opens with
// `@layer reset, tokens, base, components, utilities;`, and a layer's place in the cascade is fixed by its first
// appearance: a component's module CSS parsed before that statement registers `components` early, `reset` lands
// after it, and reset's `button { color: inherit }` then beats the primary Button's `color: var(--on-accent)`.
// That is a harness-only cascade (the built pages link `/layers.css` from their head, before any module), and it
// draws a brand's button label in the page's text colour instead of the colour its kit chose. Keep this import
// first, or the shots below stop being what a visitor sees.
import '../styles/index.css';
import type { PublicForm } from '@crm/contracts/forms';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { mountHostedForm, type HostedFormHandle, type HostedFormMode } from './hosted-form.ts';

const FORM: PublicForm = {
  key: 'project-enquiry',
  status: 'live',
  versionNumber: 1,
  headline: 'Tell us about your project',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded', theme: 'brand' },
  offersMeeting: false,
  questions: [{ id: 'email', key: 'email', label: 'Work email', answerType: 'email', required: true }],
};

/** The kit as a form's read names it (spec 0060): a logo version, never a colour or a path the page made up. */
const WORN: PublicForm = { ...FORM, brand: { version: '0123456789ab', logo: '0123456789ab' } };

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

/** Draws `form` as a hosted page would, or as an embed does. */
function draw(form: PublicForm, mode: HostedFormMode = 'page'): void {
  drawn = mountHostedForm(host, form, { mode, onSubmit: () => Promise.resolve({ kind: 'failed', message: 'no' }) });
}

/** Every picture the drawn form asks for. */
const pictures = (): readonly string[] =>
  [...host.querySelectorAll('img')].map((image) => image.getAttribute('src') ?? '');

it('wears the workspace logo from our own address, and never another origin (AC-6327)', () => {
  draw(WORN);
  const logo = host.querySelector('img[src^="/api/public/forms/"]');
  expect(logo?.getAttribute('src')).toBe('/api/public/forms/project-enquiry/logo?v=0123456789ab');
  // The logo is decoration beside the headline, which already names the form.
  expect(logo?.getAttribute('alt')).toBe('');
  for (const src of pictures()) expect(src.startsWith('/')).toBe(true);
});

it('draws no logo for a form whose read names no kit (AC-6327)', () => {
  draw({ ...FORM, look: { colour: 'light', corners: 'rounded', theme: 'plain' } });
  expect(host.querySelector('img[src^="/api/public/forms/"]')).toBeNull();
});

it('keeps "Powered by Timefix" under the form on a page, in an embed and in the dark (AC-6328)', () => {
  for (const [mode, form] of [
    ['page', WORN],
    ['embed', WORN],
    ['page', { ...FORM, look: { colour: 'dark', corners: 'square', theme: 'brand' } }],
  ] as const) {
    draw(form, mode);
    const foot = host.querySelector('footer');
    const mark = foot?.querySelector('a');
    expect(foot?.textContent).toContain('Powered by');
    expect(mark?.querySelector('img')?.getAttribute('alt')).toBe('Timefix');
    // Quiet and aligned (spec 0058, AC-26): under the form, on its own line, and left where the card's edge is.
    for (const [name, value] of ORANGE) document.documentElement.style.setProperty(name, value);
    const card = host.querySelector('[class*="card"]');
    expect(foot).not.toBeNull();
    expect(card).not.toBeNull();
    if (foot !== null && card !== null) {
      expect(foot.getBoundingClientRect().top).toBeGreaterThanOrEqual(card.getBoundingClientRect().bottom - 1);
    }
    drawn?.destroy();
    drawn = undefined;
  }
});

it('keeps the mark under a Steps form too (AC-6328)', async () => {
  draw({
    ...WORN,
    layout: 'steps',
    steps: [{ id: 's1', keys: ['email'] }],
  });
  // The layout arrives in its own chunk; the loading shape stands in its place until it does.
  await expect.poll(() => host.querySelector('footer')?.textContent ?? '').toContain('Powered by');
});

/** A stand in picture, as the stories draw one: our own bytes, never another origin. */
const mark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 210"><rect x="0" y="40" width="130" height="130" rx="65" fill="${fill}"/><rect x="170" y="70" width="520" height="70" rx="12" fill="${fill}"/></svg>`,
  )}`;

/** The workspace's logo, in its accent. */
const LOGO = mark('#e8590c');

/** The Timefix wordmark the hosted page serves from `public/brand`, which this test's server has no copy of. */
const PRODUCT = { light: mark('#1a1a1a'), dark: mark('#f5f5f5') };

/** The accent pair spec 0060's guard makes of `#e8590c`, as the served stylesheet holds it (`brandProperties`). */
const ORANGE: readonly (readonly [string, string])[] = [
  ['--brand-accent', '#e65708'],
  ['--brand-on-accent', '#000000'],
  ['--brand-link', '#b74300'],
  ['--brand-accent-dark', '#e8590c'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#fd6c2b'],
];

for (const colour of ['light', 'dark'] as const) {
  it(`draws the brand look and the Timefix mark in ${colour} (AC-6327, AC-6328)`, async () => {
    // A page sized window, so the shot shows the whole card and its foot, as a visitor's own page does.
    await page.viewport(1200, 900);
    host.style.inlineSize = '100%';
    drawn = mountHostedForm(
      host,
      { ...WORN, look: { colour, corners: 'rounded', theme: 'brand' } },
      { mode: 'page', logo: PRODUCT, brand: { logo: { src: LOGO, alt: '' }, variables: ORANGE } },
    );
    await expect.element(page.getByRole('button', { name: 'Send' })).toBeVisible();
    expect(host.querySelector('footer')?.textContent).toContain('Powered by');
    // After the page settles: the look's own transition is done, so the shot is not caught mid theme change.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
    // The kit reaches the control the visitor presses, both halves (spec 0060, AC-4, AC-5): the fill is the
    // brand's own colour for this mode, and the label is the colour the guard chose to read on it (black for this
    // accent), never the page's text colour. White on this orange is 3.3:1, so this pair is the AA check.
    const send = host.querySelector('button[type="submit"]');
    const painted = send === null ? undefined : globalThis.getComputedStyle(send);
    expect(painted?.backgroundColor).toBe(colour === 'dark' ? 'rgb(232, 89, 12)' : 'rgb(230, 87, 8)');
    expect(painted?.color).toBe('rgb(0, 0, 0)');
    await page.screenshot({ path: `../../.vitest/shots/s9-brand-form-${colour}.png` });
  });
}
