// House rule checks that lint can't express, run by `pnpm house-rules` (and so
// by the pre push hook and CI). Each check returns the problems it found.
//   1. Screens carry no CSS: apps/web has no stylesheet of its own.
//   2. A component's CSS module is used by that component only: imported by
//      exactly one file, in the same folder.
//   3. Every component with styles records why it exists, in a README.md
//      beside it (the "think before a new component" rule).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKSPACE_DIRS = ['apps', 'packages'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', '.wrangler']);
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

const files = listFiles();
const problems = [
  ...screensHaveNoCss(files),
  ...cssModulesStayInTheirComponent(files),
  ...componentsExplainThemselves(files),
];

if (problems.length > 0) {
  console.error(`House rules: ${String(problems.length)} problem(s)\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('House rules: no problems found.');
