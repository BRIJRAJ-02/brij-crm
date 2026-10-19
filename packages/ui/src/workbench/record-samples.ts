// A sample record's details, timeline and tasks, for the record module stories. Stories only.
import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import type { FieldAttribute } from '../fields/types.ts';
import { arraySource } from '../lib/list-source.ts';
import type { ActivityEntry } from '../modules/ActivityFeed/ActivityFeed.tsx';
import type { AttributeEditorExtras, AttributeSection } from '../modules/AttributeList/AttributeList.tsx';
import type { TaskEntry } from '../modules/TaskList/TaskList.tsx';
import { attributeOf } from './attributes.ts';
import { SAMPLE_COMPANIES, SAMPLE_MEMBERS, SAMPLE_STAGES } from './field-samples.ts';
import { sampleColumns, sampleRowAt } from './grid-samples.ts';
import { SAMPLE_IDS, sampleId } from './sample-ids.ts';

/** The sample members the entries and tasks name. */
export const ADA = SAMPLE_MEMBERS[0] as ActorDisplay;
export const GRACE = SAMPLE_MEMBERS[1] as ActorDisplay;
const AUTOMATION: ActorDisplay = { type: 'automation', id: SAMPLE_IDS.automation.leadRouting, name: 'Lead routing' };
/** The Stage attribute the changes use. */
export const STAGE = attributeOf('status', 'Stage', { options: SAMPLE_STAGES });
const ARR = attributeOf('currency', 'ARR', { defaultCurrency: 'USD' });
const OWNER = attributeOf('actor_reference', 'Owner');

// The stories' clock is Thursday 8 October 2026, 14:30 in London.
/** Changes, a note, a task, an email, a meeting, a comment and the record's creation, across every period heading. */
export const SAMPLE_ACTIVITY: readonly ActivityEntry[] = [
  {
    id: 'e1',
    kind: 'change',
    at: '2026-10-08T13:10:00.000Z',
    actor: ADA,
    attribute: STAGE,
    from: SAMPLE_IDS.stage.qualified,
    to: SAMPLE_IDS.stage.proposal,
  },
  {
    id: 'e2',
    kind: 'note',
    at: '2026-10-08T09:02:00.000Z',
    actor: GRACE,
    title: 'Discovery call',
    excerpt:
      'They want the import to keep their record ids, and a sandbox for the first month before they move the team over.',
    href: '/notes/n1',
  },
  {
    id: 'e3',
    kind: 'task',
    at: '2026-10-07T16:40:00.000Z',
    actor: ADA,
    title: 'Send the security questionnaire',
    isDone: true,
  },
  {
    id: 'e4',
    kind: 'change',
    at: '2026-10-07T10:15:00.000Z',
    actor: AUTOMATION,
    attribute: OWNER,
    from: null,
    to: { type: 'member', id: SAMPLE_IDS.member.grace },
    toDisplay: GRACE,
  },
  {
    id: 'e5',
    kind: 'email',
    at: '2026-10-06T08:30:00.000Z',
    actor: GRACE,
    title: 'Re: Pricing for 40 seats',
    excerpt: 'Thanks, the annual plan works for us. Could you send the order form?',
  },
  {
    id: 'e6',
    kind: 'change',
    at: '2026-09-28T12:00:00.000Z',
    actor: ADA,
    attribute: ARR,
    from: { amount: '24000', currency: 'USD' },
    to: { amount: '36000', currency: 'USD' },
  },
  {
    id: 'e7',
    kind: 'meeting',
    at: '2026-09-21T15:00:00.000Z',
    actor: ADA,
    title: 'Intro with Northwind',
    startsAt: '2026-09-21T15:00:00.000Z',
    endsAt: '2026-09-21T15:30:00.000Z',
    attendees: [
      { email: 'ada@acme.dev', display: ADA, response: 'accepted' },
      { email: 'jane@northwind.com', name: 'Jane Doe', response: 'accepted' },
    ],
  },
  { id: 'e8', kind: 'comment', at: '2026-09-02T11:00:00.000Z', actor: GRACE, excerpt: 'Their renewal is in March.' },
  { id: 'e9', kind: 'created', at: '2025-12-04T09:00:00.000Z', actor: ADA },
];

const NORTHWIND = SAMPLE_COMPANIES[0] as RecordRefDisplay;
const GLOBEX = SAMPLE_COMPANIES[1] as RecordRefDisplay;
const THIRD_COMPANY = SAMPLE_COMPANIES[2] as RecordRefDisplay;

