// The one email layout, drawn from an `EmailDocument` twice: as HTML (React
// Email, every colour and size from the design tokens, inline) and as plain
// text. A 600px column (a fixed width for Outlook, a fluid one up to 600px
// for everyone else), a card on a quiet ground, and a shared footer: the
// Timefix logo linking to timefix.ai, why the reader got the email, and for
// an optional email the reader's preferences. Layout uses tables throughout,
// since Outlook on Windows draws with Word and ignores most of CSS layout.
import { createElement as h, Fragment, type CSSProperties, type ReactNode } from 'react';
import type { DocumentRow, EmailBlock, EmailDocument } from './document.ts';
import { callUrl, onAppOrigin, poweredByUrl, wordmarkUrls, type EmailMedium } from './links.ts';
import { Button, Container, Head, Heading, Html, Link, Section, Text, renderHtml } from './react-email.ts';
import {
  EMAIL_WIDTH,
  emailStylesheet,
  HAIRLINE,
  LABEL_COLUMN,
  paint,
  RADIUS,
  roleClass,
  SPACE,
  TYPE,
  wordFontStack,
  type Role,
} from './theme.ts';
import { borderWidthToken, pixels, type TypeStyle } from './tokens.ts';

/** What drawing an email needs beyond its words. */
export interface RenderOptions {
  /** The app's origin: where the footer's logo is served from. */
  readonly appOrigin: string;
  /** The footer link's `utm_medium`: `email_` and the family of email. */
  readonly medium: EmailMedium;
  /** The reader's email preferences page: set for an optional email only. */
  readonly preferencesUrl?: string;
}

/** An email ready for a mailer: its subject, HTML and plain text. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Inline styles, with the two Outlook properties React's types don't list. */
type EmailStyle = CSSProperties & { readonly msoLineHeightRule?: 'exactly'; readonly msoHide?: 'all' };

/** A type style as inline CSS, its line height kept exact in Outlook. */
function type(style: TypeStyle): EmailStyle {
  return { ...style, msoLineHeightRule: 'exactly' };
}

/** A role's class name and its light colours: the inline half of the theme (the dark half is the stylesheet). */
function role(name: Role): { readonly className: string; readonly style: EmailStyle } {
  return { className: roleClass(name), style: paint(name) };
}

/** The logo's drawn height: the space token the guest pages draw it at. */
const LOGO_HEIGHT = pixels(SPACE[16]);
/** The wordmark files' shape (860 by 210), so the logo keeps it at any height. */
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 860) / 210);

/** Text that keeps its own line breaks: each line, with a break between. */
function lines(text: string): ReactNode {
  const each = text.split(/\r?\n/);
  return h(
    Fragment,
    null,
    ...each.flatMap((line, index) => (index === 0 ? [line] : [h('br', { key: `b${String(index)}` }), line])),
  );
}

/** A table with no table semantics, for layout only. */
function layoutTable(style: EmailStyle, ...rows: ReactNode[]): ReactNode {
  return h(
    'table',
    { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0, border: 0, style },
    h('tbody', null, ...rows),
  );
}

/** A row's value: plain, or a link on the app's origin. */
function rowValue(row: DocumentRow, origin: string): ReactNode {
  if (row.url === undefined) return lines(row.value);
  const link = role('link');
  return h(
    Link,
    {
      href: onAppOrigin(row.url, origin),
      className: link.className,
      style: { ...link.style, textDecoration: 'underline' },
    },
    row.value,
  );
}

