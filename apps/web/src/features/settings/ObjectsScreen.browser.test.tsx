// Settings › Objects in Chromium: the Archived disclosure shows only while something is archived (SW18: "Archived
// 0" opened onto nothing), and the Object column carries no InfoTip (flow pass, 30 Oct 2026: the sidebar owns order).
import type { DataLayer, ObjectSummary, Usage } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ObjectsScreen } from './ObjectsScreen.tsx';

/** An object as the settings list holds it, with what a test changes. */
function objectOf(overrides: Partial<ObjectSummary>): ObjectSummary {
  return {
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
    ...overrides,
  };
}

const PEOPLE = objectOf({});
const PROJECTS = objectOf({
  id: '0199f0a0-0000-7000-8000-000000000002',
  apiSlug: 'projects',
  singularName: 'Project',
  pluralName: 'Projects',
  position: 1,
  isStandard: false,
  isArchived: true,
});
const USAGE: Usage = { attributes: {}, optionsPerAttribute: 50 };

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The Objects page with these objects, as someone holding `permissions`. */
async function renderObjects(objects: readonly ObjectSummary[], permissions: readonly string[], usage: Usage = USAGE) {
  const data = { objects: { newId: () => '0199f0a0-0000-7000-8000-0000000000ff' } } as unknown as DataLayer;
  shown = await renderInApp(() => <ObjectsScreen slug="acme" objects={objects} usage={usage} recordCounts={{}} />, {
    data,
    pattern: '/w/$slug/settings/objects',
    at: '/w/acme/settings/objects',
    permissions,
  });
}

// Critic A #19 (5 November 2026): the count of custom objects is noise until the plan's room runs short.
describe('the custom object meter', () => {
  it('stays out under 80% of the limit', async () => {
    await renderObjects([PEOPLE], ['schema.manage'], { ...USAGE, customObjects: { used: 3, limit: 50 } });
    await expect.element(page.getByRole('rowheader', { name: /People/ })).toBeVisible();
    expect(page.getByRole('meter', { name: 'Custom objects' }).elements()).toEqual([]);
  });

  it('shows from 80% of the limit', async () => {
    await renderObjects([PEOPLE], ['schema.manage'], { ...USAGE, customObjects: { used: 40, limit: 50 } });
    await expect.element(page.getByRole('meter', { name: 'Custom objects' })).toBeVisible();
  });
});

describe('the Archived disclosure (SW18)', () => {
  it('is left out while nothing is archived', async () => {
    await renderObjects([PEOPLE], ['schema.manage']);
    await expect.element(page.getByRole('rowheader', { name: /People/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Archived/ }).elements()).toHaveLength(0);
  });

  it('shows with its count once something is archived', async () => {
    await renderObjects([PEOPLE, PROJECTS], ['schema.manage']);
    await expect.element(page.getByRole('button', { name: /Archived/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Archived/ }).element().textContent).toContain('1');
  });
});

describe('the Object column (flow pass, 30 Oct 2026)', () => {
  it('has no InfoTip and no Move up or Move down: the sidebar owns the order', async () => {
    await renderObjects([PEOPLE], ['schema.manage']);
    await expect.element(page.getByRole('rowheader', { name: /People/ })).toBeVisible();
    expect(
      page
        .getByRole('columnheader', { name: /Object/ })
        .getByRole('button')
        .elements(),
    ).toHaveLength(0);
  });
});
