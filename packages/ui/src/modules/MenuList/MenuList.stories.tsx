import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { id, sampleMenu, samplePhotoHref } from '../../workbench/menu-samples.ts';
import { MenuList, type GuestPick } from './MenuList.tsx';

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

/** Dinner serving now, Brunch a tap away; a sold out dish stays in place, dimmed. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="fill" height="page">
      <WithPicks />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Somewhere Nowhere', level: 1 })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /^Oysters/ })).toHaveTextContent('Sold out');
    // A dish with no choices adds from its row; its + turns into a stepper and the picks bar rises.
    await userEvent.click(canvas.getByRole('button', { name: 'Add Burrata, blood orange, chilli to your picks' }));
    await expect(canvas.getByRole('group', { name: 'How many Burrata, blood orange, chilli' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /View your picks/ })).toHaveTextContent('£12.94');
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
    const dialog = await screen.findByRole('dialog', { name: 'Your picks' });
    await expect(within(dialog).getByText('Includes 20% tax')).toBeVisible();
    await expect(within(dialog).getByText('Service 12.5%')).toBeVisible();
    // Taking the last of a line away says so, with Undo.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Burrata, blood orange, chilli' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Undo' }));
    await expect(within(dialog).getByText('Burrata, blood orange, chilli')).toBeInTheDocument();
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
    await userEvent.click(canvas.getByRole('button', { name: /^Etna Rosso/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Etna Rosso, Benanti 2022' });
    await beat(700);
    await userEvent.click(within(dialog).getByRole('radio', { name: /Bottle/ }));
    await expect(within(dialog).getByRole('button', { name: /Add to your picks · £38.00/ })).toBeInTheDocument();
    await beat(900);
    await userEvent.click(within(dialog).getByRole('button', { name: /Add to your picks/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expect(canvas.getByRole('button', { name: /View your picks/ })).toHaveTextContent('£42.75');
  },
};

/** Vegan filtered: only the dishes marked vegan stay. */
export const Filtered: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page">
      <WithPicks />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Vegan' }));
    await expect(canvas.queryByRole('button', { name: /^Burrata/ })).toBeNull();
    await expect(canvas.getByRole('button', { name: /^Charred hispi/ })).toBeVisible();
  },
};
