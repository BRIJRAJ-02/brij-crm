// A form's Analytics tab in Chromium (T45, 5 November 2026; lane 3c): one row of four figure cards, Answers by question, where people stop as a
// list named by the questions themselves with the worst stop in one sentence, bars only from five starts, sources as
// a short table, and an empty form offering its Share tab. The question ids are a real form's ("name"), which once
// collided with a column's key and looped.
import '@crm/ui/styles.css';
import type { DataLayer, FormAnalytics, FormAnalyticsHeld, FormDocument, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { AnalyticsTab } from './AnalyticsTab.tsx';

const DOCUMENT = {
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true, update: 'fill' },
    { id: 'budget', key: 'budget', label: 'What budget do you have in mind?', answerType: 'choice', required: true },
    { id: 'when', key: 'when', label: 'When would you like to start?', answerType: 'choice', required: true },
  ],
} as unknown as FormDocument;

const FORM = {
  id: '0199f0a0-0000-7000-8000-0000000000f1',
  name: 'Lead qualification',
  publicKey: 'lead',
  status: 'live',
  draft: DOCUMENT,
  live: DOCUMENT,
} as unknown as FormView;

const NONE = { views: 0, starts: 0, completions: 0, submissions: 0 };

/** A held read that is ready at once with `analytics`. */
function held(analytics: FormAnalytics): FormAnalyticsHeld {
  const state = { status: 'ready' as const, analytics };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    reload: () => undefined,
  };
}

function dataWith(analytics: FormAnalytics): DataLayer {
  const read = held(analytics);
  return { forms: { analytics: () => read } } as unknown as DataLayer;
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function draw(analytics: FormAnalytics) {
  const data = dataWith(analytics);
  shown = await renderInApp(() => <AnalyticsTab data={data} slug="acme" form={FORM} />, {
    data,
    pattern: '/w/$slug/captures/forms/$formId',
    at: '/w/acme/captures/forms/form-1',
  });
}

describe('the Analytics tab (T45)', () => {
  it('shows five figure cards, the stops by question name with the worst in a sentence, and the sources', async () => {
    await draw({
      range: 30,
      totals: { views: 12, starts: 8, completions: 5, medianMs: 64_000, submissions: 5 },
      previous: NONE,
      byDay: [
        { day: '2026-11-03', views: 5, starts: 3, completions: 2 },
        { day: '2026-11-04', views: 7, starts: 5, completions: 3 },
      ],
      byQuestion: [
        { questionId: 'name', reached: 8, answered: 7, leftHere: 1 },
        { questionId: 'budget', reached: 7, answered: 5, leftHere: 2 },
        { questionId: 'when', reached: 5, answered: 5, leftHere: 0 },
      ],
      bySource: [
        { source: 'direct', views: 7, completions: 2 },
        { source: 'utm:instagram', views: 5, completions: 3 },
      ],
      answers: [],
    });
    const figures = page.getByRole('group', { name: 'This period' });
    await expect.element(figures).toBeVisible();
    expect(
      figures
        .getByRole('term')
        .all()
        .map((term) => term.element().textContent),
    ).toEqual(['Views', 'Submissions', 'Completion', 'Median time']);
    await expect.element(figures.getByText('8 started')).toBeVisible();
    await expect.element(figures.getByText('63%')).toBeVisible();
    await expect
      .element(page.getByText('Biggest drop: “What budget do you have in mind?”, 2 of the 7 who got there.'))
      .toBeVisible();
    // The questions by name, never Q1 to Q3, and a bar per question from five starts.
    const stops = page
      .getByRole('grid', { name: 'How far people got' })
      .or(page.getByRole('table', { name: 'How far people got' }));
    await expect.element(stops.getByRole('rowheader', { name: 'Your name' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\bQ[1-3]\b/);
    expect(stops.getByRole('meter').all()).toHaveLength(3);
    await expect.element(page.getByRole('rowheader', { name: 'instagram' })).toBeVisible();
  });

  it('keeps a handful of starts as numbers, with no bars and no chart', async () => {
    await draw({
      range: 30,
      totals: { views: 2, starts: 2, completions: 1, submissions: 1 },
      previous: NONE,
      byDay: [{ day: '2026-11-04', views: 2, starts: 2, completions: 1 }],
      byQuestion: [
        { questionId: 'name', reached: 2, answered: 1, leftHere: 1 },
        { questionId: 'budget', reached: 1, answered: 1, leftHere: 0 },
        { questionId: 'when', reached: 1, answered: 1, leftHere: 0 },
      ],
      bySource: [{ source: 'direct', views: 2, completions: 1 }],
      answers: [],
    });
    await expect.element(page.getByText('Biggest drop: “Your name”, 1 of the 2 who got there.')).toBeVisible();
    expect(document.querySelectorAll('[role="meter"]')).toHaveLength(0);
    expect(page.getByRole('img').query()).toBeNull();
  });

  it('offers the Share tab when nobody has opened the form yet', async () => {
    await draw({
      range: 30,
      totals: NONE,
      previous: NONE,
      byDay: [],
      byQuestion: [],
      bySource: [],
      answers: [],
    });
    await expect.element(page.getByText('No visits yet')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Share the form' })).toBeVisible();
  });

  it('counts stored submissions, and says when visits began, never a 0% beside them (lane 3c)', async () => {
    await draw({
      range: 30,
      totals: { views: 1, starts: 0, completions: 0, submissions: 4 },
      previous: NONE,
      byDay: [{ day: '2026-11-04', views: 1, starts: 0, completions: 0 }],
      byQuestion: [],
      bySource: [{ source: 'direct', views: 1, completions: 0 }],
      answers: [],
      countingSince: '2026-11-04',
    });
    const figures = page.getByRole('group', { name: 'This period' });
    await expect.element(figures.getByText('4', { exact: true })).toBeVisible();
    await expect.element(figures.getByText(/Counted since/)).toBeVisible();
    expect(figures.getByText('0%').query()).toBeNull();
  });

  it('draws a card per question: bars with share and count for a choice, the latest words for text', async () => {
    await draw({
      range: 30,
      totals: { views: 6, starts: 4, completions: 3, submissions: 3 },
      previous: NONE,
      byDay: [{ day: '2026-11-04', views: 6, starts: 4, completions: 3 }],
      byQuestion: [],
      bySource: [{ source: 'direct', views: 6, completions: 3 }],
      answers: [
        { questionId: 'name', responses: 3, latest: ['Ada', 'Grace', 'Edsger'] },
        {
          questionId: 'budget',
          responses: 3,
          choices: [
            { value: 'Under $1k', count: 2 },
            { value: '$5k+', count: 1 },
          ],
        },
        { questionId: 'when', responses: 0, choices: [] },
      ],
    });
    await expect.element(page.getByRole('heading', { name: 'Answers' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: '1. Your name' })).toBeVisible();
    await expect.element(page.getByText('Edsger')).toBeVisible();
    const budget = page
      .getByRole('grid', { name: 'Answers to What budget do you have in mind?' })
      .or(page.getByRole('table', { name: 'Answers to What budget do you have in mind?' }));
    await expect.element(budget.getByRole('rowheader', { name: 'Under $1k' })).toBeVisible();
    await expect.element(budget.getByText('67%')).toBeVisible();
    await expect.element(page.getByText('Nobody answered this yet')).toBeVisible();
  });
});
