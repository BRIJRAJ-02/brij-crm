// The form template gallery in Chromium (spec 0063, AC-6323): the tiles New
// form opens, each with a preview and a one line purpose, Blank first; one
// press makes a draft and hands it back; the tiles turn off while it is being
// made, so a second press can't make a second form; and a read that failed
// says so with a way to try again.
import type { DataLayer, FormTemplateSummary, FormView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { TemplateGallery } from './TemplateGallery.tsx';

const TEMPLATES: readonly FormTemplateSummary[] = [
  {
    id: 'blank',
    name: 'Blank form',
    purpose: 'Name, email and phone, to change as you like.',
    preview: { layout: 'classic', rows: ['field', 'field', 'field'] },
  },
  {
    id: 'feedback',
    name: 'Feedback',
    purpose: 'A rating and one open question, so you hear why as well as how much.',
    preview: { layout: 'classic', rows: ['field', 'rating', 'long'] },
  },
  {
    id: 'customer_onboarding',
    name: 'Customer onboarding',
    purpose: 'Everything you need from a new customer, asked a step at a time.',
    preview: { layout: 'steps', rows: ['field', 'field', 'date'] },
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
  it('shows each template as a tile with its name and its one line purpose, Blank first', async () => {
    await open();
    await expect.element(page.getByRole('button', { name: 'Blank form' })).toBeVisible();
    // The purpose is on the tile, read as the tile's description and visible as text: not hidden in a tooltip.
    await expect
      .element(page.getByRole('button', { name: 'Feedback' }))
      .toHaveAccessibleDescription('A rating and one open question, so you hear why as well as how much.');
    await expect.element(page.getByText('Name, email and phone, to change as you like.')).toBeVisible();
    // The tiles are in the template order, Blank first (AC-6323), inside the one group the gallery draws.
    const group = document.querySelector('[role="group"]');
    const names = [...(group?.querySelectorAll('[data-tile]') ?? [])].map(
      (tile) => tile.querySelector('[data-tile] > span')?.textContent,
    );
    expect(names.length).toBe(TEMPLATES.length);
    // Each tile keeps its preview, so the shapes are on the tile beside the words.
    expect(group?.querySelectorAll('[data-tile][data-tall]').length).toBe(TEMPLATES.length);
  });

  it('makes a draft from the tile that was pressed and hands it back', async () => {
    const run = await open();
    await userEvent.click(page.getByRole('button', { name: 'Feedback' }).element());
    await expect.poll(() => run.made.map((form) => form.id)).toEqual([MADE.id]);
    expect(run.asked).toEqual([{ templateId: 'feedback' }]);
  });

  it('turns the tiles off while it is making one, so a second press makes no second form', async () => {
    let settle: ((form: FormView) => void) | undefined;
    const run = await open({
      create: () =>
        new Promise<FormView>((resolve) => {
          settle = resolve;
        }),
    });
    await userEvent.click(page.getByRole('button', { name: 'Feedback' }).element());
    // The status names the template, so the person knows which tile they pressed, and it is announced politely.
    await expect.element(page.getByText('Making your Feedback…')).toBeVisible();
    // The pressed tile stays on and the other nine turn off: the one still lit is the one being made, and a
    // keyboard keeps its place on it (UX review, slice 8).
    await expect.element(page.getByRole('button', { name: 'Feedback' })).toBeEnabled();
    await expect.element(page.getByRole('button', { name: 'Blank form' })).toBeDisabled();
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
    await expect.element(page.getByRole('button', { name: 'Feedback' })).toBeVisible();
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
    await userEvent.click(page.getByRole('button', { name: 'Feedback' }).element());
    await expect.element(page.getByText('Making your Feedback…')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }).element());
    expect(run.closedCount()).toBe(1);
  });

  it('closes on Cancel without making anything', async () => {
    const run = await open();
    await expect.element(page.getByRole('button', { name: 'Feedback' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }).element());
    expect(run.closedCount()).toBe(1);
    expect(run.asked).toEqual([]);
  });
});
