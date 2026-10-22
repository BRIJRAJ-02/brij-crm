import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { DescriptionList } from '../../molecules/DescriptionList/DescriptionList.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { MeetingCard, type MeetingCardRow } from './MeetingCard.tsx';

const meta = {
  title: 'Modules/MeetingCard',
  component: MeetingCard,
  args: { title: 'Grace Hopper · Intro call', when: 'Friday, October 23 · 9:00 – 9:30 AM' },
} satisfies Meta<typeof MeetingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const where: MeetingCardRow = { id: 'where', icon: 'video', label: 'Where', value: 'Google Meet' };

function Actions() {
  return (
    <>
      <ButtonLink
        variant="primary"
        icon="video"
        href="https://meet.google.com/abc-defg-hij"
        isExternal
        label="Join Google Meet"
      >
        Join
      </ButtonLink>
      <Button icon="calendar-clock">Reschedule</Button>
      <Button icon="link">Copy guest link</Button>
    </>
  );
}

/** An upcoming booking with a call: the title and time lead, the guest with their email, where, then the actions. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <MeetingCard
        {...args}
        status={{ label: 'Confirmed', hue: 'green' }}
        people={[
          {
            id: 'grace',
            name: 'Grace Hopper',
            href: '/people/grace',
            detail: 'grace@navy.mil',
            isDetailCopyable: true,
          },
        ]}
        rows={[where, { id: 'note', icon: 'message-square', label: 'Note', value: '“Can we talk about the pilot?”' }]}
        actions={<Actions />}
        endAction={<Button variant="ghost-danger" icon="circle-x" label="Cancel booking" />}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const card = canvas.getByRole('article', { name: 'Grace Hopper · Intro call' });
    await expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('Grace Hopper · Intro call');
    // Each row's icon is named for screen readers: the list pairs "Where" with "Google Meet".
    await expect(within(card).getByText('Where')).toBeInTheDocument();
    await expect(within(card).getByRole('button', { name: 'Copy grace@navy.mil' })).toBeInTheDocument();
    // No raw address: Join names the provider.
    await expect(within(card).queryByText(/meet\.google\.com/)).toBeNull();
    await expect(within(card).getByRole('link', { name: 'Join Google Meet' })).toBeInTheDocument();
    // The ending action sits apart, at the footer's end, after the rest.
    const cancel = within(card).getByRole('button', { name: 'Cancel booking' });
    const copy = within(card).getByRole('button', { name: 'Copy guest link' });
    await expect(cancel.getBoundingClientRect().left).toBeGreaterThan(copy.getBoundingClientRect().right);
  },
};

/** Cancelled: the status says so, the reason is a row, and nothing is left to do. */
export const Cancelled: Story = {
  render: (args) => (
    <Stage>
      <MeetingCard
        {...args}
        status={{ label: 'Canceled', hue: 'gray' }}
        people={[{ id: 'grace', name: 'Grace Hopper', detail: 'grace@navy.mil' }]}
        rows={[
          where,
          {
            id: 'reason',
            icon: 'circle-x',
            label: 'Reason',
            value: 'Travelling that week',
            detail: 'Canceled by the guest',
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Canceled')).toBeInTheDocument();
    await expect(canvas.queryByRole('contentinfo')).toBeNull();
  },
};

function ChatRow() {
  const [open, setOpen] = useState(false);
  return (
    <MeetingCard
      title="Grace Hopper · Intro call"
      when="Friday, October 23 · 9:00 – 9:30 AM"
      status={{ label: 'Confirmed', hue: 'green' }}
      people={[{ id: 'grace', name: 'Grace Hopper', detail: 'grace@navy.mil' }]}
      rows={[
        {
          id: 'booked',
          icon: 'bot',
          label: 'Booked',
          value: 'By chat on the booking page',
          action: (
            <Button variant="ghost" size="md" aria-expanded={open} aria-controls="chat" onPress={() => setOpen(!open)}>
              {open ? 'Hide chat' : 'View chat (3)'}
            </Button>
          ),
          children: open ? (
            <div id="chat">
              <DescriptionList
                layout="stacked"
                items={[
                  { id: '1', term: 'Visitor', description: 'Can I book a call on Friday?' },
                  { id: '2', term: 'Assistant', description: 'Friday at 9:00 works. Booked.' },
                ]}
              />
            </div>
          ) : undefined,
        },
      ]}
    />
  );
}

/** Booked by chat: one row, its transcript under it on View chat. */
export const BookedByChat: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <ChatRow />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'View chat (3)' }));
    await expect(canvas.getByText('Can I book a call on Friday?')).toBeInTheDocument();
  },
};

/** A long name and email, a notice, three people, and a meeting with no call: everything wraps or cuts inside. */
export const LongAndNoCall: Story = {
  render: (args) => (
    <Stage width="narrow">
      <MeetingCard
        {...args}
        title="Maximiliana Wolfeschlegelsteinhausenberger · Quarterly planning review"
        status={{ label: 'Needs a host', hue: 'orange' }}
        notices={<Callout tone="warning">Its host left. Reassign it to someone on the rotation.</Callout>}
        peopleLabel="People"
        people={[
          {
            id: 'max',
            name: 'Maximiliana Wolfeschlegelsteinhausenberger',
            detail: 'maximiliana.wolfeschlegelsteinhausenberger@example-enterprise.com',
            isDetailCopyable: true,
          },
          { id: 'sam', name: 'Sam Lee', detail: 'Host' },
          { id: 'ada', name: 'ada@example.com' },
        ]}
        rows={[{ id: 'where', icon: 'map-pin', label: 'Where', value: '221B Baker Street, London NW1 6XE' }]}
        actions={<Button icon="users-round">Reassign</Button>}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const card = canvas.getByRole('article');
    // Nothing runs past the card's edge.
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    await expect(canvasElement.querySelector('[class*="detail"]')).not.toBeNull();
  },
};
