// The composer's draft (spec 0038, AC-1154): mentions shown as "@Name" and
// sent as tokens, a mention whole or gone, the `@` query, and a pick.
import { describe, expect, it } from 'vitest';
import { bodyOf, draftOf, edited, matchingMembers, picked, queryAt, type Draft } from './draft.ts';

const ADA = '0199a6f2-0000-7000-8000-000000000001';
const BEA = '0199a6f2-0000-7000-8000-000000000002';
const names: Record<string, string> = { [ADA]: 'Ada Lovelace', [BEA]: 'Bea' };
const nameOf = (id: string) => names[id] ?? 'Former member';

describe('the draft', () => {
  it('shows tokens as names and sends names back as tokens', () => {
    const body = `Hi <@${ADA}>, ask <@${BEA}>.`;
    const draft = draftOf(body, nameOf);
    expect(draft.text).toBe('Hi @Ada Lovelace, ask @Bea.');
    expect(bodyOf(draft)).toBe(body);
  });

  it('takes a whole mention out when a character of it is removed, and moves the ones after an edit', () => {
    const draft = draftOf(`<@${ADA}> and <@${BEA}>`, nameOf);
    const backspaced = edited(draft, draft.text.replace('Lovelace and', 'Lovelac and'));
    expect(backspaced.draft.text).toBe(' and @Bea');
    expect(backspaced.caret).toBe(0);
    expect(bodyOf(backspaced.draft)).toBe(` and <@${BEA}>`);
    const typed = edited(draft, `Hey ${draft.text}`);
    expect(bodyOf(typed.draft)).toBe(`Hey <@${ADA}> and <@${BEA}>`);
    const inside = edited(draft, draft.text.replace('@Bea', '@Bxea'));
    expect(bodyOf(inside.draft)).toBe(`<@${ADA}> and x`);
  });

  it('finds the @ query at the start or after a space, never in an email', () => {
    const at = (text: string): Draft => ({ text, mentions: [] });
    expect(queryAt(at('@ad'), 3)).toEqual({ start: 0, query: 'ad' });
    expect(queryAt(at('hi @Ada L'), 9)).toEqual({ start: 3, query: 'Ada L' });
    expect(queryAt(at('mail ada@acme.dev'), 17)).toBeUndefined();
    expect(queryAt(at('hi @'), 4)).toEqual({ start: 3, query: '' });
  });

  it('puts "@Name " in place of the query and matches names first', () => {
    const result = picked({ text: 'hi @ad', mentions: [] }, 3, 6, { id: ADA, name: 'Ada Lovelace' });
    expect(result.draft.text).toBe('hi @Ada Lovelace ');
    expect(result.caret).toBe(17);
    expect(bodyOf(result.draft)).toBe(`hi <@${ADA}> `);
    const members = [
      { name: 'Bea Ada', email: 'bea@x.dev' },
      { name: 'Cal', email: 'ada@x.dev' },
      { name: 'Ada', email: 'a@x.dev' },
    ];
    expect(matchingMembers(members, 'ada', 8).map((m) => m.name)).toEqual(['Bea Ada', 'Ada', 'Cal']);
  });
});
