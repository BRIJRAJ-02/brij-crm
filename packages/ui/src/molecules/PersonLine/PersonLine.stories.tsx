import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PersonLine } from './PersonLine.tsx';

const meta = {
  title: 'Molecules/PersonLine',
  component: PersonLine,
  args: {
    id: '0193a1b2-0000-7000-8000-000000000001',
    name: 'Ada Lovelace',
    meta: ['2 booked', 'Head of sales'],
  },
} satisfies Meta<typeof PersonLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A column head's line: status first, then the job title. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage direction="column" width="narrow">
      <PersonLine {...args} size="sm" />
      <PersonLine {...args} size="md" meta={['38 h', 'UTC+5:30']} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('Ada Lovelace')).toHaveLength(2);
  },
};

/** Away: the first part in the Away colour, with a calendar chip and a view only mark at the end. */
export const AwayWithEnd: Story = {
  render: (args) => (
    <Stage width="narrow">
      <PersonLine
        {...args}
        size="sm"
        tone="away"
        meta={['Away', 'UTC+1', 'Solutions engineer with a very long title']}
        end={
          <>
            <Icon name="eye" size="sm" label="View only" />
            <Badge text="Reconnect" dot="red" isWhole />
          </>
        }
      />
    </Stage>
  ),
};

/** A calendar head's day: booked quiet, free in green, off quieter, one short line each, the title in the tooltip. */
export const DayTones: Story = {
  render: (args) => (
    <Stage direction="column" width="narrow">
      <PersonLine {...args} size="sm" meta={['3 booked']} hint="Ada Lovelace · Head of sales" />
      <PersonLine {...args} size="sm" tone="free" meta={['Free']} hint="Ada Lovelace · Head of sales" />
      <PersonLine {...args} size="sm" tone="off" meta={['Off']} hint="Ada Lovelace · Head of sales" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Free')).toBeVisible();
  },
};