/** The people the link entries name, made from their number (records of a People object). */
const person = (n: number, name: string): RecordRefDisplay => ({
  objectId: sampleId('object', 2),
  recordId: sampleId('record', 100 + n),
  name,
  kind: 'person',
});
const TEAM = attributeOf('record_reference', 'Team', { allowMultiple: true });
const COMPANY = attributeOf('record_reference', 'Company');
const JOB_TITLE = attributeOf('text', 'Job title');
const linked = (display: RecordRefDisplay) => ({ display, href: `/records/${display.recordId}` });

// The stories' clock is Thursday 8 October 2026, 14:30 in London.
/**
 * Link entries (spec 0017): a write that added 100 people (3 named, "and 97
 * others"), one that added four ("and 1 other"), one that added two and
 * removed one, one that removed a record with no page to link to, a side
 * that holds one record changed from one company to another, and a cleared value.
 */
export const SAMPLE_LINK_ACTIVITY: readonly ActivityEntry[] = [
  {
    id: 'l1',
    kind: 'links',
    at: '2026-10-08T14:05:00.000Z',
    actor: ADA,
    attribute: TEAM,
    added: [linked(person(1, 'Jane Doe')), linked(person(2, 'Ada Lovelace')), linked(person(3, 'Alan Turing'))],
    addedCount: 100,
    removed: [],
    removedCount: 0,
  },
  {
    id: 'l1b',
    kind: 'links',
    at: '2026-10-08T12:40:00.000Z',
    actor: GRACE,
    attribute: TEAM,
    added: [
      linked(person(8, 'Annie Easley')),
      linked(person(9, 'Dorothy Vaughan')),
      linked(person(10, 'Mary Jackson')),
    ],
    addedCount: 4,
    removed: [],
    removedCount: 0,
  },
  {
    id: 'l2',
    kind: 'links',
    at: '2026-10-08T11:20:00.000Z',
    actor: GRACE,
    attribute: TEAM,
    added: [linked(person(4, 'Katherine Johnson')), linked(person(5, 'Margaret Hamilton'))],
    addedCount: 2,
    removed: [linked(person(6, 'Edsger Dijkstra'))],
    removedCount: 1,
  },
  {
    id: 'l3',
    kind: 'links',
    at: '2026-10-07T09:45:00.000Z',
    actor: AUTOMATION,
    attribute: TEAM,
    added: [],
    addedCount: 0,
    // A record on an object the reader can't open: its chip names it with no link.
    removed: [{ display: person(7, 'Barbara Liskov') }],
    removedCount: 1,
  },
  {
    id: 'l4',
    kind: 'change',
    at: '2026-10-06T16:00:00.000Z',
    actor: ADA,
    attribute: COMPANY,
    from: { objectId: NORTHWIND.objectId, recordId: NORTHWIND.recordId },
    to: { objectId: GLOBEX.objectId, recordId: GLOBEX.recordId },
    fromDisplay: NORTHWIND,
    toDisplay: GLOBEX,
  },
  {
    id: 'l4b',
    kind: 'change',
    at: '2026-10-06T11:00:00.000Z',
    actor: GRACE,
    attribute: JOB_TITLE,
    from: 'Chief technology officer',
    to: null,
  },
  { id: 'l5', kind: 'created', at: '2026-09-30T10:00:00.000Z', actor: ADA },
];

// The stories' clock is Thursday 8 October 2026.
/** Open tasks (one overdue, one due today, one tomorrow), one with no assignee, and one done. */
// The stories' clock is Thursday 8 October 2026, 14:30 in London.
/**
 * Meetings on a record (spec 0024): one still to come with every kind of
 * answer and a video link, an all day one, a private one the reader doesn't
 * hold, and one past.
 */
