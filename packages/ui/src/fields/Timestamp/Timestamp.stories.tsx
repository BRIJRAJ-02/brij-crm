import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.timestamp;

const meta = {
  title: 'Fields/Timestamp field',
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
  args: { value: sample.value as never },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Created' })).toBeInTheDocument();
    await expect(canvas.queryByRole('textbox')).toBeNull();
  },
};

/**
 * A date and time someone sets (the field types pass, 31 October 2026): the day (Now first among its quick picks)
 * and the time of day, in the stories’ London time (11:30 UTC is 12:30 there).
 */
export const EditorDateAndTime: Story = {
  args: {
    attribute: { ...sample.attribute, name: 'Follow up', isReadOnly: false },
    value: sample.value as never,
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Follow up' })).toBeInTheDocument();
    await expect(canvas.getAllByText('Time').length).toBeGreaterThan(0);
    await expect(canvas.getAllByText(/12:30/).length).toBeGreaterThan(0);
  },
};
