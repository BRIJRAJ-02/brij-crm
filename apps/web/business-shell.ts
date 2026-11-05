// The handle shell for a business (spec 0066, B4 lite, AC-6644): `/<company-handle>` and `/<company-handle>/<slug>`
// answer the built shell with the business's own meta block (title, description, canonical, the first photo as the
// share image), its structured data (JSON-LD of its schema.org type with its address and opening hours) and the page
// as text inside the root for a crawler that runs no script, plus the boot block so the page draws without asking
// again. Plain functions over a read the caller passes in, so the Node tests run it; `handle-shell.ts` calls it once a
// handle names no person.
import {
  AMENITY_LABELS,
  businessJsonLd,
  placeAddressLine,
  type PublicBusinessPage,
} from '@crm/contracts/business-page';
import { escapeHtml, withMeta, type MetaSource } from './handle-meta.ts';

/** The kind of business in words, for the title and the crawler text. */
const KIND_WORDS: Readonly<Record<PublicBusinessPage['kind'], string>> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
  bakery: 'Bakery',
  salon: 'Salon',
  spa: 'Spa',
  barber: 'Barber',
  clinic: 'Clinic',
  fitness: 'Fitness studio',
  other: 'Business',
};

/** A read answer is parsed here, never trusted by its type: the few fields the shell writes, checked. */
export function businessOf(value: unknown): PublicBusinessPage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const page = value as Record<string, unknown>;
  const text = (key: string) => typeof page[key] === 'string' && page[key] !== '';
  if (!text('handle') || !text('name') || !text('kind') || !text('placeId') || !Array.isArray(page.places)) {
    return undefined;
  }
  if (!Array.isArray(page.gallery) || !Array.isArray(page.amenities) || !Array.isArray(page.tags)) return undefined;
  if (!Object.hasOwn(KIND_WORDS, String(page.kind))) return undefined;
  return value as PublicBusinessPage;
}

/** The place this address shows. */
const placeOf = (page: PublicBusinessPage) => page.places.find((place) => place.id === page.placeId) ?? page.places[0];

/** The page's canonical address: the handle alone for a business with one place, else the place's own. */
export function businessCanonical(page: PublicBusinessPage, origin: string): string {
  const place = placeOf(page);
  return place === undefined || page.places.length <= 1
    ? `${origin}/${encodeURIComponent(page.handle)}`
    : `${origin}/${encodeURIComponent(page.handle)}/${encodeURIComponent(place.slug)}`;
}

/** "Somewhere Nowhere · Restaurant in Bengaluru": the name, then what and where, so a result says both. */
export function businessTitle(page: PublicBusinessPage): string {
  const place = placeOf(page);
  const where = place?.city === undefined || place.city === '' ? '' : ` in ${place.city}`;
  const name = page.places.length > 1 && place !== undefined ? `${page.name} ${place.name}` : page.name;
  return `${name} · ${KIND_WORDS[page.kind]}${where}`;
}

/** What a preview and a result say under the title: the business's own line, else what, where and how to reserve. */
export function businessDescription(page: PublicBusinessPage): string {
  if (page.description !== undefined && page.description.trim() !== '') return page.description;
  const place = placeOf(page);
  const address = place === undefined ? undefined : placeAddressLine(place);
  const reserve = page.reserve === undefined ? '' : ' Reserve a table online.';
  return `${KIND_WORDS[page.kind]}${address === undefined ? '' : ` at ${address}`}.${reserve}`;
}

/** The structured data block, with every `<` and line separator escaped so nothing can close the script. */
export function businessJsonLdBlock(page: PublicBusinessPage, origin: string): string {
  const json = JSON.stringify(businessJsonLd(page, origin))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `    <script type="application/ld+json">${json}</script>\n`;
}

/** The page as simple HTML inside its root, for a crawler that runs no script: replaced when the app draws. */
export function businessCrawlerHtml(page: PublicBusinessPage): string {
  const place = placeOf(page);
  const address = place === undefined ? undefined : placeAddressLine(place);
  const menu = (page.menu?.sections ?? [])
    .map(
      (section) =>
        `<h3>${escapeHtml(section.name)}</h3><ul>${section.items
          .map(
            (item) =>
              `<li>${escapeHtml(item.name)}${item.price === undefined ? '' : ` ${escapeHtml(item.price)}`}${
                item.description === undefined ? '' : ` — ${escapeHtml(item.description)}`
              }</li>`,
          )
          .join('')}</ul>`,
    )
    .join('');
  return [
    `<main data-crawl>`,
    `<h1>${escapeHtml(page.name)}</h1>`,
    `<p>${escapeHtml(KIND_WORDS[page.kind])}</p>`,
    page.description === undefined ? '' : `<p>${escapeHtml(page.description)}</p>`,
    address === undefined ? '' : `<p>${escapeHtml(address)}</p>`,
    menu === '' ? '' : `<h2>Menu</h2>${menu}`,
    page.about === undefined ? '' : `<h2>About</h2><p>${escapeHtml(page.about)}</p>`,
    page.amenities.length === 0
      ? ''
      : `<ul>${page.amenities.map((amenity) => `<li>${escapeHtml(AMENITY_LABELS[amenity])}</li>`).join('')}</ul>`,
    `</main>`,
  ].join('');
}

/** The boot block's business: what the shell read, so the page draws from it at once. */
export interface BusinessBoot {
  readonly kind: 'business';
  readonly page: PublicBusinessPage;
  readonly readAt: number;
}

/**
 * The shell for a business page: its meta block, its structured data (only when search engines may list it), its
 * crawler text inside the root and its boot block. A shell with no root or head comes back with what could be written.
 */
export function businessShell(shell: string, page: PublicBusinessPage, origin: string, readAt: number): string {
  const canonical = businessCanonical(page, origin);
  const card = page.gallery[0];
  const source: MetaSource = {
    name: page.name,
    title: businessTitle(page),
    description: businessDescription(page),
    canonical,
    kind: 'business.business',
    indexable: page.indexable,
    ...(card === undefined || !card.src.startsWith('/api/public/')
      ? {}
      : { card: `${origin}${card.src}`, cardSize: { width: card.width, height: card.height } }),
  };
  const described = withMeta(shell, source);
  const headEnd = described.indexOf('</head>');
  if (headEnd < 0) return described;
  const boot: BusinessBoot = { kind: 'business', page, readAt };
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const preload =
    card !== undefined && card.src.startsWith('/api/public/') && !/["<>]/.test(card.src)
      ? `    <link rel="preload" as="image" href="${escapeHtml(card.src)}" fetchpriority="high">\n`
      : '';
  const head = [
    described.slice(0, headEnd),
    page.indexable ? businessJsonLdBlock(page, origin) : '',
    preload,
    `    <script type="application/json" id="crm-boot">${json}</script>\n`,
  ].join('');
  const body = described
    .slice(headEnd)
    .replace(
      /(<div id="root"[^>]*>)(<\/div>)/,
      (_, open: string, close: string) => `${open}${businessCrawlerHtml(page)}${close}`,
    );
  return `${head}${body}`;
}
