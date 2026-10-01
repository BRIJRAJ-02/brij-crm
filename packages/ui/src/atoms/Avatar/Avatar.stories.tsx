import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Avatar, AvatarStack } from './Avatar.tsx';

const meta = {
  title: 'Atoms/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', id: 'person_1' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

const PEOPLE = [
  { id: 'p1', name: 'Maya Patel', hue: 'purple' },
  { id: 'p2', name: 'Jonas Berg', hue: 'sky' },
  { id: 'p3', name: 'Priya Rao', hue: 'orange' },
  { id: 'p4', name: 'Leo Martins', hue: 'blue' },
  { id: 'p5', name: 'Ines Duarte', hue: 'green' },
] as const;

/** Initials on a hue picked from the person's id. It reads as their name. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
  },
};

/** The four sizes, people as circles and companies as squares. */
export const Sizes: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Avatar name="Maya Patel" hue="purple" size="xs" />
      <Avatar name="Jonas Berg" hue="sky" size="sm" />
      <Avatar name="Priya Rao" hue="orange" size="md" />
      <Avatar name="Leo Martins" hue="blue" size="lg" />
      <Avatar name="Northwind" hue="ink" shape="square" size="xs" />
      <Avatar name="Acme Logistics" hue="green" shape="square" size="md" />
      <Avatar name="Globex" hue="red" shape="square" size="lg" />
    </Stage>
  ),
};

/** A picture from an outside origin is refused and the initials show (AC-14). */
export const RefusedPicture: Story = {
  args: { src: 'https://images.example.com/ada.png' },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole('img', { name: 'Ada Lovelace' });
    await expect(avatar.querySelector('img')).toBeNull();
    await expect(avatar).toHaveTextContent('AL');
  },
};

/** A picture on our origin. */
export const Picture: Story = {
  args: {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"%3E%3Crect width="2" height="2" fill="%23266df0"/%3E%3C/svg%3E',
  },
};

/** Three overlap, then "+2". Screen readers hear all five names. */
export const Stack: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <AvatarStack people={PEOPLE} />
      <AvatarStack people={PEOPLE.slice(0, 2)} size="md" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [stack] = canvas.getAllByRole('group');
    await expect(stack).toHaveAccessibleName('Maya Patel, Jonas Berg, Priya Rao, Leo Martins, and Ines Duarte');
    await expect(stack).toHaveTextContent('+2');
  },
};
