import type { AttributeDefinition, Automation, ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  ANY,
  CREATED,
  daysOf,
  draftOf,
  offReason,
  starterDraft,
  summaryOf,
  TASK_SUBJECT,
  toDefinition,
  type Draft,
  type Names,
} from './model.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deals = {
  id: ID(1),
  apiSlug: 'deals',
  singularName: 'Deal',
  pluralName: 'Deals',
  standardKey: 'deals',
  isArchived: false,
} as unknown as ObjectSummary;
const stage = {
  id: ID(2),
  title: 'Stage',
  type: 'status',
  isArchived: false,
  isSystem: false,
  isMulti: false,
  options: [
    { id: ID(3), label: 'Lead', isArchived: false, outcome: 'open' },
    { id: ID(4), label: 'Won', isArchived: false, outcome: 'won' },
  ],
} as unknown as AttributeDefinition;
const names: Names = {
  objects: [deals],
  members: [{ id: ID(9), name: 'Bea', email: 'bea@example.com' }],
  attributesOf: (objectId) => (objectId === deals.id ? [stage] : undefined),
};

describe('the starters', () => {
  it('makes Stage won → task from the pipeline’s stage and its won option', () => {
    const draft = starterDraft('stage-won', names);
    expect(draft).toMatchObject({ subject: deals.id, event: stage.id, to: ID(4) });
    expect(toDefinition(draft as Draft)).toEqual({
      trigger: { kind: 'field_changed', objectId: deals.id, attributeId: stage.id, to: { optionId: ID(4) } },
      actions: [{ kind: 'create_task', title: 'Send contract', assignee: { kind: 'owner' }, dueInDays: 3 }],
    });
  });

  it('makes New deal → task and Task due → notify, and is complete as it stands', () => {
    expect(toDefinition(starterDraft('new-deal', names) as Draft)?.trigger).toEqual({
      kind: 'record_created',
      objectId: deals.id,
    });
    expect(toDefinition(starterDraft('task-due', names) as Draft)).toEqual({
      trigger: { kind: 'task_due' },
      actions: [{ kind: 'notify', who: { kind: 'owner' } }],
    });
  });

  it('has no object-based starter without an object', () => {
    expect(starterDraft('new-deal', { ...names, objects: [] })).toBeUndefined();
  });
});

describe('a draft becomes a definition only when it is finished', () => {
  const base: Draft = {
    subject: deals.id,
    event: CREATED,
    to: ANY,
    conditions: undefined,
    actions: [{ kind: 'create_task', title: '  ', who: 'owner', days: '3' }],
  };
  it('refuses a blank title, days that are not a whole number up to a year, and no actions', () => {
    expect(toDefinition(base)).toBeUndefined();
    const titled = { ...base, actions: [{ kind: 'create_task' as const, title: 'Call', who: 'owner', days: 'x' }] };
    expect(toDefinition(titled)).toBeUndefined();
    expect(toDefinition({ ...titled, actions: [{ ...titled.actions[0], days: '366' } as never] })).toBeUndefined();
    expect(toDefinition({ ...base, actions: [] })).toBeUndefined();
  });
  it('trims the title, and leaves an empty condition group out', () => {
    const made = toDefinition({
      ...base,
      conditions: { conjunction: 'and', conditions: [] },
      actions: [{ kind: 'create_task', title: ' Call ', who: ID(9), days: '0' }],
    });
    expect(made).toEqual({
      trigger: { kind: 'record_created', objectId: deals.id },
      actions: [{ kind: 'create_task', title: 'Call', assignee: { kind: 'member', memberId: ID(9) }, dueInDays: 0 }],
    });
  });
  it('reads days', () => {
    expect([daysOf('3'), daysOf(' 12 '), daysOf('-1'), daysOf('1.5'), daysOf('')]).toEqual([
      3,
      12,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('a saved automation', () => {
  const saved: Automation = {
    id: ID(20),
    trigger: { kind: 'field_changed', objectId: deals.id, attributeId: stage.id, to: { optionId: ID(4) } },
    actions: [{ kind: 'create_task', title: 'Send contract', assignee: { kind: 'owner' }, dueInDays: 3 }],
    enabled: false,
    disabledReason: 'FAILING',
    failures: 5,
    runAsMemberId: ID(9),
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
  };
  it('opens as the draft it was made from, and reads as one line', () => {
    expect(toDefinition(draftOf(saved))).toEqual({ trigger: saved.trigger, actions: saved.actions });
    expect(summaryOf(saved, names)).toBe('When Deal Stage becomes Won: create task “Send contract” for Owner');
    expect(
      draftOf({ ...saved, trigger: { kind: 'task_due' }, actions: [{ kind: 'notify', who: { kind: 'owner' } }] })
        .subject,
    ).toBe(TASK_SUBJECT);
  });
  it('says why it is off, only when it turned itself off', () => {
    expect(offReason(saved)).toBe('Turned off: 5 runs failed in a row');
    expect(offReason({ ...saved, disabledReason: 'CREATOR_GONE' })).toBe('Turned off: the person it ran as left');
    const byHand = Object.fromEntries(
      Object.entries(saved).filter(([key]) => key !== 'disabledReason'),
    ) as unknown as Automation;
    expect(offReason(byHand)).toBeUndefined();
    expect(offReason({ ...saved, enabled: true })).toBeUndefined();
  });
});
