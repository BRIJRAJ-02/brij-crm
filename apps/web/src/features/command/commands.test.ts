// The command menu's browser side (spec 0039): what it lists, in order, the
// words each page answers to, how typing ranks them, the keys that open it,
// and that every address it lists is a route the app has (AC-1104).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { actionCommands, createHref, matchCommands, pageCommands, settingsCommands, viewHref } from './commands.ts';
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
      'Booking pages',
      'Forms',
      'Trash',
      'Settings',
    ]);
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

  it('lists the Settings pages the member may open, by their place in Settings', () => {
    expect(settingsCommands('acme', []).map((command) => command.name)).toEqual([
      'Settings › Preferences',
      'Settings › Calendars',
      'Settings › Members',
      'Settings › Objects',
      'Settings › Background jobs',
    ]);
  });
});

describe('matching what is typed (AC-1077, AC-1082)', () => {
  const all = [...pageCommands('acme', OBJECTS), ...settingsCommands('acme', []), ...actionCommands('acme', OBJECTS)];
  const names = (query: string) => matchCommands(all, query).map((command) => command.name);

  it('finds a page by another word for it', () => {
    expect(names('theme')).toEqual(['Use light theme', 'Use dark theme', 'Use system theme', 'Settings › Preferences']);
    expect(names('deleted')).toEqual(['Trash']);
    expect(names('fields')).toEqual(['Settings › Objects']);
    expect(names('appearance')).toContain('Settings › Preferences');
  });

  it('ranks a name starting with the text, then a word starting with it, then the rest, ignoring case', () => {
    expect(names('COMP')).toEqual(['Companies', 'Create a company']);
    expect(names('set')).toEqual([
      'Settings',
      'Settings › Preferences',
      'Settings › Calendars',
      'Settings › Members',
      'Settings › Objects',
      'Settings › Background jobs',
    ]);
  });

  it('answers every command for blank, and none for nonsense', () => {
    expect(matchCommands(all, '  ')).toHaveLength(all.length);
    expect(names('qqqq')).toEqual([]);
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
      ...actionCommands('acme', OBJECTS),
    ].flatMap((command) => (command.run.kind === 'theme' ? [] : [command.run.href]));
    expect(hrefs.filter((href) => !isRoute(href))).toEqual([]);
    expect(isRoute(createHref('acme', { apiSlug: 'people' }))).toBe(true);
    expect(isRoute(viewHref('acme', 'people', '0199a6f2-0000-7000-8000-000000000001'))).toBe(true);
    expect(isRoute('/w/acme/nowhere')).toBe(false);
  });
});
