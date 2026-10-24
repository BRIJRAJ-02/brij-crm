// The pure half of the prerender step, kept apart so page.test.ts can check it without a build.

/** The marker in index.html's #root that a rendered page replaces. */
export const APP_SLOT = '<!--app-->';

/** The site's own origin, for each page's canonical address. */
export const SITE_ORIGIN = 'https://www.timefix.com';

/** What a page's head says about it. */
export interface PageHead {
  readonly path: string;
  readonly title: string;
  readonly description: string;
}

/** An HTML comment, other than the app slot: the shell's notes for whoever reads the source. */
const COMMENT = /\s*<!--(?!app-->)[\s\S]*?-->/g;

/** Text made safe inside an HTML attribute or element. */
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** `html` with `pattern` replaced, or an error naming what the shell is missing. */
function swap(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) throw new Error(`The shell has no ${what}.`);
  return html.replace(pattern, replacement);
}

/**
 * `shell` (the client build's index.html) as one page: its head's title, description, canonical and Open Graph
 * lines set for `head`, `markup` in its app slot, and the shell's comments gone. Throws when the shell is missing a
 * slot or a head line, or when it would ship anything but its one module script (and structured data).
 */
export function prerenderPage(shell: string, markup: string, head: PageHead): string {
  if (!shell.includes(APP_SLOT)) throw new Error(`The shell has no ${APP_SLOT} slot.`);
  const url = `${SITE_ORIGIN}${head.path}`;
  const title = escape(head.title);
  const description = escape(head.description);
  let page = shell.replace(COMMENT, '');
  page = swap(page, /<title>[^<]*<\/title>/, `<title>${title}</title>`, 'title');
  page = swap(page, /(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${description}$2`, 'description');
  page = swap(page, /(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`, 'canonical link');
  page = swap(page, /(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`, 'og:url');
  page = swap(page, /(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`, 'og:title');
  page = swap(page, /(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${description}$2`, 'og:description');
  page = page.replace(APP_SLOT, markup);
  const scripts = page.match(/<script\b[^>]*>/g) ?? [];
  const modules = scripts.filter((tag) => tag.includes('type="module"'));
  const stray = scripts.filter((tag) => !tag.includes('type="module"') && !tag.includes('type="application/ld+json"'));
  if (modules.length !== 1 || stray.length > 0) {
    throw new Error(`The page must ship exactly its one module script, but has: ${scripts.join(', ')}`);
  }
  return page;
}

/** The site paths of the stylesheets `page` links, in order. */
export function linkedStylesheets(page: string): string[] {
  return [...page.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].flatMap((match) => {
    const href = /\bhref="([^"]+)"/.exec(match[0])?.[1];
    return href === undefined ? [] : [href];
  });
}
