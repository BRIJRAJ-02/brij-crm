// The core loop's first steps (spec 0005, milestone 1): sign in by a code
// read from Mailpit, name the workspace, land on the empty People page; sign
// out returns to /sign-in; a deep link while signed out comes back after
// signing in. Then the review's edges: a refused welcome form that one press
// sends once fixed, a rate limited resend, a workspace that fails to load,
// and a second person signing in in the same tab never seeing the first
// one's pages. Every screen is checked with axe (WCAG A and AA, contrast
// included) in light and in dark. Set FLOW_SCREENSHOTS to a folder to keep a
// light and a dark picture of each screen, per project (1280 and 375 wide).
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';
import { skipCalendarStep, skipDetailsStep } from './people.ts';

/** Making a workspace writes its standard objects in one transaction; on a busy machine that takes a while. */
const WORKSPACE_MADE_MS = 30_000;

const SHOTS = process.env.FLOW_SCREENSHOTS;
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

interface AxeViolation {
  readonly id: string;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly unknown[]; readonly html: string }[];
}

declare global {
  interface Window {
    axe?: { run: (context: unknown, options: unknown) => Promise<{ violations: AxeViolation[] }> };
    sawForbidden?: boolean;
  }
}

/** The page's WCAG A and AA violations, as `rule (help): elements` lines. */
async function violations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => window.axe !== undefined))) await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // React Aria's live announcer keeps a moment's announcement ("Sending code") labelled by an element
    // that has since gone; it is spoken, never shown, and clears itself, so it is left out.
    const result = await window.axe?.run(
      { exclude: [['[data-live-announcer]']] },
      {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      },
    );
    return (result?.violations ?? []).map((violation) => ({
      id: violation.id,
      help: violation.help,
      targets: violation.nodes.map((node) => node.html),
    }));
  });
  return found.map((violation) => `${violation.id} (${violation.help}): ${violation.targets.join(', ')}`);
}

/**
 * Checks the screen as it is in light and in dark: no axe violations
 * (contrast included), and a picture of each when FLOW_SCREENSHOTS asks,
 * named for the project's width.
 */
