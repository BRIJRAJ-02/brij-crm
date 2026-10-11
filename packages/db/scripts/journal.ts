// The migration journal's order rules. Drizzle's migrator applies a migration
// only when its `when` is later than the last one the database applied, so a
// migration stamped earlier than one already deployed is skipped for good,
// with no error (twice on 12 October 2026, when parallel lanes generated
// migrations in one order and landed them in another).
//
// `pnpm --filter @crm/db check:journal [<base ref>]` checks the committed
// journal: indexes run 0, 1, 2 and tags start with their padded index, every
// `when` is later than the one before, and, given a base ref (CI passes the
// commit the push replaced), the base's entries are kept unchanged and every
// new entry is stamped after the base's last. To fix a refusal, renumber the
// new migration after the base's last and stamp its `when` with the time now.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';

export const JournalEntry = z.object({ idx: z.number().int(), when: z.number().int(), tag: z.string() });
export type JournalEntry = z.infer<typeof JournalEntry>;

export const Journal = z.object({ entries: z.array(JournalEntry) });
export type Journal = z.infer<typeof Journal>;

const JOURNAL_PATH = 'packages/db/migrations/meta/_journal.json';

/** Every way `head` breaks the order rules, alone or against `base`; empty when it keeps them. */
export function journalProblems(head: Journal, base?: Journal): readonly string[] {
  const problems: string[] = [];
  head.entries.forEach((entry, position) => {
    if (entry.idx !== position)
      problems.push(`${entry.tag} has idx ${String(entry.idx)}, expected ${String(position)}.`);
    if (!entry.tag.startsWith(`${String(position).padStart(4, '0')}_`)) {
      problems.push(`${entry.tag} should start with ${String(position).padStart(4, '0')}_.`);
    }
    const before = head.entries[position - 1];
    if (before !== undefined && entry.when <= before.when) {
      problems.push(`${entry.tag} is stamped ${String(entry.when)}, not after ${before.tag} (${String(before.when)}).`);
    }
  });
  if (base === undefined) return problems;
  base.entries.forEach((entry, position) => {
    const kept = head.entries[position];
    if (kept?.tag !== entry.tag || kept.when !== entry.when) {
      problems.push(`${entry.tag} was already committed and must stay as it was, at position ${String(position)}.`);
    }
  });
  const last = base.entries.at(-1);
  if (last !== undefined) {
    for (const entry of head.entries.slice(base.entries.length)) {
      if (entry.when <= last.when) {
        problems.push(`${entry.tag} is new but stamped before ${last.tag}, so a database that has it would skip it.`);
      }
    }
  }
  return problems;
}

function readBase(ref: string): Journal | undefined {
  if (/^0+$/.test(ref)) return undefined;
  try {
    return Journal.parse(JSON.parse(execFileSync('git', ['show', `${ref}:${JOURNAL_PATH}`], { encoding: 'utf8' })));
  } catch {
    console.warn(`No journal at ${ref}; checking the committed journal alone.`);
    return undefined;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const head = Journal.parse(JSON.parse(readFileSync(`${root}${JOURNAL_PATH}`, 'utf8')));
  const ref = process.argv[2];
  const problems = journalProblems(head, ref === undefined || ref === '' ? undefined : readBase(ref));
  if (problems.length > 0) {
    console.error(
      `MIGRATION_ORDER: the migration journal breaks the order rules.\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`Migration journal in order (${String(head.entries.length)} entries).`);
}
