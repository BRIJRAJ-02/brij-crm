// Ids at the boundary (spec 0009): every UUID the contract parses comes out in
// lower case, the spelling every access policy is keyed by, so an upper case
// spelling can't slip past an object's record rule. A raw `z.uuid()` would let
// one through again, so the guard below fails on any outside the two places
// that keep their own spelling on purpose.
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QueryRecordsInput } from './records.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

const SPELLED = '01A15D32-2FC4-7E91-8230-6352BE3B3B30';

describe('ids at the boundary', () => {
  it('answers a UUID in any case in lower case, and refuses anything else', () => {
    expect(Uuid.parse(SPELLED)).toBe(SPELLED.toLowerCase());
    expect(Uuid.safeParse('not-an-id').success).toBe(false);
    const v7 = uuidV7('The record id must be a UUID v7.');
    expect(v7.parse(SPELLED)).toBe(SPELLED.toLowerCase());
    expect(v7.safeParse('6f8482a6-84ef-4225-ae84-747bad7b421a').error?.issues[0]?.message).toBe(
      'The record id must be a UUID v7.',
    );
  });

  it('hands a request’s ids to the server in lower case', () => {
    const input = QueryRecordsInput.parse({ workspace: 'acme', objectId: SPELLED });
    expect(input.objectId).toBe(SPELLED.toLowerCase());
  });

  it('declares no raw z.uuid() outside record keys and the values that lower case their own', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(root, { recursive: true }))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => file.split(sep).join('/'))
      // ids.ts builds Uuid from it; attribute values trim and lower case an id before they check it.
      .filter((file) => file !== 'values/ids.ts' && file !== 'values/attribute-values.ts');
    const offenders: string[] = [];
    for (const file of files) {
      // A record keyed by ids keeps the caller's spelling: core canonicalises the keys and refuses two spellings.
      const source = (await readFile(join(root, file), 'utf8')).replaceAll('z.record(z.uuid(),', '');
      if (source.includes('z.uuid(')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
