// A form that sends its visitor on to book (spec 0023 AC-1055 to AC-1059,
// spec 0025 AC-642): a member makes a booking page and a form whose After
// someone sends it is Book a meeting with a 1 second countdown, through the
// API as the settings screen would. A visitor fills the hosted form, sees the
// countdown, lands on the booking page with the signed hand off, and finds
// their name and email already filled in ("Booking as Ada Lovelace."), then
// books. The hand off is read only through the API: the same page with a
// forged token starts empty.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

/** Signs a new person in through Mailpit and names their workspace, patient with a busy machine. */
async function newWorkspace(page: Page, email: string, slug: string): Promise<void> {
  const patient = { timeout: 120_000 };
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/, patient);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page).toHaveURL(/\/welcome$/, patient);
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/`), patient);
}

function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: T }).json;
}

interface FormView {
  readonly id: string;
  readonly publicKey: string;
  readonly revision: number;
  readonly draft: Record<string, unknown>;
}

test.describe('a form that sends its visitor on to book', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the hand off.');

  test('counts down, hands off with the name and email filled, and books', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const tag = randomUUID().slice(0, 8);
    const workspace = `handoff-${tag}`;
    await newWorkspace(page, `handoff-${tag}@example.com`, workspace);

    const booking = await rpc<{ id: string; publicKey: string }>(page, 'bookingPages/create', {
      workspace,
      id: uuidv7(),
      title: 'Intro call',
      timeZone: 'UTC',
      mutationId: randomUUID(),
    });
    const form = await rpc<FormView>(page, 'forms/create', {
      workspace,
      id: uuidv7(),
      name: 'Talk to us',
      mutationId: randomUUID(),
    });
    const saved = await rpc<FormView>(page, 'forms/saveDraft', {
      workspace,
      formId: form.id,
      document: {
        ...form.draft,
        after: { kind: 'booking', bookingPageId: booking.id, countdownSeconds: 1, message: '' },
      },
      expectedRevision: form.revision,
      mutationId: randomUUID(),
    });
    const live = await rpc<FormView>(page, 'forms/publish', {
      workspace,
      formId: form.id,
      expectedRevision: saved.revision,
      mutationId: randomUUID(),
    });

    // The visitor: a browser of their own, signed in to nothing.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(`${new URL(page.url()).origin}/f/${live.publicKey}`);
    await visitor.getByLabel('Your name').fill('Ada Lovelace');
    await visitor.getByLabel('Work email').fill(`ada-${tag}@example.com`);
    // The bot check wants a human's pace.
    await visitor.waitForTimeout(2_500);
    await visitor.getByRole('button', { name: 'Send' }).click();
    await expect(visitor.getByRole('heading', { name: 'Thank you. That is with us.' })).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Book now' })).toBeVisible();

    // On to the booking page with the signed hand off, and nothing else in the address.
    await visitor.waitForURL(new RegExp(`/b/${booking.publicKey}\\?p=fb1\\.`));
    expect(new URL(visitor.url()).searchParams.get('name')).toBeNull();
    const handoff = new URL(visitor.url()).searchParams.get('p') ?? '';

    // Pick the first open time, then the details start filled in.
    await visitor
      .getByRole('list', { name: /^Times on / })
      .getByRole('button')
      .first()
      .click();
    await visitor.getByRole('button', { name: /^Book / }).click();
    await expect(visitor.getByText('Booking as Ada Lovelace.')).toBeVisible();
    // The booking's bot check wants a human's pace too.
    await visitor.waitForTimeout(3_500);
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor).toHaveURL(/\/manage\?/);

    // A forged token names nobody: the API reads only what it signed for this page.
    const forged = `${handoff.slice(0, -4)}AAAA`;
    const answer = await visitor.request.get(
      `/api/public/booking/${booking.publicKey}/prefill?p=${encodeURIComponent(forged)}`,
    );
    expect(await answer.json()).toEqual({});
  });
});
