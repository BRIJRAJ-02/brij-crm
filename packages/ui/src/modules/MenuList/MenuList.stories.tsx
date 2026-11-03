import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import type { PublicMenu } from '@crm/contracts';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { MenuList, type GuestPick } from './MenuList.tsx';

const id = (n: number) => `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const VERSION = 'a1b2c3d4e5f6';
const photo = (n: number) => ({ id: id(n), version: VERSION });

/** Each photo as a plate in its own colour (an inline drawing, so the story needs no files). */
const PLATES = ['#d9a26b', '#a9c48a', '#c96f4a', '#b89a7a', '#7c9cb4', '#d6b25e'];
export const samplePhotoHref = (photoId: string) => {
  const hue = PLATES[Number.parseInt(photoId.slice(-2), 10) % PLATES.length] ?? '#d9a26b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff6e8"/><stop offset="1" stop-color="${hue}"/></radialGradient></defs><rect width="400" height="400" fill="#efe7dc"/><circle cx="200" cy="200" r="130" fill="url(#g)"/><ellipse cx="200" cy="300" rx="150" ry="26" fill="#00000014"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/** A small café menu: two menus (Dinner serving now, Brunch at the weekend), sizes, a shared group, a sold out dish. */
export function sampleMenu(): PublicMenu {
  return {
    placeId: id(900),
    workspaceId: id(901),
    version: 3,
    business: { name: 'Somewhere Nowhere', description: 'Small plates and natural wine in Soho.' },
    place: {
      name: 'Soho',
      addressLine: '12 Greek Street',
      city: 'London',
      phone: '+44 20 7946 0000',
      timeZone: 'Europe/London',
      locale: 'en-GB',
      hours: {
        weekly: { thu: [{ from: '12:00', to: '23:00' }], fri: [{ from: '12:00', to: '23:00' }] },
        exceptions: [],
      },
    },
    menu: {
      currency: 'GBP',
      menus: [
        {
          id: id(1),
          name: 'Dinner',
          note: 'Prices include 20% VAT. 12.5% service is added.',
          taxRate: 2000,
          serviceRate: 1250,
          sections: [
            { id: id(10), name: 'Small plates', layout: 'list', itemIds: [id(100), id(101), id(102)], sections: [] },
            {
              id: id(11),
              name: 'Wine',
              layout: 'list',
              itemIds: [],
              sections: [{ id: id(12), name: 'Red', layout: 'list', itemIds: [id(103)] }],
            },
            { id: id(13), name: 'Coffee', layout: 'grid', itemIds: [id(104), id(105)], sections: [] },
          ],
        },
        {
          id: id(2),
          name: 'Brunch',
          serving: { weekly: { sat: [{ from: '10:00', to: '15:00' }], sun: [{ from: '10:00', to: '15:00' }] } },
          sections: [{ id: id(20), name: 'Eggs', layout: 'list', itemIds: [id(106)], sections: [] }],
        },
      ],
      items: {
        [id(100)]: {
          id: id(100),
          name: 'Burrata, blood orange, chilli',
          description: 'Puglian burrata with blood orange, Calabrian chilli oil and basil.',
          priceMinor: 1150,
          photo: photo(31),
          diet: ['vegetarian', 'spicy_1'],
          allergens: [{ code: 'milk', level: 'contains' }],
          featured: true,
          sizes: [],
          groupIds: [],
        },
        [id(101)]: {
          id: id(101),
          name: 'Charred hispi cabbage',
          description: 'Miso butter, crispy shallots.',
          priceMinor: 900,
          photo: photo(32),
          diet: ['vegan', 'gluten_free'],
          allergens: [
            { code: 'soya', level: 'contains' },
            { code: 'sesame', level: 'may' },
          ],
          featured: false,
          sizes: [],
          groupIds: [],
        },
        [id(102)]: {
          id: id(102),
          name: 'Oysters',
          priceNote: 'Market price',
          diet: [],
          allergens: [{ code: 'molluscs', level: 'contains' }],
          featured: false,
          sizes: [],
          groupIds: [],
        },
        [id(103)]: {
          id: id(103),
          name: 'Etna Rosso, Benanti 2022',
          description: 'Nerello Mascalese from the volcano’s north slope: red cherry, smoke, a fine grip.',
          photo: photo(33),
          diet: ['vegan'],
          allergens: [{ code: 'sulphites', level: 'contains' }],
          featured: false,
          sizes: [
            { name: 'Glass 175ml', priceMinor: 950 },
            { name: 'Bottle', priceMinor: 3800 },
          ],
          groupIds: [],
        },
        [id(104)]: {
          id: id(104),
          name: 'Flat white',
          description: 'A double ristretto with silky milk.',
          priceMinor: 380,
          photo: photo(34),
          kcal: 110,
          diet: [],
          allergens: [{ code: 'milk', level: 'contains' }],
          featured: false,
          sizes: [],
          groupIds: [id(200)],
        },
        [id(105)]: {
          id: id(105),
          name: 'Cortado',
          description: 'Equal parts espresso and warm milk.',
          priceMinor: 340,
          photo: photo(35),
          diet: [],
          allergens: [{ code: 'milk', level: 'contains' }],
          featured: false,
          sizes: [],
          groupIds: [id(200)],
        },
        [id(106)]: {
          id: id(106),
          name: 'Eggs Benedict',
          priceMinor: 1300,
          diet: [],
          allergens: [{ code: 'eggs', level: 'contains' }],
          featured: false,
          sizes: [],
          groupIds: [],
        },
      },
      groups: {
        [id(200)]: {
          id: id(200),
          name: 'Milk',
          rule: 'one',
          options: [
            { id: id(201), name: 'Whole', priceDeltaMinor: 0 },
            { id: id(202), name: 'Oat', priceDeltaMinor: 50 },
          ],
        },
      },
    },
    soldOut: [id(102)],
  };
}

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
      table="4"
      {...(openItemId === undefined ? {} : { openItemId })}
      {...(isPicksOpen === undefined ? {} : { isPicksOpen })}
    />
  );
}

/** Two flat whites with oat milk and a bottle of the Etna Rosso. */
const SOME_PICKS: readonly GuestPick[] = [
  { key: `${id(104)}||${id(202)}`, itemId: id(104), optionIds: [id(202)], quantity: 2 },
  { key: `${id(103)}|1|`, itemId: id(103), size: 1, optionIds: [], quantity: 1 },
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
