// Putting back the rules a writer can't see (spec 0043, AC-1608; spec 0009, hidden means absent): a team page's rule
// over a field hidden from its writer is never sent to them, so their save of the rules they see must keep it, in
// its place among theirs. Pure: the stored rules, the rules sent and which are hidden come in, the rules kept come
// out. The database side (the views, the save, the report and a booking deciding by such a rule) is in
// routing.test.ts.
import { describe, expect, it } from 'vitest';
import type { RoutingRule } from '@crm/contracts';
import { ruleFields, rulesSeen, withUnseenRules, type UnseenRule } from './seen.ts';

const FIELD = '0192f6a0-7c1e-7b3a-9d4e-5f6a7b8c9d0e';

/** A rule over a visit's hidden field (seen by everyone), or, when `field`, over a person's field hidden here. */
const rule = (id: string, field = false): RoutingRule => ({
  id,
  when: {
    join: 'all',
    rules: [
      field ? { key: `person.${FIELD}`, op: 'is', value: 'cto' } : { key: 'hidden.utm_source', op: 'is_answered' },
    ],
  },
  then: { kind: 'hosts', hosts: ['0192f6a0-7c1e-7b3a-9d4e-000000000001'] },
});

const unseen: UnseenRule = (each) => ruleFields(each).includes(FIELD);
const ids = (rules: readonly RoutingRule[]) => rules.map((each) => each.id);

const v1 = rule('v1');
const v2 = rule('v2');
const v3 = rule('v3');
const h1 = rule('h1', true);
const h2 = rule('h2', true);

describe('a writer’s save keeps the rules they can’t see', () => {
  it('reads a rule’s fields, and leaves the hidden ones out of what the writer sees', () => {
    expect(ruleFields(h1)).toEqual([FIELD]);
    expect(ruleFields(v1)).toEqual([]);
    expect(ids(rulesSeen([v1, h1, v2], unseen))).toEqual(['v1', 'v2']);
  });

  it('keeps the order when the writer sends back what they saw', () => {
    expect(ids(withUnseenRules([h1, v1, h2, v2], [v1, v2], unseen))).toEqual(['h1', 'v1', 'h2', 'v2']);
  });

  it('keeps a hidden rule just after the rule it followed when the writer reorders, adds or edits', () => {
    const edited = { ...v1, name: 'Edited' };
    expect(ids(withUnseenRules([v1, h1, v2], [v2, edited, v3], unseen))).toEqual(['v2', 'v1', 'h1', 'v3']);
    expect(withUnseenRules([v1, h1, v2], [v2, edited], unseen)[1]).toEqual(edited);
  });

  it('moves a hidden rule up to the nearest rule the save keeps when the one it followed is removed', () => {
    expect(ids(withUnseenRules([v1, v2, h1, h2, v3], [v1, v3], unseen))).toEqual(['v1', 'h1', 'h2', 'v3']);
    expect(ids(withUnseenRules([v1, h1, v2], [v2], unseen))).toEqual(['h1', 'v2']);
    // Everything the writer sees removed: only what they can't see stays.
    expect(ids(withUnseenRules([v1, h1, v2, h2], [], unseen))).toEqual(['h1', 'h2']);
  });

  it('takes a hidden rule as sent when the writer still holds it, so it is never doubled', () => {
    // A screen opened before rules were hidden sends them back: in its order, once each.
    expect(ids(withUnseenRules([v1, h1, v2], [h1, v2, v1], unseen))).toEqual(['h1', 'v2', 'v1']);
    expect(ids(withUnseenRules([v1, h1, h2], [h2, v1], unseen))).toEqual(['h2', 'v1', 'h1']);
  });

  it('changes nothing for a writer who sees every rule', () => {
    expect(ids(withUnseenRules([v1, h1, v2], [v2], () => false))).toEqual(['v2']);
  });
});
