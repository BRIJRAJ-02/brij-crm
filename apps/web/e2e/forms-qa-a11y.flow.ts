// Forms QA, accessibility (5 November 2026): the builder walked by keyboard alone (add a question, set its type,
// make it required, start a step, add a rule, publish), each stop reached by Tab with a visible focus ring; the
// guest form filled and sent by keyboard alone in Classic, Steps and One at a time; and axe (axe-core 4.13, already
// in the catalog, loaded by `people.ts`' `checkScreen`) on the builder, Settings, Submissions, Analytics, Share and
// the guest form, light and dark, at 1280 and 390 wide.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { checkScreen } from './people.ts';
import {
  asOwner,
  expectThanks,
  expectVisibleFocus,
  HUMAN_PACE_MS,
  liveForm,
  makeOwner,
  q,
  tabTo,
  TRY_AGAIN,
  visitorOn,
  type FormView,
  type Owner,
} from './forms-qa.ts';

let owner: Owner;
const WIDTHS = [1280, 390] as const;

/** A form whose steps and questions every layout can draw: name, email, a choice and a short answer. */
function document(layout: 'classic' | 'steps' | 'conversational') {
  return (draft: FormView['draft']) => ({
    ...draft,
    layout,
    questions: [
      ...draft.questions,
      q('plan', 'Which plan', 'choice', { choices: ['Starter', 'Team'] }),
      q('role', 'Your role', 'short_text'),
    ],
    ...(layout === 'steps' ? { steps: [{ id: 'more', title: 'About you', startsAt: 'plan' }] } : {}),
  });
}

