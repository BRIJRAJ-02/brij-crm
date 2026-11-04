// After they send in Chromium (T39, 5 November 2026): "Everyone sees [Thank you page]" with its words in place, one
// quiet "+ Send some people somewhere else" making a ready "If … → …" rule card on a choice question (never the
// consent or the name), its destination picked in the sentence, Delete under its ⋯ with Undo, Insert an answer in
// place of typing {{key}}, the score only once a question gives points, and the paused or deleted booking page said
// beside the choice (late trap #53). The word "ending" appears nowhere.
import type { BookingPageView, DataLayer, FormDocument } from '@crm/data';
import { createToasts, type Toasts } from '@crm/ui';
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
      id: 'agree',
      key: 'agree',
      label: 'I agree to get emails',
      answerType: 'consent',
      required: false,
      update: 'fill',
    },
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
/** Each thank-you message whose words took focus, in order: what the editor's preview then shows. */
let edited: ('default' | { readonly endingId: string })[] = [];
let ids = 0;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

function Section({ initial, toasts }: { readonly initial: FormDocument; readonly toasts: Toasts }) {
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
      toasts={toasts}
      newId={() => `r${String((ids += 1))}`}
      onDraftChange={setDraft}
      showGaps={false}
      onEditEnding={(which) => {
        edited.push(which);
      }}
    />
  );
}

async function show(initial: FormDocument, pages: readonly BookingPageView[] = [], permissions?: readonly string[]) {
  const pageList = readyList(pages);
  const toasts = createToasts();
  shown = await renderInApp(() => <Section initial={initial} toasts={toasts} />, {
    toasts,
    data: { bookingPages: { view: () => pageList } } as unknown as DataLayer,
    ...(permissions === undefined ? {} : { permissions }),
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
  });
}

describe('After they send (T39)', () => {
  it('says which thank-you message is being edited, so the preview shows it (T47)', async () => {
    edited = [];
    await show(DRAFT);
    await userEvent.click(page.getByRole('textbox', { name: 'Thank-you message' }));
    await expect.poll(() => edited).toEqual(['default']);
    await userEvent.click(page.getByRole('button', { name: 'Send some people somewhere else' }));
    await expect.poll(() => latest.endings?.length).toBe(1);
    await userEvent.click(page.getByRole('textbox', { name: 'Heading' }));
    await expect.poll(() => edited.at(-1)).toEqual({ endingId: 'ending_1' });
  });

  it('reads as one sentence, the thank you words edited under it, and never says ending', async () => {
    await show(DRAFT);
    await expect.element(page.getByRole('heading', { name: 'After they send' })).toBeVisible();
    await expect.element(page.getByText(/^Everyone sees/)).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /What everyone else sees/ }))
      .toHaveTextContent('Thank you page');
    const words = page.getByRole('textbox', { name: 'Thank-you message' });
    await expect.element(words).toHaveValue('Thanks, we will be in touch.');
    // No Score line while no question gives points, and no header actions.
    expect(page.getByText('Score', { exact: true }).query()).toBeNull();
    expect(document.body.textContent).not.toMatch(/ending/i);
  });

  it('adds a rule on the choice question, never the consent or the name, with a thank-you message', async () => {
    await show(DRAFT);
    await userEvent.click(page.getByRole('button', { name: 'Send some people somewhere else' }));
    await expect.poll(() => latest.routing.rules.length).toBe(1);
    expect(latest.routing.rules[0]?.when.rules[0]).toEqual({ key: 'budget', op: 'is', value: 'Under $1k' });
    expect(latest.routing.rules[0]?.then).toEqual({ kind: 'ending', endingId: 'ending_1' });
    // The picker it starts on is the rule's question, focused, and the value is a real choice.
    await expect.element(page.getByRole('button', { name: /Question, rule 1$/ })).toHaveFocus();
    await expect.element(page.getByRole('button', { name: /Value, rule 1$/ })).toHaveTextContent('Under $1k');
    await expect.element(page.getByText(/^Everyone else sees/)).toBeVisible();
    // Insert an answer: the words never ask for braces.
    const heading = page.getByRole('textbox', { name: 'Heading' });
    await userEvent.clear(heading);
    await userEvent.type(heading, 'Thanks');
    await userEvent.click(page.getByRole('button', { name: 'Insert an answer' }).first());
    await userEvent.click(page.getByRole('menuitem', { name: 'Your name' }));
    await expect.element(heading).toHaveValue('Thanks {{name}}');
    expect(document.body.textContent).not.toMatch(/ending/i);
  });

  it('sends people on to a booking page picked in the sentence, and deletes the rule with Undo', async () => {
    await show(DRAFT, [page_('live')]);
    await userEvent.click(page.getByRole('button', { name: 'Send some people somewhere else' }));
    await userEvent.click(page.getByRole('button', { name: /Where they go, rule 1$/ }));
    await userEvent.click(page.getByRole('option', { name: 'Booking page · Demo call' }));
    await expect.poll(() => latest.routing.rules[0]?.then).toEqual({ kind: 'book', bookingPageId: DEMO, message: '' });
    // The thank-you message it no longer needs goes with it.
    expect(latest.endings ?? []).toEqual([]);
    await userEvent.click(page.getByRole('button', { name: 'Rule 1 actions' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Delete' }));
    await expect.poll(() => latest.routing.rules.length).toBe(0);
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => latest.routing.rules.length).toBe(1);
  });

  it('says on the card when a rule can never match, and when an earlier rule wins (T41)', async () => {
    const when = (value: string) => ({ join: 'all' as const, rules: [{ key: 'budget', op: 'is' as const, value }] });
    await show({
      ...DRAFT,
      routing: {
        rules: [
          { id: 'a', when: when('Under $1k'), then: { kind: 'redirect', url: 'https://a.example' } },
          { id: 'b', when: when('Under $1k'), then: { kind: 'redirect', url: 'https://b.example' } },
          { id: 'c', when: when('Over $1m'), then: { kind: 'redirect', url: 'https://c.example' } },
        ],
      },
    });
    await expect.element(page.getByText(/Rule 1 catches these people first/)).toBeVisible();
    await expect.element(page.getByText(/This can never match/)).toBeVisible();
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
    await expect.element(page.getByText('Demo call is paused')).toBeVisible();
    await expect.element(page.getByText(/Its last host left the workspace/)).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Open page' }))
      .toHaveAttribute('href', `/w/acme/captures/links/${DEMO}`);
  });

  it('says a deleted page is gone to a reader who sees every page', async () => {
    await show(sending, [], ['forms.manage', 'booking.admin']);
    await expect.element(page.getByText('Its booking page was deleted')).toBeVisible();
  });
});
