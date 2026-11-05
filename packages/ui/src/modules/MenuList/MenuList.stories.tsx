import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { MENU_PRESET_LOOKS, MENU_PRESETS, menuLookColours, menuLookShape, presetLook } from '@crm/contracts/menu';
import { TileGrid } from '../../molecules/TileGrid/TileGrid.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { id, sampleMenu, samplePhotoHref } from '../../workbench/menu-samples.ts';
import { MenuList, type GuestPick } from './MenuList.tsx';
import { MenuLookThumbnail } from './MenuLookThumbnail.tsx';

function WithPicks({
  initial = [],
  openItemId,
  isPicksOpen,
}: {
  readonly initial?: readonly GuestPick[];
  readonly openItemId?: string;
  readonly isPicksOpen?: boolean;
}) {
  const [picks, setPicks] = useState<readonly GuestPick[]>(initial);
  return (
    <MenuList
      menu={sampleMenu()}
      photoHref={samplePhotoHref}
      picks={picks}
      onPicksChange={setPicks}
      table="Table 4"
      {...(openItemId === undefined ? {} : { openItemId })}
      {...(isPicksOpen === undefined ? {} : { isPicksOpen })}
    />
  );
}

/** Two flat whites with oat milk and a bottle of the Etna Rosso. */
const SOME_PICKS: readonly GuestPick[] = [
  { key: `${id(104)}||${id(202)}`, itemId: id(104), optionIds: [id(202)], quantity: 2 },
  { key: `${id(103)}|${id(302)}|`, itemId: id(103), sizeId: id(302), optionIds: [], quantity: 1 },
  { key: `${id(100)}||`, itemId: id(100), optionIds: [], quantity: 1 },
];

/** Waits a beat, so a person watching the story sees each step land. */
const beat = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const meta = {
  title: 'Modules/MenuList',
  component: MenuList,
  // The sample menu and its photos are shared with ItemSheet's stories, not stories themselves.
  excludeStories: ['sampleMenu', 'samplePhotoHref'],
  args: { menu: sampleMenu() },
} satisfies Meta<typeof MenuList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The look's custom properties as a preview sets them: Noir, pinned dark, in its own faces and corners. */
export const NoirLook: Story = {
  render: () => {
    const look = presetLook('noir');
    return (
      // No page height: the frame's own height would end the menu's dark ground under the words that run past it.
      <Stage width="fill">
        <MenuList
          menu={sampleMenu()}
          photoHref={samplePhotoHref}
          scheme="dark"
          coverHref={samplePhotoHref(id(1))}
          lookVariables={[...menuLookShape(look), ...menuLookColours(look, {}, 'dark')]}
        />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-menu-list]');
    if (root === null) throw new Error('No menu.');
    await expect(getComputedStyle(root).getPropertyValue('--menu-ground').trim()).toBe('#0a0a0a');
    await expect(root).toHaveAttribute('data-theme', 'dark');
  },
};

/** Each preset as a small picture of itself, as the Design page's tiles draw them. */
export const LookThumbnails: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <TileGrid
        variant="choice"
        label="Look"
        keepsPicture
        defaultValue="warm"
        tiles={MENU_PRESETS.map((id) => {
          const look = presetLook(id);
          const own = MENU_PRESET_LOOKS[id].scheme;
          const side = own === 'follow' ? 'light' : own;
          return {
            id,
            name: id,
            thumbnail: (
              <MenuLookThumbnail
                scheme={side}
                variables={[...menuLookShape(look), ...menuLookColours(look, {}, side)]}
              />
            ),
          };
        })}
      />
    </Stage>
  ),
};

/** Dinner serving now, Brunch a tap away; the sections as pills, one at a time; a sold out dish stays in place. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="fill" height="page">
      <WithPicks />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Dinner', level: 1 })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /^Oysters/ })).toHaveTextContent('Sold out');
    // A dish with no choices adds from its row; its + turns into a stepper and the picks bar rises.
    await userEvent.click(canvas.getByRole('button', { name: 'Add Burrata, blood orange, chilli to your selection' }));
    await expect(canvas.getByRole('group', { name: 'How many Burrata, blood orange, chilli' })).toBeInTheDocument();
    // Focus follows to the stepper's + that took the lone +'s place.
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Add another Burrata, blood orange, chilli' })).toHaveFocus(),
    );
    await expect(canvas.getByRole('button', { name: /View selection/ })).toHaveTextContent('£12.94');
  },
};

/** A dish's sheet open: a wine by the glass or the bottle, the first size chosen. */
export const SheetOpen: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <WithPicks openItemId={id(103)} />
    </Stage>
  ),
  play: async () => {
    await settleAnimations();
    const dialog = await screen.findByRole('dialog', { name: 'Etna Rosso, Benanti 2022' });
    await expect(within(dialog).getByRole('radio', { name: /Glass/ })).toBeChecked();
  },
};

