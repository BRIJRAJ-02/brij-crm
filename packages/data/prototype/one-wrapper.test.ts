// House rule: a vendor is imported in exactly one module. Until the shared
// lint config lists TanStack DB as a vendor (task 11), this holds it here.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const PACKAGE = path.join(import.meta.dirname, '..');

function sources(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

it('imports TanStack DB in one module only, prototype/tanstack-store.ts', () => {
  const importers = [...sources(path.join(PACKAGE, 'src')), ...sources(path.join(PACKAGE, 'prototype'))]
    .filter((file) =>
      /from '@tanstack\/(react-)?db'|import\('@tanstack\/(react-)?db'\)/.test(readFileSync(file, 'utf8')),
    )
    .map((file) => path.relative(PACKAGE, file));
  expect(importers).toEqual([path.join('prototype', 'tanstack-store.ts')]);
});
