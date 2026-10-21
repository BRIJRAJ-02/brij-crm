// A Google sign in that succeeds (F34), end to end in the browser: the
// sign in screen's "Continue with Google", Google's page, the callback, and
// the app on the other side. Google is faked at both ends, so no real
// account or OAuth client is needed: the browser's visit to Google's page is
// answered here (it sends the browser straight back to the callback, as
// Google does once you pick an account), and the api, started with
// `--import ./test/fake-google.ts`, answers the code exchange with the
// person the code names. A new person lands on first run with Google's name
// in About you and makes a workspace; signing in with Google again opens it,
// and a deep link comes back after Google too.
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { skipCalendarStep } from './people.ts';

/** Making a workspace writes its standard objects in one transaction; on a busy machine that takes a while. */
const WORKSPACE_MADE_MS = 30_000;

// Each test makes a workspace and then signs in again, so it gets two of those waits.
test.describe.configure({ timeout: 120_000 });

/** The person Google says is signing in. */
interface GooglePerson {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
}

/**
 * Plays Google's page: checks the app asked as the OAuth code flow should
 * (its client, PKCE, the callback), then sends the browser back to the
 * callback on this app's origin with the state and a code naming `person`,
 * which the api's fake Google reads. Answers the authorize addresses seen.
 */
async function playGoogle(page: Page, person: GooglePerson): Promise<URL[]> {
  const seen: URL[] = [];
  await page.unrouteAll();
  await page.route('https://accounts.google.com/**', async (route) => {
    const authorize = new URL(route.request().url());
    seen.push(authorize);
    const back = new URL(authorize.searchParams.get('redirect_uri') ?? '');
    // The callback on the origin this flow runs on (the api's APP_URL may name another port of localhost).
    const callback = new URL(back.pathname, page.url());
    callback.searchParams.set('code', Buffer.from(JSON.stringify(person)).toString('base64url'));
    callback.searchParams.set('state', authorize.searchParams.get('state') ?? '');
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  return seen;
}

/** Presses "Continue with Google" on /sign-in. */
async function continueWithGoogle(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in or sign up' })).toBeVisible();
  const google = page.getByRole('button', { name: 'Continue with Google' });
  // The button waits for the app to learn Google is on; outside CI, a stack without Google skips.
  const shown = await google.waitFor({ timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  if (process.env.CI === undefined && !shown) {
    test.skip(true, 'Google sign in is off: start the api with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the fake.');
  }
  await google.click();
}

test('signs a new person in with Google, makes their workspace, and Google opens it again', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const person = { sub: `google-${tag}`, email: `flow-google-${tag}@example.com`, name: `Grace ${tag}` };
  const slug = `google-${tag}`;
  const seen = await playGoogle(page, person);

  await page.goto('/sign-in');
  // Google's own G leads the button; it is decorative, as the label names Google.
  const google = page.getByRole('button', { name: 'Continue with Google' });
  await continueWithGoogle(page);

  // A new person: /welcome, with the name Google gave.
  await expect(page).toHaveURL(/\/welcome$/);
  // The app asked Google as the code flow should: its client, PKCE by S256, and the callback.
  expect(seen).toHaveLength(1);
  const [authorize] = seen;
  expect(authorize?.searchParams.get('response_type')).toBe('code');
  expect(authorize?.searchParams.get('client_id')).not.toBe('');
  expect(authorize?.searchParams.get('code_challenge_method')).toBe('S256');
  expect(new URL(authorize?.searchParams.get('redirect_uri') ?? '').pathname).toBe('/api/auth/callback/google');
  // First run (spec 0036): About you starts from Google's name, and the workspace follows it.
  await expect(page.getByLabel('Your name')).toHaveValue(person.name);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Workspace name')).toHaveValue(`Grace’s workspace`);
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await skipCalendarStep(page);
  // The workspace opens on Home (owner, 21 October 2026).
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: WORKSPACE_MADE_MS });
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  // Sign out, from the workspace menu, which asks first (the owner, 21 October 2026).
  await page.getByRole('button', { name: /workspace menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(google).toBeVisible();

  // Google again, the same person: straight into their workspace.
  await continueWithGoogle(page);
  // The workspace opens on Home (owner, 21 October 2026).
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: WORKSPACE_MADE_MS });
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  expect(seen).toHaveLength(2);
});

test('a deep link opened while signed out comes back after Google', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const person = { sub: `google-deep-${tag}`, email: `flow-google-deep-${tag}@example.com`, name: `Ada ${tag}` };
  const slug = `google-deep-${tag}`;
  await playGoogle(page, person);

  // First, the person and their workspace.
  await page.goto('/sign-in');
  await continueWithGoogle(page);
  await expect(page).toHaveURL(/\/welcome$/);
  // Skip About you: Google's name stands.
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await skipCalendarStep(page);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: WORKSPACE_MADE_MS });
  await page.context().clearCookies();

  // Signed out, a deep link goes to sign in, and Google brings the person back to it.
  await page.goto(`/w/${slug}/objects/companies`);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await continueWithGoogle(page);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/companies(/views/[0-9a-f-]+)?$`), {
    timeout: WORKSPACE_MADE_MS,
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();
});
