// An object's name attribute on its Configuration tab in Chromium (late trap #15): a custom object offers only the
// attributes that can name records and saves the one picked, with Undo; a standard object's stays its Name, read
// only with the reason.
import type { AttributeDefinition, DataLayer, ObjectChanges, ObjectSummary } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ConfigurationTab, useObjectConfiguration } from './ConfigurationTab.tsx';

const NAME = '0199f0a0-0000-7000-8000-0000000000a1';
const CODE = '0199f0a0-0000-7000-8000-0000000000a2';

const PROJECTS = {
  id: '0199f0a0-0000-7000-8000-000000000002',
  apiSlug: 'projects',
  singularName: 'Project',
  pluralName: 'Projects',
  icon: 'folder',
  hue: 'green',
  primaryAttributeId: NAME,
  access: 'write',
  position: 3,
  isStandard: false,
  isArchived: false,
} as ObjectSummary;

/** An attribute of Projects, with what a test changes. */
function attributeOf(overrides: Partial<AttributeDefinition>): AttributeDefinition {
  return {
    id: NAME,
    objectId: PROJECTS.id,
    apiSlug: 'name',
    title: 'Name',
    type: 'text',
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    isPrimary: true,
    config: {},
    position: 0,
    isArchived: false,
    ...overrides,
  };
}

const ATTRIBUTES = [
  attributeOf({}),
  attributeOf({ id: CODE, apiSlug: 'code', title: 'Code', isPrimary: false, position: 1 }),
  attributeOf({
    id: '0199f0a0-0000-7000-8000-0000000000a3',
    apiSlug: 'budget',
    title: 'Budget',
    type: 'number',
    isPrimary: false,
    position: 2,
  }),
  attributeOf({
    id: '0199f0a0-0000-7000-8000-0000000000a4',
    apiSlug: 'record_id',
    title: 'Record ID',
    isSystem: true,
    isPrimary: false,
    position: 3,
  }),
];

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The tab as the object's page holds it: the names and look from the page's hook. */
function Tab({ object }: { readonly object: ObjectSummary }) {
  const configuration = useObjectConfiguration('acme', object);
  return <ConfigurationTab slug="acme" object={object} configuration={configuration} attributes={ATTRIBUTES} />;
}

/**
 * The tab for an owner (or, with no permissions, a member), with what the name attribute's saves send kept in
 * `sent`; `refuse` answers each save with that refusal.
 */
async function renderTab(
  object: ObjectSummary,
  options: { readonly permissions?: readonly string[]; readonly refuse?: Error } = {},
) {
  const sent: ObjectChanges[] = [];
  const update = vi.fn((_workspace: string, _objectId: string, changes: ObjectChanges) => {
    sent.push(changes);
    return options.refuse === undefined ? Promise.resolve({ ...object, ...changes }) : Promise.reject(options.refuse);
  });
  // What the server holds now: the object with the last save's name attribute, as Undo reads it back.
  const all = () =>
    Promise.resolve([{ ...object, ...sent.reduce<ObjectChanges>((held, changes) => ({ ...held, ...changes }), {}) }]);
  const data = { objects: { update, all } } as unknown as DataLayer;
  shown = await renderInApp(() => <Tab object={object} />, {
    data,
    pattern: '/w/$slug/settings/objects/$object/$tab',
    at: `/w/acme/settings/objects/${object.apiSlug}/configuration`,
    permissions: options.permissions ?? ['schema.manage'],
  });
  return sent;
}

describe('the name attribute (late trap #15)', () => {
  it('offers only the attributes that can name records, and saves the one picked with Undo', async () => {
    const sent = await renderTab(PROJECTS);
    await page.getByRole('button', { name: /Name attribute/ }).click();
    const offered = page
      .getByRole('option')
      .elements()
      .map((option) => option.textContent);
    expect(offered).toHaveLength(2);
    expect(offered.join(' ')).toContain('Code');
    expect(offered.join(' ')).not.toContain('Budget');
    expect(offered.join(' ')).not.toContain('Record ID');
    await page.getByRole('option', { name: /Code/ }).click();
    await expect.poll(() => sent).toEqual([{ primaryAttributeId: CODE }]);
    await expect.element(page.getByText('Projects are now named by Code.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent).toEqual([{ primaryAttributeId: CODE }, { primaryAttributeId: NAME }]);
  });

  it("keeps a standard object's Name, read only, and says why", async () => {
    await renderTab({ ...PROJECTS, apiSlug: 'people', pluralName: 'People', isStandard: true });
    await expect.element(page.getByText('People, Companies and Deals are always named by their Name.')).toBeVisible();
  });

  it('puts the name attribute back, and says why, when the save is refused', async () => {
    const sent = await renderTab(PROJECTS, { refuse: new Error('offline') });
    await page.getByRole('button', { name: /Name attribute/ }).click();
    await page.getByRole('option', { name: /Code/ }).click();
    await expect.element(page.getByText(/Couldn't change the name attribute/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Name attribute/ })).not.toHaveTextContent('Code');
    expect(sent).toEqual([{ primaryAttributeId: CODE }]);
  });

  it('shows a member the name attribute with nothing to change', async () => {
    const sent = await renderTab(PROJECTS, { permissions: [] });
    await expect.element(page.getByText('Name attribute', { exact: true }).first()).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Name attribute/ })).not.toBeInTheDocument();
    await expect.element(page.getByText('Name', { exact: true }).first()).toBeVisible();
    expect(sent).toEqual([]);
  });

  it('leaves one Undo after two picks, and says so when an Undo can no longer apply', async () => {
    const sent = await renderTab(PROJECTS);
    await page.getByRole('button', { name: /Name attribute/ }).click();
    await page.getByRole('option', { name: /Code/ }).click();
    await expect.element(page.getByText('Projects are now named by Code.')).toBeVisible();
    await page.getByRole('button', { name: /Name attribute/ }).click();
    await page.getByRole('option', { name: /^Name/ }).click();
    await expect.element(page.getByText('Projects are now named by Name.')).toBeVisible();
    // The first pick's toast closed as the second began: one Undo is left, the second pick's.
    await expect.element(page.getByText('Projects are now named by Code.')).not.toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Undo' }).elements()).toHaveLength(1);
    expect(sent).toEqual([{ primaryAttributeId: CODE }, { primaryAttributeId: NAME }]);
  });

  it('says when the attributes could not be read, with the choice read only', async () => {
    shown = await renderInApp(
      () => {
        const configuration = useObjectConfiguration('acme', PROJECTS);
        return (
          <ConfigurationTab slug="acme" object={PROJECTS} configuration={configuration} attributes="unavailable" />
        );
      },
      {
        data: {},
        pattern: '/w/$slug/settings/objects/$object/$tab',
        at: '/w/acme/settings/objects/projects/configuration',
        permissions: ['schema.manage'],
      },
    );
    await expect.element(page.getByText("Couldn't load this object's attributes. Reload to choose one.")).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Name attribute/ })).not.toBeInTheDocument();
  });
});
