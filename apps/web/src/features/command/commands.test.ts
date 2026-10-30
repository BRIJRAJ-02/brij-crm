// The command menu's browser side (spec 0039): what it lists, in order, the
// words each page answers to, how typing ranks them, the keys that open it,
// and that every address it lists is a route the app has (AC-1104).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { ObjectSummary, Permission, RecordHit } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  actionCommands,
  createHref,
  matchCommands,
  orderSections,
  pageCommands,
  recordCommands,
  settingsCommands,
  viewHref,
} from './commands.ts';
import { commandKey, isCommandMenuKey, isSearchKey } from './keys.ts';

const object = (apiSlug: string, singular: string, plural: string, position: number, access: 'read' | 'write') =>
  ({
    id: `0199a6f2-0000-7000-8000-00000000000${String(position)}`,
    apiSlug,
    singularName: singular,
    pluralName: plural,
    icon: 'building',
    hue: 'blue',
    position,
    isArchived: false,
    access,
  }) as unknown as ObjectSummary;

const OBJECTS = [
  object('people', 'Person', 'People', 2, 'write'),
  object('companies', 'Company', 'Companies', 1, 'write'),
  object('deals', 'Deal', 'Deals', 3, 'read'),
];

describe('what the menu lists (AC-1075, AC-1082, AC-1086)', () => {
  it('goes Home, to each object in the workspace’s order, then Tasks, Scheduling’s pages, Trash and Settings', () => {
    expect(pageCommands('acme', OBJECTS).map((command) => command.name)).toEqual([
      'Home',
      'Companies',
      'People',
      'Deals',
      'Tasks',
      'Bookings',
      'Availability',
      'Calendars',
      'Booking pages',
      'Forms',
      'Open trash',
      'Settings',
    ]);
  });

  // Round robin is for someone who makes booking pages, as its own page is: hidden means absent (25 October 2026).
  it('offers Round robin beside Calendars only to a member who may make booking pages', () => {
    const names = (permissions: Permission[]) => pageCommands('acme', OBJECTS, permissions).map((each) => each.name);
    expect(names([])).not.toContain('Round robin');
    expect(names(['booking.manage'])).toContain('Round robin');
    const listed = names(['booking.manage']);
    expect(listed.indexOf('Round robin')).toBe(listed.indexOf('Calendars') + 1);
  });

  it('creates a record only of objects the member may write, then the three themes', () => {
    const actions = actionCommands('acme', OBJECTS);
    expect(actions.map((command) => command.name)).toEqual([
      'Create a company',
      'Create a person',
      'Use light theme',
      'Use dark theme',
      'Use system theme',
    ]);
    expect(actions[0]?.run).toEqual({ kind: 'create', href: '/w/acme/objects/companies?new=1' });
    expect(actions[2]?.run).toEqual({ kind: 'theme', choice: 'light' });
  });

  it('adds the page’s own actions where they apply, and Invite members for those who may', () => {
    const [people] = OBJECTS;
    if (people === undefined) throw new Error('expected an object');
    const names = (place: Parameters<typeof actionCommands>[2]) =>
      actionCommands('acme', OBJECTS, place).map((command) => command.name);
    expect(names({ object: people, viewId: 'v1', canInvite: true })).toEqual([
      'Create a company',
      'Create a person',
      'Import people',
      'Export this view',
      'Create a view',
      'Invite members',
      'Use light theme',
      'Use dark theme',
      'Use system theme',
    ]);
    // Read only: export, but no import; off a view: nothing of the view's.
    expect(names({ object: { ...people, access: 'read' }, viewId: 'v1' })).not.toContain('Import people');
    expect(names({ object: people })).not.toContain('Export this view');
    const exported = actionCommands('acme', OBJECTS, { object: people, viewId: 'v1' }).find(
      (command) => command.id === 'view:export',
    );
    expect(exported?.run).toEqual({ kind: 'go', href: `/w/acme/objects/${people.apiSlug}/views/v1?do=export` });
  });

  it('offers a new note and a new task on the record page open, each opening on its tab', () => {
    expect(recordCommands(undefined)).toEqual([]);
    const commands = recordCommands({ slug: 'acme', objectSlug: 'people', recordId: 'r1', name: 'Ada Lovelace' });
    expect(commands.map((command) => command.name)).toEqual(['New note on Ada Lovelace', 'New task on Ada Lovelace']);
    expect(commands.map((command) => command.run)).toEqual([
      { kind: 'go', href: '/w/acme/objects/people/r1/notes?note=new' },
      { kind: 'go', href: '/w/acme/objects/people/r1/tasks?task=new' },
    ]);
    expect(matchCommands(commands, 'task').map((command) => command.id)).toEqual(['record:task:r1']);
  });

  it('lists the Settings pages the member may open, by their place in Settings', () => {
    expect(settingsCommands('acme', []).map((command) => command.name)).toEqual([
      'Settings › Profile',
      'Settings › Preferences',
      'Settings › Sign in and devices',
      'Settings › Notifications',
      'Settings › Scheduling access',
      'Settings › General',
      'Settings › Members',
      'Settings › Objects',
      'Settings › Background jobs',
      'Settings › History',
    ]);
  });
});

