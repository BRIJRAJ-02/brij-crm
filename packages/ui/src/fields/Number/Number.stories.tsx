import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeDisplay } from '../AttributeDisplay.tsx';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.number;

const meta = {
  title: 'Fields/Number field',
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Employees' }));
    await userEvent.keyboard('1,250.5');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('1250.5');
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Employees' }));
    await userEvent.keyboard('12.34567');
    await userEvent.tab();
    await expect(canvas.getByText(/with up to 4 decimals/)).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** Shown as a percent (its Display setting, spec 0012): the number as typed with its sign, and "%" after the field. */
export const Percent: Story = {
  args: { attribute: { ...sample.attribute, name: 'Margin', isPercent: true }, value: '12.5' },
  render: (args) => (
    <Stage width="narrow">
      <AttributeDisplay attribute={args.attribute} value={args.value} surface="panel" />
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('12.5%')).toBeInTheDocument();
    await expect(canvas.getByText('%')).toBeInTheDocument();
  },
};

/** Compact display with fixed decimals: "1.3M" for 1,250,000, the exact number in a tooltip and for screen readers. */
export const Compact: Story = {
  args: { attribute: { ...sample.attribute, name: 'Revenue', isCompact: true }, value: '1250000' },
  render: (args) => (
    <Stage width="narrow">
      <AttributeDisplay attribute={args.attribute} value={args.value} surface="panel" />
      <AttributeDisplay
        attribute={{ ...args.attribute, isCompact: false, decimals: 2 }}
        value="1234.5"
        surface="panel"
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('1.3M')).toBeInTheDocument();
    await expect(canvas.getByText('1,250,000')).toBeInTheDocument();
    await expect(canvas.getByText('1,234.50')).toBeInTheDocument();
  },
};

/** Forgiving input: "1.2k" reads as 1,200, and "(300)" as minus 300. */
export const Forgiving: Story = {
  parameters: { crm: { screenshot: false } },
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Employees' }));
    await userEvent.keyboard('1.2k');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('1200');
  },
};
