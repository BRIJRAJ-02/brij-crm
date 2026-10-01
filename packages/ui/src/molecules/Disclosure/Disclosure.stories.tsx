import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Disclosure, DisclosureGroup } from './Disclosure.tsx';

const meta = {
  title: 'Molecules/Disclosure',
  component: Disclosure,
  args: { title: 'Contact', count: 4, children: 'Email, phone, and two addresses.' },
} satisfies Meta<typeof Disclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Enter opens and closes it, and it says whether it is open. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Disclosure {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole('button', { name: /Contact/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  },
};

/** A group with one section open. */
export const Group: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="narrow">
      <DisclosureGroup defaultExpandedKeys={['contact']}>
        <Disclosure id="contact" title="Contact" count={4}>
          Email, phone, and two addresses.
        </Disclosure>
        <Disclosure id="billing" title="Billing" count={2}>
          Plan and payment method.
        </Disclosure>
        <Disclosure id="system" title="System" isDisabled>
          Created and updated.
        </Disclosure>
      </DisclosureGroup>
    </Stage>
  ),
};
