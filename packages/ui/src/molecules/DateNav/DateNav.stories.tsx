import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SectionBar } from '../SectionBar/SectionBar.tsx';
import { DateNav, weekRangeLabel } from './DateNav.tsx';

const noop = () => undefined;

const meta = {
  title: 'Molecules/DateNav',
  component: DateNav,
  args: {
    today: { label: 'Today', hint: 'Go to today', onPress: noop, kbd: 'T' },
    previous: { label: 'Previous week', onPress: noop, kbd: 'K' },
    next: { label: 'Next week', onPress: noop, kbd: 'J' },
  },
} satisfies Meta<typeof DateNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Calendar's bar: Today, the arrows with their keys, Go to date, and the week's dates as the title. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <SectionBar
        variant="bar"
        start={<DateNav {...args} jump={{ label: 'Go to date', isExpanded: false, onPress: noop }} />}
        title={weekRangeLabel('2026-10-05', 'en-GB')}
        isTitleQuiet
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Today' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Next week' })).toHaveAttribute('aria-keyshortcuts', 'J');
    await expect(canvas.getByRole('heading', { name: '5 – 11 October 2026' })).toBeInTheDocument();
  },
};

/** The Roster at its first week: previous is off, with no keys and no month. */
export const AtTheStart: Story = {
  args: {
    today: { label: 'Today', hint: 'Go to this week', onPress: noop },
    previous: { label: 'Previous week', onPress: noop, isDisabled: true },
    next: { label: 'Next week', onPress: noop },
  },
  render: (args) => (
    <Stage>
      <SectionBar
        variant="bar"
        start={<DateNav {...args} />}
        title={weekRangeLabel('2026-12-28', 'en-GB')}
        isTitleQuiet
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Previous week' })).toBeDisabled();
    await expect(canvas.getByRole('heading', { name: /28 Dec 2026/ })).toBeInTheDocument();
  },
};
