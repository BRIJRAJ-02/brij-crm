// No inline style the production policy refuses (22 October 2026): `vite
// preview`, the flows' server in CI, sends each page vercel.json's style-src
// (deployedStylePolicy in vite.config.ts). A person signs in and makes a
// workspace (sign in, verify, the first run, Home, People), opens the workspace
// menu, then a visitor opens a live form and a booking page. No page reports a
// style-src violation: production's console said "Applying inline style
// violates ... style-src 'self'" on every page with a button, from React Aria's
// injected <style> (style-csp.test.ts has the static checks).
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

interface Violation {
  readonly page: string;
  readonly directive: string;
  readonly source: string;
}

/** Records every CSP violation each page of `context` reports, with the address it happened on. */
async function watch(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen: Violation[] = [];
    (window as unknown as { __violations: Violation[] }).__violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push({ page: location.pathname, directive: event.violatedDirective, source: event.sourceFile });
    });
  });
}

/** The violations the page has reported since it loaded. */
async function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(() => (window as unknown as { __violations?: Violation[] }).__violations ?? []);
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

test.describe('inline styles under the production policy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough: the styles are the same at both.');

  test('the app, a hosted form and a booking page report no style-src violation', async ({ page, browser }) => {
    test.setTimeout(240_000);
    // The flows' server sends the policy; a dev server (no policy) has nothing to check.
    const policy = (await page.request.get('/sign-in')).headers()['content-security-policy'] ?? '';
    test.skip(!policy.includes('style-src'), 'This server sends no style-src (a dev server).');

    await watch(page.context());
    const tag = randomUUID().slice(0, 8);
    const workspace = `csp-${tag}`;
    await newWorkspace(page, `csp-${tag}@example.com`, workspace);
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    const found = await violations(page);

    const booking = await rpc<{ publicKey: string }>(page, 'bookingPages/create', {
      workspace,
      id: uuidv7(),
      title: 'Intro call',
      timeZone: 'UTC',
      mutationId: randomUUID(),
    });
    const form = await rpc<{ id: string; revision: number }>(page, 'forms/create', {
      workspace,
      id: uuidv7(),
      name: 'Talk to us',
      mutationId: randomUUID(),
    });
    const live = await rpc<{ publicKey: string }>(page, 'forms/publish', {
      workspace,
      formId: form.id,
      expectedRevision: form.revision,
      mutationId: randomUUID(),
    });

    // The visitor: a browser of their own, signed in to nothing.
    const context = await browser.newContext();
    await watch(context);
    const visitor = await context.newPage();
    const origin = new URL(page.url()).origin;
    await visitor.goto(`${origin}/f/${live.publicKey}`);
    await expect(visitor.getByRole('button', { name: 'Send' })).toBeVisible();
    await visitor.getByLabel('Your name').fill('Ada Lovelace');
    found.push(...(await violations(visitor)));
    await visitor.goto(`${origin}/b/${booking.publicKey}`);
    await expect(visitor.getByRole('list', { name: /^Times on / })).toBeVisible();
    found.push(...(await violations(visitor)));
    await context.close();

    expect(found.filter((violation) => violation.directive.startsWith('style-src'))).toEqual([]);
  });
});
