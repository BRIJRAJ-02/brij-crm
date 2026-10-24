// Every page's loading state stands where its loaded page will (the owner, 20 October 2026: "the skeleton sometimes
// loads wrong across pages, in terms of width, content and all"). Each screen is opened inside the app with its API
// calls held, so its loading state shows; its main regions (the TopBar, the tab strip, the Toolbar, the page column
// with its main and aside, the tab panel) and the column's width are read, the calls let through, and the loaded
// page read again. Each region must stand within 4 px of where the skeleton put it, and none may appear or vanish.
// A screen that already had what it needs shows no skeleton, which passes. FLOW_SCREENSHOTS keeps both pictures.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page, type Route } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';
import { loadingAndLoaded, shapeDifferences, switchingWorkspace, type SwitchingWorkspace } from './switching.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;

/** One screen: where the move starts, and the click that opens the screen, the way a person reaches it. */
interface Screen {
  readonly name: string;
  readonly start: (workspace: SwitchingWorkspace) => string;
  /** What the person clicks: a link, a tab or a row. */
  readonly target: (page: Page) => Locator;
}

const sidebar = (name: string) => (page: Page) => page.getByRole('navigation').getByRole('link', { name, exact: true });
const tab = (name: string) => (page: Page) => page.getByRole('tab', { name, exact: true });
/** A Captures card, by its title: the title is the link to its editor. */
const card = (name: string) => (page: Page) => page.getByRole('link', { name, exact: true }).first();
const at =
  (where: string) =>
  ({ slug }: SwitchingWorkspace) =>
    `/w/${slug}/${where}`;

const ALL_SCREENS: readonly Screen[] = [
  { name: 'records', start: at('tasks'), target: sidebar('People') },
  {
    name: 'record overview',
    start: at('objects/people'),
    target: (page) =>
      page
        .getByRole('rowheader', { name: /Grace Hopper/ })
        .first()
        .getByText('Grace Hopper'),
  },
  {
    name: 'record activity',
    start: ({ slug, recordId }) => `/w/${slug}/objects/people/${recordId}/overview`,
    target: tab('Activity'),
  },
  {
    name: 'record notes',
    start: ({ slug, recordId }) => `/w/${slug}/objects/people/${recordId}/overview`,
    target: tab('Notes'),
  },
  {
    name: 'record tasks',
    start: ({ slug, recordId }) => `/w/${slug}/objects/people/${recordId}/overview`,
    target: tab('Tasks'),
  },
  { name: 'bookings calendar', start: at('tasks'), target: sidebar('Bookings') },
  { name: 'bookings list', start: at('bookings/calendar'), target: tab('List') },
  { name: 'bookings availability', start: at('bookings/calendar'), target: tab('Availability') },
  { name: 'captures links', start: at('tasks'), target: sidebar('Captures') },
  { name: 'captures forms', start: at('captures/links'), target: tab('Forms') },
  { name: 'booking page editor', start: at('captures/links'), target: card('Intro call') },
  { name: 'form editor', start: at('captures/forms'), target: card('Untitled form') },
  {
    name: 'settings preferences',
    start: at('tasks'),
    target: (page) => page.getByRole('link', { name: 'Settings' }).first(),
  },
  { name: 'settings calendars', start: at('settings/account/preferences'), target: sidebar('Calendars') },
  { name: 'settings members', start: at('settings/account/preferences'), target: sidebar('Members') },
  { name: 'settings objects', start: at('settings/account/preferences'), target: sidebar('Objects') },
  {
    name: 'settings object attributes',
    start: at('settings/objects'),
    target: (page) => page.getByRole('main').getByRole('rowheader', { name: 'People' }).first(),
  },
  {
    name: 'settings object configuration',
    start: at('settings/objects/people/attributes'),
    target: tab('Configuration'),
  },
  { name: 'settings jobs', start: at('settings/account/preferences'), target: sidebar('Background jobs') },
  // History (spec 0046): the owner's Workspace changes, its tabs and the table's skeleton rows where the rows land.
  { name: 'settings history', start: at('settings/account/preferences'), target: sidebar('History') },
  { name: 'trash', start: at('settings/account/preferences'), target: sidebar('Trash') },
];

const ONLY = process.env.FLOW_SCREEN;
const SCREENS = ONLY === undefined ? ALL_SCREENS : ALL_SCREENS.filter(({ name }) => name === ONLY);

