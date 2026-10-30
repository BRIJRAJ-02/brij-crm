// Validation rules (spec 0013, milestone 1), end to end with two browsers:
// an owner adds a rule to People's Email addresses from settings (only
// addresses at acme.com); a second browser, the same person on the People
// table, gets the rule live and its paste of a gmail address is refused in
// the browser, before anything is sent, the cell keeping its value and a
// toast with no Retry; a raw procedure call is refused the same by the
// server, 422 VALIDATION_FAILED naming the rule; an address at acme.com
// lands (AC-252, AC-254, AC-256, AC-257, AC-281).
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cellAt, checkScreen, newWorkspace, signInAgain } from './people.ts';

/** A UUID v7, as the browser mints them. */
function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin: its status and body. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<{ status: number; body: unknown }> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  return { status: response.status(), body: ((await response.json()) as { json: unknown }).json };
}

/** Pastes text into the grid at the focused cell, as the clipboard would. */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

const RULE_MESSAGE = 'Email addresses must be an address at acme.com.';

test.describe('validation rules', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('a rule saved in settings reaches a second browser live, refuses its paste there, and refuses a raw call', async ({
    browser,
    page: writer,
  }, testInfo) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const email = `rules-${tag}@example.com`;
    const slug = `rules-${tag}`;
    const code = await newWorkspace(writer, email, slug);
    const people = `/w/${slug}/objects/people`;
    await addPerson(writer, 'Grace', 'Hopper', `grace-${tag}@acme.com`);

    // The second browser: the same person, on the People table.
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const reader = await readerContext.newPage();
    await signInAgain(reader, email, people, [code]);
    await expect(reader.getByRole('grid', { name: 'People' })).toBeVisible();
    const sent: string[] = [];
    reader.on('request', (request) => {
      if (request.url().includes('/api/rpc/records/setValues')) sent.push(request.url());
    });

    // The owner adds a rule to Email addresses: only addresses at acme.com (AC-252).
    await writer.goto(`/w/${slug}/settings/objects/people/attributes`);
    await writer
      .getByRole('grid', { name: 'Attributes' })
      .getByRole('row', { name: /Email addresses/ })
      .click();
    const dialog = writer.getByRole('dialog', { name: 'Edit attribute' });
    // Rules sit under More settings, open when the attribute already sets any of them.
    const more = dialog.getByRole('button', { name: 'More settings' });
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
    await expect(dialog.getByText('No rules yet, so any value is accepted.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await writer.getByRole('menuitem', { name: 'Email domains' }).click();
    await expect(writer.getByRole('menu')).toBeHidden();
    await dialog.getByRole('textbox', { name: 'Domains' }).fill('acme.com');
    await expect(dialog.getByText(RULE_MESSAGE)).toBeVisible();
    await checkScreen(writer, 'rules-edit');
    // The reader's attributes are read again once the rule's definitions event reaches it.
    const ruleArrives = reader.waitForResponse((response) => response.url().includes('/api/rpc/attributes/list'));
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await ruleArrives;

    // The reader pastes a gmail address over Grace's: refused in the browser, nothing sent (AC-256, AC-257).
    const cell = await cellAt(reader, 0, 'Email addresses');
    await expect(cell).toContainText(`grace-${tag}@acme.com`);
    await cell.click();
    await paste(reader, 'grace@gmail.com');
    await expect(reader.getByText(RULE_MESSAGE).filter({ visible: true }).first()).toBeVisible();
    await expect(cell).toContainText(`grace-${tag}@acme.com`);
    // The toast offers no Retry: the same save would be refused again.
    await expect(reader.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect(sent).toEqual([]);
    await checkScreen(reader, 'rules-refused-paste');

    // A raw call that skips the browser's check is refused exactly the same by the server (AC-254, AC-257).
    const objects = (await rpc(reader, 'objects/list', { workspace: slug })).body as {
      id: string;
      standardKey?: string;
    }[];
    const peopleId = objects.find((object) => object.standardKey === 'people')?.id ?? '';
    const attributes = (await rpc(reader, 'attributes/list', { workspace: slug, objectId: peopleId })).body as {
      id: string;
      apiSlug: string;
      validation?: { rules: { id: string }[] };
    }[];
    const emails = attributes.find((attribute) => attribute.apiSlug === 'email_addresses');
    const ruleId = emails?.validation?.rules[0]?.id;
    expect(ruleId).toBeDefined();
    const page = (await rpc(reader, 'records/query', { workspace: slug, objectId: peopleId, limit: 1 })).body as {
      records: { id: string }[];
    };
    const recordId = page.records[0]?.id ?? '';
    const refused = await rpc(reader, 'records/setValues', {
      workspace: slug,
      recordId,
      values: { [emails?.id ?? '']: { value: ['grace@gmail.com'] } },
      mutationId: uuidv7(),
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: RULE_MESSAGE,
      data: { refusals: [{ code: 'VALIDATION_FAILED', message: RULE_MESSAGE, attributeId: emails?.id, ruleId }] },
    });

    // An address at acme.com lands (only the browser's check stood in the way before).
    await cell.click();
    await paste(reader, `hopper-${tag}@acme.com`);
    await expect(cell).toContainText(`hopper-${tag}@acme.com`);
    await expect.poll(() => sent.length).toBe(1);
    await readerContext.close();
  });
});
