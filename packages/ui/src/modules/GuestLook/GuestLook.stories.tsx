import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
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
    await expect(getComputedStyle(button).backgroundColor).toBe('rgb(24, 24, 27)');
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
    await expect(getComputedStyle(save).backgroundColor).toBe('rgb(24, 24, 27)');
  },
};

/** A brand's look, as its stylesheet sets it on the page's root: the accent and the words on it. */
const BRAND_LOOK = [
  ['--menu-accent', '#0f766e'],
  ['--menu-on-accent', '#ffffff'],
] as const;

/** Sets the look on a wrapper, as the look stylesheet sets it on the page's root. */
function BrandLook({ children }: { readonly children: ReactNode }) {
  return (
    <div
      ref={(element) => {
        for (const [name, value] of BRAND_LOOK) element?.style.setProperty(name, value);
      }}
    >
      {children}
    </div>
  );
}

/** A look linked: the primary wears the page's accent (decision 16), and keyboard focus takes the outline ring in it. */
export const BrandAccent: Story = {
  render: () => (
    <BrandLook>
      <GuestLook>
        <Stage direction="column" width="narrow">
          <Button variant="primary" size="touch">
            Reserve
          </Button>
        </Stage>
      </GuestLook>
    </BrandLook>
  ),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Reserve' });
    await expect(getComputedStyle(button).backgroundColor).toBe('rgb(15, 118, 110)');
    await expect(getComputedStyle(button).color).toBe('rgb(255, 255, 255)');
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await expect(button).toHaveAttribute('data-focus-visible');
    await expect(getComputedStyle(button).outlineColor).toBe('rgb(15, 118, 110)');
  },
};
