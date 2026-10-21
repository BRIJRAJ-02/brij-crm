import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { attributeOf } from '../../workbench/attributes.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';

const VALUE = attributeOf('currency', 'Value');
import { RecordStats, type RecordStat } from './RecordStats.tsx';

interface SampleProps {
  readonly state?: 'shown' | 'loading' | 'none';
  readonly width?: 'auto' | 'narrow';
  readonly onOpen?: (id: string) => void;
}

/** A company's stats: open tasks and notes (each opening its tab), comments, and the last activity. */
function SampleStats({ state = 'shown', width = 'auto', onOpen }: SampleProps) {
  const isLoading = state === 'loading';
  const isNone = state === 'none';
  const open = (id: string) => () => {
    onOpen?.(id);
  };
  const stats: readonly RecordStat[] = [
    {
      id: 'tasks',
      label: 'Open tasks',
      icon: 'list-checks',
      ...(isNone ? {} : { count: 3 }),
      isLoading,
      onPress: open('tasks'),
    },
    { id: 'notes', label: 'Notes', icon: 'notebook', count: 12_400, isCountAtLeast: true, isLoading },
    {
      id: 'value',
      label: 'Value',
      icon: 'banknote',
      ...(isNone
        ? {}
        : {
            value: (
              <AttributeDisplay
                attribute={VALUE}
                value={{ amount: '48000', currency: 'USD' } as never}
                surface="panel"
              />
            ),
          }),
      isLoading,
    },
    {
      id: 'activity',
      label: 'Last activity',
      icon: 'activity',
      ...(isNone ? {} : { time: '2026-10-08T11:30:00.000Z' }),
      isLoading,
      onPress: open('activity'),
    },
  ];
  return (
    <Stage width={width}>
      <RecordStats label="About Northwind Traders" stats={stats} />
    </Stage>
  );
}

const meta = {
  title: 'Molecules/RecordStats',
  component: SampleStats,
} satisfies Meta<typeof SampleStats>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A count, a floor ("12,400+"), a value through its field's display, and the last activity; Open tasks and Last activity go somewhere. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const strip = canvas.getByRole('group', { name: 'About Northwind Traders' });
    await expect(within(strip).getByText('12,400+')).toBeInTheDocument();
    await expect(within(strip).getByRole('button', { name: 'Open tasks' })).toHaveAccessibleDescription('3');
  },
};

/** Still coming: a skeleton in place of each value, the labels already in place. */
export const Loading: Story = {
  args: { state: 'loading' },
  play: async ({ canvas }) => {
    const values = canvas.getAllByRole('definition');
    await expect(values.every((value) => value.getAttribute('aria-busy') === 'true')).toBe(true);
  },
};

/** No values yet: "None", muted. */
export const None: Story = {
  args: { state: 'none' },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('None')).toHaveLength(3);
  },
};

/** A tile that goes somewhere is pressed from the keyboard too. */
export const Pressed: Story = {
  args: { onOpen: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Last activity' }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onOpen).toHaveBeenCalledWith('activity');
  },
};

/** In a narrow slot: two stats to a row. */
export const Narrow: Story = {
  args: { width: 'narrow' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'About Northwind Traders' })).toBeInTheDocument();
  },
};
