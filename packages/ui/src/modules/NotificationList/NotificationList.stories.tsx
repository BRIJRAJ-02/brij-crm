import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { arraySource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { SAMPLE_COMPANIES, SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { NotificationList, type NotificationItem, type NotificationMark } from './NotificationList.tsx';

const [ADA, GRACE, ALAN] = SAMPLE_MEMBERS;

/** An inbox: a mention, a reply and a task, the first two unread. */
function sampleItems(): readonly NotificationItem[] {
  return [
    {
      id: 'n1',
      kind: 'mention',
      actor: ADA ?? { type: 'system', id: null, name: 'System' },
      createdAt: '2026-10-08T14:20:00.000Z',
      isRead: false,
      isDone: false,
      ...(SAMPLE_COMPANIES[0] === undefined ? {} : { record: SAMPLE_COMPANIES[0] }),
      excerpt: `Can you check the renewal numbers, <@${GRACE?.id ?? ''}>?`,
    },
    {
      id: 'n2',
      kind: 'reply',
      actor: ALAN ?? { type: 'system', id: null, name: 'System' },
      createdAt: '2026-10-08T12:00:00.000Z',
      isRead: false,
      isDone: false,
      ...(SAMPLE_COMPANIES[1] === undefined ? {} : { record: SAMPLE_COMPANIES[1] }),
      excerpt: 'Agreed. I will send the draft tonight.',
    },
    {
      id: 'n3',
      kind: 'task_assigned',
      actor: ADA ?? { type: 'system', id: null, name: 'System' },
      createdAt: '2026-10-07T09:00:00.000Z',
      isRead: true,
      isDone: false,
      excerpt: 'Call Globex about the security review',
    },
  ];
}

interface SampleProps {
  readonly status?: LoadStatus;
  readonly isEmpty?: boolean;
  readonly onAction?: (id: string) => void;
  readonly onMark?: (id: string, mark: NotificationMark) => void;
  readonly onRetry?: () => void;
  readonly isFiltered?: boolean;
}

/** The inbox in a fixed height slot, marking rows as the screen would. */
function SampleInbox({ status, isEmpty = false, onAction = () => undefined, onMark, onRetry, isFiltered = false }: SampleProps) {
  const [items, setItems] = useState(isEmpty ? [] : sampleItems());
  const source = arraySource(items, (item) => item.id);
  return (
    <Stage height="grid">
      <NotificationList
        label="Inbox"
        items={source}
        members={SAMPLE_MEMBERS}
        formerMember="Former member"
        onAction={onAction}
        onMark={(id, mark) => {
          onMark?.(id, mark);
          setItems((held) =>
            held.map((item) =>
              item.id === id
                ? { ...item, ...(mark.read === undefined ? {} : { isRead: mark.read }), ...(mark.done === undefined ? {} : { isDone: mark.done }) }
                : item,
            ),
          );
        }}
        {...(status === undefined ? {} : { status })}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(isFiltered
          ? { emptyTitle: 'No notifications match.', emptyIcon: 'list-filter' as const, emptyActions: <Button>Clear filters</Button> }
          : {})}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/NotificationList',
  component: SampleInbox,
} satisfies Meta<typeof SampleInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Unread rows with the dot and a bolder sentence, the record's chip, the excerpt with a mention by name. */
export const Default: Story = {
  args: { onAction: fn() },
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('grid', { name: 'Inbox' })).toBeInTheDocument();
    await expect(canvas.getByText('Ada Lovelace mentioned you')).toBeInTheDocument();
    await expect(canvas.getByText('@Grace Hopper')).toBeInTheDocument();
    await userEvent.click(canvas.getByText('Alan Turing replied in a thread'));
    await expect(args.onAction).toHaveBeenCalledWith('n2');
  },
};

/** U and E on a focused row: read, then done. */
export const Keyboard: Story = {
  args: { onMark: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await waitFor(() => expect(canvas.getAllByRole('row')[0]).toHaveFocus());
    await userEvent.keyboard('u');
    await expect(args.onMark).toHaveBeenCalledWith('n1', { read: true });
    await userEvent.keyboard('e');
    await expect(args.onMark).toHaveBeenCalledWith('n1', { done: true });
  },
};

/** The row's menu: Mark as read and Mark done, with their keys. */
export const RowMenu: Story = {
  args: { onMark: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: 'More actions' })[0] as HTMLElement);
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Mark done/ }));
    await expect(args.onMark).toHaveBeenCalledWith('n1', { done: true });
  },
};

/** Still loading: skeleton rows after the delay. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading notifications')).toBeInTheDocument();
  },
};

/** All caught up. */
export const Empty: Story = {
  args: { isEmpty: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You’re all caught up.')).toBeInTheDocument();
  },
};

/** A filter matches nothing: Clear filters. */
export const NoMatches: Story = {
  args: { isEmpty: true, isFiltered: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No notifications match.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  },
};

/** The inbox failed to load. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
