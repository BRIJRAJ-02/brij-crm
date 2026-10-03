import type { Meta, StoryObj } from '@storybook/react-vite';
import { arraySource } from '../../lib/list-source.ts';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES, SAMPLE_COMPANIES } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn, waitFor } from 'storybook/test';

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
    await expect(args.onCommit).toHaveBeenCalledWith({
      objectId: SAMPLE_IDS.companies,
      recordId: SAMPLE_IDS.company.globex,
    });
    // The menu fades out; let it finish before the accessibility check reads colours.
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};