/** Label and value rows, side by side (compact) or the label over its value (stacked). */
function rows(block: Extract<EmailBlock, { type: 'rows' }>, origin: string): ReactNode {
  const label = role('secondary');
  const value = role('text');
  const valueStyle: EmailStyle = { ...type(TYPE.body), ...value.style, wordBreak: 'break-word' };
  if (block.layout === 'compact') {
    return layoutTable(
      {},
      ...block.rows.map((row, index) =>
        h(
          'tr',
          { key: String(index) },
          h(
            'td',
            {
              className: label.className,
              valign: 'top',
              width: pixels(LABEL_COLUMN),
              style: {
                ...type(TYPE.label),
                ...label.style,
                width: LABEL_COLUMN,
                padding: `${SPACE[4]} ${SPACE[12]} ${SPACE[4]} 0`,
                // The label's 16px line sits on the value's 20px one: lowered by half the difference.
                paddingTop: `${String(pixels(SPACE[4]) + (pixels(TYPE.body.lineHeight) - pixels(TYPE.label.lineHeight)) / 2)}px`,
              },
            },
            row.label,
          ),
          h(
            'td',
            { className: value.className, valign: 'top', style: { ...valueStyle, padding: `${SPACE[4]} 0` } },
            rowValue(row, origin),
          ),
        ),
      ),
    );
  }
  return layoutTable(
    {},
    ...block.rows.map((row, index) =>
      h(
        'tr',
        { key: String(index) },
        h(
          'td',
          { style: { padding: index === 0 ? '0' : `${SPACE[12]} 0 0` } },
          h(
            Text,
            {
              className: label.className,
              style: { ...type(TYPE.labelStrong), ...label.style, margin: `0 0 ${SPACE[2]}` },
            },
            row.label,
          ),
          h(Text, { className: value.className, style: { ...valueStyle, margin: '0' } }, rowValue(row, origin)),
        ),
      ),
    ),
  );
}

/** One block of the body. */
function block(item: EmailBlock, origin: string): ReactNode {
  switch (item.type) {
    case 'paragraph': {
      const text = role('text');
      return h(
        Text,
        { className: text.className, style: { ...type(TYPE.body), ...text.style, margin: '0' } },
        lines(item.text),
      );
    }
    case 'note': {
      const note = role('secondary');
      return h(
        Text,
        { className: note.className, style: { ...type(TYPE.body), ...note.style, margin: '0' } },
        lines(item.text),
      );
    }
    case 'rows':
      return rows(item, origin);
    case 'code': {
      const code = role('code');
      return h(
        'table',
        { role: 'presentation', cellPadding: 0, cellSpacing: 0, border: 0 },
        h(
          'tbody',
          null,
          h(
            'tr',
            null,
            h(
              'td',
              {
                className: code.className,
                style: {
                  ...type(TYPE.code),
                  ...code.style,
                  borderRadius: RADIUS.control,
                  padding: `${SPACE[12]} ${SPACE[20]}`,
                  letterSpacing: SPACE[6],
                },
              },
              item.code,
            ),
          ),
        ),
      );
    }
    case 'button':
    case 'callButton': {
      const href = item.type === 'button' ? onAppOrigin(item.url, origin) : callUrl(item.url);
      const button = role('button');
      return h(
        Button,
        {
          href,
          className: button.className,
          style: {
            ...type(TYPE.bodyStrong),
            ...button.style,
            borderStyle: 'solid',
            borderWidth: HAIRLINE,
            borderRadius: RADIUS.control,
            padding: `${SPACE[12]} ${SPACE[20]}`,
          },
        },
        item.label,
      );
    }
    case 'quote': {
      const quote = role('quote');
      return layoutTable(
        {},
        h(
          'tr',
          null,
          h(
            'td',
            {
              className: quote.className,
              style: {
                ...type(TYPE.body),
                ...quote.style,
                borderLeftStyle: 'solid',
                borderLeftWidth: borderWidthToken('border-width-thick'),
                padding: `0 0 0 ${SPACE[12]}`,
              },
            },
            lines(item.text),
          ),
        ),
      );
    }
  }
}

/** Characters that show nothing, after the preheader, so an inbox's preview line stops there and never runs on. */
const PREVIEW_FILL = '\u00a0\u200c\u200b\u200d\u200e\u200f\ufeff';

/** The longest preview line an inbox shows. */
const PREVIEW_MAX = 200;

/**
 * The inbox preview line: hidden in the email itself by display, size and
 * Outlook's `mso-hide`, never by `opacity`, which over a third of clients
 * can't read (Mailpit's HTML check), then filled with blanks to its end.
 */
function preheader(text: string): ReactNode {
  const line = text.slice(0, PREVIEW_MAX);
  return h(
    'div',
    {
      style: {
        display: 'none',
        overflow: 'hidden',
        lineHeight: '1px',
        maxHeight: '0',
        maxWidth: '0',
        msoHide: 'all',
      } satisfies EmailStyle,
    },
    line,
    line.length >= PREVIEW_MAX ? null : h('div', null, PREVIEW_FILL.repeat(PREVIEW_MAX - line.length)),
  );
}

