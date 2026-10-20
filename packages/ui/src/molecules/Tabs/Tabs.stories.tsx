import type { Meta, StoryObj } from '@storybook/react-vite';
import { StrictMode, useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../Field/Field.tsx';
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

/** With the chosen tab's tools at the strip's far end (Captures' search and New), on the same hairline. */
export const WithEnd: Story = {
  render: (args) => (
    <Tabs
      {...args}
      end={
        <>
          <Field label="Search booking pages" isLabelHidden variant="search" type="search" size="sm" />
          <Button variant="primary" icon="plus">
            New booking page
          </Button>
        </>
      }
    >
      <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
      <TabPanel id="notes">12 notes.</TabPanel>
      <TabPanel id="tasks">3 open tasks.</TabPanel>
      <TabPanel id="files">No files.</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Record' })).toBeInTheDocument();
    await expect(canvas.getByRole('searchbox', { name: 'Search booking pages' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'New booking page' })).toBeInTheDocument();
  },
};

/** On a phone: the tools take a row of their own under the tabs, and the search narrows to fit. */
export const WithEndNarrow: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Tabs
        {...args}
        tabs={TABS.slice(0, 3)}
        end={
          <>
            <Field label="Search booking pages" isLabelHidden variant="search" type="search" size="sm" />
            <Button variant="primary" icon="plus">
              New
            </Button>
          </>
        }
      >
        <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
        <TabPanel id="notes">12 notes.</TabPanel>
        <TabPanel id="tasks">3 open tasks.</TabPanel>
      </Tabs>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const list = canvas.getByRole('tablist', { name: 'Record' }).getBoundingClientRect();
    const button = canvas.getByRole('button', { name: 'New' }).getBoundingClientRect();
    await expect(button.top).toBeGreaterThanOrEqual(list.bottom - 1);
    await expect(button.right).toBeLessThanOrEqual(list.right + 1);
  },
};

/** A strip whose page draws the chosen tab (a form's sections), switched under StrictMode, as the app runs. */
function SwitchingStrip() {
  const [tab, setTab] = useState('form');
  return (
    <StrictMode>
      <Tabs
        label="Form sections"
        selectedKey={tab}
        onSelectionChange={setTab}
        tabs={[
          { id: 'form', label: 'Form' },
          { id: 'settings', label: 'Settings' },
          { id: 'install', label: 'Install' },
          { id: 'submissions', label: 'Submissions' },
        ]}
      >
        {['form', 'settings', 'install', 'submissions'].map((id) => (
          <TabPanel key={id} id={id}>
            {id}
          </TabPanel>
        ))}
      </Tabs>
    </StrictMode>
  );
}

/** The underline settles under the chosen tab, even when its effect runs twice (StrictMode, a re-rendering route). */
export const LineFollowsChoice: Story = {
  render: () => <SwitchingStrip />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    for (const name of ['Install', 'Submissions']) {
      const tab = canvas.getByRole('tab', { name });
      await userEvent.click(tab);
      await waitFor(() => {
        const line = tab.querySelector('div');
        const left = line?.getBoundingClientRect().left ?? Number.NaN;
        const width = line?.getBoundingClientRect().width ?? Number.NaN;
        void expect(Math.abs(left - tab.getBoundingClientRect().left)).toBeLessThan(1);
        void expect(Math.abs(width - tab.getBoundingClientRect().width)).toBeLessThan(1);
      });
    }
  },
};
