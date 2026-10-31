// Log activity (the CRM flow pass, 31 October 2026), end to end: a call logged from a record's Notes tab in two
// clicks and ⌘↵ (Call is the default, the time is now), showing on the Notes tab and the Activity timeline with its
// icon, outcome and length; a meeting logged for yesterday through the dialog's time fields sitting under today's
// entries; the Calls and Meetings filters; a call logged from ⌘K with the record's name; the dialog reopened from the
// timeline, edited and deleted with Undo; a time too far ahead refused before anything is sent; and the dialog's
// axe checks in light and dark. A call linked to a second record shows there too.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** Opens a person's page from the People table, and answers their record id. */
async function openPerson(page: Page, name: string): Promise<string> {
  await page
    .getByRole('rowheader', { name: new RegExp(name) })
    .getByText(name)
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  return RECORD_URL.exec(page.url())?.[1] ?? '';
}

/** The Log activity dialog (a new one is titled so; one logged is titled Call or Meeting). */
const logDialog = (page: Page, name: string | RegExp = 'Log activity') => page.getByRole('dialog', { name });

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The record page flows run at desktop width.');

test('a call is logged in two clicks and ⌘↵, and shows on the Notes tab and the timeline with its outcome', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `logact-${tag}`;
  await newWorkspace(page, `logact-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  const graceId = await openPerson(page, 'Grace Hopper');
  const notesPath = `/w/${slug}/objects/people/${graceId}/notes`;

  // The Notes tab offers Log activity beside New note.
  await page.goto(notesPath);
  await page.getByRole('button', { name: 'Log activity' }).first().click();
  const dialog = logDialog(page);
  await expect(dialog).toBeVisible();
  // Call is chosen, the time is now, and nothing else is asked: pick how it went, and save from the keyboard.
  await expect(dialog.getByRole('radio', { name: 'Call' })).toBeChecked();
  await dialog.getByRole('button', { name: '30 min' }).click();
  await dialog.getByRole('button', { name: 'Connected' }).click();
  await checkScreen(page, 'log-activity-dialog');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(dialog).toBeHidden();

  // The Notes tab lists it with a Call title, its outcome tag and its length.
  const list = page.getByRole('grid', { name: 'Notes' });
  const row = list.getByRole('row', { name: /Call/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Connected')).toBeVisible();
  await expect(row.getByText('30 min')).toBeVisible();

  // The Activity timeline reads "logged a call" with the same facts.
  await page.goto(`/w/${slug}/objects/people/${graceId}/activity`);
  const entry = page.getByRole('article', { name: /logged a call/ });
  await expect(entry).toBeVisible();
  await expect(entry.getByText('Connected')).toBeVisible();
  await expect(entry.getByText('30 min')).toBeVisible();
});

test('a meeting logged for yesterday sits under today’s entries; Calls and Meetings filter the timeline', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `logact2-${tag}`;
  await newWorkspace(page, `logact2-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  const graceId = await openPerson(page, 'Grace Hopper');
  const notesPath = `/w/${slug}/objects/people/${graceId}/notes`;

  // A call, now.
  await page.goto(`${notesPath}?log=call`);
  const first = logDialog(page);
  await first.getByRole('button', { name: 'No answer' }).click();
  await first.getByRole('button', { name: 'Log call' }).click();
  await expect(first).toBeHidden();

  // A meeting for yesterday: the date is typed ("yesterday") in the calendar's Type a date row.
  await page.goto(`${notesPath}?log=meeting`);
  const second = logDialog(page);
  await expect(second.getByRole('radio', { name: 'Meeting' })).toBeChecked();
  await second.getByRole('button', { name: /Date/ }).click();
  await page.getByRole('textbox', { name: /Type a date/ }).fill('yesterday');
  await page.keyboard.press('Enter');
  await second.getByRole('button', { name: 'Held' }).click();
  await second.getByRole('button', { name: '1 h' }).click();
  await second.getByRole('button', { name: 'Log meeting' }).click();
  await expect(second).toBeHidden();

  // The timeline: today's call first, then yesterday's meeting under the Yesterday heading.
  await page.goto(`/w/${slug}/objects/people/${graceId}/activity`);
  const feed = page.getByRole('feed', { name: 'Activity' });
  const articles = feed.getByRole('article');
  await expect(articles.filter({ hasText: 'logged a call' })).toBeVisible();
  await expect(articles.filter({ hasText: 'logged a meeting' })).toBeVisible();
  await expect(feed.getByRole('heading', { name: 'Yesterday' })).toBeVisible();
  const order = await articles.allInnerTexts();
  const call = order.findIndex((text) => text.includes('logged a call'));
  const meeting = order.findIndex((text) => text.includes('logged a meeting'));
  expect(call).toBeGreaterThanOrEqual(0);
  expect(meeting).toBeGreaterThan(call);

  // Calls shows the call only; Meetings the meeting only.
  await page.getByRole('button', { name: /Filter/ }).click();
  await page.getByRole('option', { name: 'Calls' }).click();
  await expect(articles.filter({ hasText: 'logged a call' })).toBeVisible();
  await expect(articles.filter({ hasText: 'logged a meeting' })).toHaveCount(0);
  await page.getByRole('button', { name: /Filter/ }).click();
  await page.getByRole('option', { name: 'Meetings' }).click();
  await expect(articles.filter({ hasText: 'logged a meeting' })).toBeVisible();
  await expect(articles.filter({ hasText: 'logged a call' })).toHaveCount(0);
});

