// The guest menu's shell (spec 0065, H1, AC-6531): `/m/<key>` answers the built `menu.html` with the menu already in
// it, so a phone on slow 4G reads the first dish before any script runs, and a page whose script fails still reads.
// Three additions to the shell, each escaped: the menu as plain HTML inside `#root` (headings, dishes, prices and
// allergens in words; React replaces it when the bundle starts), the read as a boot block the page draws from at once,
// and the menu's look stylesheet linked in the head. A read that fails or is slow (800 ms) serves the plain shell,
// which reads the menu itself. Pure, run in a Node test; `api/menu.mjs` is the entry.
import { formatPrice, isMenuKey, menuCacheTags, menuLookPath, menuWorkspaceTags } from '@crm/contracts/menu';
import type { PublicMenu, SnapshotItem, SnapshotSubsection } from '@crm/contracts';
import { escapeHtml } from './handle-meta.ts';

/** How long the shell waits for the menu before serving the plain shell. */
export const MENU_READ_TIMEOUT_MS = 800;

/** The shell with the menu in it: a minute at the edge, then served stale while it reads again. */
export const MENU_SHELL_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';

/** A shell that couldn't read the menu, or a key that names none: briefly. */
export const MENU_MISSED_CACHE_CONTROL = 'public, max-age=0, s-maxage=10';

/** The id of the boot block the page reads (`public/menu/boot.ts`). */
export const MENU_BOOT_ID = 'crm-menu-boot';

/** What the page reads from the boot block: the menu and when it was read. */
export interface MenuBoot {
  readonly key: string;
  readonly menu: PublicMenu;
  readonly readAt: number;
}

/** What the shell answers. */
export interface MenuShellAnswer {
  readonly body: string;
  readonly status: number;
  readonly outcome: 'menu' | 'unknown' | 'missed';
  /** The edge cache tags the answer is filed under: the place's and the workspace's, which every change forgets. */
  readonly tags?: readonly string[];
}

export interface MenuShellDeps {
  readonly shell: string;
  readonly readMenu: (key: string, signal: AbortSignal) => Promise<PublicMenu | undefined>;
  readonly now?: () => number;
}

/** The key in `/m/<key>`, or undefined. */
export function menuKeyOf(pathname: string): string | undefined {
  const match = /^\/m\/([^/]+)\/?$/.exec(pathname);
  const key = match?.[1];
  return key !== undefined && isMenuKey(key) ? key : undefined;
}

const tag = (name: string, body: string, attributes = '') => `<${name}${attributes}>${body}</${name}>`;

/** One dish as plain HTML: its name, price, description and allergens in words. */
function dishHtml(item: SnapshotItem, menu: PublicMenu, soldOut: ReadonlySet<string>): string {
  const { currency } = menu.menu;
  const { locale } = menu.place;
  const price =
    item.priceMinor !== undefined
      ? formatPrice(item.priceMinor, currency, locale)
      : item.sizes.length > 0
        ? item.sizes.map((size) => `${size.name} ${formatPrice(size.priceMinor, currency, locale)}`).join(' / ')
        : (item.priceNote ?? '');
  const contains = item.allergens.filter((each) => each.level === 'contains').map((each) => each.code);
  const may = item.allergens.filter((each) => each.level === 'may').map((each) => each.code);
  const allergens = [
    contains.length === 0 ? '' : `Contains: ${contains.join(', ')}.`,
    may.length === 0 ? '' : `May contain: ${may.join(', ')}.`,
  ]
    .filter((part) => part !== '')
    .join(' ');
  return tag(
    'li',
    [
      tag('strong', escapeHtml(item.name)),
      price === '' ? '' : ` ${escapeHtml(soldOut.has(item.id) ? 'Sold out' : price)}`,
      item.description === undefined ? '' : tag('p', escapeHtml(item.description)),
      allergens === '' ? '' : tag('p', escapeHtml(allergens)),
    ].join(''),
  );
}

