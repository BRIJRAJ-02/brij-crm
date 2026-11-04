// After they send in Chromium (T20, 5 November 2026): the thank you page by default, + Another ending with a ready
// "depending on answers" rule, Send to a booking page or link, Insert an answer in place of typing {{key}}, the score
// only once a question gives points, and the paused or deleted booking page said beside the choice (late trap #53).
import type { BookingPageView, DataLayer, FormDocument } from '@crm/data';
import { createToasts } from '@crm/ui';
import { useEffect, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { AfterSendSection } from './AfterSendSection.tsx';

const DEMO = '0199f0a0-0000-7000-8000-0000000000d1';
const SCORE = '0199f0a0-0000-7000-8000-0000000000e9';

const DRAFT: FormDocument = {
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true, update: 'fill' },
    {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      required: true,
      update: 'fill',
      choices: ['Under $1k', '$5k'],
    },
  ],
  targets: {},
  layout: 'classic',
  steps: [],
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  after: { kind: 'message', message: 'Thanks, we will be in touch.' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

/** A list view holding `items`, ready, the same snapshot each read as a store's must be. */
function readyList<Item>(items: readonly Item[]) {
  const state = { status: 'ready' as const, items, pendingIds: new Set<string>() };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

const page_ = (status: 'live' | 'paused'): BookingPageView =>
  ({
    id: DEMO,
    title: 'Demo call',
    status,
    durations: [30],
    canChange: true,
    ...(status === 'paused' ? { pausedReason: 'host_removed' } : {}),
  }) as unknown as BookingPageView;

let shown: InApp | undefined;
let latest: FormDocument = DRAFT;
let ids = 0;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

function Section({ initial }: { readonly initial: FormDocument }) {
  const [draft, setDraft] = useState(initial);
  // What the section last changed the draft to, for the checks below.
  useEffect(() => {
    latest = draft;
  }, [draft]);
  return (
    <AfterSendSection
      slug="acme"
      draft={draft}
      target={{ items: [{ attributeId: SCORE, title: 'Lead score', type: 'number', canWrite: true }] } as never}
      isReadOnly={false}
      toasts={createToasts()}
      newId={() => `r${String((ids += 1))}`}
      onDraftChange={setDraft}
      showGaps={false}
    />
  );
}

async function show(initial: FormDocument, pages: readonly BookingPageView[] = [], permissions?: readonly string[]) {
  const pageList = readyList(pages);
  shown = await renderInApp(() => <Section initial={initial} />, {
    data: { bookingPages: { view: () => pageList } } as unknown as DataLayer,
    ...(permissions === undefined ? {} : { permissions }),
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
  });
}

describe('After they send (T20)', () => {
  it('opens with the thank you page, its words edited in place', async () => {
    await show(DRAFT);
    await expect.element(page.getByRole('heading', { name: 'After they send' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /^Thank you page/ }));
    const words = page.getByRole('textbox', { name: 'Thank you message' });
    await expect.element(words).toHaveValue('Thanks, we will be in touch.');
    // No Score line while no question gives points.
    expect(page.getByText('Score', { exact: true }).query()).toBeNull();
  });

  it('adds another ending in one click, with a ready rule that depends on an answer, and inserts an answer', async () => {
    await show(DRAFT);
    await userEvent.click(page.getByRole('button', { name: 'Another ending' }));
    const heading = page.getByRole('textbox', { name: 'Heading' });
    await expect.element(heading).toHaveFocus();
    await userEvent.type(heading, 'Thanks');
    // Insert an answer: the words never ask for braces.
    await userEvent.click(page.getByRole('button', { name: 'Insert an answer' }).first());
    await userEvent.click(page.getByRole('menuitem', { name: 'Your name' }));
    await expect.element(heading).toHaveValue('Thanks {{name}}');
    await expect.element(page.getByText('Depending on answers')).toBeVisible();
    // The rule is complete the moment it appears, and its row says it.
    await expect.poll(() => latest.routing.rules.length).toBe(1);
    expect(latest.routing.rules[0]?.then).toEqual({ kind: 'ending', endingId: 'ending_1' });
    await expect.element(page.getByText(/^When Budget is/)).toBeVisible();
  });

  it('sends people on to a booking page by their answers, and removes the rule with Undo', async () => {
    await show(DRAFT, [page_('live')]);
    await userEvent.click(page.getByRole('button', { name: 'Send to a booking page or link' }));
    await expect.element(page.getByRole('button', { name: /^Booking page · Demo call/ })).toBeVisible();
    expect(latest.routing.rules[0]?.then).toEqual({ kind: 'book', bookingPageId: DEMO, message: '' });
    await userEvent.click(page.getByRole('button', { name: 'Remove' }));
    await expect.poll(() => latest.routing.rules.length).toBe(0);
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => latest.routing.rules.length).toBe(1);
  });

  it('shows the score line once a question gives points, with where to save it', async () => {
    await show({
      ...DRAFT,
      questions: DRAFT.questions.map((question) =>
        question.id === 'budget' ? { ...question, points: [1, 2] } : question,
      ),
    });
    await expect.element(page.getByText('Score', { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /Save the score to$/ }));
    await userEvent.click(page.getByRole('option', { name: 'Lead score' }));
    await expect.poll(() => latest.scoreFiledOn?.attributeId).toBe(SCORE);
  });
});

describe('a form that sends everyone on to a booking page (late trap #53)', () => {
  const sending: FormDocument = {
    ...DRAFT,
    after: { kind: 'booking', bookingPageId: DEMO, countdownSeconds: 5, message: 'Thanks' },
  };

  it('says when the page is paused, why, and offers the way to it', async () => {
    await show(sending, [page_('paused')]);
    await userEvent.click(page.getByRole('button', { name: /^Booking page/ }).first());
    await expect.element(page.getByText('Demo call is paused')).toBeVisible();
    await expect.element(page.getByText(/Its last host left the workspace/)).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Open page' }))
      .toHaveAttribute('href', `/w/acme/captures/links/${DEMO}`);
  });

  it('says a deleted page is gone to a reader who sees every page', async () => {
    await show(sending, [], ['forms.manage', 'booking.admin']);
    await userEvent.click(page.getByRole('button', { name: /^Booking page/ }).first());
    await expect.element(page.getByText('Its booking page was deleted')).toBeVisible();
  });
});
