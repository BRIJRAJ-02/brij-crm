import { describe, expect, it } from 'vitest';
import {
  CalendarConnectionView,
  ChangeEvent,
  MeetingCursor,
  MeetingView,
  RemoveCalendarConnectionInput,
  UpdateCalendarConnectionInput,
} from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-19T09:30:00.000Z';

describe('calendar shapes (spec 0024)', () => {
  it('carries a connection without any token', () => {
    const view = CalendarConnectionView.parse({
      id: ID,
      provider: 'google',
      accountEmail: 'ada@example.com',
      status: 'connected',
      sharing: 'shared',
      isDefault: true,
      createdAt: AT,
      // A stray field never survives the parse.
      tokens: 'secret',
    });
    expect(view).not.toHaveProperty('tokens');
  });

  it('takes only the changes it names, and making a connection the default only as true', () => {
    const base = { workspace: 'acme', connectionId: ID, mutationId: ID };
    expect(UpdateCalendarConnectionInput.safeParse({ ...base, sharing: 'private' }).success).toBe(true);
    expect(UpdateCalendarConnectionInput.safeParse({ ...base, isDefault: true }).success).toBe(true);
    expect(UpdateCalendarConnectionInput.safeParse({ ...base, isDefault: false }).success).toBe(false);
    expect(UpdateCalendarConnectionInput.safeParse({ ...base, sharing: 'public' }).success).toBe(false);
    expect(RemoveCalendarConnectionInput.safeParse({ workspace: 'acme', connectionId: ID }).success).toBe(false);
  });

  it('shows a hidden private meeting with its time only', () => {
    const view = MeetingView.parse({
      id: ID,
      title: 'Private meeting',
      startsAt: AT,
      endsAt: AT,
      allDay: false,
      status: 'confirmed',
      isPrivate: true,
      detailsHidden: true,
      attendees: [],
    });
    expect(view.videoUrl).toBeUndefined();
  });

  it('parses a meetings change event and a meeting cursor', () => {
    const event = ChangeEvent.parse({ seq: 3, at: AT, kind: 'meetings', recordIds: [ID], meetingIds: [ID] });
    expect(event.kind).toBe('meetings');
    expect(MeetingCursor.safeParse({ now: AT, phase: 'past', startsAt: AT, id: ID }).success).toBe(false);
    expect(
      MeetingCursor.safeParse({
        now: '2026-10-19T09:30:00.000000Z',
        phase: 'upcoming',
        startsAt: '2026-10-20T09:30:00.000000Z',
        id: ID,
      }).success,
    ).toBe(true);
  });
});
