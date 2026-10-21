import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Callout } from './Callout.tsx';

const meta = {
  title: 'Molecules/Callout',
  component: Callout,
  args: { children: 'People are matched on email address. Rows without one are added as new people.' },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The four tones. */
export const Tones: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Callout title="How matching works">
        People are matched on email address. Rows without one are added as new people.
      </Callout>
      <Callout tone="success" title="Import finished">
        2,394 people imported, 6 updated.
      </Callout>
      <Callout tone="warning" title="3 rows were skipped" actions={<Button>Download skipped rows</Button>}>
        Their dates weren’t in one format. Fix them, then import those rows again.
      </Callout>
      <Callout tone="danger" title="The sync stopped">
        Gmail refused the connection. Reconnect the account to start syncing again.
      </Callout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('The sync stopped');
  },
};

/** One line inside a bar, at a control's height: it comes and goes without moving the view under it. */
export const InABar: Story = {
  render: () => (
    <Stage>
      <Callout placement="bar" isAnnounced>
        Live updates paused
      </Callout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const status = await canvas.findByRole('status', undefined, { timeout: 5_000 });
    await waitFor(() => expect(status).toHaveTextContent('Live updates paused'), { timeout: 5_000 });
  },
};

/** In a bar on a phone: a long line wraps under its first words rather than being cut short. */
export const InABarNarrow: Story = {
  render: () => (
    <Stage width="phone">
      <Callout placement="bar" tone="danger">
        Your workspace is already running 20 background changes. Wait for one to finish.
      </Callout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const note = canvas.getByRole('alert');
    await expect(note).toHaveTextContent('Wait for one to finish.');
    const text = note.querySelector<HTMLElement>('[class*="text"]');
    await expect(text).not.toBeNull();
    if (text === null) return;
    // Every word shows: nothing cut, and it takes a second line.
    await expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
    const line = Number.parseFloat(getComputedStyle(text).lineHeight);
    await expect(text.getBoundingClientRect().height).toBeGreaterThan(line * 1.5);
  },
};

/**
 * Full width under a view's bars, for a state of the whole view: square, a
 * hairline below, and announced politely as it appears.
 */
export const Banner: Story = {
  render: () => (
    <Stage direction="column">
      <Callout placement="banner" isAnnounced>
        Live updates are paused. Changes others make show here once the connection is back.
      </Callout>
      <Callout placement="banner" tone="warning" title="This view is read only">
        An admin limited who can edit People.
      </Callout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // Its words arrive a frame after it does, so the status region announces them. Firefox on a busy CI runner
    // took longer than the default second once, so the wait is longer.
    const status = await canvas.findByRole('status', undefined, { timeout: 5_000 });
    await waitFor(() => expect(status).toHaveTextContent('Live updates are paused'), { timeout: 5_000 });
  },
};
