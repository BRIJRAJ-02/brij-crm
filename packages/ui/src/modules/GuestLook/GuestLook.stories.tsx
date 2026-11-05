import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Modal, ModalTrigger } from '../../molecules/Modal/Modal.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
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
        <Field label="Full name" size="guest" />
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

/** A dialog opens inside the wrapper, so it wears the look too. */
export const Dialog: Story = {
  render: () => (
    <GuestLook>
      <Stage>
        <ModalTrigger defaultOpen>
          <Button>Change</Button>
          <Modal
            title="Change your reservation"
            variant="confirm"
            actions={
              <Button variant="primary" slot="close">
                Save change
              </Button>
            }
          >
            Your table moves to the new time.
          </Modal>
        </ModalTrigger>
      </Stage>
    </GuestLook>
  ),
  play: async ({ canvasElement }) => {
    const dialog = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (found === null) throw new Error('the modal did not open');
      return found;
    });
    await settleAnimations();
    await expect(canvasElement.contains(dialog)).toBe(true);
    const save = within(dialog).getByRole('button', { name: 'Save change' });
    await expect(getComputedStyle(save).backgroundColor).toBe('rgb(24, 25, 29)');
  },
};
