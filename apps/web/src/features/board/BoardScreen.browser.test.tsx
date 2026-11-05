// A board with nothing to group by, in Chromium (the foolproof pass, 5 November 2026): Add Stage for owners and
// admins, which makes the Stage field in one click and waits for the board; Show as table for everyone; and the top
// bar's New <record> as the one primary, so the body's buttons lead only for someone who can't make records.
import type { AttributeDefinition, DataLayer, NewAttribute, ObjectSummary } from '@crm/data';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { BoardScreen } from './BoardScreen.tsx';

const projects = (access: 'read' | 'write'): ObjectSummary => ({
  id: '01a1a000-0000-7000-8000-000000000003',
  apiSlug: 'projects',
  singularName: 'Project',
  pluralName: 'Projects',
  icon: 'folder',
  hue: 'blue',
  access,
  position: 3,
  isStandard: false,
  isArchived: false,
});

/** Live updates on, as the layer reports them; one value, the same each read. */
const live = { subscribe: () => () => undefined, status: () => 'live' as const };

let app: InApp | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

const show = async (
  access: 'read' | 'write',
  permissions: readonly string[],
  create: (workspace: string, input: NewAttribute) => Promise<AttributeDefinition> = () =>
    Promise.reject(new Error('not asked')),
) => {
  const layouts: string[] = [];
  let ids = 0;
  app = await renderInApp(
    () => (
      <BoardScreen
        slug="acme"
        object={projects(access)}
        attributes={[]}
        members={[]}
        outcome={{ kind: 'nothing-to-group' }}
        query={{}}
        views={[{ id: 'all', name: 'All Projects' }]}
        currentViewId="all"
        onViewChange={() => undefined}
        layoutSwitch={{
          label: 'Layout',
          segments: [
            { value: 'table', label: 'Table', icon: 'table' },
            { value: 'board', label: 'Board', icon: 'kanban' },
          ],
          value: 'board',
          onChange: (value) => layouts.push(value),
        }}
        toolbar={() => null}
        onShowEmptyColumnsChange={() => undefined}
      />
    ),
    {
      data: {
        live,
        attributes: {
          create,
          newId: () => {
            ids += 1;
            return `01a1a000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
          },
        },
        records: { newId: () => '01a1a000-0000-7000-8000-0000000000ff' },
        relationships: { newId: () => '01a1a000-0000-7000-8000-0000000000fe' },
        objects: { newId: () => '01a1a000-0000-7000-8000-0000000000fd' },
      } as unknown as Partial<DataLayer>,
      pattern: '/w/$slug/objects/projects',
      at: '/w/acme/objects/projects',
      permissions,
    },
  );
  return { layouts };
};

describe('BoardScreen with nothing to group by', () => {
  it('offers an owner Add Stage, which makes the Stage field once and says so; New project stays the one primary', async () => {
    const made: NewAttribute[] = [];
    await show('write', ['schema.manage'], (_workspace, input) => {
      made.push(input);
      return Promise.resolve({ id: input.id, title: input.title } as unknown as AttributeDefinition);
    });
    const add = page.getByRole('button', { name: 'Add Stage', exact: true });
    await expect.element(add).toBeVisible();
    await expect.element(add).not.toHaveAttribute('data-variant', 'primary');
    await expect
      .element(page.getByRole('button', { name: 'Show as table' }))
      .not.toHaveAttribute('data-variant', 'primary');
    await expect.element(page.getByRole('button', { name: 'New project' })).toHaveAttribute('data-variant', 'primary');
    await userEvent.click(add);
    await expect.element(page.getByText('Stage added.')).toBeVisible();
    // The button went with the empty state's press: focus lands on the page's title, never the document.
    await expect.element(page.getByRole('heading', { level: 1, name: 'Projects' })).toHaveFocus();
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ title: 'Stage', type: 'status' });
    expect(made[0]?.options?.map((each) => each.label)).toEqual(['Lead', 'In progress', 'Won', 'Lost']);
  });

  it('sends the same field again after a failed try, so a lost answer never makes a second one', async () => {
    const made: NewAttribute[] = [];
    let fail = true;
    await show('write', ['schema.manage'], (_workspace, input) => {
      made.push(input);
      if (fail) {
        fail = false;
        return Promise.reject(new Error('the answer was lost'));
      }
      return Promise.resolve({ id: input.id, title: input.title } as unknown as AttributeDefinition);
    });
    const add = page.getByRole('button', { name: 'Add Stage', exact: true });
    await userEvent.click(add);
    await expect.element(page.getByText(/Couldn’t add Stage/u)).toBeVisible();
    await userEvent.click(add);
    await expect.element(page.getByText('Stage added.')).toBeVisible();
    expect(made).toHaveLength(2);
    expect(made[1]?.id).toBe(made[0]?.id);
    expect(made[1]?.options?.map((each) => each.id)).toEqual(made[0]?.options?.map((each) => each.id));
  });

  it('gives a member who may make records Show as table, with no Add Stage', async () => {
    const { layouts } = await show('write', []);
    const table = page.getByRole('button', { name: 'Show as table' });
    await expect.element(table).toBeVisible();
    await expect.element(table).not.toHaveAttribute('data-variant', 'primary');
    expect(page.getByRole('button', { name: 'Add Stage', exact: true }).elements()).toHaveLength(0);
    await userEvent.click(table);
    expect(layouts).toEqual(['table']);
  });

  it('leads a reader with Show as table, the page’s only way on', async () => {
    await show('read', []);
    await expect
      .element(page.getByRole('button', { name: 'Show as table' }))
      .toHaveAttribute('data-variant', 'primary');
    expect(page.getByRole('button', { name: 'Add Stage', exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'New project' }).elements()).toHaveLength(0);
  });
});