test.describe.configure({ mode: 'serial' });

let workspace: SwitchingWorkspace | undefined;

test.beforeAll(async ({ browser }, info) => {
  if (info.project.name === '375') return;
  info.setTimeout(240_000);
  const page = await browser.newPage();
  const tag = `${String(Date.now())}-${info.project.name}`;
  workspace = await switchingWorkspace(
    page,
    async (each) => {
      const slug = `shape-${tag}`;
      await newWorkspace(each, `shape-${tag}@example.com`, slug);
      return slug;
    },
    (each) => addPerson(each, 'Grace', 'Hopper', `grace-${tag}@example.com`),
  );
  const state = path.join(info.outputDir, 'state.json');
  await page.context().storageState({ path: state });
  process.env.FLOW_SHAPE_STATE = state;
  // Kept beside the pictures, so a rerun can start from this workspace (FLOW_STATE, FLOW_SLUG, FLOW_RECORD).
  if (SHOTS !== undefined) {
    await page.context().storageState({ path: path.join(SHOTS, 'state.json') });
    writeFileSync(path.join(SHOTS, 'workspace.json'), JSON.stringify(workspace));
  }
  await page.close();
});

test('every screen’s loading state stands where its loaded page will', async ({ browser }, info) => {
  test.setTimeout(600_000);
  // The phone's rail hides the sidebar's names, which the moves click.
  test.skip(info.project.name === '375', 'The sidebar folds to its rail on a phone.');
  if (workspace === undefined) throw new Error('No workspace.');
  const context = await browser.newContext({ storageState: process.env.FLOW_SHAPE_STATE });
  const page = await context.newPage();
  const problems: string[] = [];
  for (const screen of SCREENS) {
    // A fresh app each time, on the page the move starts from, so the screen's own data isn't held yet.
    await page.goto(screen.start(workspace));
    // The page the move starts from has drawn what is clicked, before any call is held.
    const target = screen.target(page);
    await target.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const shots =
      SHOTS === undefined
        ? undefined
        : path.join(SHOTS, `${info.project.name}-shape-${screen.name.replaceAll(' ', '-')}`);
    const { skeleton, loaded } = await loadingAndLoaded(page, () => target.click(), shots);
    if (skeleton === undefined) continue;
    for (const difference of shapeDifferences(skeleton, loaded)) problems.push(`${screen.name}: ${difference}`);
  }
  await context.close();
  expect(problems).toEqual([]);
});

// A booking page (25 October 2026, the owner: switching views "must not move ANYTHING", and a page opening on chat
// "shifts a little and then prints the UI"). The card's month sets its size in every view and List and Book by chat
// draw over it, so a switch between any two views, from any view the page opens on, leaves the rail, the card, its
// heading row and its body where they were, and the page's height with them. And a page opened on chat draws its
// loading card in the loaded card's place, with the composer's place at its foot.

/** A UUID v7, as the app mints them. */
function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** The booking page's own regions, by what draws them; `composer` is the chat's, or its place while it loads. */
const BOOKING_REGIONS = {
  rail: 'main .ws-booking-frame-rail',
  card: 'main .ws-booking-frame-card',
  head: 'main .ws-booking-frame-head',
  stage: 'main .ws-booking-frame-stage',
  foot: 'main .ws-booking-frame-foot[data-placement="page"]',
  composer: 'main .ws-booking-chat-composer, main .ws-booking-frame-cover-body > [data-shape]:last-child',
} as const;

/** Where each booking region is now, and the page's height. */
async function bookingRegions(
  page: Page,
): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  return page.evaluate((regions) => {
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [name, selector] of Object.entries(regions)) {
      const element = [...document.querySelectorAll(selector)].find((each) => each.getBoundingClientRect().height > 0);
      if (element === undefined) continue;
      const box = element.getBoundingClientRect();
      boxes[name] = { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height };
    }
    boxes.page = { x: 0, y: 0, width: 0, height: document.documentElement.scrollHeight };
    return boxes;
  }, BOOKING_REGIONS);
}

/** Every region that moved, grew, appeared or went by more than 4 px. */
function bookingDifferences(
  before: Record<string, { x: number; y: number; width: number; height: number }>,
  after: Record<string, { x: number; y: number; width: number; height: number }>,
): string[] {
  const found: string[] = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[name];
    const now = after[name];
    if (was === undefined || now === undefined) {
      found.push(`${name} ${was === undefined ? 'appears' : 'goes'}`);
      continue;
    }
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (Math.abs(was[key] - now[key]) > 4)
        found.push(`${name}.${key} ${was[key].toFixed(0)} → ${now[key].toFixed(0)}`);
    }
  }
  return found;
}

