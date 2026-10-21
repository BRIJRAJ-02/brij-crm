// Home's pure parts (spec 0041): the day's agenda, Needs attention's question
// and the setup steps.
import type { AttributeDefinition, BookingListItem, CalendarEventItem, ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { agendaOf, dayRange, minutesOf, splitAgenda } from './agenda.ts';
import { attentionPlan, QUIET_DAYS } from './attention.ts';
import { nextStep, setupSteps } from './setup.ts';

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

function booking(id: string, startsAt: string, endsAt: string, extra: Partial<BookingListItem> = {}): BookingListItem {
  return {
    id,
    pageId: 'page',
    hostMemberId: ME,
    startsAt,
    endsAt,
    visitorName: 'Grace Hopper',
    visitorEmail: 'grace@example.com',
    visitorTimeZone: 'Europe/London',
    status: 'confirmed',
    eventFailed: false,
    createdAt: startsAt,
    pageTitle: 'Quick chat',
    location: { type: 'video' },
    guests: [],
    reschedules: 0,
    ...extra,
  };
}

function event(
  id: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<CalendarEventItem> = {},
): CalendarEventItem {
  return {
    id,
    connectionId: 'conn',
    title: 'Team sync',
    startsAt,
    endsAt,
    allDay: false,
    status: 'confirmed',
    ...extra,
  };
}

describe('the agenda', () => {
  const view = {
    bookings: [
      booking('b-late', '2026-10-21T15:00:00Z', '2026-10-21T15:30:00Z'),
      booking('b-other', '2026-10-21T10:00:00Z', '2026-10-21T10:30:00Z', { hostMemberId: OTHER }),
      booking('b-cancelled', '2026-10-21T11:00:00Z', '2026-10-21T11:30:00Z', { status: 'cancelled' }),
    ],
    events: [
      event('e-early', '2026-10-21T09:00:00Z', '2026-10-21T09:15:00Z'),
      event('e-cancelled', '2026-10-21T12:00:00Z', '2026-10-21T13:00:00Z', { status: 'cancelled' }),
      event('e-day', '2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z', { allDay: true }),
    ],
    busy: [],
    blocks: [],
  };

  it('holds my confirmed bookings and my live events, all day first, then by start', () => {
    expect(agendaOf(view, ME).map((item) => item.id)).toEqual(['e-day', 'e-early', 'b-late']);
  });

  it('gives a booking its guest and an event none', () => {
    const [, early, late] = agendaOf(view, ME);
    expect(early?.guestName).toBeUndefined();
    expect(late?.guestName).toBe('Grace Hopper');
  });

  it('holds no bookings for a member it can’t name', () => {
    expect(agendaOf(view, undefined).map((item) => item.id)).toEqual(['e-day', 'e-early']);
  });

  it('puts what has ended under Earlier, and what is on or to come under Coming up', () => {
    const { earlier, next } = splitAgenda(agendaOf(view, ME), new Date('2026-10-21T15:10:00Z'));
    expect(earlier.map((item) => item.id)).toEqual(['e-early']);
    expect(next.map((item) => item.id)).toEqual(['e-day', 'b-late']);
  });

  it('measures a meeting in minutes', () => {
    expect(minutesOf({ startsAt: '2026-10-21T09:00:00Z', endsAt: '2026-10-21T10:30:00Z' })).toBe(90);
  });

  it('reads the day from local midnight to the next', () => {
    const { from, to } = dayRange('2026-10-21');
    expect(new Date(from).getHours()).toBe(0);
    expect(Date.parse(to) - Date.parse(from)).toBeGreaterThanOrEqual(23 * 3_600_000);
  });
});

const DEALS: ObjectSummary = { id: 'deals', apiSlug: 'deals', standardKey: 'deals' } as ObjectSummary;

function attribute(apiSlug: string, type: string, extra: Partial<AttributeDefinition> = {}): AttributeDefinition {
  return {
    id: apiSlug,
    objectId: 'deals',
    apiSlug,
    title: apiSlug,
    type,
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    isPrimary: false,
    config: {},
    position: 0,
    isArchived: false,
    ...extra,
  } as AttributeDefinition;
}

const option = (id: string, outcome?: 'open' | 'won' | 'lost', isArchived = false) => ({
  id,
  label: id,
  hue: 'blue' as const,
  position: 0,
  isArchived,
  ...(outcome === undefined ? {} : { outcome }),
});

const DEAL_ATTRIBUTES = [
  attribute('owner', 'actor_reference'),
  attribute('stage', 'status', {
    options: [
      option('lead'),
      option('proposal', 'open'),
      option('won', 'won'),
      option('lost', 'lost'),
      option('old', 'open', true),
    ],
  }),
  attribute('updated_at', 'timestamp', { isSystem: true }),
];

describe('Needs attention', () => {
  it('asks for open deals I own, unchanged since 14 days before today, stalest first', () => {
    const plan = attentionPlan([DEALS], DEAL_ATTRIBUTES, '2026-10-21');
    expect(plan?.objectId).toBe('deals');
    expect([...(plan?.stages.keys() ?? [])]).toEqual(['lead', 'proposal']);
    const cutoff = new Date(2026, 9, 21 - QUIET_DAYS).toISOString();
    expect(plan?.query).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [
          { attributeId: 'owner', operator: 'is_me' },
          { attributeId: 'stage', operator: 'is_any_of', values: ['lead', 'proposal'] },
          { attributeId: 'updated_at', operator: 'before', value: cutoff },
        ],
      },
      sorts: [{ attributeId: 'updated_at', direction: 'ascending' }],
    });
  });

  it('asks the same question all day', () => {
    expect(attentionPlan([DEALS], DEAL_ATTRIBUTES, '2026-10-21')?.query).toEqual(
      attentionPlan([DEALS], DEAL_ATTRIBUTES, '2026-10-21')?.query,
    );
  });

  it('asks nothing without Deals, an Owner, a Stage or an open stage', () => {
    expect(attentionPlan([], DEAL_ATTRIBUTES, '2026-10-21')).toBeUndefined();
    expect(attentionPlan([DEALS], DEAL_ATTRIBUTES.slice(1), '2026-10-21')).toBeUndefined();
    expect(
      attentionPlan(
        [DEALS],
        [DEAL_ATTRIBUTES[0], DEAL_ATTRIBUTES[2]].flatMap((each) => each ?? []),
        '2026-10-21',
      ),
    ).toBeUndefined();
    const closedOnly = attribute('stage', 'status', { options: [option('won', 'won')] });
    expect(
      attentionPlan(
        [DEALS],
        [DEAL_ATTRIBUTES[0], closedOnly, DEAL_ATTRIBUTES[2]].flatMap((each) => each ?? []),
        '2026-10-21',
      ),
    ).toBeUndefined();
  });
});

describe('the setup steps', () => {
  it('shows only the steps the member may take, each done from real state', () => {
    expect(setupSteps({ calendars: [], forms: 2 })).toEqual([
      { id: 'calendar', done: false },
      { id: 'form', done: true },
    ]);
  });

  it('counts the team done with another member or an invitation waiting', () => {
    expect(setupSteps({ team: { members: 1, invited: 0 } })).toEqual([{ id: 'invite', done: false }]);
    expect(setupSteps({ team: { members: 1, invited: 1 } })).toEqual([{ id: 'invite', done: true }]);
    expect(setupSteps({ team: { members: 3, invited: 0 } })).toEqual([{ id: 'invite', done: true }]);
  });

  it('gives the button to the first step not done, and none once all are', () => {
    expect(nextStep(setupSteps({ calendars: ['me@example.com'], bookingPages: 0, forms: 0 }))).toBe('bookingPage');
    expect(nextStep(setupSteps({ calendars: ['me@example.com'] }))).toBeUndefined();
    expect(nextStep(setupSteps({}))).toBeUndefined();
  });
});
