// Settings › Objects in Chromium: the Archived disclosure shows only while something is archived (SW18: "Archived
// 0" opened onto nothing), and the Object column's InfoTip says what the drag order is for, only to someone who may
// drag (SW15).
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
async function renderObjects(objects: readonly ObjectSummary[], permissions: readonly string[]) {
  const data = { objects: { newId: () => '0199f0a0-0000-7000-8000-0000000000ff' } } as unknown as DataLayer;
  shown = await renderInApp(() => <ObjectsScreen slug="acme" objects={objects} usage={USAGE} recordCounts={{}} />, {
    data,
    pattern: '/w/$slug/settings/objects',
    at: '/w/acme/settings/objects',
    permissions,
  });
}

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

describe('the Object column’s InfoTip (SW15)', () => {
  it('says what the drag order is for, to someone who may drag', async () => {
    await renderObjects([PEOPLE], ['schema.manage']);
    await expect.element(page.getByRole('rowheader', { name: /People/ })).toBeVisible();
    const header = page.getByRole('columnheader', { name: /Object/ });
    await header.getByRole('button').click();
    await expect
      .element(page.getByText('Drag, or use Move up and Move down, to change the order objects show in the sidebar.'))
      .toBeVisible();
  });

  it('is left out for someone who can’t drag', async () => {
    await renderObjects([PEOPLE], []);
    await expect.element(page.getByRole('rowheader', { name: /People/ })).toBeVisible();
    expect(
      page
        .getByRole('columnheader', { name: /Object/ })
        .getByRole('button')
        .elements(),
    ).toHaveLength(0);
  });
});
