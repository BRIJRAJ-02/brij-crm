import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Select, type SelectItem } from './Select.tsx';

const STAGES: readonly SelectItem[] = [
  { id: 'lead', label: 'Lead', hue: 'gray' },
  { id: 'qualified', label: 'Qualified', hue: 'sky' },
  { id: 'proposal', label: 'Proposal', hue: 'purple' },
  { id: 'won', label: 'Won', hue: 'green' },
  { id: 'lost', label: 'Lost', hue: 'red' },
  { id: 'legacy', label: 'Legacy', hue: 'orange', isArchived: true },
];

const meta = {
  title: 'Molecules/Select',
  component: Select,
  args: { label: 'Stage', items: STAGES, optionStyle: 'dot', placeholder: 'Set Stage…', onChange: fn() },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

function listbox() {
  return waitFor(() => {
    const found = document.querySelector('[role="listbox"]');
    if (found === null) throw new Error('the list did not open');
    return found;
  });
}

/** Opened from the keyboard: arrows move, Enter chooses and tells the caller, focus returns. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: /Stage/ });
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await listbox();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('qualified');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** Open, with status dots; the archived option can't be chosen. */
export const Open: Story = {
  parameters: { crm: { preview: true } },
  args: { defaultValue: 'won', defaultOpen: true, isClearable: true },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async () => {
    const list = await listbox();
    const archived = [...list.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent.includes('Legacy'),
    );
    await expect(archived).toHaveAttribute('aria-disabled', 'true');
    await expect(list).toHaveTextContent('Clear');
  },
};

/** Tags for a select attribute, people with avatars, and the read only, invalid and disabled states. */
export const Styles: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Select
        label="Segment"
        optionStyle="tag"
        defaultValue="enterprise"
        items={[
          { id: 'smb', label: 'SMB', hue: 'sky' },
          { id: 'enterprise', label: 'Enterprise', hue: 'blue' },
        ]}
      />
      <Select
        label="Owner"
        defaultValue="ada"
        items={[
          { id: 'ada', label: 'Ada Lovelace', leading: <Avatar name="Ada Lovelace" size="xs" isDecorative /> },
          { id: 'grace', label: 'Grace Hopper', leading: <Avatar name="Grace Hopper" size="xs" isDecorative /> },
        ]}
      />
      <Select
        label="Stage"
        items={STAGES}
        optionStyle="dot"
        defaultValue="won"
        isReadOnly
        readOnlyReason="Set by the deal's automation."
      />
      <Select label="Stage" items={STAGES} optionStyle="dot" isRequired error="Choose a stage to save the deal." />
      <Select label="Stage" items={STAGES} optionStyle="dot" defaultValue="lead" isDisabled />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Choose a stage to save the deal.')).toBeInTheDocument();
  },
};
