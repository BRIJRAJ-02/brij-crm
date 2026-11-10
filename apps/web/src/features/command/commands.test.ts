// The command menu's browser side (spec 0039): what it lists, in order, the
// words each page answers to, how typing ranks them, the keys that open it,
// and that every address it lists is a route the app has (AC-1104).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { CalendarState, ListView, ObjectSummary, Permission, RecordHit } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  businessCommands,
  actionCommands,
  addToListCommands,
  canConnectCalendar,
  createHref,
  createNamedCommand,
  createTaskCommand,
  matchCommands,
  orderSections,
  pageCommands,
  recordCommands,
  settingsCommands,
  taskDialogHref,
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
  it('mirrors the sidebar: Home, Insights, each object, Bookings and its tabs, the member’s own pages, then Reports, Trash and Settings', () => {
    expect(pageCommands('acme', OBJECTS, undefined, [], false, true).map((command) => command.name)).toEqual([
      'Home',
      'Insights',
      'Companies',
      'People',
      'Deals',
      'Bookings',
      'Availability',
      'Connect a calendar',
      'Booking pages',
      'Forms',
      'Link page',
      'Inbox',
      'Tasks',
      'Notes',
      'Reports',
      'Open trash',
      'Settings',
    ]);
  });

  it('goes where the sidebar’s own pages go', () => {
    const href = (id: string) => {
      const run = pageCommands('acme', OBJECTS).find((command) => command.id === id)?.run;
      return run?.kind === 'go' ? run.href : undefined;
    };
    expect(href('page:insights')).toBe('/w/acme/insights');
    expect(href('page:link-page')).toBe('/w/acme/link-page');
    expect(href('page:inbox')).toBe('/w/acme/inbox');
    expect(href('page:notes')).toBe('/w/acme/notes');
  });

  // A guest's sidebar has no scheduling and no link page (spec 0031, slice 9), so neither has their menu.
  it('leaves out scheduling and the link page for a guest, as their sidebar does', () => {
    const names = pageCommands('acme', OBJECTS, ['booking.manage'], [], true).map((command) => command.name);
    for (const gone of [
      'Bookings',
      'Availability',
      'Calendars',
      'Round robin',
      'Booking pages',
      'Forms',
      'Link page',
    ]) {
      expect(names).not.toContain(gone);
    }
    expect(names).toEqual(expect.arrayContaining(['Home', 'Insights', 'Inbox', 'Tasks', 'Notes']));
  });

  // Round robin is for someone who makes booking pages, as its own page is: hidden means absent (25 October 2026).
  it('offers Bookings settings › Teams only to a member who may make booking pages', () => {
    const names = (permissions: Permission[]) => settingsCommands('acme', permissions).map((each) => each.name);
    expect(names([])).not.toContain('Bookings settings › Teams');
    expect(names(['booking.manage'])).toContain('Bookings settings › Teams');
  });

  // Routing's Settings entry went (9 November 2026): the menu opens its Bookings tab, for holders of routing.manage.
  it('offers Routing only to a holder of routing.manage, at its Bookings tab', () => {
    const routing = (permissions: Permission[]) =>
      pageCommands('acme', OBJECTS, permissions).find((command) => command.id === 'page:routing');
    expect(routing([])).toBeUndefined();
    expect(routing(['routing.manage'])?.run).toEqual({ kind: 'go', href: '/w/acme/bookings/routing' });
  });

  // Critic B (5 November 2026): "calendar" in the menu found nothing to do.
  it('connects a calendar from the menu, in Bookings settings › Calendars', () => {
    const connect = pageCommands('acme', OBJECTS, undefined, [], false, true).find(
      (command) => command.id === 'page:calendars',
    );
    expect(connect?.name).toBe('Connect a calendar');
    expect(connect?.run).toEqual({ kind: 'go', href: '/w/acme/bookings/settings/calendars' });
    const all = [...pageCommands('acme', OBJECTS, undefined, [], false, true), ...settingsCommands('acme', [])];
    expect(
      matchCommands(all, 'calendar')
        .map((command) => command.name)
        .slice(0, 2),
    ).toEqual(['Connect a calendar', 'Bookings settings › Calendars']);
  });

  // 5 November 2026: the menu offered Connect a calendar where the Calendars page has no Connect at all.
  it('leaves Connect a calendar out where it couldn’t connect, so "calendar" finds Bookings settings › Calendars', () => {
    const all = [...pageCommands('acme', OBJECTS), ...settingsCommands('acme', [])];
    expect(all.map((command) => command.name)).not.toContain('Connect a calendar');
    expect(matchCommands(all, 'calendar').map((command) => command.name)[0]).toBe('Bookings settings › Calendars');
    expect(
      pageCommands('acme', OBJECTS, ['booking.manage'], [], true, true).map((command) => command.name),
    ).not.toContain('Connect a calendar');
  });

  it('can connect only with sync on, a provider offered and an account slot free', () => {
    const ready = {
      status: 'ready',
      enabled: true,
      providers: ['google'],
      connections: [],
      max: 2,
    } as const satisfies CalendarState;
    expect(canConnectCalendar(ready)).toBe(true);
    expect(canConnectCalendar({ ...ready, enabled: false })).toBe(false);
    expect(canConnectCalendar({ ...ready, providers: [] })).toBe(false);
    // Every account slot taken (none left of the most a member may hold).
    expect(canConnectCalendar({ ...ready, max: 0 })).toBe(false);
    expect(canConnectCalendar({ status: 'loading' })).toBe(false);
    expect(canConnectCalendar({ status: 'error', message: 'Can’t reach the CRM' })).toBe(false);
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

  it('offers a new note, a new task, a call and a meeting on the record page open, each opening on its tab', () => {
    expect(recordCommands(undefined)).toEqual([]);
    const commands = recordCommands({ slug: 'acme', objectSlug: 'people', recordId: 'r1', name: 'Ada Lovelace' });
    expect(commands.map((command) => command.name)).toEqual([
      'New note on Ada Lovelace',
      'New task on Ada Lovelace',
      'Log a call on Ada Lovelace',
      'Log a meeting on Ada Lovelace',
    ]);
    expect(commands.map((command) => command.run)).toEqual([
      { kind: 'go', href: '/w/acme/objects/people/r1/notes?note=new' },
      { kind: 'go', href: '/w/acme/objects/people/r1/tasks?task=new' },
      { kind: 'go', href: '/w/acme/objects/people/r1/notes?log=call' },
      { kind: 'go', href: '/w/acme/objects/people/r1/notes?log=meeting' },
    ]);
    expect(matchCommands(commands, 'task').map((command) => command.id)).toEqual(['record:task:r1']);
    expect(matchCommands(commands, 'call').map((command) => command.id)).toEqual(['record:call:r1']);
  });

  it('lists the Settings pages the member may open, by their place in Settings', () => {
    expect(settingsCommands('acme', []).map((command) => command.name)).toEqual([
      'Settings › Profile',
      'Settings › Preferences',
      'Settings › Notifications',
      'Settings › Sign in and security',
      'Settings › General',
      'Settings › Brand',
      'Settings › Members',
      'Settings › Teams',
      'Settings › Roles',
      'Settings › Objects',
      'Settings › Lists',
      'Bookings settings › Calendars',
      'Bookings settings › Scheduling access',
      'Bookings settings › Meeting limits',
      'Bookings settings › Brand',
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
      'Settings › Notifications',
      'Settings › Sign in and security',
      'Settings › General',
      'Settings › Brand',
      'Settings › Members',
      'Settings › Teams',
      'Settings › Roles',
      'Settings › Objects',
      'Settings › Lists',
      'Bookings settings › Calendars',
      'Bookings settings › Scheduling access',
      'Bookings settings › Meeting limits',
      'Bookings settings › Brand',
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
      // Notes and tasks found nothing here, so they go last: their own test ranks them.
    ).filter((id) => id !== 'notes' && id !== 'tasks');

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

/** A live list over the first object, for the list commands (spec 0048). */
const LIST: ListView = {
  id: '0199a6f2-0000-7000-8000-0000000000a1',
  objectId: OBJECTS[0]?.id ?? '',
  apiSlug: 'sales_pipeline',
  name: 'Sales pipeline',
  icon: 'list',
  hue: 'gray',
  allowsDuplicates: false,
  isArchived: false,
  canWrite: true,
  canManage: true,
};

describe('lists in the menu (spec 0048, AC-4827)', () => {
  it('lists every live list as a destination found by name, with its object in its kind', () => {
    const pages = pageCommands('acme', OBJECTS, [], [LIST, { ...LIST, id: 'gone', name: 'Old', isArchived: true }]);
    const found = matchCommands(pages, 'pipeline').filter((command) => command.id.startsWith('page:list:'));
    expect(found.map((command) => [command.name, command.kind, command.run])).toEqual([
      [
        'Sales pipeline',
        `List · ${OBJECTS[0]?.pluralName ?? ''}`,
        { kind: 'go', href: '/w/acme/lists/sales_pipeline' },
      ],
    ]);
    expect(matchCommands(pages, 'old').some((command) => command.name === 'Old')).toBe(false);
  });

  it('offers New form to someone who may make forms, so "new form" never makes a person (forms critique c)', () => {
    expect(actionCommands('acme', OBJECTS).some((command) => command.id === 'form:new')).toBe(false);
    const actions = actionCommands('acme', OBJECTS, { canMakeForms: true });
    expect(actions.find((command) => command.id === 'form:new')).toMatchObject({
      name: 'New form',
      run: { kind: 'go', href: '/w/acme/captures/forms?new=form' },
    });
    expect(matchCommands(actions, 'new form')[0]?.id).toBe('form:new');
    expect(matchCommands(actions, 'create form')[0]?.id).toBe('form:new');
  });

  it('offers Create list only to someone who may make one, and Add to list on a record page', () => {
    expect(actionCommands('acme', OBJECTS).some((command) => command.id === 'list:new')).toBe(false);
    expect(
      actionCommands('acme', OBJECTS, { canMakeLists: true }).find((command) => command.id === 'list:new'),
    ).toMatchObject({ name: 'Create list', run: { kind: 'new-list' } });
    const record = { slug: 'acme', objectSlug: 'people', recordId: 'r1', name: 'Ada' };
    expect(addToListCommands(undefined, [LIST])).toEqual([]);
    expect(addToListCommands(record, [LIST]).map((command) => [command.name, command.run])).toEqual([
      ['Add Ada to Sales pipeline', { kind: 'add-to-list', listId: LIST.id, recordId: 'r1' }],
    ]);
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
      // Connect a calendar too, which shows where the Calendars page can connect one.
      ...pageCommands('acme', OBJECTS, undefined, [], false, true),
      ...settingsCommands('acme', []),
      ...actionCommands('acme', OBJECTS, { object: OBJECTS[0], viewId: '0199a6f2-0000-7000-8000-000000000001' }),
      ...pageCommands('acme', OBJECTS, [], [LIST]),
    ].flatMap((command) => ('href' in command.run ? [command.run.href] : []));
    expect(hrefs.filter((href) => !isRoute(href))).toEqual([]);
    expect(isRoute(createHref('acme', { apiSlug: 'people' }))).toBe(true);
    expect(isRoute(taskDialogHref('acme', '/w/acme/home', 'new'))).toBe(true);
    expect(isRoute('/w/acme/notes')).toBe(true);
    expect(isRoute(viewHref('acme', 'people', '0199a6f2-0000-7000-8000-000000000001'))).toBe(true);
    expect(isRoute('/w/acme/nowhere')).toBe(false);
  });
});

describe('notes, tasks and making what nothing matched (the flow pass of 30 Oct 2026)', () => {
  it('ranks notes and tasks by their titles, after the kinds they tie with', () => {
    const found = { records: [], views: [], pages: [], settings: [], actions: [] };
    expect(orderSections({ ...found, notes: [{ title: 'Renewal call' }] }, 'renewal')[0]).toBe('notes');
    expect(orderSections({ ...found, tasks: [{ title: 'Call back about renewal' }] }, 'renewal')[0]).toBe('tasks');
    expect(orderSections(found, 'renewal').slice(-2)).toEqual(['notes', 'tasks']);
  });

  it('opens a task over the page when it holds the dialog, else over Tasks', () => {
    const record = '/w/acme/objects/people/0199a6f2-0000-7000-8000-0000000000b1/overview';
    expect(taskDialogHref('acme', record, 'new')).toBe(`${record}?task=new`);
    expect(taskDialogHref('acme', '/w/acme/inbox', 'new')).toBe('/w/acme/inbox?task=new');
    expect(taskDialogHref('acme', '/w/acme/objects/people/views/0199a6f2-0000-7000-8000-000000000001', 'x')).toBe(
      '/w/acme/tasks?task=x',
    );
    expect(createTaskCommand('acme', '/w/acme/home')).toMatchObject({
      name: 'Create a task',
      run: { kind: 'go', href: '/w/acme/tasks?task=new' },
    });
  });

  it('offers to make what nothing matched on the open object, else People, where it may be written', () => {
    expect(createNamedCommand('acme', OBJECTS, undefined, ' Ada Lovelace ')).toMatchObject({
      name: 'Create person named “Ada Lovelace”',
      run: { kind: 'create', href: '/w/acme/objects/people?new=1&name=Ada%20Lovelace' },
    });
    expect(createNamedCommand('acme', OBJECTS, OBJECTS[1], 'Globex')?.name).toBe('Create company named “Globex”');
    expect(createNamedCommand('acme', OBJECTS, OBJECTS[2], 'Big deal')).toBeUndefined();
    expect(createNamedCommand('acme', OBJECTS, undefined, '  ')).toBeUndefined();
  });
});

describe('switching business (spec 0065 H7)', () => {
  const A = '01900000-0000-7000-8000-0000000000a1';
  const B = '01900000-0000-7000-8000-0000000000b1';
  it('offers each other business from two up, never the one in use, and nothing with one', () => {
    expect(businessCommands([{ id: A, name: 'Harbour' }], A)).toEqual([]);
    const offered = businessCommands(
      [
        { id: A, name: 'Harbour' },
        { id: B, name: 'Bar' },
      ],
      A,
    );
    expect(offered.map((command) => [command.name, command.run])).toEqual([
      ['Switch to Bar', { kind: 'business', propertyId: B }],
    ]);
  });
});