/** The shared footer: the logo (one image per theme), why the reader got this, and their preferences when optional. */
function footer(document: EmailDocument, options: RenderOptions): ReactNode {
  const tertiary = role('tertiary');
  const logos = wordmarkUrls(options.appOrigin);
  // A plain image: React Email's Img adds `outline`, which a fifth of clients can't read (Mailpit's HTML check).
  const logo = (scheme: 'light' | 'dark') =>
    h('img', {
      src: logos[scheme],
      // Inside the link, the image names where it goes with the words beside it: "Powered by Timefix".
      alt: 'Timefix',
      width: LOGO_WIDTH,
      height: LOGO_HEIGHT,
      className: `tf-logo-${scheme}`,
      style: {
        display: scheme === 'light' ? 'inline-block' : 'none',
        verticalAlign: 'middle',
        height: `${String(LOGO_HEIGHT)}px`,
        width: `${String(LOGO_WIDTH)}px`,
        border: '0',
        ...(scheme === 'dark' ? { msoHide: 'all', maxHeight: '0', overflow: 'hidden' } : {}),
      } satisfies EmailStyle,
    });
  const small: EmailStyle = { ...type(TYPE.label), ...tertiary.style, margin: '0' };
  return h(
    Section,
    { style: { paddingTop: SPACE[24] } },
    h(
      'table',
      { role: 'presentation', align: 'center', cellPadding: 0, cellSpacing: 0, border: 0 },
      h(
        'tbody',
        null,
        h(
          'tr',
          null,
          h(
            'td',
            { align: 'center' },
            h(
              Link,
              {
                href: poweredByUrl(options.medium),
                className: tertiary.className,
                style: { ...type(TYPE.label), ...tertiary.style, textDecoration: 'none' },
              },
              h('span', { style: { verticalAlign: 'middle' } }, 'Powered by '),
              logo('light'),
              logo('dark'),
            ),
          ),
        ),
      ),
    ),
    h(
      Text,
      {
        className: tertiary.className,
        style: { ...small, padding: `${SPACE[12]} ${SPACE[16]} 0`, textAlign: 'center' },
      },
      document.why,
    ),
    options.preferencesUrl === undefined
      ? null
      : h(
          Text,
          { style: { ...small, paddingTop: SPACE[4], textAlign: 'center' } },
          h(
            Link,
            {
              href: onAppOrigin(options.preferencesUrl, options.appOrigin),
              className: tertiary.className,
              style: { ...type(TYPE.label), ...tertiary.style, textDecoration: 'underline' },
            },
            'Email preferences',
          ),
        ),
  );
}

