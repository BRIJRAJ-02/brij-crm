// Moving between pages (the owner, 20 October 2026: "the switch between pages creates issues, like it loads
// something then it swaps"): through Captures (Links, Forms, a form's editor, a booking page's editor) and Bookings
// (Calendar, List, Availability) by the sidebar, the tabs and the rows, the way a person does (a pointer resting on
// each before the click, so the page preloads). Every switch keeps its layout still (layout shift under 0.01, recent
// input or not), and a page visited before shows its rows at once: no skeleton on a return visit. With
// FLOW_SCREENSHOTS naming a folder, each switch's painted frames are kept for a strip.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';
import { chromeOf, installProbe, measureSwitch, switchingWorkspace, type Switch } from './switching.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;

/** One switch: what is clicked, what shows the page arrived, and the in page probe's name for it. */
interface Step {
  readonly name: string;
  readonly isReturn: boolean;
  /** Captures or Bookings: its chrome must stand as People's does, and stay put between its tabs. */
  readonly section?: 'captures' | 'bookings';
  readonly target: (page: Page) => Locator;
  readonly ready: (page: Page) => Locator;
  readonly probe: { readonly css: string; readonly text?: string };
}

const sidebar = (name: string) => (page: Page) => page.getByRole('navigation').getByRole('link', { name, exact: true });
const tab = (name: string) => (page: Page) => page.getByRole('tab', { name, exact: true });
/** A Captures card, by its title: the title is the link to its editor. */
const card = (name: string) => (page: Page) => page.getByRole('link', { name, exact: true }).first();

const LINKS: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.getByRole('article', { name: 'Intro call' }),
  probe: { css: 'article', text: 'Intro call' },
};
const FORMS: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.getByRole('article', { name: 'Untitled form' }),
  probe: { css: 'article', text: 'Untitled form' },
};
const FORM_EDITOR: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.locator('main h1', { hasText: 'Untitled form' }),
  probe: { css: 'main h1', text: 'Untitled form' },
};
const CALENDAR: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.getByRole('region', { name: /^Bookings, / }),
  probe: { css: '[aria-label^="Bookings, "]' },
};
const LIST: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.getByText('Nothing coming up'),
  probe: { css: '[role="tabpanel"] [role="status"]', text: 'Nothing coming up' },
};
// Availability lists the member's schedules (spec 0035): the virtual default, "Working hours", is always there.
const AVAILABILITY: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.getByRole('grid', { name: 'Schedules' }).getByRole('row').filter({ hasText: 'Working hours' }),
  probe: { css: '[role="row"]', text: 'Working hours' },
};
const PAGE_EDITOR: Pick<Step, 'ready' | 'probe'> = {
  ready: (page) => page.locator('main h1', { hasText: 'Intro call' }),
  probe: { css: 'main h1', text: 'Intro call' },
};

const STEPS: readonly Step[] = [
  { name: 'sidebar to Links', section: 'captures', isReturn: false, target: sidebar('Captures'), ...LINKS },
  { name: 'tab to Forms', section: 'captures', isReturn: false, target: tab('Forms'), ...FORMS },
  { name: 'card to a form', isReturn: false, target: card('Untitled form'), ...FORM_EDITOR },
  { name: 'sidebar to Calendar', section: 'bookings', isReturn: false, target: sidebar('Bookings'), ...CALENDAR },
  { name: 'tab to List', section: 'bookings', isReturn: false, target: tab('List'), ...LIST },
  { name: 'tab to Availability', section: 'bookings', isReturn: false, target: tab('Availability'), ...AVAILABILITY },
  { name: 'sidebar back to Links', section: 'captures', isReturn: true, target: sidebar('Captures'), ...LINKS },
  { name: 'card to a booking page', isReturn: false, target: card('Intro call'), ...PAGE_EDITOR },
  { name: 'sidebar back to Calendar', section: 'bookings', isReturn: true, target: sidebar('Bookings'), ...CALENDAR },
  { name: 'tab back to List', section: 'bookings', isReturn: true, target: tab('List'), ...LIST },
  {
    name: 'tab back to Availability',
    section: 'bookings',
    isReturn: true,
    target: tab('Availability'),
    ...AVAILABILITY,
  },
  { name: 'sidebar back to Captures', section: 'captures', isReturn: true, target: sidebar('Captures'), ...LINKS },
  { name: 'tab back to Forms', section: 'captures', isReturn: true, target: tab('Forms'), ...FORMS },
  { name: 'card back to the form', isReturn: true, target: card('Untitled form'), ...FORM_EDITOR },
];

test('moving through Captures and Bookings keeps the layout still and shows a visited page at once', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  // The phone's rail hides the sidebar's names; the desktop run covers the switches.
  test.skip(info.project.name === '375', 'The sidebar folds to its rail on a phone.');
  const tag = `${String(Date.now())}-${info.project.name}`;
  const { slug } = await switchingWorkspace(
    page,
    async (each) => {
      const made = `switch-${tag}`;
      await newWorkspace(each, `switch-${tag}@example.com`, made);
      return made;
    },
    (each) => addPerson(each, 'Grace', 'Hopper', `grace-${tag}@example.com`),
  );
  await installProbe(page);
  const cdp = await page.context().newCDPSession(page);
  // A fresh app, so the first visit to each page is a cold one.
  await page.goto(`/w/${slug}/objects/people`);
  await sidebar('Captures')(page).waitFor();
  await page.getByRole('grid', { name: 'People' }).waitFor();
  // People's chrome, which Captures and Bookings take: the TopBar, and the bar under it at the same height.
  const people = await chromeOf(page);
  const results: Switch[] = [];
  let previous: { readonly section: string; readonly chrome: Awaited<ReturnType<typeof chromeOf>> } | undefined;
  for (const step of STEPS) {
    const strips = SHOTS === undefined ? undefined : path.join(SHOTS, `${info.project.name}-switch`);
    const result = await measureSwitch(
      page,
      cdp,
      step.name,
      step.target(page),
      step.ready(page),
      step.probe,
      strips === undefined ? {} : { strips },
    );
    results.push(result);
    expect.soft(result.shift, `${step.name}: layout shift (${result.shiftSources.join(', ')})`).toBeLessThan(0.01);
    expect.soft(result.blankFrames, `${step.name}: frames with an empty page`).toBe(0);
    if (step.isReturn) expect.soft(result.skeletonFrames, `${step.name}: skeleton on a return visit`).toBe(0);
    if (step.section === undefined) {
      previous = undefined;
      continue;
    }
    const chrome = await chromeOf(page);
    expect.soft(chrome.topBar, `${step.name}: the TopBar stands as People's`).toEqual(people.topBar);
    expect.soft(chrome.secondBar, `${step.name}: the tabs' bar stands as People's ViewBar`).toEqual(people.secondBar);
    if (previous?.section === step.section) {
      expect.soft(chrome.newButton, `${step.name}: New stays where it was`).toEqual(previous.chrome.newButton);
    }
    previous = { section: step.section, chrome };
  }
  await info.attach('switches', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  if (SHOTS !== undefined)
    writeFileSync(path.join(SHOTS, `${info.project.name}-switches.json`), JSON.stringify(results, null, 2));
});
