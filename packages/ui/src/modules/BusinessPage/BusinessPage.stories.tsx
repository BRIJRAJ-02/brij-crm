// The business page (spec 0066, B4 lite) and its block parts: a restaurant with its gallery, menu, Call to book (until
// online reservations open), amenities, hours and location; Directions with no phone; no panel without Table seating;
// several places; Reserve open; loading; and each part alone. The stories' clock is Thursday 8 October 2026, 14:30 in
// London, the place's own zone; its times read in its country's clock style whatever the browser's.
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
  businessAction,
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
  country: 'GB',
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
      {
        name: 'Burnt garlic edamame',
        description: 'Chilli oil, sea salt.',
        price: '₹320',
        photo: photo('#7a9a52', '#3f5a2a', undefined, 400, 400).src,
      },
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
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BusinessPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A restaurant: the gallery, the open status, the menu, About, hours and location. Online reservations aren't open, so
 * the page's one action is Call to book, in the panel and the phone's bar, never a disabled button. No logo: the
 * name's initials stand in, on the brand's accent.
 */
export const Restaurant: Story = {
  // Shot at a phone's width: the desktop page with its photos is over the 200 KB baseline limit, and Plain shows the
  // desktop layout while Gallery, Hours, Location and Menu show each section.
  render: (args) => (
    <Stage width="phone" height="page">
      <BusinessPage {...args} />
    </Stage>
  ),
  parameters: { crm: { preview: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settleAnimations();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Somewhere Nowhere' })).toBeVisible();
    // Thursday 14:30 in London: between lunch and dinner, so it opens again at 18:00.
    await expect(canvas.getAllByText('Opens at 18:00').length).toBeGreaterThan(0);
    await expect(canvas.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Reserve a table' })).toBeNull();
    await expect(canvas.queryByText('Coming soon')).toBeNull();
    for (const call of canvas.getAllByRole('link', { name: 'Call to book' })) {
      await expect(call).toHaveAttribute('href', 'tel:+918045678901');
    }
    // The gallery's tiles say what each photo shows.
    await expect(canvas.getAllByRole('button', { name: 'Open photo 1 of 6: The bar at dusk' }).length).toBeGreaterThan(
      0,
    );
    // Times in the place's clock style (London: 24 hour) whatever the browser's.
    await expect(canvas.getAllByText('12:00 – 23:00').length).toBeGreaterThan(0);
  },
};

/** Reservations not open and no phone: Directions is the action, never a dead end. */
export const DirectionsOnly: Story = {
  // Restaurant's page with one difference, checked in play, so no shot of its own (the full page is over 200 KB).
  parameters: { crm: { screenshot: false } },
  args: { place: { ...PLACE, phone: undefined } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('link', { name: 'Call to book' })).toBeNull();
    const directions = canvas.getAllByRole('link', { name: 'Directions in Google Maps (opens in a new tab)' });
    await expect(directions.length).toBeGreaterThan(0);
  },
};

/** A place in Bengaluru: its hours read on a 12 hour clock, as people there read them. */
export const TwelveHourClock: Story = {
  // Restaurant's page with one difference, checked in play, so no shot of its own (the full page is over 200 KB).
  parameters: { crm: { screenshot: false } },
  args: { place: { ...PLACE, country: 'IN' } },
  play: async ({ canvasElement }) => {
    await expect((await within(canvasElement).findAllByText(/12:00\s?pm – 11:00\s?pm/i)).length).toBeGreaterThan(0);
  },
};

/** No photos, no menu, no amenities: the header leads, and the tabs hold Hours and Location. */
export const Plain: Story = {
  args: { photos: [], menu: undefined, amenities: [], about: undefined, reserve: undefined },
  play: async ({ canvasElement }) => {
    // Without Table seating there is no action to carry, so no side panel and no phone bar.
    await expect(within(canvasElement).queryByRole('complementary')).toBeNull();
  },
};

/** Several places: the place on its own line under the name, and the other places after Location. */
export const SeveralPlaces: Story = {
  // Restaurant's page with one difference, checked in play, so no shot of its own (the full page is over 200 KB).
  parameters: { crm: { screenshot: false } },
  args: {
    placeName: 'Indiranagar',
    places: [
      { name: 'Indiranagar', href: '/somewhere-nowhere/indiranagar', isCurrent: true },
      { name: 'Koramangala', href: '/somewhere-nowhere/koramangala', isCurrent: false },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await settleAnimations();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Somewhere Nowhere' })).toBeVisible();
    await expect(canvas.getByText('Indiranagar', { selector: 'p' })).toBeVisible();
    const others = canvas.getByRole('region', { name: 'Other places' });
    await expect(within(others).getByRole('link', { name: 'Koramangala' })).toBeVisible();
    await expect(within(others).queryByRole('link', { name: 'Indiranagar' })).toBeNull();
  },
};

/** Reserve once the reservation flow is open: a link to the place's reservation page, `/r/<key>` (Table seating). */
export const ReserveOpen: Story = {
  // Restaurant's page with one difference, checked in play, so no shot of its own (the full page is over 200 KB).
  parameters: { crm: { screenshot: false } },
  args: { reserve: { kind: 'open', href: '/r/AbCdEfGhIjKlMnOp' } },
  play: async ({ canvasElement }) => {
    for (const reserve of within(canvasElement).getAllByRole('link', { name: 'Reserve a table' })) {
      await expect(reserve).toHaveAttribute('href', '/r/AbCdEfGhIjKlMnOp');
    }
  },
};

/** The Menu app's whole guest menu linked under the Menu section (`/m/<key>`). */
export const FullMenuLink: Story = {
  // The page is Restaurant's with one more link; checked in play, so no shot of its own.
  parameters: { crm: { screenshot: false } },
  args: { menuHref: '/m/AbCdEfGhIjKlMnOp' },
  play: async ({ canvasElement }) => {
    const menu = within(canvasElement).getByRole('region', { name: 'Menu' });
    await expect(within(menu).getByRole('link', { name: 'See the full menu' })).toHaveAttribute(
      'href',
      '/m/AbCdEfGhIjKlMnOp',
    );
  },
};

/** Open now: Thursday from 10 until 1 at night. */
export const OpenNow: Story = {
  // Restaurant's page with one difference, checked in play, so no shot of its own (the full page is over 200 KB).
  parameters: { crm: { screenshot: false } },
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
      within(canvasElement).getAllByRole('button', { name: 'Open photo 1 of 6: The bar at dusk' })[0] as HTMLElement,
    );
    const viewer = await body.findByRole('dialog');
    await settleAnimations();
    // The heading says what the photo shows; its place is said once, in the status the viewer announces politely.
    await expect(within(viewer).getByRole('heading', { name: 'The bar at dusk' })).toBeVisible();
    await expect(within(viewer).getByRole('status')).toHaveTextContent('Photo 1 of 6');
    await expect(within(viewer).getAllByText(/Photo 1 of 6/).length).toBe(1);
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(viewer).getByRole('status')).toHaveTextContent('Photo 2 of 6'));
    await expect(within(viewer).getByRole('heading', { name: 'The terrace' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
  },
};

/** The week's hours from today (Thursday) on, a line a day, two ranges on one line, Sunday closed. */
export const Hours: Story = {
  render: () => (
    <Stage width="fill">
      <BusinessHours hours={PLACE.hours} timeZone="Asia/Kolkata" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const days = [...canvasElement.querySelectorAll('dt')].map((day) => day.textContent);
    await expect(days[0]).toContain('Thursday');
    await expect(days.at(-1)).toContain('Wednesday');
  },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Directions in Google Maps (opens in a new tab)' })).toHaveAttribute(
      'href',
      DIRECTIONS.google,
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Other map apps' }));
    const apple = await within(document.body).findByRole('menuitem', {
      name: 'Open in Apple Maps',
    });
    await expect(apple).toHaveAttribute('href', DIRECTIONS.apple);
    await expect(apple).toHaveAttribute('target', '_blank');
    await userEvent.keyboard('{Escape}');
  },
};

