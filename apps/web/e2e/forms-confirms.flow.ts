// The confirms before a form ends something (the owner's rule, 21 October
// 2026): pausing a live form asks first in a plain dialog, deleting a
// submission or a form in a danger one, and adding many submissions to the
// CRM in a plain one. Cancel (or Escape) changes nothing and sends
// nothing; each press of the commit sends one call; a refusal says why inside
// the dialog, which stays open to try again. Turning a form back on stays one
// click, with no question.
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
      await expect(visitor.getByText(/Thank you/).first()).toBeVisible();
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

    // Turning the form off from its card asks first; Cancel leaves it on and sends nothing.
    const setStatus = calls(page, 'forms/setStatus');
    await page.goto(`/w/${slug}/captures/forms`);
    const accepting = page.getByRole('switch', { name: `Accepting submissions on ${live.name}` });
    await expect(accepting).toBeChecked();
    await accepting.press('Space');
    const pause = page.getByRole('dialog', { name: `Pause the ${live.name} form?` });
    await expect(pause).toBeVisible();
    await expect(pause).toContainText('nothing is deleted');
    await pause.getByRole('button', { name: /^Cancel/ }).click();
    await expect(pause).toBeHidden();
    await expect(accepting).toBeChecked();
    expect(setStatus()).toBe(0);
    // Pause form turns it off, with one call.
    await accepting.press('Space');
    await expect(pause).toBeVisible();
    await pause.getByRole('button', { name: 'Pause form' }).click();
    await expect(pause).toBeHidden();
    await expect(accepting).not.toBeChecked();
    expect(setStatus()).toBe(1);
    // On again: one click, no question.
    await accepting.press('Space');
    await expect(accepting).toBeChecked();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(setStatus()).toBe(2);

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

    // Deleting a submission asks first and names who sent it; Escape is Cancel, the submission stays open; Cancel keeps it.
    const deleteSubmission = calls(page, 'submissions/delete');
    await page.goto(`/w/${slug}/captures/forms/${live.id}?tab=submissions`);
    await page.getByRole('row').filter({ hasText: 'Grace Hopper' }).first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete the submission from Grace Hopper?' });
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    expect(deleteSubmission()).toBe(0);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^Cancel/ }).click();
    await expect(confirm).toBeHidden();
    expect(deleteSubmission()).toBe(0);
    // A refusal says why inside the dialog, which stays open; the same press sent one call.
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
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete submission' }).click();
    await expect(confirm.getByText('Try again in a moment.')).toBeVisible();
    await expect(confirm).toBeVisible();
    expect(deleteSubmission()).toBe(1);
    // The next press deletes it, with one more call.
    await confirm.getByRole('button', { name: 'Delete submission' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' })).toHaveCount(0);
    expect(deleteSubmission()).toBe(2);

    // The editor's Pause asks the same question; Cancel leaves it live.
    await page.goto(`/w/${slug}/captures/forms/${live.id}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();
    await expect(page.getByRole('dialog', { name: `Pause the ${live.name} form?` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(setStatus()).toBe(2);

    // Removing a site from the Install tab asks first; Escape keeps it; Remove site saves the list without it.
    const settings = calls(page, 'forms/updateSettings');
    await page.goto(`/w/${slug}/captures/forms/${live.id}?tab=install`);
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
    const card = page.getByRole('link', { name: live.name });
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: `More for ${live.name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const remove = page.getByRole('alertdialog', { name: `Delete the ${live.name} form?` });
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
