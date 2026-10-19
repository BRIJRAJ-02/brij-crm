import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { arraySource, type ListSource } from '../../lib/list-source.ts';
import { SAMPLE_STAGES } from '../../workbench/field-samples.ts';
import {
  ADA,
  GRACE,
  SAMPLE_ACTIVITY,
  SAMPLE_LINK_ACTIVITY,
  SAMPLE_MEETING_ACTIVITY,
  STAGE,
} from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { ActivityFeed, type ActivityEntry, type ActivityFeedLayout } from './ActivityFeed.tsx';

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
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  readonly onRangeChange?: (range: { start: number; end: number }) => void;
  readonly isLong?: boolean;
  readonly layout?: ActivityFeedLayout;
}

/** The feed in a fixed height slot, as the record page's Activity tab gives it; inline in a block of its own height. */
function SampleFeed({
  entries,
  status = 'ready',
  onRetry,
  onRangeChange,
  isLong = false,
  layout = 'feed',
}: SampleProps) {
  const source = isLong
    ? longSource(onRangeChange ?? (() => undefined))
    : (entries ?? arraySource(SAMPLE_ACTIVITY, (entry) => entry.id));
  const feed = (
    <ActivityFeed
      label={layout === 'inline' ? 'Recent activity' : 'Activity'}
      entries={source}
      layout={layout}
      status={status}
      {...(onRetry === undefined ? {} : { onRetry })}
    />
  );
  return layout === 'inline' ? <Stage width="narrow">{feed}</Stage> : <Stage height="grid">{feed}</Stage>;
}

/** Change entries made from their number, a minute apart, the newest first. */
function numbered(from: number, to: number): ActivityEntry[] {
  const start = Date.parse('2026-10-08T12:00:00.000Z');
  return Array.from({ length: to - from }, (_, offset) => {
    const n = to - 1 - offset;
    return {
      id: `n-${String(n)}`,
      kind: 'change',
      at: new Date(start + n * 60_000).toISOString(),
      actor: n % 2 === 0 ? ADA : GRACE,
      attribute: STAGE,
      from: SAMPLE_STAGES[n % 3]?.id ?? null,
      to: SAMPLE_STAGES[(n + 1) % 3]?.id ?? null,
    };
  });
}

/** A feed whose source gains newer entries above when "Add newer" is pressed, as a live refresh does. */
function GrowingFeed() {
  const [entries, setEntries] = useState(() => numbered(0, 60));
  return (
    <Stage direction="column">
      <Button
        onPress={() => {
          setEntries((held) => [...numbered(held.length, held.length + 5), ...held]);
        }}
      >
        Add newer
      </Button>
      <Stage height="grid">
        <ActivityFeed label="Activity" entries={arraySource(entries, (entry) => entry.id)} />
      </Stage>
    </Stage>
  );
}

/** The article the feed shows first, below its top edge, and where it sits. */
function firstOnScreen(feed: HTMLElement): { readonly index: number; readonly top: number } {
  const edge = feed.getBoundingClientRect().top;
  const shown = [...feed.querySelectorAll<HTMLElement>('[role="article"]')]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .find((article) => article.getBoundingClientRect().bottom > edge + 1);
  return { index: Number(shown?.dataset.index ?? -1), top: shown?.getBoundingClientRect().top ?? 0 };
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
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading activity')).toBeInTheDocument();
  },
};

/** The entries failed to load. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The viewer may not see this record's activity. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see this activity')).toBeInTheDocument();
  },
};

/** End lands on the oldest entry even while it is still loading, and the feed keeps its tab stop. */
export const FocusOnLoading: Story = {
  args: { isLong: true, onRangeChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-posinset', '10000'));
    await expect(document.activeElement).toHaveAttribute('aria-busy', 'true');
    await userEvent.tab({ shift: true });
    await userEvent.tab();
    await expect(document.activeElement).toHaveAttribute('aria-posinset', '10000');
    await expect(canvas.getByRole('feed')).toContainElement(document.activeElement as HTMLElement);
  },
};

/** Records linked and unlinked by one write: 3 names and "and 97 others", both ways in one entry, and a side that holds one record. */
export const Links: Story = {
  args: { entries: arraySource(SAMPLE_LINK_ACTIVITY, (entry) => entry.id) },
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const [many, oneMore, both, removed, moved, cleared] = canvas.getAllByRole('article');
    // A chip is its own box, so browsers may put a space before the comma after it.
    await expect(many).toHaveAccessibleName(
      /^Ada Lovelace added Jane Doe ?, Ada Lovelace ?, Alan Turing and 97 others to Team$/,
    );
    await expect(oneMore).toHaveAccessibleName(
      /^Grace Hopper added Annie Easley ?, Dorothy Vaughan ?, Mary Jackson and 1 other to Team$/,
    );
    await expect(both).toHaveAccessibleName(
      /^Grace Hopper added Katherine Johnson and Margaret Hamilton to Team ?, and removed Edsger Dijkstra from Team$/,
    );
    await expect(removed).toHaveAccessibleName('Lead routing removed Barbara Liskov from Team');
    await expect(moved).toHaveAccessibleName('Ada Lovelace changed Company');
    // A clear reads as the old value going to nothing, and the value and the time are read after the line.
    await expect(cleared).toHaveAccessibleName('Grace Hopper cleared Job title');
    await expect(cleared).toHaveAccessibleDescription(/Chief technology officer/);
    // Each name links to its record, and a record with no page names it with no link.
    await expect(canvas.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute(
      'href',
      '/records/0199a3c0-0000-7000-8000-00000000c101',
    );
    await expect(canvas.queryByRole('link', { name: 'Barbara Liskov' })).toBeNull();
  },
};

