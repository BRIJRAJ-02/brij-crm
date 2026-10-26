// Notes on a record (spec 0019, milestones 3 and 4), end to end: "New note"
// opens the window and stores nothing until a letter is typed; typing saves
// it (the address then names it); the Notes tab lists it with its count and
// Activity reads "added a note", which opens it again; a second browser that
// has the note open while it is saved here shows the new version with the
// notice; deleting it from the window's menu asks first, then takes it away
// with Undo, which brings it back; and a task is deleted from its dialog and
// undone. axe in light and dark on the tab and the window (AC-439 to
// AC-445, AC-451).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, signInAgain } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<unknown> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: unknown }).json;
}

test('notes on a record: write, list, timeline, a second browser, delete and undo; a task deleted and undone', async ({
  page,
  browser,
}, info) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1000, 'The record page flow runs at desktop width.');
  test.setTimeout(300_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `notes-${tag}`;
  const email = `notes-${tag}@example.com`;
  const code = await newWorkspace(page, email, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  const graceId = RECORD_URL.exec(page.url())?.[1] ?? '';
  const notesPath = `/w/${slug}/objects/people/${graceId}/notes`;

  // The Notes tab, empty, then "New note": nothing is stored until a letter is typed.
  await page.getByRole('tab', { name: /Notes/ }).click();
  await expect(page).toHaveURL(new RegExp(`${notesPath}$`));
  await expect(page.getByText('No notes yet', { exact: true })).toBeVisible();
  await checkScreen(page, 'notes-tab-empty');
  const saves: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/rpc/notes/save')) saves.push(request.url());
  });
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page).toHaveURL(/\?note=new$/);
  // The note's own window, told apart by the editor inside it: a menu's popover is a dialog too, and one still
  // fading out makes a bare `getByRole('dialog')` match two (26 October 2026).
  const window = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });
  await expect(window).toBeVisible();
  const editor = window.getByRole('textbox', { name: 'Note' });
  await expect(editor).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(saves).toEqual([]);
  await window.getByRole('textbox', { name: 'Title' }).fill('Kickoff call');
  await editor.click();
  await page.keyboard.type('They want 40 seats by March.');
  await expect(window.getByText('Saved')).toBeVisible();
  await expect(page).toHaveURL(/\?note=[0-9a-f-]{36}$/);
  const noteId = /note=([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  await checkScreen(page, 'note-window');
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);

  // The list, with the count on the tab.
  const list = page.getByRole('grid', { name: 'Notes' });
  await expect(list.getByRole('row', { name: /Kickoff call/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Notes/ })).toContainText('1');
  await checkScreen(page, 'notes-tab');

  // Activity reads "added a note", and opens it.
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('added a note')).toBeVisible();
  await page.getByRole('link', { name: /Kickoff call/ }).click();
  await expect(page).toHaveURL(new RegExp(`note=${noteId}`));
  await expect(window).toBeVisible();

  // A second browser with the note open: it shows the version saved here, with the notice.
  const other = await browser.newContext({ viewport: page.viewportSize() ?? { width: 1280, height: 800 } });
  const reader = await other.newPage();
  await signInAgain(reader, email, notesPath, [code]);
  await reader.goto(`${notesPath}?note=${noteId}`);
  await expect(reader.getByRole('dialog').getByRole('textbox', { name: 'Note' })).toContainText('40 seats');
  await rpc(page, 'notes/save', {
    workspace: slug,
    id: noteId,
    recordId: graceId,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Now 60 seats.' }] }] },
    baseVersion: null,
    mutationId: randomUUID(),
  });
  const live = process.env.FLOW_NO_LIVE !== '1';
  if (!live) await reader.reload();
  await expect(reader.getByRole('dialog').getByRole('textbox', { name: 'Note' })).toContainText('60 seats');
  if (live) await expect(reader.getByText(/edited this note, so it now shows their version/)).toBeVisible();
  await other.close();

  // Delete from the window's menu asks first (a note can't come back from the Trash): Cancel changes nothing; Delete
  // note takes it away, with Undo, which brings it back.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Notes/ }).click();
  await list.getByRole('row', { name: /Kickoff call/ }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete Kickoff call?' });
  await window.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /Cancel/ }).click();
  await expect(confirm).toHaveCount(0);
  await expect(window).toBeVisible();
  await window.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  await confirm.getByRole('button', { name: 'Delete note' }).click();
  await expect(window).toHaveCount(0);
  await expect(list.getByRole('row', { name: /Kickoff call/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(list.getByRole('row', { name: /Kickoff call/ })).toBeVisible();

  // A task deleted from its dialog, and undone.
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('textbox', { name: 'Add a task' }).fill('Send the contract');
  await page.keyboard.press('Enter');
  const tasks = page.getByRole('grid', { name: 'Open tasks' });
  await tasks
    .getByRole('row', { name: /Send the contract/ })
    .first()
    .click();
  await window.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete task' }).click();
  await expect(tasks.getByRole('row', { name: /Send the contract/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tasks.getByRole('row', { name: /Send the contract/ })).toHaveCount(1);
});
