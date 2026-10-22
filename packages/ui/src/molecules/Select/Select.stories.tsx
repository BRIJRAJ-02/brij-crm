import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { InfoTip } from '../InfoTip/InfoTip.tsx';
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

/**
 * Each option's line under its label, wrapping, in a list a menu wide that opens under the trigger's end: a role
 * and what it can do, from a compact trigger beside an email in the Invite dialog.
 */
export const DescriptionBelow: Story = {
  args: {
    label: 'Role',
    isLabelHidden: true,
    optionDescription: 'below',
    defaultValue: 'member',
    defaultOpen: true,
    items: [
      { id: 'owner', label: 'Owner', description: 'Everything, including billing and deleting the workspace.' },
      { id: 'admin', label: 'Admin', description: 'Manages members, settings and every record.' },
      { id: 'member', label: 'Member', description: "Works with records; can't change settings or members." },
    ],
  },
  render: (args) => (
    <Stage>
      <Select {...args} />
    </Stage>
  ),
  play: async () => {
    const list = await listbox();
    const option = list.querySelector('[role="option"]');
    await expect(option).toHaveAttribute('data-description', 'below');
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

/**
 * A search lists the options whose label starts with what is typed first, and marks the first: "cl" puts
 * "Closed won" and "Closed lost" before "Declined", which only holds it, so Enter chooses what was meant.
 */
export const SearchBestMatchFirst: Story = {
  args: {
    label: 'Outcome',
    isSearchable: true,
    optionStyle: 'plain',
    items: [
      { id: 'declined', label: 'Declined' },
      { id: 'won', label: 'Closed won' },
      { id: 'lost', label: 'Closed lost' },
    ],
  },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Outcome/ }));
    const list = await listbox();
    await userEvent.keyboard('cl');
    await waitFor(() => expect(list.querySelector('[role="option"]')).toHaveTextContent('Closed won'));
    await waitFor(() => expect(list.querySelector('[role="option"][data-focused]')).toHaveTextContent('Closed won'));
    await expect(list.querySelectorAll('[role="option"]')[2]).toHaveTextContent('Declined');
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('won');
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

/** With `info`: an InfoTip beside the label. It opens its help and never the list, and the trigger still opens the list. */
export const WithInfo: Story = {
  args: {
    label: 'Minimum notice',
    items: [
      { id: '0', label: 'None' },
      { id: '240', label: '4 hours' },
    ],
    optionStyle: 'plain',
    value: '240',
    info: (
      <InfoTip label="Minimum notice" example="With 4 hours, a 2:00 PM slot can’t be booked after 10:00 AM.">
        How far ahead someone has to book.
      </InfoTip>
    ),
  },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'About Minimum notice' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: /4 hours/ }));
    await listbox();
  },
};

/** With `info`, read only: the tip still opens beside the locked value. */
export const WithInfoReadOnly: Story = {
  ...WithInfo,
  args: { ...WithInfo.args, isReadOnly: true, readOnlyReason: 'Only its owner can change it.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'About Minimum notice' })).toBeVisible();
  },
};

/** Options grouped under headings (`group`): a booking page's calendars by account, after the default. */
export const Grouped: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Add events to',
    optionStyle: 'dot',
    value: 'default',
    items: [
      { id: 'default', label: 'Your default (Ada Lovelace)', description: 'Follows your default in Settings' },
      { id: 'ada', label: 'Ada Lovelace', hue: 'blue', group: 'ada@acme.dev' },
      { id: 'team', label: 'Team', hue: 'green', group: 'ada@acme.dev' },
      { id: 'cal', label: 'Calendar', hue: 'purple', group: 'ada@lovelace.example' },
    ],
    isClearable: true,
  },
  render: (args) => (
    <Stage>
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    // The closed field shows the chosen option's label alone, never its description run on after it.
    const trigger = canvas.getByRole('button', { name: /Add events to/ });
    await expect(trigger).toHaveTextContent(/^Your default \(Ada Lovelace\)$/);
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const group = await body.findByRole('group', { name: 'ada@acme.dev' });
    await expect(within(group).getAllByRole('option')).toHaveLength(2);
    await expect(body.getByRole('option', { name: /Your default/ })).toHaveAttribute('aria-selected', 'true');
    // Clear comes last, after the groups.
    const options = body.getAllByRole('option');
    await expect(options[options.length - 1]).toHaveTextContent('Clear');
  },
};

/** An option's `badge`: a short Badge after its name, in the list and on the trigger (a schedule's "Default"). */
export const OptionBadge: Story = {
  args: {
    label: 'Schedule',
    items: [
      { id: 'default', label: 'Working hours', badge: 'Default' },
      { id: 'evenings', label: 'Evenings' },
    ],
    optionStyle: 'plain',
    value: 'default',
  },
  render: (args) => (
    <Stage width="narrow">
      <Select {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Working hours/ }));
    const list = await listbox();
    if (!(list instanceof HTMLElement)) throw new Error('the list is not an element');
    // Once the popover has faded in.
    await waitFor(() => expect(within(list).getByRole('option', { name: /Working hours.*Default/ })).toBeVisible());
  },
};
