import '@crm/ui/styles.css';
// Captures › Forms in Chromium (5 November 2026, the owner: "make these cards look much prettier"): each card draws
// its own form small across its top, says its state as a dot and a word, and keeps one control of its own in the
// foot: a live form's submissions as their count (with New when one came since), a draft's Edit. Copy link is a quiet
// icon, and the picture never takes focus or a reader's attention.
import type { CaptureListState, CaptureListView, DataLayer, FormSummary } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { FormsScreen } from './FormsScreen.tsx';

const NOW = Date.now();

/** A form as the list holds it, with its picture: the draft's headline and first questions. */
function formOf(id: string, name: string, extra: Partial<FormSummary> = {}): FormSummary {
  return {
    id,
    name,
    status: 'live',
    publicKey: `key-${id}`,
    liveVersionNumber: 1,
    submissionsThisMonth: 0,
    spamCount: 0,
    submissionCount: 12,
    questionCount: 3,
    picture: {
      headline: name,
      buttonText: 'Send',
      colour: 'light',
      corners: 'rounded',
      questions: [
        { id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
        { id: 'q2', key: 'email', label: 'Work email', answerType: 'email', required: true },
      ],
    },
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
    ...extra,
  };
}

/** The held list, never changing. */
function listOf(forms: readonly FormSummary[]): CaptureListView<FormSummary> {
  const snapshot: CaptureListState<FormSummary> = { status: 'ready', items: forms, pendingIds: new Set() };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function renderForms(forms: readonly FormSummary[], permissions: readonly string[] = ['forms.manage']) {
  const view = listOf(forms);
  const data = {
    forms: { view: () => view, hostedUrl: (key: string) => `https://forms.example.com/f/${key}` },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <main>
        <h1 tabIndex={-1}>Captures</h1>
        <FormsScreen slug="acme" />
      </main>
    ),
    { data, pattern: '/w/$slug/captures/forms', at: '/w/acme/captures/forms', permissions },
  );
}

describe('the forms list (5 November 2026)', () => {
  it('draws each form small, hidden from readers, with its state as a dot and a word', async () => {
    await renderForms([formOf('f1', 'Contact us'), formOf('f2', 'Feedback', { status: 'paused' })]);
    const contact = page.getByRole('article', { name: 'Contact us' });
    await expect.element(contact.getByText('Live')).toBeVisible();
    await expect.element(page.getByRole('article', { name: 'Feedback' }).getByText('Paused')).toBeVisible();
    // The picture is the form's own first questions, drawn by the hosted page's component, inert and hidden.
    const stage = contact.element().querySelector('[aria-hidden="true"][inert]');
    expect(stage?.textContent).toContain('Work email');
    expect(contact.getByRole('textbox').query()).toBeNull();
    // The old meta line's question count is gone: the picture says what it asks.
    expect(contact.getByText(/questions/).query()).toBeNull();
  });

  it('keeps one control of its own in the foot: the submissions as their count, with New, and a quiet Copy link', async () => {
    await renderForms([formOf('f1', 'Contact us', { lastSubmissionAt: new Date(NOW - 600_000).toISOString() })]);
    const contact = page.getByRole('article', { name: 'Contact us' });
    const count = contact.getByRole('link', { name: '12 submissions to Contact us' });
    await expect.element(count).toBeVisible();
    expect(count.element().getAttribute('href')).toContain('tab=submissions');
    // Never opened, so a submission from this week is new to this reader.
    await expect.element(contact.getByText('New', { exact: true })).toBeVisible();
    // Copy link is an icon, named, with no words beside it.
    const copy = contact.getByRole('button', { name: 'Copy link' });
    await expect.element(copy).toBeVisible();
    expect(copy.element().textContent.trim()).toBe('');
  });

  it("offers a draft's Edit in its foot, with nothing to copy", async () => {
    await renderForms([formOf('f3', 'Untitled form', { liveVersionNumber: undefined, status: 'draft' })]);
    const draft = page.getByRole('article', { name: 'Untitled form' });
    await expect.element(draft.getByText('Draft')).toBeVisible();
    await expect.element(draft.getByRole('link', { name: 'Edit Untitled form' })).toBeVisible();
    expect(draft.getByRole('button', { name: 'Copy link' }).query()).toBeNull();
  });
});