async function checkScreen(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Colours ease between themes; wait until they settle, so contrast is measured on the real colours.
    // A looping animation (the code boxes' caret, a spinner) never ends, so only those that do are waited for.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity,
        ),
    );
    expect(await violations(page), `${name} in ${scheme}`).toEqual([]);
    if (SHOTS !== undefined) {
      await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-${name}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Asks for a sign in code on /sign-in, and waits for /verify. */
async function askForCode(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in or sign up' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
}

/** Signs in from /sign-in with a code read from Mailpit, and returns the code used. */
async function signIn(page: Page, email: string, seen: readonly string[] = []): Promise<string> {
  await askForCode(page, email);
  const code = await codeFor(page.request, email, seen);
  await page.getByLabel('Code').fill(code);
  return code;
}

/** Signs a new person in and makes their workspace through first run, landing on its People page. */
async function newWorkspace(page: Page, email: string, name: string, slug: string): Promise<void> {
  await page.goto('/sign-in');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await skipDetailsStep(page);
  await page.getByLabel('Workspace name').fill(name);
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await skipCalendarStep(page);
  // The workspace opens on Home (owner, 21 October 2026); People is a row away.
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: WORKSPACE_MADE_MS });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'People' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people(/views/[0-9a-f-]+)?$`));
  // People draws its own frame once loaded and then moves focus to its title; a menu or confirm opened over the
  // skeleton, or before that focus move, would close with it (at 375 most often).
  const title = page.getByRole('heading', { level: 1, name: 'People' });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
}

/**
 * Answers the sign out confirm by keyboard (the owner, 21 October 2026: it asks first): Tab reaches its commit,
 * last in the dialog, and Enter signs out. Short waits, so a dialog that closed under it fails fast for a retry.
 */
async function confirmSignOut(page: Page): Promise<void> {
  const commit = page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out', exact: true });
  await expect(commit).toBeVisible({ timeout: 5_000 });
  for (
    let tab = 0;
    tab < 4 && !(await commit.evaluate((button) => button === document.activeElement, undefined, { timeout: 2_000 }));
    tab += 1
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(commit).toBeFocused({ timeout: 2_000 });
  await page.keyboard.press('Enter');
}

/**
 * Signs out from the workspace menu, by keyboard, and waits for /sign-in. A page that had only just opened can
 * still settle its route as the menu or the confirm opens (closing it), so the whole ask runs again until it lands.
 */
async function signOut(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /workspace menu/ });
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Sign out?' }).isVisible())) {
      await button.focus();
      await page.keyboard.press('Enter');
      // The menu is whole once the person's role is known (it sits under the open workspace's name; Leave workspace
      // stays out for an only owner); then Sign out is last.
      await expect(page.getByRole('menu').getByText('Owner', { exact: true })).toBeVisible({ timeout: 5_000 });
      // The workspaces come first (spec 0031, AC-801); Sign out is last, so End reaches it.
      await page.keyboard.press('End');
      await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused({ timeout: 2_000 });
      await page.keyboard.press('Enter');
    }
    await confirmSignOut(page);
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/sign-in$/);
}

test('signs in by code, names the workspace, lands on People, signs out, and comes back to a deep link', async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const email = `flow-${tag}@example.com`;
  const slug = `flow-${tag}`;

  // Signed out, / goes to sign in, which is named in the tab.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: /^Continue( with email)?$/ })).toBeVisible();
  await expect(page).toHaveTitle('Sign in or sign up · Timefix');
  // A one field page puts focus in its field on the first load too.
  await expect(page.getByLabel('Email')).toBeFocused();
  // One narrow column for the form (spec 0036): at most 400 px, and 16 px from each edge on a phone. On a wide
  // screen the split card puts the sketch beside it, so the field's column is measured, not the whole card.
  const card = page.getByRole('main');
  const signInBox = await card.boundingBox();
  const fieldBox = await page.getByLabel('Email').boundingBox();
  expect(signInBox !== null && fieldBox !== null).toBe(true);
  if (signInBox !== null && fieldBox !== null) {
    expect(fieldBox.width).toBeLessThanOrEqual(400);
    expect(fieldBox.x).toBeGreaterThanOrEqual(16);
    expect(signInBox.x).toBeGreaterThanOrEqual(16);
  }
  await checkScreen(page, '1-sign-in');

  // A code goes out, and /verify asks for it on the same card, in the same place, with focus in the code boxes.
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByLabel('Code')).toBeFocused();
  const verifyBox = await card.boundingBox();
  expect(verifyBox && { x: verifyBox.x, y: verifyBox.y, width: verifyBox.width }).toEqual(
    signInBox && { x: signInBox.x, y: signInBox.y, width: signInBox.width },
  );
  await expect(page).toHaveTitle('Check your email · Timefix');
  await expect(page.getByRole('button', { name: 'Resend code' })).toBeDisabled();
  await expect(page.getByText(/You can resend the code in/)).toBeVisible();
  await checkScreen(page, '2-verify');

  // A wrong code is refused on the code field, and signs nothing in. No new code can be sent yet, so none is offered.
  const code = await codeFor(page.request, email);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('Code').fill(wrong);
  await expect(page.getByText('That code isn’t right. Try again.').first()).toBeVisible();
  await checkScreen(page, '3-verify-wrong-code');

  // The right code signs in, pasted as an email shows it ("481 593": the space is dropped, never a digit);
  // with no workspace yet, /welcome.
  await page.getByLabel('Code').fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  // First run (spec 0036): Your name, with focus in its one field, counted as the first step.
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByLabel('Your name')).toBeFocused();
  await expect(page).toHaveTitle('Your name · Timefix');
  await expect(page.getByText(/^Step 1 of [45]$/)).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await checkScreen(page, '4-welcome-about');

  // Your workspace: its name follows "Your name", and the address follows the workspace name.
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.keyboard.press('Enter');
  // About you: chips, the first focused; Continue keeps the answers.
  await expect(page).toHaveURL(/\/welcome\?step=details$/);
  await expect(page.getByRole('radio', { name: 'Founder' })).toBeFocused();
  await page.getByRole('radio', { name: 'Founder' }).click();
  await page.getByRole('button', { name: 'Booking meetings' }).click();
  await checkScreen(page, '4a-welcome-details');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/welcome\?step=workspace$/);
  await expect(page).toHaveTitle('Your workspace · Timefix');
  await expect(page.getByLabel('Workspace name')).toBeFocused();
  await expect(page.getByLabel('Workspace name')).toHaveValue('Ada’s workspace');
  // The first free address made from the name (or the email's company), never a numbered one while a cleaner one is free.
  await expect(page.getByLabel('Web address')).toHaveValue(/^[a-z0-9-]{3,40}$/);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  // Typed, the address is lowercase with spaces as dashes, and checked once typing stops.
  await page.getByLabel('Web address').fill(`Flow ${tag}`);
  await expect(page.getByLabel('Web address')).toHaveValue(slug);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await checkScreen(page, '4b-welcome-workspace');
  // Back keeps what was typed, and so does the browser's own.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Founder' })).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('Ada Lovelace');
  await page.goForward();
  await page.goForward();
  await expect(page.getByLabel('Web address')).toHaveValue(slug);

  // Create workspace (past the calendar step where calendar sync is on) lands on Home (owner, 21 October 2026), with focus on its title; People is a row away, and
  // opens empty with focus on its title.
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await skipCalendarStep(page);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: WORKSPACE_MADE_MS });
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'People' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people(/views/[0-9a-f-]+)?$`));
  const title = page.getByRole('heading', { level: 1, name: 'People' });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(page).toHaveTitle('People · Timefix');
  await expect(page.getByText('No people yet')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByText('Ada’s workspace')).toBeAttached();
  // The sidebar (spec 0034, AC-921; owner, 21 and 22 October 2026): Home, Records, then Bookings and Captures in a
  // group with no label, Tasks, then the foot's Settings and Help and shortcuts, inside the sidebar at every
  // width (on the rail, each a named icon in its group). The theme switch left the sidebar for Settings ›
  // Preferences (spec 0026).
  await expect(nav.getByRole('group', { name: 'Scheduling' })).toBeVisible();
  for (const name of ['Home', 'Tasks', 'Bookings', 'Captures']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // The trash left the sidebar for Settings, under Workspace (the owner, 22 October 2026).
  await expect(nav.getByRole('link', { name: 'Trash', exact: true })).toHaveCount(0);
  const settings = nav.getByRole('link', { name: 'Settings', exact: true });
  const [settingsBox, navBox] = [await settings.boundingBox(), await nav.boundingBox()];
  expect(settingsBox !== null && navBox !== null && settingsBox.x + settingsBox.width <= navBox.x + navBox.width).toBe(
    true,
  );
  await expect(nav.getByRole('button', { name: 'Help and shortcuts' })).toBeVisible();
  await expect(nav.getByRole('radiogroup', { name: 'Theme' })).toHaveCount(0);
  await checkScreen(page, '5-people-empty');

  // A workspace that isn't yours says so inside the frame.
  await page.goto(`/w/nowhere-${tag}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open your workspace' })).toBeVisible();
  await checkScreen(page, '6-workspace-not-found');

  // An object that isn't there says so too.
  await page.goto(`/w/${slug}/objects/nothing`);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await checkScreen(page, '6b-page-not-found');

  // Sign out, from the workspace menu, by keyboard.
  await page.goto(`/w/${slug}/objects/people`);
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: /workspace menu/ }).focus();
  await page.keyboard.press('Enter');
  // Whole once the role is known (an only owner gets no Leave workspace).
  await expect(page.getByRole('menu').getByText('Owner', { exact: true })).toBeVisible();
  await checkScreen(page, '7-workspace-menu');
  // The workspaces come first (spec 0031, AC-801); Sign out is last, so End reaches it.
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Enter');
  await confirmSignOut(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  // A one field page: focus in the field, not on the heading.
  await expect(page.getByLabel('Email')).toBeFocused();

  // Signed out, a deep link goes to sign in, then back to the same page.
  await page.goto(`/w/${slug}/objects/people`);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await signIn(page, email, [code, wrong]);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people(/views/[0-9a-f-]+)?$`));
  await expect(page.getByText('No people yet')).toBeVisible();

  // Signed in, / opens the workspace, on Home.
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`));
});

test('says each refusal on its field and drops it as the field changes, so one press goes on', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const taken = `taken-${tag}`;
  // Someone else holds the address first.
  await newWorkspace(page, `flow-first-${tag}@example.com`, `First ${tag}`, taken);
  await signOut(page);

  await signIn(page, `flow-second-${tag}@example.com`);
  await expect(page).toHaveURL(/\/welcome$/);

  // About you: Continue with no name says what to do, on the field; typing clears it at once.
  await page.getByLabel('Your name').fill('');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter your name, or skip this step.')).toBeVisible();
  await checkScreen(page, '4c-welcome-name-refused');
  await page.getByLabel('Your name').pressSequentially(`Zoë ${tag}`);
  await expect(page.getByLabel('Your name')).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await skipDetailsStep(page);

  // Your workspace. A check that can't answer (offline) says nothing, and Create still has the last word: taken,
  // on the field, in the server's words. This runs first: an answer the check once gave is kept for the visit, so
  // an address already found taken never reaches the server.
  const address = page.getByLabel('Web address');
  await page.route('**/api/rpc/workspaces/slugAvailable', (route) => route.abort('connectionrefused'));
  await address.fill(taken);
  await expect(page.getByText('Not checked. Create will check it.')).toBeVisible();
  await expect(page.getByText('Available', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('That workspace address is taken. Pick another.')).toBeVisible();
  await page.unroute('**/api/rpc/workspaces/slugAvailable');

  // Back online, the address someone holds is said to be taken as it is typed, on its field, and Create waits.
  await address.fill('');
  await address.fill(taken);
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Taken', { exact: true })).toBeVisible();
  await checkScreen(page, '4d-welcome-address-taken');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/welcome\?step=workspace$/);

  // Fixed by typing: the refusal goes before any blur, and the check says the new address is free.
  await address.press('End');
  await address.pressSequentially('-two');
  await expect(address).not.toHaveAttribute('aria-invalid');
  await expect(page.getByText('Available', { exact: true })).toBeVisible();

  // Taken again from the kept answer, then fixed again: one press of Create sends it.
  await address.fill(taken);
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await address.fill(`${taken}-two`);
  await expect(address).not.toHaveAttribute('aria-invalid');
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await skipCalendarStep(page);
  // The workspace opens on Home (owner, 21 October 2026).
  await expect(page).toHaveURL(new RegExp(`/w/${taken}-two/home$`), { timeout: WORKSPACE_MADE_MS });
});

test('a refused resend says why under its button and waits as long as the server asks', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const email = `flow-limit-${tag}@example.com`;
  await page.goto('/sign-in');
  await askForCode(page, email);
  // The first code went a while ago, so a new one may be asked for.
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('crm.signIn.pending') ?? '{}';
    sessionStorage.setItem('crm.signIn.pending', JSON.stringify({ ...JSON.parse(raw), sentAt: Date.now() - 120_000 }));
  });
  await page.reload();
  // The first load of /verify puts focus in the code boxes.
  await expect(page.getByLabel('Code')).toBeFocused();
  await page.route('**/api/auth/email-otp/send-verification-otp', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '600' },
      body: JSON.stringify({
        code: 'RATE_LIMITED',
        message: 'Too many codes were sent to this email. Wait a few minutes.',
      }),
    }),
  );
  const resend = page.getByRole('button', { name: 'Resend code' });
  await resend.click();
  // The Callout says what happened; the wait line under the button carries the time.
  await expect(page.getByRole('alert')).toHaveText('Too many codes sent to this email.');
  await expect(page.getByText('You can resend the code in 10 minutes.')).toBeVisible();
  await expect(resend).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Code' })).not.toHaveAttribute('aria-invalid');
  await expect(page.getByText('New code sent')).toHaveCount(0);
  await checkScreen(page, '3b-verify-resend-refused');

  // "Use a different email" goes back with the address filled in.
  await page.getByRole('button', { name: 'Use a different email' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel('Email')).toHaveValue(email);
});

test('a workspace that fails to load says so, with no Records section, and Try again recovers', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const slug = `flow-fail-${tag}`;
  await newWorkspace(page, `flow-fail-${tag}@example.com`, `Failing ${tag}`, slug);
  await page.route('**/api/rpc/objects/list', (route) => route.abort('connectionrefused'));
  await page.goto(`/w/${slug}/objects/people`);
  await expect(page.getByRole('alert')).toContainText('Couldn’t load this workspace');
  await expect(page.getByRole('alert')).toContainText('Check your connection, then try again.');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button', { name: 'Records' })).toHaveCount(0);
  await expect(nav.getByText(`Failing ${tag}`)).toBeAttached();
  await checkScreen(page, '8-workspace-failed');
  await page.unroute('**/api/rpc/objects/list');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  // Try again left with the failed page; focus goes to the new page's title, not the top of the document.
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeFocused();
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible();

  // Failing before the person is known: the product names the page, and the failure is said once.
  await page.route('**/api/rpc/me/get', (route) => route.abort('connectionrefused'));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Couldn’t load this workspace');
  await expect(page.getByRole('heading', { level: 1, name: 'Timefix' })).toBeVisible();
  await expect(page.getByText('Couldn’t load this workspace')).toHaveCount(1);
  await expect(page).toHaveTitle('Timefix');
  await checkScreen(page, '8b-workspace-failed-signed-in-unknown');
  await page.unroute('**/api/rpc/me/get');
});

test('a refused Google sign in says so above the form, keeps the deep link, and says it once', async ({ page }) => {
  await page.goto('/sign-in?redirect=%2Fw%2Facme%2Fobjects%2Fpeople&error=access_denied');
  const notice = page.getByRole('alert');
  await expect(notice).toHaveText('Google sign in was cancelled. Try again, or use your email.');
  // About the sign in, not the address: the email field stays valid, and has focus.
  const email = page.getByLabel('Email');
  await expect(email).not.toHaveAttribute('aria-invalid');
  await expect(email).toBeFocused();
  // The address drops ?error= and keeps ?redirect=, so a reload doesn't say it again.
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fw%2Facme%2Fobjects%2Fpeople$/);
  await checkScreen(page, '1b-sign-in-google-refused');
  await page.reload();
  await expect(page.getByRole('button', { name: /^Continue( with email)?$/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a spent code moves focus to why while the wait runs', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  await page.goto('/sign-in');
  await askForCode(page, `flow-spent-${tag}@example.com`);
  await page.route('**/api/auth/sign-in/email-otp', (route) =>
    route.fulfill({
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many wrong tries for this code. Send a new one.',
      }),
    }),
  );
  const code = page.getByRole('textbox', { name: 'Code', exact: true });
  await code.pressSequentially('123456');
  await expect(code).toBeDisabled();
  // The message under the boxes (focusable from script only), not the status line that announced it.
  const why = page.locator('main [tabindex="-1"]', { hasText: 'Too many wrong tries for this code. Send a new one.' });
  await expect(why).toBeFocused();
  await expect(page.getByRole('button', { name: 'Resend code' })).toBeDisabled();
  await checkScreen(page, '3c-verify-code-spent');
});

test('a second person signing in in the same tab never sees the first one’s workspace', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const first = `Alpha ${tag}`;
  const slug = `alpha-${tag}`;
  await newWorkspace(page, `flow-alpha-${tag}@example.com`, first, slug);
  // Open People again from the sidebar, so the first person's page sits in the tab's history.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  await signOut(page);

  // From here on, watch for the first person's workspace name anywhere on the page.
  await page.evaluate((name) => {
    window.sawForbidden = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes(name)) window.sawForbidden = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, first);

  await signIn(page, `flow-beta-${tag}@example.com`);
  await expect(page).toHaveURL(/\/welcome$/);
  // Back through the history to the first person's page.
  for (let step = 0; step < 6 && !page.url().includes(`/w/${slug}`); step += 1) {
    await page.goBack();
    await page.waitForTimeout(300);
  }
  expect(page.url()).toContain(`/w/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace not found' })).toBeVisible();
  expect(await page.evaluate(() => window.sawForbidden)).toBe(false);
});

test('honours only a redirect inside the app', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const email = `flow-out-${tag}@example.com`;
  await page.goto('/sign-in?redirect=//evil.example/steal');
  await signIn(page, email);
  // No workspace yet, so the safe fallback (/) leads to /welcome, never off the site.
  await expect(page).toHaveURL(/\/welcome$/);
});

test('keeps the status screen at /status, open to anyone, and says plainly when an address is wrong', async ({
  page,
}) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
  await expect(page).toHaveTitle('System status · Timefix');
  // A first load elsewhere leaves focus where the browser starts, not on the title.
  await expect(page.getByRole('heading', { level: 1, name: 'System status' })).not.toBeFocused();
  await expect(page.getByText('Healthy')).toBeVisible();
  await checkScreen(page, '9-status');
  // One or two plain words are a handle address now (22 Oct 2026), which the booking pages answer: a deeper path
  // is the app's own not found.
  await page.goto('/nowhere/to/be/found');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Page not found · Timefix');
  // Signed out, / leads to sign in, so the way back doesn't promise a workspace.
  await expect(page.getByRole('link', { name: 'Back to the start' })).toBeVisible();
  await checkScreen(page, '10-not-found');
});