export const SAMPLE_MEETING_ACTIVITY: readonly ActivityEntry[] = [
  {
    id: 'm1',
    kind: 'meeting',
    at: '2026-10-13T09:00:00.000Z',
    actor: ADA,
    title: 'Renewal review with Northwind',
    startsAt: '2026-10-13T09:00:00.000Z',
    endsAt: '2026-10-13T09:45:00.000Z',
    attendees: [
      { email: 'ada@acme.dev', display: ADA, response: 'accepted' },
      { email: 'jane@northwind.com', display: person(1, 'Jane Doe'), href: '/records/jane', response: 'accepted' },
      { email: 'alan@northwind.com', display: person(3, 'Alan Turing'), href: '/records/alan', response: 'tentative' },
      { email: 'cfo@northwind.com', name: 'Grace Lee', response: 'needs_action' },
      { email: 'ops@northwind.com', response: 'declined' },
    ],
    videoUrl: 'https://meet.google.com/abc-defg-hij',
  },
  {
    id: 'm2',
    kind: 'meeting',
    at: '2026-10-12T00:00:00.000Z',
    actor: ADA,
    title: 'Northwind offsite',
    startsAt: '2026-10-12T00:00:00.000Z',
    endsAt: '2026-10-14T00:00:00.000Z',
    allDay: true,
    attendees: [
      { email: 'ada@acme.dev', display: ADA, response: 'accepted' },
      { email: 'jane@northwind.com', display: person(1, 'Jane Doe'), href: '/records/jane', response: 'accepted' },
    ],
  },
  {
    id: 'm3',
    kind: 'meeting',
    at: '2026-10-08T10:00:00.000Z',
    actor: GRACE,
    title: 'Private meeting',
    startsAt: '2026-10-08T10:00:00.000Z',
    endsAt: '2026-10-08T10:30:00.000Z',
    attendees: [],
    detailsHidden: true,
  },
  {
    id: 'm4',
    kind: 'meeting',
    at: '2026-10-01T15:00:00.000Z',
    actor: GRACE,
    title: 'Intro with Northwind',
    startsAt: '2026-10-01T15:00:00.000Z',
    endsAt: '2026-10-01T15:30:00.000Z',
    attendees: [
      { email: 'grace@acme.dev', display: GRACE, response: 'accepted' },
      { email: 'jane@northwind.com', display: person(1, 'Jane Doe'), href: '/records/jane', response: 'accepted' },
    ],
  },
];

export const SAMPLE_TASKS: readonly TaskEntry[] = [
  {
    id: 't1',
    title: 'Send the order form',
    isDone: false,
    dueOn: '2026-10-06',
    assignee: ADA,
    records: [NORTHWIND, GLOBEX, THIRD_COMPANY],
  },
  {
    id: 't2',
    title: 'Book the security review with their IT team',
    isDone: false,
    dueOn: '2026-10-08',
    assignee: GRACE,
    records: [GLOBEX],
  },
  {
    id: 't3',
    title: 'Prepare the renewal deck',
    isDone: false,
    dueOn: '2026-10-09',
    assignee: ADA,
    records: [NORTHWIND],
  },
  { id: 't4', title: 'Follow up on pricing', isDone: false, dueOn: '2026-10-21', records: [GLOBEX] },
  {
    id: 't5',
    title: 'Send the security questionnaire',
    isDone: true,
    dueOn: '2026-10-02',
    assignee: GRACE,
    records: [NORTHWIND],
  },
];

/** The first sample company, whose values the details show. */
export const SAMPLE_RECORD = sampleRowAt(0);
const ATTRIBUTES = sampleColumns(20).map((column) => column.attribute);
const named = (...names: readonly string[]) => ATTRIBUTES.filter((attribute) => names.includes(attribute.name));

/** The sample company's values, in a details section and a "More" section. */
export function sampleDetails(values: Readonly<Record<string, unknown>>): readonly AttributeSection[] {
  const itemsOf = (attributes: readonly FieldAttribute[]) =>
    attributes.map((attribute) => ({
      attribute,
      value: values[attribute.id],
      display: SAMPLE_RECORD.displays[attribute.id],
    }));
  return [
    {
      id: 'details',
      items: itemsOf([
        ...named('Domain', 'Stage', 'Owner', 'ARR', 'Segment', 'Next step', 'Is customer', 'Parent', 'Fit'),
        attributeOf('text', 'Description'),
      ]),
    },
    { id: 'more', title: 'More', items: itemsOf(named('City', 'Employees', 'Created')) },
  ];
}

/** What the reference editors search: the sample members and companies. */
export const sampleEditorProps = (attribute: FieldAttribute): AttributeEditorExtras => {
  if (attribute.type === 'actor_reference') {
    const me = SAMPLE_MEMBERS[0];
    return {
      onSearch: () => arraySource(SAMPLE_MEMBERS, (member) => member.id ?? member.name) as never,
      ...(me === undefined ? {} : { me }),
    };
  }
  if (attribute.type === 'record_reference') {
    return { onSearch: () => arraySource(SAMPLE_COMPANIES, (company) => company.recordId) as never };
  }
  return {};
};
