// New object in Chromium (crm-f7's object journey, 28 Oct 2026): a plural typed as the Name, as the placeholder
// once invited, is taken as the plural, its singular guessed and said beside it, and both are what Create sends.
// Before, "Projects" was created as "Projectses", an API name that can never change afterwards.
import type { NewObject, ObjectSummary } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { NewObjectDialog } from './NewObjectDialog.tsx';

const ID = '0199f0a0-0000-7000-8000-0000000000b1';
let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The dialog, open, with what Create sends kept in `sent`. */
async function open() {
  const sent: NewObject[] = [];
  const onCreate = vi.fn((input: NewObject) => {
    sent.push(input);
    return new Promise<ObjectSummary>(() => undefined);
  });
  shown = await renderInApp(
    () => (
      <NewObjectDialog
        isOpen
        onOpenChange={() => undefined}
        objects={[]}
        newId={() => ID}
        onCreate={onCreate}
        onCreated={() => undefined}
      />
    ),
    { data: {}, pattern: '/w/$slug/settings/objects', at: '/w/acme/settings/objects' },
  );
  return sent;
}

describe('naming a new object', () => {
  it('takes a plural Name as the plural, says the singular it guessed, and sends both', async () => {
    const sent = await open();
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Projects');
    await expect.element(page.getByText('One Project, many Projects, API name projects')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Create object' }));
    await expect.poll(() => sent[0]).toMatchObject({ singularName: 'Project', pluralName: 'Projects' });
  });

  it('lets a wrong singular guess be corrected, two words and all', async () => {
    const sent = await open();
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Sales Leads');
    await userEvent.click(page.getByRole('button', { name: 'Names, API name and colour' }));
    const singular = page.getByRole('textbox', { name: 'Singular name' });
    await expect.element(singular).toHaveValue('Sales Lead');
    // Typed key by key, a space stays: it was trimmed away the moment it was typed, so "Sales LeadRep".
    await userEvent.type(singular, ' Rep');
    await expect.element(singular).toHaveValue('Sales Lead Rep');
    await userEvent.click(page.getByRole('button', { name: 'Create object' }));
    await expect.poll(() => sent[0]).toMatchObject({ singularName: 'Sales Lead Rep', pluralName: 'Sales Leads' });
  });

  it('takes a singular put back to the Name as one word for both, and says so', async () => {
    const sent = await open();
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Kudos');
    await userEvent.click(page.getByRole('button', { name: 'Names, API name and colour' }));
    await userEvent.fill(page.getByRole('textbox', { name: 'Singular name' }), 'Kudos');
    await expect.element(page.getByText('One Kudos, many Kudos, API name kudos')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Create object' }));
    await expect.poll(() => sent[0]).toMatchObject({ singularName: 'Kudos', pluralName: 'Kudos' });
  });

  it('still pluralises a singular Name, saying only the plural', async () => {
    const sent = await open();
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Project');
    // Exact: "Projects, API name projects" is also the tail of the two-form hint.
    await expect.element(page.getByText('Projects, API name projects', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/^One /)).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Create object' }));
    await expect.poll(() => sent[0]).toMatchObject({ singularName: 'Project', pluralName: 'Projects' });
  });
});
