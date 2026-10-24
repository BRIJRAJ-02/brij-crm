import { describe, expect, it } from 'vitest';
import { APP_SLOT, linkedStylesheets, prerenderPage } from './page.ts';

const SHELL = `<!doctype html>
<html><head>
  <title>Home</title>
  <meta name="description" content="Home page" />
  <link rel="canonical" href="https://www.timefix.com/" />
  <meta property="og:url" content="https://www.timefix.com/" />
  <meta property="og:title" content="Home" />
  <meta property="og:description" content="Home page" />
  <link rel="modulepreload" crossorigin href="/assets/vendor.js">
  <link rel="stylesheet" href="/layers.css" id="react-aria-pressable-style">
  <link rel="stylesheet" crossorigin href="/assets/index.css">
  <script type="application/ld+json">{"@type":"Organization"}</script>
  <script type="module" crossorigin src="/assets/index.js"></script>
</head><body>
  <!-- A note for whoever reads the source. -->
  <div id="root">${APP_SLOT}</div>
</body></html>`;

const PRIVACY = { path: '/privacy', title: 'Privacy Policy · Timefix', description: 'What we collect & why.' };

describe('prerenderPage', () => {
  it('writes the markup into the slot and keeps the one module script', () => {
    const page = prerenderPage(SHELL, '<main><h1>Timefix</h1></main>', { ...PRIVACY, path: '/' });
    expect(page).toContain('<div id="root"><main><h1>Timefix</h1></main></div>');
    expect(page.match(/type="module"/g)).toHaveLength(1);
    expect(page).toContain('application/ld+json');
  });

  it('sets the page’s own title, description, canonical address and Open Graph lines', () => {
    const page = prerenderPage(SHELL, '<main></main>', PRIVACY);
    expect(page).toContain('<title>Privacy Policy · Timefix</title>');
    expect(page).toContain('<meta name="description" content="What we collect &amp; why." />');
    expect(page).toContain('<link rel="canonical" href="https://www.timefix.com/privacy" />');
    expect(page).toContain('<meta property="og:url" content="https://www.timefix.com/privacy" />');
    expect(page).toContain('<meta property="og:title" content="Privacy Policy · Timefix" />');
  });

  it('drops the shell’s comments but keeps the markup’s own', () => {
    const page = prerenderPage(SHELL, '<p>a<!-- -->b</p>', PRIVACY);
    expect(page).not.toContain('A note for whoever');
    expect(page).toContain('<p>a<!-- -->b</p>');
  });

  it('refuses a shell without the slot or a head line', () => {
    expect(() => prerenderPage('<div id="root"></div>', '<main></main>', PRIVACY)).toThrow('slot');
    expect(() => prerenderPage(SHELL.replace(/<title>.*<\/title>/, ''), '<main></main>', PRIVACY)).toThrow('title');
  });

  it('refuses a page that would ship another script', () => {
    expect(() => prerenderPage(SHELL, '<script>alert(1)</script>', PRIVACY)).toThrow('one module script');
  });
});

describe('linkedStylesheets', () => {
  it('lists the stylesheets a page links, in order', () => {
    expect(linkedStylesheets(SHELL)).toEqual(['/layers.css', '/assets/index.css']);
  });
});
