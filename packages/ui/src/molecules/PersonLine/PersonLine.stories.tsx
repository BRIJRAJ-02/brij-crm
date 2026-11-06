import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
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

/** A wrapped line (a booking request): its last part goes under the first rather than being cut. */
export const MetaWrapped: Story = {
  parameters: { crm: { screenshot: false } },
  args: { name: 'Grace Hopper', meta: ['Mon 9 Nov, 9:00', 'Expires Sun 8 Nov, 9:00'], isMetaWrapped: true },
  render: (args) => (
    <Stage width="narrow">
      <PersonLine {...args} size="sm" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Expires Sun 8 Nov/)).toBeInTheDocument();
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

/** A small blue square on our origin, as Avatar's Picture story draws. */
const PICTURE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"%3E%3Crect width="2" height="2" fill="%23266df0"/%3E%3C/svg%3E';

/**
 * A member's row in Settings › Members (5 November 2026): their own picture, the name, and "You" and their email as the
 * quiet line. The picture waits behind the initials until it has loaded, as Avatar's does.
 */
export const MemberRow: Story = {
  args: { name: 'Ada Lovelace', meta: ['You', 'ada@example.com'], src: PICTURE },
  render: (args) => (
    <Stage width="narrow">
      <PersonLine {...args} size="md" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (canvasElement.querySelector('img[data-fade="waiting"]') !== null) throw new Error('Still loading.');
    });
    await expect(canvasElement.querySelector('img')).not.toBeNull();
    await expect(within(canvasElement).getByText(/ada@example\.com/)).toBeVisible();
  },
};

/** `lg`: a list of people to read through (Settings › Members), the picture 32px beside the two lines. */
export const Large: Story = {
  render: () => (
    <Stage width="narrow">
      <PersonLine id="ada" name="Ada Lovelace" meta={['You', 'ada@example.com']} size="lg" />
    </Stage>
  ),
};

/** A staff member's own colour on the tile (spec 0066 B1): no photo yet, so the hue they chose. */
export const StaffColour: Story = {
  args: { id: 'asha', name: 'Asha Rao', meta: ['Senior stylist', 'Indiranagar'], size: 'md', hue: 'purple' },
};
