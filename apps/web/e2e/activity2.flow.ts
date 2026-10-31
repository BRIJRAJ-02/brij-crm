// Activity and collaboration (the CRM flow pass, 31 October 2026), end to end:
// a task's description written in its dialog, kept, and changed; the inbox's
// Due today filter (the daily cleanup's `task_due` notices are proved in
// core's tests, since a flow can't move the cron); a note linked to a second
// record through Link record, shown on that record's Notes tab and Activity,
// opened there naming its own record, and unlinked; and a mention in a note
// reaching the other member's inbox, which opens the note. axe in light and
// dark on the task dialog and the note window with its linked records.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, signInAgain } from './people.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** Adds `email` to the workspace as a member (local only: `member:add`, as comments.flow.ts does). */
function addMember(slug: string, email: string, name: string): void {
  execFileSync(
    'pnpm',
    ['--filter', '@crm/core', 'member:add', '--workspace', slug, '--email', email, '--role', 'member', '--name', name],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

/** Opens a person's page from the People table, and answers their record id. */
async function openPerson(page: Page, name: string): Promise<string> {
  await page
    .getByRole('rowheader', { name: new RegExp(name) })
    .getByText(name)
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  return RECORD_URL.exec(page.url())?.[1] ?? '';
}

/** The note window, told apart from a menu's popover by the editor inside it. */
const noteWindow = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The record page flows run at desktop width.');

test('a task’s description is written in its dialog, kept, and changed; the inbox filters due tasks', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `activity-${tag}`;
  await newWorkspace(page, `activity-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  const graceId = await openPerson(page, 'Grace Hopper');
  const tasksPath = `/w/${slug}/objects/people/${graceId}/tasks`;

  // New task with a description: Create closes the dialog, and the task opens again with it.
  await page.goto(`${tasksPath}?task=new`);
  const newTask = page.getByRole('dialog', { name: 'New task' });
  await expect(newTask).toBeVisible();
  await newTask.getByRole('textbox', { name: 'Title' }).fill('Send the renewal quote');
  await newTask.getByRole('textbox', { name: 'Description' }).fill('Seats: 40. Ask about the March start.');
  await newTask.getByRole('button', { name: 'Create task' }).click();
  await expect(newTask).toBeHidden();
  const list = page.getByRole('grid', { name: 'Open tasks' });
  await list.getByRole('row', { name: /Send the renewal quote/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Task' });
  const description = dialog.getByRole('textbox', { name: 'Description' });
  await expect(description).toHaveValue('Seats: 40. Ask about the March start.');
  await checkScreen(page, 'task-dialog-description');

  // Changed and left: it saves on leaving the field, and a reload reads it back.
  await description.fill('Seats: 45. Ask about the March start.');
  await dialog.getByRole('textbox', { name: 'Title' }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Task' }).getByRole('textbox', { name: 'Description' })).toHaveValue(
    'Seats: 45. Ask about the March start.',
  );
  await page.keyboard.press('Escape');

  // The inbox's kind menu offers Due today, and an empty one says so.
  await page.goto(`/w/${slug}/inbox`);
  await page.getByRole('button', { name: /Kind of notification/ }).click();
  await page.getByRole('option', { name: 'Due today' }).click();
  await expect(page).toHaveURL(/kind=due/);
  await expect(page.getByText('No notifications match.')).toBeVisible();
});

test('a note links a second record, shows there, opens naming its own record, and unlinks', async ({ page }, info) => {
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `notelinks-${tag}`;
  await newWorkspace(page, `notelinks-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);
  const graceId = await openPerson(page, 'Grace Hopper');

  // A note on Grace.
  await page.goto(`/w/${slug}/objects/people/${graceId}/notes?note=new`);
  const window = noteWindow(page);
  await expect(window).toBeVisible();
  await window.getByRole('textbox', { name: 'Title' }).fill('Joint call');
  await window.getByRole('textbox', { name: 'Note' }).click();
  await page.keyboard.type('Grace and Alan both join.');
  await expect(window.getByText('Saved')).toBeVisible();

  // Link record (More): the linked records field opens its picker; Alan is picked.
  await window.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Link record' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search Linked records' })).toBeFocused();
  await page.keyboard.type('Alan');
  await page.getByRole('menuitem', { name: /Alan Turing/ }).click();
  await expect(window.getByRole('list', { name: 'Linked records' })).toContainText('Alan Turing');
  await checkScreen(page, 'note-window-links');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);

  // Alan's Notes tab lists it, his Activity reads "added a note", and the window names Grace as its record.
  await page.goto(`/w/${slug}/objects/people`);
  const alanId = await openPerson(page, 'Alan Turing');
  await page.getByRole('tab', { name: /Notes/ }).click();
  const notes = page.getByRole('grid', { name: 'Notes' });
  await expect(notes.getByRole('row', { name: /Joint call/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Notes/ })).toContainText('1');
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('added a note')).toBeVisible();
  await page.goto(`/w/${slug}/objects/people/${alanId}/notes`);
  await notes.getByRole('row', { name: /Joint call/ }).click();
  await expect(window).toBeVisible();
  await expect(window.getByText('Grace Hopper').first()).toBeVisible();

  // Edited from Alan's page: it saves as the same note.
  await window.getByRole('textbox', { name: 'Note' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Friday.');
  await expect(window.getByText('Saved')).toBeVisible();

  // Unlinked: gone from Alan's Notes tab, still on Grace's.
  await window
    .getByRole('list', { name: 'Linked records' })
    .getByRole('button', { name: /Remove/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
  await expect(notes.getByRole('row', { name: /Joint call/ })).toHaveCount(0);
  await page.goto(`/w/${slug}/objects/people/${graceId}/notes`);
  await expect(notes.getByRole('row', { name: /Joint call/ })).toBeVisible();
});

test('a mention in a note reaches the other member’s inbox and opens the note', async ({
  page: ada,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${String(Date.now())}-${info.project.name}`;
  const slug = `notementions-${tag}`;
  const beaEmail = `bea-${tag}@example.com`;
  await newWorkspace(ada, `ada-${tag}@example.com`, slug);
  addMember(slug, beaEmail, 'Bea Byron');
  await addPerson(ada, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await ada.reload();
  const graceId = await openPerson(ada, 'Grace Hopper');

  // Ada writes a note and mentions Bea with @.
  await ada.goto(`/w/${slug}/objects/people/${graceId}/notes?note=new`);
  const window = noteWindow(ada);
  await window.getByRole('textbox', { name: 'Title' }).fill('Contract');
  await window.getByRole('textbox', { name: 'Note' }).click();
  await ada.keyboard.type('Over to @Bea');
  await ada.getByRole('option', { name: /Bea Byron/ }).click();
  await ada.keyboard.type(' for the signature.');
  await expect(window.getByText('Saved')).toBeVisible();
  const noteId = /note=([0-9a-f-]{36})/.exec(ada.url())?.[1] ?? '';

  // Bea's inbox says so, and opens the note over Grace's Notes tab.
  const beaContext = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: info.project.use.viewport ?? null,
  });
  const bea = await beaContext.newPage();
  await signInAgain(bea, beaEmail, `/w/${slug}/inbox`, []);
  const inbox = bea.getByRole('grid', { name: 'Inbox' });
  await expect(inbox.getByText('Ada Lovelace mentioned you in a note')).toBeVisible();
  await inbox.getByText('Ada Lovelace mentioned you in a note').click();
  await expect(bea).toHaveURL(new RegExp(`/notes\\?note=${noteId}$`));
  await expect(noteWindow(bea)).toContainText('for the signature.');
  await beaContext.close();
});
