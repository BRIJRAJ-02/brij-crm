// A record's Files tab (#32, the crm-files lane): a PDF dropped on a person's Files tab shows with who added it, and
// its count on the tab; a second browser on the same record sees it arrive live; it downloads with `nosniff` and as
// an attachment; a file whose bytes aren't its type, and one with an executable name, are refused with a sentence and
// nothing is stored; Delete is one click and Undo brings it back. Needs a file store (`BLOB_READ_WRITE_TOKEN`, or the
// local disk store with `APP_ENV=local`).
import { expect, test } from '@playwright/test';
import { addPerson, newWorkspace, openFullPage } from './people.ts';

/** The Release 1 bar is a second; CI's shared runners get some room over it. */
const LIVE_MS = Number(process.env.FLOW_LIVE_MS ?? 3_000);

/** A tiny real PDF: its first bytes are what the server checks. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The record page runs at desktop width.');

test('a file added on a record’s Files tab shows live, downloads safely, and Delete has Undo', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${String(Date.now())}-${testInfo.project.name}`;
  const slug = `files-${tag}`;
  await newWorkspace(page, `files-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await openFullPage(page);
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page).toHaveURL(/\/files$/);
  const recordUrl = page.url();

  // A second browser, the same person, on the same Files tab.
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport ?? null,
    storageState: await page.context().storageState(),
  });
  const watcher = await other.newPage();
  await watcher.goto(recordUrl);
  await expect(watcher.getByText('Add files')).toBeVisible();

  // Pick a PDF: it shows with who added it, and the tab counts it.
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /browse/i })
    .first()
    .click();
  await (await chooser).setFiles({ name: 'Proposal.pdf', mimeType: 'application/pdf', buffer: PDF });
  const link = page.getByRole('link', { name: /Proposal\.pdf/ });
  await expect(link).toBeVisible();
  await expect(page.getByRole('tab', { name: /Files/ })).toContainText('1');

  // Live in the other browser.
  await expect(watcher.getByRole('link', { name: /Proposal\.pdf/ })).toBeVisible({ timeout: LIVE_MS });

  // The download is an attachment, never sniffed, never cached.
  const href = (await link.getAttribute('href')) ?? '';
  const download = await page.request.get(href);
  expect(download.status()).toBe(200);
  expect(download.headers()['x-content-type-options']).toBe('nosniff');
  expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(download.headers()['cache-control']).toContain('no-store');

  // A file whose bytes aren't its type is refused, and so is an executable name.
  const recordId = /\/([0-9a-f-]{36})\/files$/.exec(recordUrl)?.[1] ?? '';
  // Writes need the app's own Origin, as the browser sends it.
  const origin = new URL(recordUrl).origin;
  const refused = await page.request.post(`/api/records/${recordId}/files?workspace=${slug}`, {
    headers: { origin, 'content-type': 'application/pdf', 'x-file-name': 'fake.pdf' },
    data: Buffer.from('MZ not a pdf'),
  });
  expect(refused.status()).toBe(400);
  const executable = await page.request.post(`/api/records/${recordId}/files?workspace=${slug}`, {
    headers: { origin, 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('invoice.exe.pdf') },
    data: PDF,
  });
  expect(executable.status()).toBe(400);
  await page.reload();
  await expect(page.getByRole('link', { name: /\.pdf/ })).toHaveCount(1);

  // Delete is one click; Undo brings it back.
  await page.getByRole('button', { name: 'Remove Proposal.pdf' }).click();
  await expect(page.getByRole('link', { name: /Proposal\.pdf/ })).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: /Proposal\.pdf/ })).toBeVisible();
  await expect(watcher.getByRole('link', { name: /Proposal\.pdf/ })).toBeVisible({ timeout: LIVE_MS });
  await other.close();
});
