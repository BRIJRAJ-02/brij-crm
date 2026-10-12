// The attribute writes' inputs (spec 0012, milestone 2): the types a create
// takes are exactly the type picker's, and the ids are the client's UUID v7.
import { describe, expect, it } from 'vitest';
import { CreateAttributeInput, PickerAttributeType, UpdateAttributeInput } from './attributes.ts';
import { PICKER_TYPES } from './values/picker.ts';

const workspace = 'acme';
const objectId = '0199d6a4-0000-7000-8000-000000000001';
const id = '0199d6a4-0000-7000-8000-000000000002';
const mutationId = '0199d6a4-0000-7000-8000-000000000003';

describe('the attribute writes', () => {
  it('take exactly the types the picker offers (AC-228)', () => {
    expect([...PickerAttributeType.options].sort()).toEqual([...new Set(PICKER_TYPES.map((each) => each.type))].sort());
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