/** On an Apple device the page asks for Apple Maps first; Google Maps waits in the menu. */
export const LocationOnApple: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill">
      <BusinessLocation lines={['12, 100 Feet Road, Indiranagar']} directions={DIRECTIONS} mapsApp="apple" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Directions in Apple Maps (opens in a new tab)' })).toHaveAttribute(
      'href',
      DIRECTIONS.apple,
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Other map apps' }));
    await expect(await within(document.body).findByRole('menuitem', { name: 'Open in Google Maps' })).toHaveAttribute(
      'href',
      DIRECTIONS.google,
    );
    await userEvent.keyboard('{Escape}');
  },
};

/** An address with a section's hash opens on it: the tab current and the section scrolled to. */
export const SectionFromHash: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="phone" height="page">
      <BusinessPage {...args} />
    </Stage>
  ),
  beforeEach: () => {
    globalThis.history.replaceState(null, '', '#location');
    return () => {
      globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search);
    };
  },
  play: async ({ canvasElement }) => {
    const tabs = within(within(canvasElement).getByRole('navigation', { name: 'Sections' }));
    await waitFor(() =>
      expect(tabs.getByRole('link', { name: 'Location' })).toHaveAttribute('aria-current', 'location'),
    );
  },
};

/** The menu's sections, names and prices on one line. */
export const Menu: Story = {
  render: () => (
    <Stage width="fill">
      <BusinessMenu sections={MENU} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    // The guest menu's rows: the name, the description, then the price; a dish's photo at the row's end.
    await expect(canvas.getByText('Burnt garlic edamame')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('img')).toHaveLength(1);
  },
};

/** The page's one action: Reserve a table once open; until then Call to book, or Directions with no phone. */
export const Reserve: Story = {
  render: () => {
    const actions = [
      businessAction({ kind: 'open', href: '/somewhere-nowhere/reserve' }, PLACE.phone, DIRECTIONS.google),
      businessAction({ kind: 'soon' }, PLACE.phone, DIRECTIONS.google),
      businessAction({ kind: 'soon' }, undefined, DIRECTIONS.google),
    ];
    return (
      <Stage direction="column">
        {actions.map((action) => action !== undefined && <BusinessReserve key={action.kind} action={action} />)}
      </Stage>
    );
  },
};
