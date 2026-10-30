// Host away's Reassign (spec 0037, AC-1284): the stand in when switched on in the seat's rotation, else the next.
import type { RotationView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { awayPick } from './away-pick.ts';

const BO = '00000000-0000-4000-8000-000000000001';
const KIM = '00000000-0000-4000-8000-000000000002';

const member = (memberId: string, name: string, isOn = true): RotationView['members'][number] => ({
  memberId,
  name,
  isOn,
  weight: 100,
  priority: 2,
  dailyCap: null,
  weeklyCap: null,
  hasCalendar: true,
});

const rotation = (members: RotationView['members']) => ({ members }) as unknown as RotationView;

describe('awayPick', () => {
  it('hands it to the stand in, by name, when they are on in the group', () => {
    expect(awayPick(BO, rotation([member(BO, 'Bo Diaz'), member(KIM, 'Kim Park')]), true)).toEqual({
      kind: 'standin',
      memberId: BO,
      name: 'Bo Diaz',
    });
  });

  it('goes to the next in the group when the stand in is outside it or switched off', () => {
    expect(awayPick(BO, rotation([member(KIM, 'Kim Park')]), true)).toEqual({ kind: 'next', standinOutside: true });
    expect(awayPick(BO, rotation([member(BO, 'Bo Diaz', false)]), true)).toEqual({
      kind: 'next',
      standinOutside: true,
    });
  });

  it('goes to the next with no stand in, and still tries the stand in when the group could not be read', () => {
    expect(awayPick(undefined, rotation([member(KIM, 'Kim Park')]), true)).toEqual({
      kind: 'next',
      standinOutside: false,
    });
    expect(awayPick(BO, undefined, false)).toEqual({ kind: 'standin', memberId: BO });
  });
});
