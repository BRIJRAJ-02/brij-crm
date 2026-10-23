// Show when and routing conditions (spec 0043, AC-1602, AC-1614): each
// comparison, all and any, hiding that cascades, and the answer check
// dropping what a hidden question was given.
import { describe, expect, it } from 'vitest';
import { checkAnswers } from './check.ts';
import { publishProblem, recordFactProblem } from './publish.ts';
import { RoutingRules, type RoutingRule } from './routing.ts';
import {
  hiddenFacts,
  isHiddenFact,
  isRecordFact,
  matchesCondition,
  matchesShowWhen,
  RECORD_FACT,
  summarizeShowWhen,
  visibleQuestions,
} from './show-when.ts';

describe('a condition', () => {
  it('compares text without case or spaces, and yes or no answers as yes and no', () => {
    expect(matchesCondition({ key: 'budget', op: 'is', value: 'large ' }, { budget: 'Large' })).toBe(true);
    expect(matchesCondition({ key: 'budget', op: 'is_not', value: 'Large' }, { budget: 'Small' })).toBe(true);
    expect(matchesCondition({ key: 'ok', op: 'is', value: 'yes' }, { ok: true })).toBe(true);
    expect(matchesCondition({ key: 'tags', op: 'is_any_of', value: ['b', 'z'] }, { tags: ['a', 'b'] })).toBe(true);
    expect(matchesCondition({ key: 'note', op: 'contains', value: 'demo' }, { note: 'Want a DEMO soon' })).toBe(true);
  });

  it('compares numbers, and never matches a missing fact except as empty', () => {
    expect(matchesCondition({ key: 'size', op: 'more_than', value: '50' }, { size: '1,200' })).toBe(true);
    expect(matchesCondition({ key: 'size', op: 'less_than', value: '50' }, { size: 'many' })).toBe(false);
    expect(matchesCondition({ key: 'size', op: 'is_not', value: '5' }, {})).toBe(false);
    expect(matchesCondition({ key: 'size', op: 'is_empty' }, {})).toBe(true);
    expect(matchesCondition({ key: 'size', op: 'is_answered' }, { size: '' })).toBe(false);
  });

  it('joins by all or any', () => {
    const when = (join: 'all' | 'any') => ({
      join,
      rules: [
        { key: 'a', op: 'is' as const, value: '1' },
        { key: 'b', op: 'is' as const, value: '2' },
      ],
    });
    expect(matchesShowWhen(when('all'), { a: '1', b: '3' })).toBe(false);
    expect(matchesShowWhen(when('any'), { a: '1', b: '3' })).toBe(true);
    expect(summarizeShowWhen(when('any'), (key) => key.toUpperCase())).toBe('A is 1 or B is 2');
  });
});

describe('Show when on questions', () => {
  const questions = [
    { key: 'budget' },
    { key: 'size', showWhen: { join: 'all' as const, rules: [{ key: 'budget', op: 'is' as const, value: 'Large' }] } },
    { key: 'seats', showWhen: { join: 'all' as const, rules: [{ key: 'size', op: 'is_answered' as const }] } },
  ];

  it('hides a question, and those that read it, when earlier answers don’t match', () => {
    expect([...visibleQuestions(questions, { budget: 'Large', size: '9' })]).toEqual(['budget', 'size', 'seats']);
    expect([...visibleQuestions(questions, { budget: 'Small', size: '9' })]).toEqual(['budget']);
  });

  it('drops a hidden question’s answer and never requires it', () => {
    const checked = checkAnswers(
      {
        language: 'en',
        questions: [
          { key: 'budget', answerType: 'choice', required: true, choices: ['Small', 'Large'] },
          {
            key: 'size',
            answerType: 'number',
            required: true,
            showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
          },
        ],
      },
      { budget: 'Small', size: '12' },
    );
    expect(checked).toEqual({ ok: true, answers: { budget: 'Small' } });
  });
});

