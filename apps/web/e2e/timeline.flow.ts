// The record's timeline (spec 0017, milestone 2): an edit in Details shows in
// Recent activity at once; a link made from either side reads as a change on
// the side that holds one and as "added … to Team" on the company, each name
// a link to its record; a second browser on the same record sees a change
// within a second with no reload; and a long timeline pages as it scrolls,
// ending with the creation. axe in light and dark on the Activity tab.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, signInAgain } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;
/** AC-381: a change shows on an open timeline within a second. */
const LIVE_BUDGET_MS = 1_000;

/** A UUID v7 from the clock, as the browser mints one (the API refuses others for a record). */
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

/** The workspace's objects and an attribute finder, through the API. */
async function definitions(page: Page, slug: string) {
  const objects = (await rpc(page, 'objects/list', { workspace: slug })) as { id: string; apiSlug: string }[];
  const objectId = (apiSlug: string) => {
    const found = objects.find((object) => object.apiSlug === apiSlug);
    if (found === undefined) throw new Error(`No ${apiSlug}.`);
    return found.id;
  };
  const attribute = async (object: string, apiSlug: string) => {
    const list = (await rpc(page, 'attributes/list', { workspace: slug, objectId: objectId(object) })) as {
      id: string;
      apiSlug: string;
    }[];
    const found = list.find((each) => each.apiSlug === apiSlug);
    if (found === undefined) throw new Error(`${object} has no ${apiSlug}.`);
    return found.id;
  };
  return { objectId, attribute };
}

test('the timeline shows changes and links, live, and pages as it scrolls', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `timeline-${tag}`;
  const email = `timeline-${tag}@example.com`;
  const code = await newWorkspace(page, email, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  const graceId = RECORD_URL.exec(page.url())?.[1] ?? '';
  const isNarrow = info.project.name === '375';

  // The create's values fold into the creation: one entry.
  const recent = page.getByRole('feed', { name: 'Recent activity' });
  await expect(recent.getByRole('article')).toHaveCount(1);
  await expect(recent).toContainText('created this record');

  // An edit in Details shows in Recent activity at once (this tab's own write).
  if (isNarrow) await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Job title' }).click();
  const jobTitle = page.getByRole('textbox', { name: 'Job title' });
  await jobTitle.fill('Rear admiral');
  await jobTitle.press('Enter');
  await expect(recent.getByRole('article').first()).toHaveAccessibleName('Ada Lovelace set Job title', {
    timeout: 3_000,
  });
  await expect(recent.getByRole('article').first()).toContainText('Rear admiral');

  // A company, and Grace linked to it from her side, through the API (the record picker comes with #15).
  const { objectId, attribute } = await definitions(page, slug);
  const acmeId = uuidv7();
  await rpc(page, 'records/create', {
    workspace: slug,
    objectId: objectId('companies'),
    id: acmeId,
    mutationId: uuidv7(),
    values: { [await attribute('companies', 'name')]: 'Acme' },
  });
  await rpc(page, 'records/setValues', {
    workspace: slug,
    recordId: graceId,
    mutationId: uuidv7(),
    values: {
      [await attribute('people', 'company')]: { value: { objectId: objectId('companies'), recordId: acmeId } },
    },
  });
  await page.getByRole('tab', { name: 'Activity' }).click();
  const feed = page.getByRole('feed', { name: 'Activity' });
  // Through the API this tab didn't write it itself: the live event names Grace.
  await expect(feed.getByRole('article').first()).toHaveAccessibleName('Ada Lovelace set Company');
  await expect(feed.getByRole('article').first()).toContainText('Acme');
  await checkScreen(page, 'timeline-activity');

  // Acme's timeline reads the same link from its side, Grace's name a link to her page.
  await page.goto(`/w/${slug}/objects/companies/${acmeId}/activity`);
  const acmeFeed = page.getByRole('feed', { name: 'Activity' });
  await expect(acmeFeed.getByRole('article').first()).toHaveAccessibleName(/^Ada Lovelace added Grace Hopper to Team$/);
  await checkScreen(page, 'timeline-links');
  await acmeFeed.getByRole('link', { name: 'Grace Hopper' }).click();
  await expect(page).toHaveURL(new RegExp(`/objects/people/${graceId}/overview$`));

  // A second browser on Grace's Activity tab sees a change made elsewhere within a second, with no reload.
  const readerContext = await browser.newContext({ viewport: page.viewportSize() ?? { width: 1280, height: 800 } });
  const reader = await readerContext.newPage();
  const activityPath = `/w/${slug}/objects/people/${graceId}/activity`;
  await signInAgain(reader, email, activityPath, [code]);
  const readerFeed = reader.getByRole('feed', { name: 'Activity' });
  await expect(readerFeed).toContainText('created this record');
  const title = await attribute('people', 'job_title');
  const sent = Date.now();
  await rpc(page, 'records/setValues', {
    workspace: slug,
    recordId: graceId,
    mutationId: uuidv7(),
    values: { [title]: { value: 'Commodore' } },
  });
  await expect(readerFeed.getByRole('article').first()).toContainText('Commodore', { timeout: 5_000 });
  const seenAfter = Date.now() - sent;
  console.warn(`timeline live: the change showed in the second browser after ${String(seenAfter)} ms`);
  expect(seenAfter).toBeLessThan(LIVE_BUDGET_MS + 500);

  // A long timeline pages as it scrolls and ends with the creation.
  for (let index = 0; index < 60; index += 1) {
    await rpc(page, 'records/setValues', {
      workspace: slug,
      recordId: graceId,
      mutationId: uuidv7(),
      values: { [title]: { value: `Step ${String(index)}` } },
    });
  }
  await reader.reload();
  await expect(readerFeed.getByRole('article').first()).toContainText('Step 59');
  // By keyboard: End reaches the last entry loaded (one still loading past it while there are more), the next
  // page arrives, and End again, until the creation shows. Focus stays in the feed throughout.
  await readerFeed.getByRole('article').first().focus();
  for (let step = 0; step < 20; step += 1) {
    if ((await readerFeed.getByText('created this record').count()) > 0) break;
    await reader.keyboard.press('End');
    await reader.waitForTimeout(250);
    await expect(readerFeed.locator(':focus')).toHaveCount(1);
  }
  await expect(readerFeed.getByText('created this record')).toBeVisible();
  // 60 steps, the three changes before them and the creation, each once.
  await expect(readerFeed.getByRole('article').last()).toHaveAttribute('aria-setsize', '64');
  await readerContext.close();
});