/** Your picks open: each line with its choices and stepper, the VAT inside and the service on top, the total. */
export const PicksOpen: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <WithPicks initial={SOME_PICKS} isPicksOpen />
    </Stage>
  ),
  play: async () => {
    await settleAnimations();
    const dialog = await screen.findByRole('dialog', { name: 'Your selection' });
    await expect(within(dialog).getByText('Includes 20% tax')).toBeVisible();
    await expect(within(dialog).getByText('Service 12.5%')).toBeVisible();
    // Taking the last of a line away says so, with Undo.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Burrata, blood orange, chilli' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Undo' }));
    await expect(within(dialog).getByText('Burrata, blood orange, chilli')).toBeInTheDocument();
  },
};

/**
 * Counts and words: a plain dish's stepper says each add politely, and a dish with choices (the wine, by the glass or
 * bottle) shows how many are in the selection beside its +.
 */
export const CountsAndAnnouncements: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="phone" height="page">
      <WithPicks initial={SOME_PICKS} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add another Burrata, blood orange, chilli' }));
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Added Burrata, blood orange, chilli. 2 in your selection.'),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Remove one Burrata, blood orange, chilli' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Removed one Burrata'));
    await userEvent.click(canvas.getByRole('tab', { name: 'Wine' }));
    const wine = await canvas.findByRole('group', { name: /^How many / });
    await expect(wine).toHaveTextContent('1');
    await expect(within(wine).queryByRole('button', { name: /^Remove one/ })).toBeNull();
  },
};

/**
 * The stageshow demo (spec 0068, AC-6807): a guest opens a wine, picks the bottle, the price on Add pops to the
 * bottle's, and Add puts it in their picks, the bar rising with the total. One interaction, at a phone's width.
 */
export const DemoPickASize: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="phone" height="page">
      <WithPicks />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await beat(600);
    await userEvent.click(canvas.getByRole('tab', { name: 'Wine' }));
    await userEvent.click(canvas.getByRole('button', { name: /^Etna Rosso/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Etna Rosso, Benanti 2022' });
    await beat(700);
    await userEvent.click(within(dialog).getByRole('radio', { name: /Bottle/ }));
    await expect(within(dialog).getByRole('button', { name: /Add to selection · £38.00/ })).toBeInTheDocument();
    await beat(900);
    await userEvent.click(within(dialog).getByRole('button', { name: /Add to selection/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expect(canvas.getByRole('button', { name: /View selection/ })).toHaveTextContent('£42.75');
  },
};

/** The sections as pills: one at a time, the arrow keys move between them (checklabs' categories). */
export const Sections: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="phone" height="page">
      <WithPicks />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Small plates' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.queryByRole('button', { name: /^Flat white/ })).toBeNull();
    await userEvent.click(canvas.getByRole('tab', { name: 'Coffee' }));
    await expect(canvas.getByRole('button', { name: /^Flat white/ })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /^Burrata/ })).toBeNull();
  },
};

/** A hidden menu (Live or Hidden): the menu's look and header, one line saying so, Reserve a table and Call. */
export const Unavailable: Story = {
  render: () => {
    const menu = sampleMenu();
    return (
      <Stage width="fill" height="page">
        <MenuList
          menu={{
            ...menu,
            menu: { ...menu.menu, menus: [], items: {}, groups: {} },
            soldOut: [],
            hidden: true,
            reservePath: '/r/AbCdEfGhIjKlMnOp',
            place: { ...menu.place, phone: '+44 20 7946 0000' },
          }}
          table="Table 4"
        />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'This menu isn’t available right now' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Reserve a table' })).toHaveAttribute('href', '/r/AbCdEfGhIjKlMnOp');
    await expect(canvas.getByRole('link', { name: 'Call +44 20 7946 0000' })).toHaveAttribute(
      'href',
      'tel:+442079460000',
    );
    await expect(canvas.queryByRole('searchbox')).toBeNull();
  },
};
