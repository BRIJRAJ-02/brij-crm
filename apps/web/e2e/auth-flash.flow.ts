// Opening the app while already signed in (the owner, 24 October 2026: "when I go and I am logged in on
// app.timefix.ai, before checking it flashed the signup page"; that host is app.timefix.com since the same day).
// The app is a single page app, so it cannot know there is a session until `me.get` answers; it used to draw
// sign in's screen first and replace it. Now the place held while that answer is out is the app's own (the
// shell's skeleton), unless this browser's last visit ended signed out, when sign in's own frame stands, so
// nobody waits on a screen they are not going to.
//
// Each test watches the page from before its first script runs and records every word that ever reached the
// document, so a screen that showed for one frame is still caught.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { homeUrl, newWorkspace } from './people.ts';

/** Sign in's own words: its heading, and the one button on its form. */
const SIGN_IN_WORDS = ['Sign in or sign up', 'Continue with email'];
/** The app's: the sidebar landmark only the app shell draws. */
const APP_SHELL = 'Main navigation';

declare global {
  interface Window {
    /** Every word from WATCHED that has reached the document since this page began. */
    __seen?: string[];
  }
}

/**
 * Watches the document from before the app's own scripts run: whatever of `words` is in the page when it is first
 * parsed, and whatever arrives later, is recorded, so a screen drawn for a single frame is still seen.
 */
async function watchFor(page: Page, words: readonly string[]): Promise<void> {
  await page.addInitScript(
    (watched: string[]) => {
      window.__seen = [];
      const look = () => {
        const seenSoFar: string[] = window.__seen ?? [];
        // textContent, not innerText: innerText forces a layout, and this runs on every mutation while the app boots.
        const text = document.body.textContent;
        const labels = [...document.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label'));
        for (const word of watched) {
          if ((text.includes(word) || labels.includes(word)) && !seenSoFar.includes(word)) seenSoFar.push(word);
        }
        window.__seen = seenSoFar;
      };
      const start = () => {
        look();
        new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    },
    [...words],
  );
}

/** What the watcher has seen so far. */
const seen = (page: Page) => page.evaluate(() => window.__seen ?? []);

/** Holds `me.get` for `ms`, so the place the app holds while the session is unknown is certain to be drawn. */
async function holdSession(page: Page, ms: number): Promise<void> {
  await page.route('**/api/rpc/me/get', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.describe('opening the app', () => {
  test('a signed in person opening the root lands on their workspace, never seeing a sign in screen', async ({
    page,
  }) => {
    const tag = randomUUID().slice(0, 8);
    const slug = `flash-${tag}`;
    await newWorkspace(page, `flash-${tag}@example.com`, slug);

    // The session answer held back, so the loading state can't be skipped past: this is the moment the sign up
    // page used to flash in.
    await holdSession(page, 1500);
    await watchFor(page, [...SIGN_IN_WORDS, APP_SHELL]);
    await page.goto('/');

    // The app's own place stands while the answer is out: the shell, with nothing of the person's in it yet.
    await expect(page.getByRole('navigation', { name: APP_SHELL })).toBeVisible();
    expect(await seen(page)).not.toContain(SIGN_IN_WORDS[0]);
    // Then the workspace itself, with no detour through sign in on the way.
    await expect(page).toHaveURL(homeUrl(slug), { timeout: 30_000 });
    expect(await seen(page)).toEqual([APP_SHELL]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a signed in person reloading a page of their workspace never sees a sign in screen either', async ({
    page,
  }) => {
    const tag = randomUUID().slice(0, 8);
    const slug = `reload-${tag}`;
    await newWorkspace(page, `reload-${tag}@example.com`, slug);
    const people = new URL(page.url()).pathname;

    await holdSession(page, 1500);
    await watchFor(page, [...SIGN_IN_WORDS, APP_SHELL]);
    await page.reload();

    await expect(page.getByRole('navigation', { name: APP_SHELL })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${people}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    expect(await seen(page)).toEqual([APP_SHELL]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a signed out person reaches sign in, and a browser that knows it waits on no app of its own', async ({
    page,
  }) => {
    // A browser with nothing remembered: it is held nowhere but the app's own quiet place, and sign in follows.
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in or sign up' })).toBeVisible();

    // That visit taught it that nobody was signed in, so the next one holds sign in's place, not the app's.
    await holdSession(page, 1500);
    await watchFor(page, [...SIGN_IN_WORDS, APP_SHELL]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in or sign up' })).toBeVisible();
    expect(await seen(page)).not.toContain(APP_SHELL);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
