import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import type { PublicMenu } from '@crm/contracts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { MenuList, type GuestPick } from './MenuList.tsx';

const id = (n: number) => `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** A small café menu: two menus (Dinner serving now, Brunch at the weekend), sizes, a shared group, a sold out dish. */
export function sampleMenu(): PublicMenu {
  return {
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
          note: 'Prices include VAT. 12.5% service is added.',
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
          serving: { days: ['sat', 'sun'], from: '10:00', to: '15:00' },
          sections: [{ id: id(20), name: 'Eggs', layout: 'list', itemIds: [id(106)], sections: [] }],
        },
      ],
      items: {
        [id(100)]: {
          id: id(100),
          name: 'Burrata, blood orange, chilli',
          description: 'Puglian burrata with blood orange, Calabrian chilli oil and basil.',
          priceMinor: 1150,
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
          priceMinor: 380,
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
          priceMinor: 340,
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

function WithPicks() {
  const [picks, setPicks] = useState<readonly GuestPick[]>([]);
  return <MenuList menu={sampleMenu()} picks={picks} onPicksChange={setPicks} />;
}

const meta = {
  title: 'Modules/MenuList',
  component: MenuList,
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
    await expect(canvas.getByRole('button', { name: /Oysters/ })).toHaveTextContent('Sold out');
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
    await expect(canvas.queryByRole('button', { name: /Burrata/ })).toBeNull();
    await expect(canvas.getByRole('button', { name: /hispi/ })).toBeVisible();
  },
};
