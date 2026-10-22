import { describe, expect, it } from 'vitest';
import {
  addRowAfter,
  createInviteRow,
  isList,
  pasteInto,
  removeRow,
  splitList,
  type InviteRow,
} from './invite-rows.ts';

/** Rows with readable ids, so the tests say which row went where. */
const counter = () => {
  let next = 0;
  return (roleId?: string, email = ''): InviteRow => {
    next += 1;
    return { id: `n${String(next)}`, email, ...(roleId === undefined ? {} : { roleId }) };
  };
};
const row = (id: string, email = '', roleId = 'member'): InviteRow => ({ id, email, roleId });

describe('createInviteRow', () => {
  it('makes an empty row with a fresh id, and keeps the role only when given', () => {
    const one = createInviteRow('member');
    const two = createInviteRow();
    expect(one.email).toBe('');
    expect(one.roleId).toBe('member');
    expect('roleId' in two).toBe(false);
    expect(one.id).not.toBe(two.id);
  });
});

describe('splitList and isList', () => {
  it('splits on commas, semicolons, spaces and line breaks, dropping empties', () => {
    expect(splitList('a@x.com, b@y.com;c@z.com\nd@w.com  ')).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com']);
  });
  it('takes the addresses alone from what a mail client copies', () => {
    expect(splitList('Ada Lovelace <ada@acme.com>, Bob <bob@x.com>')).toEqual(['ada@acme.com', 'bob@x.com']);
  });
  it('treats one address, even with spaces round it, as typing', () => {
    expect(isList(' ada@x.com ')).toBe(false);
    expect(isList('ada@x.com,')).toBe(false);
    expect(isList('ada@x.com, grace@y.com')).toBe(true);
  });
  it('splits only when several characters arrive at once, never on a key typed', () => {
    expect(isList('ada l', 'ada ')).toBe(false);
    expect(isList('ada@x.com b', 'ada@x.com ')).toBe(false);
    expect(isList('ada@x.com, grace@y.com', '')).toBe(true);
  });
});

describe('addRowAfter', () => {
  it('adds after the row named, with its role', () => {
    const rows = [row('a', '', 'admin'), row('b')];
    const { rows: next, added } = addRowAfter(rows, 'a', counter());
    expect(next.map((each) => each.id)).toEqual(['a', 'n1', 'b']);
    expect(added.roleId).toBe('admin');
  });
  it('adds after the last row when none is named', () => {
    const { rows: next } = addRowAfter([row('a'), row('b')], undefined, counter());
    expect(next.map((each) => each.id)).toEqual(['a', 'b', 'n1']);
  });
});

describe('removeRow', () => {
  it('removes the row and points at the one before it', () => {
    const { rows: next, focus } = removeRow([row('a'), row('b'), row('c')], 'b');
    expect(next.map((each) => each.id)).toEqual(['a', 'c']);
    expect(focus?.id).toBe('a');
  });
  it('points at the new first row when the first goes', () => {
    expect(removeRow([row('a'), row('b')], 'a').focus?.id).toBe('b');
  });
});

describe('pasteInto', () => {
  it('fills the row and adds one per other address after it, with its role', () => {
    const result = pasteInto([row('a', '', 'admin'), row('b')], 'a', 'x@x.com, y@y.com', 20, counter());
    expect(result.rows.map((each) => [each.id, each.email, each.roleId])).toEqual([
      ['a', 'x@x.com', 'admin'],
      ['n1', 'y@y.com', 'admin'],
      ['b', '', 'member'],
    ]);
    expect(result.last?.id).toBe('n1');
    expect(result).toMatchObject({ kept: 2, dropped: 0 });
  });
  it('keeps to the most rows and says how many were dropped', () => {
    const result = pasteInto([row('a'), row('b')], 'b', 'p@x.com q@x.com r@x.com', 3, counter());
    expect(result.rows).toHaveLength(3);
    expect(result).toMatchObject({ kept: 2, dropped: 1 });
  });
  it('leaves the rows alone for an unknown row', () => {
    const rows = [row('a')];
    expect(pasteInto(rows, 'zz', 'p@x.com q@x.com', 20).rows).toBe(rows);
  });
});
