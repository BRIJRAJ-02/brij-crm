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

/** Inline in a line of text, no box: a booking page's time zone. */
export const Inline: Story = {
  args: {
    label: 'Time zone',
    isLabelHidden: true,
    variant: 'inline',
    showsDescription: true,
    optionStyle: 'plain',
    items: [
      { id: 'Asia/Kolkata', label: 'Kolkata time', description: 'GMT+5:30' },
      { id: 'Europe/London', label: 'London time', description: 'GMT+1' },
    ],
    value: 'Asia/Kolkata',
  },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Kolkata time/ }));
    await listbox();
    await userEvent.keyboard('{Escape}');
  },
};

/** Times of day: every one the same width whatever it says, so what follows never moves. */
export const Time: Story = {
  args: {
    label: 'Start',
    isLabelHidden: true,
    size: 'sm',
    variant: 'time',
    optionStyle: 'plain',
    items: [
      { id: '00:00', label: '12:00 AM' },
      { id: '09:00', label: '9:00 AM' },
      { id: '24:00', label: 'Midnight' },
    ],
  },
  render: (args) => (
    <Stage>
      <Select {...args} label="Start" value="00:00" />
      <Select {...args} label="Middle" value="09:00" />
      <Select {...args} label="End" value="24:00" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const widths = new Set(
      canvas.getAllByRole('button').map((trigger) => Math.round(trigger.getBoundingClientRect().width)),
    );
    await expect(widths.size).toBe(1);
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

/** A choice unlike the rest, set apart under a hairline: a form's "Don't add to the CRM" after the objects. */
export const ApartItem: Story = {
  args: {
    label: 'Where submissions go',
    optionStyle: 'plain',
    defaultValue: 'people',
    defaultOpen: true,
    items: [
      { id: 'people', label: 'People', icon: 'user' },
      { id: 'companies', label: 'Companies', icon: 'building' },
      { id: 'deals', label: 'Deals', icon: 'handshake' },
      { id: 'none', label: 'Don’t add to the CRM', icon: 'inbox', isApart: true },
    ],
  },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    const list = await listbox();
    const apart = [...list.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent.includes('Don’t add to the CRM'),
    );
    await expect(apart).toHaveAttribute('data-apart', 'true');
    await expect(list.querySelectorAll('[data-apart]')).toHaveLength(1);
    if (!(apart instanceof HTMLElement)) throw new Error('no apart option');
    await userEvent.click(apart);
    await expect(args.onChange).toHaveBeenCalledWith('none');
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

/** An option a rule rules out: muted, its reason under it, and it can't be chosen. */
export const DisabledOption: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Field',
    optionStyle: 'plain',
    placeholder: 'Choose a field',
    defaultOpen: true,
    items: [
      { id: 'stage', label: 'Stage', icon: 'circle-dot' },
      {
        id: 'code',
        label: 'Deal code',
        icon: 'type',
        isDisabled: true,
        description: 'Deal code is unique, so several records can’t share one value.',
      },
    ],
  },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ args, userEvent }) => {
    const list = await listbox();
    const ruled = [...list.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent.includes('Deal code'),
    );
    await expect(ruled).toHaveAttribute('aria-disabled', 'true');
    await expect(ruled).toHaveTextContent('several records can’t share one value');
    if (ruled instanceof HTMLElement) await userEvent.click(ruled);
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

/** Searchable, for a long list: the search field takes focus as it opens, and typing narrows the options. */
export const Searchable: Story = {
  args: { label: 'Stage', isSearchable: true, optionStyle: 'plain' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Stage/ }));
    const list = await listbox();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search'));
    await userEvent.keyboard('pro');
    await waitFor(() => expect(list.querySelectorAll('[role="option"]')).toHaveLength(1));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('proposal');
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
  },
};

/** `showsDescription`: the chosen option's detail stays in the closed field (a time zone and its offset). */
export const DescriptionInField: Story = {
  args: {
    label: 'Time zone',
    optionStyle: 'plain',
    placeholder: 'Choose',
    showsDescription: true,
    items: [
      { id: 'Asia/Kolkata', label: 'Asia/Kolkata', description: 'GMT+05:30' },
      { id: 'Europe/London', label: 'Europe/London', description: 'GMT+01:00' },
    ],
    defaultValue: 'Asia/Kolkata',
  },
  render: (args) => (
    <Stage>
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Time zone/ })).toHaveTextContent('GMT+05:30');
  },
};

/** A quiet "(optional)" after the label and "Choose one" while empty, as a public form's optional dropdown. */
export const OptionalMark: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Size', labelAside: '(optional)', placeholder: 'Choose one', optionStyle: 'plain' },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Size \(optional\)/ })).toBeInTheDocument();
  },
};
