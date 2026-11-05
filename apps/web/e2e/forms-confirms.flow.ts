// The confirms before a form ends something (the owner's rule, 21 October
// 2026): deleting a submission or a form asks first in a danger dialog, and
// adding many submissions to the CRM in a plain one. Cancel (or Escape)
// changes nothing and sends nothing; each press of the commit sends one call;
// a refusal says why inside the dialog, which stays open to try again.
// Pausing asks first too, from the list or the editor (lane 3c); resuming
// acts at once, and a pause's toast offers Undo.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

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

/** Counts the page's calls to one procedure from now on. */
function calls(page: Page, procedure: string): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/rpc/${procedure}`) count += 1;
  });
  return () => count;
}

interface FormView {
  readonly id: string;
  readonly name: string;
  readonly publicKey: string;
  readonly revision: number;
  readonly mainObjectId?: string;
}

test.describe('confirms on forms', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the confirms.');

  test('pausing and deleting ask first; Cancel changes nothing; each commit runs once; a refusal stays in the dialog', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `confirms-${tag}`;
    await newWorkspace(page, `confirms-${tag}@example.com`, slug);
    const created = await rpc<FormView>(page, 'forms/create', {
      workspace: slug,
      id: uuidv7(),
      name: `Demo request ${tag}`,
      mutationId: randomUUID(),
    });
    // Published keeping its submissions only, so they wait outside the CRM until it files again.
    const people = created.mainObjectId;
    if (people === undefined) throw new Error('A new form files to People.');
    const keepOnly = await rpc<FormView>(page, 'forms/setTarget', {
      workspace: slug,
      formId: created.id,
      mainObjectId: null,
      expectedRevision: created.revision,
      mutationId: randomUUID(),
    });
    const kept = await rpc<FormView>(page, 'forms/publish', {
      workspace: slug,
      formId: created.id,
      expectedRevision: keepOnly.revision,
      mutationId: randomUUID(),
    });

    // Two submissions through the hosted page, at a person's pace.
    for (const [name, email] of [
      ['Grace Hopper', `grace-${tag}@example.com`],
      ['Alan Turing', `alan-${tag}@example.com`],
    ] as const) {
      const visitor = await (await browser.newContext()).newPage();
      await visitor.goto(`${new URL(page.url()).origin}/f/${kept.publicKey}`);
      await visitor.getByLabel(/Your name/).fill(name);
      await visitor.getByLabel(/Work email/).fill(email);
      await visitor.waitForTimeout(2_500);
      await visitor.getByRole('button', { name: 'Send' }).click();
      await expect(visitor.getByText(/Thanks, we got it/).first()).toBeVisible();
      await visitor.close();
    }
    // Then filing to People again, live, so Add to CRM takes both.
    const filing = await rpc<FormView>(page, 'forms/setTarget', {
      workspace: slug,
      formId: created.id,
      mainObjectId: people,
      expectedRevision: kept.revision,
      mutationId: randomUUID(),
    });
    const live = await rpc<FormView>(page, 'forms/publish', {
      workspace: slug,
      formId: created.id,
      expectedRevision: filing.revision,
      mutationId: randomUUID(),
    });

    // Pausing from its card's ⋯ asks first (it ends something, lane 3c): Escape is Cancel and sends nothing;
    // Pause form pauses it, once, with Undo in its toast.
    const setStatus = calls(page, 'forms/setStatus');
    await page.goto(`/w/${slug}/captures/forms`);
    const listed = page.getByRole('article', { name: live.name });
    await expect(listed.getByText('Live', { exact: true })).toBeVisible();
    const pause = async () => {
      await listed.getByRole('button', { name: `More for ${live.name}` }).click();
      await page.getByRole('menuitem', { name: 'Pause' }).click();
      const asking = page.getByRole('dialog', { name: `Pause “${live.name}”?` });
      await expect(asking).toBeVisible();
      return asking;
    };
    const pausing = await pause();
    await page.keyboard.press('Escape');
    await expect(pausing).toBeHidden();
    await expect(listed.getByText('Live', { exact: true })).toBeVisible();
    expect(setStatus()).toBe(0);
    await (await pause()).getByRole('button', { name: 'Pause form' }).click();
    await expect(pausing).toBeHidden();
    await expect(listed.getByText('Paused', { exact: true })).toBeVisible();
    await expect.poll(setStatus).toBe(1);
    // Undo turns it back on, with one more call.
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect(listed.getByText('Live', { exact: true })).toBeVisible();
    await expect.poll(setStatus).toBe(2);

    // Adding many to the CRM at once asks first and counts them; Escape is Cancel and sends nothing.
    const addToCrm = calls(page, 'submissions/addToCrm');
    await page.goto(`/w/${slug}/captures/forms/${live.id}?tab=submissions`);
    for (const name of ['Grace Hopper', 'Alan Turing']) {
      await page.getByRole('row').filter({ hasText: name }).getByRole('checkbox').click({ force: true });
    }
    await page.getByRole('button', { name: 'Add to CRM' }).click();
    const adding = page.getByRole('dialog', { name: 'Add 2 submissions to the CRM?' });
    await expect(adding).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(adding).toBeHidden();
    expect(addToCrm()).toBe(0);
    // Add to CRM sends both, in one call, and the dialog closes.
    await page.getByRole('button', { name: 'Add to CRM' }).click();
    await adding.getByRole('button', { name: 'Add to CRM' }).click();
    await expect(adding).toBeHidden();
    expect(addToCrm()).toBe(1);

    // Deleting a submission is one click with Undo (forms fixes 2: deletes are soft): no confirm, one call, and
    // Undo puts it back. A refusal says why in a toast; the submission stays.
    const deleteSubmission = calls(page, 'submissions/delete');
    const restoreSubmission = calls(page, 'submissions/restore');
    await page.goto(`/w/${slug}/captures/forms/${live.id}?tab=submissions`);
    await page.getByRole('row').filter({ hasText: 'Grace Hopper' }).first().click();
    await page.route(
      '**/api/rpc/submissions/delete',
      (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            json: { defined: false, code: 'FORM_STATE', status: 409, message: 'Try again in a moment.' },
          }),
        }),
      { times: 1 },
    );
    // Delete sits in the panel's ⋯ at the footer's start (lane 3c), so the footer's end keeps one primary.
    const deleteOpen = async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
    };
    await deleteOpen();
    await expect(page.getByText('Try again in a moment.')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(deleteSubmission()).toBe(1);
    await deleteOpen();
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' })).toHaveCount(0);
    expect(deleteSubmission()).toBe(2);
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' }).first()).toBeVisible();
    expect(restoreSubmission()).toBe(1);

    // The editor's Pause asks first too, as the list does (lane 3c); Pause form pauses it once, its toast offering
    // Undo, which resumes it.
    await page.goto(`/w/${slug}/captures/forms/${live.id}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();
    const pausingHere = page.getByRole('dialog', { name: `Pause “${live.name}”?` });
    await pausingHere.getByRole('button', { name: 'Pause form' }).click();
    await expect(pausingHere).toBeHidden();
    await expect.poll(setStatus).toBe(3);
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect.poll(setStatus).toBe(4);

    // Removing a site from the Share tab asks first; Escape keeps it; Remove site saves the list without it.
    const settings = calls(page, 'forms/updateSettings');
    await page.goto(`/w/${slug}/captures/forms/${live.id}?tab=share`);
    await page.getByRole('button', { name: 'For developers' }).click();
    await page.getByLabel('Site address').fill('https://acme.com');
    await page.getByRole('button', { name: 'Add site' }).click();
    const removeSite = page.getByRole('button', { name: 'Remove https://acme.com' });
    await expect(removeSite).toBeVisible();
    expect(settings()).toBe(1);
    await removeSite.click();
    const leave = page.getByRole('alertdialog', { name: 'Remove https://acme.com?' });
    await expect(leave).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(leave).toBeHidden();
    await expect(removeSite).toBeVisible();
    expect(settings()).toBe(1);
    await removeSite.click();
    await leave.getByRole('button', { name: 'Remove site' }).click();
    await expect(leave).toBeHidden();
    await expect(removeSite).toHaveCount(0);
    expect(settings()).toBe(2);

    // Deleting the form from its card asks first; Cancel keeps it; Delete form removes it, once.
    const deleteForm = calls(page, 'forms/delete');
    await page.goto(`/w/${slug}/captures/forms`);
    const card = page.getByRole('link', { name: live.name, exact: true });
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: `More for ${live.name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const remove = page.getByRole('alertdialog', { name: `Delete “${live.name}”?` });
    await expect(remove).toBeVisible();
    await expect(remove).toContainText('gone for good');
    await remove.getByRole('button', { name: /^Cancel/ }).click();
    await expect(remove).toBeHidden();
    await expect(card).toBeVisible();
    expect(deleteForm()).toBe(0);
    await page.getByRole('button', { name: `More for ${live.name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await remove.getByRole('button', { name: 'Delete form' }).click();
    await expect(remove).toBeHidden();
    await expect(card).toHaveCount(0);
    expect(deleteForm()).toBe(1);
    // The card and its menu went with it: focus lands on the page's title, not on the page.
    await expect(page.locator('main h1')).toBeFocused();
  });
});
