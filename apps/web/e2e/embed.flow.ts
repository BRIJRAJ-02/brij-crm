// Embeds that never overflow, and a site's own tagged form (spec 0023,
// 0023-embeds.md). A member publishes a form and a booking page through the
// API; host pages on another origin (a small server the test starts on
// 127.0.0.1, so the browser's local network rules let a page on this machine
// load the app on this machine) load our one script. At 320, 390, 768, 1280 and 1920 wide, in Chromium and
// WebKit, on a plain page, a page with aggressive global CSS, a narrow
// sidebar column and a column that changes width while open, each inline
// frame fills its column, never spills sideways, never scrolls inside, and
// stands as tall as its content within 2px. The popup traps focus, locks the
// page's scroll, fills a phone's screen, closes on Escape and hands focus
// back; the corner button opens it in the form's words. Then the site's own
// HTML, taken from the Install tab, posts with where it came from, which the
// submission keeps.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test, webkit, type Browser, type Frame, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

const WIDTHS = [320, 390, 768, 1280, 1920] as const;

/** Signs a new person in through Mailpit and names their workspace, patient with a busy machine. */
async function newWorkspace(page: Page, email: string, slug: string): Promise<void> {
  const patient = { timeout: 120_000 };
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/, patient);
  await page.getByLabel('Code').fill(await codeFor(page.request, email));
  await expect(page).toHaveURL(/\/welcome$/, patient);
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/`), patient);
}

function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: T }).json;
}

/** A host page on the host origin: the script once, then `body`, under optional styles of its own. */
function hostPage(script: string, body: string, style = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pricing at Acme</title><style>body{margin:0;font-family:serif}${style}</style></head><body>${body}<script src="${script}" async></script></body></html>`;
}

/** The host pages the inline embeds are tried on, by name. */
const PAGES = {
  plain: (holder: string) => `<main style="padding:16px">${holder}</main>`,
  aggressive: (holder: string) => `<main>${holder}</main>`,
  sidebar: (holder: string) =>
    `<div style="display:flex;gap:16px"><aside id="column" style="flex:0 0 240px;min-width:0">${holder}</aside><main style="flex:1">Text</main></div>`,
  resizing: (holder: string) => `<div id="column" style="width:900px;max-width:100%">${holder}</div>`,
} as const;

const AGGRESSIVE =
  '* { box-sizing: content-box !important; font-size: 20px } div { padding: 7px } iframe { border: 6px solid red }';

