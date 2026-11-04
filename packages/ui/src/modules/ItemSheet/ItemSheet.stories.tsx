import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, within } from 'storybook/test';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import type { PublicMenu } from '@crm/contracts';
import { sampleMenu, samplePhotoHref } from '../MenuList/MenuList.stories.tsx';
import { ItemSheet, PicksSheet, type GuestPick } from './ItemSheet.tsx';

const id = (n: number) => `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** The sample menu with a required group: a burger whose sides the guest must choose (one or two). */
function withSides(): PublicMenu {
  const menu = sampleMenu();
  return {
    ...menu,
    menu: {
      ...menu.menu,
      items: {
        ...menu.menu.items,
        [id(107)]: {
          id: id(107),
          name: 'Smash burger',
          description: 'Two patties, American cheese, pickles.',
          priceMinor: 1400,
          diet: [],
          allergens: [
            { code: 'gluten', level: 'contains' },
            { code: 'milk', level: 'contains' },
          ],
          featured: false,
          sizes: [],
          groupIds: [id(210)],
        },
      },
      groups: {
        ...menu.menu.groups,
        [id(210)]: {
          id: id(210),
          name: 'Sides',
          rule: 'up_to',
          min: 1,
          max: 2,
          options: [
            { id: id(211), name: 'Fries', priceDeltaMinor: 0 },
            { id: id(212), name: 'Green salad', priceDeltaMinor: 0 },
            { id: id(213), name: 'Truffle fries', priceDeltaMinor: 250 },
          ],
        },
      },
    },
  };
}

function Sheet({ itemId, menu = sampleMenu() }: { readonly itemId: string; readonly menu?: PublicMenu }) {
  const item = menu.menu.items[itemId];
  if (item === undefined) return null;
  return (
    <Modal variant="sheet-card" title={item.name} isOpen>
      <ItemSheet
        item={item}
        menu={menu}
        isSoldOut={menu.soldOut.includes(itemId)}
        photoHref={samplePhotoHref}
        onPick={() => undefined}
      />
    </Modal>
  );
}

function Picks() {
  const [picks, setPicks] = useState<readonly GuestPick[]>([
    { key: 'a', itemId: id(104), optionIds: [id(202)], quantity: 2 },
    { key: 'b', itemId: id(103), sizeId: id(302), optionIds: [], quantity: 1 },
  ]);
  return (
    <Modal variant="sheet-side" title="Your picks" isOpen>
      <PicksSheet menu={sampleMenu()} picks={picks} onPicksChange={setPicks} photoHref={samplePhotoHref} />
    </Modal>
  );
}

const meta = {
  title: 'Modules/ItemSheet',
  component: ItemSheet,
  args: {
    item: sampleMenu().menu.items[id(104)] ?? Object.values(sampleMenu().menu.items)[0],
    menu: sampleMenu(),
    isSoldOut: false,
  },
} satisfies Meta<typeof ItemSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A coffee: its milk as option cards, priced, then the quantity and Add to your picks with the live total. */
export const Options: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="fill" height="page">
      <Sheet itemId={id(104)} />
    </Stage>
  ),
  play: async () => {
    await settleAnimations();
    const dialog = await screen.findByRole('dialog');
    await expect(within(dialog).getByText(/Allergens: milk/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Oat/ }));
    await expect(within(dialog).getByRole('button', { name: /Add to your picks · £4.30/ })).toBeVisible();
    // Two of them: the quantity pill's minus is off at one, and the price follows the count.
    await expect(within(dialog).getByRole('button', { name: 'One fewer' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'One more' }));
    await expect(within(dialog).getByRole('button', { name: /Add to your picks · £8.60/ })).toBeVisible();
  },
};

/** A required group: Add waits, saying why in one line, until a side is chosen. */
export const Required: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <Sheet itemId={id(107)} menu={withSides()} />
    </Stage>
  ),
  play: async () => {
    await settleAnimations();
    const dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: /Add to your picks/ });
    await expect(add).toBeDisabled();
    await expect(within(dialog).getByText('Choose your sides to add this.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Truffle fries/ }));
    await expect(within(dialog).getByRole('button', { name: /Add to your picks · £16.50/ })).toBeEnabled();
  },
};

/** A wine by the glass or the bottle: sizes as cards, each its own price. */
export const Sizes: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <Sheet itemId={id(103)} />
    </Stage>
  ),
};

/** Sold out: the dish reads, but nothing can be picked. */
export const SoldOut: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <Sheet itemId={id(102)} />
    </Stage>
  ),
};

/** Your picks: a card per pick with its stepper, the total, and that nothing is sent. */
export const YourPicks: Story = {
  render: () => (
    <Stage width="fill" height="page">
      <Picks />
    </Stage>
  ),
  play: async () => {
    await settleAnimations();
    const dialog = await screen.findByRole('dialog');
    await expect(within(dialog).getByText(/Nothing is sent/)).toBeVisible();
  },
};
