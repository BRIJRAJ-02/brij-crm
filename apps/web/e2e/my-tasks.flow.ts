// My tasks (spec 0019, milestone 2), end to end: tasks due yesterday, today,
// next week and with no date fall into Overdue, Today, Upcoming and No date;
// the filter and status switches write the address and change the list; a
// task ticked here leaves the open list once it settles and shows under
// Completed; and a fake clock crossing local midnight moves Today's task to
// Overdue with no request to the server. axe in light and dark (AC-436,
// AC-437, AC-451).
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { checkScreen, newWorkspace } from './people.ts';

// One time zone, so the days are known: UTC.
test.use({ timezoneId: 'UTC' });

/** A UUID v7 from the clock, as the browser mints one (the API refuses others for a task). */
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

/** The day `days` from `day` (`YYYY-MM-DD`). */
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test('My tasks: the four groups, the switches in the address, a tick, and midnight with no request', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `mytasks-${tag}`;
  await newWorkspace(page, `mytasks-${tag}@example.com`, slug);
  const me = ((await rpc(page, 'access/mine', { workspace: slug })) as { memberId: string }).memberId;
  // Today, a minute before midnight, by a fake clock the page starts on.
  const today = new Date().toISOString().slice(0, 10);
  await page.clock.install({ time: new Date(`${today}T23:59:00Z`) });
  const make = (title: string, dueOn?: string, assigneeMemberId: string | null = me) =>
    rpc(page, 'tasks/create', {
      workspace: slug,
      id: uuidv7(),
      title,
      mutationId: uuidv7(),
      ...(dueOn === undefined ? {} : { dueOn }),
      ...(assigneeMemberId === null ? {} : { assigneeMemberId }),
    });
  await make('Send the contract', shift(today, -1));
  await make('Call Grace', today);
  await make('Plan the offsite', shift(today, 7));
  await make('Read the brief');
  await make('Nobody’s task', undefined, null);

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Tasks', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/tasks$`));
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  const list = page.getByRole('grid', { name: /Assigned to me/ });
  const group = (name: string) =>
    list.locator('[role="row"]:has(> [role="rowheader"], > [role="columnheader"])', {
      hasText: new RegExp(`^${name}$`),
    });
  for (const name of ['Overdue', 'Today', 'Upcoming', 'No date']) await expect(group(name)).toBeVisible();
  await expect(list.getByText('Call Grace', { exact: true })).toBeVisible();
  // Unassigned tasks never show in anyone's Assigned to me (owner decision 1).
  await expect(list.getByText('Nobody’s task', { exact: true })).toHaveCount(0);
  await checkScreen(page, 'my-tasks');

  // Midnight passes with no request to the server: Today's task is overdue now.
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(request.url());
  });
  await page.clock.runFor(90_000);
  await expect(group('Today')).toHaveCount(0);
  const rows = await list.getByRole('row').allTextContents();
  const overdueAt = rows.findIndex((row) => row.includes('Overdue'));
  const graceAt = rows.findIndex((row) => row.includes('Call Grace'));
  const upcomingAt = rows.findIndex((row) => row.includes('Upcoming'));
  expect(overdueAt).toBeLessThan(graceAt);
  expect(graceAt).toBeLessThan(upcomingAt);
  // The list asks nothing; only the sidebar's Tasks badge, a count by date (spec 0034, AC-924), reads the new day's.
  expect(calls.filter((url) => !url.endsWith('/api/rpc/tasks/due'))).toEqual([]);

  // The tabs work by keyboard: arrows move the filter, and the address follows.
  await page.getByRole('tab', { name: 'Assigned to me' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\?filter=created$/);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/tasks$`));

  // All tasks: the address says so, and the unassigned one shows.
  await page.getByRole('tablist', { name: 'Whose tasks' }).getByRole('tab', { name: 'All tasks' }).click();
  await expect(page).toHaveURL(/\?filter=all$/);
  await expect(page.getByRole('grid', { name: /All tasks/ }).getByText('Nobody’s task', { exact: true })).toBeVisible();

  // Tick one: it stays struck through until the list settles, then leaves for Completed.
  const allList = page.getByRole('grid', { name: /All tasks/ });
  await allList.getByRole('checkbox', { name: 'Mark “Read the brief” as done' }).click({ force: true });
  await page.clock.runFor(3_000);
  await expect(allList.getByRole('row', { name: 'Read the brief' })).toHaveCount(0);
  await page.getByRole('radiogroup', { name: 'Task status' }).getByText('Completed', { exact: true }).click();
  await expect(page).toHaveURL(/filter=all&status=done$/);
  await expect(
    page.getByRole('grid', { name: /All tasks, completed/ }).getByRole('row', { name: 'Read the brief' }),
  ).toBeVisible();

  // A row opens the task dialog on ?task=, and Back closes it.
  await page
    .getByRole('grid', { name: /All tasks, completed/ })
    .getByRole('row', { name: 'Read the brief' })
    .click();
  await expect(page).toHaveURL(/task=[0-9a-f-]{36}/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