/** A host site on this machine: serves `pages` at /host/<name>, on a port of its own. */
async function startHost(
  pages: Readonly<Record<string, string>>,
): Promise<{ readonly origin: string; readonly stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const name = new URL(request.url ?? '/', 'http://host').pathname.replace(/^\/host\//, '');
    const html = pages[name];
    response.writeHead(html === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html ?? 'none');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The host server has no port.');
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** The embed's frame on a host page, once it has told the host its height. */
async function readyFrame(page: Page): Promise<Frame> {
  await expect(page.locator('[data-timefix-embed] .box[data-ready]')).toBeVisible({ timeout: 30_000 });
  const handle = await page.locator('[data-timefix-embed] iframe').elementHandle();
  const frame = await handle.contentFrame();
  if (frame === null) throw new Error('The embed has no frame.');
  return frame;
}

/** No sideways spill on the host, the frame inside its column, no scroll inside, and its height its content's. */
async function expectFits(page: Page, frame: Frame, label: string): Promise<void> {
  // Let the last height land.
  await page.waitForTimeout(300);
  const host = await page.evaluate(() => {
    const frameElement = document.querySelector('[data-timefix-embed]')?.shadowRoot?.querySelector('iframe');
    const holder = document.querySelector('[data-timefix-form], [data-timefix-booking]');
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameWidth: frameElement?.getBoundingClientRect().width ?? -1,
      frameHeight: frameElement?.getBoundingClientRect().height ?? -1,
      column: holder?.getBoundingClientRect().width ?? -1,
    };
  });
  const inside = await frame.evaluate(() => {
    const root = document.querySelector('[data-app-root]');
    const drawn = root?.lastElementChild ?? document.querySelector('main');
    return {
      scrollY: document.documentElement.scrollHeight - window.innerHeight,
      scrollX: document.documentElement.scrollWidth - window.innerWidth,
      content: drawn?.getBoundingClientRect().height ?? -1,
    };
  });
  expect(host.overflow, `${label}: the host spills sideways`).toBeLessThanOrEqual(0);
  expect(host.frameWidth, `${label}: the frame is wider than its column`).toBeLessThanOrEqual(host.column + 0.5);
  expect(inside.scrollX, `${label}: the frame scrolls sideways`).toBeLessThanOrEqual(0);
  expect(inside.scrollY, `${label}: the frame scrolls inside`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(host.frameHeight - inside.content),
    `${label}: the frame's height is not its content's`,
  ).toBeLessThanOrEqual(2);
}

test.describe('embeds and the site’s own form', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The flow sizes its own windows.');

  test('fit every width and host, pop up properly, and tag the site’s own form', async ({ page, browser }) => {
    test.setTimeout(600_000);
    const tag = randomUUID().slice(0, 8);
    const workspace = `embed-${tag}`;
    await newWorkspace(page, `embed-${tag}@example.com`, workspace);
    const origin = new URL(page.url()).origin;
    const script = `${origin}/embed/v1.js`;

    const form = await rpc<{ id: string; revision: number }>(page, 'forms/create', {
      workspace,
      id: uuidv7(),
      name: 'Talk to us',
      mutationId: randomUUID(),
    });
    const live = await rpc<{ id: string; publicKey: string }>(page, 'forms/publish', {
      workspace,
      formId: form.id,
      expectedRevision: form.revision,
      mutationId: randomUUID(),
    });
    const booking = await rpc<{ publicKey: string }>(page, 'bookingPages/create', {
      workspace,
      id: uuidv7(),
      title: 'Intro call',
      timeZone: 'UTC',
      mutationId: randomUUID(),
    });

    const formHolder = `<div data-timefix-form="${live.publicKey}" data-timefix-title="Talk to us"></div>`;
    const bookingHolder = `<div data-timefix-booking="${booking.publicKey}" data-timefix-title="Book a time"></div>`;
    const pages: Record<string, string> = {
      plain: hostPage(script, PAGES.plain(formHolder)),
      aggressive: hostPage(script, PAGES.aggressive(formHolder), AGGRESSIVE),
      sidebar: hostPage(script, PAGES.sidebar(formHolder)),
      resizing: hostPage(script, PAGES.resizing(formHolder)),
      booking: hostPage(script, PAGES.plain(bookingHolder)),
      popup: hostPage(
        script,
        `<main style="height:3000px"><button id="open" data-timefix-form="${live.publicKey}" data-timefix-mode="popup" data-timefix-title="Talk to us">Talk to us</button></main>`,
      ),
      floating: hostPage(
        script,
        `<div data-timefix-form="${live.publicKey}" data-timefix-mode="floating" data-timefix-text="Ask us anything" data-timefix-color="#1f5fd6"></div>`,
      ),
    };
    const hosting = await startHost(pages);
    const HOST = hosting.origin;

    /** Every host at every width in one engine. */
    const tryEngine = async (engine: Browser, name: string) => {
      const context = await engine.newContext();
      const visitor = await context.newPage();
      for (const width of WIDTHS) {
        await visitor.setViewportSize({ width, height: 900 });
        for (const host of ['plain', 'aggressive', 'sidebar', 'booking'] as const) {
          await visitor.goto(`${HOST}/host/${host}`);
          await expectFits(visitor, await readyFrame(visitor), `${name} ${host} at ${String(width)}`);
        }
      }
      // A column that changes width while the form is open.
      await visitor.setViewportSize({ width: 1280, height: 900 });
      await visitor.goto(`${HOST}/host/resizing`);
      const frame = await readyFrame(visitor);
      for (const column of [900, 320, 600, 280]) {
        await visitor.evaluate((wide) => {
          const element = document.getElementById('column');
          if (element !== null) element.style.width = `${String(wide)}px`;
        }, column);
        await expectFits(visitor, frame, `${name} resizing to ${String(column)}`);
      }
      await context.close();
    };
    await tryEngine(browser, 'chromium');
    const otherEngine = await webkit.launch();
    try {
      await tryEngine(otherEngine, 'webkit');
    } finally {
      await otherEngine.close();
    }

    // The popup: its own button opens it, focus inside, the page held still, Escape closes, focus back on the button.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.setViewportSize({ width: 1280, height: 900 });
    await visitor.goto(`${HOST}/host/popup`);
    await visitor.locator('#open').click();
    const dialog = visitor.getByRole('dialog', { name: 'Talk to us' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    const inner = visitor.frameLocator('[data-timefix-embed] iframe');
    await expect(inner.getByLabel(/Your name/)).toBeVisible();
    expect(await visitor.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    // Back from Close goes into the form, never out to the page behind.
    await visitor.keyboard.press('Shift+Tab');
    expect(
      await visitor.evaluate(() =>
        [...document.querySelectorAll('[data-timefix-embed]')].some(
          (host) => (host.shadowRoot?.activeElement?.closest('[role="dialog"]') ?? null) !== null,
        ),
      ),
    ).toBe(true);
    await visitor.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(visitor.locator('#open')).toBeFocused();
    expect(await visitor.evaluate(() => document.documentElement.style.overflow)).toBe('');
    // On a phone it fills the screen, and Escape inside the form closes it too.
    await visitor.setViewportSize({ width: 390, height: 800 });
    await visitor.locator('#open').click();
    await expect(dialog).toBeVisible();
    // Measured once the opening scale has settled, so the box is the panel's own size.
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box === null ? undefined : { width: Math.round(box.width), height: Math.round(box.height) };
      })
      .toEqual({ width: 390, height: 800 });
    await inner.getByLabel(/Your name/).click();
    await visitor.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // The corner button, in the form's words.
    await visitor.setViewportSize({ width: 1280, height: 900 });
    await visitor.goto(`${HOST}/host/floating`);
    await visitor.getByRole('button', { name: 'Ask us anything' }).click();
    await expect(visitor.getByRole('dialog')).toBeVisible();

    // The site's own HTML, from the Install tab, listed site and all.
    await rpc(page, 'forms/updateSettings', {
      workspace,
      formId: live.id,
      allowedOrigins: [HOST],
      mutationId: randomUUID(),
    });
    await page.goto(`/w/${workspace}/forms/${live.id}?tab=install`);
    await page.getByRole('button', { name: 'For developers' }).click();
    const own = await page.getByRole('textbox', { name: 'Form HTML' }).inputValue();
    expect(own).toContain(`data-timefix-form="${live.publicKey}"`);
    expect(own).toMatch(/data-timefix-workspace="ws_[a-f0-9]{16}"/);
    pages['landing'] = hostPage(script, `<main>${own.replace(/<script[^>]*><\/script>/, '')}</main>`);
    await visitor.goto(`${HOST}/host/landing?utm_campaign=spring&utm_source=newsletter`);
    await visitor.locator('input[name="name"]').fill('Grace Hopper');
    await visitor.locator('input[name="email"]').fill(`grace-${tag}@example.com`);
    await visitor.waitForTimeout(2_500);
    await visitor.getByRole('button', { name: 'Send' }).click();
    await expect(visitor.getByRole('status')).toHaveText('Thank you. That is with us.');
    const listed = await rpc<{ items: { id: string }[] }>(page, 'submissions/list', { workspace, formId: live.id });
    const first = listed.items[0];
    if (first === undefined) throw new Error('The own form’s submission did not arrive.');
    const view = await rpc<{ context?: Record<string, unknown> }>(page, 'submissions/get', {
      workspace,
      submissionId: first.id,
    });
    expect(view.context).toMatchObject({
      page_url: `${HOST}/host/landing?utm_campaign=spring&utm_source=newsletter`,
      page_title: 'Pricing at Acme',
      utm_campaign: 'spring',
      utm_source: 'newsletter',
      mode: 'own',
    });
    expect(view.context?.visitor_id).toBeUndefined();
    await hosting.stop();
  });
});
