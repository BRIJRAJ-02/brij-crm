import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SpotIllustration } from './SpotIllustration.tsx';

const meta = {
  title: 'Molecules/SpotIllustration',
  component: SpotIllustration,
  args: { kind: 'booking' },
} satisfies Meta<typeof SpotIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A booking page with one time picked. */
export const Booking: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvasElement }) => {
    const drawing = canvasElement.querySelector('[data-kind="booking"]');
    await expect(drawing).toHaveAttribute('aria-hidden', 'true');
  },
};

/** A form with two fields and its button. */
export const Form: Story = { args: { kind: 'form' } };

/** A link page with a face, a name and three rows. */
export const LinkPage: Story = { args: { kind: 'link-page' } };

/** In its home: EmptyState's illustration slot, over the title, line and one action. */
export const InEmptyState: Story = {
  render: () => (
    <EmptyState
      title="No booking pages yet"
      illustration={<SpotIllustration kind="booking" />}
      actions={
        <Button variant="primary" icon="plus">
          New booking page
        </Button>
      }
    >
      Make one and share its link.
    </EmptyState>
  ),
};
