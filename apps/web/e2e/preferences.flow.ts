// Settings › Account › Preferences, end to end: the start page saves at once
// with a quiet toast, opening the workspace then lands on Tasks, and Undo puts
// back the page a change replaced; the date format writes a task's due date as chosen, and it is
// kept on the server (a fresh load reads it back). axe in light and dark.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { checkScreen, newWorkspace } from './people.ts';

test.use({ timezoneId: 'UTC' });

/** A UUID v7 from the clock, as the browser mints one. */
function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<unknown> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: unknown }).json;
}

/** Picks `option` in the select labelled `label`, then waits for the save's toast. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByText('Preferences saved').last()).toBeVisible();
}

test('Preferences: the start page and its Undo, and the date format kept on the server', async ({ page }, info) => {
  test.setTimeout(180_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `prefs-${tag}`;
  await newWorkspace(page, `prefs-${tag}@example.com`, slug);
  const me = ((await rpc(page, 'access/mine', { workspace: slug })) as { memberId: string }).memberId;
  await rpc(page, 'tasks/create', {
    workspace: slug,
    id: uuidv7(),
    title: 'Renew the lease',
    dueOn: '2031-03-08',
    assigneeMemberId: me,
    mutationId: uuidv7(),
  });

  await page.goto(`/w/${slug}/settings/account/preferences`);
  await expect(page.getByRole('heading', { level: 1, name: 'Preferences' })).toBeVisible();
  await checkScreen(page, 'preferences');

  // The start page: Tasks, then opening the workspace lands there.
  await choose(page, 'Open the workspace on', 'Tasks');
  await page.goto(`/w/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/tasks`));

  // Undo puts back what a change replaced.
  await page.goto(`/w/${slug}/settings/account/preferences`);
  await choose(page, 'Open the workspace on', 'People');
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByRole('button', { name: /Open the workspace on/ })).toContainText('Tasks');

  // The date format: ISO, read back after a fresh load, and used by the task's due date.
  // Each format is shown as today reads in it; the browser (and so the page) is in UTC.
  await choose(page, 'Date format', new Date().toISOString().slice(0, 10));
  await page.reload();
  await expect(page.getByRole('button', { name: /Date format/ })).toContainText(/\d{4}-\d{2}-\d{2}/);
  await page.goto(`/w/${slug}/tasks`);
  await expect(page.getByText('2031-03-08')).toBeVisible();
  await page.goto(`/w/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/tasks`));
});
