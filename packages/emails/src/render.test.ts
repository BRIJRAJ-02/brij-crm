// The one layout: every block in HTML and in plain text, the dark theme, the
// shared footer, and the sign in code email drawn through it.
import { describe, expect, it } from 'vitest';
import type { EmailDocument } from './document.ts';
import { renderSignInCode, SIGN_IN_CODE_SUBJECT } from './index.ts';
import { documentText, headerText, renderDocument, type RenderOptions } from './render.ts';
import { colorToken } from './tokens.ts';

const ORIGIN = 'https://app.example.com';

/** A document with every kind of block. */
const EVERYTHING: EmailDocument = {
  subject: 'Every block',
  preheader: 'The line an inbox shows',
  eyebrow: 'Acme',
  heading: 'A heading',
  blocks: [
    { type: 'paragraph', text: 'A paragraph.\nIts second line.' },
    {
      type: 'rows',
      layout: 'compact',
      rows: [
        { label: 'When', value: 'Monday 2 November 2026' },
        { label: 'Where', value: 'The call', url: `${ORIGIN}/call` },
      ],
    },
    { type: 'rows', layout: 'stacked', rows: [{ label: 'A long question?', value: 'A long answer.' }] },
    { type: 'code', code: '482913', label: 'Your code' },
    { type: 'quote', text: 'Someone’s words' },
    { type: 'button', label: 'Open it', url: `${ORIGIN}/open` },
    { type: 'note', text: 'A quieter line.' },
  ],
  why: 'You got this email because of a test.',
};

