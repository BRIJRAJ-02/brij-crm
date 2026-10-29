// The scheduling source scan (spec 0037, AC-1221): whose time someone may see or change is decided in one place,
// `access/scheduling.ts`. The scan fails on any `schedule.*` permission named in server code anywhere else (a
// `can(…)`, a `requirePermission(…)`, a permissions list), and on `booking.admin` in any file not listed below with
// its reason. `booking.admin` stays for things (booking pages, team pages, rotations, decision 12); job J4 swapped
// every use over someone's time for the reach and took it off this list, which only shrinks.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['packages/core/src', 'apps/api/src'];
const HOME = 'packages/core/src/access/scheduling.ts';

/** The files that may still name `booking.admin`, each with why. */
const BOOKING_ADMIN: Readonly<Record<string, string>> = {
  [HOME]: 'the reach itself: managesPageOf',
  'packages/core/src/access/table.ts': 'the access table: rotations are things (AC-751)',
  'packages/core/src/access/events.ts': 'live events: a booking’s audience is its page’s managers (decision 12)',
  'packages/core/src/booking/pages.ts': 'booking pages and team pages are things',
  'packages/core/src/booking/seen.ts': 'a page’s bookings are the page’s (decision 12), beside See and Manage reach',
  'packages/core/src/calendar/page-destination.ts': 'a booking page’s own destination: a thing',
  'packages/core/src/forms/forms.ts': 'which pages a form may hand to: things',
  'packages/core/src/home/metrics.ts': 'Home’s figures over every page’s bookings: things',
  'packages/core/src/rotation/rotations.ts': 'rotations are things (AC-751)',
  'packages/core/src/rotation/distribution.ts': 'a rotation’s distribution: a thing',
  'packages/core/src/routing/report.ts': 'routing reports over pages and forms: things',
};

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}

/** The file's code with its comments blanked, so prose naming a permission doesn't count. */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

async function scan(): Promise<{ readonly schedule: string[]; readonly bookingAdmin: string[] }> {
  const files = (await Promise.all(ROOTS.map((root) => sourceFiles(join(REPO, root))))).flat();
  const schedule: string[] = [];
  const bookingAdmin: string[] = [];
  for (const file of files) {
    const name = relative(REPO, file);
    const code = codeOf(await readFile(file, 'utf8'));
    if (name !== HOME && /['"`]schedule\.(view|manage)(\.team)?['"`]/.test(code)) schedule.push(name);
    if (/['"`]booking\.admin['"`]/.test(code) && !Object.hasOwn(BOOKING_ADMIN, name)) bookingAdmin.push(name);
  }
  return { schedule, bookingAdmin };
}

describe('the scheduling source scan (AC-1221)', () => {
  it('finds schedule.* only in access/scheduling.ts, and booking.admin only where listed', async () => {
    const found = await scan();
    expect(found.schedule).toEqual([]);
    expect(found.bookingAdmin).toEqual([]);
  });

  it('lists no file that no longer names booking.admin, so the list only shrinks', async () => {
    const stale: string[] = [];
    for (const name of Object.keys(BOOKING_ADMIN)) {
      const code = codeOf(await readFile(join(REPO, name), 'utf8'));
      if (!/['"`]booking\.admin['"`]/.test(code)) stale.push(name);
    }
    expect(stale).toEqual([]);
  });

  it('catches a stray check', () => {
    expect(/['"`]schedule\.(view|manage)(\.team)?['"`]/.test(codeOf("can(access, 'schedule.manage')"))).toBe(true);
    expect(/['"`]schedule\.(view|manage)(\.team)?['"`]/.test(codeOf("// can(access, 'schedule.manage')"))).toBe(false);
  });
});
