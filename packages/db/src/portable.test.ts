// The migrations have to run on every Postgres our productions use, and today those differ: Timefix's database is
// 17.11 while brij-crm's is 18.6 (25 October 2026). CI only ever sees 18, so a built in that arrived in 18 passes
// every test here and then raises 42883 on Timefix. That is exactly how `crm_place_profile_page` shipped calling
// `pg_catalog.uuidv7()` and broke creating a Public booking page there, fixed in migration 0110.
//
// This walk reads the committed SQL and refuses any call that names a schema only one of those versions has. It is
// a text check on purpose: it needs no database, so it fails in a second, on the machine that wrote the migration.
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * Functions Postgres 18 added to `pg_catalog`. Qualifying one with `pg_catalog.` ties the migration to 18; writing
 * it unqualified, or as `public.<name>()`, finds the shim on 17 and the built in on 18.
 */
const ONLY_IN_18 = ['uuidv7', 'uuidv4', 'uuid_extract_timestamp', 'uuid_extract_version'];

/**
 * Migrations whose call is history: already applied everywhere and since replaced, so the file stays as it ran.
 * 0098 created `crm_place_profile_page` with the pg_catalog call; migration 0110 replaces that body.
 */
const SUPERSEDED = new Set(['0098_profile_items.sql']);

/** A line may name the built in when it carries this marker, which 0110's wrapper does. */
const ALLOWED = 'portable:ok';

const FOLDER = new URL('../migrations/', import.meta.url);

async function migrations(): Promise<readonly { readonly name: string; readonly sql: string }[]> {
  const names = (await readdir(FOLDER)).filter((name) => name.endsWith('.sql')).sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: await readFile(new URL(name, FOLDER), 'utf8') })));
}

describe('the migrations run on both productions', () => {
  it('never qualifies a Postgres 18 built in with pg_catalog', async () => {
    const found: string[] = [];
    for (const { name, sql } of await migrations()) {
      if (SUPERSEDED.has(name)) continue;
      const lines = sql.split('\n');
      for (const fn of ONLY_IN_18) {
        const call = new RegExp(`pg_catalog\\.${fn}\\s*\\(`);
        for (const [at, line] of lines.entries()) {
          if (!call.test(line)) continue;
          if (line.trimStart().startsWith('--')) continue;
          if (line.includes(ALLOWED)) continue;
          if (lines[at - 1]?.includes(ALLOWED) === true) continue;
          found.push(`${name}: ${line.trim()}`);
        }
      }
    }
    expect(
      found,
      'Postgres 17 has no pg_catalog.uuidv7(). Write uuidv7() unqualified, or public.uuidv7() inside a function ' +
        'whose search_path excludes public (migration 0110).',
    ).toEqual([]);
  });

  it('still has the one call that broke Timefix written the portable way', async () => {
    const all = await migrations();
    const fix = all.find((m) => m.name.startsWith('0110_'));
    expect(fix, 'migration 0110 is what makes uuidv7 mean the same on 17 and 18').toBeDefined();
    expect(fix?.sql).toContain('public.uuidv7()');
  });
});
