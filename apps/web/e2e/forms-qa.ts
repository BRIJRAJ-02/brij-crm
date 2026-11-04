// What the forms QA flows share (forms-qa-*.flow.ts, 5 November 2026): one signed in owner per file (a new
// workspace costs half a minute, so each file makes one and every test borrows its cookies), forms built through the
// API as the builder would save them, a visitor in a browser of their own, and a Send that waits out the five a
// minute limit every local visitor shares (they all come from one address). Everything is found by role and label,
// so the checks hold through the forms lanes' redesigns.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  expect,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';
import { newWorkspace } from './people.ts';

/** The hosted form's bot check wants a human's pace before Send. */
export const HUMAN_PACE_MS = 3_000;

/** What the page says when a send didn't go through, a busy minute included. */
export const TRY_AGAIN = 'That did not go through. Try again in a moment.';

/** A UUID v7, as the app makes ids. */
export function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
export async function rpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  const origin = new URL(page.url() === 'about:blank' ? baseOf(page) : page.url()).origin;
  const response = await page.request.post(`${origin}/api/rpc/${procedure}`, {
    data: { json: input },
    headers: { origin },
  });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: T }).json;
}

/** The app's address the flows run against. */
export function baseOf(_page?: Page): string {
  return process.env.FLOW_BASE_URL ?? 'http://localhost:5173';
}

/** A signed in owner: their workspace's address and the cookies that sign them in. */
export interface Owner {
  readonly slug: string;
  readonly cookies: Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['cookies']>>;
}

/** Makes one owner and workspace for a file (`beforeAll`), so its tests don't each pay for a sign in. */
export async function makeOwner(browser: Browser, testInfo: TestInfo, kind: string): Promise<Owner> {
  const tag = randomUUID().slice(0, 8);
  const slug = `fqa${kind}-${tag}`;
  const options: BrowserContextOptions = { baseURL: testInfo.project.use.baseURL ?? baseOf() };
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await newWorkspace(page, `${slug}@example.com`, slug);
  const cookies = await context.cookies();
  await context.close();
  return { slug, cookies };
}

/** Signs `page` in as the file's owner and opens their workspace's forms. */
export async function asOwner(page: Page, owner: Owner): Promise<void> {
  await page.context().addCookies([...owner.cookies]);
  await page.goto(`/w/${owner.slug}/captures/forms`);
}

/** A form as the API answers it. */
export interface FormView {
  readonly id: string;
  readonly name: string;
  readonly publicKey: string;
  readonly revision: number;
  readonly draft: { readonly questions: readonly Record<string, unknown>[] } & Record<string, unknown>;
}

/** A question as the builder saves it. */
export function q(
  key: string,
  label: string,
  answerType: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: key, key, label, answerType, required: false, update: 'fill', ...extra };
}

/**
 * A form named `name`, its draft changed by `change` (the default Your name, Work email and Phone or WhatsApp
 * kept unless `change` drops them), then published. Answers the live form.
 */
export async function liveForm(
  page: Page,
  owner: Owner,
  name: string,
  change: (draft: FormView['draft']) => Record<string, unknown> = (draft) => draft,
): Promise<FormView> {
  const created = await rpc<FormView>(page, 'forms/create', {
    workspace: owner.slug,
    id: uuidv7(),
    name,
    mutationId: randomUUID(),
  });
  const saved = await rpc<FormView>(page, 'forms/saveDraft', {
    workspace: owner.slug,
    formId: created.id,
    document: change(created.draft),
    expectedRevision: created.revision,
    mutationId: randomUUID(),
  });
  return rpc<FormView>(page, 'forms/publish', {
    workspace: owner.slug,
    formId: created.id,
    expectedRevision: saved.revision,
    mutationId: randomUUID(),
  });
}

/** A visitor on the hosted form, signed in to nothing, in a browser of their own (`options` for a phone). */
export async function visitorOn(
  browser: Browser,
  form: Pick<FormView, 'publicKey'>,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const visitor = await (await browser.newContext({ reducedMotion: 'reduce', ...options })).newPage();
  await visitor.goto(`${baseOf()}/f/${form.publicKey}`);
  return visitor;
}

/** Whether a request is a submit of the hosted form. */
export function isSubmit(request: Request): boolean {
  return (
    request.method() === 'POST' && /\/api\/public\/forms\/[^/]+\/submissions$/.test(new URL(request.url()).pathname)
  );
}

/** Counts the page's submits from now on. */
export function countSubmits(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (isSubmit(request)) count += 1;
  });
  return () => count;
}

/**
 * Presses the form's last button (`name`, Send unless the form says otherwise) at a human's pace; when the page says
 * the minute's sends are spent, waits the minute out and presses again, as a visitor would.
 */
export async function send(visitor: Page, name: string | RegExp = 'Send'): Promise<void> {
  await visitor.waitForTimeout(HUMAN_PACE_MS);
  await visitor.getByRole('button', { name, exact: typeof name === 'string' }).click();
  const tooSoon = visitor.getByText(TRY_AGAIN);
  const spent = await tooSoon.waitFor({ timeout: 4_000 }).then(
    () => true,
    () => false,
  );
  if (spent) {
    await visitor.waitForTimeout(61_000);
    await visitor.getByRole('button', { name, exact: typeof name === 'string' }).click();
  }
}

/** The visitor's thank you, whichever ending or layout drew it. */
export async function expectThanks(visitor: Page): Promise<void> {
  await expect(visitor.getByRole('heading', { name: /Thanks, we got it/ }).first()).toBeVisible({ timeout: 30_000 });
}

/** The form's submissions as the owner reads them (newest first). */
export async function submissionsOf(
  page: Page,
  owner: Owner,
  form: Pick<FormView, 'id'>,
): Promise<readonly { readonly id: string; readonly state: string; readonly email?: string }[]> {
  const listed = await rpc<{ items: { id: string; state: string; email?: string }[] }>(page, 'submissions/list', {
    workspace: owner.slug,
    formId: form.id,
  });
  return listed.items;
}

/** No sideways scroll: the page is no wider than its window. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
}

/**
 * Presses Tab until `target` has focus (at most `max` presses), proving it is reachable by keyboard alone, and that
 * the focused element shows a visible focus ring (an outline or a box shadow).
 */
export async function tabTo(page: Page, target: ReturnType<Page['locator']>, max = 60): Promise<void> {
  for (let press = 0; press < max; press += 1) {
    if (
      await target.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))
    ) {
      await expectVisibleFocus(page);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Not reached by Tab within ${String(max)} presses: ${target.toString()}`);
}

/** The focused element draws a focus ring: an outline, or a box shadow (the library's ring), on it or its parent. */
export async function expectVisibleFocus(page: Page): Promise<void> {
  const ring = await page.evaluate(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return 'nothing focused';
    for (const element of [focused, focused.parentElement]) {
      if (element === null) continue;
      const style = getComputedStyle(element);
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      if (outline || style.boxShadow !== 'none') return 'visible';
    }
    return `no ring on ${focused.tagName.toLowerCase()} ${focused.getAttribute('aria-label') ?? focused.textContent.slice(0, 40)}`;
  });
  expect(ring).toBe('visible');
}
