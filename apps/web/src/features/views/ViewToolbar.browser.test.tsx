// The view bar's sort chip in Chromium (owner, 22 October 2026): the default order (Created at, newest first)
// applies silently, with no chip, whether the view stores no sorts or stores exactly that one. Another order
// shows a chip, and removing it goes back to the default rather than to no order at all.
import type { AttributeDefinition, DataLayer, DraftQuery } from '@crm/data';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ViewToolbar } from './ViewToolbar.tsx';

const attribute = (id: string, extra: Partial<AttributeDefinition>): AttributeDefinition => ({
  id,
  objectId: 'people',
  apiSlug: id,
  title: id,
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  isPrimary: false,
  config: {},
  position: 5,
  isArchived: false,
  ...extra,
});

const CREATED = attribute('0199f0a0-0000-7000-8000-0000000000c1', {
  apiSlug: 'created_at',
  title: 'Created at',
  type: 'timestamp',
  isSystem: true,
  position: 1,
});
const NAME = attribute('0199f0a0-0000-7000-8000-0000000000c2', { apiSlug: 'name', title: 'Name', position: 2 });
const ATTRIBUTES = [CREATED, NAME];
const DEFAULT: DraftQuery = { sorts: [{ attributeId: CREATED.id, direction: 'descending' }] };

/** The toolbar holding its own query, as the view screen's draft does. */
function Harness({ start }: { readonly start: DraftQuery }) {
  const [query, setQuery] = useState(start);
  return (
    <ViewToolbar
      query={query}
      filter={query.filter}
      attributes={ATTRIBUTES}
      sortable={ATTRIBUTES}
      members={[]}
      me={undefined}
      isDraft={false}
      canSave={false}
      isSaving={false}
      onChange={(next) => {
        setQuery(next);
      }}
      onDiscard={() => undefined}
      onSave={() => undefined}
      onSaveAsNew={() => undefined}
    />
  );
}

let app: InApp | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

async function render(start: DraftQuery): Promise<void> {
  app = await renderInApp(() => <Harness start={start} />, {
    // The toolbar asks the views store one thing: whether two queries ask the same.
    data: {
      views: { isSameQuery: (a: DraftQuery, b: DraftQuery) => JSON.stringify(a) === JSON.stringify(b) },
    } as unknown as DataLayer,
    pattern: '/w/$slug/objects/$object',
    at: '/w/acme/objects/people',
  });
}

describe('the view bar sort chip', () => {
  it('shows no chip for a view that stores the default order, only the Sort button', async () => {
    await render(DEFAULT);
    await expect.element(page.getByRole('button', { name: 'Sort', exact: true })).toBeVisible();
    expect(page.getByRole('button', { name: 'Remove sort' }).elements()).toHaveLength(0);
  });

  it('opens the Sort builder on the default that runs, and Add sort starts a sort of its own', async () => {
    await render(DEFAULT);
    await userEvent.click(page.getByRole('button', { name: 'Sort', exact: true }));
    await expect.element(page.getByText('Newest records show first.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Add sort' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Name' }));
    // One sort, the new one: the chip says it alone, with no "+1" for a Created at nobody chose.
    await expect.element(page.getByRole('button', { name: 'Remove sort' })).toBeInTheDocument();
    expect(page.getByText('+1').elements()).toHaveLength(0);
  });

  it('shows a chip for another order, and removing it goes back to the default with no chip', async () => {
    await render({ sorts: [{ attributeId: NAME.id, direction: 'ascending' }] });
    await expect.element(page.getByRole('button', { name: 'Remove sort' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Remove sort' }));
    expect(page.getByRole('button', { name: 'Remove sort' }).elements()).toHaveLength(0);
    // Focus lands on the dashed Sort button that takes the chip's place.
    await expect.element(page.getByRole('button', { name: 'Sort', exact: true })).toHaveFocus();
  });
});
