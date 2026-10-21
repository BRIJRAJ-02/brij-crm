import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { InfoTip } from '../../molecules/InfoTip/InfoTip.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Radio, RadioGroup } from './Radio.tsx';

const meta = {
  title: 'Atoms/Radio',
  component: RadioGroup,
  args: { label: 'Export format', defaultValue: 'csv', onChange: fn(), children: null },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Arrow keys move the choice and tell the caller. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <RadioGroup {...args}>
        <Radio value="csv" description="Opens in any spreadsheet.">
          CSV
        </Radio>
        <Radio value="xlsx" description="Keeps number and date formats.">
          Excel
        </Radio>
        <Radio value="json" isDisabled description="For developers. Coming with the API.">
          JSON
        </Radio>
      </RadioGroup>
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'CSV' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('radio', { name: 'Excel' })).toBeChecked();
    await expect(args.onChange).toHaveBeenCalledWith('xlsx');
  },
};

/** A few short choices in a row. */
export const Horizontal: Story = {
  render: () => (
    <Stage>
      <RadioGroup label="Week starts on" orientation="horizontal" defaultValue="mon">
        <Radio value="mon">Monday</Radio>
        <Radio value="sun">Sunday</Radio>
        <Radio value="sat">Saturday</Radio>
      </RadioGroup>
    </Stage>
  ),
};

/** Invalid, read only and disabled groups. */
export const States: Story = {
  render: () => (
    <Stage direction="column">
      <RadioGroup label="Plan" error="Pick a plan to continue." errorId="plan-error">
        <Radio value="team">Team</Radio>
        <Radio value="business">Business</Radio>
      </RadioGroup>
      <RadioGroup label="Role" defaultValue="admin" isReadOnly>
        <Radio value="admin">Admin</Radio>
        <Radio value="member">Member</Radio>
      </RadioGroup>
      <RadioGroup label="Region" defaultValue="eu" isDisabled>
        <Radio value="eu">Europe</Radio>
        <Radio value="us">United States</Radio>
      </RadioGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Pick a plan to continue.')).toBeInTheDocument();
    // The error line keeps the id it was given, and the group is described by it.
    await expect(document.getElementById('plan-error')).toHaveTextContent('Pick a plan to continue.');
    await expect(canvas.getByRole('radiogroup', { name: 'Plan' })).toHaveAccessibleDescription(
      'Pick a plan to continue.',
    );
  },
};

/** With `info`: an InfoTip beside the question. Tab reaches the tip first, then the chosen choice. */
export const WithInfo: Story = {
  args: {
    label: 'Who can see it',
    defaultValue: 'me',
    info: (
      <InfoTip label="Who can see it">
        Only me keeps the view in your own list. Everyone puts it in every member’s list.
      </InfoTip>
    ),
  },
  render: (args) => (
    <Stage>
      <RadioGroup {...args}>
        <Radio value="me">Only me</Radio>
        <Radio value="everyone">Everyone</Radio>
      </RadioGroup>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'About Who can see it' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Only me' })).toHaveFocus();
  },
};