describe('matching what is typed (AC-1077, AC-1082)', () => {
  const all = [...pageCommands('acme', OBJECTS), ...settingsCommands('acme', []), ...actionCommands('acme', OBJECTS)];
  const names = (query: string) => matchCommands(all, query).map((command) => command.name);

  it('finds a page by another word for it', () => {
    expect(names('theme')).toEqual(['Use light theme', 'Use dark theme', 'Use system theme', 'Settings › Preferences']);
    expect(names('deleted')).toEqual(['Open trash']);
    expect(names('fields')).toEqual(['Settings › Objects']);
    expect(names('appearance')).toContain('Settings › Preferences');
  });

  it('ranks a name starting with the text, then a word starting with it, then the rest, ignoring case', () => {
    expect(names('COMP')).toEqual(['Companies', 'Create a company']);
    expect(names('set')).toEqual([
      'Settings',
      'Settings › Profile',
      'Settings › Preferences',
      'Settings › Sign in and devices',
      'Settings › Notifications',
      'Settings › Scheduling access',
      'Settings › General',
      'Settings › Members',
      'Settings › Objects',
      'Settings › Background jobs',
      'Settings › History',
    ]);
  });

  it('answers every command for blank, and none for nonsense', () => {
    expect(matchCommands(all, '  ')).toHaveLength(all.length);
    expect(names('qqqq')).toEqual([]);
  });
});

describe('the order of the sections (AC-1075, AC-1079, decision 6)', () => {
  const pages = pageCommands('acme', OBJECTS);
  const settings = settingsCommands('acme', []);
  const actions = actionCommands('acme', OBJECTS);
  /** The sections for what is typed, with how the server's records matched and its views' names, or `out` while that search is out. */
  const order = (text: string, records: readonly RecordHit['match'][] | 'out' = [], views: readonly string[] = []) =>
    orderSections(
      {
        records: records === 'out' ? undefined : records.map((match) => ({ match })),
        views: records === 'out' ? undefined : views.map((name) => ({ name })),
        pages: matchCommands(pages, text),
        settings: matchCommands(settings, text),
        actions: matchCommands(actions, text),
      },
      text,
    );

  it('shows Recent, Actions and Go to with nothing typed', () => {
    expect(order('')).toEqual(['recent', 'actions', 'pages']);
    expect(order('   ', ['prefix'])).toEqual(['recent', 'actions', 'pages']);
  });

  it('puts the page the text names before a close guess: "trash" opens the trash, not Northwind Traders', () => {
    expect(order('trash', ['similar'])).toEqual(['pages', 'records', 'views', 'settings', 'actions']);
  });

  it('puts an action named by the text before a Settings page found by another word: "dark" runs Use dark theme', () => {
    expect(order('dark')).toEqual(['actions', 'settings', 'records', 'views', 'pages']);
    expect(order('dark', 'out')).toEqual(['records', 'views', 'actions', 'settings', 'pages']);
    expect(order('dark', ['contains'])).toEqual(['actions', 'records', 'settings', 'views', 'pages']);
  });

  it('puts the page the text names before a record holding it mid-word: "deal" opens Deals, not Ideal Standard', () => {
    expect(order('deal', ['contains'])).toEqual(['pages', 'records', 'views', 'settings', 'actions']);
    expect(order('deal', ['similar', 'contains'])[0]).toBe('pages');
  });

  it('keeps a record whose name starts with the text first, ahead of a page it names too', () => {
    expect(order('deal', ['prefix', 'contains'])[0]).toBe('records');
    expect(order('home', ['prefix'])[0]).toBe('records');
    // A word of a record's name starting with it still waits behind a page's name starting with it.
    expect(order('deal', ['word'])[0]).toBe('pages');
    expect(order('acme', ['word', 'similar'])[0]).toBe('records');
  });

  it('keeps Records in its place while its search is out, holding only its "Searching…" row', () => {
    expect(order('deal', 'out')).toEqual(['records', 'views', 'pages', 'settings', 'actions']);
    expect(order('acme', 'out')[0]).toBe('records');
  });

  it('puts a failed search (no records, only its Try again row) after the commands that match', () => {
    expect(order('deal', [])).toEqual(['pages', 'records', 'views', 'settings', 'actions']);
  });

  it('weighs a view by its name the same way', () => {
    expect(order('deal', ['contains'], ['Deal pipeline'])).toEqual([
      'views',
      'pages',
      'records',
      'settings',
      'actions',
    ]);
    expect(order('deal', ['contains'], ['Big deals'])[0]).toBe('pages');
  });

  it('ranks a close guess below any other match, and a mid-word record level with another word for a page', () => {
    expect(order('deleted', ['similar'])).toEqual(['pages', 'records', 'views', 'settings', 'actions']);
    expect(order('person', ['similar'])).toEqual(['actions', 'pages', 'records', 'views', 'settings']);
    expect(order('ash', ['similar'])[0]).toBe('pages');
    // Level: kind order puts the record first.
    expect(order('deleted', ['contains'])[0]).toBe('records');
    expect(order('northwind', ['prefix'])[0]).toBe('records');
  });
});

