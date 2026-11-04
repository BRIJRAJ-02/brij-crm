import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { Button } from '../Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TextSwap } from './TextSwap.tsx';

/** Swapping's own component: the artifact's preview calls a story's render directly, so its hooks live here. */
function SwappingDemo() {
  const [done, setDone] = useState(false);
  return (
    <Stage>
      <TextSwap>{done ? 'Published' : 'Publish'}</TextSwap>
      <Button onPress={() => setDone((was) => !was)}>Swap</Button>
    </Stage>
  );
}

const meta = {
  title: 'Atoms/TextSwap',
  component: TextSwap,
  args: { children: 'Publish' },
} satisfies Meta<typeof TextSwap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first words are simply there. */
export const Still: Story = {};

/** Publish turns into Published: the old words rise out, the new ones rise in. */
export const Swapping: Story = {
  parameters: { crm: { preview: true } },
  render: () => <SwappingDemo />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Swap' }));
    await expect(canvas.getByText('Published')).toBeInTheDocument();
  },
};

/** In a Button (`animateLabel`), its width held by `labelReserve`, so the bar around it never moves. */
export const InAButton: Story = {
  render: function InAButton() {
    const [done, setDone] = useState(false);
    return (
      <Stage>
        <Button variant="primary" animateLabel labelReserve="Published" onPress={() => setDone((was) => !was)}>
          {done ? 'Published' : 'Publish'}
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Publish' }));
    await expect(canvas.getByRole('button', { name: 'Published' })).toBeInTheDocument();
  },
};
