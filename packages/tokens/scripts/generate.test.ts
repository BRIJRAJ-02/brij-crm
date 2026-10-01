// AC-2 and AC-3 at the command line. `pnpm tokens:build` writes tokens.css, or
// on a broken input prints the coded error, exits 1 and writes nothing.
// `pnpm tokens:check` (--check) never writes, and fails with TOKENS_STALE when
// the committed CSS no longer matches tokens.json and source.json.
// Each test runs the real script in a throwaway copy of the package.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const sandboxes: string[] = [];

/** A copy of the package's script, source, fonts and token files, with its dependencies linked in. */
function sandbox(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-tokens-cli-'));
  sandboxes.push(dir);
  for (const entry of ['scripts', 'src', 'fonts', 'tokens.json', 'source.json', 'tokens.css']) {
    cpSync(path.join(PACKAGE, entry), path.join(dir, entry), { recursive: true });
  }
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

/** Rewrites the sandbox's tokens.json through `change`. */
function editTokens(dir: string, change: (tokens: Record<string, unknown>) => void): void {
  const tokens = JSON.parse(read(dir, 'tokens.json')) as Record<string, unknown>;
  change(tokens);
  writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2));
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('tokens:build (AC-2)', () => {
  it('writes the same tokens.css that is committed', () => {
    const dir = sandbox();
    rmSync(path.join(dir, 'tokens.css'));
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Wrote tokens.css from artifact version');
    expect(read(dir, 'tokens.css')).toBe(readFileSync(path.join(PACKAGE, 'tokens.css'), 'utf8'));
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
    writeFileSync(path.join(dir, 'tokens.json'), '{ not json');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: tokens\.json could not be read as JSON/);
    expect(existsSync(path.join(dir, 'tokens.css'))).toBe(false);
  });

  it('refuses a source.json without its artifact version', () => {
    const dir = sandbox();
    writeFileSync(
      path.join(dir, 'source.json'),
      JSON.stringify({ artifact: 'https://claude.ai/artifact/x', synced: '2026-10-01' }),
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: source\.json needs artifact, version and synced/);
  });

  it('refuses a font file tokens.json names but fonts/ lacks', () => {
    const dir = sandbox();
    rmSync(path.join(dir, 'fonts/Inter-Variable-latin.woff2'));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^TOKENS_INVALID: Font "Inter"/);
  });
});

describe('tokens:check (AC-3)', () => {
  it('passes on the committed files and writes nothing', () => {
    const dir = sandbox();
    const before = read(dir, 'tokens.css');
    const result = run(dir, '--check');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('tokens.css matches tokens.json.');
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

  it('fails when tokens.json changed without a regenerate', () => {
    const dir = sandbox();
    editTokens(dir, (tokens) => {
      const spacing = tokens.spacing as { tokens: { value: string }[] };
      const first = spacing.tokens[0];
      if (first) first.value = '3px';
    });
    expect(run(dir, '--check').stderr).toContain('TOKENS_STALE');
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
