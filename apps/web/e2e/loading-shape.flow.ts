// Every page's loading state stands where its loaded page will (the owner, 20 October 2026: "the skeleton sometimes
// loads wrong across pages, in terms of width, content and all"). Each screen is opened inside the app with its API
// calls held, so its loading state shows; its main regions (the TopBar, the tab strip, the Toolbar, the page column
// with its main and aside, the tab panel) and the column's width are read, the calls let through, and the loaded
// page read again. Each region must stand within 4 px of where the skeleton put it, and none may appear or vanish.
// A screen that already had what it needs shows no skeleton, which passes. FLOW_SCREENSHOTS keeps both pictures.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';
import { loadingAndLoaded, shapeDifferences, switchingWorkspace, type SwitchingWorkspace } from './switching.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;

/** One screen: where the move starts, and the click that opens the screen, the way a person reaches it. */
interface Screen {
  readonly name: string;
  readonly start: (workspace: SwitchingWorkspace) => string;
  /** What the person clicks: a link, a tab or a row. */
  readonly target: (page: Page) => Locator;
  /** What opens first to show the target (a menu), if anything. */
  readonly reveal?: (page: Page) => Promise<void>;
}

const sidebar = (name: string) => (page: Page) => page.getByRole('navigation').getByRole('link', { name, exact: true });
const tab = (name: string) => (page: Page) => page.getByRole('tab', { name, exact: true });
/** A booking page's or a form's card, by its title: the title is the link to its editor. */
const card = (name: string) => (page: Page) => page.getByRole('link', { name, exact: true }).first();
const at =
  (where: string) =>
  ({ slug }: SwitchingWorkspace) =>
    `/w/${slug}/${where}`;

const ALL_SCREENS: readonly Screen[] = [
  { name: 'records', start: at('trash'), target: sidebar('People') },
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
  { name: 'bookings calendar', start: at('trash'), target: sidebar('Bookings') },
  { name: 'bookings list', start: at('bookings/calendar'), target: tab('List') },
  { name: 'availability', start: at('bookings/calendar'), target: sidebar('Availability') },
  { name: 'booking pages', start: at('trash'), target: sidebar('Booking pages') },
  { name: 'forms', start: at('booking-pages'), target: sidebar('Forms') },
  { name: 'booking page editor', start: at('booking-pages'), target: card('Intro call') },
  { name: 'form editor', start: at('forms'), target: card('Untitled form') },
  {
    name: 'settings preferences',
    start: at('trash'),
    target: (page) => page.getByRole('link', { name: 'Settings' }).first(),
  },
  { name: 'settings calendars', start: at('settings/account/preferences'), target: sidebar('Calendars') },
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
  // The trash is a row of the workspace menu (owner, 21 October 2026).
  {
    name: 'trash',
    start: at('booking-pages'),
    reveal: (page) => page.getByRole('button', { name: /workspace menu/ }).click(),
    target: (page) => page.getByRole('menuitem', { name: 'Trash' }),
  },
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
    await screen.reveal?.(page);
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
