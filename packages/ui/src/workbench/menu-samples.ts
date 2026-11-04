// A guest menu's sample for the stories (spec 0065, H1): MenuList's and ItemSheet's, kept here so the artifact's
// previews bundle it as they do the other workbench samples.
import type { PublicMenu } from '@crm/contracts';

/** A sample id, numbered. */
export const id = (n: number) => `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
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
            { id: id(301), name: 'Glass 175ml', priceMinor: 950 },
            { id: id(302), name: 'Bottle', priceMinor: 3800 },
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
