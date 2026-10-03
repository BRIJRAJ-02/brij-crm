import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.checkbox;

const meta = {
  title: 'Fields/Checkbox field',
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
  render: () => <FieldSurfaces attribute={sample.attribute} value={false} />,
};

/** The one editor, in a form: what it commits parses with the type's schema (AC-5). */
export const Editor: Story = {
  args: { value: false },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: 'Is customer' });
    await userEvent.click(checkbox);
    await expect(args.onCommit).toHaveBeenCalledWith(true);
    // The value is controlled and stays false; move focus away so the screenshot never catches a fading ring.
    checkbox.blur();
    await expect(checkbox).not.toHaveFocus();
  },
};
