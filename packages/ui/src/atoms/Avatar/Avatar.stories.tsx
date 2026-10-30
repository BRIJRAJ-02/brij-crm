import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Icon } from '../Icon/Icon.tsx';
import { Avatar, AvatarStack } from './Avatar.tsx';

const meta = {
  title: 'Atoms/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', id: 'person_1' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A picture on our origin: a small blue square, as a `data:` image. */
const PICTURE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"%3E%3Crect width="2" height="2" fill="%23266df0"/%3E%3C/svg%3E';

const PEOPLE = [
  { id: 'p1', name: 'Maya Patel', hue: 'purple' },
  { id: 'p2', name: 'Jonas Berg', hue: 'sky' },
  { id: 'p3', name: 'Priya Rao', hue: 'orange' },
  { id: 'p4', name: 'Leo Martins', hue: 'blue' },
  { id: 'p5', name: 'Ines Duarte', hue: 'green' },
] as const;

/** Initials on a hue picked from the person's id. It reads as their name. At the default 20px it shows one initial. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent(/^A$/u);
  },
};

/** The seven sizes, people as circles and companies as squares: 16px and 20px show one initial, 24px and up two. */
export const Sizes: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Avatar name="Maya Patel" hue="purple" size="xs" />
      <Avatar name="Jonas Berg" hue="sky" size="sm" />
      <Avatar name="Priya Rao" hue="orange" size="md" />
      <Avatar name="Leo Martins" hue="blue" size="lg" />
      <Avatar name="Ada Lovelace" hue="lime" size="title" />
      <Avatar name="Alex Turner" hue="blue" size="xl" />
      <Avatar name="Grace Hopper" hue="sky" size="hero" />
      <Avatar name="Northwind" hue="ink" shape="square" size="xs" />
      <Avatar name="Acme Logistics" hue="green" shape="square" size="md" />
      <Avatar name="Globex" hue="red" shape="square" size="lg" />
      <Avatar name="Initech" hue="yellow" shape="square" size="title" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const shown = [...canvasElement.querySelectorAll('[role="img"]')].map((avatar) => avatar.textContent);
    await expect(shown).toEqual(['M', 'J', 'PR', 'LM', 'AL', 'AT', 'GH', 'N', 'AL', 'G', 'I']);
  },
};

/** A mark in place of initials, for a face that isn't a person: a form, the system, on the neutral square. */
export const Mark: Story = {
  render: () => (
    <Stage>
      <Avatar name="Contact us" mark={<Icon name="clipboard-list" size="xs" />} shape="square" hue="gray" size="xs" />
      <Avatar name="Contact us" mark={<Icon name="clipboard-list" size="xs" />} shape="square" hue="gray" size="sm" />
      <Avatar name="System" mark={<Icon name="server" size="sm" />} shape="square" hue="gray" size="md" />
      <Avatar name="System" mark={<Icon name="server" size="md" />} shape="square" hue="gray" size="lg" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // Named as the thing it stands for, with no initials drawn.
    const [form] = canvas.getAllByRole('img', { name: 'Contact us' });
    await expect(form).not.toHaveTextContent(/C/u);
  },
};

/** A picture from an outside origin is refused and the initials show (AC-14). */
export const RefusedPicture: Story = {
  args: { src: 'https://images.example.com/ada.png' },
  play: async ({ canvas }) => {
    const avatar = canvas.getByRole('img', { name: 'Ada Lovelace' });
    await expect(avatar.querySelector('img')).toBeNull();
    await expect(avatar).toHaveTextContent(/^A$/u);
  },
};

/** A picture on our origin. */
export const Picture: Story = {
  args: { src: PICTURE },
};

/** Bytes no browser can draw: a picture that fails as a company's logo does when its site has none (spec 0059). */
const BROKEN_PICTURE = 'data:image/png;base64,AAAA';

/**
 * A picture that fails, as a company's logo does when its site has no icon (the logo route's 404, spec 0059
 * AC-5901), beside the same avatar with no picture: the initials show in a tile of the same size, with no broken
 * image. Not screenshotted: it looks exactly as the initials do in `Sizes`.
 */
export const FailedPicture: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Avatar name="Northwind" id="company_1" shape="square" size="sm" src={BROKEN_PICTURE} />
      <Avatar name="Northwind" id="company_1" shape="square" size="sm" />
      <Avatar name="Northwind Traders" id="company_1" shape="square" size="title" src={BROKEN_PICTURE} />
      <Avatar name="Northwind Traders" id="company_1" shape="square" size="title" />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => {
      if (canvasElement.querySelector('img') !== null) throw new Error('A picture is still showing.');
    });
    const avatars = canvas.getAllByRole('img');
    await expect(avatars.map((avatar) => avatar.textContent)).toEqual(['N', 'N', 'NT', 'NT']);
    const sizes = avatars.map((avatar) => {
      const box = avatar.getBoundingClientRect();
      return [box.width, box.height];
    });
    await expect(sizes[0]).toEqual(sizes[1]);
    await expect(sizes[2]).toEqual(sizes[3]);
  },
};

/**
 * The big sizes with a picture: it fades in over the initials once loaded, or shows at once when the browser
 * already holds it. Either way the initials go once it has loaded.
 */
export const PictureLarge: Story = {
  render: () => (
    <Stage>
      <Avatar name="Ada Lovelace" size="title" src={PICTURE} />
      <Avatar name="Alex Turner" size="xl" src={PICTURE} />
      <Avatar name="Grace Hopper" size="hero" src={PICTURE} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const pictures = [...canvasElement.querySelectorAll('img')];
    await expect(pictures).toHaveLength(3);
    await waitFor(() => {
      if (pictures.some((picture) => picture.dataset.fade === 'waiting'))
        throw new Error('A picture is still loading.');
    });
    const avatars = [...canvasElement.querySelectorAll('[role="img"]')];
    await expect(avatars.map((avatar) => avatar.textContent)).toEqual(['', '', '']);
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

/** A public team page's stack: 4 faces of 6, "+2", read as "Team of 6" rather than names. */
export const Team: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <AvatarStack people={PEOPLE.slice(0, 4)} max={4} total={6} size="lg" label="Team of 6" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const stack = canvas.getByRole('group', { name: 'Team of 6' });
    await expect(stack).toHaveTextContent('+2');
  },
};
