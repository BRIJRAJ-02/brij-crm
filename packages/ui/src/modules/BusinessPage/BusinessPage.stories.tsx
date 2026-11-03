// The business page (spec 0066, B4 lite) and its block parts: a restaurant with its gallery, menu, Reserve coming
// soon, amenities, hours and location; a page with no photos and no menu; several places; Reserve open; loading; and
// each part alone. The stories' clock is Thursday 8 October 2026, 14:30 in London.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import {
  BusinessGallery,
  BusinessHours,
  BusinessLocation,
  BusinessMenu,
  BusinessPage,
  BusinessReserve,
  type BusinessPagePlace,
  type BusinessPhotoItem,
} from './BusinessPage.tsx';

/** A photo stood in for by a `data:` image: two tints and a table's shape, so the gallery reads as photos. */
function photo(top: string, bottom: string, alt?: string, width = 1600, height = 1200): BusinessPhotoItem {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${top}"/>` +
    `<stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
    `<rect width="${String(width)}" height="${String(height)}" fill="url(#g)"/>` +
    `<ellipse cx="${String(width / 2)}" cy="${String(height * 0.72)}" rx="${String(width * 0.3)}" ry="${String(height * 0.08)}" fill="#1f2937" opacity="0.3"/>` +
    `<circle cx="${String(width * 0.3)}" cy="${String(height * 0.3)}" r="${String(height * 0.06)}" fill="#fff7e6" opacity="0.85"/>` +
    `</svg>`;
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height, ...(alt === undefined ? {} : { alt }) };
}

const PHOTOS: readonly BusinessPhotoItem[] = [
  photo('#7c2d12', '#fbbf24', 'The bar at dusk'),
  photo('#14532d', '#a3e635', 'The terrace'),
  photo('#1e3a8a', '#93c5fd'),
  photo('#831843', '#f9a8d4'),
  photo('#3f3f46', '#e4e4e7'),
  photo('#713f12', '#fde68a'),
];

const PLACE: BusinessPagePlace = {
  name: 'Indiranagar',
  addressLine: '12, 100 Feet Road, Indiranagar',
  city: 'Bengaluru',
  postcode: '560038',
  phone: '+91 80 4567 8901',
  timeZone: 'Europe/London',
  hours: {
    weekly: {
      mon: [{ from: '12:00', to: '23:00' }],
      tue: [{ from: '12:00', to: '23:00' }],
      wed: [{ from: '12:00', to: '23:00' }],
      thu: [
        { from: '12:00', to: '15:30' },
        { from: '18:00', to: '23:30' },
      ],
      fri: [{ from: '12:00', to: '01:00' }],
      sat: [{ from: '12:00', to: '01:00' }],
    },
    exceptions: [],
  },
};

const MENU = [
  {
    name: 'Small plates',
    items: [
      { name: 'Burnt garlic edamame', description: 'Chilli oil, sea salt.', price: '₹320' },
      { name: 'Ghee roast mushrooms', description: 'Mangalore spice, curry leaves.', price: '₹380' },
      { name: 'Crispy okra fries', price: '₹290' },
    ],
  },
  {
    name: 'Cocktails',
    items: [
      { name: 'Somewhere Negroni', description: 'Gin, bitter orange, kokum.', price: '₹650' },
      { name: 'Nowhere Sour', description: 'Rum, tamarind, egg white.', price: '₹620' },
    ],
  },
];

const DIRECTIONS = {
  google: 'https://www.google.com/maps/dir/?api=1&destination=Somewhere%20Nowhere',
  apple: 'https://maps.apple.com/?daddr=Somewhere%20Nowhere',
};

const FOOT = <BookingFoot page="business_page" claimHref="https://www.timefix.com/?utm_content=claim_link" />;

const meta = {
  title: 'Modules/BusinessPage',
  component: BusinessPage,
  args: {
    name: 'Somewhere Nowhere',
    kind: 'Restaurant',
    description: 'A small bar and kitchen off 100 Feet Road. Plates to share, cocktails, late on weekends.',
    about:
      'We opened in 2019 with eight seats and a borrowed espresso machine.\nToday we seat forty, inside and on the terrace.',
    photos: PHOTOS,
    amenities: ['wifi', 'cards', 'wheelchair', 'outdoor', 'vegetarian'],
    place: PLACE,
    menu: MENU,
    reserve: { kind: 'soon' },
    directions: DIRECTIONS,
    website: 'https://somewhere-nowhere.example',
    foot: FOOT,
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <BusinessPage {...args} />
    </Stage>
  ),
  parameters: { layout: 'fullscreen', crm: { screenshot: false } },
} satisfies Meta<typeof BusinessPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A restaurant: the gallery, the open status, the menu, Reserve coming soon, About, hours and location. */
export const Restaurant: Story = {
  parameters: { crm: { preview: true, screenshot: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settleAnimations();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Somewhere Nowhere' })).toBeVisible();
    // Thursday 14:30 in London: between lunch and dinner, so it opens again at 18:00.
    await expect(canvas.getAllByText('Opens at 18:00').length).toBeGreaterThan(0);
    await expect(canvas.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: 'Reserve a table' })[0]).toBeDisabled();
  },
};

/** No photos, no menu, no amenities: the header leads, and the tabs hold Hours and Location. */
export const Plain: Story = {
  args: { photos: [], menu: undefined, amenities: [], about: undefined, reserve: undefined },
};

/** Several places: the picker links each, the one shown marked. */
export const SeveralPlaces: Story = {
  args: {
    places: [
      { name: 'Indiranagar', href: '/somewhere-nowhere/indiranagar', isCurrent: true },
      { name: 'Koramangala', href: '/somewhere-nowhere/koramangala', isCurrent: false },
    ],
  },
};

/** Reserve once the reservation flow is open: a link to `/<handle>/reserve`. */
export const ReserveOpen: Story = {
  args: { reserve: { kind: 'open', href: '/somewhere-nowhere/reserve' } },
};

/** Open now: Thursday from 10 until 1 at night. */
export const OpenNow: Story = {
  args: {
    place: {
      ...PLACE,
      hours: { weekly: { thu: [{ from: '10:00', to: '01:00' }] }, exceptions: [] },
    },
  },
  play: async ({ canvasElement }) => {
    await expect((await within(canvasElement).findAllByText('Open now')).length).toBeGreaterThan(0);
  },
};

/** While the page's read is on its way. */
export const Loading: Story = {
  args: { isLoading: true },
};

/** The gallery alone, and its viewer: a photo opens large, the arrow keys move, Escape closes. */
export const Gallery: Story = {
  render: () => (
    <Stage width="fill">
      <BusinessGallery photos={PHOTOS} name="Somewhere Nowhere" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      within(canvasElement).getAllByRole('button', { name: 'Open photo 1 of 6' })[0] as HTMLElement,
    );
    const viewer = await body.findByRole('dialog');
    await settleAnimations();
    await expect(within(viewer).getByText('Photo 1 of 6')).toBeVisible();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(viewer).getByText('Photo 2 of 6')).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
  },
};

/** The week's hours, today (Thursday) marked, two ranges on one day, Sunday closed. */
export const Hours: Story = {
  render: () => (
    <Stage width="fill">
      <BusinessHours hours={PLACE.hours} timeZone="Asia/Kolkata" />
    </Stage>
  ),
};

/** The location: the address, the phone, the site, and Directions to either map app. */
export const Location: Story = {
  render: () => (
    <Stage width="fill">
      <BusinessLocation
        lines={['12, 100 Feet Road, Indiranagar', 'Bengaluru 560038']}
        phone="+91 80 4567 8901"
        website="https://somewhere-nowhere.example"
        directions={DIRECTIONS}
      />
    </Stage>
  ),
};

/** The menu's sections, names and prices on one line. */
export const Menu: Story = {
  render: () => (
    <Stage width="fill">
      <BusinessMenu sections={MENU} />
    </Stage>
  ),
};

/** Reserve a table, coming soon and open. */
export const Reserve: Story = {
  render: () => (
    <Stage direction="column">
      <BusinessReserve state={{ kind: 'soon' }} />
      <BusinessReserve state={{ kind: 'open', href: '/somewhere-nowhere/reserve' }} />
    </Stage>
  ),
};
