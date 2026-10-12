// The attribute writes' inputs (spec 0012, milestone 2): the types a create
// takes are exactly the type picker's, and the ids are the client's UUID v7.
import { describe, expect, it } from 'vitest';
import { CreateAttributeInput, PickerAttributeType, TargetDays, UpdateAttributeInput } from './attributes.ts';
import { CreateOptionInput, UpdateOptionInput } from './options.ts';
import { PICKER_TYPES, pickerTypeOf } from './values/picker.ts';

const workspace = 'acme';
const objectId = '0199d6a4-0000-7000-8000-000000000001';
const id = '0199d6a4-0000-7000-8000-000000000002';
const mutationId = '0199d6a4-0000-7000-8000-000000000003';

describe('the attribute writes', () => {
  it('take exactly the types the picker offers (AC-228)', () => {
    expect([...PickerAttributeType.options].sort()).toEqual([...new Set(PICKER_TYPES.map((each) => each.type))].sort());
  });

  it('finds the picker entry an attribute came from, and which entries offer Unique and Allow multiple', () => {
    expect(pickerTypeOf('select', true)?.key).toBe('multi_select');
    expect(pickerTypeOf('select', false)?.key).toBe('select');
    expect(pickerTypeOf('url', false)?.key).toBe('link');
    expect(pickerTypeOf('actor_reference', true)?.key).toBe('member');
    expect(pickerTypeOf('record_reference', false)).toBeUndefined();
    expect(PICKER_TYPES.filter((entry) => entry.allowsUnique).map((entry) => entry.key)).toEqual([
      'text',
      'number',
      'email',
      'phone',
      'link',
    ]);
    expect(PICKER_TYPES.filter((entry) => entry.allowsMultiple).map((entry) => entry.key)).toEqual([
      'email',
      'phone',
      'member',
    ]);
  });

  it('refuses a create whose id is not a UUID v7', () => {
    const create = { workspace, objectId, title: 'Nickname', type: 'text', mutationId };
    expect(CreateAttributeInput.safeParse({ ...create, id }).success).toBe(true);
    expect(CreateAttributeInput.safeParse({ ...create, id: '0199d6a4-0000-4000-8000-000000000002' }).success).toBe(
      false,
    );
  });

  it('refuses a record reference, which only a relationship makes', () => {
    expect(
      CreateAttributeInput.safeParse({
        workspace,
        objectId,
        id,
        title: 'Company',
        type: 'record_reference',
        mutationId,
      }).success,
    ).toBe(false);
  });

  it('clears a description and a default with null', () => {
    const parsed = UpdateAttributeInput.parse({
      workspace,
      attributeId: id,
      description: null,
      defaultValue: null,
      mutationId,
    });
    expect(parsed).toMatchObject({ description: null, defaultValue: null });
  });
});

describe('the option writes (spec 0012, milestone 3)', () => {
  const option = { id: '0199d6a4-0000-7000-8000-000000000004', label: 'Lead', hue: 'gray' };

  it('takes a target time in whole days from 1 to 365 only', () => {
    expect(TargetDays.safeParse('P1D').success).toBe(true);
    expect(TargetDays.safeParse('P365D').success).toBe(true);
    for (const refused of ['P0D', 'P366D', 'P1000D', 'PT4H', 'P1W', '7']) {
      expect(TargetDays.safeParse(refused).success).toBe(false);
    }
  });

  it('makes a select or status with its first options, each with a UUID v7 and a trimmed label', () => {
    const create = { workspace, objectId, id, title: 'Stage', type: 'status', mutationId };
    const parsed = CreateAttributeInput.parse({
      ...create,
      options: [{ ...option, label: '  Lead ', outcome: 'open' }],
    });
    expect(parsed.options).toEqual([{ ...option, outcome: 'open' }]);
    const v4 = '0199d6a4-0000-4000-8000-000000000004';
    expect(CreateAttributeInput.safeParse({ ...create, options: [{ ...option, id: v4 }] }).success).toBe(false);
    expect(CreateAttributeInput.safeParse({ ...create, options: [{ ...option, label: ' ' }] }).success).toBe(false);
  });

  it('clears a stage’s target time with null, and needs a v7 id for a new option', () => {
    expect(
      UpdateOptionInput.parse({ workspace, optionId: id, targetTimeInStage: null, mutationId }).targetTimeInStage,
    ).toBeNull();
    const create = { workspace, attributeId: objectId, label: 'Gold', mutationId };
    expect(CreateOptionInput.safeParse({ ...create, id }).success).toBe(true);
    expect(CreateOptionInput.safeParse({ ...create, id: '0199d6a4-0000-4000-8000-000000000002' }).success).toBe(false);
  });
});
