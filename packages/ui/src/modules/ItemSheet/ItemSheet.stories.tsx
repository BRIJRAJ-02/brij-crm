import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, within } from 'storybook/test';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { sampleMenu } from '../MenuList/MenuList.stories.tsx';
import { ItemSheet, PicksSheet, type GuestPick } from './ItemSheet.tsx';

const id = (n: number) => `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

function Sheet({ itemId }: { readonly itemId: string }) {
  const menu = sampleMenu();
  const item = menu.menu.items[itemId];
  if (item === undefined) return null;
  return (
    <Modal variant="sheet" title={item.name} isOpen>
      <ItemSheet item={item} menu={menu} isSoldOut={menu.soldOut.includes(itemId)} onPick={() => undefined} />
    </Modal>
  );
}

function Picks() {
  const [picks, setPicks] = useState<readonly GuestPick[]>([
    { key: 'a', itemId: id(104), optionIds: [id(202)], quantity: 2 },
    { key: 'b', itemId: id(103), size: 1, optionIds: [], quantity: 1 },
  ]);
  return (
    <Modal variant="sheet" title="Your picks" isOpen>
      <PicksSheet menu={sampleMenu()} picks={picks} onPicksChange={setPicks} />
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

/** A coffee: its milk as stacked option cards, priced, then Add to your picks with the total as chosen. */
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
