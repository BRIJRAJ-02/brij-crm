import type { Meta, StoryObj } from '@storybook/react-vite';
import { arraySource } from '../../lib/list-source.ts';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES, SAMPLE_COMPANIES } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';

const sample = FIELD_SAMPLES.record_reference;

const meta = {
  title: 'Fields/Record reference field',
  component: AttributeEditor,
  args: { attribute: sample.attribute, value: null, surface: 'form', onCommit: fn() },
} satisfies Meta<typeof AttributeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one display, on every surface. */
export const Display: Story = {
  parameters: { crm: { preview: true } },
  render: () => <FieldSurfaces attribute={sample.attribute} value={sample.value} display={sample.display} />,
};

/** Empty: nothing in a cell, a dash elsewhere, and "Empty" for screen readers. */
export const Empty: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <FieldSurfaces attribute={sample.attribute} value={null} />,
};

/** Several values: three show, then "+N" opens the rest. */
export const Several: Story = {
  render: () => (
    <FieldSurfaces
      attribute={sample.several?.attribute ?? sample.attribute}
      value={sample.several?.value}
      display={sample.several?.display}
      maxVisible={3}
    />
  ),
};

/**
 * A linked record's name on its way (the data layer reads it by id): a skeleton chip, read as "Loading";
 * and one with no display at all, which says "Unknown".
 */
export const NameLoading: Story = {
  render: () => (
    <FieldSurfaces
      attribute={sample.attribute}
      value={sample.value}
      display={{ ...(sample.display as object), name: '' }}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Loading').length).toBeGreaterThan(0);
  },
};

/**
 * While the form around it sends (a dialog's Link in flight): the chosen record shows faded, and neither the box nor
 * its Remove takes a press until the answer.
 */
export const WhileSending: Story = {
  args: { value: sample.value as never, display: sample.display as never, isDisabled: true },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('button', { name: /Change Company/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /^Remove/ })).toBeDisabled();
    await expect(document.querySelector('[role="menu"]')).toBeNull();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** The one editor, in a form: what it commits parses with the type's schema (AC-5). */
export const Editor: Story = {
  args: {
    onSearch: ((query: string) =>
      arraySource(
        SAMPLE_COMPANIES.filter((company) => company.name.toLowerCase().includes(query.toLowerCase())),
        (company) => company.recordId,
      )) as never,
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Choose Company/ }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('the menu did not open');
      return found;
    });
    await userEvent.keyboard('Glob');
    const globex = await waitFor(() => {
      const item = [...menu.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent.includes('Globex'));
      if (item === undefined) throw new Error('no Globex');
      return item;
    });
    await userEvent.click(globex);
    // Focus is back on the trigger at once, before the menu has faded (a key pressed meanwhile reaches the page).
    // Holding one now, the field's button changes it.
    await waitFor(() => expect(canvas.getByRole('button', { name: /Change Company/ })).toHaveFocus(), { timeout: 100 });
    // In a form the picker is named by its visible label.
    await expect(canvas.getByRole('group', { name: 'Company' })).toBeInTheDocument();
    await expect(args.onCommit).toHaveBeenCalledWith({
      objectId: SAMPLE_IDS.companies,
      recordId: SAMPLE_IDS.company.globex,
    });
    // The menu fades out; let it finish before the accessibility check reads colours.
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};

/**
 * A reference that may hold records of any object (a task's linked records,
 * spec 0019): a Select in the picker's menu, above its search, picks which
 * object it looks in, and focus goes back to the search.
 */
export const ObjectSwitcher: Story = {
  args: { onCommit: fn() },
  render: function Render(args) {
    const [objectId, setObjectId] = useState<string>(SAMPLE_IDS.companies);
    const objects = [
      { id: SAMPLE_IDS.companies, label: 'Companies', icon: 'building' as const, hue: 'blue' as const },
      { id: 'people', label: 'People', icon: 'user' as const, hue: 'green' as const },
    ];
    return (
      <Stage width="narrow">
        <AttributeEditor
          {...args}
          attribute={{ ...sample.attribute, allowMultiple: true, name: 'Records' }}
          onSearch={
            ((query: string) =>
              arraySource(
                objectId === SAMPLE_IDS.companies
                  ? SAMPLE_COMPANIES.filter((company) => company.name.toLowerCase().includes(query.toLowerCase()))
                  : [],
                (company) => company.recordId,
              )) as never
          }
          objectSwitcher={{ objects, objectId, onObjectChange: setObjectId }}
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    // One field: nothing beside it but its own box.
    await expect(canvas.queryByRole('button', { name: /Search in/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: /Choose Records/ }));
    const page = within(document.body);
    const switcher = await page.findByRole('button', { name: /Search in/ });
    await expect(switcher).toHaveTextContent('Companies');
    await expect(document.activeElement).toHaveAttribute('type', 'search');
    await userEvent.click(switcher);
    await userEvent.click(await page.findByRole('option', { name: 'People' }));
    await waitFor(() => expect(switcher).toHaveTextContent('People'));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('type', 'search'));
    await expect(document.activeElement).toHaveAttribute('placeholder', 'Search People…');
    // By keyboard: Shift Tab from the search reaches the switcher; Esc in its list closes only the list.
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect(switcher).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await page.findByRole('option', { name: 'Companies' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('option', { name: 'Companies' })).toBeNull());
    await expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await page.findByRole('option', { name: 'Companies' }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('placeholder', 'Search Companies…'));
    await userEvent.keyboard('{Escape}');
  },
};

