// The meta block a handle address's shell carries (spec 0055, AC-5502): the one place a title, a description, a
// canonical address, a share card and a robots line are worded and escaped. It is plain TypeScript with no Zod and
// no imports from the app, because the Vercel Function that serves `/<handle>` loads it on the server, and because
// a value here is written into HTML: every one goes through `escapeHtml` on its way, with no exception.

/** A page's look, the six names of `PageTheme`, repeated here as `@crm/ui`'s `PageLook` repeats them. */
export interface MetaLook {
  readonly ground: string;
  readonly hue: string;
  readonly mode: string;
  readonly shape: string;
  readonly fill: string;
  readonly font: string;
}

/** What the shell says when a person wrote no bio (AC-5502). */
export const DEFAULT_DESCRIPTION = 'Links, contact details and a time to meet.';

/** What the shell says for an address nobody holds (AC-5508), beside the site's own title. */
export const BRAND_TITLE = 'Timefix';

/** The description for an address nobody holds: the product, never the handle somebody asked for. */
export const BRAND_DESCRIPTION = 'One page for your links, your contact details and a time to meet.';

/** How long a description may be before it is cut (AC-5502). */
export const DESCRIPTION_MAX = 160;

/** The share card's size, the one pair every crawler is told (AC-5510). */
export const CARD_WIDTH = 1200;
/** The share card's height. */
export const CARD_HEIGHT = 630;

/** What the meta block describes: a person's page, or one of their booking pages. */
export type MetaKind = 'profile' | 'website';

/** Everything the block is written from. Every string here may have come from the person, so none is trusted. */
export interface MetaSource {
  /** What the tab and the share preview are titled, before " · Timefix" is added. */
  readonly name: string;
  /** The person's bio, or a booking page's note. Empty falls back to `DEFAULT_DESCRIPTION`. */
  readonly description?: string;
  /** The canonical address on the public origin, already built from `BOOKING_PUBLIC_ORIGIN` and the path. */
  readonly canonical: string;
  /** The share card's address on our own origin, left out while there is none to show. */
  readonly card?: string;
  /** `profile` for `/<handle>`, `website` for `/<handle>/<slug>` (AC-5502). */
  readonly kind: MetaKind;
  /** Whether search engines may show the page (AC-5506). Following links is allowed either way. */
  readonly indexable: boolean;
  /** The look its owner picked, written onto the page root so the first paint is the right colour (AC-5509). */
  readonly look?: MetaLook;
}

/** A string written into HTML: the five characters that could otherwise end an attribute or open a tag. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A description cut to `DESCRIPTION_MAX` (AC-5502). Whitespace collapses to single spaces first, so a bio written
 * over several lines reads as one sentence in a preview, and a cut lands on a word with an ellipsis rather than
 * mid word. An empty description, or one that is only whitespace, becomes `DEFAULT_DESCRIPTION`.
 */
export function describe(text: string | undefined): string {
  const plain = (text ?? '').replace(/\s+/g, ' ').trim();
  if (plain === '') return DEFAULT_DESCRIPTION;
  if (plain.length <= DESCRIPTION_MAX) return plain;
  const cut = plain.slice(0, DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > DESCRIPTION_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** A page's title: the person's name, or a booking page's, and the product (AC-5502). */
export function titleOf(name: string): string {
  const plain = name.replace(/\s+/g, ' ').trim();
  return plain === '' ? BRAND_TITLE : `${plain} · ${BRAND_TITLE}`;
}

/** One `<meta>` tag, or nothing at all when the value is missing, so an absent card writes no empty tag. */
function tag(kind: 'name' | 'property', key: string, value: string | undefined): string {
  return value === undefined ? '' : `    <meta ${kind}="${key}" content="${escapeHtml(value)}" />\n`;
}

/**
 * The block of tags for one page (AC-5502), as lines ready to sit inside `<head>`. The card's three companions
 * (width, height and alt) are written only beside a card, so a shell with no card carries no claim about one.
 */
export function metaTags(source: MetaSource): string {
  const title = titleOf(source.name);
  const description = describe(source.description);
  const card = source.card;
  return [
    `    <title>${escapeHtml(title)}</title>\n`,
    tag('name', 'description', description),
    tag('name', 'robots', source.indexable ? 'index, follow' : 'noindex, follow'),
    `    <link rel="canonical" href="${escapeHtml(source.canonical)}" />\n`,
    tag('property', 'og:type', source.kind),
    tag('property', 'og:title', title),
    tag('property', 'og:description', description),
    tag('property', 'og:url', source.canonical),
    tag('property', 'og:image', card),
    card === undefined ? '' : tag('property', 'og:image:width', String(CARD_WIDTH)),
    card === undefined ? '' : tag('property', 'og:image:height', String(CARD_HEIGHT)),
    card === undefined ? '' : tag('property', 'og:image:alt', title),
    tag('name', 'twitter:card', card === undefined ? 'summary' : 'summary_large_image'),
  ].join('');
}

/** The six attributes a look becomes, and `data-theme`, exactly as `@crm/ui`'s `LinkPage` writes them (AC-5509). */
function lookAttributes(look: MetaLook): string {
  return [
    ['data-theme', look.mode],
    ['data-page-ground', look.ground],
    ['data-page-hue', look.hue],
    ['data-page-mode', look.mode],
    ['data-page-shape', look.shape],
    ['data-page-fill', look.fill],
    ['data-page-font', look.font],
  ]
    .map(([key, value]) => ` ${String(key)}="${escapeHtml(String(value))}"`)
    .join('');
}

/**
 * The built shell with this page's block written into it (AC-5501): the shell's own `<title>` and its `noindex`
 * come out, the block goes in at the end of the head, and the look lands on the `<html>` tag. Nothing else is
 * touched, so the body, the scripts and the styles are the bytes the build made. A shell this can't find its way
 * into comes back unchanged rather than half rewritten, which is the same answer as a read that missed.
 */
export function withMeta(shell: string, source: MetaSource): string {
  const headEnd = shell.indexOf('</head>');
  if (headEnd < 0 || !/<html\b[^>]*>/.test(shell)) return shell;
  const head = shell
    .slice(0, headEnd)
    // The shell's own title and robots line are replaced, never doubled: two of either is two answers.
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\s*\n/, '')
    .replace(/[ \t]*<meta\s+name="robots"[^>]*>\s*\n/, '');
  const look = source.look;
  const rooted =
    look === undefined ? head : head.replace(/<html\b[^>]*>/, (tag) => tag.replace(/>$/, `${lookAttributes(look)}>`));
  return `${rooted}${metaTags(source)}${shell.slice(headEnd)}`;
}