const VIEWS = { month: 'Month', list: 'List', chat: 'Book by chat' } as const;
type View = keyof typeof VIEWS;
const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

/** A visitor on the booking page, opening on `view` (the visitor's remembered choice), the page's reads `held` until let go. */
async function visit(browser: Browser, publicKey: string, viewport: { width: number; height: number }, view: View) {
  const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-GB' });
  await context.addInitScript((remembered) => {
    try {
      localStorage.setItem('crm.booking.view', remembered);
    } catch {
      // A browser without storage opens on Month, which the check then says.
    }
  }, view);
  return { context, page: await context.newPage() };
}

test.describe('a booking page', () => {
  let publicKey: string | undefined;

  test.beforeAll(async ({ browser }, info) => {
    if (info.project.name === '375' || workspace === undefined) return;
    const context = await browser.newContext({ storageState: process.env.FLOW_SHAPE_STATE });
    const page = await context.newPage();
    await page.goto(`/w/${workspace.slug}/captures/links`);
    const origin = new URL(page.url()).origin;
    const response = await page.request.post('/api/rpc/bookingPages/create', {
      data: {
        json: { workspace: workspace.slug, id: uuidv7(), title: 'Views call', timeZone: 'UTC', mutationId: uuidv7() },
      },
      headers: { origin },
    });
    expect(response.ok(), await response.text()).toBe(true);
    publicKey = ((await response.json()) as { json: { publicKey: string } }).json.publicKey;
    await context.close();
  });

  test('switching between its views moves nothing, from whichever view it opens on', async ({ browser }, info) => {
    test.setTimeout(300_000);
    test.skip(info.project.name === '375', 'Both widths are measured here, at 1280 and 390.');
    if (publicKey === undefined) throw new Error('No booking page.');
    const problems: string[] = [];
    for (const viewport of WIDTHS) {
      for (const start of Object.keys(VIEWS) as View[]) {
        for (const target of Object.keys(VIEWS) as View[]) {
          if (target === start) continue;
          const { context, page } = await visit(browser, publicKey, viewport, start);
          await page.goto(`/b/${publicKey}`);
          await expect(page.getByRole('radio', { name: VIEWS[start] })).toBeChecked();
          // Settled: the times are in, nothing is busy.
          await page.waitForLoadState('networkidle');
          await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
          await page.waitForTimeout(500);
          const before = await bookingRegions(page);
          await page.locator('label', { has: page.getByRole('radio', { name: VIEWS[target] }) }).click();
          await expect(page.getByRole('radio', { name: VIEWS[target] })).toBeChecked();
          await page.waitForTimeout(600);
          const after = await bookingRegions(page);
          for (const difference of bookingDifferences(before, after))
            problems.push(`${String(viewport.width)} ${start} → ${target}: ${difference}`);
          await context.close();
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('opened on chat, its loading card stands where the loaded chat will', async ({ browser }, info) => {
    test.setTimeout(120_000);
    test.skip(info.project.name === '375', 'Both widths are measured here, at 1280 and 390.');
    if (publicKey === undefined) throw new Error('No booking page.');
    const problems: string[] = [];
    for (const viewport of WIDTHS) {
      const { context, page } = await visit(browser, publicKey, viewport, 'chat');
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hold = async (route: Route) => {
        await gate;
        await route.continue().catch(() => undefined);
      };
      await page.route('**/api/public/**', hold);
      await page.goto(`/b/${publicKey}`);
      await page.locator('main .ws-booking-frame-cover-body > [data-shape]').first().waitFor();
      await page.waitForTimeout(300);
      const loading = await bookingRegions(page);
      release();
      await page.locator('main .ws-booking-chat-composer').waitFor({ timeout: 30_000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1_000);
      const loaded = await bookingRegions(page);
      await page.unroute('**/api/public/**', hold);
      // The rail fills in with the page's facts; the card, its body and the composer hold their places.
      for (const difference of bookingDifferences(loading, loaded).filter((line) => !line.startsWith('rail.height')))
        problems.push(`${String(viewport.width)} chat: ${difference}`);
      await context.close();
    }
    expect(problems).toEqual([]);
  });
});
