import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
import { hoverFresh, shownTooltip as tooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Tooltip } from './Tooltip.tsx';

const meta = {
  title: 'Atoms/Tooltip',
  component: Tooltip,
  args: { content: 'Archive record', children: <Button icon="archive" label="Archive" /> },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** For a pointer, it waits half a second before it opens, so moving across a table flashes nothing. First in the file, so no earlier tooltip has warmed it up. */
export const OnHover: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <Tooltip {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await hoverFresh(userEvent, canvas.getByRole('button', { name: 'Archive' }));
    const hovered = performance.now();
    await expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await tooltip();
    const waited = performance.now() - hovered;
    // About 500 ms: not at once, and well short of React Aria's 1.5 s default.
    await expect(waited).toBeGreaterThanOrEqual(400);
    await expect(waited).toBeLessThan(1400);
  },
};

/** Keyboard focus shows it at once, and it describes the button. Esc hides it. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <Tooltip {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Archive' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    const tip = await tooltip();
    await expect(tip).toHaveTextContent('Archive record');
    await expect(button).toHaveAccessibleDescription('Archive record');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  },
};

/** Plain text that was cut short shows its full text on hover. */
export const OnText: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Tooltip content="Strategic partnership renewal for the EMEA region" isTextTrigger>
        <span>Strategic partnership…</span>
      </Tooltip>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    // Text adds no tab stop: its trigger focuses on purpose only.
    await expect(canvas.getByText('Strategic partnership…').parentElement).toHaveAttribute('tabindex', '-1');
    await hoverFresh(userEvent, canvas.getByText('Strategic partnership…'));
    const tip = await tooltip();
    await expect(tip).toHaveTextContent('EMEA region');
  },
};
