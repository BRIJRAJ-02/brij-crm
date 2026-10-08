// Each monitoring vendor is imported in exactly one wrapper (spec 0010,
// AC-184), as this workspace's real ESLint config enforces it: the api's
// Sentry wrapper may import @sentry/node and nothing else of any vendor, and
// instrument.ts or any other file may import none.
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: ROOT });

/** The restricted import messages `source` gets when it sits at `file`. */
async function vendorProblems(file: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: path.join(ROOT, file) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === '@typescript-eslint/no-restricted-imports')
    .map((message) => message.message);
}

const importing = (entry: string) => `import * as vendor from '${entry}';\nexport const v = vendor;\n`;

describe('monitoring vendors in apps/api', () => {
  it('lets the Sentry wrapper import @sentry/node', async () => {
    expect(await vendorProblems('src/monitoring/sentry.ts', importing('@sentry/node'))).toEqual([]);
  });

  it.each([
    ['src/monitoring/sentry.ts', 'posthog-node'],
    ['src/monitoring/sentry.ts', '@sentry/react'],
    ['src/monitoring/instrument.ts', '@sentry/node'],
    ['src/monitoring/config.ts', '@sentry/node'],
    ['src/app.ts', '@sentry/node'],
    ['src/worker.ts', 'posthog-node'],
  ])('refuses %s importing %s', async (file, entry) => {
    expect((await vendorProblems(file, importing(entry))).join()).toMatch(/one wrapper module/);
  });
}, 60_000);
