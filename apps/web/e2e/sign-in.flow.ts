// The core loop's first steps (spec 0005, milestone 1): sign in by a code
// read from Mailpit, name the workspace, land on the empty People page; sign
// out returns to /sign-in; a deep link while signed out comes back after
// signing in. Every screen is checked with axe (WCAG A and AA, contrast
// included) in light and in dark. Set FLOW_SCREENSHOTS to a folder to keep a
// light and a dark picture of each screen.
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

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
 * (contrast included), and a picture of each when FLOW_SCREENSHOTS asks.
 */
async function checkScreen(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Colours ease between themes; wait until they settle, so contrast is measured on the real colours.
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
    expect(await violations(page), `${name} in ${scheme}`).toEqual([]);
    if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Signs in from /sign-in with a code read from Mailpit, and returns the code used. */
async function signIn(page: Page, email: string, seen: readonly string[] = []): Promise<string> {
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/);
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  const code = await codeFor(page.request, email, seen);
  await page.getByLabel('Code').fill(code);
  return code;
}

test('signs in by code, names the workspace, lands on People, signs out, and comes back to a deep link', async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 8);
  const email = `flow-${tag}@example.com`;
  const slug = `flow-${tag}`;

  // Signed out, / goes to sign in.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await checkScreen(page, '1-sign-in');

  // A code goes out, and /verify asks for it.
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
  await expect(page.getByText(/You can send another in/)).toBeVisible();
  await checkScreen(page, '2-verify');

  // A wrong code is refused on the code field, and signs nothing in.
  const code = await codeFor(page.request, email);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('Code').fill(wrong);
  await expect(page.getByText("That code isn't right. Check it, or send a new one.").first()).toBeVisible();
  await checkScreen(page, '3-verify-wrong-code');

  // The right code signs in; with no workspace yet, /welcome.
  await page.getByLabel('Code').fill(code);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Name your workspace' })).toBeFocused();

  // The workspace name follows "Your name", and the address follows the workspace name.
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await expect(page.getByLabel('Workspace name')).toHaveValue('Ada’s workspace');
  await expect(page.getByLabel('Web address')).toHaveValue('adas-workspace');
  await page.getByLabel('Web address').fill(slug);
  await checkScreen(page, '4-welcome');

  // Create workspace lands on the empty People page, with focus on its title.
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people$`));
  const title = page.getByRole('heading', { level: 1, name: 'People' });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(page.getByText('No people yet')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByText('Ada’s workspace')).toBeVisible();
  await checkScreen(page, '5-people-empty');

  // A workspace that isn't yours says so inside the frame.
  await page.goto(`/w/nowhere-${tag}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace not found' })).toBeVisible();
  await checkScreen(page, '6-workspace-not-found');

  // Sign out, from the workspace menu, by keyboard.
  await page.goto(`/w/${slug}/objects/people`);
  await expect(title).toBeVisible();
  const switcher = page.getByRole('button', { name: /switch workspace/ });
  await switcher.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await checkScreen(page, '7-workspace-menu');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sign-in$/);

  // Signed out, a deep link goes to sign in, then back to the same page.
  await page.goto(`/w/${slug}/objects/people`);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await signIn(page, email, [code, wrong]);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people$`));
  await expect(page.getByText('No people yet')).toBeVisible();

  // Signed in, / opens the workspace.
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people$`));
});

test('honours only a redirect inside the app', async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const email = `flow-out-${tag}@example.com`;
  await page.goto('/sign-in?redirect=//evil.example/steal');
  await signIn(page, email);
  // No workspace yet, so the safe fallback (/) leads to /welcome, never off the site.
  await expect(page).toHaveURL(/\/welcome$/);
});

test('keeps the status screen at /status, open to anyone', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: 'CRM' })).toBeVisible();
  await expect(page.getByText('Healthy')).toBeVisible();
  await checkScreen(page, '8-status');
});
