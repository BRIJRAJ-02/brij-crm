// A change the size of a record with hundreds of thousands of links (spec
// 0004, AC-17): collecting it and capping it must not overflow the stack. No
// database: the write runs against a stand in that hands over a transaction
// the work never touches.
import { describe, expect, it } from 'vitest';
import type { Database, WorkspaceTx } from '@crm/db';
import { newId } from './ids.ts';
import type { EngineScope } from './scope.ts';
import { CHANGE_CAP, capChange, cappedHook, runWrite, type CappedChange, type ReferenceChange } from './write.ts';

/** A database whose transaction is never used: the work only records a change. */
function standIn(): Database {
  const tx = {} as WorkspaceTx;
  return {
    withWorkspace: (_workspaceId, work) => work(tx),
    checkHealth: () => Promise.reject(new Error('Not in this test.')),
    assertAppRole: () => Promise.reject(new Error('Not in this test.')),
    vacuumAnalyze: () => Promise.reject(new Error('Not in this test.')),
    close: () => Promise.resolve(),
  };
}

const HUGE = 200_000;

describe('a huge change', () => {
  const scope: EngineScope = { db: standIn(), workspaceId: newId(), actor: { type: 'system', id: null } };
  const objectId = newId();
  const attributeId = newId();
  const references: readonly ReferenceChange[] = Array.from({ length: HUGE }, () => ({
    recordId: newId(),
    objectId,
    attributeId,
  }));

  it('records 200,000 references through context.record without overflowing the stack', async () => {
    // `push(...items)` threw `RangeError: Maximum call stack size exceeded` at about 125,000.
    const { change } = await runWrite(scope, (context) => {
      context.record({ deletedRecords: [{ recordId: newId(), objectId: newId() }], references });
      context.record({ references: references.slice(0, 3) });
      return Promise.resolve();
    });
    expect(change.references).toHaveLength(HUGE + 3);
    expect(change.references[HUGE - 1]).toEqual(references[HUGE - 1]);
    expect(change.deletedRecords).toHaveLength(1);
  });

  it('caps it to a coarse marker for the outbox, and hands a capped hook only the capped change', async () => {
    let seen: CappedChange | undefined;
    const { change } = await runWrite(
      scope,
      (context) => {
        context.record({ references });
        return Promise.resolve();
      },
      [
        cappedHook((capped) => {
          seen = capped;
          return Promise.resolve();
        }),
      ],
    );
    const capped = capChange(change);
    expect(HUGE).toBeGreaterThan(CHANGE_CAP);
    expect(capped.coarse).toEqual([{ objectId }]);
    expect(capped.references).toEqual([]);
    expect(seen?.coarse).toEqual([{ objectId }]);
    expect(seen?.references).toEqual([]);
    // The full change still reaches every other hook: the audit log names every record.
    expect(change.references).toHaveLength(HUGE);
  });
});