/** The object switcher with records already chosen, and a refusal under the field. */
export const ObjectSwitcherWithChosen: Story = {
  args: { onCommit: fn() },
  render: function Render(args) {
    const [objectId, setObjectId] = useState<string>(SAMPLE_IDS.companies);
    const objects = [
      { id: SAMPLE_IDS.companies, label: 'Companies', icon: 'building' as const, hue: 'blue' as const },
      { id: 'people', label: 'People', icon: 'user' as const, hue: 'green' as const },
    ];
    const chosen = SAMPLE_COMPANIES.slice(0, 2);
    return (
      <Stage width="narrow">
        <AttributeEditor
          {...args}
          attribute={{ ...sample.attribute, allowMultiple: true, name: 'Records' }}
          value={chosen.map((company) => ({ objectId: company.objectId, recordId: company.recordId }))}
          display={chosen}
          error="You can’t link a task to a record you can’t change."
          objectSwitcher={{ objects, objectId, onObjectChange: setObjectId }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Records' })).toBeInTheDocument();
    await expect(canvas.getByRole('alert')).toHaveTextContent('You can’t link a task to a record you can’t change.');
  },
};

/**
 * Search results with what they say beside their names (spec 0014): one
 * already linked shows its check, one held on a far side of one says where
 * ("At Acme"), and one held by a record the reader can't see says "Linked
 * elsewhere". Screen readers read each note with its item.
 */
export const ResultNotes: Story = {
  args: {
    attribute: { ...sample.attribute, name: 'Partners', allowMultiple: true },
    onSearch: (() => arraySource(SAMPLE_COMPANIES.slice(0, 3), (company) => company.recordId)) as never,
    describeResult: ((display: { readonly recordId: string }) => {
      const [linked, taken, hidden] = SAMPLE_COMPANIES;
      if (display.recordId === linked?.recordId) return { isLinked: true };
      if (display.recordId === taken?.recordId) return { note: 'At Acme' };
      if (display.recordId === hidden?.recordId) return { note: 'Linked elsewhere' };
      return undefined;
    }) as never,
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Choose Partners/ }));
    const items = await waitFor(() => {
      // This picker's own menu, never one another story left fading.
      const found = [...document.querySelectorAll('[role="menu"][aria-label="Partners"] [role="menuitem"]')];
      if (found.length < 3) throw new Error('the results are not in');
      return found;
    });
    await expect(items[1]).toHaveAccessibleDescription('At Acme');
    await expect(items[2]).toHaveAccessibleDescription('Linked elsewhere');
    // Already linked: its check is drawn, and screen readers hear "Current" after its name.
    await expect(items[0]).toHaveAccessibleDescription('Current');
  },
};

/**
 * A search that finds nothing by that name ends in "Create "<typed>"" (for someone who may make records of the far
 * object): choosing it hands the name over, and the record the screen made at once is picked, as if chosen.
 */
export const CreatesRecord: Story = {
  args: {
    onSearch: ((query: string) =>
      arraySource(
        SAMPLE_COMPANIES.filter((company) => company.name.toLowerCase().includes(query.toLowerCase())),
        (company) => company.recordId,
      )) as never,
    onCreateRecord: fn((label: string) => ({
      objectId: SAMPLE_IDS.companies,
      recordId: 'new-company',
      name: label,
      kind: 'company' as const,
    })),
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Choose Company/ }));
    const page = within(document.body);
    await page.findByRole('menu');
    await userEvent.keyboard('Initech');
    await userEvent.click(await page.findByRole('menuitem', { name: 'Create "Initech"' }));
    await expect(args.onCreateRecord).toHaveBeenCalledWith('Initech');
    await waitFor(() => expect(canvas.getByRole('button', { name: /Change Company/ })).toHaveFocus(), { timeout: 100 });
    await expect(args.onCommit).toHaveBeenCalledWith({ objectId: SAMPLE_IDS.companies, recordId: 'new-company' });
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};

/** A far object that needs more than a name (a required field): "Create company…" hands the typed text to its form. */
export const CreatesThroughForm: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    onSearch: (() => arraySource([], (company: { readonly recordId: string }) => company.recordId)) as never,
    onCreateRecord: fn(() => undefined),
    createFormNoun: 'company',
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Choose Company/ }));
    const page = within(document.body);
    await page.findByRole('menu');
    await userEvent.keyboard('Initech');
    await userEvent.click(await page.findByRole('menuitem', { name: 'Create company…' }));
    await expect(args.onCreateRecord).toHaveBeenCalledWith('Initech');
    await expect(args.onCommit).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};
