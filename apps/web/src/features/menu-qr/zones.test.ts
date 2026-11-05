import { describe, expect, it } from 'vitest';
import { UNZONED, zoneGroups, zoneHue } from './zones.ts';

const table = (label: string, zone?: string) => ({ label, ...(zone === undefined ? {} : { zone }) });

describe('zones', () => {
  it('gives a zone the same colour for the same name, whatever its case or spaces', () => {
    expect(zoneHue('Patio')).toBe(zoneHue(' patio '));
    expect(zoneHue('Patio')).not.toBe('gray');
  });

  it('groups tables A to Z by zone, Unzoned last, each in reading order', () => {
    const names = new Map([
      ['a', 'Window'],
      ['b', 'Bar'],
    ]);
    const groups = zoneGroups(
      [table('T10', 'a'), table('T2', 'a'), table('T1'), table('B1', 'b'), table('T3', 'gone')],
      (each) => each.zone,
      (zone) => names.get(zone),
      'Unzoned',
    );
    expect(groups.map((group) => group.name)).toEqual(['Bar', 'Window', 'Unzoned']);
    expect(groups[1]?.tables.map((each) => each.label)).toEqual(['T2', 'T10']);
    // A table whose zone is gone reads as Unzoned, and Unzoned wears no colour.
    expect(groups[2]).toMatchObject({ id: UNZONED, tables: [{ label: 'T1' }, { label: 'T3', zone: 'gone' }] });
    expect(groups[2]?.hue).toBeUndefined();
    expect(groups[0]?.hue).toBe(zoneHue('Bar'));
  });
});