/** The text inside the body, tags and the hidden preheader stripped. */
function visibleText(html: string): string {
  return html
    .replace(/<head>[\s\S]*<\/head>/, '')
    .replace(/<div style="display:none;overflow:hidden;line-height:1px[^"]*">[\s\S]*?<\/div>\s*<\/div>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('the email layout', () => {
  it('draws every block, the preheader and the footer in the HTML', async () => {
    const email = await renderDocument(EVERYTHING, { appOrigin: ORIGIN, medium: 'email_sign_in' });
    expect(email.subject).toBe('Every block');
    expect(email.html).toMatch(/^<!DOCTYPE html/);
    expect(email.html).toMatch(/<html[^>]* lang="en"/);
    expect(email.html).toContain('<title>Every block</title>');
    expect(email.html).toContain('The line an inbox shows');
    const visible = visibleText(email.html);
    for (const words of [
      'Acme',
      'A heading',
      'A paragraph.',
      'Its second line.',
      'When',
      'The call',
      'A long question?',
    ]) {
      expect(visible).toContain(words);
    }
    for (const words of [
      '482913',
      'Someone’s words',
      'Open it',
      'A quieter line.',
      'Powered by',
      'because of a test',
    ]) {
      expect(visible).toContain(words);
    }
    expect(email.html).toContain(`href="${ORIGIN}/open"`);
    expect(email.html).toContain(`href="${ORIGIN}/call"`);
    expect(email.html).toContain('utm_medium=email_sign_in');
    // No preferences link unless the email is optional.
    expect(email.html).not.toContain('Email preferences');
  });

  it('keeps a 600px column: a fixed width for Outlook, fluid up to 600px for everyone else', async () => {
    const { html } = await renderDocument(EVERYTHING, { appOrigin: ORIGIN, medium: 'email_sign_in' });
    expect(html).toMatch(/<table[^>]*width="600"[^>]*style="[^"]*max-width:600px/);
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('font-family: "Segoe UI", sans-serif !important');
  });

  it('paints light inline and dark from its stylesheet, for the system setting and Outlook.com', async () => {
    const { html } = await renderDocument(EVERYTHING, { appOrigin: ORIGIN, medium: 'email_sign_in' });
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain(`background-color:${colorToken('surface-raised', 'light')}`);
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain(`.tf-card { background-color: ${colorToken('surface-raised', 'dark')} !important;`);
    expect(html).toContain(`[data-ogsc] .tf-text { color: ${colorToken('text', 'dark')} !important; }`);
    expect(html).toContain(
      `[data-ogsb] .tf-page { background-color: ${colorToken('surface-subtle', 'dark')} !important; }`,
    );
    // One logo per theme; the dark one hidden until the dark stylesheet shows it, and from Outlook altogether.
    expect(html).toMatch(
      /class="tf-logo-light"[^>]*src="https:\/\/app\.example\.com\/brand\/email\/timefix-wordmark-light\.png"|src="https:\/\/app\.example\.com\/brand\/email\/timefix-wordmark-light\.png"[^>]*class="tf-logo-light"/,
    );
    expect(html).toMatch(/class="tf-logo-dark"[^>]*style="[^"]*display:none[^"]*mso-hide:all/);
  });

  it('leaves out the styles Mailpit’s HTML check found many clients can’t read, where there was a choice', async () => {
    const { html } = await renderDocument(EVERYTHING, { appOrigin: ORIGIN, medium: 'email_sign_in' });
    for (const property of ['opacity', 'outline', 'box-sizing']) expect(html, property).not.toContain(`${property}:`);
    // The preview line is hidden by display and size, and filled with blanks so the inbox stops there.
    expect(html).toMatch(
      /<div style="display:none;overflow:hidden;line-height:1px;max-height:0;max-width:0;mso-hide:all">The line an inbox shows<div>/,
    );
  });

  it('writes a plain text twin with every word and link', async () => {
    const options: RenderOptions = {
      appOrigin: ORIGIN,
      medium: 'email_sign_in',
      preferencesUrl: `${ORIGIN}/email-preferences#t=x`,
    };
    const email = await renderDocument(EVERYTHING, options);
    expect(email.text).toBe(documentText(EVERYTHING, options));
    expect(email.text).toBe(
      [
        'Acme',
        '',
        'A heading',
        '',
        'A paragraph.',
        'Its second line.',
        '',
        'When: Monday 2 November 2026',
        `Where: The call (${ORIGIN}/call)`,
        '',
        'A long question?',
        'A long answer.',
        '',
        'Your code: 482913',
        '',
        '> Someone’s words',
        '',
        `Open it: ${ORIGIN}/open`,
        '',
        'A quieter line.',
        '',
        'Powered by Timefix: https://timefix.ai/?utm_source=timefix&utm_medium=email_sign_in&utm_campaign=powered_by&utm_content=footer_logo',
        'You got this email because of a test.',
        `Email preferences: ${ORIGIN}/email-preferences#t=x`,
      ].join('\n'),
    );
    expect(email.html).toContain('Email preferences');
  });

  it('keeps a subject to one line, so a name can never add a header', async () => {
    expect(headerText('Hello\r\nBcc: someone@evil.example')).toBe('Hello Bcc: someone@evil.example');
    expect(headerText('a b\tc')).toBe('a b c');
    expect(headerText('x'.repeat(300))).toHaveLength(200);
    const email = await renderDocument(
      { ...EVERYTHING, subject: 'One\nTwo' },
      { appOrigin: ORIGIN, medium: 'email_sign_in' },
    );
    expect(email.subject).toBe('One Two');
  });

  it('escapes what people typed, so it reads as text and never as markup', async () => {
    const typed = '<script>alert(1)</script><a href="https://evil.example">x</a>';
    const { html } = await renderDocument(
      { ...EVERYTHING, heading: typed, blocks: [{ type: 'paragraph', text: typed }] },
      { appOrigin: ORIGIN, medium: 'email_sign_in' },
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses a button, a row or a preferences link that leaves the app origin', async () => {
    const options = { appOrigin: ORIGIN, medium: 'email_sign_in' } as const;
    for (const document of [
      { ...EVERYTHING, blocks: [{ type: 'button', label: 'Go', url: 'javascript:alert(1)' }] },
      { ...EVERYTHING, blocks: [{ type: 'button', label: 'Go', url: 'https://app.example.com@evil.example/login' }] },
      {
        ...EVERYTHING,
        blocks: [{ type: 'rows', layout: 'compact', rows: [{ label: 'A', value: 'B', url: 'https://evil.example' }] }],
      },
    ] satisfies EmailDocument[]) {
      await expect(renderDocument(document, options)).rejects.toThrow(/app origin/);
    }
    await expect(
      renderDocument(EVERYTHING, { ...options, preferencesUrl: 'https://evil.example/prefs' }),
    ).rejects.toThrow(/app origin/);
  });
});

describe('the sign in code email', () => {
  it('carries the code in both parts and the preview line, and keeps it out of the subject', async () => {
    const email = await renderSignInCode('482913', { appOrigin: ORIGIN });
    expect(email.subject).toBe(SIGN_IN_CODE_SUBJECT);
    expect(email.subject).not.toContain('482913');
    expect(visibleText(email.html)).toContain('482913');
    expect(email.html).toContain('Your sign in code is 482913. It works for 10 minutes.');
    expect(email.text).toContain('Your sign in code: 482913');
    expect(email.text).toContain('10 minutes');
    expect(email.text).toContain('utm_medium=email_sign_in');
    expect(email.text).toContain('You got this email because someone asked to sign in to Timefix with this address.');
    expect(email.text).not.toContain('Email preferences');
  });

  it('refuses something that isn’t a code, without quoting it', async () => {
    const refused = renderSignInCode('<b>1</b>', { appOrigin: ORIGIN });
    await expect(refused).rejects.toThrow('A sign in code is 4 to 12 letters and digits.');
    await expect(refused).rejects.not.toThrow(/<b>/);
  });
});
