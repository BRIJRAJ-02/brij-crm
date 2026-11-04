import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Callout } from './Callout.tsx';

const meta = {
  title: 'Molecules/Callout',
  component: Callout,
  args: { tone: 'info', children: 'Showing the first 12.' },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The four tones. Info is a quiet grey line for a passing state (no fill, no edge); success confirms a result;
 * warning and danger are boxed in their colour because someone must act.
 */
export const Tones: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Callout tone="info">Showing the first 12. Narrow the filter to see the rest.</Callout>
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
    // Info draws no box: its background and edge are clear, so it reads as a line of text, not a banner.
    const info = canvas.getByText(/Showing the first 12/).closest<HTMLElement>('[data-tone]');
    await expect(info).not.toBeNull();
    if (info === null) return;
    const style = getComputedStyle(info);
    await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await expect(style.borderTopColor).toBe('rgba(0, 0, 0, 0)');
  },
};

/** One line inside a bar, at a control's height: it comes and goes without moving the view under it. */
export const InABar: Story = {
  render: () => (
    <Stage>
      <Callout tone="info" placement="bar" isAnnounced>
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
    // In a bar no tone draws a fill, so it never reads as a button beside the bar's buttons.
    await expect(getComputedStyle(note).backgroundColor).toBe('rgba(0, 0, 0, 0)');
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
      <Callout tone="info" placement="banner" isAnnounced>
        Live updates are paused. Changes others make show here once the connection is back.
      </Callout>
      <Callout
        placement="banner"
        tone="warning"
        title="This view uses an archived field"
        actions={<Button>Restore it</Button>}
      >
        Stage is archived, so the board can’t group by it.
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