describe('the keys (AC-1071)', () => {
  const press = (key: string, more: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...more,
  });
  const at = (selector?: string) => ({
    closest: (asked: string) => (selector !== undefined && asked.includes(selector) ? {} : null),
  });

  it('opens on ⌘K on a Mac and Ctrl+K elsewhere, even in a text field, and closes on it again', () => {
    expect(isCommandMenuKey(press('k', { metaKey: true }), 'mac')).toBe(true);
    expect(isCommandMenuKey(press('k', { ctrlKey: true }), 'mac')).toBe(false);
    expect(isCommandMenuKey(press('K', { ctrlKey: true }), 'other')).toBe(true);
    expect(isCommandMenuKey(press('k', { metaKey: true, shiftKey: true }), 'mac')).toBe(false);
    expect(commandKey(press('k', { metaKey: true }), at('input'), 'mac', false)).toEqual({
      kind: 'open',
      mode: 'commands',
    });
    expect(commandKey(press('k', { metaKey: true }), at('[role="dialog"]'), 'mac', true)).toEqual({ kind: 'close' });
    // Never on top of another dialog the person is in.
    expect(commandKey(press('k', { metaKey: true }), at('[role="dialog"]'), 'mac', false)).toBeUndefined();
  });

  it('opens search on / outside text fields, editors and dialogs only', () => {
    expect(isSearchKey(press('/'))).toBe(true);
    expect(isSearchKey(press('/', { metaKey: true }))).toBe(false);
    expect(commandKey(press('/'), at(), 'mac', false)).toEqual({ kind: 'open', mode: 'search' });
    expect(commandKey(press('/'), at('input'), 'mac', false)).toBeUndefined();
    expect(commandKey(press('/'), at('[role="dialog"]'), 'mac', false)).toBeUndefined();
    expect(commandKey(press('/'), at(), 'mac', true)).toBeUndefined();
  });
});

describe('every address the menu lists is a route (AC-1104)', () => {
  /** Each route file as a pattern: `w.$slug.objects.$object_.views.$viewId.tsx` is `/w/<any>/objects/<any>/views/<any>`. */
  const routes = readdirSync(path.join(import.meta.dirname, '../../routes'))
    .filter((file) => file.endsWith('.tsx') && !file.startsWith('__'))
    .map((file) => {
      const segments = file
        .replace(/\.tsx$/u, '')
        .split('.')
        .filter((segment) => segment !== 'index')
        .map((segment) => segment.replace(/_$/u, ''))
        .map((segment) => (segment.startsWith('$') ? '[^/]+' : segment));
      return new RegExp(`^/${segments.join('/')}/?$`, 'u');
    });
  const isRoute = (href: string) => routes.some((route) => route.test(href.split('?')[0] ?? href));

  it('resolves every page, Settings page and action', () => {
    const hrefs = [
      ...pageCommands('acme', OBJECTS),
      ...settingsCommands('acme', []),
      ...actionCommands('acme', OBJECTS, { object: OBJECTS[0], viewId: '0199a6f2-0000-7000-8000-000000000001' }),
    ].flatMap((command) => ('href' in command.run ? [command.run.href] : []));
    expect(hrefs.filter((href) => !isRoute(href))).toEqual([]);
    expect(isRoute(createHref('acme', { apiSlug: 'people' }))).toBe(true);
    expect(isRoute(viewHref('acme', 'people', '0199a6f2-0000-7000-8000-000000000001'))).toBe(true);
    expect(isRoute('/w/acme/nowhere')).toBe(false);
  });
});
