// A form's Analytics tab in Chromium (T45, 5 November 2026): one row of five figure cards, where people stop as a
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

const NONE = { views: 0, starts: 0, completions: 0 };

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
      totals: { views: 12, starts: 8, completions: 5, medianMs: 64_000 },
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
    });
    const figures = page.getByRole('group', { name: 'This period' });
    await expect.element(figures).toBeVisible();
    expect(
      figures
        .getByRole('term')
        .all()
        .map((term) => term.element().textContent),
    ).toEqual(['Views', 'Starts', 'Finished', 'Completion', 'Median time']);
    await expect.element(figures.getByText('63%')).toBeVisible();
    await expect
      .element(page.getByText('Most people stop at “What budget do you have in mind?”: 2 of the 7 who got there.'))
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
      totals: { views: 2, starts: 2, completions: 1 },
      previous: NONE,
      byDay: [{ day: '2026-11-04', views: 2, starts: 2, completions: 1 }],
      byQuestion: [
        { questionId: 'name', reached: 2, answered: 1, leftHere: 1 },
        { questionId: 'budget', reached: 1, answered: 1, leftHere: 0 },
        { questionId: 'when', reached: 1, answered: 1, leftHere: 0 },
      ],
      bySource: [{ source: 'direct', views: 2, completions: 1 }],
    });
    await expect.element(page.getByText('Most people stop at “Your name”: 1 of the 2 who got there.')).toBeVisible();
    expect(document.querySelectorAll('[role="meter"]')).toHaveLength(0);
    expect(page.getByRole('img').query()).toBeNull();
  });

  it('offers the Share tab when nobody has opened the form yet', async () => {
    await draw({
      range: 30,
      totals: { views: 0, starts: 0, completions: 0 },
      previous: NONE,
      byDay: [],
      byQuestion: [],
      bySource: [],
    });
    await expect.element(page.getByText('No visits yet')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Share the form' })).toBeVisible();
  });
});