/** The whole email as React Email elements. */
function EmailLayout({ document, options }: { readonly document: EmailDocument; readonly options: RenderOptions }) {
  const page = role('page');
  const card = role('card');
  const text = role('text');
  const secondary = role('secondary');
  return h(
    Html,
    { lang: 'en', dir: 'ltr' },
    h(
      Head,
      null,
      h('title', null, document.subject),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('meta', { name: 'color-scheme', content: 'light dark' }),
      h('meta', { name: 'supported-color-schemes', content: 'light dark' }),
      // Phones turn dates, times and addresses into blue links by themselves; the email links what it means to.
      h('meta', { name: 'format-detection', content: 'telephone=no, date=no, address=no, email=no' }),
      h('style', null, emailStylesheet()),
    ),
    h(
      'body',
      { className: page.className, style: { ...page.style, margin: '0', padding: '0' } },
      preheader(document.preheader),
      // The ground is a full width table as well as the body: Yahoo and AOL drop the body's styles, and the dark
      // stylesheet repaints both by their class (React Email's Body copies the colour to a cell it can't name).
      h(
        'table',
        {
          role: 'presentation',
          width: '100%',
          cellPadding: 0,
          cellSpacing: 0,
          border: 0,
          className: page.className,
          style: { ...page.style, fontFamily: TYPE.body.fontFamily },
        },
        h(
          'tbody',
          null,
          h(
            'tr',
            null,
            h(
              'td',
              { align: 'center' },
              h(
                Container,
                {
                  // Outlook on Windows reads the width attribute; everyone else the CSS (fluid, up to 600px).
                  width: EMAIL_WIDTH,
                  tdClassName: 'tf-page-cell',
                  style: { width: '100%', maxWidth: `${String(EMAIL_WIDTH)}px`, padding: `${SPACE[32]} ${SPACE[16]}` },
                },
                h(
                  Section,
                  {
                    className: card.className,
                    tdClassName: 'tf-card-cell',
                    style: {
                      ...card.style,
                      borderStyle: 'solid',
                      borderWidth: HAIRLINE,
                      borderRadius: RADIUS.card,
                      borderCollapse: 'separate',
                      padding: SPACE[32],
                    },
                  },
                  document.eyebrow === undefined
                    ? null
                    : h(
                        Text,
                        {
                          className: secondary.className,
                          style: { ...type(TYPE.labelStrong), ...secondary.style, margin: `0 0 ${SPACE[8]}` },
                        },
                        document.eyebrow,
                      ),
                  h(
                    Heading,
                    {
                      as: 'h1',
                      className: text.className,
                      style: { ...type(TYPE.heading), ...text.style, margin: `0 0 ${SPACE[16]}` },
                    },
                    document.heading,
                  ),
                  layoutTable(
                    {},
                    ...document.blocks.map((item, index) =>
                      h(
                        'tr',
                        { key: String(index) },
                        h(
                          'td',
                          { style: { paddingTop: index === 0 ? '0' : SPACE[16] } },
                          block(item, options.appOrigin),
                        ),
                      ),
                    ),
                  ),
                ),
                footer(document, options),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Word (Outlook on Windows) falls back to Times New Roman for a family it
 * doesn't have, so it gets the tokens' stacks from their first Windows
 * family, in a block only Outlook reads.
 */
function outlookHead(): string {
  return [
    '<!--[if mso]>',
    `<style>body, table, td, p, a, h1, span { font-family: ${wordFontStack('sans')} !important; }</style>`,
    `<style>.tf-code { font-family: ${wordFontStack('mono')} !important; }</style>`,
    '<![endif]-->',
  ].join('');
}

/** The plain text part: the same words in the same order, every link written out. */
export function documentText(document: EmailDocument, options: RenderOptions): string {
  const out: string[] = [];
  if (document.eyebrow !== undefined) out.push(document.eyebrow, '');
  out.push(document.heading, '');
  for (const item of document.blocks) {
    switch (item.type) {
      case 'paragraph':
      case 'note':
        out.push(item.text, '');
        break;
      case 'quote':
        out.push(...item.text.split(/\r?\n/).map((line) => `> ${line}`), '');
        break;
      case 'code':
        out.push(`${item.label}: ${item.code}`, '');
        break;
      case 'button':
        out.push(`${item.label}: ${onAppOrigin(item.url, options.appOrigin)}`, '');
        break;
      case 'callButton':
        out.push(`${item.label}: ${callUrl(item.url)}`, '');
        break;
      case 'rows':
        for (const row of item.rows) {
          const value = row.url === undefined ? row.value : `${row.value} (${onAppOrigin(row.url, options.appOrigin)})`;
          if (item.layout === 'compact') out.push(`${row.label}: ${value}`);
          else out.push(row.label, value, '');
        }
        if (item.layout === 'compact') out.push('');
        break;
    }
  }
  out.push(`Powered by Timefix: ${poweredByUrl(options.medium)}`, document.why);
  if (options.preferencesUrl !== undefined) {
    out.push(`Email preferences: ${onAppOrigin(options.preferencesUrl, options.appOrigin)}`);
  }
  // One blank line at most between parts, and none at the end.
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A header's text on one line: a subject never carries a line break (header injection) and stays short. */
export function headerText(text: string, max = 200): string {
  // Every control character and line or paragraph separator becomes a space: a header is one line of text.
  const one = text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Cut by code points, so a character outside the basic plane (an emoji) is never split in half.
  const points = Array.from(one);
  return points.length <= max
    ? one
    : `${points
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** Draws an email: its subject, its HTML and its plain text. */
export async function renderDocument(document: EmailDocument, options: RenderOptions): Promise<RenderedEmail> {
  // Every link the email carries is checked here, so a template can't send one to another site.
  for (const item of document.blocks) {
    if (item.type === 'button') onAppOrigin(item.url, options.appOrigin);
    if (item.type === 'callButton') callUrl(item.url);
    if (item.type === 'rows')
      for (const row of item.rows) if (row.url !== undefined) onAppOrigin(row.url, options.appOrigin);
  }
  if (options.preferencesUrl !== undefined) onAppOrigin(options.preferencesUrl, options.appOrigin);
  const subject = headerText(document.subject);
  const safe = { ...document, subject };
  const drawn = await renderHtml(h(EmailLayout, { document: safe, options }));
  const html = drawn.replace('</head>', `${outlookHead()}</head>`);
  return { subject, html, text: documentText(safe, options) };
}
