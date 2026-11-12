// Spec 0071's rename map: every old token name the code uses, rewritten to the
// prototype's name in one pass. Temporary: delete it once no open branch needs it.
//
//   node packages/tokens/scripts/rename-0071.ts            rewrite apps/, packages/ and tools/
//   node packages/tokens/scripts/rename-0071.ts --dry-run  list the files it would change
//
// Several renames swap names (heading and title, size-control and size-input,
// ease-out and ease-hover), so each match is looked up once in the map and never
// rewritten again: running it twice would swap them back. That is why it refuses
// to run on a tree that already has any name only phase 0 introduced. Run it on
// an open branch before rebasing onto the landed phase 0, never after.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const AREAS = ['apps', 'packages', 'tools'];
/** Never touched: the token source and its generated files (they carry the new names), and this script. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.vercel', '__screenshots__', '.vitest']);
const SKIP_PATHS = ['packages/tokens/'];
const EXTENSIONS = new Set(['.css', '.ts', '.tsx', '.mjs', '.js', '.md']);

/** Type style names, old → new (read bare by `typeToken('…')`). */
const TYPE_STYLES: Readonly<Record<string, string>> = {
  heading: 'title',
  title: 'heading',
  'title-regular': 'heading-regular',
  'note-title': 'title-lg',
  'label-strong': 'label',
};

/** Custom property names (without the leading --), old → new. */
const PROPERTIES: Readonly<Record<string, string>> = {
  ...typePairs('text'),
  ...typePairs('tracking'),
  'size-bar': 'size-topbar',
  'size-input': 'size-control',
  'size-control': 'size-control-sm',
  'size-measure': 'size-measure-sm',
  'surface-sidebar': 'canvas',
  'surface-sunken': 'surface-subtle',
  'surface-thumb': 'surface-raised',
  'surface-column': 'surface-subtle',
  'field-border': 'border-subtle',
  'accent-line': 'accent-text',
  'danger-fill': 'danger',
  'danger-fill-hover': 'danger-hover',
  'duration-hover': 'duration-quick',
  'duration-press': 'duration-quick',
  'duration-exit': 'duration-quick',
  'duration-popover': 'duration-fast',
  'duration-move': 'duration-fast',
  // The public pages' calmer pace (`duration-public-*`) keeps its names: legacy tokens until phase 6 ports them.
  'duration-modal': 'duration-fast',
  'ease-out': 'ease-smooth-out',
  'ease-hover': 'ease-out',
  'ease-drawer': 'ease-smooth-out',
  'scale-enter': 'scale-medium',
};

function typePairs(prefix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(TYPE_STYLES).map(([from, to]) => [`${prefix}-${from}`, `${prefix}-${to}`]));
}

/** Names only phase 0 brings in. Finding one means this tree was already renamed. */
const NEW_ONLY = [
  '--text-title-lg',
  '--text-heading-regular',
  '--size-control-sm',
  '--size-topbar',
  '--ease-smooth-out',
  '--duration-quick',
  '--canvas',
];

const NAME_CHAR = '[A-Za-z0-9_-]';
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (names: readonly string[]) =>
  [...names]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');

/** `--old` as a whole custom property name: in var(), a string, or a declaration. */
const PROPERTY = new RegExp(`(?<!${NAME_CHAR})--(${alternation(Object.keys(PROPERTIES))})(?!${NAME_CHAR})`, 'g');
/** The first argument of a token reader that takes a full token name. */
const READER = new RegExp(
  `\\b((?:size|space|radius|breakpoint|duration|easing|color|shadow)Token\\(\\s*)(['"])(${alternation(
    Object.keys(PROPERTIES),
  )})\\2`,
  'g',
);
/** The first argument of `typeToken`, which takes a bare style name. */
const TYPE_READER = new RegExp(`\\b(typeToken\\(\\s*)(['"])(${alternation(Object.keys(TYPE_STYLES))})\\2`, 'g');
const NEW_ONLY_PATTERN = new RegExp(`(?<!${NAME_CHAR})(${alternation(NEW_ONLY)})(?!${NAME_CHAR})`);

/** The text with every old name rewritten once. Exported for the test. */
export function rename(text: string): string {
  return text
    .replace(PROPERTY, (_match, name: string) => `--${PROPERTIES[name] ?? name}`)
    .replace(
      READER,
      (_match, call: string, quote: string, name: string) => `${call}${quote}${PROPERTIES[name] ?? name}${quote}`,
    )
    .replace(
      TYPE_READER,
      (_match, call: string, quote: string, name: string) => `${call}${quote}${TYPE_STYLES[name] ?? name}${quote}`,
    );
}

/** Whether the text already uses a name only phase 0 introduced. Exported for the test. */
export function hasNewNames(text: string): boolean {
  return NEW_ONLY_PATTERN.test(text);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const relative = path.relative(ROOT, full);
    if (SKIP_DIRS.has(entry) || SKIP_PATHS.some((skip) => `${relative}/`.startsWith(skip))) return [];
    if (statSync(full).isDirectory()) return files(full);
    return EXTENSIONS.has(path.extname(entry)) ? [full] : [];
  });
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const targets = AREAS.flatMap((area) => files(path.join(ROOT, area)));
  const renamed = targets.filter((file) => hasNewNames(readFileSync(file, 'utf8')));
  if (renamed.length > 0) {
    console.error(
      `RENAME_ALREADY_RUN: these files already use phase 0 names, so running again would swap names back:\n${renamed
        .map((file) => `  ${path.relative(ROOT, file)}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
  let changed = 0;
  for (const file of targets) {
    const before = readFileSync(file, 'utf8');
    const after = rename(before);
    if (after === before) continue;
    changed += 1;
    if (dryRun) console.log(path.relative(ROOT, file));
    else writeFileSync(file, after);
  }
  console.log(`${dryRun ? 'Would change' : 'Changed'} ${String(changed)} files.`);
}

if (import.meta.main) main();
