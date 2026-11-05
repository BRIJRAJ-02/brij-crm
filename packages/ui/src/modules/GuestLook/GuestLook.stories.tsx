import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { GuestLook } from './GuestLook.tsx';

const meta = {
  title: 'Modules/GuestLook',
  component: GuestLook,
  args: { children: null },
} satisfies Meta<typeof GuestLook>;

export default meta;
type Story = StoryObj<typeof meta>;

/** With no look stylesheet linked: a primary in the ink, never the app's blue. */
export const TokenFallbacks: Story = {
  render: () => (
    <GuestLook>
      <Stage direction="column" width="narrow">
        <Field label="Full name" size="lg" />
        <Button variant="primary" size="touch">
          Continue
        </Button>
      </Stage>
    </GuestLook>
  ),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Continue' });
    await expect(getComputedStyle(button).backgroundColor).toBe('rgb(24, 25, 29)');
  },
};
