// Settings › Account › Preferences: the choices each select offers and the
// change each choice makes, kept pure so the screen and its tests share them.
import type {
  DateFormat,
  LandingPage,
  MemberPreferences,
  ObjectSummary,
  PreferencesChange,
  WeekStart,
} from '@crm/data';
import { formatDate } from '@crm/ui';
import { navObjects } from '../workspace/objects.ts';
import { strings } from './preferences-strings.ts';

/** The id the time zone select gives "follow this browser". */
export const BROWSER_ZONE = 'browser';

/** One choice in a select. */
export interface Choice {
  readonly id: string;
  readonly label: string;
}

/** Each date format, written as today's date would read in it: "Automatic (Oct 22, 2026)", "22 Oct 2026". */
export function dateFormatChoices(today: string, locale: string): readonly Choice[] {
  const formats: readonly DateFormat[] = ['dmy', 'mdy', 'ymd'];
  return [
    { id: 'auto', label: strings.automatic(formatDate(today, locale, 'auto')) },
    ...formats.map((format) => ({ id: format, label: formatDate(today, locale, format) })),
  ];
}

/** The week starts: Automatic (Monday, as weeks started in round 6), then Monday, Sunday and Saturday. */
export function weekStartChoices(): readonly Choice[] {
  return [
    { id: 'auto', label: strings.automatic(strings.monday) },
    { id: 'monday', label: strings.monday },
    { id: 'sunday', label: strings.sunday },
    { id: 'saturday', label: strings.saturday },
  ];
}

/** The landing pages: Home, Tasks, then each live object in the sidebar's order. */
export function landingChoices(objects: readonly ObjectSummary[]): readonly Choice[] {
  return [
    { id: 'home', label: strings.home },
    { id: 'tasks', label: strings.tasks },
    ...navObjects(objects).map((object) => ({ id: `object:${object.id}`, label: object.pluralName })),
  ];
}

/** A landing page as its select's id. An object no longer live reads as Home, where the workspace now opens. */
export function landingId(landing: LandingPage, objects: readonly ObjectSummary[]): string {
  if (landing.kind !== 'object') return landing.kind;
  return navObjects(objects).some((object) => object.id === landing.objectId) ? `object:${landing.objectId}` : 'home';
}

/** A landing select's id as the page it names. */
export function landingOf(id: string): LandingPage {
  if (id.startsWith('object:')) return { kind: 'object', objectId: id.slice('object:'.length) };
  return id === 'tasks' ? { kind: 'tasks' } : { kind: 'home' };
}

/** True while `preferences` still show every field `change` set: an Undo for an older change does nothing. */
export function stillShows(preferences: MemberPreferences, change: PreferencesChange): boolean {
  return (Object.keys(change) as (keyof PreferencesChange)[]).every(
    (field) => JSON.stringify(preferences[field] ?? null) === JSON.stringify(change[field] ?? null),
  );
}

/** What one choice changes, with what puts it back (the toast's Undo). */
export interface PreferenceEdit {
  readonly change: PreferencesChange;
  readonly undo: PreferencesChange;
}

/**
 * The change a select (or the Setup checklist switch, `on` or `off`) makes from `before`, or undefined when it picks
 * what is already there.
 */
export function editOf(
  before: MemberPreferences,
  field: 'timeZone' | 'dateFormat' | 'weekStart' | 'landing' | 'homeSetup',
  id: string,
): PreferenceEdit | undefined {
  switch (field) {
    case 'timeZone': {
      const next = id === BROWSER_ZONE ? null : id;
      const was = before.timeZone ?? null;
      return next === was ? undefined : { change: { timeZone: next }, undo: { timeZone: was } };
    }
    case 'dateFormat':
      return id === before.dateFormat
        ? undefined
        : { change: { dateFormat: id as DateFormat }, undo: { dateFormat: before.dateFormat } };
    case 'weekStart':
      return id === before.weekStart
        ? undefined
        : { change: { weekStart: id as WeekStart }, undo: { weekStart: before.weekStart } };
    case 'landing': {
      const next = landingOf(id);
      return JSON.stringify(next) === JSON.stringify(before.landing)
        ? undefined
        : { change: { landing: next }, undo: { landing: before.landing } };
    }
    case 'homeSetup': {
      // Only the checklist's key moves; any other Home section put away stays put away.
      const hidden = before.homeHidden ?? [];
      const others = hidden.filter((key) => key !== 'setup');
      const isOn = id === 'on';
      return isOn === !hidden.includes('setup')
        ? undefined
        : { change: { homeHidden: isOn ? others : [...others, 'setup'] }, undo: { homeHidden: hidden } };
    }
  }
}
