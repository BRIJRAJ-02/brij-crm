import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '@crm/data';
import { destinationChoice, destinationHint, noVideoLinkReason } from './destination.ts';

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
      'Your calendar Work stopped taking bookings. Using Main for now.',
    );
  });

  it('names a calendar that went by the name the page kept', () => {
    const calendars = [calendar(MAIN, 'Main', { isDestination: true })];
    expect(destinationHint({ status: 'unusable', removedName: 'Team', isOwner: true }, calendars)).toBe(
      'Your calendar Team stopped taking bookings. Using Main for now.',
    );
  });

  it('says bookings go on no calendar when the default can’t take them either', () => {
    const stopped = [calendar(WORK, 'Work', { canBeDestination: false, isDestination: true })];
    expect(destinationHint({ status: 'unusable', calendarId: WORK, isOwner: true }, stopped)).toBe(
      'Your calendar Work stopped taking bookings. Pick another.',
    );
    expect(destinationHint({ status: 'unusable', isOwner: true }, [])).toBe(
      'Your calendar stopped taking bookings. Pick another.',
    );
  });
});

describe('destinationChoice', () => {
  it('shows the page’s own calendar, and saves only a change', () => {
    const choice = destinationChoice({ status: 'page', calendarId: WORK, isOwner: true });
    expect(choice.value).toBe(WORK);
    expect(choice.send(WORK)).toBeUndefined();
    expect(choice.send('default')).toBeNull();
    expect(choice.send(MAIN)).toBe(MAIN);
  });

  it('shows a stopped pick as the default, keeping it the page’s pick to go back to (AC-997)', () => {
    const choice = destinationChoice({ status: 'unusable', calendarId: WORK, isOwner: true });
    expect(choice.value).toBe('default');
    // The Select shows Default, so it fires only for another calendar; that one replaces the stopped pick.
    expect(choice.send(MAIN)).toBe(MAIN);
  });

  it('shows no value for a pick that went, so choosing Default fires and clears the note', () => {
    const choice = destinationChoice({ status: 'unusable', removedName: 'Team', isOwner: true });
    expect(choice.value).toBeNull();
    expect(choice.send('default')).toBeNull();
    expect(choice.send(null)).toBeUndefined();
  });

  it('changes nothing when the default is chosen again', () => {
    expect(destinationChoice({ status: 'default', isOwner: true }).send('default')).toBeUndefined();
  });
});

describe('noVideoLinkReason (Q57, Q77)', () => {
  it('says so on the reader’s own one on one page with no live calendar', () => {
    expect(noVideoLinkReason({ kind: 'personal', isOwner: true, connections: [] })).toBe('none');
    expect(noVideoLinkReason({ kind: 'personal', isOwner: true, connections: ['revoked'] })).toBe('none');
    // An expired account is listed as needing reconnecting: the line says so.
    expect(noVideoLinkReason({ kind: 'personal', isOwner: true, connections: ['revoked', 'expired'] })).toBe(
      'reconnect',
    );
  });

  it('stays quiet with a live calendar, which still makes links while its sync fails', () => {
    for (const status of ['syncing', 'connected', 'failed']) {
      expect(noVideoLinkReason({ kind: 'personal', isOwner: true, connections: ['expired', status] })).toBe(undefined);
    }
  });

  it('stays quiet on a colleague’s page, a team page, and while a read is on its way', () => {
    expect(noVideoLinkReason({ kind: 'personal', isOwner: false, connections: [] })).toBe(undefined);
    expect(noVideoLinkReason({ kind: 'round_robin', isOwner: true, connections: [] })).toBe(undefined);
    expect(noVideoLinkReason({ kind: 'collective', isOwner: true, connections: [] })).toBe(undefined);
    expect(noVideoLinkReason({ kind: 'personal', isOwner: undefined, connections: [] })).toBe(undefined);
    expect(noVideoLinkReason({ kind: 'personal', isOwner: true, connections: undefined })).toBe(undefined);
  });
});
