import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PresenceGroup, type PresencePerson } from './PresenceGroup.tsx';

/** A few people on a record. Built in a function, so the preview carries no list at module level. */
function fewPeople(): readonly PresencePerson[] {
  return [
    { id: 'p1', name: 'Maya Ross', status: 'active', activity: 'Editing Pricing' },
    { id: 'p2', name: 'Jonas Berg', status: 'active' },
    { id: 'p3', name: 'Ana Lima', status: 'idle' },
  ];
}

/** A crowd of a thousand: only `max` are drawn or named. */
function crowd(): readonly PresencePerson[] {
  return Array.from({ length: 1000 }, (_, index) => ({
    id: `c${String(index)}`,
    name: `Viewer ${String(index + 1)}`,
    status: index % 3 === 0 ? ('idle' as const) : ('active' as const),
  }));
}

const meta = {
  title: 'Atoms/PresenceGroup',
  component: PresenceGroup,
  args: { people: [] },
} satisfies Meta<typeof PresenceGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three people: each avatar is a tab stop, and its tooltip says what they are doing. */
export const Few: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <PresenceGroup people={fewPeople()} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getByRole('group', { name: '3 here: Maya Ross, Jonas Berg, and Ana Lima' }),
    ).toBeInTheDocument();
    await userEvent.tab();
    await expect(canvas.getByRole('img', { name: 'Maya Ross' })).toHaveFocus();
    const tooltip = await waitFor(() => within(document.body).getByRole('tooltip'));
    await expect(tooltip).toHaveTextContent('Maya Ross · Editing Pricing');
    await userEvent.tab();
    await waitFor(() => expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Jonas Berg · Here now'));
    await userEvent.tab();
    await waitFor(() => expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Ana Lima · Away'));
  },
};

/** A thousand viewers: four avatars and "+996", and a name that holds four names, never a thousand. */
export const Crowd: Story = {
  render: () => (
    <Stage>
      <PresenceGroup people={crowd()} size="md" />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const group = canvas.getByRole('group');
    await expect(group).toHaveAccessibleName('1,000 here: Viewer 1, Viewer 2, Viewer 3, Viewer 4, and 996 others');
    await expect(canvas.getAllByRole('img')).toHaveLength(4);
    await expect(canvas.getByText('+996')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-status]')).toHaveLength(4);
  },
};

/** Nobody else here: nothing is drawn but the empty group. */
export const Alone: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <PresenceGroup people={[]} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('img')).toHaveLength(0);
  },
};
