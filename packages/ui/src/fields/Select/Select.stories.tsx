import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn, screen, waitFor } from 'storybook/test';

const sample = FIELD_SAMPLES.select;

const meta = {
  title: 'Fields/Select field',
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
    await expect(args.onCommit).toHaveBeenCalledWith(SAMPLE_IDS.tag.fintech);
  },
};

/** For someone who may shape the schema: a label no live option has is offered as "Create"; one it has (any case) is not (spec 0012, AC-238). */
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
    await userEvent.keyboard('saas');
    await expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
    await userEvent.clear(search);
    await userEvent.keyboard('Hot');
    await userEvent.click(await screen.findByRole('option', { name: 'Create "Hot"' }));
    await expect(args.onCreateOption).toHaveBeenCalledWith('Hot');
    // The list closes (its exit fades it): checked once it has gone.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  },
};

/** Several values: the menu's search offers "Create" last, too. */
export const CreateOptionSeveral: Story = {
  args: {
    attribute: sample.several?.attribute ?? sample.attribute,
    onCreateOption: fn(),
  },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    const search = await screen.findByRole('searchbox');
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.keyboard('Robotics');
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Create "Robotics"' }));
    await expect(args.onCreateOption).toHaveBeenCalledWith('Robotics');
  },
};