test('⌘K logs a call on the record, and the entry reopens from the timeline to edit and delete with Undo', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `logact3-${tag}`;
  await newWorkspace(page, `logact3-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  const graceId = await openPerson(page, 'Grace Hopper');

  // ⌘K on the record's page offers "Log a call on <name>", which opens the dialog on Call.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('log a call');
  await page.getByRole('option', { name: /Log a call on Grace Hopper/ }).click();
  const dialog = logDialog(page);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?log=call$/);
  await expect(dialog.getByRole('radio', { name: 'Call' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Left message' }).click();
  await dialog.getByRole('button', { name: 'Log call' }).click();
  await expect(dialog).toBeHidden();

  // From the timeline the entry reopens in the same dialog, titled Call, with its outcome chosen.
  await page.goto(`/w/${slug}/objects/people/${graceId}/activity`);
  const entry = page.getByRole('article', { name: /logged a call/ });
  await entry.getByText('Left message').click();
  const edit = logDialog(page, 'Call');
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Left message' })).toHaveAttribute('aria-pressed', 'true');
  // A call can't become a meeting.
  await expect(edit.getByRole('radio', { name: 'Meeting' })).toBeDisabled();
  // Edited: a length and an outcome changed, notes added, and saved.
  await edit.getByRole('button', { name: '15 min' }).click();
  await edit.getByRole('button', { name: 'Connected' }).click();
  await edit.getByRole('button', { name: 'Notes' }).click();
  await edit.getByRole('textbox', { name: 'Notes' }).fill('Agreed to a demo on Friday.');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  const changed = page.getByRole('article', { name: /logged a call/ });
  await expect(changed.getByText('Connected')).toBeVisible();
  await expect(changed.getByText('15 min')).toBeVisible();
  await expect(changed.getByText('Agreed to a demo on Friday.')).toBeVisible();

  // Delete is one click, with Undo.
  await changed.getByText('Connected').click();
  await logDialog(page, 'Call').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Call deleted')).toBeVisible();
  await expect(page.getByRole('article', { name: /logged a call/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('article', { name: /logged a call/ })).toBeVisible();
});

test('a time more than a day ahead is refused before anything is sent, and a call links a second record', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `logact4-${tag}`;
  await newWorkspace(page, `logact4-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await addPerson(page, 'Ada', 'Lovelace', `ada-${tag}@example.com`);
  const graceId = await openPerson(page, 'Grace Hopper');
  const notesPath = `/w/${slug}/objects/people/${graceId}/notes`;

  await page.goto(`${notesPath}?log=call`);
  const dialog = logDialog(page);
  // "next week" in the calendar's typed row lands past a day ahead: the When row says so and Log call is off.
  await dialog.getByRole('button', { name: /Date/ }).click();
  await page.getByRole('textbox', { name: /Type a date/ }).fill('in 2 weeks');
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Only what already happened.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Log call' })).toBeDisabled();
  // Back to a day that happened: it can be logged, and linked to a second record.
  await dialog.getByRole('button', { name: /Date/ }).click();
  await page.getByRole('textbox', { name: /Type a date/ }).fill('yesterday');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Records' }).click();
  await page.getByRole('option', { name: /Ada Lovelace/ }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Log call' }).click();
  await expect(dialog).toBeHidden();

  // Ada's Notes tab lists the call too.
  await page.goto(`/w/${slug}/objects/people`);
  const adaId = await openPerson(page, 'Ada Lovelace');
  await page.goto(`/w/${slug}/objects/people/${adaId}/notes`);
  await expect(page.getByRole('grid', { name: 'Notes' }).getByRole('row', { name: /Call/ })).toBeVisible();
});
