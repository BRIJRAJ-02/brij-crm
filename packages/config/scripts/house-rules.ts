// House rule checks that lint can't express, run by `pnpm house-rules` (and so
// by the pre push hook and CI). Each check returns the problems it found.
//   1. Screens carry no CSS: apps/web has no stylesheet of its own.
//   2. A component's CSS module is used by that component only: imported by
//      exactly one file, in the same folder.
//   3. Every component with styles records why it exists, in a README.md
//      beside it (the "think before a new component" rule).
//   4. Every library component folder (atoms, molecules, modules, fields) has
//      its README.md and a stories file, one story per state (spec 0003).
//   5. Library names are unique: CSS module names, since class names are
//      ws-<component>-<local> with no hash, and story titles, since story ids
//      come from them.
//   6. Sizes stay with their owner: `size-sidebar` only in the sidebar, the
//      app shell and the story workbench, and `size-check` only in Checkbox,
//      Radio and Switch. Anything else uses its own size token (spec 0003).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKSPACE_DIRS = ['apps', 'packages'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', '.vercel', 'storybook-static', '.artifact']);
const LIBRARY = path.join('packages', 'ui', 'src');
const COMPONENT_KINDS = ['atoms', 'molecules', 'modules', 'fields'];
const IMPORT_SPECIFIER = /(?:import|from)\s*['"]([^'"]+\.module\.css)['"]/g;
// Tests own no styles, and their fixtures quote import lines as plain strings.
const SOURCE_FILE = /(?<!\.test)\.tsx?$/;

/** Every file under the workspaces, as paths relative to the repo root. */
function listFiles(): string[] {
  return WORKSPACE_DIRS.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)))
      .filter((file) => !file.split(path.sep).some((part) => SKIP.has(part))),
  );
}

function screensHaveNoCss(files: string[]): string[] {
  return files
    .filter((file) => file.startsWith(path.join('apps', 'web') + path.sep) && file.endsWith('.css'))
    .map(
      (file) => `${file}: screens carry no CSS. Move the styles into a packages/ui component (or a variant of one).`,
    );
}

function cssModulesStayInTheirComponent(files: string[]): string[] {
  const importers = new Map<string, string[]>();
  for (const file of files.filter((f) => SOURCE_FILE.test(f))) {
    for (const match of readFileSync(path.join(ROOT, file), 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = specifier.startsWith('.') ? path.join(path.dirname(file), specifier) : specifier;
      importers.set(target, [...(importers.get(target) ?? []), file]);
    }
  }

  const modules = files.filter((file) => file.endsWith('.module.css'));
  const problems = modules.flatMap((module) => {
    const users = importers.get(module) ?? [];
    if (users.length === 0) return [`${module}: no component imports it. Delete it, or import it from its component.`];
    if (users.length > 1) return [`${module}: imported by ${users.join(', ')}. One component owns its styles.`];
    const [user] = users;
    return user !== undefined && path.dirname(user) !== path.dirname(module)
      ? [`${module}: imported from ${user}. Only the component in the same folder may use it.`]
      : [];
  });

  // A package specifier means one component reaching into another's styles.
  const reachIns = [...importers.entries()]
    .filter(([target]) => !modules.includes(target))
    .map(([target, users]) => `${users.join(', ')}: imports ${target}. Use the component, not its CSS module.`);

  return [...problems, ...reachIns];
}

function componentsExplainThemselves(files: string[]): string[] {
  const styledDirs = new Set(files.filter((file) => file.endsWith('.module.css')).map((file) => path.dirname(file)));
  return [...styledDirs]
    .filter((dir) => !files.includes(path.join(dir, 'README.md')))
    .map((dir) => `${dir}: add a README.md saying what this component is for and why no existing one fit.`);
}

/** Folders like packages/ui/src/atoms/Button: one component (or one attribute type's field) each. */
function libraryComponentDirs(files: string[]): string[] {
  const dirs = files
    .map((file) => path.dirname(file))
    .filter((dir) => {
      const parts = path.relative(LIBRARY, dir).split(path.sep);
      return !dir.startsWith('..') && parts.length === 2 && COMPONENT_KINDS.includes(parts[0] ?? '');
    })
    .filter((dir) => dir.startsWith(LIBRARY + path.sep));
  return [...new Set(dirs)];
}

function componentsHaveStoriesAndReadmes(files: string[]): string[] {
  return libraryComponentDirs(files).flatMap((dir) => {
    const own = files.filter((file) => path.dirname(file) === dir);
    return [
      ...(own.includes(path.join(dir, 'README.md'))
        ? []
        : [`${dir}: add a README.md: what it is for, why it exists, its states and keys.`]),
      ...(own.some((file) => file.endsWith('.stories.tsx'))
        ? []
        : [`${dir}: add a stories file with a story for each of its states.`]),
    ];
  });
}

/** Problems for any name that appears more than once, with the files that share it. */
function duplicates(named: [name: string, file: string][], what: string): string[] {
  const byName = new Map<string, string[]>();
  for (const [name, file] of named) byName.set(name, [...(byName.get(name) ?? []), file]);
  return [...byName.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([name, owners]) => `${owners.join(', ')}: ${what} "${name}" is used more than once. Rename one.`);
}

function libraryNamesAreUnique(files: string[]): string[] {
  const inLibrary = files.filter((file) => file.startsWith(LIBRARY + path.sep));
  const modules = inLibrary
    .filter((file) => file.endsWith('.module.css'))
    .map((file): [string, string] => [path.basename(file, '.module.css'), file]);
  const titles = inLibrary
    .filter((file) => file.endsWith('.stories.tsx'))
    .flatMap((file): [string, string][] => {
      const title = /\btitle:\s*['"]([^'"]+)['"]/.exec(readFileSync(path.join(ROOT, file), 'utf8'))?.[1];
      return title === undefined ? [] : [[title, file]];
    });
  return [...duplicates(modules, 'the CSS module name'), ...duplicates(titles, 'the story title')];
}

/** Size tokens that belong to one part of the library, and the folders allowed to read them. */
const OWNED_SIZES: readonly { readonly token: string; readonly owners: readonly string[] }[] = [
  { token: '--size-sidebar', owners: ['modules/AppShell/', 'modules/Sidebar/', 'workbench/'] },
  { token: '--size-check', owners: ['atoms/Checkbox/', 'atoms/Radio/', 'atoms/Switch/'] },
];

function sizesStayWithTheirOwner(files: string[]): string[] {
  const css = files.filter((file) => file.startsWith(LIBRARY + path.sep) && file.endsWith('.css'));
  return css.flatMap((file) => {
    const inLibrary = path.relative(LIBRARY, file).split(path.sep).join('/');
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    return OWNED_SIZES.filter(
      ({ token, owners }) => text.includes(`var(${token})`) && !owners.some((owner) => inLibrary.startsWith(owner)),
    ).map(({ token }) => `${file}: ${token} belongs to another component. Use the size token for this part instead.`);
  });
}

const files = listFiles();
const problems = [
  ...screensHaveNoCss(files),
  ...cssModulesStayInTheirComponent(files),
  ...componentsExplainThemselves(files),
  ...componentsHaveStoriesAndReadmes(files),
  ...libraryNamesAreUnique(files),
  ...sizesStayWithTheirOwner(files),
];

if (problems.length > 0) {
  console.error(`House rules: ${String(problems.length)} problem(s)\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('House rules: no problems found.');
