import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '@crm/data';
import { destinationHint } from './destination.ts';

const calendar = (id: string, name: string, changes: Partial<CalendarItem> = {}): CalendarItem => ({
  id,
  connectionId: '00000000-0000-4000-8000-0000000000c1',
  name,
  hue: 'blue',
  accessRole: 'owner',
  isPrimary: false,
  checkConflicts: true,
  showInWeek: true,
  sync: true,
  isDestination: false,
  canBeDestination: true,
  ...changes,
});

const WORK = '00000000-0000-4000-8000-000000000001';
const MAIN = '00000000-0000-4000-8000-000000000002';

describe('destinationHint', () => {
  it('keeps the usual hint while the page follows the default or its own calendar takes bookings', () => {
    expect(destinationHint({ status: 'default', isOwner: true }, [])).toBe('Saves as soon as you choose.');
    expect(destinationHint({ status: 'page', calendarId: WORK, isOwner: true }, [calendar(WORK, 'Work')])).toBe(
      'Saves as soon as you choose.',
    );
  });

  it('names the calendar that stopped and the default the page uses instead', () => {
    const calendars = [
      calendar(WORK, 'Work', { canBeDestination: false }),
      calendar(MAIN, 'Main', { isDestination: true }),
    ];
    expect(destinationHint({ status: 'unusable', calendarId: WORK, isOwner: true }, calendars)).toBe(
      'Your calendar Work stopped taking bookings, so this page uses your default calendar Main.',
    );
  });

  it('names a calendar that went by the name the page kept', () => {
    const calendars = [calendar(MAIN, 'Main', { isDestination: true })];
    expect(destinationHint({ status: 'unusable', removedName: 'Team', isOwner: true }, calendars)).toBe(
      'Your calendar Team stopped taking bookings, so this page uses your default calendar Main.',
    );
  });

  it('says bookings go on no calendar when the default can’t take them either', () => {
    const stopped = [calendar(WORK, 'Work', { canBeDestination: false, isDestination: true })];
    expect(destinationHint({ status: 'unusable', calendarId: WORK, isOwner: true }, stopped)).toBe(
      'Your calendar Work stopped taking bookings, so new bookings on this page go on no calendar until you pick one.',
    );
    expect(destinationHint({ status: 'unusable', isOwner: true }, [])).toBe(
      'Your calendar stopped taking bookings, so new bookings on this page go on no calendar until you pick one.',
    );
  });
});
