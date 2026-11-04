// The guest menu's shell (spec 0065, H1, AC-6531): the menu is in the HTML for reading before the script, escaped,
// with its look linked and the read left as a boot block; a missed read serves the plain shell, a bad key not found.
import type { PublicMenu } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { menuKeyOf, menuShellFor, MENU_BOOT_ID, MENU_HIDDEN_LINE } from './menu-shell.ts';

const SHELL = `<!doctype html><html><head>\n    <title>Menu · Timefix</title>\n</head><body><div id="root" data-app-root></div></body></html>`;
const KEY = 'AbCdEfGhIjKlMnOp';
const ITEM = '0199f0a0-0000-7000-8000-000000000001';

const MENU: PublicMenu = {
  placeId: '0199f0a0-0000-7000-8000-0000000000aa',
  cacheId: '0123456789abcdef0123456789abcdef',
  version: 1,
  business: { name: 'Somewhere <Nowhere>' },
  place: {
    name: 'Soho',
    city: 'London',
    timeZone: 'Europe/London',
    locale: 'en-GB',
    hours: { weekly: {}, exceptions: [] },
  },
  look: '0123456789ab',
  menu: {
    currency: 'GBP',
    menus: [
      {
        id: '0199f0a0-0000-7000-8000-000000000002',
        name: 'Dinner',
        sections: [
          {
            id: '0199f0a0-0000-7000-8000-000000000003',
            name: 'Small plates',
            layout: 'list',
            itemIds: [ITEM],
            sections: [],
          },
        ],
      },
    ],
    items: {
      [ITEM]: {
        id: ITEM,
        name: 'Burrata </script><script>alert(1)</script>',
        priceMinor: 1150,
        diet: [],
        allergens: [{ code: 'milk', level: 'contains' }],
        featured: false,
        sizes: [],
        groupIds: [],
      },
    },
    groups: {},
  },
  soldOut: [],
};

describe('the guest menu shell', () => {
  it('reads only a menu key from the path', () => {
    expect(menuKeyOf(`/m/${KEY}`)).toBe(KEY);
    expect(menuKeyOf(`/m/${KEY}/`)).toBe(KEY);
    expect(menuKeyOf('/m/short')).toBeUndefined();
    expect(menuKeyOf(`/m/${KEY}/more`)).toBeUndefined();
  });

  it('writes the menu into #root, escaped, with its look and the boot block in the head', async () => {
    const answer = await menuShellFor(`/m/${KEY}`, {
      shell: SHELL,
      readMenu: () => Promise.resolve(MENU),
      now: () => 5,
    });
    expect(answer).toMatchObject({
      status: 200,
      outcome: 'menu',
      tags: ['menu:0199f0a0-0000-7000-8000-0000000000aa', 'menu-ws:0123456789abcdef0123456789abcdef'],
    });
    expect(answer.body).toContain('<h1>Somewhere &lt;Nowhere&gt;</h1>');
    expect(answer.body).toContain('£11.50');
    expect(answer.body).toContain('Contains: milk.');
    expect(answer.body).toContain(`href="/api/public/menu/${KEY}/look.css?v=0123456789ab"`);
    expect(answer.body).toContain(`id="${MENU_BOOT_ID}"`);
    expect(answer.body).toContain('<title>Somewhere &lt;Nowhere&gt; · Menu</title>');
    // Nothing a menu says can close an element: the dish's name stays text in the HTML and in the boot block.
    expect(answer.body).not.toContain('<script>alert(1)</script>');
    expect(answer.body.indexOf('<main data-menu-shell')).toBeGreaterThan(answer.body.indexOf('<div id="root"'));
  });

  it('serves the plain shell when the read fails, and not found for a menu that isn’t there', async () => {
    expect(
      await menuShellFor(`/m/${KEY}`, { shell: SHELL, readMenu: () => Promise.reject(new Error('down')) }),
    ).toEqual({ body: SHELL, status: 200, outcome: 'missed' });
    expect(await menuShellFor(`/m/${KEY}`, { shell: SHELL, readMenu: () => Promise.resolve(undefined) })).toEqual({
      body: SHELL,
      status: 404,
      outcome: 'unknown',
    });
    expect((await menuShellFor('/m/bad', { shell: SHELL, readMenu: () => Promise.resolve(MENU) })).status).toBe(404);
  });

  it('says a hidden menu isn’t available, under the business’s name, with no dish in the page', async () => {
    const hidden: PublicMenu = {
      ...MENU,
      menu: { currency: 'GBP', menus: [], items: {}, groups: {} },
      hidden: true,
    };
    const answer = await menuShellFor(`/m/${KEY}`, { shell: SHELL, readMenu: () => Promise.resolve(hidden) });
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('<h1>Somewhere &lt;Nowhere&gt;</h1>');
    expect(answer.body).toContain(MENU_HIDDEN_LINE);
    expect(answer.body).not.toContain('Burrata');
  });
});
