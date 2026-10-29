// The form journey's edges (flow walks, phase 2, 29 October 2026): a required question holds a visitor in place
// until answered; changing which object a filed form saves to asks first and, confirmed, moves it; a send that
// trips the bot trap is kept as spam, never lost, and Not spam files it; a paused form tells its visitor it is
// closed and takes sends again once resumed.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** The hosted form's bot check wants a human's pace before Send. */
const HUMAN_PACE_MS = 3_000;

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
  readonly name: string;
  readonly publicKey: string;
  readonly revision: number;
}

/** A new workspace with one published form, "Talk to us" (Your name, Work email, filed on People). */
async function withForm(page: Page, kind: string): Promise<{ slug: string; form: FormView }> {
  const tag = randomUUID().slice(0, 8);
  const slug = `form${kind}-${tag}`;
  await newWorkspace(page, `form${kind}-${tag}@example.com`, slug);
  const created = await rpc<FormView>(page, 'forms/create', {
    workspace: slug,
    id: uuidv7(),
    name: `Talk to us ${tag}`,
    mutationId: randomUUID(),
  });
  const live = await rpc<FormView>(page, 'forms/publish', {
    workspace: slug,
    formId: created.id,
    expectedRevision: created.revision,
    mutationId: randomUUID(),
  });
  return { slug, form: live };
}

/** A visitor on the hosted form, signed in to nothing. */
async function visitorOn(browser: Browser, page: Page, form: FormView): Promise<Page> {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${new URL(page.url()).origin}/f/${form.publicKey}`);
  return visitor;
}

test.describe('the form journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the edges.');

  test('a required question holds the visitor in place until it is answered', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, form } = await withForm(page, 'required');
    await page.goto(`/w/${slug}/captures/forms/${form.id}`);
    await page.getByRole('button', { name: 'Add a question' }).click();
    await page.getByLabel('Question', { exact: true }).last().fill('What is your budget?');
    await page.getByText('Visitors must answer').last().click();
    // A live form publishes its changes in one press, no dialog.
    await page
      .getByRole('button', { name: /^Publish/ })
      .first()
      .click();
    await expect(page.getByText(/Live · v2/).first()).toBeVisible({ timeout: 30_000 });

    const visitor = await visitorOn(browser, page, form);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-${form.id.slice(-6)}@example.com`);
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    await visitor.getByRole('button', { name: 'Send' }).click();
    await expect(visitor.getByText('Answer this question.')).toBeVisible();
    await expect(visitor.getByText(/Thank you/)).toHaveCount(0);
    await visitor.getByLabel(/What is your budget\?/).fill('About ten thousand');
    await visitor.getByRole('button', { name: 'Send' }).click();
    await expect(visitor.getByText(/Thank you/).first()).toBeVisible({ timeout: 15_000 });
    await visitor.context().close();
  });

  test('changing which object a filed form saves to asks first, and moves it once confirmed', async ({ page }) => {
    test.setTimeout(180_000);
    const { slug, form } = await withForm(page, 'retarget');
    await page.goto(`/w/${slug}/captures/forms/${form.id}?tab=settings`);
    const target = page.getByRole('button', { name: /Save to$/ });
    await expect(target).toContainText('People');
    await target.click();
    await page.getByRole('option', { name: 'Deals', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Change which object submissions are saved to?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Change object' }).click();
    await expect(confirm).toBeHidden();
    await expect(target).toContainText('Deals');
    // Focus isn't dropped on the page: it lands on the editor's More actions.
    await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused();
  });

  test('a send that trips the bot trap is kept as spam, and Not spam files it', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, form } = await withForm(page, 'spam');
    const visitor = await visitorOn(browser, page, form);
    await visitor.getByLabel(/Your name/).fill('Bot Botson');
    await visitor.getByLabel(/Work email/).fill(`bot-${form.id.slice(-6)}@example.com`);
    await visitor.getByLabel('Leave this empty').fill('http://spam.example');
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    await visitor.getByRole('button', { name: 'Send' }).click();
    // A bot learns nothing: it is thanked like anyone else.
    await expect(visitor.getByText(/Thank you/).first()).toBeVisible({ timeout: 15_000 });
    await visitor.context().close();

    await page.goto(`/w/${slug}/captures/forms/${form.id}?tab=submissions`);
    const row = page.getByRole('row').filter({ hasText: `bot-${form.id.slice(-6)}@example.com` });
    await expect(row).toContainText('Spam', { timeout: 30_000 });
    await row.getByRole('checkbox').check({ force: true });
    await page.getByRole('button', { name: 'Not spam' }).first().click();
    await expect(page.getByText(/marked as not spam|Released\./).first()).toBeVisible();
    await expect(row).not.toContainText('Spam', { timeout: 30_000 });
  });

  test('a paused form tells its visitor it is closed, and takes sends again once resumed', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { slug, form } = await withForm(page, 'pause');
    await page.goto(`/w/${slug}/captures/forms`);
    const accepting = page.getByRole('switch', { name: `${form.name} is live` });
    await accepting.press('Space');
    await expect(accepting).not.toBeChecked();

    const visitor = await visitorOn(browser, page, form);
    await expect(visitor.getByRole('button', { name: 'Send' })).toHaveCount(0);
    // Not a blank page: it says the form is closed.
    await expect(visitor.getByRole('heading', { name: 'This form isn’t taking enquiries right now.' })).toBeVisible();

    await accepting.press('Space');
    await expect(accepting).toBeChecked();
    // The hosted form's read is never cached, so the visitor who saw it closed gets it back on one reload (F1).
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Send' })).toBeVisible();
    await visitor.context().close();
  });
});
