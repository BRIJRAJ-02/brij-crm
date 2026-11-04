// The form template gallery in Chromium (spec 0063, AC-6323): the templates New
// form opens, each with its one line purpose, Blank first and picked as it
// opens with focus on it; picking one shows the form it makes beside the list;
// Use makes a draft and hands it back; the tiles turn off while it is being
// made, so a second Use can't make a second form; and a read that failed says
// so with a way to try again.
import type { DataLayer, FormTemplateSummary, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@crm/ui/styles.css';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { TemplateGallery } from './TemplateGallery.tsx';

const TEMPLATES: readonly FormTemplateSummary[] = [
  {
    id: 'blank',
    name: 'Blank form',
    purpose: 'Start from an empty page.',
    preview: { layout: 'classic', rows: [] },
    sample: { headline: 'Fill this in', buttonText: 'Send', questions: [] },
  },
  {
    id: 'feedback',
    name: 'Feedback',
    purpose: 'A rating, and why. Anonymous.',
    preview: { layout: 'classic', rows: ['rating', 'long'] },
    sample: {
      headline: 'How did we do?',
      buttonText: 'Send feedback',
      questions: [{ id: 'rating', key: 'rating', label: 'How was it?', answerType: 'rating', required: true }],
    },
    keepsSubmissionsOnly: true,
  },
  {
    id: 'booking_intake',
    name: 'Booking intake',
    purpose: 'A few questions, then your calendar.',
    preview: { layout: 'classic', rows: ['field', 'field', 'long'] },
    sample: {
      headline: 'Before we meet',
      buttonText: 'Next',
      questions: [{ id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', required: true }],
    },
  },
  {
    id: 'customer_onboarding',
    name: 'Customer onboarding',
    purpose: 'Everything you need from a new customer, asked a step at a time.',
    preview: { layout: 'steps', rows: ['field', 'field', 'date'] },
    sample: {
      headline: 'Welcome aboard',
      buttonText: 'Finish',
      questions: [{ id: 'start', key: 'start', label: 'When do you start?', answerType: 'date', required: true }],
    },
  },
];

const MADE = { id: '0199f0a0-0000-7000-8000-0000000000f1', name: 'Feedback' } as unknown as FormView;

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** Opens the gallery over a fake data layer, and collects what it asked for and what it handed back. */
async function open(
  options: {
    readonly templates?: () => Promise<readonly FormTemplateSummary[]>;
    readonly create?: () => Promise<FormView>;
  } = {},
) {
  const asked: { readonly templateId: string }[] = [];
  const made: FormView[] = [];
  let closed = 0;
  const data = {
    forms: {
      templates: options.templates ?? (() => Promise.resolve(TEMPLATES)),
      newId: () => '0199f0a0-0000-7000-8000-00000000000a',
      createFromTemplate: (_workspace: string, form: { readonly templateId: string }) => {
        asked.push({ templateId: form.templateId });
        return (options.create ?? (() => Promise.resolve(MADE)))();
      },
    },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <TemplateGallery
        data={data}
        slug="acme"
        isOpen
        onClose={() => {
          closed += 1;
        }}
        onCreated={(form) => {
          made.push(form);
        }}
      />
    ),
    { data, pattern: '/w/$slug/captures/forms', at: '/w/acme/captures/forms' },
  );
  return { asked, made, closedCount: () => closed };
}

describe('the gallery (AC-6323)', () => {
  it('lists each template with its name and its one line purpose, Blank first, picked and focused', async () => {
    await open();
    const blank = page.getByRole('radio', { name: 'Blank form' });
    await expect.element(blank).toBeVisible();
    // Blank is picked as it opens, and focus is on it, so the arrows browse at once.
    await expect.element(blank).toBeChecked();
    await expect.poll(() => document.activeElement === blank.element()).toBe(true);
    // The purpose is on the tile, read as the tile's description and visible as text: not hidden in a tooltip.
    await expect
      .element(page.getByRole('radio', { name: 'Feedback' }))
      .toHaveAccessibleDescription('A rating, and why. Anonymous.');
    await expect.element(page.getByText('Start from an empty page.')).toBeVisible();
    // Blank form on its own, then the rest under a Templates line, each a simple tile: no pictures (5 November 2026).
    const groups = document.querySelectorAll('[role="radiogroup"]');
    expect(groups.length).toBe(2);
    expect(groups[0]?.querySelectorAll('[data-tile]').length).toBe(1);
    expect(document.querySelectorAll('[role="radiogroup"] [data-tile]').length).toBe(TEMPLATES.length);
    expect(document.querySelectorAll('[role="radiogroup"] [data-tile][data-tall]').length).toBe(0);
    expect(document.querySelectorAll('[role="radiogroup"] [data-tile][data-described]').length).toBe(TEMPLATES.length);
    await expect.element(page.getByRole('button', { name: 'Use Blank form' })).toBeVisible();
  });

  it('puts Blank form first on its own, then the templates under a Templates line, with no pictures', async () => {
    await open();
    await expect.element(page.getByRole('radiogroup', { name: 'Templates' })).toBeVisible();
    await expect.element(page.getByText('Templates', { exact: true })).toBeVisible();
    // No form is drawn on a tile: Blank's own empty form and the samples' words are gone.
    expect(document.body.textContent).not.toContain('How did we do?');
    await userEvent.click(page.getByRole('radio', { name: 'Feedback' }).element());
    await expect.element(page.getByRole('button', { name: 'Use Feedback' })).toBeVisible();
  });

  it('makes a draft from the picked template on Use and hands it back', async () => {
    const run = await open();
    await userEvent.click(page.getByRole('radio', { name: 'Feedback' }).element());
    // Picking alone makes nothing.
    expect(run.asked).toEqual([]);
    await userEvent.click(page.getByRole('button', { name: 'Use Feedback' }).element());
    await expect.poll(() => run.made.map((form) => form.id)).toEqual([MADE.id]);
    expect(run.asked).toEqual([{ templateId: 'feedback' }]);
  });

  it('uses a template on Enter, as Use does (forms fixes 3)', async () => {
    const run = await open();
    await userEvent.click(page.getByRole('radio', { name: 'Feedback' }).element());
    await expect.element(page.getByRole('radio', { name: 'Feedback' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => run.asked).toEqual([{ templateId: 'feedback' }]);
  });

  it('uses a template on a double click (forms fixes 3)', async () => {
    const run = await open();
    await userEvent.dblClick(page.getByText('A rating, and why. Anonymous.'));
    await expect.poll(() => run.asked).toEqual([{ templateId: 'feedback' }]);
  });

  it('turns the other tiles off while it is making one, so a second Use makes no second form', async () => {
    let settle: ((form: FormView) => void) | undefined;
    const run = await open({
      create: () =>
        new Promise<FormView>((resolve) => {
          settle = resolve;
        }),
    });
    await userEvent.click(page.getByRole('radio', { name: 'Feedback' }).element());
    await userEvent.click(page.getByRole('button', { name: 'Use Feedback' }).element());
    // The status names the template, so the person knows which one is being made, and it is announced politely.
    await expect.element(page.getByText('Making your Feedback…')).toBeVisible();
    await expect.element(page.getByRole('radio', { name: 'Feedback' })).toBeEnabled();
    await expect.element(page.getByRole('radio', { name: 'Blank form' })).toBeDisabled();
    settle?.(MADE);
    await expect.poll(() => run.made.length).toBe(1);
    expect(run.asked).toEqual([{ templateId: 'feedback' }]);
  });

  it('says so when the templates do not load, and reads them again on Try again', async () => {
    let attempts = 0;
    await open({
      templates: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('Offline')) : Promise.resolve(TEMPLATES);
      },
    });
    await expect.element(page.getByText('The templates didn’t load')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Try again' }).element());
    await expect.element(page.getByRole('radio', { name: 'Feedback' })).toBeVisible();
    expect(attempts).toBe(2);
  });

  it('still makes a blank form when the templates never loaded', async () => {
    const run = await open({ templates: () => Promise.reject(new Error('Offline')) });
    await expect.element(page.getByText('The templates didn’t load')).toBeVisible();
    // A flaky read must not leave somebody unable to make a form: a blank one needs nothing from the catalog.
    await userEvent.click(page.getByRole('button', { name: 'Make a blank form' }).element());
    await expect.poll(() => run.asked).toEqual([{ templateId: 'blank' }]);
    await expect.poll(() => run.made.length).toBe(1);
  });

  it('offers the same way out when there are no templates at all', async () => {
    const run = await open({ templates: () => Promise.resolve([]) });
    await expect.element(page.getByText('No templates')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Make a blank form' }).element());
    await expect.poll(() => run.asked).toEqual([{ templateId: 'blank' }]);
  });

  it('lets Cancel out of a create that never settles', async () => {
    // A request that hangs must not be a modal only a page reload escapes.
    const run = await open({ create: () => new Promise<FormView>(() => undefined) });
    await userEvent.click(page.getByRole('button', { name: 'Use Blank form' }).element());
    await expect.element(page.getByText('Making your Blank form…')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }).element());
    expect(run.closedCount()).toBe(1);
  });

  it('closes on Cancel without making anything', async () => {
    const run = await open();
    await expect.element(page.getByRole('radio', { name: 'Feedback' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }).element());
    expect(run.closedCount()).toBe(1);
    expect(run.asked).toEqual([]);
  });

  it('draws Blank form and the templates as simple tiles, on a phone too, in both themes', async () => {
    for (const width of [1280, 390] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await page.viewport(width, width === 390 ? 844 : 900);
        document.documentElement.dataset.theme = theme;
        await open();
        await userEvent.click(page.getByRole('radio', { name: 'Feedback' }).element());
        await expect.element(page.getByRole('button', { name: 'Use Feedback' })).toBeVisible();
        await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
        await page.screenshot({ path: `.vitest/shots/gallery-${String(width)}-${theme}.png` });
        shown?.unmount();
        shown = undefined;
      }
    }
    delete document.documentElement.dataset.theme;
    await page.viewport(1280, 900);
  });
});
