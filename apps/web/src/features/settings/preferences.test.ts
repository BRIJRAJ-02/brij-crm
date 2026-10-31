// Settings › Account › Preferences: the choices each select offers, the change
// and Undo each choice makes, and where a workspace opens.
import type { MemberPreferences, ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { landingTarget } from '../workspace/landing.ts';
import {
  dateFormatChoices,
  editOf,
  landingChoices,
  landingId,
  landingOf,
  stillShows,
  weekStartChoices,
} from './preferences.ts';

const DEFAULTS: MemberPreferences = { dateFormat: 'auto', weekStart: 'auto', landing: { kind: 'home' } };

const object = (id: string, apiSlug: string, position: number, isArchived = false) =>
  ({ id, apiSlug, pluralName: apiSlug, position, isArchived }) as unknown as ObjectSummary;
const OBJECTS = [object('b', 'companies', 2), object('a', 'people', 1), object('c', 'old', 3, true)];

describe('the choices', () => {
  it('shows each date format as today reads in it', () => {
    expect(dateFormatChoices('2026-10-22', 'en-US').map((each) => each.label)).toEqual([
      'Automatic (Oct 22, 2026)',
      '22 Oct 2026',
      'Oct 22, 2026',
      '2026-10-22',
    ]);
  });

  it('names the language’s own week start in Automatic', () => {
    // Automatic is Monday whatever the language, as weeks started in round 6.
    expect(weekStartChoices()[0]?.label).toBe('Automatic (Monday)');
    expect(weekStartChoices().map((each) => each.id)).toEqual(['auto', 'monday', 'sunday', 'saturday']);
  });

  it('offers Home, Tasks, then the live objects in the sidebar’s order', () => {
    expect(landingChoices(OBJECTS).map((each) => each.id)).toEqual(['home', 'tasks', 'object:a', 'object:b']);
  });

  it('reads a landing object no longer live as Home', () => {
    expect(landingId({ kind: 'object', objectId: 'a' }, OBJECTS)).toBe('object:a');
    expect(landingId({ kind: 'object', objectId: 'c' }, OBJECTS)).toBe('home');
    expect(landingOf('object:a')).toEqual({ kind: 'object', objectId: 'a' });
    expect(landingOf('tasks')).toEqual({ kind: 'tasks' });
  });
});

describe('a choice’s change and its Undo', () => {
  it('sets a zone, and Undo goes back to the browser’s', () => {
    expect(editOf(DEFAULTS, 'timeZone', 'Asia/Kolkata')).toEqual({
      change: { timeZone: 'Asia/Kolkata' },
      undo: { timeZone: null },
    });
    expect(editOf({ ...DEFAULTS, timeZone: 'Asia/Kolkata' }, 'timeZone', 'browser')).toEqual({
      change: { timeZone: null },
      undo: { timeZone: 'Asia/Kolkata' },
    });
  });

  it('changes nothing when the same choice is picked again', () => {
    expect(editOf(DEFAULTS, 'timeZone', 'browser')).toBeUndefined();
    expect(editOf(DEFAULTS, 'weekStart', 'auto')).toBeUndefined();
    expect(editOf(DEFAULTS, 'landing', 'home')).toBeUndefined();
  });

  it('keeps what it replaced for Undo', () => {
    expect(editOf({ ...DEFAULTS, landing: { kind: 'tasks' } }, 'landing', 'object:a')).toEqual({
      change: { landing: { kind: 'object', objectId: 'a' } },
      undo: { landing: { kind: 'tasks' } },
    });
    expect(editOf(DEFAULTS, 'dateFormat', 'ymd')).toEqual({
      change: { dateFormat: 'ymd' },
      undo: { dateFormat: 'auto' },
    });
  });
});

describe('an Undo that comes late', () => {
  it('goes through only while the choice still shows as it set', () => {
    const edit = editOf(DEFAULTS, 'weekStart', 'monday');
    expect(edit && stillShows({ ...DEFAULTS, weekStart: 'monday' }, edit.change)).toBe(true);
    expect(edit && stillShows(DEFAULTS, edit.change)).toBe(false);
  });
});

describe('where a workspace opens', () => {
  it('goes to Tasks or the chosen object', () => {
    expect(landingTarget({ kind: 'tasks' }, OBJECTS)).toEqual({ kind: 'tasks' });
    expect(landingTarget({ kind: 'object', objectId: 'b' }, OBJECTS)).toEqual({ kind: 'object', apiSlug: 'companies' });
  });

  it('opens Home by default, and for an object no longer live', () => {
    expect(landingTarget(undefined, OBJECTS)).toEqual({ kind: 'home' });
    expect(landingTarget({ kind: 'home' }, OBJECTS)).toEqual({ kind: 'home' });
    expect(landingTarget({ kind: 'object', objectId: 'c' }, OBJECTS)).toEqual({ kind: 'home' });
    expect(landingTarget({ kind: 'tasks' }, [])).toEqual({ kind: 'tasks' });
    expect(landingTarget(undefined, [])).toEqual({ kind: 'home' });
  });

  it('opens a guest on what is shared with them, or on nothing when nothing is (spec 0031, AC-828)', () => {
    expect(landingTarget(undefined, OBJECTS, true)).toMatchObject({ kind: 'object' });
    expect(landingTarget({ kind: 'object', objectId: 'b' }, OBJECTS, true)).toEqual({
      kind: 'object',
      apiSlug: 'companies',
    });
    expect(landingTarget({ kind: 'home' }, [], true)).toEqual({ kind: 'nothing' });
  });
});