/** Shift Tab until `target` (or something inside it) has focus, a visible ring on it. */
async function shiftTabTo(page: Page, target: ReturnType<Page['locator']>, max = 40): Promise<void> {
  for (let press = 0; press < max; press += 1) {
    if (
      await target.evaluate(
        (element) =>
          element === globalThis.document.activeElement || element.contains(globalThis.document.activeElement),
      )
    ) {
      await expectVisibleFocus(page);
      return;
    }
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error(`Not reached by Shift Tab within ${String(max)} presses: ${target.toString()}`);
}

/** Types into whatever has focus after Tab reaches `label`. */
async function tabAndType(page: Page, label: RegExp, text: string): Promise<void> {
  await tabTo(page, page.getByLabel(label).first());
  await page.keyboard.type(text);
}

test.describe('forms QA: accessibility', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Each check sets its own widths.');
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    owner = await makeOwner(browser, testInfo, 'a11y');
  });

  test('the builder by keyboard alone: add a question, type, required, a step, a rule, publish', async ({ page }) => {
    test.setTimeout(240_000);
    await asOwner(page, owner);
    // Steps, so a new step can be started between two questions.
    const form = await liveForm(page, owner, `Keys ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      layout: 'steps',
    }));
    await page.goto(`/w/${owner.slug}/captures/forms/${form.id}`);
    await expect(page.getByRole('button', { name: 'Add a question', exact: true })).toBeVisible({ timeout: 30_000 });
    // Start from the page's top, as someone arriving by keyboard does.
    await page.locator('body').focus();

    // Add a question picks its type first (T40); the new question's words take focus, ready to type.
    await tabTo(page, page.getByRole('button', { name: 'Add a question', exact: true }), 120);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Enter');
    const fresh = page.getByLabel('Question', { exact: true }).last();
    await expect(fresh, 'Add a question puts focus in the new question').toBeFocused({ timeout: 5_000 });
    await expectVisibleFocus(page);
    await page.keyboard.type('What is your budget?');
    await expect(fresh).toHaveValue('What is your budget?');

    // Its type is the small menu just before its words.
    const type = page.getByRole('button', { name: /^Answer type/ }).last();
    await shiftTabTo(page, type);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu').first()).toBeVisible();
    await page.keyboard.type('Number');
    await page.keyboard.press('Enter');
    await expect(type).toHaveAccessibleName('Answer type: Number');

    const required = page.getByRole('switch', { name: 'Required' }).last();
    await tabTo(page, required);
    await page.keyboard.press('Space');
    await expect(required).toBeChecked();

    // The quiet + always in the gap above the card: Start a new step here.
    const gap = page.getByRole('button', { name: 'Add a question or a step here' }).last();
    await shiftTabTo(page, gap);
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Start a new step here' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Step title' })).toBeFocused();
    await page.keyboard.type('Budget');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^Step \d · Budget/).first()).toBeVisible();

    // A rule, from the question's own ⋯: Show only if…
    const more = page.getByRole('button', { name: 'More for What is your budget?' });
    await tabTo(page, more, 120);
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Show only if…' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Show only if', { exact: true }).first()).toBeVisible();

    const publish = page.getByRole('button', { name: /^Publish/ }).first();
    await tabTo(page, publish, 200);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Published\.|Your form is live/).first()).toBeVisible({ timeout: 30_000 });
  });

  for (const layout of ['classic', 'steps', 'conversational'] as const) {
    test(`the guest form by keyboard alone, ${layout}`, async ({ page, browser }) => {
      test.setTimeout(180_000);
      await asOwner(page, owner);
      const form = await liveForm(page, owner, `Keys ${layout} ${randomUUID().slice(0, 6)}`, document(layout));
      const visitor = await visitorOn(browser, form);
      await visitor.locator('body').focus();
      await tabAndType(visitor, /Your name/, 'Ada Lovelace');
      if (layout === 'conversational') await visitor.keyboard.press('Enter');
      await tabAndType(visitor, /Work email/, `ada-keys-${form.id.slice(-6)}@example.com`);
      if (layout !== 'classic') await visitor.keyboard.press('Enter');
      if (layout === 'conversational') {
        // Phone or WhatsApp is optional: Enter goes on.
        await expectVisibleFocus(visitor);
        await visitor.keyboard.press('Enter');
      }
      // A choice: Tab into the group, the arrows pick, and Space or Enter takes it.
      const plan = visitor.getByRole('radio', { name: 'Team' });
      await tabTo(visitor, visitor.getByRole('radio').first());
      await visitor.keyboard.press('ArrowDown');
      await expect(plan).toBeChecked();
      if (layout === 'conversational') await visitor.keyboard.press('Enter');
      await tabAndType(visitor, /Your role/, 'Engineer');
      await visitor.waitForTimeout(HUMAN_PACE_MS);
      // Enter in the last one line field sends (Classic) or sends on the last step.
      await visitor.keyboard.press('Enter');
      // Every local visitor shares one address: if this minute's five sends are spent, wait it out and press again.
      if (
        await visitor
          .getByText(TRY_AGAIN)
          .waitFor({ timeout: 4_000 })
          .then(
            () => true,
            () => false,
          )
      ) {
        await visitor.waitForTimeout(61_000);
        await visitor.keyboard.press('Enter');
      }
      await expectThanks(visitor);
      // Focus goes to the thank you's heading, so a screen reader hears it.
      await expect(visitor.getByRole('heading', { name: /Thanks, we got it/ }).first()).toBeFocused();
      await visitor.context().close();
    });
  }

  for (const width of WIDTHS) {
    test(`axe finds nothing on the builder, Settings, Submissions and Analytics at ${String(width)}`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await asOwner(page, owner);
      const form = await liveForm(page, owner, `Axe ${String(width)} ${randomUUID().slice(0, 6)}`);
      const base = `/w/${owner.slug}/captures/forms/${form.id}`;
      for (const [tab, name] of [
        ['', 'builder'],
        ['?tab=settings', 'settings'],
        ['?tab=submissions', 'submissions'],
        ['?tab=analytics', 'analytics'],
      ] as const) {
        await page.goto(`${base}${tab}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
        await page.waitForLoadState('networkidle');
        await checkScreen(page, `forms-${name}-${String(width)}`);
      }
    });

    test(`axe finds nothing on Share at ${String(width)}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await asOwner(page, owner);
      const form = await liveForm(page, owner, `Axe share ${String(width)} ${randomUUID().slice(0, 6)}`);
      await page.goto(`/w/${owner.slug}/captures/forms/${form.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
      // Share (wip/forms-guest) replaces Install; until it lands there is no Share to check.
      const share = page.getByRole('tab', { name: 'Share' }).or(page.getByRole('link', { name: 'Share', exact: true }));
      test.fixme((await share.count()) === 0, 'Waits on wip/forms-guest: the Share tab.');
      await share.first().click();
      await page.waitForLoadState('networkidle');
      await checkScreen(page, `forms-share-${String(width)}`);
    });

    test(`axe finds nothing on the guest form in each layout at ${String(width)}`, async ({ page, browser }) => {
      test.setTimeout(240_000);
      await asOwner(page, owner);
      for (const layout of ['classic', 'steps', 'conversational'] as const) {
        const form = await liveForm(page, owner, `Axe guest ${layout} ${randomUUID().slice(0, 6)}`, document(layout));
        const visitor = await visitorOn(browser, form, { viewport: { width, height: width === 390 ? 844 : 800 } });
        await expect(visitor.getByLabel(/Your name/)).toBeVisible({ timeout: 30_000 });
        await checkScreen(visitor, `guest-${layout}-${String(width)}`);
        // And with its errors showing, the state most people with a screen reader meet first.
        if (layout === 'classic') {
          await visitor.getByRole('button', { name: 'Send', exact: true }).click();
          await expect(visitor.getByText('Answer this question.').first()).toBeVisible();
          await checkScreen(visitor, `guest-${layout}-errors-${String(width)}`);
        }
        await visitor.context().close();
      }
    });
  }
});