/** A section's heading and dishes. */
function sectionHtml(
  section: SnapshotSubsection,
  level: 2 | 3,
  menu: PublicMenu,
  soldOut: ReadonlySet<string>,
): string {
  const items = section.itemIds
    .map((id) => menu.menu.items[id])
    .filter((item): item is SnapshotItem => item !== undefined);
  return [
    tag(`h${String(level)}`, escapeHtml(section.name)),
    section.description === undefined ? '' : tag('p', escapeHtml(section.description)),
    items.length === 0 ? '' : tag('ul', items.map((item) => dishHtml(item, menu, soldOut)).join('')),
  ].join('');
}

/** The whole menu as plain HTML, for reading before (or without) the script. */
export function menuHtml(menu: PublicMenu): string {
  const soldOut = new Set(menu.soldOut);
  const address = [menu.place.addressLine, menu.place.city, menu.place.postcode]
    .filter((part) => part !== undefined)
    .join(', ');
  return tag(
    'main',
    [
      tag('h1', escapeHtml(menu.business.name)),
      address === '' ? '' : tag('p', escapeHtml(address)),
      ...menu.menu.menus.map((each) =>
        tag(
          'section',
          [
            tag('h2', escapeHtml(each.name)),
            ...each.sections.map(
              (section) =>
                sectionHtml(section, 2, menu, soldOut) +
                section.sections.map((sub) => sectionHtml(sub, 3, menu, soldOut)).join(''),
            ),
            each.note === undefined ? '' : tag('p', escapeHtml(each.note)),
          ].join(''),
        ),
      ),
    ].join(''),
    ' data-menu-shell=""',
  );
}

/** The shell with the boot block and the look stylesheet before `</head>`, and the menu inside `#root`. */
export function withMenu(shell: string, boot: MenuBoot): string {
  const headEnd = shell.indexOf('</head>');
  const rootOpen = /<div id="root"[^>]*>/.exec(shell);
  if (headEnd < 0 || rootOpen === null) return shell;
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const look =
    boot.menu.look === undefined || !/^[0-9a-f]{12}$/.test(boot.menu.look)
      ? ''
      : `    <link rel="stylesheet" id="crm-menu-look" href="${escapeHtml(menuLookPath(boot.key, boot.menu.look))}" />\n`;
  const title = `    <title>${escapeHtml(`${boot.menu.business.name} · Menu`)}</title>\n`;
  const head = `${look}    <script type="application/json" id="${MENU_BOOT_ID}">${json}</script>\n`;
  const withHead = `${shell.slice(0, headEnd).replace(/\s*<title>[^<]*<\/title>\n?/, '\n')}${title}${head}${shell.slice(headEnd)}`;
  const at = withHead.indexOf(rootOpen[0]) + rootOpen[0].length;
  return `${withHead.slice(0, at)}${menuHtml(boot.menu)}${withHead.slice(at)}`;
}

/** The answer for `pathname`: the menu in the shell, the plain shell when the read missed, or not found. */
export async function menuShellFor(pathname: string, deps: MenuShellDeps): Promise<MenuShellAnswer> {
  const key = menuKeyOf(pathname);
  if (key === undefined) return { body: deps.shell, status: 404, outcome: 'unknown' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MENU_READ_TIMEOUT_MS);
  try {
    const menu = await deps.readMenu(key, controller.signal);
    if (menu === undefined) return { body: deps.shell, status: 404, outcome: 'unknown' };
    const now = deps.now ?? Date.now;
    return {
      body: withMenu(deps.shell, { key, menu, readAt: now() }),
      status: 200,
      outcome: 'menu',
      tags: [...menuCacheTags(menu.placeId), ...menuWorkspaceTags(menu.workspaceId)],
    };
  } catch {
    return { body: deps.shell, status: 200, outcome: 'missed' };
  } finally {
    clearTimeout(timer);
  }
}

/** The cache line for an outcome. */
export const menuCacheControlFor = (outcome: MenuShellAnswer['outcome']): string =>
  outcome === 'menu' ? MENU_SHELL_CACHE_CONTROL : MENU_MISSED_CACHE_CONTROL;