/**
 * Meetings (spec 0024) under Upcoming and their own day: the time in the
 * provider's zone, who comes with each answer that isn't yes, the video
 * link, an all day meeting's days, and a private one with its time only.
 */
export const Meetings: Story = {
  args: { entries: arraySource(SAMPLE_MEETING_ACTIVITY, (entry) => entry.id) },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
    const [renewal, offsite, hidden] = canvas.getAllByRole('article');
    await expect(renewal).toHaveAccessibleName('Meeting: Renewal review with Northwind');
    await expect(renewal).toHaveAccessibleDescription(/Tue, Oct 13, 10:00 – 10:45 AM/);
    await expect(renewal).toHaveAccessibleDescription(/maybe/);
    await expect(renewal).toHaveAccessibleDescription(/no reply/);
    await expect(renewal).toHaveAccessibleDescription(/ops@northwind\.com declined/);
    await expect(canvas.getByRole('link', { name: 'Join video call' })).toHaveAttribute(
      'href',
      'https://meet.google.com/abc-defg-hij',
    );
    await expect(canvas.getAllByRole('link', { name: 'Jane Doe' })[0]).toHaveAttribute('href', '/records/jane');
    await expect(offsite).toHaveAccessibleDescription(/Mon, Oct 12 – Tue, Oct 13/);
    await expect(hidden).toHaveAccessibleName('Meeting: Private meeting');
    await expect(hidden).not.toHaveAccessibleDescription(/Join/);
  },
};

/** Tab moves from the entry into its linked names, and on out of the feed. */
export const LinksKeyboard: Story = {
  args: { entries: arraySource(SAMPLE_LINK_ACTIVITY, (entry) => entry.id) },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getAllByRole('article')[0]).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Jane Doe' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getAllByRole('link', { name: 'Ada Lovelace' })[0]).toHaveFocus();
  },
};

/** Inline, as Overview's "Recent activity": the first entries drawn in place, with no scroll of their own. */
export const Inline: Story = {
  args: { layout: 'inline', entries: arraySource(SAMPLE_ACTIVITY.slice(0, 5), (entry) => entry.id) },
  play: async ({ canvas }) => {
    const feed = canvas.getByRole('feed', { name: 'Recent activity' });
    await expect(canvas.getAllByRole('article')).toHaveLength(5);
    await expect(feed.scrollHeight).toBe(feed.clientHeight);
  },
};

/** Inline draws at most 10 entries, however many it is given, and End goes to the tenth. */
export const InlineCapped: Story = {
  args: { layout: 'inline', entries: arraySource(numbered(0, 30), (entry) => entry.id) },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getAllByRole('article')).toHaveLength(10);
    await userEvent.tab();
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-posinset', '10'));
  },
};

/** Inline, while the first page is still coming. */
export const InlineLoading: Story = {
  args: { layout: 'inline', status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading activity')).toBeInTheDocument();
  },
};

/** Newer entries arriving above keep the entry being read where it is on screen, and the tab stop on it. */
export const KeepsReading: Story = {
  render: () => <GrowingFeed />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const feed = canvas.getByRole('feed');
    feed.scrollTop = 900;
    // As a person's scroll does (headless WebKit can hold the event back past the next steps).
    feed.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(firstOnScreen(feed).index).toBeGreaterThan(3));
    const before = firstOnScreen(feed);
    await userEvent.click(canvas.getByRole('button', { name: 'Add newer' }));
    await waitFor(() => expect(canvas.getAllByRole('article')[0]).toHaveAttribute('aria-setsize', '65'));
    await waitFor(async () => {
      const after = firstOnScreen(feed);
      await expect(after.index).toBe(before.index + 5);
      await expect(Math.abs(after.top - before.top)).toBeLessThan(2);
    });
  },
};

/** At the top, newer entries arriving show at the top. */
export const NewerAtTop: Story = {
  render: () => <GrowingFeed />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const feed = canvas.getByRole('feed');
    await userEvent.click(canvas.getByRole('button', { name: 'Add newer' }));
    await waitFor(() => expect(canvas.getAllByRole('article')[0]).toHaveAttribute('aria-setsize', '65'));
    await expect(feed.scrollTop).toBe(0);
    await expect(firstOnScreen(feed).index).toBe(0);
  },
};

/** Ctrl with Home or End leaves the feed for what comes before or after it, past every linked name. */
export const LeaveByKeyboard: Story = {
  render: () => <GrowingFeed />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Add newer' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getAllByRole('article')[0]).toHaveFocus();
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    await expect(canvas.getByRole('button', { name: 'Add newer' })).toHaveFocus();
  },
};

/** A record a form made (spec 0023): the form is the actor, named, on its creation and on the submission. */
export const FromAForm: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => {
    const form = { type: 'form' as const, id: '0199f0a0-0000-7000-8000-0000000000f1', name: 'Contact us' };
    const entries: ActivityEntry[] = [
      {
        id: 'submission',
        at: '2026-10-08T12:00:00.000Z',
        actor: form,
        kind: 'submission',
        action: 'created',
        href: '#submission',
      },
      { id: 'created', at: '2026-10-08T12:00:00.000Z', actor: form, kind: 'created' },
    ];
    return (
      <Stage height="page">
        <ActivityFeed label="Activity" entries={arraySource(entries, (entry) => entry.id)} />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const [submission, created] = canvas.getAllByRole('article');
    await expect(submission).toHaveAccessibleName(/Contact us created this record from a submission/);
    await expect(created).toHaveAccessibleName(/Contact us created this record/);
  },
};
