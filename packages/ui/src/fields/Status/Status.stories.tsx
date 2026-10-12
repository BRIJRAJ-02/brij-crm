import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn, screen, waitFor } from 'storybook/test';

const sample = FIELD_SAMPLES.status;

const meta = {
  title: 'Fields/Status field',
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

/** The one editor, in a form: what it commits parses with the type's schema (AC-5). */
export const Editor: Story = {
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onCommit).toHaveBeenCalledWith(SAMPLE_IDS.stage.qualified);
  },
};

/** For someone who may shape the schema: a stage typed that no live stage is called is offered as "Create" (spec 0012, AC-238). */
export const CreateOption: Story = {
  args: { onCreateOption: fn() },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    const search = await screen.findByRole('textbox', { name: 'Search' });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard('Negotiation');
    await userEvent.click(await screen.findByRole('option', { name: 'Create "Negotiation"' }));
    await expect(args.onCreateOption).toHaveBeenCalledWith('Negotiation');
    // The list closes (its exit fades it): checked once it has gone.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};
