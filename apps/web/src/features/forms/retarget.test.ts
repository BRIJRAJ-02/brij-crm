// Whether changing a form's object asks first: only when questions are saved onto the object now.
import { describe, expect, it } from 'vitest';
import { retargetStep } from './retarget.ts';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const DEALS = '0199f0a0-0000-7000-8000-00000000000d';
const OBJECTS = [
  { id: PEOPLE, pluralName: 'People' },
  { id: DEALS, pluralName: 'Deals' },
];
const filed = { attributeId: '0199f0a0-0000-7000-8000-0000000000e1' };
const draftOn = (objectId: string | undefined, filedOn: readonly (typeof filed | undefined)[]) =>
  ({
    targets: objectId === undefined ? {} : { main: { objectId } },
    questions: filedOn.map((on, index) => ({
      id: String(index),
      label: `Q${String(index)}`,
      ...(on === undefined ? {} : { filedOn: on }),
    })),
  }) as unknown as Parameters<typeof retargetStep>[0];

describe('changing a form’s object', () => {
  it('asks first when questions are saved onto the object, naming how many and both objects', () => {
    expect(retargetStep(draftOn(PEOPLE, [filed, filed, undefined]), OBJECTS, DEALS, 'this object')).toEqual({
      kind: 'ask',
      ask: { objectId: DEALS, filedCount: 2, objectName: 'People', nextName: 'Deals' },
    });
  });

  it('asks before saving to the CRM is turned off too', () => {
    expect(retargetStep(draftOn(PEOPLE, [filed]), OBJECTS, null, 'this object')).toMatchObject({
      kind: 'ask',
      ask: { objectId: null, filedCount: 1, objectName: 'People' },
    });
  });

  it('goes at once when no question is saved anywhere, so nothing is lost', () => {
    expect(retargetStep(draftOn(PEOPLE, [undefined, undefined]), OBJECTS, DEALS, 'this object')).toEqual({
      kind: 'go',
    });
    expect(retargetStep(draftOn(undefined, []), OBJECTS, PEOPLE, 'this object')).toEqual({ kind: 'go' });
  });

  it('does nothing for the object it already saves to', () => {
    expect(retargetStep(draftOn(PEOPLE, [filed]), OBJECTS, PEOPLE, 'this object')).toEqual({ kind: 'nothing' });
  });

  it('names an object it can no longer find plainly, never by its id', () => {
    const gone = '0199f0a0-0000-7000-8000-0000000000ff';
    expect(retargetStep(draftOn(gone, [filed]), OBJECTS, DEALS, 'this object')).toMatchObject({
      ask: { objectName: 'this object', nextName: 'Deals' },
    });
  });
});
