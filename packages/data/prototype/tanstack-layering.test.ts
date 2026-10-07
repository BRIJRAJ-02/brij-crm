// AC-40's evidence for the call: TanStack DB's own optimistic transactions
// break the layering rule (spec 0005, writes). If an upgrade turns any of
// these false, the gate is worth running again (verify.md).
import { expect, it } from 'vitest';
import { probeTanstackLayering } from './tanstack-store.ts';

it('finds TanStack DB’s transactions break the layering rule four ways', async () => {
  expect(await probeTanstackLayering()).toEqual({
    refusalTakesLaterEdit: true,
    laterEditCarriesEarlierValue: true,
    newBaseHiddenUnderEdit: true,
    syncWriteWaitsForTransaction: true,
  });
});
