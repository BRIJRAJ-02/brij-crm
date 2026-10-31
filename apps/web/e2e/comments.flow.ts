// Comments, mentions and the inbox in two browsers (spec 0038, milestone 2,
// AC-1186): Ada mentions Bea in a comment on a person, and Bea's inbox shows
// it live with the tab's title counting it; Bea opens it, lands on the
// thread on the record's Comments tab, and replies; Ada's inbox shows the
// reply live. Each live step is held to LIVE_MS. axe in light and dark on the
// Comments tab and the inbox. Bea joins through `member:add` (local only,
// until #23 brings invites).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, openFullPage, signInAgain } from './people.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** The Release 1 bar is a second; CI's shared runners get some room over it. */
const LIVE_MS = Number(process.env.FLOW_LIVE_MS ?? 3_000);
const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** Adds `email` to the workspace as a member (local only: `member:add`, as views-manage.flow.ts does). */
function addMember(slug: string, email: string, name: string): void {
  execFileSync(
    'pnpm',
    ['--filter', '@crm/core', 'member:add', '--workspace', slug, '--email', email, '--role', 'member', '--name', name],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

const inbox = (page: Page) => page.getByRole('grid', { name: 'Inbox' });

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The two browser flow runs at desktop width.');

test('a mention reaches the other browser’s inbox live, opens its thread, and the reply comes back live', async ({
  page: ada,
  browser,
}, testInfo) => {
  const tag = `${String(Date.now())}-${testInfo.project.name}`;
  const slug = `comments-${tag}`;
  const beaEmail = `bea-${tag}@example.com`;
  await newWorkspace(ada, `ada-${tag}@example.com`, slug);
  addMember(slug, beaEmail, 'Bea Byron');
  await addPerson(ada, 'Grace', 'Hopper', `grace-${tag}@example.com`);

  // Bea waits on her inbox, empty.
  const beaContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport ?? null,
  });
  const bea = await beaContext.newPage();
  await signInAgain(bea, beaEmail, `/w/${slug}/inbox`, []);
  await expect(bea.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(bea.getByText('You’re all caught up.')).toBeVisible();

  // Ada opens Grace's Comments tab (read again, so the members list holds Bea) and mentions her.
  await ada.reload();
  await ada
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await openFullPage(ada);
  await expect(ada).toHaveURL(RECORD_URL);
  await ada.getByRole('tab', { name: /Comments/ }).click();
  // A writer sees the composer alone, with no empty state over it (owner, 31 Oct).
  await expect(ada.getByText('No comments yet', { exact: true })).toHaveCount(0);
  await checkScreen(ada, 'comments-empty');
  const composer = ada.getByRole('textbox', { name: 'Add a comment' });
  await composer.click();
  await ada.keyboard.type('Over to @Bea');
  await expect(composer).toHaveAttribute('aria-controls');
  await ada.keyboard.press('Enter');
  await expect(composer).toHaveValue('Over to @Bea Byron ');
  await ada.keyboard.type('for the contract.');
  await ada.keyboard.press('ControlOrMeta+Enter');
  const thread = ada.getByRole('article', { name: 'Thread started by Ada Lovelace' });
  await expect(thread).toContainText('Over to @Bea Byron for the contract.');
  await expect(ada.getByRole('tab', { name: /Comments/ })).toContainText('1');
  await checkScreen(ada, 'comments-thread');

  // Bea's inbox and her tab's title show it within the bar.
  await expect(inbox(bea).getByText('Ada Lovelace mentioned you')).toBeVisible({ timeout: LIVE_MS });
  await expect(bea).toHaveTitle(/^\(1\) Inbox/, { timeout: LIVE_MS });
  await checkScreen(bea, 'inbox');

  // Ada waits on her own inbox for the reply.
  await ada.goto(`/w/${slug}/inbox`);
  await expect(ada.getByText('You’re all caught up.')).toBeVisible();

  // Bea opens it: read, and on the thread on Grace's Comments tab.
  await inbox(bea).getByText('Ada Lovelace mentioned you').click();
  await expect(bea).toHaveURL(/\/objects\/people\/[0-9a-f-]{36}\/comments\?thread=[0-9a-f-]{36}$/);
  const beaThread = bea.getByRole('article', { name: 'Thread started by Ada Lovelace' });
  await expect(beaThread).toContainText('Over to @Bea Byron for the contract.');
  await expect(bea).not.toHaveTitle(/^\(\d+\)/, { timeout: LIVE_MS });

  // She replies, and Ada's inbox shows it within the bar.
  await beaThread.getByRole('button', { name: 'Reply' }).click();
  await bea.getByRole('textbox', { name: 'Reply' }).fill('On it.');
  await bea.keyboard.press('ControlOrMeta+Enter');
  await expect(beaThread).toContainText('On it.');
  await expect(inbox(ada).getByText('Bea Byron replied in a thread')).toBeVisible({ timeout: LIVE_MS });
  await expect(ada).toHaveTitle(/^\(1\) Inbox/, { timeout: LIVE_MS });

  await beaContext.close();
});
