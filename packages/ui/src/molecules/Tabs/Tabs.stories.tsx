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

/** With no inset (a settings page): the first tab's label at the table's first column, the tools at its edge. */
export const NoInset: Story = {
  args: { inset: 'none' },
  render: (args) => (
    <Tabs {...args} end={<Field label="Search members" isLabelHidden variant="search" type="search" size="sm" />}>
      <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
      <TabPanel id="notes">12 notes.</TabPanel>
      <TabPanel id="tasks">3 open tasks.</TabPanel>
      <TabPanel id="files">No files.</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Record' })).toBeInTheDocument();
  },
};

/** No inset on a phone: a lone search wraps under the tabs, and every tab stays in sight. */
export const NoInsetNarrow: Story = {
  args: { inset: 'none' },
  render: (args) => (
    <Stage width="narrow">
      <Tabs {...args} end={<Field label="Search members" isLabelHidden variant="search" type="search" size="sm" />}>
        <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
        <TabPanel id="notes">12 notes.</TabPanel>
        <TabPanel id="tasks">3 open tasks.</TabPanel>
        <TabPanel id="files">No files.</TabPanel>
      </Tabs>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const list = canvas.getByRole('tablist', { name: 'Record' }).getBoundingClientRect();
    const search = canvas.getByRole('searchbox', { name: 'Search members' }).getBoundingClientRect();
    await expect(search.top).toBeGreaterThanOrEqual(list.bottom - 1);
  },
};

/** More tabs than a phone's width: the end fades, so the row shows it scrolls; scrolled to the end, the start fades. */
export const Overflowing: Story = {
  args: {
    tabs: [
      { id: 'overview', label: 'Overview', icon: 'layout-grid' },
      { id: 'activity', label: 'Activity', icon: 'activity' },
      { id: 'notes', label: 'Notes', icon: 'notebook', count: 12 },
      { id: 'tasks', label: 'Tasks', icon: 'list-checks', count: 3 },
      { id: 'comments', label: 'Comments', icon: 'message-square' },
    ],
    defaultSelectedKey: 'overview',
  },
  render: (args) => (
    <Stage width="narrow">
      <Tabs {...args}>
        <TabPanel id="overview">The record at a glance.</TabPanel>
        <TabPanel id="activity">Field changes, newest first.</TabPanel>
        <TabPanel id="notes">12 notes.</TabPanel>
        <TabPanel id="tasks">3 open tasks.</TabPanel>
        <TabPanel id="comments">No comments yet.</TabPanel>
      </Tabs>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const list = canvas.getByRole('tablist', { name: 'Record' });
    await waitFor(() => expect(list).toHaveAttribute('data-fade', 'end'));
    list.scrollLeft = list.scrollWidth;
    await waitFor(() => expect(list).toHaveAttribute('data-fade', 'start'));
  },
};

/**
 * As a page's second bar (Captures, Bookings): the row People's ViewBar takes, size-bar tall on the surface,
 * the tab's tools at its end, the underline on its hairline.
 */
export const Bar: Story = {
  render: (args) => (
    <Tabs
      {...args}
      variant="bar"
      end={<Field label="Search booking pages" isLabelHidden variant="search" type="search" size="sm" />}
    >
      <TabPanel id="activity">Field changes, notes and emails, newest first.</TabPanel>
      <TabPanel id="notes">12 notes.</TabPanel>
      <TabPanel id="tasks">3 open tasks.</TabPanel>
      <TabPanel id="files">No files.</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    const list = canvas.getByRole('tablist', { name: 'Record' });
    const bar = list.parentElement;
    const barHeight = getComputedStyle(document.documentElement).getPropertyValue('--size-bar').trim();
    await expect(bar?.getBoundingClientRect().height).toBe(Number.parseFloat(barHeight));
    // The chosen tab fills the bar down to its hairline, so its underline sits on it.
    const tab = canvas.getByRole('tab', { name: /Activity/ });
    await expect(Math.round(tab.getBoundingClientRect().bottom)).toBe(
      Math.round((bar?.getBoundingClientRect().bottom ?? 0) - 1),
    );
    await expect(canvas.getByRole('searchbox', { name: 'Search booking pages' })).toBeInTheDocument();
  },
};

/** On a phone: the tools take a row of their own under the tabs, and the search narrows to fit. */
/** `feature`: a product's areas on its home page, equal columns with a tile, a label and a line each, the line on top. */
export const Feature: Story = {
  render: () => (
    <Tabs
      label="What Timefix does"
      variant="feature"
      defaultSelectedKey="crm"
      tabs={[
        { id: 'crm', label: 'CRM', description: 'People, companies and deals.', icon: 'users', hue: 'green' },
        {
          id: 'booking',
          label: 'Booking pages',
          description: 'Your address. They pick a time.',
          icon: 'calendar-check',
          hue: 'sky',
        },
        {
          id: 'forms',
          label: 'Forms',
          description: 'Capture leads, send them to a booking.',
          icon: 'clipboard-list',
          hue: 'orange',
        },
        {
          id: 'calendar',
          label: 'Calendar',
          description: 'Every meeting beside your own.',
          icon: 'calendar-days',
          hue: 'blue',
        },
      ]}
    >
      <TabPanel id="crm">The People table.</TabPanel>
      <TabPanel id="booking">A booking page.</TabPanel>
      <TabPanel id="forms">The form editor.</TabPanel>
      <TabPanel id="calendar">The Bookings week.</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    const tabs = canvas.getAllByRole('tab');
    await expect(tabs).toHaveLength(4);
    // Equal columns across the width.
    const widths = tabs.map((tab) => Math.round(tab.getBoundingClientRect().width));
    await expect(new Set(widths).size).toBe(1);
    await expect(canvas.getByRole('tab', { name: /Forms/ })).toHaveTextContent('Capture leads');
  },
};

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

/**
 * A tab whose fields hold an error carries a small danger dot, named to screen readers; a `fields` panel stacks its
 * fields with no Card around them (the booking page editor).
 */
export const WithAlert: Story = {
  args: {
    label: 'Booking page',
    inset: 'none',
    tabs: [
      { id: 'page', label: 'Page' },
      { id: 'meeting', label: 'Meeting', alert: 'needs a fix' },
      { id: 'hours', label: 'Hours' },
      { id: 'limits', label: 'Limits' },
    ],
    defaultSelectedKey: 'page',
  },
  render: (args) => (
    <Tabs {...args}>
      <TabPanel id="page" variant="fields">
        <Field label="Description" value="A short call to see if we fit." />
        <Field label="Public link" value="https://timefix.app/b/ada" />
      </TabPanel>
      <TabPanel id="meeting" variant="fields">
        <Field label="Title" value="" error="Give it a title" />
      </TabPanel>
      <TabPanel id="hours" variant="fields">
        Weekdays, 9 am to 5 pm.
      </TabPanel>
      <TabPanel id="limits" variant="fields">
        No limits.
      </TabPanel>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tab', { name: /Meeting.*needs a fix/ })).toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
  },
};
