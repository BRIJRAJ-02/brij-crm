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
