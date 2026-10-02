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

/** The sample members the entries and tasks name. */
export const ADA = SAMPLE_MEMBERS[0] as ActorDisplay;
export const GRACE = SAMPLE_MEMBERS[1] as ActorDisplay;
const AUTOMATION: ActorDisplay = { type: 'automation', id: 'w1', name: 'Lead routing' };
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
    from: 'qualified',
    to: 'proposal',
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
    to: { type: 'member', id: 'm2' },
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
  { id: 'e7', kind: 'meeting', at: '2026-09-21T15:00:00.000Z', actor: ADA, title: 'Intro with Northwind' },
  { id: 'e8', kind: 'comment', at: '2026-09-02T11:00:00.000Z', actor: GRACE, excerpt: 'Their renewal is in March.' },
  { id: 'e9', kind: 'created', at: '2025-12-04T09:00:00.000Z', actor: ADA },
];

const NORTHWIND = SAMPLE_COMPANIES[0] as RecordRefDisplay;
const GLOBEX = SAMPLE_COMPANIES[1] as RecordRefDisplay;

// The stories' clock is Thursday 8 October 2026.
/** Open tasks (one overdue, one due today, one tomorrow), one with no assignee, and one done. */
export const SAMPLE_TASKS: readonly TaskEntry[] = [
  {
    id: 't1',
    title: 'Send the order form',
    isDone: false,
    dueOn: '2026-10-06',
    assignee: ADA,
    record: NORTHWIND,
    recordHref: '/companies/c1',
  },
  {
    id: 't2',
    title: 'Book the security review with their IT team',
    isDone: false,
    dueOn: '2026-10-08',
    assignee: GRACE,
    record: GLOBEX,
  },
  { id: 't3', title: 'Prepare the renewal deck', isDone: false, dueOn: '2026-10-09', assignee: ADA, record: NORTHWIND },
  { id: 't4', title: 'Follow up on pricing', isDone: false, dueOn: '2026-10-21', record: GLOBEX },
  {
    id: 't5',
    title: 'Send the security questionnaire',
    isDone: true,
    dueOn: '2026-10-02',
    assignee: GRACE,
    record: NORTHWIND,
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
