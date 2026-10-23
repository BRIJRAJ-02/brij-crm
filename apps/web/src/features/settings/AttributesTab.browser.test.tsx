// An object's Attributes tab in Chromium: the Archived disclosure shows only while an attribute is archived (SW18:
// "Archived 0" opened onto nothing).
import type { AttributeDefinition, DataLayer, ObjectSummary } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { AttributesTab } from './AttributesTab.tsx';

const PEOPLE = {
  id: '0199f0a0-0000-7000-8000-000000000001',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  access: 'write',
  position: 0,
  isStandard: true,
  isArchived: false,
} as ObjectSummary;

/** A text attribute of People, with what a test changes. */
function attributeOf(overrides: Partial<AttributeDefinition>): AttributeDefinition {
  return {
    id: '0199f0a0-0000-7000-8000-0000000000a1',
    objectId: PEOPLE.id,
    apiSlug: 'nickname',
    title: 'Nickname',
    type: 'text',
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    isPrimary: false,
    config: {},
    position: 0,
    isArchived: false,
    ...overrides,
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

/** People's Attributes tab holding these attributes, for an owner. */
async function renderAttributes(attributes: readonly AttributeDefinition[]) {
  const newId = () => '0199f0a0-0000-7000-8000-0000000000ff';
  const data = { attributes: { newId }, relationships: { newId } } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <AttributesTab
        slug="acme"
        object={PEOPLE}
        attributes={attributes}
        objects={[PEOPLE]}
        usage={undefined}
        members={[]}
        selectedId={undefined}
        onSelect={() => undefined}
        isCreating={false}
        onCreatingChange={() => undefined}
        onMovingChange={() => undefined}
      />
    ),
    {
      data,
      pattern: '/w/$slug/settings/objects/$object/$tab',
      at: '/w/acme/settings/objects/people/attributes',
      permissions: ['schema.manage'],
    },
  );
}

describe('the Archived disclosure (SW18)', () => {
  it('is left out while no attribute is archived', async () => {
    await renderAttributes([attributeOf({})]);
    await expect.element(page.getByRole('rowheader', { name: /Nickname/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Archived/ }).elements()).toHaveLength(0);
  });

  it('shows with its count once one is archived', async () => {
    await renderAttributes([
      attributeOf({}),
      attributeOf({ id: '0199f0a0-0000-7000-8000-0000000000a2', apiSlug: 'old', title: 'Old', isArchived: true }),
    ]);
    await expect.element(page.getByRole('button', { name: /Archived/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Archived/ }).element().textContent).toContain('1');
  });
});
