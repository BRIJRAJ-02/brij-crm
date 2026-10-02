import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { arraySource, type ListSource } from '../../lib/list-source.ts';
import { SAMPLE_STAGES } from '../../workbench/field-samples.ts';
import { ADA, GRACE, SAMPLE_ACTIVITY, STAGE } from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ActivityFeed, type ActivityEntry } from './ActivityFeed.tsx';

/** 10,000 entries, each made from its index, with every tenth one still loading. */
function longSource(onRangeChange: (range: { start: number; end: number }) => void): ListSource<ActivityEntry> {
  const start = Date.parse('2026-10-08T13:00:00.000Z');
  return {
    count: 10_000,
    getItem: (index) =>
      index % 10 === 9
        ? undefined
        : {
            id: `long-${String(index)}`,
            kind: 'change',
            at: new Date(start - index * 3_600_000).toISOString(),
            actor: index % 2 === 0 ? ADA : GRACE,
            attribute: STAGE,
            from: SAMPLE_STAGES[index % 3]?.id ?? null,
            to: SAMPLE_STAGES[(index + 1) % 3]?.id ?? null,
          },
    getKey: (entry) => entry.id,
    onRangeChange,
  };
}

interface SampleProps {
  readonly entries?: ListSource<ActivityEntry>;
  readonly isLoading?: boolean;
  readonly onRetry?: () => void;
  readonly onRangeChange?: (range: { start: number; end: number }) => void;
  readonly isLong?: boolean;
}

/** The feed in a fixed height slot, as the record page's Activity tab gives it. */
function SampleFeed({ entries, isLoading = false, onRetry, onRangeChange, isLong = false }: SampleProps) {
  const source = isLong
    ? longSource(onRangeChange ?? (() => undefined))
    : (entries ?? arraySource(SAMPLE_ACTIVITY, (entry) => entry.id));
  return (
    <Stage height="grid">
      <ActivityFeed
        label="Activity"
        entries={source}
        isLoading={isLoading}
        {...(onRetry === undefined ? {} : { onRetry })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/ActivityFeed',
  component: SampleFeed,
} satisfies Meta<typeof SampleFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Changes, notes, tasks, emails and meetings, newest first, under period headings. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('feed', { name: 'Activity' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'Earlier this week' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'September' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('article')[0]).toHaveAccessibleName(/Ada Lovelace changed Stage/);
  },
};

/** One tab stop: the arrows and Page Down move between entries, End goes to the oldest. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const articles = canvas.getAllByRole('article');
    await expect(articles[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(articles[1]).toHaveFocus();
    await userEvent.keyboard('{PageDown}');
    await expect(articles[2]).toHaveFocus();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/created this record/));
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(canvas.getAllByRole('article')[0]).toHaveFocus());
  },
};

/** 10,000 entries draw only those on screen; the ones still loading are skeletons, and the source hears which range to load. */
export const LongFeed: Story = {
  args: { isLong: true, onRangeChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, canvasElement }) => {
    const feed = canvas.getByRole('feed');
    await waitFor(() => expect(args.onRangeChange).toHaveBeenCalled());
    await expect(canvasElement.querySelectorAll('[data-index]').length).toBeLessThan(40);
    feed.scrollTop = 200_000;
    await waitFor(() => {
      const calls = (args.onRangeChange as ReturnType<typeof fn>).mock.calls;
      const range = calls.at(-1)?.[0] as { readonly start: number } | undefined;
      return expect(range?.start).toBeGreaterThan(1000);
    });
    await expect(canvasElement.querySelectorAll('[data-index]').length).toBeLessThan(40);
  },
};

/** Nothing has happened yet. */
export const Empty: Story = {
  args: { entries: arraySource<ActivityEntry>([], (entry) => entry.id) },
};

/** The first page is still coming. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading activity')).toBeInTheDocument();
  },
};

/** The entries failed to load. */
export const Failed: Story = {
  args: { onRetry: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
