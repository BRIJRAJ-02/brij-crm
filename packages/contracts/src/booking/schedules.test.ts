// Availability schedules' shared schemas (spec 0035): a write's hours on the quarter hour (AC-961), a name of 1 to 60
// characters, and for one release the old hours keys a stale tab may still send refused, never dropped (AC-975).
import { describe, expect, it } from 'vitest';
import { UpdateBookingPageInput, UpdateMemberHoursInput } from './pages.ts';
import {
  CreateScheduleInput,
  hasNoHours,
  isQuarterHour,
  NO_HOURS_AT_ALL,
  ScheduleHours,
  ScheduleName,
  UpdateScheduleInput,
} from './schedules.ts';
import { defaultAvailability } from './settings.ts';

const WORKSPACE = 'acme';
const ID = '0190f0f0-0000-7000-8000-000000000001';
const MUTATION = '0190f0f0-0000-7000-8000-000000000002';

describe('schedule hours', () => {
  it('takes times on the quarter hour, the day’s end included', () => {
    expect(['00:00', '09:15', '12:30', '17:45', '24:00'].every(isQuarterHour)).toBe(true);
    expect(['09:10', '17:59', '00:01'].some(isQuarterHour)).toBe(false);
  });

  it('refuses a week with no hours at all, unless a date override opens one', () => {
    // The owner, 27 October 2026: a page on such a schedule offers an empty calendar for ever and says nothing.
    const hours = defaultAvailability('Asia/Kolkata');
    const empty = { ...hours, weekly: Object.fromEntries(Object.keys(hours.weekly).map((day) => [day, []])) };
    expect(hasNoHours(empty)).toBe(true);
    const refused = ScheduleHours.safeParse(empty);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({ path: ['weekly'], message: NO_HOURS_AT_ALL });

    // One open date is enough: the page books on it and nothing else.
    const onlyADate = { ...empty, overrides: [{ date: '2026-12-24', ranges: [['09:00', '12:00']] }] };
    expect(ScheduleHours.safeParse(onlyADate).success).toBe(true);

    // A date override that closes a day is not hours, so an otherwise empty week is still refused.
    const closedOnly = { ...empty, overrides: [{ date: '2026-12-24', ranges: [] }] };
    expect(ScheduleHours.safeParse(closedOnly).success).toBe(false);
  });

  it('refuses a write whose week or date override is off the quarter hour, naming the range', () => {
    const hours = defaultAvailability('Asia/Kolkata');
    expect(ScheduleHours.safeParse(hours).success).toBe(true);
    const offWeek = ScheduleHours.safeParse({ ...hours, weekly: { ...hours.weekly, tue: [['09:10', '17:00']] } });
    expect(offWeek.success).toBe(false);
    expect(offWeek.error?.issues[0]).toMatchObject({
      path: ['weekly', 'tue', 0],
      message: 'Use times on the quarter hour, such as 09:15.',
    });
    const offDate = ScheduleHours.safeParse({
      ...hours,
      overrides: [{ date: '2026-11-03', ranges: [['13:00', '13:50']] }],
    });
    expect(offDate.error?.issues[0]?.path).toEqual(['overrides', 0, 'ranges', 0]);
  });

  it('holds every write of hours to it: a schedule made, changed, or the default saved', () => {
    const offStep = {
      ...defaultAvailability('UTC'),
      weekly: { ...defaultAvailability('UTC').weekly, mon: [['08:05', '09:00']] },
    };
    expect(
      CreateScheduleInput.safeParse({
        workspace: WORKSPACE,
        id: ID,
        name: 'Evenings',
        timeZone: 'UTC',
        availability: offStep,
        mutationId: MUTATION,
      }).success,
    ).toBe(false);
    expect(
      UpdateScheduleInput.safeParse({
        workspace: WORKSPACE,
        id: ID,
        availability: offStep,
        updatedAt: '2026-10-21T10:00:00.000Z',
        mutationId: MUTATION,
      }).success,
    ).toBe(false);
    expect(
      UpdateMemberHoursInput.safeParse({ workspace: WORKSPACE, availability: offStep, mutationId: MUTATION }).success,
    ).toBe(false);
  });
});

describe('schedule names', () => {
  it('trims, then takes 1 to 60 characters', () => {
    expect(ScheduleName.parse('  Evenings ')).toBe('Evenings');
    expect(ScheduleName.safeParse('   ').success).toBe(false);
    expect(ScheduleName.safeParse('x'.repeat(60)).success).toBe(true);
    expect(ScheduleName.safeParse('x'.repeat(61)).success).toBe(false);
  });

  it('reads ids in lower case, the one way an id enters the server', () => {
    const parsed = CreateScheduleInput.parse({
      workspace: WORKSPACE,
      id: ID.toUpperCase(),
      name: 'Evenings',
      timeZone: 'UTC',
      mutationId: MUTATION,
    });
    expect(parsed.id).toBe(ID);
  });
});

describe('a booking page’s settings, for one release after spec 0035', () => {
  it('refuses the old hours keys a stale tab may send, rather than dropping its change', () => {
    for (const settings of [{ hoursMode: 'own' }, { availability: defaultAvailability('UTC') }]) {
      const parsed = UpdateBookingPageInput.safeParse({
        workspace: WORKSPACE,
        pageId: ID,
        settings,
        mutationId: MUTATION,
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe('Reload the app: a page’s hours now come from its schedule.');
    }
    expect(
      UpdateBookingPageInput.safeParse({
        workspace: WORKSPACE,
        pageId: ID,
        settings: { scheduleId: null },
        mutationId: MUTATION,
      }).success,
    ).toBe(true);
  });
});
