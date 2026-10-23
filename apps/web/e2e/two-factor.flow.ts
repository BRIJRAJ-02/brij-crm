// Two factor sign in end to end (spec 0033, AC-881 to AC-884): a new person
// turns on the authenticator app from Settings › Account › Sign in, reading
// the setup key the dialog shows and making each code from it here, as an app
// would (RFC 6238, 30 second steps, 6 digits). Then they sign out, sign in by
// email code and the app's code, sign out again, and sign in by email code
// and one of the backup codes the setup showed, which then counts one fewer.
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';
import { homeUrl, newWorkspace } from './people.ts';

/** RFC 4648 base32, as an `otpauth://` secret is written. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The 6 digit code an authenticator app shows for `secret` (base32, spaces allowed) at the 30 second step `step`. */
function totp(secret: string, step: number): string {
  const bits = secret
    .replace(/[\s=]/g, '')
    .toUpperCase()
    .replace(/./g, (char) => BASE32.indexOf(char).toString(2).padStart(5, '0'));
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** The current 30 second step. */
function stepNow(): number {
  return Math.floor(Date.now() / 30_000);
}

/**
 * A code for a step no code has been used in yet, with at least 5 seconds of it left, waiting for the next step when
 * needed: a used code may be refused again, and one typed as its step ends may arrive after it.
 */
async function freshCode(page: Page, secret: string, used: Set<number>): Promise<string> {
  for (;;) {
    const left = 30_000 - (Date.now() % 30_000);
    if (!used.has(stepNow()) && left > 5_000) break;
    await page.waitForTimeout(left + 250);
  }
  const step = stepNow();
  used.add(step);
  return totp(secret, step);
}

/**
 * Signs out from Home's workspace menu and its confirm (the owner, 21 October 2026: it asks first). Settings has a
 * sidebar of its own without that menu, so the sign out starts from Home.
 */
async function signOut(page: Page, slug: string): Promise<void> {
  if (!homeUrl(slug).test(page.url())) await page.goto(`/w/${slug}/home`);
  await expect(async () => {
    if (!(await page.getByRole('dialog', { name: 'Sign out?' }).isVisible())) {
      await page.getByRole('button', { name: /workspace menu/ }).click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click({ timeout: 5_000 });
    }
    await page
      .getByRole('dialog', { name: 'Sign out?' })
      .getByRole('button', { name: 'Sign out', exact: true })
      .click({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/sign-in$/);
}

/** Asks for an email code on /sign-in, types it, and waits for the second step; answers the code used. */
async function emailStep(page: Page, email: string, seen: readonly string[]): Promise<string> {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  const code = await codeFor(page.request, email, seen);
  await page.getByLabel('Code').fill(code);
  await expect(page).toHaveURL(/\/two-factor/);
  await expect(page.getByRole('heading', { level: 1, name: 'Two factor sign in' })).toBeVisible();
  return code;
}

test('turns on two factor, then signs in with an app code and with a backup code', async ({ page }) => {
  // Three sign ins, and up to two waits for a fresh 30 second step.
  test.setTimeout(180_000);
  const tag = randomUUID().slice(0, 8);
  const email = `flow-2fa-${tag}@example.com`;
  const slug = `flow-2fa-${tag}`;
  const used = new Set<number>();
  const seen = [await newWorkspace(page, email, slug)];

  // Settings › Account › Sign in: off, then Set up. A session that has just signed in needs no step up.
  await page.goto(`/w/${slug}/settings/account/sign-in`);
  await page.getByRole('button', { name: 'Set up' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up two factor sign in' });
  await expect(setup.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const secret = (await setup.locator('code').first().innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
  // The app's first code turns it on (the boxes send themselves once full).
  await expect(setup.getByLabel('Code from your authenticator app')).toBeFocused();
  await setup.getByLabel('Code from your authenticator app').fill(await freshCode(page, secret, used));

  // The backup codes, shown once: Done waits for "I've saved these".
  const saveCodes = page.getByRole('dialog', { name: 'Save your backup codes' });
  await expect(saveCodes).toBeVisible();
  const backupCodes = (await saveCodes.locator('code').innerText()).match(/[A-Za-z0-9]{5}-[A-Za-z0-9]{5}/g) ?? [];
  expect(backupCodes.length).toBeGreaterThan(1);
  await expect(saveCodes.getByRole('button', { name: 'Done' })).toBeDisabled();
  await saveCodes.getByRole('checkbox', { name: 'I’ve saved these' }).check({ force: true });
  await saveCodes.getByRole('button', { name: 'Done' }).click();
  await expect(saveCodes).toBeHidden();
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
  await expect(page.getByText(`${String(backupCodes.length)} left. Each works once.`)).toBeVisible();

  // Signed out, an email code alone no longer signs in: the second step asks for the app's code.
  await signOut(page, slug);
  seen.push(await emailStep(page, email, seen));
  await expect(page.getByLabel('Code from your authenticator app')).toBeVisible();
  // A wrong code is refused on the page, and the boxes are cleared for another go. Wrong for any step the server may
  // still take (the one before, now and the next two), so it can't match by chance.
  const near = new Set([-1, 0, 1, 2].map((offset) => totp(secret, stepNow() + offset)));
  const wrong = ['000000', '111111', '222222', '333333', '444444'].find((code) => !near.has(code)) ?? '555555';
  await page.getByLabel('Code from your authenticator app').fill(wrong);
  await expect(page.getByText('That code didn’t work. Try the newest code in your app.')).toBeVisible();
  await expect(page).toHaveURL(/\/two-factor/);
  await expect(page.getByLabel('Code from your authenticator app')).toHaveValue('');
  // The right code is made just before it is typed, so the wrong attempt's wait can't run its step out.
  await page.getByLabel('Code from your authenticator app').fill(await freshCode(page, secret, used));
  await expect(page).toHaveURL(homeUrl(slug), { timeout: 30_000 });

  // Signed out again, a backup code stands in for the app, once.
  await signOut(page, slug);
  seen.push(await emailStep(page, email, seen));
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await expect(page.getByLabel('Backup code')).toBeFocused();
  await page.getByLabel('Backup code').fill(backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(homeUrl(slug), { timeout: 30_000 });

  // The code used is spent: Settings counts one fewer.
  await page.goto(`/w/${slug}/settings/account/sign-in`);
  await expect(page.getByText(`${String(backupCodes.length - 1)} left. Each works once.`)).toBeVisible();
});
