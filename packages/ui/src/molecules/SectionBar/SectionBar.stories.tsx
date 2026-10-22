import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SectionBar } from './SectionBar.tsx';

const meta = {
  title: 'Molecules/SectionBar',
  component: SectionBar,
  args: {},
} satisfies Meta<typeof SectionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A week's bar: the heading, then previous, Today and next at the end. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <SectionBar
        title="19 – 25 October 2026"
        end={
          <>
            <Button variant="ghost" icon="chevron-left" label="Previous week" />
            <Button variant="primary">Today</Button>
            <Button variant="ghost" icon="chevron-right" label="Next week" />
          </>
        }
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: '19 – 25 October 2026' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  },
};

/** As a page's bar (My tasks): two switches that keep their own arrow keys, the second at the end. */
export const Bar: Story = {
  render: () => (
    <Stage>
      <SectionBar
        variant="bar"
        start={
          <SegmentedControl
            label="Whose tasks"
            segments={[
              { value: 'assigned', label: 'Assigned to me' },
              { value: 'created', label: 'Created by me' },
              { value: 'all', label: 'All tasks' },
            ]}
            defaultValue="assigned"
          />
        }
        end={
          <SegmentedControl
            label="Task status"
            segments={[
              { value: 'open', label: 'Open' },
              { value: 'done', label: 'Completed' },
            ]}
            defaultValue="open"
          />
        }
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const assigned = canvas.getByRole('radio', { name: 'Assigned to me' });
    await userEvent.click(assigned);
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'Created by me' })).toBeChecked();
    // The pointer leaves, so the picture never depends on whether Assigned to me still shows its hover.
    await userEvent.unhover(assigned);
  },
};

/** The Bookings week's bar: Today and the arrows, the dates quiet, the calendars `after` them, Filter at the end. */
export const WeekControls: Story = {
  render: () => (
    <Stage width="fill">
      <SectionBar
        variant="bar"
        isTitleQuiet
        start={
          <>
            <Button variant="secondary">Today</Button>
            <Button variant="ghost" icon="chevron-left" label="Previous week" />
            <Button variant="ghost" icon="chevron-right" label="Next week" />
          </>
        }
        title="19 – 25 October 2026"
        after={
          <SegmentedControl
            label="Calendars"
            size="compact"
            defaultValue="all"
            segments={[
              { value: 'all', label: 'All calendars' },
              { value: 'bookings', label: 'Bookings' },
              { value: 'work', label: 'Work', hue: 'green' },
            ]}
          />
        }
        end={
          <Button variant="ghost" icon="list-filter">
            Filter
          </Button>
        }
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const heading = canvas.getByRole('heading', { name: '19 – 25 October 2026' });
    const calendars = canvas.getByRole('radiogroup', { name: 'Calendars' });
    // The calendars come right after the dates, in reading order.
    await expect(heading.compareDocumentPosition(calendars) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

/** A heading with its quiet line (Home's greeting and today's date). */
export const WithDescription: Story = {
  render: () => (
    <Stage width="fill">
      <SectionBar title="Good afternoon, Ada" description="Thursday, 8 October" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Good afternoon, Ada' })).toBeInTheDocument();
    await expect(canvas.getByText('Thursday, 8 October')).toBeInTheDocument();
  },
};
