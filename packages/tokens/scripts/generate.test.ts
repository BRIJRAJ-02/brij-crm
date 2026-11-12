// AC-2 and AC-3 at the command line (spec 0002), and spec 0071 AC-1. `pnpm tokens:build` copies the source into
// tokens.json and writes tokens.css and values.ts, or on a broken input prints the coded error, exits 1 and writes
// nothing. `pnpm tokens:check` (--check) never writes, and fails with TOKENS_SOURCE_DRIFT when the copy differs from
// the source, and TOKENS_STALE when a generated file no longer matches.
// Each test runs the real script in a throwaway copy of the package.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const sandboxes: string[] = [];

/** The sandbox's own copy of the design source, which its source.json points at. */
const SOURCE = 'source-tokens.json';

/** A copy of the package's script, source, fonts and token files, with its dependencies linked in. */
function sandbox(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-tokens-cli-'));
  sandboxes.push(dir);
  for (const entry of [
    'scripts',
    'src',
    'fonts',
    'tokens.json',
    'legacy.json',
    'source.json',
    'tokens.css',
    'tokens-app.css',
    'values.ts',
  ]) {
    cpSync(path.join(PACKAGE, entry), path.join(dir, entry), { recursive: true });
  }
  cpSync(path.join(PACKAGE, 'tokens.json'), path.join(dir, SOURCE));
  const source = JSON.parse(readFileSync(path.join(PACKAGE, 'source.json'), 'utf8')) as Record<string, string>;
  writeFileSync(path.join(dir, 'source.json'), JSON.stringify({ ...source, source: `./${SOURCE}` }));
  symlinkSync(path.join(PACKAGE, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function run(dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts/generate.ts'), ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

/** Rewrites the sandbox's design source through `change`. */
function editTokens(dir: string, change: (tokens: Record<string, unknown>) => void): void {
  const tokens = JSON.parse(read(dir, SOURCE)) as Record<string, unknown>;
  change(tokens);
  writeFileSync(path.join(dir, SOURCE), JSON.stringify(tokens, null, 2));
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Each test starts a fresh Node on the generator; on a CI runner busy with every other package's suite the first
// cold start alone has passed vitest's 5 second default, so these get room that a real hang still exceeds.
const SPAWN_TIMEOUT_MS = 30_000;

describe('tokens:build (AC-2)', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('writes the same tokens.css that is committed', () => {
    const dir = sandbox();
    rmSync(path.join(dir, 'tokens.css'));
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Wrote tokens.json, tokens.css, tokens-app.css and values.ts from artifact version',
    );
    expect(read(dir, 'tokens.css')).toBe(readFileSync(path.join(PACKAGE, 'tokens.css'), 'utf8'));
    expect(read(dir, 'values.ts')).toBe(readFileSync(path.join(PACKAGE, 'values.ts'), 'utf8'));
  });

  it('copies the source into tokens.json byte for byte (spec 0071, AC-1)', () => {
    const dir = sandbox();
    writeFileSync(path.join(dir, 'tokens.json'), '{}');
    expect(run(dir).status).toBe(0);
    expect(read(dir, 'tokens.json')).toBe(read(dir, SOURCE));
  });

  it('refuses a legacy token that the source also has, with TOKENS_DUPLICATE (spec 0071, AC-13)', () => {
    const dir = sandbox();
    const legacy = JSON.parse(read(dir, 'legacy.json')) as { size: { tokens: Record<string, string>[] } };
    legacy.size.tokens.push({ name: 'size-row', value: '34px', retire: 'never' });
    writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify(legacy));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_DUPLICATE: --size-row/);
  });

  it('refuses a colour without its dark value, exits 1 and leaves tokens.css untouched', () => {
    const dir = sandbox();
    const before = read(dir, 'tokens.css');
    editTokens(dir, (tokens) => {
      const color = tokens.color as { tokens: { value: Record<string, string> }[] };
      const first = color.tokens[0];
      if (first) first.value = { light: '#ffffff' };
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: /);
    expect(read(dir, 'tokens.css')).toBe(before);
  });

  it('refuses an unknown top level family with TOKENS_UNKNOWN_FAMILY', () => {
    const dir = sandbox();
    editTokens(dir, (tokens) => {
      tokens.motion = { curves: ['ease'] };
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_UNKNOWN_FAMILY: .*"motion"/);
  });

  it('refuses a tokens.json that is not JSON, and writes nothing', () => {
    const dir = sandbox();
    rmSync(path.join(dir, 'tokens.css'));
    writeFileSync(path.join(dir, SOURCE), '{ not json');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: source-tokens\.json could not be read as JSON/);
    expect(existsSync(path.join(dir, 'tokens.css'))).toBe(false);
  });

  it('refuses a source.json without its artifact version', () => {
    const dir = sandbox();
    writeFileSync(
      path.join(dir, 'source.json'),
      JSON.stringify({ source: `./${SOURCE}`, artifact: 'https://claude.ai/artifact/x', synced: '2026-10-01' }),
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: source\.json needs source, artifact, version and synced/);
  });

  it('refuses a font file tokens.json names but fonts/ lacks', () => {
    const dir = sandbox();
    rmSync(path.join(dir, 'fonts/Geist-Variable-latin.woff2'));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: Font "Geist"/);
  });
});

describe('tokens:check (AC-3)', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes on the committed files and writes nothing', () => {
    const dir = sandbox();
    const before = read(dir, 'tokens.css');
    const result = run(dir, '--check');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'tokens.json matches its source, and tokens.css, tokens-app.css and values.ts match tokens.json.',
    );
    expect(read(dir, 'tokens.css')).toBe(before);
  });

  it('fails with TOKENS_STALE after a hand edit, and does not repair it', () => {
    const dir = sandbox();
    const edited = `${read(dir, 'tokens.css')}/* a hand edit */\n`;
    writeFileSync(path.join(dir, 'tokens.css'), edited);
    const result = run(dir, '--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TOKENS_STALE');
    expect(result.stderr).toContain('pnpm tokens:build');
    expect(read(dir, 'tokens.css')).toBe(edited);
  });

  it('fails with TOKENS_SOURCE_DRIFT when the source changed without a build (spec 0071, AC-1)', () => {
    const dir = sandbox();
    editTokens(dir, (tokens) => {
      const spacing = tokens.spacing as { tokens: { value: string }[] };
      const first = spacing.tokens[0];
      if (first) first.value = '3px';
    });
    expect(run(dir, '--check').stderr).toContain('TOKENS_SOURCE_DRIFT');
  });

  it('fails with TOKENS_SOURCE_DRIFT when the copy was edited by hand', () => {
    const dir = sandbox();
    writeFileSync(path.join(dir, 'tokens.json'), `${read(dir, 'tokens.json')} `);
    const result = run(dir, '--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TOKENS_SOURCE_DRIFT');
  });

  it('fails with TOKENS_STALE when values.ts was edited by hand', () => {
    const dir = sandbox();
    writeFileSync(path.join(dir, 'values.ts'), `${read(dir, 'values.ts')}// a hand edit\n`);
    expect(run(dir, '--check').stderr).toContain('TOKENS_STALE: packages/tokens/values.ts');
  });

  it('fails when only source.json changed, since the header names the version', () => {
    const dir = sandbox();
    const source = JSON.parse(read(dir, 'source.json')) as Record<string, string>;
    writeFileSync(path.join(dir, 'source.json'), JSON.stringify({ ...source, version: 'a-newer-version' }));
    expect(run(dir, '--check').status).toBe(1);
  });

  it('fails when tokens.css is missing, without creating it', () => {
    const dir = sandbox();
    rmSync(path.join(dir, 'tokens.css'));
    const result = run(dir, '--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TOKENS_STALE');
    expect(existsSync(path.join(dir, 'tokens.css'))).toBe(false);
  });
});
