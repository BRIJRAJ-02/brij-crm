// Partner connect (spec 0070, slice 2, AC-7011 to AC-7013), end to end against a local stack and the sample partner
// hub (`tools/partner-sample`, its AGENTS.md says how to start both): the hub's Integrate Timefix opens our connect
// page, a new person signs up, names a new workspace and connects it; the hub swaps the code for a connection and
// reads it with its token; an unregistered redirect address is refused on the page and never followed; Connected
// apps lists the app, and Disconnect (asked first) stops its token at once; History says both.
//
// Runs only where the sample hub answers (`PARTNER_SAMPLE_URL`, http://localhost:5390): CI has no hub running yet.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { codeFor } from './mailpit.ts';

const SAMPLE = process.env['PARTNER_SAMPLE_URL'] ?? 'http://localhost:5390';

/** Whether the sample hub is up. */
async function sampleRunning(): Promise<boolean> {
  try {
    return (await fetch(SAMPLE)).ok;
  } catch {
    return false;
  }
}

test.describe('partner connect', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The hub flow runs once, at desktop width.');

  test('a hub connects a new workspace through the connect page, and Disconnect stops it at once', async ({ page }) => {
    test.skip(!(await sampleRunning()), `The sample partner hub isn't running at ${SAMPLE}.`);
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `hub-${tag}@example.com`;
    const workspace = `Hub test ${tag}`;

    // The hub's Timefix tab: Integrate Timefix sends the browser to our connect page, which asks a stranger to sign in.
    await page.goto(SAMPLE);
    // The hub may still hold an earlier run's connection: Integrate Timefix is there either way.
    await page.getByRole('button', { name: 'Integrate Timefix' }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Foauth%2Fpartner%2Fauthorize/);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
    await expect(page).toHaveURL(/\/verify/);
    await page.getByLabel('Code').fill(await codeFor(page.request, email));

    // Back on the connect page: who asks, exactly what it may do, a new workspace named, and Connect.
    await expect(page.getByRole('heading', { name: 'Connect Sample Hub to Timefix' })).toBeVisible();
    await expect(page.getByText('Add and remove people in this workspace; open Link pages for them')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'A new workspace' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Link pages/ })).toBeChecked();
    await page.getByLabel('Workspace name').fill(workspace);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    // The hub swapped the code and read the connection back with its token.
    await expect(page).toHaveURL(new RegExp(`^${SAMPLE}/?$`));
    await expect(page.locator('#state')).toHaveText(`Connected to ${workspace}`);
    await expect(page.locator('#modules')).toHaveText('Modules: link_pages');
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(page.locator('#status')).toHaveText('Connection works.');

    // A connect naming an address the hub never registered is refused on our page, and the browser stays here.
    await page.goto(
      `/oauth/partner/authorize?response_type=code&client_id=tfp_AAAAAAAAAAAAAAAAAAAAAA&redirect_uri=${encodeURIComponent(
        'https://evil.example.com/cb',
      )}&state=x&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`,
    );
    await expect(page.getByRole('heading', { name: 'This link can’t connect an app' })).toBeVisible();
    await expect(page).toHaveURL(/\/oauth\/partner\/authorize/);

    // Slice 3: the hub adds a teammate silently, then removes them; Members in Timefix shows them in between.
    await page.goto('/');
    await expect(page).toHaveURL(/\/w\/[^/]+\/home$/);
    const slug = new URL(page.url()).pathname.split('/')[2] ?? '';
    const teammate = `Lin ${tag}`;
    await page.goto(SAMPLE);
    await page.getByLabel('External id').fill(`hub-user-${tag}`);
    await page.getByLabel('Email').fill(`lin-${tag}@example.com`);
    await page.getByLabel('Name').fill(teammate);
    await page.getByLabel('Role').selectOption('admin');
    await page.getByRole('button', { name: 'Add teammate' }).click();
    await expect(page.locator('#status')).toHaveText('Teammate added.');
    await expect(page.locator('#team')).toContainText(`${teammate} · lin-${tag}@example.com · admin`);
    await page.goto(`/w/${slug}/settings/members`);
    await expect(page.getByRole('row').filter({ hasText: teammate })).toBeVisible();
    await page.goto(SAMPLE);
    await page.getByRole('button', { name: `Remove ${teammate}` }).click();
    await expect(page.locator('#status')).toHaveText('Teammate removed.');
    await expect(page.locator('#team')).not.toContainText(teammate);
    await page.goto(`/w/${slug}/settings/members`);
    await expect(page.getByRole('row').filter({ hasText: teammate })).toHaveCount(0);

    // Settings › Connected apps: the app, its module, when it connected and its last call; Disconnect asks first.
    await page.goto(`/w/${slug}/settings/connected-apps`);
    const row = page.getByRole('row').filter({ hasText: 'Sample Hub' });
    await expect(row).toContainText('Link pages');
    await row.getByRole('button', { name: 'Disconnect Sample Hub' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Disconnect Sample Hub?' });
    await confirm.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Sample Hub disconnected')).toBeVisible();
    await expect(page.getByText('No apps connected')).toBeVisible();

    // The hub's token stops at once.
    await page.goto(SAMPLE);
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(page.locator('#status')).toHaveText('Connection refused: 401 UNAUTHENTICATED');

    // History names both.
    await page.goto(`/w/${slug}/settings/history/changes`);
    await expect(page.getByRole('rowheader', { name: /connected Sample Hub for Link pages$/ })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /disconnected Sample Hub$/ })).toBeVisible();
  });

  // Slice 4 (AC-7030 to AC-7033): the hub launches a teammate's screen and shows it in its own frame, on another site
  // (the hub on 127.0.0.1, the app on localhost): the frame signs in by its own cookie, draws the link page without
  // the sidebar, tells the hub its height, and keeps every link inside; Team pages opens for an admin.
  test('a hub opens a teammate’s link page and Team pages in its frame, on another site', async ({ page }) => {
    test.skip(!(await sampleRunning()), `The sample partner hub isn't running at ${SAMPLE}.`);
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `hub-${tag}@example.com`;
    const workspace = `Hub frame ${tag}`;
    const lead = `Lead ${tag}`;
    const crew = `Crew ${tag}`;
    // The hub on another site from the app's: the frame's cookie is a third party's, partitioned under the hub.
    const otherSite = SAMPLE.replace('//localhost', '//127.0.0.1');

    await page.goto(SAMPLE);
    await page.getByRole('button', { name: 'Integrate Timefix' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
    await page.getByLabel('Code').fill(await codeFor(page.request, email));
    await page.getByLabel('Workspace name').fill(workspace);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('#state')).toHaveText(`Connected to ${workspace}`);
    for (const [externalId, name, role] of [
      [`lead-${tag}`, lead, 'admin'],
      [`crew-${tag}`, crew, 'member'],
    ] as const) {
      await page.getByLabel('External id').fill(externalId);
      await page.getByLabel('Email').fill(`${externalId}@example.com`);
      await page.getByLabel('Name').fill(name);
      await page.getByLabel('Role').selectOption(role);
      await page.getByRole('button', { name: 'Add teammate' }).click();
      await expect(page.locator('#status')).toHaveText('Teammate added.');
    }

    // The lead's own link page, in the hub's frame: our screen, no sidebar, its address kept inside the frame.
    await page.goto(`${otherSite}/embed?externalId=lead-${tag}&screen=link_pages.mine&theme=dark`);
    const frame = page.frameLocator('#timefix');
    await expect(frame.getByRole('heading', { level: 1, name: 'Link page' })).toBeVisible({ timeout: 20_000 });
    // Their page was made with them (slice 3): it opens on its overview, ready to edit.
    await expect(frame.getByRole('button', { name: 'Edit page' })).toBeVisible();
    await expect(frame.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The frame told the hub its height, and the hub sized it.
    await expect(page.locator('#timefix')).toHaveAttribute('style', /height: \d+px/);
    // Team pages, from the lead's own page, stays inside the frame and lists the team.
    await frame.getByRole('link', { name: 'Team pages' }).click();
    await expect(frame.getByRole('heading', { level: 1, name: 'Team pages' })).toBeVisible();
    await expect(frame.getByRole('row').filter({ hasText: crew })).toBeVisible();
    expect(page.frames().some((each) => /\/embed\/tfp_[^/]+\/link-page\?team=true/.test(each.url()))).toBe(true);

    // Team pages launched straight away for the lead; refused for the crew member, who manages no one's page.
    await page.goto(`${otherSite}/embed?externalId=lead-${tag}&screen=link_pages.team`);
    await expect(frame.getByRole('heading', { level: 1, name: 'Team pages' })).toBeVisible({ timeout: 20_000 });
    await page.goto(`${otherSite}/embed?externalId=crew-${tag}&screen=link_pages.team`);
    await expect(page.locator('#status')).toContainText('Launch refused: FORBIDDEN');

    // A launch's address works once: opened again, the frame says so and offers a fresh launch.
    await page.goto(`${otherSite}/embed?externalId=crew-${tag}&screen=link_pages.mine`);
    await expect(frame.getByRole('heading', { level: 1, name: 'Link page' })).toBeVisible({ timeout: 20_000 });
    const used = await page.locator('#timefix').getAttribute('src');
    await page.locator('#timefix').evaluate((element, src) => {
      (element as HTMLIFrameElement).src = `${src ?? ''}`;
    }, used);
    await expect(frame.getByRole('heading', { level: 1, name: 'Open this again' })).toBeVisible({ timeout: 20_000 });
    await frame.getByRole('button', { name: 'Open again' }).click();
    await expect(frame.getByRole('heading', { level: 1, name: 'Link page' })).toBeVisible({ timeout: 20_000 });
  });
});
