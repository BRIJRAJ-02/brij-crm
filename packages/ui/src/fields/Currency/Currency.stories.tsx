import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.currency;

const meta = {
  title: 'Fields/Currency field',
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
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Deal value' }));
    await userEvent.keyboard('1,250');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith({ amount: '1250', currency: 'USD' });
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Deal value' }));
    await userEvent.keyboard('lots');
    await userEvent.tab();
    await expect(canvas.getByText(/Enter an amount like/)).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** Empty, in a form: an example amount as the placeholder, and a hint naming the currency picker. */
export const Guidance: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Deal value' })).toHaveAttribute('placeholder', '1,234.5');
    await expect(canvas.getByText('Pick the currency, then type the amount.')).toBeInTheDocument();
  },
};

/** A symbol typed with the amount moves the picker: "€5" is five euros, whatever the default. */
export const SymbolTyped: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: null },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Deal value' }));
    await userEvent.keyboard('€1.2k');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith({ amount: '1200', currency: 'EUR' });
  },
};

/** A pasted symbol that moves the picker says so under the field: "Currency changed to EUR." */
export const CurrencyChanged: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: null },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Deal value' }));
    await userEvent.paste('€500');
    await userEvent.tab();
    await expect(canvas.getByText('Currency changed to EUR.')).toBeInTheDocument();
  },
};
