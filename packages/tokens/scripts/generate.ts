// `pnpm tokens:build` copies the source tokens.json (source.json `source`) into
// this package byte for byte, then writes tokens.css and values.ts from it and
// legacy.json. `pnpm tokens:check` (with --check) writes nothing and fails when
// the copy differs from the source (TOKENS_SOURCE_DRIFT) or a generated file
// isn't exactly what the generator makes (TOKENS_STALE), so a hand edit or a
// forgotten build fails `pnpm check` (spec 0002 AC-3, spec 0071 AC-1).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateTokensCss } from '../src/generate.ts';
import { TokenSource } from '../src/grammar.ts';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const COPY = path.join(PACKAGE, 'tokens.json');
const LEGACY = path.join(PACKAGE, 'legacy.json');
const OUTPUTS = {
  css: path.join(PACKAGE, 'tokens.css'),
  appCss: path.join(PACKAGE, 'tokens-app.css'),
  values: path.join(PACKAGE, 'values.ts'),
} as const;
const check = process.argv.includes('--check');

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return stop(`TOKENS_INVALID: ${path.relative(PACKAGE, file)} could not be read (${reason}).`);
  }
}

function parseJson(file: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return stop(`TOKENS_INVALID: ${path.relative(PACKAGE, file)} could not be read as JSON (${reason}).`);
  }
}

const source = TokenSource.safeParse(parseJson('source.json', readText(path.join(PACKAGE, 'source.json'))));
if (!source.success) {
  stop(
    `TOKENS_INVALID: source.json needs source, artifact, version and synced (${source.error.issues[0]?.message ?? ''}).`,
  );
}

const sourceFile = path.resolve(PACKAGE, source.data.source);
const sourceText = readText(sourceFile);
if (check) {
  const copy = existsSync(COPY) ? readFileSync(COPY, 'utf8') : '';
  if (copy !== sourceText) {
    stop(
      `TOKENS_SOURCE_DRIFT: packages/tokens/tokens.json is not a byte for byte copy of ${source.data.source}. Run \`pnpm tokens:build\`.`,
    );
  }
}

const result = generateTokensCss(parseJson(sourceFile, sourceText), {
  version: source.data.version,
  fontFiles: readdirSync(path.join(PACKAGE, 'fonts')),
  legacy: existsSync(LEGACY) ? parseJson(LEGACY, readText(LEGACY)) : undefined,
});
if (!result.ok) stop(`${result.error.code}: ${result.error.message}`);

if (check) {
  for (const [kind, file] of Object.entries(OUTPUTS)) {
    const committed = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (committed !== result[kind as keyof typeof OUTPUTS]) {
      stop(
        `TOKENS_STALE: packages/tokens/${path.basename(file)} does not match tokens.json. Run \`pnpm tokens:build\`.`,
      );
    }
  }
  console.log('tokens.json matches its source, and tokens.css, tokens-app.css and values.ts match tokens.json.');
} else {
  writeFileSync(COPY, sourceText);
  writeFileSync(OUTPUTS.css, result.css);
  writeFileSync(OUTPUTS.appCss, result.appCss);
  writeFileSync(OUTPUTS.values, result.values);
  console.log(
    `Wrote tokens.json, tokens.css, tokens-app.css and values.ts from artifact version ${source.data.version}.`,
  );
}