describe('record facts (AC-1603)', () => {
  const id = '0192f6a0-7c1e-7b3a-9d4e-5f6a7b8c9d0e';
  /** One team page rule reading `key`. */
  const rules = (key: string) =>
    RoutingRules.safeParse({
      rules: [{ id: 'r1', when: { join: 'all', rules: [{ key, op: 'is', value: 'cto' }] }, then: { kind: 'message' } }],
    });

  it('names a field by its attribute id in the one spelling the database answers', () => {
    expect(isRecordFact(`person.${id}`)).toBe(true);
    expect(isRecordFact(`company.${id}`)).toBe(true);
    expect(RECORD_FACT.exec(`company.${id}`)?.[2]).toBe(id);
    expect(rules(`person.${id}`).success).toBe(true);
  });

  it('refuses a malformed id with the standard refusal, never letting it reach the uuid cast (it answered 500)', () => {
    const malformed = [
      `person.${'-'.repeat(36)}`,
      `person.${'0'.repeat(36)}`,
      // Hyphens where Postgres would take them, but not the canonical 8-4-4-4-12.
      'person.0192-f6a07c1e-7b3a-9d4e-5f6a7b8c9d0e',
      `person.${id.toUpperCase()}`,
      `person.${id.replaceAll('-', '')}`,
      `person.{${id}}`,
      `person.${id} `,
      `person.${id}0`,
      `deal.${id}`,
      `person.${id.replace('0e', 'zz')}`,
    ];
    for (const key of malformed) {
      expect(isRecordFact(key)).toBe(false);
      const parsed = rules(key);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues).toEqual([
        expect.objectContaining({
          path: ['rules', 0, 'when', 'rules', 0, 'key'],
          message: 'Pick a question or a field.',
        }),
      ]);
    }
  });

  it('is read only by a team page’s rules: a form’s Show when or rule over one is refused in one sentence, on save as on publish', () => {
    const budget = {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice' as const,
      choices: ['Small', 'Large'],
      required: false,
      update: 'fill' as const,
    };
    const size = {
      id: 'size',
      key: 'size',
      label: 'Team size',
      answerType: 'number' as const,
      required: false,
      update: 'fill' as const,
    };
    const large = { key: 'budget', op: 'is' as const, value: 'Large' };
    const field = { key: `person.${id}`, op: 'is' as const, value: 'cto' };
    const routed = (ruleId: string, when: RoutingRule['when'], name?: string): RoutingRule => ({
      id: ruleId,
      ...(name === undefined ? {} : { name }),
      when,
      then: { kind: 'message', message: '' },
    });
    /** What the draft save's check and the publish check each answer for a form asking the budget, then the team size. */
    const both = (showWhen: RoutingRule['when'] | undefined, rules: readonly RoutingRule[]) => {
      const document = {
        targets: {},
        questions: [budget, { ...size, ...(showWhen === undefined ? {} : { showWhen }) }],
        routing: { rules: [...rules] },
      };
      return {
        save: recordFactProblem(document),
        publish: publishProblem({ name: 'Demo', slug: 'demo', attributes: new Map(), document }),
      };
    };

    // Answers and the visit's hidden fields are what a form reads: nothing to refuse.
    const hidden = { key: 'hidden.utm_source', op: 'is' as const, value: 'google' };
    expect(both({ join: 'all', rules: [large] }, [routed('ads', { join: 'any', rules: [large, hidden] })])).toEqual({
      save: undefined,
      publish: undefined,
    });
    // A question's Show when, refused on the question.
    const shown = {
      code: 'SHOW_WHEN_INVALID',
      message: '“Team size” reads a record field, which only a team page’s rules can read. Change its Show when.',
      questionId: 'size',
    };
    expect(both({ join: 'any', rules: [large, field] }, [])).toEqual({ save: shown, publish: shown });
    // The first rule reading one, by its number and name, refused on Routing.
    const ruled = {
      code: 'ROUTING_INVALID',
      message:
        'Rule 2, “Enterprise”, reads a record field, which only a team page’s rules can read. Change it in Routing.',
      ruleId: 'enterprise',
    };
    const company = { key: `company.${id}`, op: 'is_answered' as const };
    expect(
      both(undefined, [
        routed('first', { join: 'all', rules: [large] }),
        routed('enterprise', { join: 'all', rules: [large, company] }, 'Enterprise'),
        routed('later', { join: 'all', rules: [field] }),
      ]),
    ).toEqual({ save: ruled, publish: ruled });
    expect(
      recordFactProblem({ questions: [], routing: { rules: [routed('only', { join: 'all', rules: [field] })] } }),
    ).toEqual({
      code: 'ROUTING_INVALID',
      message: 'Rule 1 reads a record field, which only a team page’s rules can read. Change it in Routing.',
      ruleId: 'only',
    });
  });
});

