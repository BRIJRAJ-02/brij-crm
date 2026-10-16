import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Tabs, TabPanel } from './Tabs.tsx';

const TABS = [
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'notes', label: 'Notes', icon: 'notebook', count: 12 },
  { id: 'tasks', label: 'Tasks', icon: 'list-checks', count: 3 },
  { id: 'files', label: 'Files', icon: 'folder', isDisabled: true },
] as const;

const meta = {
  title: 'Molecules/Tabs',
  component: Tabs,
  args: { label: 'Record', tabs: TABS, defaultSelectedKey: 'activity', onSelectionChange: fn(), children: null },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The arrow keys move between tabs and show each panel; the disabled tab is skipped. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Tabs {...args}>
      <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
      <TabPanel id="notes">12 notes.</TabPanel>
      <TabPanel id="tasks">3 open tasks.</TabPanel>
      <TabPanel id="files">No files.</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('tab', { name: 'Activity' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true');
    await expect(args.onSelectionChange).toHaveBeenCalledWith('notes');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('12 notes.');
  },
};

/** Big counts: up to `countMax` as they are, and a capped count as a floor ("10,000+"). */
export const LargeCounts: Story = {
  args: {
    tabs: [
      { id: 'activity', label: 'Activity', icon: 'activity' },
      { id: 'notes', label: 'Notes', icon: 'notebook', count: 1_250, countMax: 10_000 },
      { id: 'tasks', label: 'Tasks', icon: 'list-checks', count: 10_000, countMax: 10_000, isCountAtLeast: true },
    ],
  },
  render: (args) => (
    <Tabs {...args}>
      <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
      <TabPanel id="notes">Notes.</TabPanel>
      <TabPanel id="tasks">Open tasks.</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tab', { name: /Notes/ })).toHaveTextContent('1,250');
    await expect(canvas.getByRole('tab', { name: /Tasks/ })).toHaveTextContent('10,000+');
  },
};
