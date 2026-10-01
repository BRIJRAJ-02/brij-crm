import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { loadPhoneLibrary } from './phone-library.ts';
import { expect, fn, waitFor } from 'storybook/test';

const sample = FIELD_SAMPLES.phone;

const meta = {
  title: 'Fields/Phone field',
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
  play: async ({ canvas, args, userEvent }) => {
    await loadPhoneLibrary();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone' }));
    await userEvent.keyboard('+44 20 7123 4567');
    await userEvent.tab();
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith({ number: '+442071234567', country: 'GB' }));
  },
};

/** Invalid input shows how to fix it, and commits nothing. */
export const Invalid: Story = {
  parameters: { crm: { screenshot: false } },
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await loadPhoneLibrary();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole('textbox', { name: 'Phone' }));
    await userEvent.keyboard('not a number');
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByText(/Enter a phone number that exists/)).toBeInTheDocument());
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};