describe('hidden fields as facts', () => {
  it('reads a visit’s UTM tags, page and referrer under hidden keys, and nothing else', () => {
    const facts = hiddenFacts({
      utm_source: 'Google',
      page: 'https://acme.example/pricing',
      utm_term: ' ',
      other: 'x',
    });
    expect(facts).toEqual({ 'hidden.utm_source': 'Google', 'hidden.page': 'https://acme.example/pricing' });
    expect(hiddenFacts(null)).toEqual({});
    expect(hiddenFacts(['utm_source'])).toEqual({});
    // The stored context comes first (its page is `page_url`), the older hidden fields after.
    expect(
      hiddenFacts(
        { utm_source: 'Old', referrer: 'https://a.example/' },
        { utm_source: 'New', page_url: 'https://b.example/' },
      ),
    ).toEqual({
      'hidden.utm_source': 'New',
      'hidden.page': 'https://b.example/',
      'hidden.referrer': 'https://a.example/',
    });
    expect(isHiddenFact('hidden.utm_campaign')).toBe(true);
    expect(isHiddenFact('hidden.other')).toBe(false);
    expect(isHiddenFact('utm_source')).toBe(false);
    expect(matchesCondition({ key: 'hidden.utm_source', op: 'is', value: 'google' }, facts)).toBe(true);
    expect(matchesCondition({ key: 'hidden.page', op: 'contains', value: '/pricing' }, facts)).toBe(true);
    // A field the visit didn't bring reads as empty.
    expect(matchesCondition({ key: 'hidden.utm_campaign', op: 'is_empty' }, facts)).toBe(true);
  });

  it('lets a rule read them, but never a question’s Show when, nor as a number', () => {
    const rule = (op: 'is' | 'more_than', value: string) =>
      RoutingRules.parse({
        rules: [
          {
            id: 'ads',
            when: { join: 'all', rules: [{ key: 'hidden.utm_source', op, value }] },
            then: { kind: 'message' },
          },
        ],
      }).rules;
    const form = (
      rules: ReturnType<typeof rule>,
      showWhen?: { join: 'all'; rules: { key: string; op: 'is'; value: string }[] },
    ) =>
      publishProblem({
        name: 'Demo',
        slug: 'demo',
        attributes: new Map(),
        document: {
          targets: {},
          questions: [
            {
              id: 'q',
              key: 'budget',
              label: 'Budget',
              answerType: 'short_text',
              required: false,
              update: 'fill',
              ...(showWhen === undefined ? {} : { showWhen }),
            },
          ],
          routing: { rules },
        },
      });
    expect(form(rule('is', 'google'))).toBeUndefined();
    expect(form(rule('more_than', '3'))?.message).toBe(
      'Rule 1 compares a hidden field as a number, but it holds text. Change it in Routing.',
    );
    expect(form([], { join: 'all', rules: [{ key: 'hidden.utm_source', op: 'is', value: 'google' }] })?.code).toBe(
      'SHOW_WHEN_INVALID',
    );
  });
});
