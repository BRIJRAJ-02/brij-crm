// Forms QA, the guest form on a phone (5 November 2026): at 390 by 844 with touch and reduced motion, each layout
// (Classic, Steps, One at a time) is filled end to end, Steps and One at a time taking a jump past a question that
// no longer applies, and each hands the visitor on to a booking page. Nothing scrolls sideways on the way. The
// config has no WebKit project, so this runs in Chromium's phone mode; set FLOW_PHONE_BROWSER=webkit to run the
// same file in WebKit (`npx playwright install webkit` first).
import { randomUUID } from 'node:crypto';
import { devices, expect, test, webkit, type Browser, type Page } from '@playwright/test';
import {
  asOwner,
  expectNoSidewaysScroll,
  HUMAN_PACE_MS,
  liveForm,
  makeOwner,
  q,
  rpc,
  uuidv7,
  visitorOn,
  type FormView,
  type Owner,
} from './forms-qa.ts';

let owner: Owner;
let bookingPageId: string | undefined;
const PHONE = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: devices['iPhone 13'].userAgent,
  reducedMotion: 'reduce',
} as const;

/** The jump's condition: a small budget skips the budget detail. */
const SMALL = { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Small' }] } as const;

function documentFor(layout: 'classic' | 'steps' | 'conversational') {
  return (draft: FormView['draft']) => ({
    ...draft,
    layout,
    after: { kind: 'booking', bookingPageId, countdownSeconds: 1, message: '' },
    questions: [
      ...draft.questions,
      q('budget', 'Budget', 'choice', {
        choices: ['Small', 'Large'],
        required: true,
        ...(layout === 'conversational' ? { jumps: [{ when: SMALL, to: { step: 'role' } }] } : {}),
      }),
      q('detail', 'Tell us about the budget', 'long_text', { required: true }),
      q('role', 'Your role', 'short_text'),
    ],
    ...(layout === 'steps'
      ? {
          steps: [
            { id: 'money', title: 'Budget', startsAt: 'budget', jumps: [{ when: SMALL, to: { step: 'last' } }] },
            { id: 'more', title: 'Detail', startsAt: 'detail' },
            { id: 'last', title: 'You', startsAt: 'role' },
          ],
        }
      : {}),
  });
}

/** Presses the one way on in a step layout: Continue, OK, or (on the last) Send. */
async function goOn(visitor: Page): Promise<void> {
  await visitor
    .getByRole('button', { name: /^(Continue|OK)$/ })
    .first()
    .tap();
}

async function phoneBrowser(browser: Browser): Promise<Browser> {
  return process.env.FLOW_PHONE_BROWSER === 'webkit' ? webkit.launch() : browser;
}

test.describe('forms QA: the guest form on a phone', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Each check opens its own phone.');
  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    owner = await makeOwner(browser, testInfo, 'phone');
  });

  for (const layout of ['classic', 'steps', 'conversational'] as const) {
    test(`${layout} on a phone: filled end to end${layout === 'classic' ? '' : ', with a jump'}, then on to book`, async ({
      page,
      browser,
    }) => {
      test.setTimeout(240_000);
      await asOwner(page, owner);
      if (bookingPageId === undefined) {
        const booking = await rpc<{ id: string }>(page, 'bookingPages/create', {
          workspace: owner.slug,
          id: uuidv7(),
          title: `Phone intro ${randomUUID().slice(0, 6)}`,
          timeZone: 'UTC',
          mutationId: randomUUID(),
        });
        bookingPageId = booking.id;
      }
      const form = await liveForm(page, owner, `Phone ${layout} ${randomUUID().slice(0, 6)}`, documentFor(layout));
      const visitor = await visitorOn(await phoneBrowser(browser), form, PHONE);
      await expect(visitor.getByLabel(/Your name/)).toBeVisible({ timeout: 30_000 });
      await expectNoSidewaysScroll(visitor);

      await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
      if (layout === 'conversational') await goOn(visitor);
      await visitor.getByLabel(/Work email/).fill(`ada-phone-${layout}-${form.id.slice(-6)}@example.com`);
      if (layout === 'conversational') {
        await goOn(visitor);
        // Phone or WhatsApp is optional.
        await goOn(visitor);
      }
      if (layout === 'steps') await goOn(visitor);
      await expectNoSidewaysScroll(visitor);
      await visitor.getByText('Small', { exact: true }).tap();
      if (layout === 'classic') {
        // Classic has nowhere to jump from: the detail is asked, and answered.
        await visitor.getByLabel(/Tell us about the budget/).fill('Modest');
      } else {
        // A choice tapped in One at a time goes on by itself; Steps needs Continue.
        if (layout === 'steps') await goOn(visitor);
        await expect(visitor.getByLabel(/Your role/)).toBeVisible({ timeout: 15_000 });
        // The jump skipped the detail.
        await expect(visitor.getByLabel(/Tell us about the budget/)).toHaveCount(0);
      }
      await visitor.getByLabel(/Your role/).fill('Engineer');
      await expectNoSidewaysScroll(visitor);
      await visitor.waitForTimeout(HUMAN_PACE_MS);
      await visitor.getByRole('button', { name: 'Send', exact: true }).tap();
      // Sent, and on to pick a time on the booking page.
      await expect(visitor.getByRole('list', { name: /^Times on / }).first()).toBeVisible({ timeout: 45_000 });
      await expectNoSidewaysScroll(visitor);
      await visitor.context().close();
    });
  }

  test('reduced motion: a step change moves nothing, and focus lands on the new step’s first question', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await asOwner(page, owner);
    const form = await liveForm(page, owner, `Calm ${randomUUID().slice(0, 6)}`, (draft) => ({
      ...draft,
      layout: 'steps',
      questions: [...draft.questions, q('role', 'Your role', 'short_text')],
      steps: [{ id: 'you', title: 'You', startsAt: 'role' }],
    }));
    const visitor = await visitorOn(await phoneBrowser(browser), form, PHONE);
    await visitor.getByLabel(/Your name/).fill('Ada Lovelace');
    await visitor.getByLabel(/Work email/).fill(`ada-calm-${form.id.slice(-6)}@example.com`);
    const moving: string[] = [];
    await visitor.exposeFunction('reportMove', (what: string) => moving.push(what));
    await visitor.evaluate(() => {
      const report = (globalThis as unknown as { reportMove: (what: string) => void }).reportMove;
      new MutationObserver(() => {
        for (const animation of document.getAnimations()) {
          const frames = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
          if (frames.some((frame) => frame.transform !== undefined && frame.transform !== 'none')) {
            report(frames.map((frame) => String(frame.transform)).join(' → '));
          }
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await goOn(visitor);
    await expect(visitor.getByLabel(/Your role/)).toBeFocused({ timeout: 15_000 });
    expect(moving, 'something slid under reduced motion').toEqual([]);
    await visitor.context().close();
  });
});
