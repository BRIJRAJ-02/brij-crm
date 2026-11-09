// The business apps stay on for every workspace (spec 0065, 6 Nov 2026, the owner: "those business apps should be
// active directly ... without going and manually active"). This fails if a per workspace gate comes back: the rule
// itself is held here, and no code outside packages/db (which keeps the unused column and function for a later clean
// up) may name the old flag again.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { appsOn, APPS_ON_BY_DEFAULT, HOSPITALITY_APPS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../../..');
const SEARCHED = [
  'packages/contracts/src',
  'packages/core/src',
  'packages/core/test',
  'packages/data/src',
  'apps/api/src',
  'apps/web/src',
  'apps/web/e2e',
];
// This file, and the flow that checks no screen says it.
const ALLOWED = ['packages/core/src/hospitality/open-to-all.test.ts', 'apps/web/e2e/business-apps.flow.ts'];

/** Every source file under `dir`. */
function filesUnder(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the business apps, open to every workspace', () => {
  it('has every app but Events on with nothing stored', () => {
    expect([...appsOn([])]).toEqual(['menu', 'menu_qr', 'table_seating', 'appointments']);
    expect(APPS_ON_BY_DEFAULT).toEqual(HOSPITALITY_APPS.filter((app) => app !== 'events'));
  });

  it('lets a switch-off win, and Menu QR never outlive Menu', () => {
    expect([...appsOn([{ app: 'menu', removed: true }])]).toEqual(['table_seating', 'appointments']);
    expect(appsOn([{ app: 'table_seating', removed: true }]).has('table_seating')).toBe(false);
    // An Events row from before stays off: Events can't be switched off now, so it would keep a page up.
    expect(appsOn([{ app: 'events', removed: false }]).has('events')).toBe(false);
    expect(appsOn([{ app: 'menu', removed: false }]).has('menu_qr')).toBe(true);
  });

  it('names no early access in any code or copy outside the database package', () => {
    const named = SEARCHED.flatMap((dir) => filesUnder(join(ROOT, dir)))
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.includes(path))
      .filter((path) => /early[\s_/*-]*access|business_apps/i.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(named).toEqual([]);
  });
});
