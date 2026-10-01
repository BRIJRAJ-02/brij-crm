import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { hoverFresh } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TruncatedText } from './TruncatedText.tsx';

const meta = {
  title: 'Atoms/TruncatedText',
  component: TruncatedText,
  args: { children: 'Northwind Traders' },
} satisfies Meta<typeof TruncatedText>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text that fits: no tooltip. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <TruncatedText {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await hoverFresh(userEvent, canvas.getByText('Northwind Traders'));
    await expect(document.querySelector('[role="tooltip"]')).toBeNull();
  },
};

/** Cut text shows the whole of it on hover. */
export const Cut: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="narrow">
      <TruncatedText>International Business Logistics and Freight Forwarding Limited</TruncatedText>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await hoverFresh(userEvent, canvas.getByText(/International Business/));
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).toHaveTextContent('Forwarding Limited'));
  },
};
