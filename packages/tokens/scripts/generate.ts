// `pnpm tokens:build` writes tokens.css from tokens.json and source.json.
// `pnpm tokens:check` (with --check) writes nothing and fails when the
// committed tokens.css isn't exactly what the generator makes, so a hand edit
// or a forgotten regenerate fails `pnpm check`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateTokensCss } from '../src/generate.ts';
import { TokenSource } from '../src/grammar.ts';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(PACKAGE, 'tokens.css');
const check = process.argv.includes('--check');

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(PACKAGE, file), 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`TOKENS_INVALID: ${file} could not be read as JSON (${reason}).`);
    process.exit(1);
  }
}

const source = TokenSource.safeParse(readJson('source.json'));
if (!source.success) {
  console.error(
    `TOKENS_INVALID: source.json needs artifact, version and synced (${source.error.issues[0]?.message ?? ''}).`,
  );
  process.exit(1);
}

const result = generateTokensCss(readJson('tokens.json'), {
  version: source.data.version,
  fontFiles: readdirSync(path.join(PACKAGE, 'fonts')),
});
if (!result.ok) {
  console.error(`${result.error.code}: ${result.error.message}`);
  process.exit(1);
}

if (check) {
  const committed = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (committed !== result.css) {
    console.error('TOKENS_STALE: packages/tokens/tokens.css does not match tokens.json. Run `pnpm tokens:build`.');
    process.exit(1);
  }
  console.log('tokens.css matches tokens.json.');
} else {
  writeFileSync(OUTPUT, result.css);
  console.log(`Wrote tokens.css from artifact version ${source.data.version}.`);
}
