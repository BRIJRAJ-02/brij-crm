import type { BookingPageView, RotationView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { bookingTemplate } from '../../public/booking/template.ts';
import { pageTabOf } from './links.ts';
import { cardFacts, cardPeople } from './page-card.ts';

const page = (over: Partial<BookingPageView>): BookingPageView =>
  ({
    id: 'p1',
    title: 'Product demo',
    durations: [45],
    location: { type: 'video', link: 'https://zoom.us/j/1' },
    kind: 'personal',
    scope: 'member',
    ownerMemberId: 'm1',
    ...over,
  }) as BookingPageView;

const sales = {
  id: 'r1',
  name: 'Sales',
  members: [
    { memberId: 'm1', name: 'Priya Nair', isOn: true },
    { memberId: 'm2', name: 'Oliver Brown', isOn: true },
    { memberId: 'm3', name: 'Arjun Mehta', isOn: false },
  ],
} as unknown as RotationView;

describe('a page card', () => {
  it('says its lengths, where and its kind in one line', () => {
    expect(cardFacts(page({}), [])).toEqual(['45 min', 'Zoom', 'One-on-one']);
    expect(cardFacts(page({ durations: [15, 30, 60], location: { type: 'phone' } }), [])).toEqual([
      '15, 30 or 60 min',
      'Phone call',
      'One-on-one',
    ]);
    expect(cardFacts(page({ kind: 'round_robin', location: { type: 'video' } }), [])).toEqual([
      '45 min',
      'Video call',
      'Team, taking turns',
    ]);
  });

  it('names who it books with: the reader, a colleague, or a team’s people who are on', () => {
    expect(cardPeople(page({}), [], { id: 'me', name: 'Brij Raj' })?.label).toBe('Brij Raj');
    expect(cardPeople(page({ ownerName: 'Priya Nair' }), [], undefined)?.label).toBe('Priya Nair');
    const team = cardPeople(page({ kind: 'round_robin', hosts: { fixed: [], rotations: ['r1'] } }), [sales], undefined);
    expect(team?.label).toBe('2 hosts');
    expect(team?.people.map((each) => each.name)).toEqual(['Priya Nair', 'Oliver Brown']);
  });
});

describe('the editor’s sections', () => {
  it('opens an old tab’s link on the section that holds its settings', () => {
    expect(pageTabOf('page')).toBe('details');
    expect(pageTabOf('meeting')).toBe('details');
    expect(pageTabOf('appearance')).toBe('look');
    expect(pageTabOf('limits')).toBe('hours');
    expect(pageTabOf('booking')).toBe('booking');
    expect(pageTabOf('nonsense')).toBe('details');
  });
});

describe('a booking page’s look', () => {
  it('reads Studio and Split as Classic, and keeps Night', () => {
    expect(bookingTemplate('studio')).toBe('classic');
    expect(bookingTemplate('split')).toBe('classic');
    expect(bookingTemplate('night')).toBe('night');
    expect(bookingTemplate(undefined)).toBeUndefined();
  });
});
