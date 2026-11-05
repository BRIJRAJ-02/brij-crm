import '@crm/ui/styles.css';
// Captures › Forms in Chromium (5 November 2026, the owner, pointing at the booking page cards: "make something like
// this for forms as well"): each card draws an abstract form in its colour across its top (its name and count, its
// questions as shapes), says its state as a dot and a word with its submissions as a quiet link (New when one came
// since), and ends with its address, a quiet Copy, Open and ⋯ as a booking card does. A draft says when it changed
// and offers Edit. The picture never takes focus or a reader's attention.
import type { CaptureListState, CaptureListView, DataLayer, FormSummary } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { FormsScreen } from './FormsScreen.tsx';

const NOW = Date.now();

/** A form as the list holds it, with its picture: its first questions' types. */
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
      questions: [{ answerType: 'short_text' }, { answerType: 'choice', choiceCount: 3 }, { answerType: 'rating' }],
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
  it('draws each form as shapes, hidden from readers, with its state as a dot and a word', async () => {
    await renderForms([formOf('f1', 'Contact us'), formOf('f2', 'Feedback', { status: 'paused' })]);
    const contact = page.getByRole('article', { name: 'Contact us' });
    await expect.element(contact.getByText('Live')).toBeVisible();
    await expect.element(page.getByRole('article', { name: 'Feedback' }).getByText('Paused')).toBeVisible();
    // The picture is the form's name and count over its questions as shapes: no question's words, inert and hidden.
    const stage = contact.element().querySelector('[aria-hidden="true"][inert]');
    expect(stage?.textContent).toBe('Contact us3 questions');
    expect(stage?.querySelectorAll('[data-kind]')).toHaveLength(2);
    expect(stage?.querySelector('[data-kind="choices"]')?.children[1]?.children).toHaveLength(3);
    expect(contact.getByRole('textbox').query()).toBeNull();
  });

  it('puts the submissions on the meta line, and the address, Copy, Open and ⋯ in the foot', async () => {
    await renderForms([formOf('f1', 'Contact us', { lastSubmissionAt: new Date(NOW - 600_000).toISOString() })]);
    const contact = page.getByRole('article', { name: 'Contact us' });
    const count = contact.getByRole('link', { name: '12 submissions to Contact us' });
    await expect.element(count).toBeVisible();
    expect(count.element().getAttribute('href')).toContain('tab=submissions');
    // Never opened, so a submission from this week is new to this reader.
    await expect.element(contact.getByText('New', { exact: true })).toBeVisible();
    // The address as a path, as a booking card shows /ada-lovelace/intro-call.
    await expect.element(contact.getByText('/f/key-f1', { exact: true })).toBeVisible();
    // Copy link and Open are icons, named, with no words beside them; Pause waits in ⋯.
    const copy = contact.getByRole('button', { name: 'Copy link' });
    await expect.element(copy).toBeVisible();
    expect(copy.element().textContent.trim()).toBe('');
    await expect.element(contact.getByRole('button', { name: 'Open Contact us in a new tab' })).toBeVisible();
    await expect.element(contact.getByRole('button', { name: 'More for Contact us' })).toBeVisible();
    // No switch: pausing from a card asks first, in ⋯ (4 November 2026).
    expect(contact.getByRole('switch').query()).toBeNull();
  });

  it('opens nothing from a paused card', async () => {
    await renderForms([formOf('f2', 'Feedback', { status: 'paused' })]);
    const paused = page.getByRole('article', { name: 'Feedback' });
    await expect.element(paused.getByText('/f/key-f2', { exact: true })).toBeVisible();
    expect(paused.getByRole('button', { name: 'Open Feedback in a new tab' }).query()).toBeNull();
  });

  it("offers a draft's Edit in its foot, says when it changed, and has no address to copy", async () => {
    await renderForms([formOf('f3', 'Untitled form', { liveVersionNumber: undefined, status: 'draft' })]);
    const draft = page.getByRole('article', { name: 'Untitled form' });
    await expect.element(draft.getByText('Draft')).toBeVisible();
    await expect.element(draft.getByText(/^edited /)).toBeVisible();
    await expect.element(draft.getByRole('link', { name: 'Edit Untitled form' })).toBeVisible();
    expect(draft.getByRole('button', { name: 'Copy link' }).query()).toBeNull();
    expect(draft.getByText(/^\/f\//).query()).toBeNull();
    expect(draft.getByRole('link', { name: /submissions/ }).query()).toBeNull();
  });

  it('lists the form changed last first, with no sort control (the owner, 5 November 2026)', async () => {
    await renderForms([
      formOf('f1', 'Older', { updatedAt: new Date(NOW - 86_400_000).toISOString() }),
      formOf('f2', 'Newer', { updatedAt: new Date(NOW - 60_000).toISOString() }),
    ]);
    await expect.element(page.getByRole('article', { name: 'Newer' })).toBeVisible();
    // The cards' own headings (each picture's form headline is hidden, so not among them).
    const titles = page
      .getByRole('heading', { level: 2 })
      .elements()
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Newer', 'Older']);
    expect(page.getByRole('button', { name: /Updated|Sort/ }).query()).toBeNull();
  });
});
